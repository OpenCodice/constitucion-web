// Los datos del Congreso resumidos para la API y el MCP (worker/): una fila
// por votación y una por legislador, con las cuentas ya hechas, y los asuntos
// (iniciativas, proposiciones, dictámenes, decretos) como colecciones para la
// búsqueda. Todo sale del modelo de congreso-mexicano que ya leyó la
// bitácora; aquí solo se cuenta, nunca se interpreta.

import { SITIO } from "./tarjeta.mjs";
import { urlVotacion, urlLegislador, urlExpediente, urlFoto } from "./congreso.mjs";
import { plano } from "../../worker/texto.js";

const SENTIDOS = { yes: "a_favor", no: "en_contra", abstain: "abstenciones", absent: "ausentes", "not voting": "sin_votar" };

const nombreOrg = (m, id) => m.organizaciones.get(id)?.name ?? null;

function cuentas(lista) {
  const c = { a_favor: 0, en_contra: 0, abstenciones: 0, ausentes: 0, sin_votar: 0 };
  for (const x of lista ?? []) if (SENTIDOS[x.option]) c[SENTIDOS[x.option]] += Number(x.value) || 0;
  return c;
}

// Qué tan dividida fue: la parte de los votos emitidos (a favor más en contra)
// que tuvo el lado perdedor. 0 es unanimidad; 0.5, empate.
const division = (c) => (c.a_favor + c.en_contra ? Math.min(c.a_favor, c.en_contra) / (c.a_favor + c.en_contra) : 0);

// Una votación de otra fuente (Gaceta, Senado) que apunta a una del SIL es
// la misma votación: se cuenta una vez, con los votos con nombre de la que
// los tenga.
function votacionesUnicas(m) {
  const unicas = [];
  for (const v of m.votaciones.values()) {
    if (v.votacion_sil && m.votaciones.has(v.votacion_sil)) continue;
    const pares = m.otrasFuentes.get(v.id) ?? [];
    const conVotos = [v, ...pares].find((x) => x.votos_publicados && x.votes?.length) ?? null;
    unicas.push({ v, conVotos });
  }
  return unicas;
}

// Una ley «Reglamentaria del artículo 105 de la Constitución Política de los
// Estados Unidos Mexicanos» nombra a la Constitución sin reformarla. Hasta la
// coma: después de ella siguen las otras leyes del asunto.
const REGLAMENTARIA = /reglamentaria de[^,;]*$/;

// «…para los efectos del artículo 98 de la Constitución…» la nombra sin
// tocarla: solo cuenta la ley nombrada después de un verbo de reforma.
const VERBO = /\b(reforman?|adicionan?|derogan?|expiden?|abrogan?)\b/;

// Las leyes federales que un asunto reforma o expide, por su nombre completo.
// Solo compara texto: el nombre entero, como palabra completa. De dos nombres
// encimados vale el más largo («Ley de Amparo, Reglamentaria de los artículos
// 103 y 107 de la Constitución…» es la Ley de Amparo, no la Constitución), y
// uno al que le sigue otra palabra con mayúscula inicial es el principio del
// nombre de otra ley que no está publicada («Ley General de Salud Mental»).
export function buscadorDeLeyes(nombresLey) {
  const leyes = [...nombresLey]
    .filter(([documento, nombre]) => nombre && !documento.includes("/"))
    .map(([documento, nombre]) => ({ documento, nombre: plano(nombre).replace(/\s+/g, " ").trim() }))
    .filter((l) => l.nombre.includes(" ") && l.nombre.length >= 10);
  return (texto) => {
    const original = String(texto ?? "").normalize("NFC").replace(/\s+/g, " ");
    const t = plano(original);
    const mismaLongitud = t.length === original.length;
    const hallados = [];
    for (const l of leyes) {
      for (let i = t.indexOf(l.nombre); i >= 0; i = t.indexOf(l.nombre, i + 1)) {
        const fin = i + l.nombre.length;
        if (/[a-z0-9]/.test(t[i - 1] ?? "") || /[a-z0-9]/.test(t[fin] ?? "")) continue;
        if (mismaLongitud && /^ \p{Lu}\p{Ll}/u.test(original.slice(fin))) continue;
        if (REGLAMENTARIA.test(t.slice(Math.max(0, i - 160), i)) || !VERBO.test(t.slice(0, i))) continue;
        hallados.push({ documento: l.documento, i, fin });
      }
    }
    const propios = hallados.filter((h) => !hallados.some((o) => o !== h && o.i <= h.i && o.fin >= h.fin && o.fin - o.i > h.fin - h.i));
    return [...new Set(propios.sort((a, b) => a.i - b.i).map((h) => h.documento))];
  };
}

