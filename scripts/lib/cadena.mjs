// La cadena de una reforma: de la iniciativa al commit que la registra, con
// la fecha de cada paso y los días entre uno y otro. Sale del proceso que arma
// vinculos.mjs para cada decreto de un cambio de la bitácora:
//
//   iniciativa → comisión → votación en cada cámara → congresos locales (solo
//   en reformas a la Constitución) → DOF → commit
//
// Un paso sin dato se dibuja vacío, con su motivo; nunca se rellena ni se
// deduce. Los pasos que salen del expediente del SIL (iniciativa, comisión y
// votaciones) solo se llenan si el programa ligó el decreto con un único
// expediente: si lo ligó un agente, si hay varios o solo candidatos, quedan
// vacíos y el detalle sigue en «Proceso legislativo».
//
// También pinta las secciones que acompañan a la cadena: quién la propuso,
// cómo votó cada cámara (su votación principal, ver votacionPrincipal) y los
// congresos locales.

import { ESTADOS, esc, numero, plural, lista, fechaLarga } from "./comun.mjs";
import { urlVotacion, urlLegislador, urlExpediente, urlSilExpediente } from "./congreso.mjs";
import { asientosVotacion, figuraHemiciclo, listaDisidentes, svgMini, resumenSentidos } from "./hemiciclo.mjs";

const DIA = 86_400_000;
export const dias = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA);

// Art. 135 de la Constitución: la aprueba la mayoría de las legislaturas de
// los estados y de la Ciudad de México (32), y el Congreso con las dos
// terceras partes de los presentes en cada cámara.
export const LEGISLATURAS = 32;
export const MAYORIA_LEGISLATURAS = 17;

// Las cámaras, por su organización en congreso-mexicano; `sil` es como el
// expediente nombra a la de origen y a la revisora, y `turno`, como la
// nombran los turnos de las iniciativas.
const CAMARAS = [
  { org: "camara-de-diputados", nombre: "Diputados", largo: "Cámara de Diputados", sil: "Cámara de Diputados", turno: "Diputados" },
  { org: "senado", nombre: "Senado", largo: "Senado", sil: "Cámara de Senadores", turno: "Senado" },
];

// ------------------------------------------------------------------ modelo

// La votación principal de una cámara, entre las nominales del expediente en
// ella (con su par de otra fuente, como las agrupa vinculos.mjs): la primera,
// por fecha e id, de la última fecha en que la cámara votó «en lo general».
// - La última fecha, porque si la minuta regresa a una cámara (cuando la otra
//   la modifica), la que cuenta es la que aprobó el texto que se publicó.
// - La primera de ese día, porque es la del dictamen en lo general; las
//   siguientes son las de los artículos reservados.
// - Sin ninguna «en lo general», la misma regla sobre todas.
export function votacionPrincipal(entradas) {
  if (!entradas?.length) return null;
  const enLoGeneral = entradas.filter((e) => /en lo general/i.test(e.votacion.motion?.text ?? ""));
  const xs = (enLoGeneral.length ? enLoGeneral : entradas)
    .slice()
    .sort((a, b) => (a.votacion.start_date ?? "").localeCompare(b.votacion.start_date ?? "") || a.votacion.id.localeCompare(b.votacion.id));
  const ultima = xs.at(-1).votacion.start_date;
  return xs.find((e) => e.votacion.start_date === ultima);
}

// La fuente que publica el voto de cada quien: la votación del SIL o su par.
export const conVotosDe = (e) => (e ? [e.votacion, ...e.otras].find((x) => x.votos_publicados && x.votes?.length) ?? null : null);

// El único expediente que ligó el programa, o el motivo de que no haya uno.
function expedienteSeguro(p) {
  const xs = p.expedientes;
  if (xs.length > 1) return { motivo: `el decreto liga ${numero(xs.length)} expedientes del SIL y no se sabe de cuál viene cada paso` };
  if (xs.length === 1) {
    if (xs[0].enlace.resolucion) return { motivo: "su expediente del SIL no lo ligó el programa sino un agente; la evidencia está en «Proceso legislativo»" };
    if (!xs[0].expediente) return { motivo: `su expediente (${xs[0].enlace.id}) no está en congreso-mexicano` };
    return { x: xs[0] };
  }
  if (p.candidatos.length) {
    return { motivo: `no se sabe con certeza cuál es su expediente en el SIL (hay ${plural(p.candidatos.length, "posible", "posibles")})` };
  }
  return { motivo: "no se identificó su expediente en el SIL" };
}

