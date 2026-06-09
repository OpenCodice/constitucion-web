# constitucion-web

UI web del RAG de la Constitución mexicana, sobre **Cloudflare Workers**.
Cuarto repo del sistema: la **aplicación web**. Consume los datos de
[`constitucion-mexicana`](../constitucion-mexicana) y reusa el patrón del RAG
([`constitucion-rag`](../constitucion-rag)) portado a TypeScript.

```
pregunta ─▶ embedding (OpenAI) ─▶ Vectorize (top-K) ─▶ hidrata pasajes (KV)
         ─▶ filtro vigencia ─▶ LLM responde anclado (streaming) ─▶ citas verificables
```

**Patrón anti-alucinación (intacto):** el LLM no escribe la cita; devuelve `id`s
de pasaje, la app valida que existan entre los recuperados y **renderiza la cita
desde el registro confiable de KV** (`cita`/`ruta`/`texto`/vigencia).

## Arquitectura

| Pieza | Rol |
|---|---|
| **Worker** (`worker/`) | API `/api/preguntar` (streaming NDJSON) + sirve el frontend |
| **Vectorize** | índice vectorial (1536 dims, cosine) — recuperación semántica |
| **KV** (`PASAJES`) | pasajes completos por `id` — fuente de las citas |
| **OpenAI** | embeddings (`text-embedding-3-small`) + respuesta (`gpt-4o-mini`) |
| **Preact + Tailwind** (`src/`) | frontend, build con Vite → `dist/` |

Decisión: `as_of` (consulta histórica) se **post-filtra en el Worker** con el
registro de KV, no con índices de metadata en Vectorize. Hoy todos los pasajes
son vigentes (`vigente_hasta: null`); cuando existan históricos a escala, se
migra a metadata filtering. Ver `worker/retrieve.ts`.

## Puesta en marcha

```bash
npm install

# 1. Infraestructura (una vez)
npx wrangler vectorize create constitucion-pasajes --dimensions=1536 --metric=cosine
npx wrangler kv namespace create PASAJES          # copia el id → wrangler.jsonc
npx wrangler secret put OPENAI_API_KEY            # para producción
cp .dev.vars.example .dev.vars                    # y pon tu key para dev local

# 2. Ingestión: datos → embeddings → Vectorize + KV
OPENAI_API_KEY=sk-... npm run ingest              # lee ../constitucion-mexicana
npm run upload:vectors                            # sube vectors.ndjson a Vectorize
npm run upload:kv                                 # sube pasajes a KV (--remote)
#  ⚠️ Vectorize tarda 5-10 s en hacer queryable lo recién subido.

# 3. Desarrollo (frontend :5173 + Worker :8787, con proxy /api)
npm run dev

# 4. Producción
npm run deploy                                    # vite build + wrangler deploy
```

## Actualización cuando hay reforma / enriquecimiento

Cuando `constitucion-mexicana` recibe un commit nuevo (reforma o el CI de
enriquecimiento), reconstruye el índice:

```bash
cd ../constitucion-mexicana && git pull
cd ../constitucion-web && npm run ingest && npm run upload:vectors && npm run upload:kv
```

Esto se puede automatizar con un GitHub Action en `constitucion-mexicana` que
dispare la ingestión tras cada commit a `main`.

## Auto-fusión federal + estatal

El RAG responde **federal + tu estado en una sola respuesta**. Los pasajes de
las constituciones estatales viven en
[`leyes-estatales`](https://github.com/OpenCodice/leyes-estatales) (un dir por
estado) y entran al **mismo** índice Vectorize, etiquetados con su jurisdicción
(`ambito`: `federal`, `jalisco`, `cdmx`, …). La query filtra por `ambito` para
no mezclar leyes de estados distintos. El estado se infiere de la pregunta (por
nombre o gentilicio); sin selector obligatorio. La federal siempre se incluye.

Activación (el **orden importa**: el índice de metadata solo aplica a vectores
insertados *después* de crearlo):

```bash
# 1. Crear el índice de metadata sobre `ambito` (una vez)
npm run index:metadata
# 2. Re-ingestar TODO el corpus (federal + estados) para que lleve `ambito`
OPENAI_API_KEY=sk-... npm run ingest \
  ../constitucion-mexicana \
  ../leyes-estatales/jalisco/constitucion \
  ../leyes-estatales/cdmx/constitucion
npm run upload:vectors
npm run upload:kv
# 3. Activar el filtro y desplegar
#    pon  "AMBITO_FILTER": "1"  en wrangler.jsonc (vars)
npm run deploy
```

Hasta que `AMBITO_FILTER` sea `"1"` el filtro está apagado y el Worker se
comporta como antes (seguro desplegar el código sin haber migrado los datos).
La API/MCP aceptan además `ambito` explícito (p. ej. `["jalisco"]`) que tiene
prioridad sobre la inferencia.

## Notas de costo / operación

- Ingestión: ~$0.01 una vez (1353 embeddings); se repite solo al reindexar.
- Por pregunta: 1 embedding de query + 1 chat `gpt-4o-mini` (~$0.001).
- **AI Gateway** (recomendado): apunta `OPENAI_BASE` en `wrangler.jsonc` a tu
  gateway para obtener caché de respuestas, rate limiting y analítica de costo.

## API

El Worker expone tres superficies sobre la **misma** `retrieve()`:

| Endpoint | Para | Genera respuesta |
|---|---|---|
| `POST /api/preguntar` | la UI humana | sí (LLM, streaming) |
| `POST /api/buscar` | LLMs / tools (ChatGPT, function-calling) | no (recuperación pura) |
| `GET /openapi.json` | ChatGPT Actions / Custom GPT | — |
| `/mcp` | Claude y clientes MCP (JSON-RPC) | no |

**Principio:** a un LLM consumidor se le dan **pasajes citables**, no prosa
generada. Así no se paga ni se apila un segundo LLM, y el modelo que llama cita
desde la fuente confiable. Es el patrón anti-alucinación, con el LLM externo como
renderizador de la cita.

### `POST /api/preguntar` (humano) → `application/x-ndjson`
Una línea JSON por evento:
```
{"t":"hits", "v":[{"id","cita","score"}]}   pasajes recuperados
{"t":"token","v":"…"}                        prosa en streaming
{"t":"citas","v":[{"id","cita","ruta","texto","vigente_*","archivo"}]}
{"t":"error","v":"…"}
```

### `POST /api/buscar` (máquina) → JSON
```jsonc
// req:  { "pregunta": "...", "k": 6, "as_of": "2020-01-01" }
// resp: { "pregunta": "...", "pasajes": [
//   { "id","cita","ruta","texto","vigente_desde","vigente_hasta","archivo","score" } ] }
```

### MCP
Conecta un cliente MCP a `https://<tu-worker>/mcp`. Expone la tool
`buscar_constitucion(pregunta, k?, as_of?)`. Implementación a mano (Streamable
HTTP / JSON-RPC); ver `worker/mcp.ts`. Validar con un cliente real.
