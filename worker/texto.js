// Cómo se parte un texto en palabras para la búsqueda literal. Lo usan el
// generador del índice (`scripts/lib/busqueda.mjs`) y el Worker, que deben
// partir igual: sin acentos ni mayúsculas, y la ñ como n.

export const plano = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export const palabras = (s) => plano(s).match(/[a-z0-9]{2,}/g) ?? [];

// En qué archivo del índice está una palabra (FNV-1a, 256 archivos).
export const PARTES = 256;
export function parteDe(palabra) {
  let h = 0x811c9dc5;
  for (let i = 0; i < palabra.length; i++) {
    h ^= palabra.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % PARTES).toString(16).padStart(2, "0");
}

// Las listas de unidades de cada palabra van ordenadas, como diferencias en
// base 36 separadas por comas.
export function codificar(ids) {
  let previo = 0;
  return ids.map((id) => {
    const d = id - previo;
    previo = id;
    return d.toString(36);
  }).join(",");
}

export function decodificar(texto) {
  const ids = [];
  let previo = 0;
  for (const d of texto.split(",")) {
    previo += parseInt(d, 36);
    ids.push(previo);
  }
  return ids;
}