function ordenCamaras(exp) {
  return exp?.camara_origen === "Cámara de Senadores" ? [CAMARAS[1], CAMARAS[0]] : CAMARAS;
}

// Las comisiones a las que se turnaron las iniciativas en la cámara de
// origen, como las registra el SIL (sin repetir).
function comisionesDe(iniciativas, camara) {
  const todas = iniciativas.flatMap((i) => i.comisiones ?? []).filter((c) => c.comision);
  const en = todas.filter((c) => !camara || c.camara === camara.turno);
  const paraDictamen = en.filter((c) => /dictamen/i.test(c.turno ?? ""));
  return [...new Set((paraDictamen.length ? paraDictamen : en).map((c) => c.comision))];
}

const DICTAMEN = /^Dictamen/i;

// La cadena de un proceso (un decreto) de vinculosDe. `m`: el modelo de
// congreso-mexicano; `cambio`: el commit de la bitácora; `articulos`: el
// texto de los artículos que tocó. Un decreto sin commit (anterior al alta de
// su ley) pasa un `cambio` sin sha y en `registro` lo que dice su último
// paso, que queda sin fecha: el eje termina en el DOF.
export function cadenaDe(m, p, cambio, { articulos = "", registro = "" } = {}) {
  const d = p.decreto;
  const constitucional = cambio.documento === "cpeum";
  const { x, motivo } = expedienteSeguro(p);
  const exp = x?.expediente ?? null;
  const camaras = ordenCamaras(exp);
  const pasos = [];

  // Iniciativa: la primera presentada de las que lista el expediente.
  const iniciativas = x?.iniciativas ?? [];
  const primera = iniciativas.find((i) => i.fecha) ?? null;
  if (!x) pasos.push({ clave: "iniciativa", titulo: "Iniciativa", vacio: motivo });
  else if (!primera) pasos.push({ clave: "iniciativa", titulo: "Iniciativa", vacio: "el expediente no lista iniciativas con fecha" });
  else {
    pasos.push({
      clave: "iniciativa",
      titulo: "Iniciativa",
      fecha: primera.fecha,
      enlace: "#iniciativas",
      quien: autorCorto(primera),
      dato: iniciativas.length > 1 ? `la primera de ${numero(iniciativas.length)} del expediente` : "",
    });
  }

  // Comisión: el primer dictamen que registra el expediente.
  const dictamen = (exp?.asuntos ?? [])
    .filter((a) => DICTAMEN.test(a.tipo ?? "") && a.fecha)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
  if (!x) pasos.push({ clave: "comision", titulo: "Comisión", vacio: motivo });
  else if (!dictamen) pasos.push({ clave: "comision", titulo: "Comisión", vacio: "el SIL no registra su dictamen" });
  else {
    const comisiones = comisionesDe(iniciativas, camaras[0]);
    pasos.push({
      clave: "comision",
      titulo: "Comisión",
      fecha: dictamen.fecha,
      enlace: dictamen.pdf ?? urlExpediente(exp.id),
      quien: comisiones.length ? esc(lista(comisiones)) : '<span class="tenue">comisión sin registrar</span>',
      dato: esc((dictamen.tipo ?? "").toLowerCase()),
    });
  }

  // Una votación por cámara: su votación principal.
  const votos = camaras.map((cam) => {
    const entradas = x?.votaciones.find((g) => g.organizacion === cam.org)?.votaciones ?? [];
    const principal = votacionPrincipal(entradas);
    const economicas = x?.economicas.find((e) => e.organizacion === cam.org)?.n ?? 0;
    return { camara: cam, principal, conVotos: conVotosDe(principal), nominales: entradas.length, economicas };
  });
  for (const v of votos) {
    const paso = { clave: `votacion-${v.camara.org}`, titulo: v.camara.nombre };
    if (!x) paso.vacio = motivo;
    else if (!v.principal) {
      paso.vacio = v.economicas
        ? `${plural(v.economicas, "votación económica", "votaciones económicas")} y ninguna nominal: no queda registro de quién votó`
        : "el SIL no registra una votación nominal en esta cámara";
    } else {
      const vt = v.principal.votacion;
      const c = Object.fromEntries((vt.counts ?? []).map((k) => [k.option, k.value]));
      const datos = [];
      if (vt.result === "fail") datos.push("rechazada");
      if (c.abstain != null) datos.push(`${numero(c.abstain)} abst.`);
      if (c.absent != null) datos.push(`${numero(c.absent)} ${c.absent === 1 ? "ausente" : "ausentes"}`);
      if (constitucional) datos.push("se requieren ⅔");
      if (v.nominales > 1) datos.push(`1 de ${numero(v.nominales)} votaciones nominales`);
      Object.assign(paso, {
        fecha: vt.start_date,
        enlace: v.conVotos ? "#votos" : urlVotacion(vt.id),
        quien: `<span class="si">${numero(c.yes)}</span> – <span class="no">${numero(c.no)}</span>`,
        dato: datos.join(" · "),
        mini: v.conVotos ? miniVotacion(m, v) : "",
      });
    }
    pasos.push(paso);
  }

  // Congresos locales: solo en reformas a la Constitución.
  const l = p.legislaturas;
  if (constitucional) {
    if (!l) pasos.push({ clave: "congresos", titulo: "Congresos locales", vacio: "el SIL no registra la declaratoria de los congresos locales" });
    else {
      const n = l.votos_aprobatorios ?? l.aprobaron?.length ?? 0;
      pasos.push({
        clave: "congresos",
        titulo: "Congresos locales",
        fecha: l.fecha ?? null,
        vacio: l.fecha ? null : "el SIL no da la fecha de la declaratoria",
        enlace: "#estados",
        quien: `${numero(n)} de ${LEGISLATURAS} aprobaron`,
        dato: `se requieren ${MAYORIA_LEGISLATURAS}`,
      });
    }
  }

  pasos.push({
    clave: "dof",
    titulo: "DOF",
    fecha: d.fecha,
    enlace: d.url ?? null,
    quien: "Decreto publicado",
    dato: d.url ? `<a href="${esc(d.url)}">${d.codigo ? `código ${esc(d.codigo)}` : "el decreto"}</a>` : "",
  });
  pasos.push(
    cambio.sha
      ? { clave: "commit", titulo: "Texto vigente", fecha: cambio.dia, enlace: "#articulos", quien: `<code>${esc(cambio.sha.slice(0, 7))}</code>`, dato: articulos, registro: true }
      : { clave: "commit", titulo: "Texto vigente", fecha: null, quien: "", dato: registro, registro: true },
  );

  // Días desde el paso anterior que tiene fecha.
  let anterior = null;
  for (const s of pasos) {
    if (!s.fecha) continue;
    s.dias = anterior ? dias(anterior, s.fecha) : null;
    anterior = s.fecha;
  }

  return { decreto: d, constitucional, expediente: x, motivo: motivo ?? null, pasos, iniciativas, votos, legislaturas: constitucional ? l : null };
}

