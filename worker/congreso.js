// Votaciones y legisladores, con filtros y orden, sobre los resúmenes que
// escribe `scripts/lib/abiertos.mjs` (congreso/votaciones.json y
// congreso/legisladores.json). Solo filtra, ordena y cuenta.

import { plano } from "./texto.js";
import { ErrorDatos, json, catalogo } from "./datos.js";
import { documentoDe } from "./ley.js";

// Siglas con que se nombra a los grupos parlamentarios.
const SIGLAS = {
  pan: "partido accion nacional",
  pri: "partido revolucionario institucional",
  prd: "partido de la revolucion democratica",
  pvem: "partido verde ecologista de mexico",
  verde: "partido verde ecologista de mexico",
  pt: "partido del trabajo",
  mc: "movimiento ciudadano",
  pes: "partido encuentro social",
  morena: "morena",
};
const grupoPlano = (g) => SIGLAS[plano(g).trim()] ?? plano(g).trim();
// Los grupos vienen con su nombre («Partido Acción Nacional») o su sigla
// («PAN»), según la fuente: se comparan ya expandidos.
const deGrupo = (grupo, pedido) => {
  const g = grupoPlano(grupo ?? "");
  const p = grupoPlano(pedido);
  return g === p || g.includes(p);
};

const CAMARAS = { diputados: "camara de diputados", senado: "camara de senadores", senadores: "camara de senadores", permanente: "comision permanente" };
const deCamara = (camara, pedida) => !pedida || plano(camara ?? "") === (CAMARAS[plano(pedida).trim()] ?? plano(pedida).trim());

const acotar = (n, def, max) => Math.min(Math.max(1, Number(n) || def), max);

// ------------------------------------------------------------------ votaciones

export async function votaciones(env, { orden = "fecha", camara, documento, texto, grupo_en_contra, desde, hasta, en_lo_general, agrupar = true, limite = 20 } = {}) {
  const r = await json(env, "congreso/votaciones.json");
  if (!r) throw new ErrorDatos("Los datos del Congreso no están disponibles en este despliegue.");
  let doc = null;
  if (documento) {
    doc = documentoDe(await catalogo(env), documento);
    if (!doc) throw new ErrorDatos(`No hay un documento «${documento}». Su clave se busca con buscar_documentos.`);
  }
  const ps = plano(texto ?? "").split(/\s+/).filter(Boolean);
  const nombreDoc = doc ? plano(doc.nombre) : null;
  let xs = r.votaciones.filter(
    (v) =>
      deCamara(v.camara, camara) &&
      (!desde || (v.fecha ?? "") >= desde) &&
      (!hasta || (v.fecha ?? "") <= hasta) &&
      (en_lo_general == null || v.en_lo_general === (en_lo_general === true || en_lo_general === "true")) &&
      (!doc || v.leyes.some((l) => l.documento === doc.documento) || plano(v.asunto ?? "").includes(nombreDoc)) &&
      ps.every((p) => plano(`${v.asunto ?? ""} ${v.resultado ?? ""}`).includes(p)) &&
      (!grupo_en_contra || v.por_grupo.some((g) => deGrupo(g.grupo, grupo_en_contra) && g.en_contra > g.a_favor)),
  );
  const ordenes = {
    fecha: (a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""),
    division: (a, b) => b.division - a.division || b.a_favor + b.en_contra - (a.a_favor + a.en_contra),
    en_contra: (a, b) => b.en_contra - a.en_contra,
    ausentes: (a, b) => b.ausentes - a.ausentes,
  };
  if (!ordenes[orden]) throw new ErrorDatos(`Orden desconocido: ${orden}. Usa ${Object.keys(ordenes).join(", ")}.`);
  xs = xs.sort(ordenes[orden]);
  // Un mismo asunto se vota varias veces (en lo general, en lo particular, en
  // cada cámara): agrupado, queda la primera de cada asunto y cámara en el
  // orden pedido, con cuántas más hubo.
  if (!(agrupar === false || agrupar === "false")) {
    // Copias: las filas vienen de la memoria del isolate, compartida entre peticiones.
    const vistos = new Map();
    for (const v of xs) {
      const k = `${v.camara}|${v.expediente ?? plano(v.asunto ?? v.id)}`;
      if (vistos.has(k)) vistos.get(k).otras_del_asunto++;
      else vistos.set(k, { ...v, otras_del_asunto: 0 });
    }
    xs = [...vistos.values()];
  }
  return { total: xs.length, orden, nota: r.nota, votaciones: xs.slice(0, acotar(limite, 20, 100)) };
}

const resumenGrupos = (v) =>
  v.por_grupo
    .filter((g) => g.a_favor + g.en_contra + g.abstenciones)
    .map((g) => `${g.grupo} ${g.a_favor}-${g.en_contra}${g.abstenciones ? `-${g.abstenciones}` : ""}`)
    .join(", ");

