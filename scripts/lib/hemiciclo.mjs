// Hemiciclos: un asiento por legislador, en SVG generado aquí. Sin JavaScript
// ya funcionan (cada asiento es un enlace a su página, con su <title>);
// public/hemiciclo.js agrega el tooltip, los filtros de la leyenda, la
// búsqueda y la navegación con teclado.
//
// La disposición es esquemática: filas concéntricas en un semicírculo, cada
// grupo parlamentario en un sector contiguo (siempre en el mismo orden), no
// los asientos físicos de la cámara.

import { ESTADOS, esc, numero, plural, lista } from "./comun.mjs";
import { urlLegislador } from "./congreso.mjs";

// Colores de los partidos, en un solo lugar. Salen del color principal del
// logotipo de cada partido (Morena: guinda; PT: rojo; PVEM: verde; PRD:
// amarillo; MC: naranja; PRI: el verde de su emblema tricolor; PAN: azul), con
// el tono ajustado para que se distingan entre sí y tengan contraste de 3:1 o
// más con el fondo (en modo oscuro, una versión más clara). Morena y PT, ambos
// rojos, se separan por luminosidad (guinda oscuro frente a rojo vivo); PRI y
// PVEM, ambos verdes, por tono y luminosidad (verde bandera oscuro frente a
// verde hoja claro) y porque el orden de los sectores no los pone juntos. El
// amarillo del PRD no llega a 3:1 sobre blanco: lleva borde.
// `sigla` es la etiqueta del sector; `nombres`, cómo lo escriben las fuentes.
export const PARTIDOS = [
  { clave: "pt", sigla: "PT", nombre: "Partido del Trabajo", claro: "#D52B1E", oscuro: "#FF5A4A", nombres: ["PT"] },
  { clave: "morena", sigla: "Morena", nombre: "Morena", claro: "#8A1538", oscuro: "#C0466E", nombres: ["MORENA"] },
  { clave: "pvem", sigla: "PVEM", nombre: "Partido Verde Ecologista de México", claro: "#4C9A2A", oscuro: "#7BC94E", nombres: ["PVEM"] },
  { clave: "prd", sigla: "PRD", nombre: "Partido de la Revolución Democrática", claro: "#E3B505", oscuro: "#F2C230", borde: "#8A6D00", nombres: ["PRD"] },
  { clave: "pes", sigla: "PES", nombre: "Partido Encuentro Social", claro: "#5B2C83", oscuro: "#A77BD0", nombres: ["PES"] },
  { clave: "mc", sigla: "MC", nombre: "Movimiento Ciudadano", claro: "#E06A00", oscuro: "#FF9A3C", nombres: ["MC"] },
  { clave: "pri", sigla: "PRI", nombre: "Partido Revolucionario Institucional", claro: "#006847", oscuro: "#2FA86F", nombres: ["PRI"] },
  { clave: "pan", sigla: "PAN", nombre: "Partido Acción Nacional", claro: "#0047AB", oscuro: "#4D8BF0", nombres: ["PAN"] },
];
// Independientes y legisladores sin grupo («Ind.», «Sin Partido», «SG»).
export const SIN_GRUPO = { clave: "sg", sigla: "Sin grupo", nombre: "Sin grupo parlamentario", claro: "#8A8A8A", oscuro: "#8A8A8A", nombres: [] };
const GRUPOS = [...PARTIDOS, SIN_GRUPO];
const POR_CLAVE = new Map(GRUPOS.map((g, i) => [g.clave, { ...g, orden: i }]));
const POR_NOMBRE = new Map(PARTIDOS.flatMap((g) => g.nombres.map((n) => [n, g.clave])));