function miniVotacion(m, v) {
  const xs = asientosVotacion(m, v.conVotos);
  return svgMini(xs, { modo: "votacion", etiqueta: `Votación en ${v.camara.largo}: ${resumenSentidos(xs)}` });
}

// ------------------------------------------------------------------ texto

const fechaCorta = (f, conAño) =>
  new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", ...(conAño ? { year: "numeric" } : {}), timeZone: "UTC" })
    .format(new Date(`${f}T00:00:00Z`))
    .replace(".", "");

function textoAutor(a) {
  if (a.tipo === "legislador") {
    const nombre = a.person_id ? `<a href="${esc(urlLegislador(a.person_id))}">${esc(a.nombre)}</a>` : esc(a.nombre);
    return `${nombre}${a.partido ? ` <span class="sigla">${esc(a.partido)}</span>` : ""}`;
  }
  if (a.tipo === "grupo_parlamentario") return `Grupo parlamentario ${/^[A-Z]+$/.test(a.nombre) ? "del" : "de"} ${esc(a.nombre)}`;
  if (a.tipo === "ejecutivo_federal") return "Ejecutivo Federal";
  return esc(a.nombre);
}

function autorCorto(i) {
  if (!i.autores) return '<span class="tenue">autor no registrado</span>';
  if (!i.autores.length) return '<span class="tenue">sin autor registrado</span>';
  const resto = i.autores.length - 1;
  return `${textoAutor(i.autores[0])}${resto ? ` y ${plural(resto, "más", "más")}` : ""}`;
}

const gap = (n) => (n == null ? "" : n === 0 ? "mismo día" : n > 0 ? `+${plural(n, "día", "días")}` : `${plural(-n, "día", "días")} antes`);

