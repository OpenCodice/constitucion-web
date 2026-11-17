// Las reformas de cada artículo de un documento, de las notas de reforma de su
// texto vigente (metadata/reformas.json: fecha → claves de artículo) y de su
// índice (articulos.json): la cuadrícula de sus artículos, más oscura según
// cuántas reformas anota cada uno, y la línea de vida de los artículos que tocó
// un cambio, con su reforma resaltada.
//
// Solo se cuenta lo que anota el texto: un artículo sin notas no se supone
// reformado, ni uno reformado se supone sin otras reformas.

import { esc, numero, plural, lista } from "./comun.mjs";

// Las fechas de 1917 de la Constitución son su publicación original (febrero
// de 1917), no reformas.
const ANTES_DE_REFORMAS = "1918-01-01";

// Filas de la línea de vida en la página de un cambio; una reforma grande toca
// cientos de artículos y el resto se nombra.
export const FILAS_VIDA = 30;

// Cortes de la cuadrícula: 0, 1–2, 3–5, 6–10, 11–20 y más de 20 reformas.
const NIVELES = [0, 2, 5, 10, 20];
export function nivel(n) {
  const i = NIVELES.findIndex((x) => n <= x);
  return i === -1 ? NIVELES.length : i;
}
const ETIQUETAS_NIVEL = ["0", "1–2", "3–5", "6–10", "11–20", "más de 20"];

// «Artículo 10 Bis.» → «10 Bis»; sin índice, la clave.
function corta(a) {
  const e = (a.etiqueta ?? "").replace(/^Art[íi]culo\s+/i, "").replace(/[.\s]+$/, "");
  return e || a.clave;
}

// `reformas`: [{ fecha, claves }] de historial.mjs; `indice`: [{ clave, etiqueta, numero }].
// null si el documento no tiene reformas.json o no anota ninguna reforma.
export function vidaDocumento(reformas, indice) {
  if (!reformas?.length) return null;
  const porArticulo = new Map();
  let omitidas = 0;
  for (const { fecha, claves } of reformas) {
    if (fecha < ANTES_DE_REFORMAS) {
      omitidas++;
      continue;
    }
    for (const k of claves ?? []) {
      if (!porArticulo.has(k)) porArticulo.set(k, []);
      porArticulo.get(k).push(fecha);
    }
  }
  if (!porArticulo.size) return null;
  for (const fs of porArticulo.values()) fs.sort();
  const base = indice?.length ? indice : [...porArticulo.keys()].sort().map((clave) => ({ clave }));
  const articulos = base.map((a) => ({ clave: a.clave, etiqueta: corta(a), fechas: porArticulo.get(a.clave) ?? [] }));
  const fechas = [...porArticulo.values()].flat().sort();
  return { articulos, porArticulo, omitidas, desde: fechas[0], hasta: fechas.at(-1), conIndice: Boolean(indice?.length) };
}

// ------------------------------------------------------------------ cuadrícula

// Cada artículo del índice es un cuadro; `resaltar`, las claves con borde.
export function htmlCuadricula(vida, { nombre = "el documento", resaltar = new Set() } = {}) {
  const n = vida.articulos.length;
  const C = n <= 170 ? 17 : n <= 500 ? 25 : 30;
  const S = 30;
  const G = 3;
  const celdas = vida.articulos.map((a, i) => {
    const k = a.fechas.length;
    const c = i % C;
    const r = Math.floor(i / C);
    const x = c * (S + G);
    const y = r * (S + G);
    const texto = a.etiqueta.length <= 5 ? `<text x="${x + S / 2}" y="${y + S / 2 + 3.5}" text-anchor="middle">${esc(a.etiqueta)}</text>` : "";
    return `<g class="art-c n${nivel(k)}${resaltar.has(a.clave) ? " esta" : ""}"><rect x="${x}" y="${y}" width="${S}" height="${S}" rx="2"/>${texto}<title>Artículo ${esc(a.etiqueta)}: ${plural(k, "reforma", "reformas")}</title></g>`;
  });
  const filas = Math.ceil(n / C);
  const svg = `<svg class="cuadricula" viewBox="-3 -3 ${C * (S + G) + 3} ${filas * (S + G) + 3}" role="img" aria-label="${esc(
    `Los ${numero(n)} artículos de ${nombre}, por número de reformas`,
  )}">${celdas.join("")}</svg>`;
  const borde = resaltar.size ? ' <span class="cuadro esta"></span> esta reforma' : "";
  const leyenda = `<p class="leyenda-m">${ETIQUETAS_NIVEL.map((t, i) => `<span class="cuadro n${i}"></span> ${t}`).join(" ")}${borde}</p>`;
  return `<div class="cuadricula-c">${svg}</div>\n${leyenda}`;
}

// Los más reformados y cuántos nunca: el texto debajo de la cuadrícula.
export function resumenVida(vida) {
  const orden = [...vida.articulos].filter((a) => a.fechas.length).sort((a, b) => b.fechas.length - a.fechas.length);
  const mas = orden.slice(0, 3).map((a) => `${esc(a.etiqueta)} (${numero(a.fechas.length)})`);
  const nunca = vida.articulos.filter((a) => !a.fechas.length).length;
  const partes = [];
  if (mas.length) partes.push(`${mas.length === 1 ? "El más reformado" : "Los más reformados"}: ${lista(mas)}.`);
  partes.push(
    nunca
      ? `${plural(nunca, "artículo no anota", "artículos no anotan")} ninguna reforma.`
      : "Todos sus artículos anotan al menos una reforma.",
  );
  return partes.join(" ");
}