// El sentido del voto: verde y rojo con luminosidad distinta (se distinguen
// también sin ver el color), ámbar, violeta y, para el ausente, un asiento vacío.
export const SENTIDOS = [
  { clave: "yes", nombre: "A favor", corto: "a favor", claro: "#17803D", oscuro: "#4CC764" },
  { clave: "no", nombre: "En contra", corto: "en contra", claro: "#D93A2B", oscuro: "#F0564A" },
  { clave: "abstain", nombre: "Abstención", corto: "abstención", claro: "#B7791F", oscuro: "#D9A33A" },
  { clave: "not voting", nombre: "Presente sin votar", corto: "presente sin votar", claro: "#7057C8", oscuro: "#A68CF0" },
  { clave: "absent", nombre: "Ausente", corto: "ausente", claro: "#B4B4B4", oscuro: "#5A5A5A" },
];
const SENTIDO = new Map(SENTIDOS.map((s, i) => [s.clave, { ...s, orden: i, css: `v${i}` }]));
const EMITIDOS = new Set(["yes", "no", "abstain"]);

// Clave del grupo: por el partido ligado (`partido-morena` → `morena`) o por
// el nombre que da la fuente; lo demás es sin grupo.
export function claveGrupo(id, nombreFuente) {
  const k = id?.replace(/^partido-/, "");
  if (k && POR_CLAVE.has(k)) return k;
  return POR_NOMBRE.get(String(nombreFuente ?? "").trim().toUpperCase()) ?? "sg";
}
export const grupo = (clave) => POR_CLAVE.get(clave) ?? POR_CLAVE.get("sg");
export const sentido = (clave) => SENTIDO.get(clave) ?? { clave, nombre: clave, corto: clave, orden: SENTIDOS.length, css: "v9" };

const NOMBRES_ESTADOS = Object.fromEntries(ESTADOS);

// «Puebla, distrito 3 (Zacatlán)», «Jalisco, circunscripción 1».
export function lugar(x) {
  const a = x?.area ?? {};
  const ent = a.entidad ? NOMBRES_ESTADOS[a.entidad] ?? a.entidad : null;
  const partes = [];
  if (ent) partes.push(ent);
  if (a.distrito != null) partes.push(`distrito ${a.distrito}${a.cabecera ? ` (${a.cabecera})` : ""}`);
  if (a.circunscripcion != null) partes.push(`circunscripción ${a.circunscripcion}`);
  return partes.join(", ");
}

// ------------------------------------------------------------------ geometría

// Proporción del radio interior respecto al exterior.
const HUECO = 0.4;

// Posiciones de n asientos en un semicírculo de radio 1 con centro en el
// origen (y hacia arriba), en filas concéntricas: las mínimas filas en que
// caben, repartiendo los asientos por fila en proporción a su radio. Se
// devuelven ordenadas por ángulo, de izquierda a derecha (en el mismo ángulo,
// de dentro hacia fuera), para que asignarlas en orden dé sectores
// contiguos. `r` es el radio de cada asiento.
export function asientos(n) {
  if (n <= 0) return [];
  let filas = 1;
  let paso;
  let radios;
  for (;; filas++) {
    paso = filas === 1 ? 1 - HUECO : (1 - HUECO) / (filas - 1);
    radios = Array.from({ length: filas }, (_, i) => (filas === 1 ? (1 + HUECO) / 2 : HUECO + i * paso));
    const cabe = radios.reduce((s, r) => s + Math.floor((Math.PI * r) / paso) + 1, 0);
    if (cabe >= n) break;
  }
  // Por resto mayor, sin pasar de lo que cabe en cada fila.
  const capacidad = radios.map((r) => Math.floor((Math.PI * r) / paso) + 1);
  const suma = radios.reduce((s, r) => s + r, 0);
  const exacto = radios.map((r) => (n * r) / suma);
  const porFila = exacto.map((x, i) => Math.min(Math.floor(x), capacidad[i]));
  let faltan = n - porFila.reduce((s, x) => s + x, 0);
  const orden = exacto.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  while (faltan > 0) {
    for (const [, i] of orden) {
      if (faltan > 0 && porFila[i] < capacidad[i]) {
        porFila[i]++;
        faltan--;
      }
    }
  }
  const r = Math.min(paso, filas === 1 ? (Math.PI * radios[0]) / Math.max(porFila[0] - 1, 1) : paso) * 0.42;
  const xs = [];
  porFila.forEach((k, fila) => {
    for (let j = 0; j < k; j++) {
      const angulo = k === 1 ? Math.PI / 2 : Math.PI * (1 - j / (k - 1));
      xs.push({ x: radios[fila] * Math.cos(angulo), y: radios[fila] * Math.sin(angulo), angulo, fila, r });
    }
  });
  return xs.sort((a, b) => b.angulo - a.angulo || a.fila - b.fila);
}