// ------------------------------------------------------------------ cadena

// `sufijo` distingue las anclas cuando la página tiene varios decretos.
export function htmlCadena(cad, sufijo = "") {
  const fechas = cad.pasos.filter((s) => s.fecha).map((s) => s.fecha);
  const conAño = new Set(fechas.map((f) => f.slice(0, 4))).size > 1;
  const ancla = (e) => (e?.startsWith("#") ? `${e}${sufijo}` : e);
  const tira = cad.pasos
    .map((s) => {
      const clases = ["paso", s.registro ? "reg" : "", s.vacio && !s.fecha ? "vacio" : ""].filter(Boolean).join(" ");
      const titulo = s.enlace && !(s.vacio && !s.fecha) ? `<a class="t" href="${esc(ancla(s.enlace))}">${esc(s.titulo)}</a>` : `<span class="t">${esc(s.titulo)}</span>`;
      return `<li class="${clases}">
<span class="gap">${s.fecha ? gap(s.dias) : ""}</span>
<span class="nodo" aria-hidden="true"></span>
<span class="f">${s.fecha ? `<time datetime="${esc(s.fecha)}">${fechaCorta(s.fecha, conAño)}</time>` : s.registro ? "sin commit" : "sin fecha"}</span>
${titulo}
${s.mini ? `<span class="mini-h">${s.mini}</span>` : ""}
${s.quien ? `<span class="q">${s.quien}</span>` : ""}
${s.dato ? `<span class="d">${s.dato}</span>` : ""}
${s.vacio ? `<span class="d motivo">${esc(mayuscula(s.vacio))}.</span>` : ""}
</li>`.replace(/\n+/g, "\n");
    })
    .join("\n");
  return `<ol class="tira" style="--pasos:${cad.pasos.length}">
${tira}
</ol>
${ejeCadena(cad)}`;
}

const mayuscula = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Eje a escala: el tramo legislativo (del primer paso con fecha al DOF) y el
// de registro (del DOF al commit), punteado.
function ejeCadena(cad) {
  const con = cad.pasos.filter((s) => s.fecha);
  if (con.length < 2) return "";
  const T0 = con.map((s) => s.fecha).sort()[0];
  const T1 = con.map((s) => s.fecha).sort().at(-1);
  const total = Math.max(1, dias(T0, T1));
  const W = 1000;
  const X0 = 8;
  const X1 = W - 8;
  const x = (f) => X0 + ((X1 - X0) * dias(T0, f)) / total;
  const f1 = (n) => n.toFixed(1);

  // Marcas: meses si cabe en año y medio, años si no.
  const marcas = [];
  const inicio = new Date(`${T0}T00:00:00Z`);
  if (total <= 550) {
    const largo = total <= 200;
    for (let d = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 1)); d <= new Date(`${T1}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1)) {
      const f = d.toISOString().slice(0, 10);
      const mes = new Intl.DateTimeFormat("es-MX", { month: largo ? "long" : "short", timeZone: "UTC" }).format(d).replace(".", "");
      const t = d.getUTCMonth() === 0 ? `${mes} ${d.getUTCFullYear()}` : mes;
      marcas.push(`<line x1="${f1(x(f))}" x2="${f1(x(f))}" y1="6" y2="34" class="mes"/><text x="${f1(x(f) + 4)}" y="12" class="mes-t">${esc(t)}</text>`);
    }
  } else {
    for (let a = inicio.getUTCFullYear() + 1; `${a}-01-01` <= T1; a++) {
      const f = `${a}-01-01`;
      marcas.push(`<line x1="${f1(x(f))}" x2="${f1(x(f))}" y1="6" y2="34" class="mes"/><text x="${f1(x(f) + 4)}" y="12" class="mes-t">${a}</text>`);
    }
  }

  const dof = cad.decreto.fecha;
  const fin = cad.pasos.at(-1).fecha ?? dof;
  const legis = dias(T0, dof);
  const primero = con[0];
  const desde = primero.clave === "iniciativa" ? "de la iniciativa" : `del primer paso con fecha (${primero.titulo.toLowerCase()})`;
  const tramos = [
    legis > 0 ? `<line x1="${f1(x(T0))}" x2="${f1(x(dof))}" y1="28" y2="28" class="tramo"/>` : "",
    fin !== dof ? `<line x1="${f1(x(dof))}" x2="${f1(x(fin))}" y1="28" y2="28" class="tramo reg"/>` : "",
  ].join("");
  const puntos = con
    .map(
      (s) =>
        `<g class="p${s.registro ? " reg" : ""}"><circle cx="${f1(x(s.fecha))}" cy="28" r="5"/><title>${esc(`${s.titulo}: ${fechaLarga(s.fecha)}`)}</title></g>`,
    )
    .join("");
  const textos = [
    legis > 0 ? `<text x="${f1(X0)}" y="52" class="tr-t">${esc(`${plural(legis, "día", "días")} ${desde} al DOF`)}</text>` : "",
    fin !== dof ? `<text x="${f1(X1)}" y="52" class="tr-t" text-anchor="end">${esc(`${plural(dias(dof, fin), "día", "días")} del DOF al commit`)}</text>` : "",
  ].join("");
  return `<div class="eje-c"><svg class="eje" viewBox="0 0 ${W} 60" role="img" aria-label="${esc(
    `Eje de tiempo a escala, del ${fechaLarga(T0)} al ${fechaLarga(T1)}`,
  )}">${marcas.join("")}${tramos}${puntos}${textos}</svg></div>
