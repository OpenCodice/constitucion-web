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
// Uso:
//   OPENAI_API_KEY=sk-... node scripts/ingest.mjs [ruta-al-repo-de-datos]
//   (default: ../constitucion-mexicana)

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DATA_REPO = process.argv[2] ?? "../constitucion-mexicana";
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
function loadPasajes() {
  const file = join(DATA_REPO, "metadata", "pasajes.jsonl");
  if (!existsSync(file)) {
    console.error(`No existe ${file}. Corre el extractor primero.`);
    process.exit(1);
  }
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function loadEnrichment() {
  const dir = join(DATA_REPO, "metadata", "generado");
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
async function embedBatch(texts) {
  const r = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!r.ok) throw new Error(`embeddings ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.data.map((d) => d.embedding);
}

// --- main ------------------------------------------------------------------- //
const pasajes = loadPasajes();
const enrich = loadEnrichment();
console.log(`${pasajes.length} pasajes, ${Object.keys(enrich).length} artículos enriquecidos.`);

const vectorLines = [];
const kvPairs = [];

for (let i = 0; i < pasajes.length; i += BATCH) {
  const slice = pasajes.slice(i, i + BATCH);
  const texts = slice.map((p) => searchText(p, enrich[p.clave_articulo]));
  const vectors = await embedBatch(texts);

  slice.forEach((p, j) => {
    vectorLines.push(
      JSON.stringify({
        id: p.id,
        values: vectors[j],
        metadata: { clave_articulo: p.clave_articulo },
      }),
    );
    // El registro completo va a KV: de aquí salen las citas verificables.
    kvPairs.push({ key: p.id, value: JSON.stringify(p) });
  });
  console.log(`  embebidos ${Math.min(i + BATCH, pasajes.length)}/${pasajes.length}`);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "vectors.ndjson"), vectorLines.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "kv-pasajes.json"), JSON.stringify(kvPairs));

console.log(`\n✓ ${OUT_DIR}/vectors.ndjson  (${vectorLines.length} vectores)`);
console.log(`✓ ${OUT_DIR}/kv-pasajes.json (${kvPairs.length} registros)`);
console.log("\nAhora súbelos:");
console.log("  npm run upload:vectors");
console.log("  npm run upload:kv");
