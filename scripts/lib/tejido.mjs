// El tejido del inicio: un cuadro por documento publicado, acomodado en un
// motivo espejado, como una greca. La Constitución va al centro en un bloque
// de 2×2; cada otro documento ocupa una celda, y las celdas se llenan en
// órbitas de cuatro (sus reflejos en los cuatro cuadrantes), de adentro hacia
// afuera. Como cada órbita es de un solo corpus, el color queda simétrico
// aunque cada celda sea un documento distinto.
//
// Es determinista: los mismos documentos dan el mismo dibujo. Lo usan el
// inicio (con enlaces a la historia de cada documento) y su tarjeta para
// redes (sin enlaces, con los colores escritos).

import { esc } from "./comun.mjs";

// El orden es el de la leyenda.
export const CORPUS = [
  ["cpeum", "Constitución federal"],
  ["constitucion", "Constituciones estatales"],
  ["general", "Leyes generales y nacionales"],
  ["organica", "Leyes orgánicas, reglamentarias y códigos"],
  ["federal", "Las demás leyes federales"],
  ["estatal", "Leyes de los estados"],
  ["fiscal", "Legislación fiscal del SAT"],
];

// Colores para el modo claro; el CSS del inicio los repite junto con los del
// oscuro. La tarjeta para redes (resvg) usa estos.
export const PALETA = {
  cpeum: "#D6322A",
  constitucion: "#3A6FB0",
  general: "#D8CDB2",
  organica: "#C2185B",
  federal: "#0F6B45",
  estatal: "#161616",
  fiscal: "#8C4A26",
};

// En qué tramo de la secuencia de órbitas (de 0, el centro, a 1, el borde)
// se reparten las de cada corpus. Las leyes federales, que son la mayoría,
// llenan lo que queda.
const TRAMOS = {
  constitucion: [0, 0.3],
  organica: [0.05, 0.55],
  fiscal: [0.3, 0.6],
  general: [0.45, 1],
  estatal: [0.2, 0.9],
};
const RELLENO = "federal";

// Una celda del cuadrante (x, y), contando desde el centro, entra al motivo
// si no es hueco. Los huecos siguen la diagonal (x + 2y) y alternan por
// anillos: de ahí los escalones de greca. La distancia pesa más lo vertical
// para que el motivo sea más ancho que alto.
const distancia = (x, y) => x + y * 1.3;
function esHueco(x, y) {
  const anillo = Math.floor(distancia(x, y) / 2.6);
  if ((x + 2 * y) % 5 === 2) return true;
  if (anillo % 2 === 1 && (x * y) % 3 === 1) return true;
  return anillo % 2 === 0 && x > 0 && y > 0 && (x + y) % 4 === 3;
}

function orbitas(n) {
  const candidatas = [];
  const lado = Math.ceil(Math.sqrt(n) * 3) + 4;
  for (let y = 0; y < lado; y++)
    for (let x = 0; x < lado; x++) if ((x || y) && !esHueco(x, y)) candidatas.push([x, y]);
  candidatas.sort((a, b) => distancia(...a) - distancia(...b) || a[1] - b[1] || a[0] - b[0]);
  return candidatas.slice(0, n);
}

// Qué corpus toca a cada órbita: los de TRAMOS en posiciones espaciadas
// dentro de su tramo, y el relleno en las libres.
function repartir(cuantas, total) {
  const asignadas = new Array(total).fill(null);
  for (const [corpus, [desde, hasta]] of Object.entries(TRAMOS)) {
    const k = cuantas[corpus] ?? 0;
    for (let i = 0; i < k; i++) {
      let p = Math.min(total - 1, Math.round((desde + ((i + 0.5) / k) * (hasta - desde)) * (total - 1)));
      while (asignadas[p] !== null) p = (p + 1) % total;
      asignadas[p] = corpus;
    }
  }
  return asignadas.map((c) => c ?? RELLENO);
}