<p class="nota-eje">${fin !== dof ? "Eje a escala. Punteado, el tramo entre la publicación en el DOF y el commit que la registra en OpenCodice." : "Eje a escala, hasta su publicación en el DOF."}</p>`;
}

// ------------------------------------------------------------------ quién la propuso

export function htmlQuien(cad) {
  const xs = cad.iniciativas;
  if (!xs.length) return "";
  const items = xs.map((i) => {
    const autores = !i.autores
      ? '<span class="tenue">Su autor no está registrado en congreso-mexicano</span>'
      : !i.autores.length
        ? '<span class="tenue">Sin autor registrado</span>'
        : lista(i.autores.slice(0, 8).map(textoAutor)) + (i.autores.length > 8 ? ` y ${plural(i.autores.length - 8, "autor más", "autores más")}` : "");
    const turnos = [...new Set((i.comisiones ?? []).filter((c) => c.comision).map((c) => `${c.comision}${c.camara ? ` (${c.camara})` : ""}`))];
    const clave = i.id.replace(/^sil-/, "");
    const enlaces = [
      i.pdf ? `<a href="${esc(i.pdf)}">texto</a>` : "",
      cad.expediente?.expediente ? `<a href="${esc(`${urlSilExpediente(cad.expediente.expediente)}&Asunto=${clave}`)}">SIL ${esc(clave)}</a>` : "",
    ].filter(Boolean);
    return `<li><span class="f">${i.fecha ? fechaLarga(i.fecha) : "sin fecha"}</span>
<span class="quien">${autores}</span>
<span class="que">${esc((i.denominacion ?? "").replace(/^Que /, ""))}</span>
<span class="tenue">${[turnos.length ? `Turnada a ${esc(lista(turnos))}` : "", ...enlaces].filter(Boolean).join(" · ")}</span></li>`;
  });
  return `<p>${xs.length === 1 ? "El expediente del SIL liga una iniciativa." : `El expediente del SIL liga ${numero(xs.length)} iniciativas, por fecha de presentación.`}</p>
