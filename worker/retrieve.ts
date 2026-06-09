import type { Env, Pasaje } from "./types";
import { vigente } from "./vigente";

export interface Hit extends Pasaje {
  _score: number;
}

/** Embedding de un texto con OpenAI (mismo modelo que la ingestión). */
export async function embed(env: Env, text: string): Promise<number[]> {
  const base = env.OPENAI_BASE ?? "https://api.openai.com/v1";
  const r = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.EMBED_MODEL ?? "text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) throw new Error(`embeddings ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { data: { embedding: number[] }[] };
  return j.data[0].embedding;
}

/**
 * Recupera los k pasajes más relevantes y vigentes.
 *
 * Vectorize sólo guarda vectores → devuelve ids. El texto/cita se hidrata desde
 * KV (registro confiable). Sobre-pedimos topK y filtramos por vigencia en el
 * Worker usando el dato real de KV (evita índices de metadata mientras todos los
 * pasajes son vigentes; ver README).
 */
export async function retrieve(
  env: Env,
  pregunta: string,
  k: number,
  asOf: string | null,
  ambitos: string[] | null = null,
): Promise<Hit[]> {
  const vec = await embed(env, pregunta);
  // Auto-fusión: filtra por jurisdicción en Vectorize (requiere índice de
  // metadata sobre `ambito`; ver README). Una sola query rankea federal +
  // estado en un top-k unificado, sin contaminación cruzada.
  const opts: VectorizeQueryOptions = {
    topK: Math.min(k * 4, 100),
    returnMetadata: "none",
  };
  // Solo filtra cuando el índice de metadata existe y el corpus está re-ingestado
  // (flag AMBITO_FILTER=1). Así desplegar el código antes de migrar no rompe nada.
  if (env.AMBITO_FILTER === "1" && ambitos && ambitos.length) {
    opts.filter = { ambito: { $in: ambitos } };
  }
  const res = await env.VECTORIZE.query(vec, opts);

  const scoreById = new Map(res.matches.map((m) => [m.id, m.score]));
  const records = await Promise.all(
    res.matches.map((m) => env.PASAJES.get<Pasaje>(m.id, "json")),
  );

  const hits: Hit[] = [];
  for (const rec of records) {
    if (!rec) continue; // id huérfano (índice y KV desincronizados)
    if (!vigente(rec, asOf)) continue;
    hits.push({ ...rec, _score: scoreById.get(rec.id) ?? 0 });
    if (hits.length >= k) break;
  }
  return hits;
}