export function resumenVotaciones(m, nombresLey = new Map()) {
  const nombradas = buscadorDeLeyes(nombresLey);
  return votacionesUnicas(m)
    .map(({ v, conVotos }) => {
      const c = cuentas(v.counts);
      const decreto = v.expediente_id ? m.decretoPorExpediente.get(v.expediente_id) : null;
      const texto = v.motion?.text ?? "";
      // Las leyes de la votación: las que reformó su decreto y, haya o no
      // decreto, las que nombra su asunto. `origen` dice de dónde sale cada una.
      const delDecreto = [...new Set((decreto?.documentos ?? []).map((x) => x.documento))];
      const delAsunto = nombradas(v.motion?.denominacion ?? texto).filter((d) => !delDecreto.includes(d));
      const leyes = [...delDecreto.map((d) => [d, "decreto"]), ...delAsunto.map((d) => [d, "asunto"])].map(([d, origen]) => ({
        documento: d,
        nombre: nombresLey.get(d) ?? null,
        url: nombresLey.has(d) ? `${SITIO}/ley/${d}` : null,
        origen,
      }));
      return {
        id: v.id,
        fecha: v.start_date ?? null,
        camara: nombreOrg(m, v.organization_id),
        asunto: v.motion?.denominacion ?? texto ?? null,
        resultado: texto || null,
        en_lo_general: /en lo general/i.test(`${texto} ${v.motion?.denominacion ?? ""}`),
        ...c,
        division: Math.round(division(c) * 1000) / 1000,
        por_grupo: (v.group_results ?? []).map((g) => ({
          grupo: g.grupo,
          a_favor: g.yes ?? 0,
          en_contra: g.no ?? 0,
          abstenciones: g.abstain ?? 0,
          ausentes: g.absent ?? 0,
        })),
        votos_con_nombre: Boolean(conVotos),
        otras_fuentes: (m.otrasFuentes.get(v.id) ?? []).map((x) => x.id).sort(),
        expediente: v.expediente_id ? `${SITIO}${urlExpediente(v.expediente_id)}` : null,
        decreto: decreto ? { id: decreto.id, titulo: decreto.titulo, fecha: decreto.fecha, dof: decreto.url } : null,
        leyes,
        url: `${SITIO}${urlVotacion(v.id)}`,
      };
    })
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || a.id.localeCompare(b.id));
}

// Los votos con nombre, para las herramientas `votacion` y
// `votos_legislador`: dos vistas de la misma tabla, en trozos.
// - `congreso/_/votantes.json`: [id, nombre] de cada persona con algún voto.
// - `congreso/_/votos/{n}.json`: de cada votación (en el orden de
//   votaciones.json, de POR_TROZO_VOTOS en POR_TROZO_VOTOS), el registro que
//   publica los nombres, sus grupos y cada voto como tres números seguidos
//   (persona, sentido, grupo), más los votos que la fuente no atribuye.
// - `congreso/_/votos-persona/{n}.json`: de cada persona (en el orden de
//   votantes.json), una letra por votación: su sentido, o «-» si no votó en ella.
export const POR_TROZO_VOTOS = 25;
export const POR_TROZO_PERSONAS = 100;
export const LETRAS_SENTIDO = { a_favor: "f", en_contra: "c", abstenciones: "a", ausentes: "u", sin_votar: "s" };
const ORDEN_SENTIDOS = Object.keys(LETRAS_SENTIDO);