<ul class="inis">
${items.join("\n")}
</ul>`;
}

// ------------------------------------------------------------------ cómo votaron

export function htmlVotos(m, cad, sufijo = "") {
  const con = cad.votos.filter((v) => v.principal);
  if (!con.length) return "";
  const columnas = con.map((v) => {
    const vt = v.principal.votacion;
    const titulo = `<h3 class="h3">${esc(v.camara.largo)} <span class="tenue">· ${vt.start_date ? fechaLarga(vt.start_date) : "sin fecha"}</span></h3>`;
    if (!v.conVotos) {
      const c = Object.fromEntries((vt.counts ?? []).map((k) => [k.option, k.value]));
      return `<div>${titulo}<p class="tenue">La fuente no publica el voto de cada legislador: ${numero(c.yes)} a favor, ${numero(c.no)} en contra${
        c.abstain != null ? ` y ${plural(c.abstain, "abstención", "abstenciones")}` : ""
      }. <a href="${esc(urlVotacion(vt.id))}">La votación</a>.</p></div>`;
    }
    const xs = asientosVotacion(m, v.conVotos);
    const cuenta = (k) => xs.filter((y) => y.sentido === k).length;
    const figura = figuraHemiciclo(xs, {
      modo: "votacion",
      etiqueta: `Votación en ${v.camara.largo}: ${resumenSentidos(xs)}. Cada asiento enlaza a la página del legislador.`,
      centro: [[`${numero(cuenta("yes"))}–${numero(cuenta("no"))}`, "c1"], [v.camara.nombre, "c2"]],
      nota: `Un asiento por legislador; con borde, quien votó distinto a la mayoría de su grupo. Fuente: <a href="${esc(urlVotacion(v.conVotos.id))}">${esc(v.conVotos.id)}</a>.`,
      id: `hem-${v.camara.org}${sufijo}`,
    });
    return `<div>${titulo}<p class="que-voto">${esc(queSeVoto(vt))}</p>${figura}</div>`;
  });
  const disidentes = con
    .filter((v) => v.conVotos)
    .map((v) => {
      const l = listaDisidentes(asientosVotacion(m, v.conVotos));
      return l ? `<h4 class="h4">${esc(v.camara.largo)}</h4>${l}` : "";
    })
    .filter(Boolean);
  const hayVotos = con.some((v) => v.conVotos);
  return `<p>
  La votación principal de cada cámara: la primera votación nominal en lo general del último día en que
  la cámara la votó (si la minuta regresó a una cámara, la que aprobó el texto que se publicó). Las demás
  están en el detalle de abajo.${cad.constitucional ? " Una reforma constitucional necesita las dos terceras partes de los presentes en cada cámara." : ""}
</p>
<div class="dos" style="--cols:${columnas.length}">
${columnas.join("\n")}
</div>
${
  disidentes.length
    ? `<h3 class="h3">Votaron distinto a la mayoría de su grupo</h3>\n${disidentes.join("\n")}`
    : hayVotos
      ? '<p class="tenue">Nadie votó distinto a la mayoría de su grupo (sin contar ausencias).</p>'
      : ""
}`;
}

// El SIL repite los conteos al final del texto de la votación.
const queSeVoto = (v) => (v.motion?.text ?? "").replace(/\s*A favor:.*$/is, "").trim() || "Votación";

// ------------------------------------------------------------------ congresos locales

// Los 32 estados como cuadros en su lugar aproximado del mapa: [columna, fila].
export const MAPA = {
  "baja-california": [0, 0], sonora: [1, 0], chihuahua: [2, 0], coahuila: [3, 0], "nuevo-leon": [4, 0],
  "baja-california-sur": [0, 1], sinaloa: [1, 1], durango: [2, 1], zacatecas: [3, 1], "san-luis-potosi": [4, 1], tamaulipas: [5, 1],
  nayarit: [1, 2], aguascalientes: [2, 2], guanajuato: [3, 2], queretaro: [4, 2], hidalgo: [5, 2], veracruz: [6, 2],
  jalisco: [1, 3], michoacan: [2, 3], edomex: [3, 3], cdmx: [4, 3], tlaxcala: [5, 3], puebla: [6, 3], yucatan: [8, 3],
  colima: [1, 4], guerrero: [3, 4], morelos: [4, 4], oaxaca: [5, 4], tabasco: [6, 4], campeche: [7, 4], "quintana-roo": [8, 4],
  chiapas: [6, 5],
};
const ABREV = {
  aguascalientes: "AGS", "baja-california": "BC", "baja-california-sur": "BCS", campeche: "CAMP", chiapas: "CHIS", chihuahua: "CHIH",
  cdmx: "CDMX", coahuila: "COAH", colima: "COL", durango: "DGO", edomex: "MÉX", guanajuato: "GTO", guerrero: "GRO", hidalgo: "HGO",
  jalisco: "JAL", michoacan: "MICH", morelos: "MOR", nayarit: "NAY", "nuevo-leon": "NL", oaxaca: "OAX", puebla: "PUE", queretaro: "QRO",
  "quintana-roo": "QROO", "san-luis-potosi": "SLP", sinaloa: "SIN", sonora: "SON", tabasco: "TAB", tamaulipas: "TAMPS", tlaxcala: "TLAX",
  veracruz: "VER", yucatan: "YUC", zacatecas: "ZAC",
};

export function htmlCongresos(cad) {
  const l = cad.legislaturas;
  if (!cad.constitucional || !l) return "";
  const aprobo = new Set(l.aprobaron ?? []);
  const S = 56;
  const G = 4;
  const celdas = ESTADOS.map(([k, nombre]) => {
    const [c, r] = MAPA[k];
    const x = c * (S + G);
    const y = r * (S + G);
    const si = aprobo.has(k);
    return `<g class="edo ${si ? "ok" : "sr"}"><rect x="${x}" y="${y}" width="${S}" height="${S}" rx="3"/><text x="${x + S / 2}" y="${y + S / 2 + 4}" text-anchor="middle">${ABREV[k]}</text><title>${esc(nombre)}: ${si ? "aprobó" : "sin registro en el SIL"}</title></g>`;
  });
  const n = l.votos_aprobatorios ?? aprobo.size;
  const sin = ESTADOS.filter(([k]) => !aprobo.has(k)).map(([, nombre]) => esc(nombre));
  const mapa = `<svg class="mapa" viewBox="-2 -2 ${9 * (S + G) + 2} ${6 * (S + G) + 2}" role="img" aria-label="${esc(
    `Congresos locales: ${aprobo.size} aprobaron, ${LEGISLATURAS - aprobo.size} sin registro`,
  )}">${celdas.join("")}</svg>`;
  return `<div class="estados">
${mapa}
<div class="estados-t">
<p><span class="grande">${numero(n)}</span> de ${LEGISLATURAS} congresos aprobaron <span class="tenue">(se requieren ${MAYORIA_LEGISLATURAS})</span>.${
    l.fecha ? ` Declaratoria: ${fechaLarga(l.fecha)}.` : ""
  }</p>
<p class="leyenda-m"><span class="cuadro ok"></span> Aprobó <span class="cuadro sr"></span> Sin registro</p>
<p class="tenue">El SIL solo lista los congresos que aprobaron.${
    sin.length
      ? ` ${sin.length === 1 ? "El otro" : `Los otros ${numero(sin.length)}`} (${lista(sin)}) no ${sin.length === 1 ? "tiene" : "tienen"} registro: no sabemos si votaron en contra, si no votaron o si votaron después de la declaratoria. «Sin registro» no es «en contra».`
      : ""
  }</p>
</div>
</div>`;
}

