import type { Hit } from "./retrieve";
import type { Coordenadas } from "./types";

/**
 * Port de rag/answer.py — patrón anti-alucinación.
 *
 * El LLM responde SOLO con los pasajes dados y, al final, lista los ids que usó
 * tras un marcador. La app valida que esos ids existan entre los recuperados y
 * **renderiza la cita desde el dato confiable** (KV), nunca del texto del LLM.
 *
 * Variante streaming: en vez de pedir un JSON entero (que no se puede emitir
 * token a token), pedimos la prosa primero y los ids después del marcador.
 */
export const MARK = "##CITAS##";

export const SYSTEM =
  "Eres un asistente que responde preguntas sobre la Constitución mexicana " +
  "USANDO EXCLUSIVAMENTE los pasajes que se te proporcionan. No uses " +
  "conocimiento externo. Si los pasajes no contienen la respuesta, dilo " +
  "claramente. Responde en español, de forma breve y clara.";

export function buildMessages(question: string, hits: Hit[]) {
  const pasajes = hits.map((h) => `[${h.id}] (${h.cita})\n${h.texto}`).join("\n\n");
  const user =
    `PASAJES:\n${pasajes}\n\n` +
    `PREGUNTA: ${question}\n\n` +
    `Primero escribe la respuesta en español, breve y clara, basada solo en los pasajes.\n` +
    `Al terminar, en una línea nueva escribe exactamente "${MARK}" seguido de un ` +
    `arreglo JSON con los ids de los pasajes que respaldan tu respuesta. Ejemplo:\n` +
    `${MARK}["${hits[0]?.id ?? "001.p1"}"]\n` +
    `Incluye en el arreglo únicamente ids que aparezcan en los PASAJES de arriba.`;
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

export interface Cita {
  id: string;
  cita: string;
  ruta: string;
  texto: string;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  archivo: string;
  pdf: string; // url al PDF oficial del DOF
  coordenadas: Coordenadas | null; // página + rects para el visor con resaltado
}

/** Sólo se aceptan ids realmente recuperados (anti-alucinación de citas). */
export function buildCitas(hits: Hit[], ids: string[]): Cita[] {
  const byId = new Map(hits.map((h) => [h.id, h]));
  const out: Cita[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const h = byId.get(id);
    if (!h || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id: h.id,
      cita: h.cita,
      ruta: h.ruta,
      texto: h.texto,
      vigente_desde: h.vigente_desde,
      vigente_hasta: h.vigente_hasta,
      archivo: h.archivo_texto,
      pdf: h.url_fuente,
      coordenadas: h.coordenadas ?? null,
    });
  }
  return out;
}

/** Extrae el arreglo de ids que el LLM escribió después del marcador. */
export function parseCitaIds(full: string): string[] {
  const idx = full.indexOf(MARK);
  if (idx === -1) return [];
  const rest = full.slice(idx + MARK.length);
  const m = rest.match(/\[[\s\S]*?\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
