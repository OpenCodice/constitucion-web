// Los datos del Congreso resumidos para la API y el MCP (worker/): una fila
// por votación y una por legislador, con las cuentas ya hechas, y los asuntos
// (iniciativas, proposiciones, dictámenes, decretos) como colecciones para la
// búsqueda. Todo sale del modelo de congreso-mexicano que ya leyó la
// bitácora; aquí solo se cuenta, nunca se interpreta.

import { SITIO } from "./tarjeta.mjs";
import { urlVotacion, urlLegislador, urlExpediente } from "./congreso.mjs";

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

export function resumenVotaciones(m, nombresLey = new Map()) {
  return votacionesUnicas(m)
    .map(({ v, conVotos }) => {
      const c = cuentas(v.counts);
      const decreto = v.expediente_id ? m.decretoPorExpediente.get(v.expediente_id) : null;
      const leyes = [...new Set((decreto?.documentos ?? []).map((x) => x.documento))].map((d) => ({
        documento: d,
        nombre: nombresLey.get(d) ?? null,
        url: nombresLey.has(d) ? `${SITIO}/ley/${d}` : null,
      }));
      const texto = v.motion?.text ?? "";
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
        expediente: v.expediente_id ? `${SITIO}${urlExpediente(v.expediente_id)}` : null,
        decreto: decreto ? { id: decreto.id, titulo: decreto.titulo, fecha: decreto.fecha, dof: decreto.url } : null,
        leyes,
        url: `${SITIO}${urlVotacion(v.id)}`,
      };
    })
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || a.id.localeCompare(b.id));
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
    });
  }
  return filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

// Los asuntos del Congreso como colecciones para la búsqueda: cada uno con su
// ficha y el texto en que se busca (su denominación y sus autores). Los más
// recientes primero.
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

export function coleccionesCongreso(m, votaciones) {
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
          expediente: a.expediente_id ? `${SITIO}${urlExpediente(a.expediente_id)}` : null,
          sil: a.seguimiento ? `http://sil.gobernacion.gob.mx/Librerias/pp_ReporteSeguimiento.php?Seguimiento=${a.seguimiento}` : null,
          buscar: `${a.denominacion ?? ""} ${au.map((x) => x.nombre).join(" ")} ${a.partido_fuente ?? ""}`,
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