// ------------------------------------------------------------------ estilo

export const ESTILO_CADENA = `
:root { --registro: #9a9a9a; }
@media (prefers-color-scheme: dark) { :root { --registro: #5f5f5f; } }
.ancho { width: min(72rem, 100vw - 2.5rem); margin-left: calc(50% - min(36rem, 50vw - 1.25rem)); }
.tira { list-style: none; margin: 1.5rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(var(--pasos), minmax(0, 1fr)); gap: 0 0.75rem; font-size: 0.8em; line-height: 1.35; }
.paso { position: relative; display: grid; grid-template-rows: 1.2em 1.4em auto auto auto auto auto 1fr; align-content: start; min-width: 0; margin: 0; }
.paso .gap { font-size: 0.85em; color: var(--tenue); font-variant-numeric: tabular-nums; white-space: nowrap; }
.paso .nodo { position: relative; display: block; height: 1.4em; }
.paso .nodo::before { content: ""; position: absolute; left: 0; right: -0.75rem; top: 50%; border-top: 2px solid var(--texto); }
.paso:last-child .nodo::before { right: 0; }
.paso .nodo::after { content: ""; position: absolute; left: 0; top: 50%; width: 0.75em; height: 0.75em; transform: translateY(-50%); border-radius: 50%; background: var(--texto); }
.paso.reg .nodo::before, .paso:has(+ .reg) .nodo::before { border-top-style: dashed; border-color: var(--registro); }
.paso.reg .nodo::after { background: var(--fondo); border: 2px solid var(--texto); }
.paso.vacio .nodo::after { background: var(--fondo); border: 1.5px dashed var(--tenue); }
.paso.vacio .t { color: var(--tenue); }
.paso .f { margin-top: 0.4em; color: var(--tenue); font-variant-numeric: tabular-nums; }
.paso .t { font-weight: 600; font-size: 1.05em; text-decoration: none; }
a.t:hover { text-decoration: underline; }
.paso .q { margin-top: 0.2em; overflow-wrap: anywhere; }
.paso .d { color: var(--tenue); font-size: 0.92em; overflow-wrap: anywhere; }
.paso .motivo { font-style: italic; }
.paso .si { color: var(--v0); font-weight: 600; font-variant-numeric: tabular-nums; font-size: 1.15em; }
.paso .no { color: var(--v1); font-weight: 600; font-variant-numeric: tabular-nums; font-size: 1.15em; }
.mini-h { display: block; max-width: 7.5rem; margin: 0.35em 0 0.1em; }
.mini-h .mini-svg { margin: 0; }
.eje-c { margin: 1.6rem 0 0; overflow-x: auto; }
.eje { display: block; width: 100%; min-width: 40rem; height: auto; overflow: visible; }
.eje .mes { stroke: var(--linea); stroke-width: 1; }
.eje .mes-t { font-size: 13px; fill: var(--tenue); }
.eje .tramo { stroke: var(--texto); stroke-width: 2; }
.eje .tramo.reg { stroke: var(--registro); stroke-dasharray: 5 4; }
.eje .p circle { fill: var(--texto); stroke: var(--fondo); stroke-width: 2; }
.eje .p.reg circle { fill: var(--fondo); stroke: var(--texto); }
.eje .tr-t { font-size: 14px; fill: var(--tenue); }
.nota-eje { margin-top: 0.4rem; font-size: 0.75em; color: var(--tenue); }
@media (max-width: 52rem) {
  .tira { grid-template-columns: 1fr; gap: 0; }
  .paso { grid-template-rows: none; grid-template-columns: 1.4em minmax(0, 1fr); column-gap: 0.8rem; padding-bottom: 1.1rem; }
  .paso > * { grid-column: 2; }
  .paso .nodo { grid-column: 1; grid-row: 1 / span 8; height: auto; }
  .paso .nodo::before { left: 50%; right: auto; top: 0.6em; bottom: -1.1rem; border-top: 0; border-left: 2px solid var(--texto); }
  .paso:last-child .nodo::before { display: none; }
  .paso.reg .nodo::before, .paso:has(+ .reg) .nodo::before { border-left-style: dashed; border-color: var(--registro); }
  .paso .nodo::after { left: 50%; top: 0.6em; transform: translate(-50%, -50%); }
  .paso .f { margin-top: 0; }
}
.inis { list-style: none; padding: 0; display: grid; gap: 1.1rem; font-size: 0.9em; }
.inis li { display: grid; gap: 0.15rem; margin: 0; padding-left: 0.9rem; border-left: 2px solid var(--linea); }
.inis .f { font-size: 0.85em; color: var(--tenue); font-variant-numeric: tabular-nums; }
.inis .quien { font-weight: 600; }
.inis .tenue { font-size: 0.85em; }
.sigla { display: inline-block; margin-left: 0.3em; padding: 0 0.35em; border: 1px solid var(--linea); border-radius: 3px; font-size: 0.75em; font-weight: 500; color: var(--tenue); vertical-align: 0.1em; }
.h3 { margin: 1.5rem 0 0.6rem; font-size: 0.9em; font-weight: 600; }
.h4 { margin: 1rem 0 0.4rem; font-size: 0.8em; font-weight: 600; color: var(--tenue); }
.que-voto { margin: -0.3rem 0 0.6rem; font-size: 0.78em; color: var(--tenue); }
.dos { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 2rem; }
@media (min-width: 60rem) { .dos { width: min(72rem, 100vw - 2.5rem); margin-left: calc(50% - min(36rem, 50vw - 1.25rem)); grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); } }
.estados { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 1.5rem; align-items: start; margin: 0 0 1.5rem; }
@media (max-width: 40rem) { .estados { grid-template-columns: minmax(0, 1fr); } }
.mapa { display: block; width: 100%; height: auto; }
.mapa text { font-size: 13px; font-weight: 600; pointer-events: none; }
.edo.ok rect { fill: var(--v0); }
.edo.ok text { fill: var(--fondo); }
.edo.sr rect { fill: var(--fondo); stroke: var(--tenue); stroke-width: 1.2; stroke-dasharray: 3 3; }
.edo.sr text { fill: var(--tenue); font-weight: 400; }
.estados-t { font-size: 0.88em; }
.grande { font-size: 2.2em; font-weight: 600; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.leyenda-m { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3em 0.6em; font-size: 0.78em; color: var(--tenue); }
.cuadro { display: inline-block; width: 0.9em; height: 0.9em; border-radius: 2px; vertical-align: -0.1em; }
.cuadro.ok { background: var(--v0); }
.cuadro.sr { border: 1.2px dashed var(--tenue); }
`;
