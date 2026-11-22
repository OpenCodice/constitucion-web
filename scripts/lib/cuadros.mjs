// Figuras de cuadros que comparten el inicio y la bitácora. Todo cuadro es una
// unidad contable (un artículo, un legislador); son SVG que toman el color de
// las variables de estilo.css, así que cambian con el tema.

import { esc, numero, plural } from "./comun.mjs";

const PASOS = 7;

// Raíz cuadrada: lo que se cuenta se concentra en pocas unidades (un artículo
// con 82 reformas, la mayoría con menos de 10).
export const nivel = (valor, max) =>
  valor > 0 && max > 0 ? Math.max(1, Math.min(PASOS, Math.ceil(Math.sqrt(valor / max) * PASOS))) : 0;

// Una tira de cuadros iguales, uno por unidad, con la clase de cada uno.
export function tira(clases, columnas, nombre, hueco = 2) {
  const lado = 10;
  const paso = lado + hueco;
  const filas = Math.ceil(clases.length / columnas);
  const cuadros = clases
    .map((c, i) => `<rect x="${(i % columnas) * paso}" y="${Math.floor(i / columnas) * paso}" width="${lado}" height="${lado}" rx="${hueco}" class="${c}"/>`)
    .join("");
  return `<svg class="cuadros" viewBox="0 0 ${columnas * paso - hueco} ${filas * paso - hueco}" role="img" aria-label="${esc(nombre)}">${cuadros}</svg>`;
}

// Las 32 entidades como teselas iguales, de noroeste a sureste: [columna, fila, sigla].
const TESELAS = {
  "baja-california": [0, 0, "BC"], sonora: [1, 0, "SON"], chihuahua: [2, 0, "CHIH"], coahuila: [3, 0, "COAH"], "nuevo-leon": [4, 0, "NL"], tamaulipas: [5, 0, "TAM"],
  "baja-california-sur": [0, 1, "BCS"], sinaloa: [1, 1, "SIN"], durango: [2, 1, "DGO"], zacatecas: [3, 1, "ZAC"], "san-luis-potosi": [4, 1, "SLP"],
  nayarit: [1, 2, "NAY"], jalisco: [2, 2, "JAL"], aguascalientes: [3, 2, "AGS"], guanajuato: [4, 2, "GTO"], queretaro: [5, 2, "QRO"], hidalgo: [6, 2, "HGO"],
  colima: [2, 3, "COL"], michoacan: [3, 3, "MICH"], edomex: [4, 3, "MEX"], cdmx: [5, 3, "CDMX"], tlaxcala: [6, 3, "TLAX"], veracruz: [7, 3, "VER"], yucatan: [10, 3, "YUC"],
  guerrero: [4, 4, "GRO"], morelos: [5, 4, "MOR"], puebla: [6, 4, "PUE"], tabasco: [8, 4, "TAB"], campeche: [9, 4, "CAMP"], "quintana-roo": [10, 4, "QROO"],
  oaxaca: [6, 5, "OAX"], chiapas: [7, 5, "CHIS"],
};

export const conLeyes = (e) => (e.leyes ?? []).some((l) => l.estado === "incluida");

export function mapa(estados) {
  const publicados = estados.filter((e) => e.articulos != null && TESELAS[e.clave]);
  if (!publicados.length) return "";
  const max = Math.max(...publicados.map((e) => e.articulos));
  const lado = 58;
  const paso = 62;
  const teselas = Object.entries(TESELAS)
    .map(([clave, [col, fila, sigla]]) => {
      const e = publicados.find((x) => x.clave === clave);
      const n = e ? nivel(e.articulos, max) : 0;
      const x = col * paso;
      const y = fila * paso;
      const titulo = e ? `<title>${esc(e.nombre)}: ${numero(e.articulos)} artículos</title>` : "";
      return `<rect x="${x}" y="${y}" width="${lado}" height="${lado}" rx="3" class="e${n}">${titulo}</rect>${
        n ? `<text x="${x + lado / 2}" y="${y + lado / 2 + 4}" font-size="11" text-anchor="middle" class="s${n}">${sigla}</text>` : ""
      }${e && conLeyes(e) ? `<rect x="${x - 1.5}" y="${y - 1.5}" width="${lado + 3}" height="${lado + 3}" rx="4" class="marca-cuadro"/>` : ""}`;
    })
    .join("");
  return `<svg class="cuadros" viewBox="-3 -3 ${11 * paso + 2} ${6 * paso + 2}" role="img" aria-label="Las 32 entidades como cuadros, teñidos por el número de artículos de su constitución.">${teselas}</svg>`;
}

const SENTIDOS = [
  ["a_favor", "v-favor", "a favor", "a favor"],
  ["en_contra", "v-contra", "en contra", "en contra"],
  ["abstenciones", "v-abstencion", "abstención", "abstenciones"],
  ["ausentes", "e0", "ausente", "ausentes"],
];

const frase = (c) =>
  SENTIDOS.filter(([k]) => c[k])
    .map(([k, , uno, varios]) => `${numero(c[k])} ${c[k] === 1 ? uno : varios}`)
    .join(", ");

export const leyendaVotos = `<p class="leyenda-votos"><span><i class="v-favor"></i>A favor</span><span><i class="v-contra"></i>En contra</span><span><i class="v-abstencion"></i>Abstención</span><span><i class="e0"></i>Ausente</span></p>`;