// ------------------------------------------------------------------ quién va en cada asiento

// Orden alfabético por apellido, como las listas oficiales.
function clavePersona(m, id) {
  const p = m.personas.get(id);
  return `${p?.family_name ?? ""} ${p?.given_name ?? p?.name ?? id}`;
}

// Mayoría de cada grupo entre los votos emitidos (a favor, en contra,
// abstención), contando los no atribuidos; sin mayoría única, null.
function mayorias(xs) {
  const cuentas = new Map();
  for (const x of xs) {
    if (x.grupo === "sg" || !EMITIDOS.has(x.sentido)) continue;
    if (!cuentas.has(x.grupo)) cuentas.set(x.grupo, new Map());
    const c = cuentas.get(x.grupo);
    c.set(x.sentido, (c.get(x.sentido) ?? 0) + 1);
  }
  const r = new Map();
  for (const [g, c] of cuentas) {
    const orden = [...c].sort((a, b) => b[1] - a[1]);
    const total = orden.reduce((s, [, n]) => s + n, 0);
    if (total >= 2 && (orden.length === 1 || orden[0][1] > orden[1][1])) r.set(g, orden[0][0]);
  }
  return r;
}

// Un asiento por voto con nombre y uno por cada voto que la fuente cuenta sin
// atribuir (sin nombre, en su grupo y sentido). Por grupo, sentido y apellido.
export function asientosVotacion(m, v) {
  const xs = (v.votes ?? []).map((x) => {
    const mandato = x.mandato_id ? m.mandatos.get(x.mandato_id) : null;
    return {
      persona: x.voter_id,
      nombre: m.personas.get(x.voter_id)?.name ?? x.voter_id,
      grupo: claveGrupo(x.group_id, x.grupo_fuente),
      grupoFuente: x.grupo_fuente ?? null,
      sentido: x.option,
      lugar: lugar(mandato),
      orden: clavePersona(m, x.voter_id),
    };
  });
  for (const f of v.votos_faltantes ?? []) {
    for (let i = 0; i < f.value; i++) {
      xs.push({ persona: null, nombre: null, grupo: claveGrupo(null, f.grupo), grupoFuente: f.grupo ?? null, sentido: f.option, lugar: "", orden: "￿" });
    }
  }
  const may = mayorias(xs);
  for (const x of xs) {
    const g = may.get(x.grupo);
    x.mayoria = g ?? null;
    x.disidente = Boolean(g && EMITIDOS.has(x.sentido) && x.sentido !== g);
  }
  return xs.sort(
    (a, b) =>
      grupo(a.grupo).orden - grupo(b.grupo).orden ||
      sentido(a.sentido).orden - sentido(b.sentido).orden ||
      a.orden.localeCompare(b.orden, "es"),
  );
}

// Integrantes esperados de cada cámara (arts. 52 y 56 de la Constitución).
export const INTEGRANTES = { "camara-de-diputados": 500, senado: 128 };