export function archivosVotos(m, votaciones) {
  const porId = new Map(votacionesUnicas(m).map(({ v, conVotos }) => [v.id, conVotos]));
  const ids = new Set();
  for (const v of votaciones) for (const x of porId.get(v.id)?.votes ?? []) if (x.voter_id && SENTIDOS[x.option]) ids.add(x.voter_id);
  const votantes = [...ids].sort().map((id) => [id, m.personas.get(id)?.name ?? id]);
  const indice = new Map(votantes.map(([id], i) => [id, i]));
  const letras = votantes.map(() => new Array(votaciones.length).fill("-"));
  const fichas = votaciones.map((v, pos) => {
    const conVotos = porId.get(v.id);
    if (!conVotos) return null;
    const grupos = [];
    const votos = [];
    for (const x of conVotos.votes) {
      const sentido = SENTIDOS[x.option];
      if (!x.voter_id || !sentido) continue;
      const grupo = nombreOrg(m, x.group_id) ?? x.grupo_fuente ?? "Sin grupo";
      if (!grupos.includes(grupo)) grupos.push(grupo);
      votos.push(indice.get(x.voter_id), ORDEN_SENTIDOS.indexOf(sentido), grupos.indexOf(grupo));
      letras[indice.get(x.voter_id)][pos] = LETRAS_SENTIDO[sentido];
    }
    const sin_nombre = (conVotos.votos_faltantes ?? [])
      .filter((f) => SENTIDOS[f.option])
      .map((f) => ({ grupo: f.grupo ?? null, sentido: SENTIDOS[f.option], votos: Number(f.value) || 0 }));
    return { id: v.id, fuente: conVotos.id, grupos, votos, sin_nombre };
  });
  const archivos = new Map([["congreso/_/votantes.json", JSON.stringify(votantes)]]);
  for (let i = 0; i < fichas.length; i += POR_TROZO_VOTOS) archivos.set(`congreso/_/votos/${i / POR_TROZO_VOTOS}.json`, JSON.stringify(fichas.slice(i, i + POR_TROZO_VOTOS)));
  for (let i = 0; i < letras.length; i += POR_TROZO_PERSONAS) {
    archivos.set(`congreso/_/votos-persona/${i / POR_TROZO_PERSONAS}.json`, JSON.stringify(letras.slice(i, i + POR_TROZO_PERSONAS).map((l) => l.join(""))));
  }
  return archivos;
}

// El mandato que define a un legislador hoy: de la legislatura más reciente,
// el activo si lo hay.
function mandatoActual(xs) {
  const legislatura = xs.map((x) => x.legislative_period_id ?? "").sort().at(-1);
  const de = xs.filter((x) => (x.legislative_period_id ?? "") === legislatura);
  return de.find((x) => /^Activo/.test(x.estatus ?? "")) ?? de.sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""))[0];
}

