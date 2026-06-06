// Coordenadas del pasaje en el PDF (para el visor con resaltado).
export interface RectPDF {
  page: number;
  x0: number;
  top: number;
  x1: number;
  bottom: number;
}
export interface Coordenadas {
  pagina: number;
  page_w: number;
  page_h: number;
  rects: RectPDF[];
}

// Registro de pasaje tal como vive en KV (fuente confiable de la cita).
// Mismo shape que metadata/pasajes.jsonl en constitucion-mexicana.
export interface Pasaje {
  id: string;
  cita: string;
  ruta: string;
  texto: string;
  clave_articulo: string;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  archivo_texto: string;
  url_fuente: string;
  coordenadas: Coordenadas | null;
  [k: string]: unknown;
}

export interface Env {
  ASSETS: Fetcher;
  VECTORIZE: VectorizeIndex;
  PASAJES: KVNamespace;
  OPENAI_API_KEY: string;
  OPENAI_BASE?: string;
  EMBED_MODEL?: string;
  CHAT_MODEL?: string;
  RATE_LIMITER: DurableObjectNamespace; // rate limiting por IP
  PDF: R2Bucket; // PDF oficial versionado
}
