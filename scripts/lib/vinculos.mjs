// El proceso legislativo detrás de un cambio de la bitácora, de
// congreso-mexicano: el decreto del DOF, su expediente del SIL, las
// iniciativas que lo originaron, las votaciones y, en reformas
// constitucionales, los congresos locales que la aprobaron.
//
// Un decreto se liga a un commit de reforma por (Documento, Publicacion) o
// por el sha que el decreto registra. Solo las reformas se buscan por fecha:
// la Publicacion de un alta es la versión del PDF, no un decreto.

import { leerCongreso } from "./congreso.mjs";

// El modelo de congreso-mexicano, o `{ ok: false, error }`: sin él la sección
// se omite y el resto de la bitácora se genera igual.
export async function leerVinculos() {
  const r = await leerCongreso();
  if (!r.ok) console.warn(`congreso-mexicano no se pudo leer (${r.error}); la bitácora sale sin proceso legislativo.`);
  return r;
}

// `camara` de las votaciones económicas → organización.
const ORGANIZACION_CAMARA = { diputados: "camara-de-diputados", senado: "senado", permanente: "comision-permanente" };

// Un registro de otra fuente (Senado, Gaceta) se muestra junto a la votación
// del SIL a la que apunta, no como una votación más.
function votacionesPorCamara(m, exp) {
  const todas = m.votacionesPorExpediente.get(exp.id) ?? [];
  const ids = new Set(todas.map((v) => v.id));
  const grupos = new Map();
  for (const v of todas) {
    if (v.votacion_sil && ids.has(v.votacion_sil)) continue;
    const org = v.organization_id ?? null;
    if (!grupos.has(org)) grupos.set(org, { organizacion: org, nombre: m.organizaciones.get(org)?.name ?? null, votaciones: [] });
    grupos.get(org).votaciones.push({ votacion: v, otras: m.otrasFuentes.get(v.id) ?? [] });
  }
  return [...grupos.values()];
}

function economicasPorCamara(m, exp) {
  const cuenta = new Map();
  for (const x of exp.votaciones_economicas ?? []) {
    const org = ORGANIZACION_CAMARA[x.camara] ?? null;
    cuenta.set(org, (cuenta.get(org) ?? 0) + 1);
  }
  return [...cuenta].map(([org, n]) => ({ organizacion: org, nombre: m.organizaciones.get(org)?.name ?? null, n }));
}

function autor(m, p, asunto, legisladores) {
  if (p.tipo === "legislador" && p.person_id) {
    const mandato = m.mandatos.get(p.mandato_id);
    // El partido con que se presentó la iniciativa (el del mandato es el de hoy);
    // con varios autores la iniciativa no dice el de cada uno.
    const partido =
      (legisladores === 1 && asunto.partido_fuente) ||
      mandato?.partido_fuente ||
      m.organizaciones.get(mandato?.on_behalf_of_id)?.name ||
      null;
    return { tipo: "legislador", person_id: p.person_id, nombre: m.personas.get(p.person_id)?.name ?? p.nombre_fuente, partido };
  }
  return { tipo: p.tipo, nombre: p.nombre_fuente ?? m.organizaciones.get(p.organization_id)?.name ?? "" };
}

function iniciativas(m, exp) {
  const publicadas = (m.asuntosPorSeguimiento.get(exp.seguimiento) ?? [])
    .filter((x) => x.tipo === "iniciativas")
    .map(({ asunto: a }) => {
      const legisladores = (a.presentadores ?? []).filter((p) => p.tipo === "legislador").length;
      const delExpediente = (exp.asuntos ?? []).find((x) => x.clave === a.clave);
      return {
        id: a.id,
        denominacion: a.denominacion,
        fecha: a.fecha_presentacion ?? delExpediente?.fecha ?? null,
        pdf: delExpediente?.pdf ?? null,
        autores: (a.presentadores ?? []).map((p) => autor(m, p, a, legisladores)),
      };
    });
  // Las que el expediente lista sin registro propio en congreso-mexicano.
  const vistas = new Set(publicadas.map((a) => a.id));
  const sinRegistro = (exp.asuntos ?? [])
    .filter((x) => x.tipo === "Iniciativa" && !vistas.has(`sil-${x.clave}`))
    .map((x) => ({ id: `sil-${x.clave}`, denominacion: x.denominacion, fecha: x.fecha ?? null, pdf: x.pdf ?? null, autores: null }));
  return [...publicadas, ...sinRegistro].sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""));
}

function proceso(m, decreto, cambio) {
  const enlace = (decreto.documentos ?? []).find(
    (x) => x.documento === cambio.documento && (cambio.publicaciones.includes(x.publicacion) || (x.commits ?? []).some((c) => c.sha === cambio.sha)),
  );
  const expedientes = (decreto.expedientes ?? []).map((e) => {
    const exp = m.expedientes.get(e.id);
    return {
      enlace: e,
      expediente: exp ?? null,
      iniciativas: exp ? iniciativas(m, exp) : [],
      votaciones: exp ? votacionesPorCamara(m, exp) : [],
      economicas: exp ? economicasPorCamara(m, exp) : [],
    };
  });
  return {
    decreto,
    // Varios decretos del mismo día sobre el documento: el commit los trae todos.
    mismoDia: enlace?.commits_candidatos ? (enlace.decretos_mismo_dia ?? []) : null,
    expedientes,
    candidatos: (decreto.candidatos_expediente ?? []).map((c) => ({ ...c, expediente: m.expedientes.get(c.id) ?? null })),
    legislaturas: decreto.legislaturas_estatales ?? null,
  };
}

// Los decretos de un cambio, cada uno con lo que se sabe de su proceso.
export function vinculosDe(congreso, cambio) {
  if (!congreso?.ok) return [];
  const decretos = [
    ...(cambio.tipo === "reforma" ? cambio.publicaciones.flatMap((p) => congreso.decretosPorPublicacion.get(`${cambio.documento}|${p}`) ?? []) : []),
    ...(congreso.decretosPorSha.get(cambio.sha) ?? []).filter((d) => (d.documentos ?? []).some((x) => x.documento === cambio.documento)),
  ];
  const unicos = [...new Map(decretos.map((d) => [d.id, d])).values()];
  unicos.sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "") || a.id.localeCompare(b.id));
  return unicos.map((d) => proceso(congreso, d, cambio));
}