// Quién está en funciones hoy en una cámara, en su legislatura más reciente:
// cada mandato cuyo estatus en el SIL es «Activo». El SIL lo marca en quien
// ocupa el lugar hoy: el propietario o, si este pidió licencia, se separó o
// murió, el suplente que entró. Se comprueba que ninguna fórmula cuente dos
// veces (propietario y suplente a la vez).
export function composicion(m, org) {
  const todos = [...m.mandatos.values()].filter((x) => x.organization_id === org);
  const legislatura = todos.map((x) => x.legislative_period_id).filter(Boolean).sort().at(-1) ?? null;
  const deLegislatura = todos.filter((x) => x.legislative_period_id === legislatura);
  const enFunciones = (x) => /^activo/i.test(x.estatus ?? "");
  const miembros = deLegislatura.filter(enFunciones);
  const ids = new Set(miembros.map((x) => x.id));
  const formulasDobles = miembros.filter((x) => x.formula_id && ids.has(x.formula_id)).length;
  const fuera = new Map();
  for (const x of deLegislatura.filter((x) => !enFunciones(x))) {
    const e = (x.estatus ?? "").replace(/\(a\)$/, "").trim() || "sin estatus";
    fuera.set(e, (fuera.get(e) ?? 0) + 1);
  }
  const consultado = deLegislatura.flatMap((x) => (x.sources ?? []).map((s) => s.consultado)).filter(Boolean).sort().at(-1) ?? null;
  const asientos = miembros
    .map((x) => ({
      persona: x.person_id,
      nombre: m.personas.get(x.person_id)?.name ?? x.person_id,
      grupo: claveGrupo(x.on_behalf_of_id, x.partido_fuente),
      grupoFuente: x.partido_fuente ?? null,
      lugar: lugar(x),
      calidad: x.calidad ?? null,
      orden: clavePersona(m, x.person_id),
    }))
    .sort((a, b) => grupo(a.grupo).orden - grupo(b.grupo).orden || a.orden.localeCompare(b.orden, "es"));
  return {
    organizacion: org,
    legislatura,
    asientos,
    total: miembros.length,
    esperado: INTEGRANTES[org] ?? null,
    suplentes: miembros.filter((x) => x.calidad === "suplente").length,
    fuera: [...fuera].sort((a, b) => b[1] - a[1]),
    mandatos: deLegislatura.length,
    formulasDobles,
    consultado,
  };
}

// ------------------------------------------------------------------ SVG

// Lienzo: el semicírculo de radio R con centro en (CX, CY); alrededor, la
// banda de color de cada grupo y su sigla.
const R = 180;
const CX = 230;
const CY = 214;
const ANCHO = 460;
const ALTO = 222;
const f1 = (x) => (Math.round(x * 10) / 10).toString();
const punto = (s) => [CX + s.x * R, CY - s.y * R];

