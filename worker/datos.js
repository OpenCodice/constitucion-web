// Lectura de los archivos del despliegue (env.ASSETS), con una memoria
// pequeña por isolate: un isolate atiende muchas peticiones, y el despliegue
// siguiente arranca isolates nuevos con los archivos nuevos.

export const SITIO = "https://constitucion.app";
export const NOTA = "Texto extraído del PDF oficial por OpenCodice. No es la publicación oficial ni asesoría legal.";

const memoria = new Map();
const MAX_MEMORIA = 48;

async function leer(env, ruta, como) {
  const clave = `${como}:${ruta}`;
  if (memoria.has(clave)) {
    const v = memoria.get(clave);
    memoria.delete(clave);
    memoria.set(clave, v);
    return v;
  }
  const r = await env.ASSETS.fetch(new Request(`${SITIO}/${ruta}`));
  if (!r.ok) return null;
  const v = como === "json" ? await r.json() : await r.text();
  memoria.set(clave, v);
  while (memoria.size > MAX_MEMORIA) memoria.delete(memoria.keys().next().value);
  return v;
}

export const json = (env, ruta) => leer(env, ruta, "json");
export const texto = (env, ruta) => leer(env, ruta, "texto");

export const catalogo = (env) => json(env, "ley/catalogo.json");
// Lo mínimo de un documento para servir un artículo: su ficha, sus claves y
// en qué trozo está cada una (`scripts/lib/corpus.mjs`).
export const minimoDe = (env, doc) => json(env, `ley/_/${doc}/i.json`);
export const trozoDe = (env, doc, n) => json(env, `ley/_/${doc}/${n}.json`);
// Las versiones anteriores al alta: cuáles hay y la línea de tiempo de cada
// artículo, por trozos (`archivosAnteriores` de corpus.mjs).
export const anterioresDe = (env, doc) => json(env, `ley/_/${doc}/h.json`);
export const trozoAnterior = (env, doc, n) => json(env, `ley/_/${doc}/h${n}.json`);
// El índice público, con la etiqueta y ubicación de cada artículo.
export const indiceDe = (env, doc) => json(env, `ley/${doc}.json`);

export class ErrorDatos extends Error {}

// Una página de una lista: las herramientas que listan aceptan `limite` y
// `pagina`, y dicen cuántas páginas hay.
export function paginar(xs, { limite, pagina } = {}, def, max) {
  const n = Math.min(Math.max(1, Number(limite) || def), max);
  const paginas = Math.max(1, Math.ceil(xs.length / n));
  const p = Math.max(1, Math.floor(Number(pagina)) || 1);
  return { total: xs.length, pagina: p, paginas, elementos: xs.slice((p - 1) * n, p * n) };
}

export const pieDePagina = (r) =>
  r.paginas > 1 ? `\n(página ${r.pagina} de ${r.paginas}${r.pagina < r.paginas ? `; la siguiente, con \`pagina\`: ${r.pagina + 1}` : ""})\n` : "";
