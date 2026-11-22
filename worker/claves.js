// Cómo se nombra un artículo al pedirlo. Las claves de archivo son las de los
// repos de datos (`004`, `077-bis-35-a`, `1.1` de una regla, `1-cff-n` de un
// criterio), pero un agente o una persona escribe «4o», «Artículo 77 Bis 35 A»
// o «Regla 1.1.». Lo usan el Worker y el generador (`scripts/lib/corpus.mjs`),
// así que no depende de nada.

const PREFIJOS = /^(art[ií]culos?|arts?|regla|criterio|ficha|numeral)\.?\s+/;

export function normalizarClave(texto) {
  let s = String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\.md$/, "");
  s = s.replace(PREFIJOS, "");
  s = s
    .replace(/[º°]/g, "o")
    .replace(/[\s_/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[.\-]+$/, "")
    .replace(/^-+/, "");
  // «4o», «1o-bis», «4o.»: el ordinal no es parte de la clave.
  s = s.replace(/^(\d+)o(?=$|-)/, "$1");
  return s;
}

// Sin ceros a la izquierda: «004» y «4» son la misma clave.
export const sinCeros = (clave) => clave.replace(/^0+(?=\d)/, "");

// Mapa de búsqueda de un documento: forma normalizada → clave de archivo.
export function mapaClaves(claves) {
  const mapa = new Map();
  for (const k of claves) {
    for (const forma of [k, normalizarClave(k), sinCeros(normalizarClave(k))]) if (!mapa.has(forma)) mapa.set(forma, k);
  }
  return mapa;
}

export function resolverClave(mapa, texto) {
  if (mapa.has(texto)) return mapa.get(texto);
  const n = normalizarClave(texto);
  return mapa.get(n) ?? mapa.get(sinCeros(n)) ?? null;
}