function arco(r, a0, a1) {
  const [x0, y0] = [CX + r * Math.cos(a0), CY - r * Math.sin(a0)];
  const [x1, y1] = [CX + r * Math.cos(a1), CY - r * Math.sin(a1)];
  return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 0 1 ${f1(x1)} ${f1(y1)}`;
}

// Sectores contiguos de cada grupo: de qué ángulo a qué ángulo va.
function sectores(xs, pos) {
  const r = [];
  xs.forEach((x, i) => {
    const ultimo = r.at(-1);
    if (ultimo?.grupo === x.grupo) {
      ultimo.fin = pos[i].angulo;
      ultimo.n++;
    } else r.push({ grupo: x.grupo, inicio: pos[i].angulo, fin: pos[i].angulo, n: 1 });
  });
  // La frontera entre dos sectores, a la mitad.
  r.forEach((s, i) => {
    s.a0 = i === 0 ? Math.PI : (r[i - 1].fin + s.inicio) / 2;
    s.a1 = i === r.length - 1 ? 0 : (s.fin + r[i + 1].inicio) / 2;
  });
  return r;
}

function bandas(secs, { etiquetas = true } = {}) {
  const rb = R + 8;
  return secs
    .map((s) => {
      const hueco = s.a0 - s.a1 > 0.04 ? 0.006 : 0;
      const g = grupo(s.grupo);
      const banda = `<path class="banda g-${g.clave}" d="${arco(rb, s.a0 - hueco, s.a1 + hueco)}"/>`;
      if (!etiquetas || s.a0 - s.a1 < 0.12) return banda;
      const a = (s.a0 + s.a1) / 2;
      const re = rb + 9;
      const x = CX + re * Math.cos(a);
      const y = CY - re * Math.sin(a);
      const ancla = Math.cos(a) > 0.25 ? "start" : Math.cos(a) < -0.25 ? "end" : "middle";
      return `${banda}<text x="${f1(x)}" y="${f1(y + 3)}" text-anchor="${ancla}">${esc(g.sigla)}</text>`;
    })
    .join("");
}

function tituloAsiento(x, modo) {
  const g = grupo(x.grupo);
  const nombreGrupo = x.grupo === "sg" ? x.grupoFuente || g.sigla : g.sigla;
  if (!x.persona) return `Voto sin nombre (${nombreGrupo}, ${sentido(x.sentido).corto}): la fuente lo cuenta y no dice quién`;
  const partes = [x.nombre, nombreGrupo, x.lugar];
  if (modo === "votacion") partes.push(sentido(x.sentido).nombre);
  if (x.disidente) partes.push(`votó distinto a la mayoría de su grupo (${sentido(x.mayoria).corto})`);
  return partes.filter(Boolean).join(" · ");
}

// Hemiciclo con un enlace por asiento. modo: "votacion" (color del sentido,
// banda del grupo) o "composicion" (color del grupo).
export function svgHemiciclo(xs, { modo, etiqueta, centro = [], id }) {
  const pos = asientos(xs.length);
  const r = pos[0]?.r ?? 0;
  const asientosSvg = xs
    .map((x, i) => {
      const [cx, cy] = punto(pos[i]);
      const clase = modo === "votacion" ? `${sentido(x.sentido).css}${x.disidente ? " d" : ""}` : `g-${grupo(x.grupo).clave}`;
      const datos = ` data-g="${grupo(x.grupo).clave}"`;
      const circulo = `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * R)}" class="${clase}"/>`;
      const titulo = `<title>${esc(tituloAsiento(x, modo))}</title>`;
      return x.persona
        ? `<a href="${esc(urlLegislador(x.persona))}"${datos}>${circulo}${titulo}</a>`
        : `<g class="sn"${datos}>${circulo}${titulo}</g>`;
    })
    .join("\n");
  // Líneas del centro, de arriba abajo: [texto, "c1" (grande) | "c2"].
  let y = CY - 6;
  const textoCentro = centro
    .slice()
    .reverse()
    .map(([t, c]) => {
      const linea = `<text x="${CX}" y="${y}" class="${c}" text-anchor="middle">${esc(t)}</text>`;
      y -= c === "c1" ? 24 : 16;
      return linea;
    })
    .reverse()
    .join("");
  return `<svg class="hemiciclo-svg" viewBox="0 0 ${ANCHO} ${ALTO}" role="group" aria-label="${esc(etiqueta)}" data-centro="${CX} ${CY}"${id ? ` id="${esc(id)}"` : ""}>
${bandas(sectores(xs, pos))}${textoCentro}
${asientosSvg}
</svg>`;
}

// Hemiciclo pequeño, sin enlaces por asiento: un trazo por color, con cada
// asiento como un punto (trazo de longitud cero con extremo redondo), para que
// pese poco. `resaltar` (índice) marca un asiento con un anillo.
export function svgMini(xs, { modo, etiqueta, resaltar = null, atenuar = false }) {
  const pos = asientos(xs.length);
  const r = (pos[0]?.r ?? 0) * R;
  const porClase = new Map();
  xs.forEach((x, i) => {
    const clase = modo === "votacion" ? sentido(x.sentido).css : `g-${grupo(x.grupo).clave}`;
    const [cx, cy] = punto(pos[i]);
    if (!porClase.has(clase)) porClase.set(clase, []);
    porClase.get(clase).push(`M${f1(cx)} ${f1(cy)}h0`);
  });
  const trazos = [...porClase].map(([c, ds]) => `<path class="${c}" d="${ds.join("")}"/>`).join("");
  let anillo = "";
  if (resaltar != null && pos[resaltar]) {
    const [cx, cy] = punto(pos[resaltar]);
    anillo = `<circle class="anillo" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * 3)}"/><circle class="yo g-${grupo(xs[resaltar].grupo).clave}" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * 1.6)}"/>`;
  }
  return `<svg class="mini-svg${atenuar ? " atenuado" : ""}" viewBox="0 0 ${ANCHO} ${ALTO}" role="img" aria-label="${esc(etiqueta)}" style="--r:${f1(r * 2)}px">${bandas(sectores(xs, pos), { etiquetas: false })}${trazos}${anillo}</svg>`;
}