// documentos: [{ clave, nombre, corpus, url, reciente }]. Devuelve las celdas
// en unidades de cuadro y el tamaño del motivo.
export function tejer(documentos) {
  const porCorpus = Object.fromEntries(CORPUS.map(([c]) => [c, []]));
  for (const d of documentos) porCorpus[d.corpus]?.push(d);
  for (const lista of Object.values(porCorpus)) lista.sort((a, b) => a.clave.localeCompare(b.clave));

  // Las órbitas completas se reparten por todo el motivo; las que quedan a
  // medias (un corpus que no es múltiplo de 4) van al borde, donde la falta de
  // simetría se lee como un hilo suelto y no rompe el dibujo.
  const otros = Object.entries(porCorpus).filter(([c]) => c !== "cpeum");
  const completas = Object.fromEntries(otros.map(([c, l]) => [c, Math.floor(l.length / 4)]));
  const incompletas = otros.filter(([, l]) => l.length % 4).map(([c]) => c);
  const llenas = Object.values(completas).reduce((s, n) => s + n, 0);
  const reparto = [...repartir(completas, llenas), ...incompletas];
  const lugares = orbitas(reparto.length);

  // Coordenadas en cuadros con el centro en (0, 0): la celda (x, y) del
  // cuadrante y sus reflejos.
  const celdas = [];
  if (porCorpus.cpeum.length) celdas.push({ x: -1, y: -1, lado: 2, doc: porCorpus.cpeum[0] });
  const siguiente = Object.fromEntries(Object.keys(porCorpus).map((c) => [c, 0]));
  lugares.forEach(([x, y], i) => {
    const lista = porCorpus[reparto[i]];
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const doc = lista[siguiente[reparto[i]]++];
      if (!doc) break;
      celdas.push({ x: sx > 0 ? x : -1 - x, y: sy > 0 ? y : -1 - y, lado: 1, doc });
    }
  });

  const xs = celdas.flatMap((c) => [c.x, c.x + c.lado]);
  const ys = celdas.flatMap((c) => [c.y, c.y + c.lado]);
  const caja = { x: Math.min(...xs), y: Math.min(...ys), ancho: Math.max(...xs) - Math.min(...xs), alto: Math.max(...ys) - Math.min(...ys) };
  return { celdas, caja, total: celdas.length };
}

// El punteado del corpus fiscal, como el pespunte de un bordado. `base` y
// `punto` son el atributo de color: en la página, un estilo con la variable
// del tema; en la tarjeta, el color escrito.
const punteado = (id, base, punto) =>
  `<pattern id="${id}" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" ${base}/>` +
  [0.2, 0.6].flatMap((py) => [0.2, 0.6].map((px) => `<rect x="${px + (py > 0.5 ? 0.2 : 0)}" y="${py}" width="0.08" height="0.08" ${punto}/>`)).join("") +
  `</pattern>`;

// El motivo para la página: cada celda enlaza a la historia de su documento
// y lleva su nombre. Los enlaces quedan fuera del orden de tabulación (son
// cientos); la lista de corpus, debajo, es el camino con teclado.
export function svgTejido(t) {
  const { caja } = t;
  const celdas = t.celdas
    .map((c) => {
      const x = c.x - caja.x;
      const y = c.y - caja.y;
      const clase = `c-${c.doc.corpus}${c.doc.reciente ? " reciente" : ""}`;
      const punto = c.doc.reciente
        ? `<rect class="punto" x="${x + c.lado * 0.36}" y="${y + c.lado * 0.36}" width="${c.lado * 0.28}" height="${c.lado * 0.28}"/>`
        : "";
      return `<a href="${esc(c.doc.url)}" tabindex="-1" data-n="${esc(c.doc.nombre)}" data-c="${c.doc.corpus}"><rect class="${clase}" x="${x}" y="${y}" width="${c.lado}" height="${c.lado}"/>${punto}<title>${esc(c.doc.nombre)}</title></a>`;
    })
    .join("");
  return `<svg class="tejido" viewBox="0 0 ${caja.ancho} ${caja.alto}" shape-rendering="crispEdges" role="img" aria-label="Un cuadro por cada uno de los ${t.total} documentos publicados">
<defs>${punteado("punteado", 'style="fill: var(--fiscal)"', 'style="fill: var(--punto-fiscal)"')}</defs>
${celdas}
</svg>`;
}

// El mismo motivo con colores fijos, para la tarjeta de redes: un grupo que
// ocupa el rectángulo (x, y, ancho, alto) sin deformarse.
export function grupoTarjeta(t, { x, y, ancho, alto }) {
  const { caja } = t;
  const escala = Math.min(ancho / caja.ancho, alto / caja.alto);
  const dx = x + (ancho - caja.ancho * escala) / 2;
  const dy = y + (alto - caja.alto * escala) / 2;
  const celdas = t.celdas
    .map((c) => {
      const relleno = c.doc.corpus === "fiscal" ? "url(#punteado-tarjeta)" : PALETA[c.doc.corpus];
      return `<rect x="${c.x - caja.x}" y="${c.y - caja.y}" width="${c.lado}" height="${c.lado}" fill="${relleno}"/>`;
    })
    .join("");
  return `<defs>${punteado("punteado-tarjeta", `fill="${PALETA.fiscal}"`, 'fill="#000000" fill-opacity="0.35"')}</defs><g transform="translate(${dx.toFixed(1)} ${dy.toFixed(1)}) scale(${escala.toFixed(3)})" shape-rendering="crispEdges">${celdas}</g>`;
}
