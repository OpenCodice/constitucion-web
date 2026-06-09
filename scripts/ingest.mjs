// Ingestión: lee el repo de datos (constitucion-mexicana), genera embeddings con
// OpenAI y produce dos artefactos para subir a Cloudflare:
//
//   .data/vectors.ndjson   → wrangler vectorize insert   (id + values + metadata)
//   .data/kv-pasajes.json  → wrangler kv bulk put        (registro confiable por id)
//
// Reemplaza a `rag indexar`. Embebe `texto_embedding` + el enriquecimiento del
// artículo (igual que _search_text en rag/corpus.py): el enriquecimiento mejora
// el recall pero NUNCA es fuente de cita (la cita sale de `texto`).
//
// Multi-corpus: federal + constituciones estatales en UN índice. Cada pasaje
// lleva su `ambito` (jurisdicción) en la metadata del vector, para filtrar la
// auto-fusión sin contaminación cruzada. Los ids estatales ya vienen
// prefijados (jal:..., cmx:...); los federales no, para no romper compat.
//
// Uso:
//   OPENAI_API_KEY=sk-... node scripts/ingest.mjs [ruta-de-datos ...]
//   (default: federal + Jalisco + CDMX)

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Corpus a indexar. Cada uno es un dir con metadata/pasajes.jsonl.
const CORPORA = process.argv.slice(2);
if (CORPORA.length === 0) {
  CORPORA.push(
    "../constitucion-mexicana",
    "../leyes-estatales/jalisco/constitucion",
    "../leyes-estatales/cdmx/constitucion",
  );
}
const EMBED_MODEL = process.env.EMBED_MODEL ?? "text-embedding-3-small";
const OPENAI_BASE = process.env.OPENAI_BASE ?? "https://api.openai.com/v1";
const API_KEY = process.env.OPENAI_API_KEY;
const OUT_DIR = ".data";
const BATCH = 100; // tamaño de lote para la API de embeddings

if (!API_KEY) {
  console.error("Falta OPENAI_API_KEY en el entorno.");
  process.exit(1);
}

// --- cargar pasajes + enriquecimiento -------------------------------------- //
function loadPasajes(repo) {
  const file = join(repo, "metadata", "pasajes.jsonl");
  if (!existsSync(file)) {
    console.error(`No existe ${file}. Corre el extractor primero.`);
    process.exit(1);
  }
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    // Federal histórico no trae `ambito`; por defecto es la federal.
    .map((p) => ({ ...p, ambito: p.ambito ?? "federal" }));
}

function loadEnrichment(repo) {
  const dir = join(repo, "metadata", "generado");
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      out[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf-8"));
    } catch {
      /* ignora archivos corruptos */
    }
  }
  return out;
}

// Réplica de _search_text en rag/corpus.py.
function searchText(p, enrich) {
  const parts = [p.texto_embedding];
  if (enrich) {
    parts.push(enrich.denominacion_comun ?? "");
    parts.push(...(enrich.temas ?? []));
    parts.push(...(enrich.terminos_coloquiales ?? []));
    parts.push(...(enrich.preguntas_ejemplo ?? []));
  }
  return parts.filter(Boolean).join("\n");
}

// --- embeddings ------------------------------------------------------------- //
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Reintenta ante fallos transitorios (red, 429, 5xx) con backoff exponencial,
// para que un blip de la API no tumbe todo el reindex. Los 4xx (salvo 429) no
// se reintentan: son errores reales.
async function embedBatch(texts, intentos = 5) {
  let espera = 1000;
  for (let i = 1; ; i++) {
    let r = null;
    try {
      r = await fetch(`${OPENAI_BASE}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
      });
    } catch (e) {
      if (i >= intentos) throw e; // error de red tras agotar reintentos
    }
    if (r && r.ok) {
      const j = await r.json();
      return j.data.map((d) => d.embedding);
    }
    const transitorio = !r || r.status === 429 || r.status >= 500;
    if (!transitorio || i >= intentos) {
      throw new Error(`embeddings ${r ? r.status : "network"} (intento ${i}): ${r ? await r.text() : "fetch failed"}`);
    }
    const retryAfter = r?.headers.get("retry-after");
    const wait = retryAfter ? Number(retryAfter) * 1000 : espera;
    console.warn(`  ⚠ embeddings ${r ? r.status : "network"}; reintento ${i}/${intentos - 1} en ${wait}ms`);
    await sleep(wait);
    espera = Math.min(espera * 2, 30000);
  }
}

// --- main ------------------------------------------------------------------- //
const vectorLines = [];
const kvPairs = [];

for (const repo of CORPORA) {
  const pasajes = loadPasajes(repo);
  const enrich = loadEnrichment(repo);
  const ambito = pasajes[0]?.ambito ?? "federal";
  console.log(
    `\n[${ambito}] ${repo}: ${pasajes.length} pasajes, ` +
      `${Object.keys(enrich).length} artículos enriquecidos.`,
  );

  for (let i = 0; i < pasajes.length; i += BATCH) {
    const slice = pasajes.slice(i, i + BATCH);
    const texts = slice.map((p) => searchText(p, enrich[p.clave_articulo]));
    const vectors = await embedBatch(texts);

    slice.forEach((p, j) => {
      vectorLines.push(
        JSON.stringify({
          id: p.id,
          values: vectors[j],
          // `ambito` indexado → filtro de jurisdicción en la query (auto-fusión).
          metadata: { ambito: p.ambito, clave_articulo: p.clave_articulo },
        }),
      );
      // El registro completo va a KV: de aquí salen las citas verificables.
      kvPairs.push({ key: p.id, value: JSON.stringify(p) });
    });
    console.log(`  embebidos ${Math.min(i + BATCH, pasajes.length)}/${pasajes.length}`);
  }
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "vectors.ndjson"), vectorLines.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "kv-pasajes.json"), JSON.stringify(kvPairs));

console.log(`\n✓ ${OUT_DIR}/vectors.ndjson  (${vectorLines.length} vectores)`);
console.log(`✓ ${OUT_DIR}/kv-pasajes.json (${kvPairs.length} registros)`);
console.log("\nAhora súbelos:");
console.log("  npm run upload:vectors");
console.log("  npm run upload:kv");