// ------------------------------------------------------------------ texto alrededor

const cuentaPor = (xs, f) => {
  const c = new Map();
  for (const x of xs) c.set(f(x), (c.get(f(x)) ?? 0) + 1);
  return c;
};

// «344 a favor, 116 en contra, 1 abstención y 38 ausentes».
export function resumenSentidos(xs) {
  const c = cuentaPor(xs, (x) => x.sentido);
  const plurales = { yes: "a favor", no: "en contra", abstain: ["abstención", "abstenciones"], "not voting": ["presente sin votar", "presentes sin votar"], absent: ["ausente", "ausentes"] };
  return lista(
    [...c]
      .sort((a, b) => sentido(a[0]).orden - sentido(b[0]).orden)
      .map(([k, n]) => {
        const p = plurales[k] ?? k;
        return Array.isArray(p) ? plural(n, p[0], p[1]) : `${numero(n)} ${p}`;
      }),
  );
}

export function resumenGrupos(xs) {
  const c = cuentaPor(xs, (x) => x.grupo);
  return lista([...c].sort((a, b) => grupo(a[0]).orden - grupo(b[0]).orden).map(([k, n]) => `${esc(grupo(k).sigla)} ${numero(n)}`));
}

const muestra = (clase) => `<svg class="mu" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" class="${clase}"/></svg>`;

// Leyenda: cada elemento filtra el hemiciclo (con JavaScript); sin él, es una
// leyenda con las cuentas.
export function leyenda(xs, { modo }) {
  const fila = (titulo, items) =>
    `<div class="ley-fila"><span class="ley-titulo">${titulo}</span><ul>${items.join("")}</ul></div>`;
  const filas = [];
  if (modo === "votacion") {
    const c = cuentaPor(xs, (x) => x.sentido);
    filas.push(
      fila(
        "Sentido",
        [...c]
          .sort((a, b) => sentido(a[0]).orden - sentido(b[0]).orden)
          .map(([k, n]) => `<li data-filtro="v:${esc(k)}">${muestra(sentido(k).css)}${esc(sentido(k).nombre)} <span class="n">${numero(n)}</span></li>`),
      ),
    );
  }
  const g = cuentaPor(xs, (x) => x.grupo);
  filas.push(
    fila(
      modo === "votacion" ? "Grupo" : "Grupo parlamentario",
      [...g]
        .sort((a, b) => grupo(a[0]).orden - grupo(b[0]).orden)
        .map(([k, n]) => `<li data-filtro="g:${esc(k)}" title="${esc(grupo(k).nombre)}">${muestra(`g-${k}`)}${esc(grupo(k).sigla)} <span class="n">${numero(n)}</span></li>`),
    ),
  );
  if (modo === "votacion") {
    const d = xs.filter((x) => x.disidente).length;
    const sn = xs.filter((x) => !x.persona).length;
    const extra = [];
    if (d) extra.push(`<li data-filtro="d:1">${muestra("mu-d")}Votó distinto a su grupo <span class="n">${numero(d)}</span></li>`);
    if (sn) extra.push(`<li data-filtro="s:1">${muestra("v9 mu-sn")}Sin nombre en la fuente <span class="n">${numero(sn)}</span></li>`);
    if (extra.length) filas.push(fila("Marcas", extra));
  }
  return `<div class="leyenda-h">${filas.join("")}</div>`;
}