// ------------------------------------------------------------------ línea de vida

const año = (f) => Number(f.slice(0, 4)) + (Number(f.slice(5, 7)) - 1) / 12 + (Number(f.slice(8, 10)) - 1) / 365;

// Una fila por artículo con una marca por reforma; las de `actuales` (las
// fechas de publicación del cambio) resaltadas.
export function htmlLineaVida(vida, claves, actuales, { etiquetas = {} } = {}) {
  const filasArt = claves.slice(0, FILAS_VIDA).map((k) => ({
    clave: k,
    etiqueta: vida.articulos.find((a) => a.clave === k)?.etiqueta ?? etiquetas[k] ?? k,
    fechas: vida.porArticulo.get(k) ?? [],
  }));
  if (!filasArt.length) return "";
  const todas = [vida.desde, vida.hasta, ...actuales].filter(Boolean).sort();
  const A0 = Math.floor(año(todas[0]));
  const A1 = Math.floor(año(todas.at(-1))) + 1;
  const W = 1000;
  const X0 = 64;
  const X1 = W - 40;
  const x = (f) => X0 + ((X1 - X0) * (año(f) - A0)) / Math.max(1, A1 - A0);
  const H = 30;
  const actual = new Set(actuales);
  const filas = filasArt.map((a, i) => {
    const y = 18 + i * H;
    const marcas = a.fechas
      .map(
        (f) =>
          `<line x1="${x(f).toFixed(1)}" x2="${x(f).toFixed(1)}" y1="${y - 9}" y2="${y + 9}" class="${actual.has(f) ? "esta" : "otra"}"><title>${esc(
            `Artículo ${a.etiqueta}: ${f}`,
          )}</title></line>`,
      )
      .join("");
    return `<text x="0" y="${y + 4}" class="art">${esc(a.etiqueta.length > 8 ? `${a.etiqueta.slice(0, 7)}…` : a.etiqueta)}</text><line x1="${X0}" x2="${X1}" y1="${y}" y2="${y}" class="base"/>${marcas}<text x="${W}" y="${y + 4}" text-anchor="end" class="n">${numero(a.fechas.length)}</text>`;
  });
  const span = A1 - A0;
  const paso = span > 60 ? 20 : span > 30 ? 10 : span > 12 ? 5 : span > 5 ? 2 : 1;
  const yEje = 18 + filasArt.length * H;
  const marcasEje = [];
  for (let a = Math.ceil(A0 / paso) * paso; a <= A1; a += paso) {
    marcasEje.push(`<text x="${x(`${a}-01-01`).toFixed(1)}" y="${yEje}" text-anchor="middle" class="dec">${a}</text>`);
  }
  const nombres = filasArt.map((a) => a.etiqueta);
  return `<div class="vida-c"><svg class="vida" viewBox="0 0 ${W} ${yEje + 6}" role="img" aria-label="${esc(
    `Fechas de reforma de ${nombres.length === 1 ? "el artículo" : "los artículos"} ${lista(nombres)}, de ${A0} a ${A1}`,
  )}">${filas.join("")}${marcasEje.join("")}</svg></div>`;
}

export const ESTILO_VIDA = `
.cuadricula-c, .vida-c { overflow-x: auto; margin: 0 0 0.6rem; }
.cuadricula { display: block; width: 100%; min-width: 26rem; height: auto; }
.cuadricula text { font-size: 9.5px; pointer-events: none; font-variant-numeric: tabular-nums; fill: var(--tenue); }
.art-c rect { fill: var(--fondo); }
.art-c.n0 rect { stroke: var(--linea); stroke-width: 1; }
.n1 rect { fill: color-mix(in srgb, var(--texto) 12%, var(--fondo)); }
.n2 rect { fill: color-mix(in srgb, var(--texto) 28%, var(--fondo)); }
.n3 rect { fill: color-mix(in srgb, var(--texto) 48%, var(--fondo)); }
.n4 rect { fill: color-mix(in srgb, var(--texto) 70%, var(--fondo)); }
.n5 rect { fill: var(--texto); }
.n3 text, .n4 text, .n5 text { fill: var(--fondo); }
.art-c.esta rect { stroke: var(--puesto); stroke-width: 3; }
.leyenda-m { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3em 0.6em; font-size: 0.78em; color: var(--tenue); }
.cuadro { display: inline-block; width: 0.9em; height: 0.9em; border-radius: 2px; vertical-align: -0.1em; }
.cuadro.n0 { border: 1px solid var(--linea); }
.cuadro.n1 { background: color-mix(in srgb, var(--texto) 12%, var(--fondo)); }
.cuadro.n2 { background: color-mix(in srgb, var(--texto) 28%, var(--fondo)); }
.cuadro.n3 { background: color-mix(in srgb, var(--texto) 48%, var(--fondo)); }
.cuadro.n4 { background: color-mix(in srgb, var(--texto) 70%, var(--fondo)); }
.cuadro.n5 { background: var(--texto); }
.cuadro.esta { border: 2.5px solid var(--puesto); }
.grupo-vida { margin: 2rem 0 0.6rem; font-size: 0.9em; font-weight: 600; }
.vida { display: block; width: 100%; min-width: 30rem; height: auto; }
.vida .art { font-size: 13px; font-weight: 600; fill: var(--texto); }
.vida .base { stroke: var(--linea); stroke-width: 1; }
.vida .otra { stroke: var(--tenue); stroke-width: 1.6; }
.vida .esta { stroke: var(--puesto); stroke-width: 3.5; }
.vida .n, .vida .dec { font-size: 12px; fill: var(--tenue); font-variant-numeric: tabular-nums; }
`;