export function mdVotaciones(r) {
  if (!r.votaciones.length) return "Ninguna votación coincide.\n";
  const lineas = r.votaciones.map((v) => {
    const leyes = v.leyes.filter((l) => l.nombre).map((l) => l.nombre).join("; ");
    return `- **${v.fecha ?? "s/f"} · ${v.camara}** · ${v.a_favor} a favor, ${v.en_contra} en contra, ${cuenta(v.abstenciones, "abstención", "abstenciones")}, ${cuenta(v.ausentes, "ausente", "ausentes")} (división ${v.division})
  ${v.asunto ?? v.resultado ?? ""}${v.otras_del_asunto ? ` (${v.otras_del_asunto === 1 ? "y otra votación" : `y ${v.otras_del_asunto} votaciones más`} de este asunto en esta cámara)` : ""}${leyes ? `\n  Leyes: ${leyes}` : ""}${resumenGrupos(v) ? `\n  Por grupo (a favor-en contra-abstenciones): ${resumenGrupos(v)}` : ""}
  ${v.url}`;
  });
  return `# Votaciones (${r.total}${r.total > r.votaciones.length ? `, se muestran ${r.votaciones.length}` : ""}; orden: ${r.orden})

${r.nota}

${lineas.join("\n")}
`;
}

// ------------------------------------------------------------------ legisladores

export async function legisladores(env, { camara, grupo, entidad, nombre, en_funciones = true, orden = "nombre", minimo_votaciones = 20, limite = 25 } = {}) {
  const r = await json(env, "congreso/legisladores.json");
  if (!r) throw new ErrorDatos("Los datos del Congreso no están disponibles en este despliegue.");
  const ps = plano(nombre ?? "").split(/\s+/).filter(Boolean);
  const activos = !(en_funciones === false || en_funciones === "false");
  const porTasa = orden === "ausencia" || orden === "asistencia";
  const min = Number(minimo_votaciones) || 0;
  let xs = r.legisladores.filter(
    (l) =>
      (!activos || l.en_funciones) &&
      deCamara(l.camara, camara) &&
      (!grupo || deGrupo(l.grupo, grupo)) &&
      (!entidad || plano(l.entidad ?? "").includes(plano(entidad))) &&
      ps.every((p) => plano(l.nombre).includes(p)) &&
      (!porTasa || l.votaciones >= min),
  );
  const ordenes = {
    nombre: (a, b) => a.nombre.localeCompare(b.nombre, "es"),
    ausencia: (a, b) => (b.ausencia ?? -1) - (a.ausencia ?? -1) || b.ausencias - a.ausencias,
    asistencia: (a, b) => (a.ausencia ?? 2) - (b.ausencia ?? 2) || b.votaciones - a.votaciones,
    ausencias: (a, b) => b.ausencias - a.ausencias,
    iniciativas: (a, b) => b.iniciativas - a.iniciativas,
    en_contra: (a, b) => b.en_contra - a.en_contra,
  };
  if (!ordenes[orden]) throw new ErrorDatos(`Orden desconocido: ${orden}. Usa ${Object.keys(ordenes).join(", ")}.`);
  xs = xs.sort(ordenes[orden]);
  const porGrupo = {};
  for (const l of xs) porGrupo[l.grupo ?? "Sin grupo"] = (porGrupo[l.grupo ?? "Sin grupo"] ?? 0) + 1;
  return { total: xs.length, por_grupo: porGrupo, orden, nota: r.nota, legisladores: xs.slice(0, acotar(limite, 25, 200)) };
}

const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)} %`);
const cuenta = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export function mdLegisladores(r) {
  if (!r.legisladores.length) return "Ningún legislador coincide.\n";
  const grupos = Object.entries(r.por_grupo)
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${g} ${n}`)
    .join(", ");
  const lineas = r.legisladores.map(
    (l) =>
      `- **${l.nombre}** · ${l.camara ?? ""} · ${l.grupo ?? "sin grupo"}${l.entidad ? ` · ${l.entidad}` : ""}${l.en_funciones ? "" : ` · ${l.estatus}`}
  ${cuenta(l.votaciones, "votación", "votaciones")} con nombre: ${l.a_favor} a favor, ${l.en_contra} en contra, ${cuenta(l.abstenciones, "abstención", "abstenciones")}, ${cuenta(l.ausencias, "ausencia", "ausencias")} (${pct(l.ausencia)}). ${cuenta(l.iniciativas, "iniciativa", "iniciativas")} (${cuenta(l.iniciativas_aprobadas, "aprobada", "aprobadas")}). ${l.url}`,
  );
  return `# Legisladores (${r.total}${r.total > r.legisladores.length ? `, se muestran ${r.legisladores.length}` : ""}; orden: ${r.orden})

Por grupo: ${grupos}.

${r.nota}

${lineas.join("\n")}
`;
}