// Figura completa: hemiciclo, leyenda y nota. El JS la reconoce por la clase.
export function figuraHemiciclo(xs, { modo, etiqueta, centro, nota = "", id }) {
  return `<figure class="hemiciclo" data-modo="${modo}">
${svgHemiciclo(xs, { modo, etiqueta, centro, id })}
${leyenda(xs, { modo })}
${nota ? `<figcaption>${nota}</figcaption>` : ""}
</figure>`;
}

// Quienes votaron distinto a la mayoría de su grupo, por grupo.
export function listaDisidentes(xs) {
  const ds = xs.filter((x) => x.disidente);
  if (!ds.length) return "";
  const porGrupo = new Map();
  for (const x of ds) {
    if (!porGrupo.has(x.grupo)) porGrupo.set(x.grupo, []);
    porGrupo.get(x.grupo).push(x);
  }
  const items = [...porGrupo].map(([g, ys]) => {
    const may = sentido(ys[0].mayoria).corto;
    const nombres = ys.map((x) =>
      x.persona
        ? `<a href="${esc(urlLegislador(x.persona))}">${esc(x.nombre)}</a> <span class="tenue">(${esc(sentido(x.sentido).corto)})</span>`
        : `un voto sin nombre <span class="tenue">(${esc(sentido(x.sentido).corto)})</span>`,
    );
    return `<li><strong>${esc(grupo(g).sigla)}</strong>, cuya mayoría votó ${esc(may)}: ${lista(nombres)}.</li>`;
  });
  return `<ul class="disidentes">${items.join("\n")}</ul>`;
}

// ------------------------------------------------------------------ estilo

const variables = (clave) =>
  [
    ...GRUPOS.map((g) => `--g-${g.clave}:${g[clave]}`),
    ...SENTIDOS.map((s, i) => `--v${i}:${s[clave]}`),
  ].join(";");