export function resumenLegisladores(m) {
  // Votos con nombre de cada persona, una vez por votación.
  const votos = new Map();
  for (const { conVotos } of votacionesUnicas(m)) {
    if (!conVotos) continue;
    for (const x of conVotos.votes) {
      if (!x.voter_id) continue;
      if (!votos.has(x.voter_id)) votos.set(x.voter_id, { a_favor: 0, en_contra: 0, abstenciones: 0, ausentes: 0, sin_votar: 0, total: 0 });
      const c = votos.get(x.voter_id);
      if (SENTIDOS[x.option]) c[SENTIDOS[x.option]]++;
      c.total++;
    }
  }
  const filas = [];
  for (const p of m.personas.values()) {
    const mandatos = m.mandatosPorPersona.get(p.id) ?? [];
    if (!mandatos.length) continue;
    const md = mandatoActual(mandatos);
    const c = votos.get(p.id) ?? { a_favor: 0, en_contra: 0, abstenciones: 0, ausentes: 0, sin_votar: 0, total: 0 };
    const presentados = (m.asuntosPorPersona.get(p.id) ?? []).filter((x) => x.tipo === "iniciativas");
    filas.push({
      id: p.id,
      nombre: p.name,
      genero: p.gender ?? null,
      camara: nombreOrg(m, md.organization_id),
      grupo: nombreOrg(m, md.on_behalf_of_id) ?? md.partido_fuente ?? null,
      entidad: md.area?.entidad ?? null,
      principio: md.principio ?? null,
      calidad: md.calidad ?? null,
      estatus: md.estatus ?? null,
      en_funciones: /^Activo/.test(md.estatus ?? ""),
      legislatura: md.legislative_period_id ?? null,
      votaciones: c.total,
      a_favor: c.a_favor,
      en_contra: c.en_contra,
      abstenciones: c.abstenciones,
      ausencias: c.ausentes,
      sin_votar: c.sin_votar,
      ausencia: c.total ? Math.round((c.ausentes / c.total) * 1000) / 1000 : null,
      iniciativas: presentados.length,
      iniciativas_aprobadas: presentados.filter((x) => x.asunto.estatus?.resultado === "aprobado").length,
      url: `${SITIO}${urlLegislador(p.id)}`,
      foto: m.fotos?.has(p.id) ? `${SITIO}${urlFoto(m.fotos.get(p.id))}` : null,
    });
  }
  return filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

// Los asuntos del Congreso como colecciones para la búsqueda: cada uno con su
// ficha y el texto en que se busca, que es solo su denominación: con los
// autores, «ley de amparo» daba con lo que presentó una diputada Amparo. Por
// autor se filtra con la herramienta `asuntos`. Los más recientes primero.
const TIPOS_ASUNTO = [
  ["iniciativas", "iniciativa", "Iniciativas"],
  ["proposiciones", "proposicion", "Proposiciones con punto de acuerdo"],
  ["dictamenesNegativos", "dictamen", "Dictámenes negativos"],
];

function autores(m, a) {
  return (a.presentadores ?? []).map((p) => {
    if (p.person_id) {
      const md = m.mandatos.get(p.mandato_id);
      return { nombre: m.personas.get(p.person_id)?.name ?? p.nombre_fuente, id: p.person_id, grupo: nombreOrg(m, md?.on_behalf_of_id) ?? md?.partido_fuente ?? null };
    }
    return { nombre: p.nombre_fuente ?? nombreOrg(m, p.organization_id) ?? p.tipo };
  });
}

export function coleccionesCongreso(m, votaciones, nombresLey = new Map()) {
  const nombradas = buscadorDeLeyes(nombresLey);
  const porFecha = (a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "");
  const cols = TIPOS_ASUNTO.map(([k, tipo, nombre]) => ({
    coleccion: `congreso/${tipo}`,
    tipo,
    nombre,
    unidades: m.asuntos[k]
      .map((a) => {
        const au = autores(m, a);
        return {
          id: a.id,
          fecha: a.fecha_presentacion ?? a.estatus?.fecha ?? null,
          titulo: a.denominacion,
          autores: au,
          partido: a.partido_fuente ?? null,
          camara: a.camara_origen ?? null,
          estatus: a.estatus?.texto ?? null,
          resultado: a.estatus?.resultado ?? null,
          leyes: nombradas(a.denominacion),
          expediente: a.expediente_id ? `${SITIO}${urlExpediente(a.expediente_id)}` : null,
          sil: a.seguimiento ? `http://sil.gobernacion.gob.mx/Librerias/pp_ReporteSeguimiento.php?Seguimiento=${a.seguimiento}` : null,
          buscar: a.denominacion ?? "",
        };
      })
      .sort(porFecha),
  }));
  cols.push({
    coleccion: "congreso/decreto",
    tipo: "decreto",
    nombre: "Decretos del DOF",
    unidades: m.decretos
      .map((d) => ({
        id: d.id,
        fecha: d.fecha ?? null,
        titulo: d.titulo,
        leyes: [...new Set((d.documentos ?? []).map((x) => x.documento))],
        dof: d.url ?? null,
        url: `${SITIO}/bitacora/decretos/${d.id}`,
        buscar: d.titulo ?? "",
      }))
      .sort(porFecha),
  });
  cols.push({
    coleccion: "congreso/votacion",
    tipo: "votacion",
    nombre: "Votaciones",
    unidades: votaciones.map(({ por_grupo, ...v }) => ({ ...v, buscar: `${v.asunto ?? ""} ${v.resultado ?? ""}` })),
  });
  return cols;
}

// Lo que hace falta para filtrar los asuntos de una colección sin leer sus
// fichas (`congreso/_/{tipo}/f.json`): de cada uno, en su orden, la fecha, el
// desenlace y el partido, y en qué posiciones están los de cada autor y los
// que nombran cada ley.
export function filtrosAsuntos(colecciones) {
  const archivos = new Map();
  for (const c of colecciones) {
    if (!TIPOS_ASUNTO.some(([, tipo]) => tipo === c.tipo)) continue;
    const valores = (campo) => [...new Set(c.unidades.map((u) => u[campo] ?? null))];
    const resultados = valores("resultado");
    const partidos = valores("partido");
    const autores = {};
    const leyes = {};
    c.unidades.forEach((u, i) => {
      for (const id of new Set((u.autores ?? []).map((a) => a.id).filter(Boolean))) (autores[id] ??= []).push(i);
      for (const d of u.leyes ?? []) (leyes[d] ??= []).push(i);
    });
    archivos.set(
      `${c.coleccion.replace(/^congreso\//, "congreso/_/")}/f.json`,
      JSON.stringify({
        n: c.unidades.length,
        fechas: c.unidades.map((u) => u.fecha ?? null),
        resultados,
        resultado: c.unidades.map((u) => resultados.indexOf(u.resultado ?? null)),
        partidos,
        partido: c.unidades.map((u) => partidos.indexOf(u.partido ?? null)),
        autores,
        leyes,
      }),
    );
  }
  return archivos;
}
