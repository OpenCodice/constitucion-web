import type { Env, Coordenadas } from "./types";
import { retrieve } from "./retrieve";

// Forma citable de un pasaje para consumo por máquina (LLMs, tools, MCP).
// Es la "fuente confiable": el LLM que llama redacta y cita a partir de esto.
export interface PasajeResultado {
  id: string;
  ambito: string; // jurisdicción: "federal", "jalisco", … (para no confundir leyes)
  cita: string;
  ruta: string;
  texto: string;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  archivo: string;
  pdf: string;
  coordenadas: Coordenadas | null;
  score: number;
}

/** Recuperación pura: sin generación de respuesta. Base de /api/buscar y MCP. */
export async function buscar(
  env: Env,
  pregunta: string,
  k: number,
  asOf: string | null,
  ambitos: string[] | null = null,
): Promise<PasajeResultado[]> {
  const hits = await retrieve(env, pregunta, k, asOf, ambitos);
  return hits.map((h) => ({
    id: h.id,
    ambito: h.ambito,
    cita: h.cita,
    ruta: h.ruta,
    texto: h.texto,
    vigente_desde: h.vigente_desde,
    vigente_hasta: h.vigente_hasta,
    archivo: h.archivo_texto,
    pdf: h.url_fuente,
    coordenadas: h.coordenadas ?? null,
    score: Math.round(h._score * 10000) / 10000,
  }));
}