// CSS de los hemiciclos; va en las páginas que los usan.
export const ESTILO_HEMICICLO = `
:root{${variables("claro")}}
@media (prefers-color-scheme: dark){:root{${variables("oscuro")}}}
${GRUPOS.map((g) => `.g-${g.clave}{fill:var(--g-${g.clave});stroke:var(--g-${g.clave})}`).join("\n")}
${SENTIDOS.map((s, i) => `.v${i}{fill:var(--v${i});stroke:var(--v${i})}`).join("\n")}
.v9{fill:var(--tenue);stroke:var(--tenue)}
.hemiciclo{position:relative;margin:0 0 2rem}
.hemiciclo-svg{display:block;width:100%;height:auto;overflow:visible;-webkit-tap-highlight-color:transparent}
.hemiciclo-svg circle{stroke-width:0}
.hemiciclo-svg .v4{fill:var(--fondo);stroke:var(--tenue);stroke-width:1}
.hemiciclo-svg .d{stroke:var(--texto);stroke-width:2.2;paint-order:stroke}
.hemiciclo-svg .sn circle{fill-opacity:.35;stroke-dasharray:1.6 1.2;stroke-width:1}
.hemiciclo-svg .g-prd,.mu .g-prd{stroke:${PARTIDOS.find((p) => p.clave === "prd").borde};stroke-width:1}
.hemiciclo-svg text{font-size:11px;fill:var(--tenue)}
.hemiciclo-svg .c1{font-size:20px;font-weight:600;fill:var(--texto)}
.hemiciclo-svg .c2{font-size:12px;fill:var(--tenue)}
.banda{fill:none;stroke-width:5}
.hemiciclo-svg a,.hemiciclo-svg .sn{cursor:pointer;outline:none}
.hemiciclo-svg a:hover circle,.hemiciclo-svg :focus-visible circle,.hemiciclo-svg .activo circle{stroke:var(--texto);stroke-width:2.5}
.hemiciclo-svg :focus-visible circle{stroke-width:3}
.hemiciclo.filtrado .hemiciclo-svg>:is(a,.sn):not(.sel) circle{opacity:.12}
.hemiciclo.filtrado .banda{opacity:.35}
.leyenda-h{display:grid;gap:.35rem;margin:.6rem 0 0;font-size:.78em}
.ley-fila{display:flex;flex-wrap:wrap;align-items:baseline;gap:.2rem .9rem}
.ley-titulo{color:var(--tenue);min-width:4.5rem}
.leyenda-h ul{display:flex;flex-wrap:wrap;gap:.2rem .9rem;list-style:none;margin:0;padding:0}
.leyenda-h li{display:inline-flex;align-items:center;gap:.35em;margin:0;white-space:nowrap;border-radius:3px}
.leyenda-h .n{color:var(--tenue);font-variant-numeric:tabular-nums}
.leyenda-h li[role=button]{cursor:pointer;padding:0 .25em;margin:0 -.25em}
.leyenda-h li[role=button]:hover{background:var(--linea)}
.leyenda-h li[aria-pressed=true],.leyenda-h li[aria-pressed=true]:hover{background:var(--texto);color:var(--fondo)}
.leyenda-h li[aria-pressed=true] .n{color:var(--fondo)}
.leyenda-h li:focus-visible{outline:2px solid var(--texto);outline-offset:2px}
.mu{width:.8em;height:.8em;flex:none;overflow:visible}
.mu .v4{fill:var(--fondo);stroke:var(--tenue);stroke-width:1.2}
.mu .mu-d{fill:var(--fondo);stroke:var(--texto);stroke-width:2}
.mu .mu-sn{fill-opacity:.35;stroke-dasharray:1.6 1.2;stroke-width:1}
.hemiciclo figcaption{margin:.6rem 0 0;font-size:.75em;color:var(--tenue)}
.h-buscar{display:flex;flex-wrap:wrap;gap:.4rem .8rem;align-items:center;margin:0 0 .5rem;font-size:.8em}
.h-buscar input{font:inherit;color:inherit;background:var(--fondo);border:1px solid var(--linea);border-radius:4px;padding:.25em .5em;min-width:0;flex:1 1 12rem;max-width:20rem}
.h-buscar input:focus-visible{outline:2px solid var(--texto);outline-offset:1px}
.h-buscar button{font:inherit;color:var(--tenue);background:none;border:0;padding:0;text-decoration:underline;cursor:pointer}
.h-buscar output{color:var(--tenue)}
.h-tip{position:absolute;z-index:20;max-width:16rem;padding:.45rem .65rem;border-radius:5px;background:var(--texto);color:var(--fondo);box-shadow:0 2px 12px rgb(0 0 0/.3);font-size:.75rem;line-height:1.4;pointer-events:none}
.h-tip[hidden]{display:none}
.h-tip b{display:block;font-size:.85rem}
.h-tip .t-v{display:inline-flex;align-items:center;gap:.35em;margin-top:.2rem}
.h-tip .t-v i{display:inline-block;width:.65em;height:.65em;border-radius:50%}
.h-tip .t-d{display:block;margin-top:.2rem;font-weight:600}
.h-tip .t-ir{display:block;margin-top:.25rem;opacity:.75}
.disidentes{font-size:.85em}
.disidentes li{margin:0 0 .3em}
.minis{display:grid;grid-template-columns:repeat(auto-fill,minmax(12rem,1fr));gap:1rem 1.5rem;margin:0 0 1.75em}
.mini{margin:0;font-size:.75em;line-height:1.4;color:var(--tenue)}
.mini a{display:block;text-decoration:none;color:inherit}
.mini a:hover .mini-t,.mini a:focus-visible .mini-t{text-decoration:underline}
.mini-t{color:var(--texto);font-weight:500}
.mini-svg{display:block;width:100%;height:auto;margin:0 0 .3rem;overflow:visible}
.mini-svg path:not(.banda){fill:none;stroke-width:var(--r);stroke-linecap:round}
.mini-svg .banda{stroke-width:5}
.mini-svg.atenuado path:not(.banda){opacity:.28}
.mini-svg .anillo{fill:none;stroke:var(--texto);stroke-width:2.5}
.mini-svg .yo{stroke:var(--fondo);stroke-width:1.5}
`;