// Una votación nominal: la cifra, un cuadro por legislador en el orden de los
// sentidos del voto y, al lado, cada grupo con su barra y sus cuentas. `c` y
// cada grupo traen a_favor, en_contra, abstenciones y ausentes.
export function htmlVotacion({ titulo, c, grupos = [], enlace, quienes }) {
  const clases = SENTIDOS.flatMap(([k, clase]) => Array(c[k] ?? 0).fill(clase));
  const presentes = (c.a_favor ?? 0) + (c.en_contra ?? 0) + (c.abstenciones ?? 0);
  const resto = [
    c.abstenciones ? plural(c.abstenciones, "abstención", "abstenciones") : "",
    c.ausentes ? plural(c.ausentes, "ausente", "ausentes") : "",
  ].filter(Boolean);
  const porcentaje = presentes ? `Es el ${((c.a_favor / presentes) * 100).toFixed(1)} % de los ${numero(presentes)} presentes.` : "";
  const nota = `${resto.length ? `${resto.join(" y ").replace(/^./, (l) => l.toUpperCase())}. ` : ""}${porcentaje}`;
  const max = Math.max(...grupos.map((g) => g.a_favor + g.en_contra + g.abstenciones + g.ausentes), 1);
  const filas = [...grupos]
    .sort((a, b) => b.a_favor - a.a_favor || a.en_contra - b.en_contra)
    .map((g) => {
      const total = g.a_favor + g.en_contra + g.abstenciones + g.ausentes;
      const segmentos = SENTIDOS.map(([k, clase]) => (g[k] ? `<i class="${clase}" style="flex:${g[k]}"></i>` : "")).join("");
      return `<div class="grupo-v"><span class="g-nombre">${esc(g.grupo)}</span><span class="g-barra" style="width:${Math.max(2, Math.round((total / max) * 100))}%">${segmentos}</span><span></span><span class="g-texto">${frase(g)}</span></div>`;
    })
    .join("\n");
  return `<section class="votacion ancha">
<div class="v-cuadros">
<h3>${titulo}</h3>
<p class="cifra-v">${numero(c.a_favor)} <span>a favor</span> · ${numero(c.en_contra)} <span>en contra</span></p>
${nota ? `<p class="nota">${nota}</p>` : ""}
${clases.length ? tira(clases, 50, frase(c), 3) : ""}
${enlace ? `<p><a class="fuerte" href="${esc(enlace)}">Ver el voto de cada ${quienes} →</a></p>` : ""}
</div>
${filas ? `<div class="v-grupos"><p class="nota">Por grupo parlamentario</p>\n${filas}</div>` : ""}
</section>`;
}

export const ESTILO_CUADROS = `
.v-favor { fill: var(--a-favor); background: var(--a-favor); }
.v-contra { fill: var(--en-contra); background: var(--en-contra); }
.v-abstencion { fill: var(--abstencion); background: var(--abstencion); }
i.e0 { background: var(--vacia); }
.leyenda-votos { display: flex; flex-wrap: wrap; gap: 0.35rem 1.25rem; font-size: 0.833em; color: var(--tenue); }
.leyenda-votos span { display: inline-flex; align-items: center; gap: 0.5rem; }
.leyenda-votos i { width: 0.75rem; height: 0.75rem; border-radius: 2px; }
.votacion { display: flex; flex-wrap: wrap; gap: 2rem 3.5rem; align-items: flex-start; margin-top: 2.5rem; }
.v-cuadros { flex: 1 1 26rem; min-width: 0; }
.v-grupos { flex: 1 1 22rem; min-width: 0; }
.votacion h3 { margin: 0 0 0.875rem; font-size: 1.11em; font-weight: 600; letter-spacing: -0.01em; }
.cifra-v { margin: 0 0 0.75rem; font-family: var(--mono); font-size: 1.667em; line-height: 1.15; letter-spacing: -0.02em; }
.cifra-v span { color: var(--tenue); }
.votacion .nota { margin: 0 0 0.875rem; }
.votacion .cuadros { margin-bottom: 0.875rem; }
.fuerte { font-weight: 500; }
.grupo-v { display: grid; grid-template-columns: 6rem 1fr; gap: 0.125rem 0.875rem; align-items: center; padding: 0.5rem 0; border-top: 1px solid var(--linea); }
.g-nombre { font-size: 0.89em; font-weight: 500; }
.g-barra { display: flex; height: 0.875rem; min-width: 6px; border-radius: 3px; overflow: hidden; background: var(--vacia); }
.g-texto { font-size: 0.78em; color: var(--tenue); }
.cronologia { margin: 1.5rem 0 0; border-bottom: 1px solid var(--linea); }
.cronologia > div { display: grid; grid-template-columns: 8.25rem 1fr; gap: 0.25rem 1.25rem; padding: 0.875rem 0; border-top: 1px solid var(--linea); }
.cronologia time { font-family: var(--mono); font-size: 0.78em; line-height: 2; color: var(--tenue); }
.cronologia strong { font-weight: 600; }
@media (max-width: 30rem) { .cronologia > div { grid-template-columns: 1fr; gap: 0; } }
`;
