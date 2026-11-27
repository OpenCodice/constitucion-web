// Cómo se parte un texto en palabras para la búsqueda literal. Lo usan el
// generador del índice (`scripts/lib/busqueda.mjs`) y el Worker, que deben
// partir igual: sin acentos ni mayúsculas, y la ñ como n.

export const plano = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export const palabras = (s) => plano(s).match(/[a-z0-9]{2,}/g) ?? [];

// La forma con que una palabra entra al índice: singular y plural cuentan
// igual («vapeador», «vapeadores»; «juez», «jueces»; «base», «bases»). Es una
// regla fija sobre la terminación, no un diccionario: dos palabras distintas
// pueden compartir raíz («sal», «sale»), nunca al revés. Las de tres letras o
// menos y las que tienen cifras quedan como están.
export function raiz(palabra) {
  if (palabra.length < 4 || /\d/.test(palabra)) return palabra;
  let r = palabra;
  if (r.endsWith("ces")) r = `${r.slice(0, -3)}z`;
  else if (r.endsWith("es")) r = r.slice(0, -2);
  // «país», «crisis», «virus»: una «s» tras «i» o «u» no es de plural.
  else if (r.endsWith("s") && !/[iu]s$/.test(r)) r = r.slice(0, -1);
  if (r.endsWith("e")) r = r.slice(0, -1);
  return r.length >= 3 ? r : palabra;
}

export const terminos = (s) => palabras(s).map(raiz);

// Palabras sin contenido propio: no se indexan y la búsqueda las ignora. Es
// una lista fija, no una medida de frecuencia: «salud», «seguridad» o
// «nacional» aparecen en miles de artículos y aun así se pueden buscar.
export const VACIAS = new Set(
  `al algun alguna algunas alguno algunos ante aquel aquella aquellas aquellos asi aun cada como con contra cual cuales
  cualquier cuando de del desde donde durante el ella ellas ello ellos en entre era es esa esas ese eso esos esta estas este
  esto estos fue ha han hasta hay haya hayan la las le les lo los mas me mi muy ni no nos o os
  otra otras otro otros para pero por porque que quien quienes se sea sean segun ser sera seran si sido siempre sin sino
  sobre solo son su sus tal tales tambien tan tanto te toda todas todo todos tras tu un una unas uno unos ya`.split(/\s+/),
);

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
