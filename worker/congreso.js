// Votaciones, votos con nombre, legisladores y asuntos, con filtros y orden,
// sobre los resúmenes que escribe `scripts/lib/abiertos.mjs`
// (congreso/votaciones.json, congreso/legisladores.json y congreso/_/).
// Solo filtra, ordena y cuenta.

import { plano } from "./texto.js";
import { ErrorDatos, json, catalogo, paginar, pieDePagina } from "./datos.js";
import { documentoDe } from "./ley.js";
import { asuntoDe, coleccionDeTipo, lineaAsunto, posicionesCon } from "./busqueda.js";

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

const esFalso = (x) => x === false || x === "false";
const cuenta = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)} %`);

const SIN_DATOS = "Los datos del Congreso no están disponibles en este despliegue.";

// ------------------------------------------------------------------ votaciones

async function leerVotaciones(env) {
  const r = await json(env, "congreso/votaciones.json");
  if (!r) throw new ErrorDatos(SIN_DATOS);
  return r;
}

// Hasta dónde llegan las votaciones publicadas, para que una consulta sin
// resultados no se lea como «nunca se votó».
function coberturaVotaciones(r) {
  const fechas = r.votaciones.map((v) => v.fecha).filter(Boolean).sort();
  return {
    votaciones: r.votaciones.length,
    desde: fechas[0] ?? null,
    hasta: fechas.at(-1) ?? null,
    camaras: [...new Set(r.votaciones.map((v) => v.camara).filter(Boolean))].sort(),
    nota: "Votaciones nominales del Congreso de la Unión; no hay datos de antes de `desde` ni de los congresos de los estados.",
  };
}
const mdCobertura = (c) => `Cobertura: ${c.votaciones} votaciones nominales del ${c.desde} al ${c.hasta} (${c.camaras.join(", ")}); no hay datos de antes ni de los congresos de los estados.`;

// Las votaciones que pasan los filtros comunes, cada una con su posición en
// el archivo (la que usan los trozos de votos con nombre).
async function filtrar(env, r, { camara, documento, texto, grupo_en_contra, desde, hasta, en_lo_general } = {}) {
  let doc = null;
  if (documento) {
    doc = documentoDe(await catalogo(env), documento);
    if (!doc) throw new ErrorDatos(`No hay un documento «${documento}». Su clave se busca con buscar_documentos.`);
  }
  const ps = plano(texto ?? "").split(/\s+/).filter(Boolean);
  const filas = [];
  r.votaciones.forEach((v, posicion) => {
    if (
      deCamara(v.camara, camara) &&
      (!desde || (v.fecha ?? "") >= desde) &&
      (!hasta || (v.fecha ?? "") <= hasta) &&
      (en_lo_general == null || v.en_lo_general === (en_lo_general === true || en_lo_general === "true")) &&
      (!doc || v.leyes.some((l) => l.documento === doc.documento)) &&
      ps.every((p) => plano(`${v.asunto ?? ""} ${v.resultado ?? ""}`).includes(p)) &&
      (!grupo_en_contra || v.por_grupo.some((g) => deGrupo(g.grupo, grupo_en_contra) && g.en_contra > g.a_favor))
    ) {
      filas.push({ v, posicion });
    }
  });
  return filas;
}

const ORDENES = {
  fecha: (a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""),
  division: (a, b) => b.division - a.division || b.a_favor + b.en_contra - (a.a_favor + a.en_contra),
  en_contra: (a, b) => b.en_contra - a.en_contra,
  ausentes: (a, b) => b.ausentes - a.ausentes,
};
function ordenar(xs, orden) {
  if (!ORDENES[orden]) throw new ErrorDatos(`Orden desconocido: ${orden}. Usa ${Object.keys(ORDENES).join(", ")}.`);
  return xs.sort(ORDENES[orden]);
}

export async function votaciones(env, { orden = "fecha", agrupar = true, limite, pagina, ...filtros } = {}) {
  const r = await leerVotaciones(env);
  let xs = ordenar((await filtrar(env, r, filtros)).map(({ v }) => v), orden);
  // Un mismo asunto se vota varias veces (en lo general, en lo particular, en
  // cada cámara): agrupado, queda la primera de cada asunto y cámara en el
  // orden pedido, con cuántas más hubo.
  if (!esFalso(agrupar)) {
    // Copias: las filas vienen de la memoria del isolate, compartida entre peticiones.
    const vistos = new Map();
    for (const v of xs) {
      const k = `${v.camara}|${v.expediente ?? plano(v.asunto ?? v.id)}`;
      if (vistos.has(k)) vistos.get(k).otras_del_asunto++;
      else vistos.set(k, { ...v, otras_del_asunto: 0 });
    }
    xs = [...vistos.values()];
  }
  const p = paginar(xs, { limite, pagina }, 20, 100);
  return { total: p.total, pagina: p.pagina, paginas: p.paginas, orden, nota: r.nota, cobertura: coberturaVotaciones(r), votaciones: p.elementos };
}

const resumenGrupos = (v) =>
  v.por_grupo
    .filter((g) => g.a_favor + g.en_contra + g.abstenciones)
    .map((g) => `${g.grupo} ${g.a_favor}-${g.en_contra}${g.abstenciones ? `-${g.abstenciones}` : ""}`)
    .join(", ");

// Sin conteo por grupo de la fuente, se contó del voto de cada legislador.
const deLosVotos = (v) => (v.por_grupo_origen === "votos_con_nombre" ? ", de los votos con nombre" : "");

const cuentasDe = (v) =>
  `${v.a_favor} a favor, ${v.en_contra} en contra, ${cuenta(v.abstenciones, "abstención", "abstenciones")}, ${cuenta(v.ausentes, "ausente", "ausentes")} (división ${v.division})`;
const leyesDe = (v) => v.leyes.map((l) => `${l.nombre ?? l.documento} (\`${l.documento}\`${l.origen === "asunto" ? ", por el asunto" : ""})`).join("; ");

function lineaVotacion(v, extra = "") {
  const leyes = leyesDe(v);
  const otras = v.otras_del_asunto ? ` (${v.otras_del_asunto === 1 ? "y otra votación" : `y ${v.otras_del_asunto} votaciones más`} de este asunto en esta cámara)` : "";
  return `- **${v.fecha ?? "s/f"} · ${v.camara}** · \`${v.id}\`${extra} · ${cuentasDe(v)}
  ${v.asunto ?? v.resultado ?? ""}${otras}${leyes ? `\n  Leyes: ${leyes}` : ""}${resumenGrupos(v) ? `\n  Por grupo (a favor-en contra-abstenciones${deLosVotos(v)}): ${resumenGrupos(v)}` : ""}
  ${v.url}`;
}

const cabecera = (titulo, r, n) => `# ${titulo} (${r.total}${r.total > n ? `, se muestran ${n}` : ""}${r.orden ? `; orden: ${r.orden}` : ""})`;

export function mdVotaciones(r) {
  if (!r.votaciones.length) return `Ninguna votación coincide. ${mdCobertura(r.cobertura)}\n`;
  return `${cabecera("Votaciones", r, r.votaciones.length)}

${r.nota} Quién votó qué en una: herramienta \`votacion\` con su id. ${mdCobertura(r.cobertura)}

${r.votaciones.map((v) => lineaVotacion(v)).join("\n")}
${pieDePagina(r)}`;
}

// ------------------------------------------------------------------ por ley

const ORDENES_LEY = {
  divididas: (a, b) => b.divididas - a.divididas || b.division_maxima - a.division_maxima,
  votaciones: (a, b) => b.votaciones - a.votaciones || b.divididas - a.divididas,
  proporcion: (a, b) => b.proporcion - a.proporcion || b.divididas - a.divididas,
  division_maxima: (a, b) => b.division_maxima - a.division_maxima,
};

export async function votacionesPorLey(env, { division_minima = 0.2, orden = "divididas", limite, pagina, ...filtros } = {}) {
  const r = await leerVotaciones(env);
  const umbral = Number(division_minima);
  if (!(umbral >= 0 && umbral <= 0.5)) throw new ErrorDatos("`division_minima` va de 0 a 0.5.");
  if (!ORDENES_LEY[orden]) throw new ErrorDatos(`Orden desconocido: ${orden}. Usa ${Object.keys(ORDENES_LEY).join(", ")}.`);
  const filas = await filtrar(env, r, filtros);
  const porLey = new Map();
  const sin = { votaciones: 0, divididas: 0 };
  for (const { v } of filas) {
    const dividida = v.division >= umbral;
    if (!v.leyes.length) {
      sin.votaciones++;
      if (dividida) sin.divididas++;
    }
    for (const l of v.leyes) {
      if (!porLey.has(l.documento)) porLey.set(l.documento, { documento: l.documento, nombre: l.nombre, url: l.url, votaciones: 0, divididas: 0, suma: 0, division_maxima: -1, mas_dividida: null });
      const x = porLey.get(l.documento);
      x.votaciones++;
      x.suma += v.division;
      if (dividida) x.divididas++;
      if (v.division > x.division_maxima) {
        x.division_maxima = v.division;
        x.mas_dividida = { id: v.id, fecha: v.fecha, camara: v.camara, a_favor: v.a_favor, en_contra: v.en_contra, url: v.url };
      }
    }
  }
  const leyes = [...porLey.values()]
    .map(({ suma, ...x }) => ({ ...x, proporcion: Math.round((x.divididas / x.votaciones) * 1000) / 1000, division_media: Math.round((suma / x.votaciones) * 1000) / 1000 }))
    .sort(ORDENES_LEY[orden]);
  const fechas = filas.map(({ v }) => v.fecha).filter(Boolean).sort();
  const p = paginar(leyes, { limite, pagina }, 20, 100);
  return {
    total: p.total,
    pagina: p.pagina,
    paginas: p.paginas,
    orden,
    division_minima: umbral,
    votaciones_contadas: filas.length,
    periodo: { desde: fechas[0] ?? null, hasta: fechas.at(-1) ?? null },
    sin_ley: sin,
    nota: `Una votación es «dividida» si su \`division\` (la parte de los votos emitidos que tuvo el lado perdedor; 0 unanimidad, 0.5 empate) es de al menos ${umbral}. Cuenta cada votación nominal, también las de artículos reservados, en cada ley que reformó su decreto o que su asunto reforma o expide por su nombre; una votación de varias leyes cuenta en cada una. Una misma votación publicada por dos fuentes y que no está ligada cuenta dos veces.`,
    leyes: p.elementos,
  };
}

export function mdVotacionesPorLey(r) {
  if (!r.leyes.length) return "Ninguna votación con ley coincide.\n";
  const lineas = r.leyes.map(
    (l) =>
      `- **${l.nombre ?? l.documento}** (\`${l.documento}\`): ${cuenta(l.divididas, "votación dividida", "votaciones divididas")} de ${l.votaciones} (${pct(l.proporcion)}); división media ${l.division_media}, máxima ${l.division_maxima} (\`${l.mas_dividida.id}\`, ${l.mas_dividida.fecha ?? "s/f"}, ${l.mas_dividida.camara}, ${l.mas_dividida.a_favor}-${l.mas_dividida.en_contra}, ${l.mas_dividida.url})`,
  );
  return `${cabecera("Votaciones por ley", r, r.leyes.length)}

${r.votaciones_contadas} votaciones del ${r.periodo.desde} al ${r.periodo.hasta}; no hay datos de antes ni de después. ${r.nota} Sin ley publicada a la que atribuirlas (leyes de ingresos, presupuestos, leyes nuevas sin publicar aquí, nombramientos, acuerdos): ${r.sin_ley.votaciones} votaciones, ${r.sin_ley.divididas} divididas.

${lineas.join("\n")}
${pieDePagina(r)}`;
}

// ------------------------------------------------------------------ votos con nombre

const POR_TROZO_VOTOS = 25;
const POR_TROZO_PERSONAS = 100;
const SENTIDOS = [
  ["a_favor", "f", "A favor"],
  ["en_contra", "c", "En contra"],
  ["abstenciones", "a", "Abstención"],
  ["ausentes", "u", "Ausente"],
  ["sin_votar", "s", "Presente sin votar"],
];
const ALIAS_SENTIDO = { abstencion: "abstenciones", ausente: "ausentes" };
function sentidoPedido(s) {
  if (!s) return null;
  const k = plano(s).trim().replace(/\s+/g, "_");
  const x = SENTIDOS.find(([clave]) => clave === (ALIAS_SENTIDO[k] ?? k));
  if (!x) throw new ErrorDatos(`Sentido desconocido: ${s}. Usa a_favor, en_contra, abstencion, ausente o sin_votar.`);
  return x;
}

async function leerVotantes(env) {
  const xs = await json(env, "congreso/_/votantes.json");
  if (!xs) throw new ErrorDatos("Los votos con nombre no están disponibles en este despliegue.");
  return xs;
}

export async function votacion(env, { id, sentido, grupo } = {}) {
  const r = await leerVotaciones(env);
  const pedido = String(id ?? "").trim().replace(/^.*\/votaciones\//, "");
  const posicion = r.votaciones.findIndex((v) => v.id === pedido);
  if (posicion < 0) throw new ErrorDatos(`No hay una votación «${id}». Los id los da la herramienta votaciones (por ejemplo «sil-5135887-1»).`);
  const v = r.votaciones[posicion];
  const s = sentidoPedido(sentido);
  const trozo = v.votos_con_nombre ? await json(env, `congreso/_/votos/${Math.floor(posicion / POR_TROZO_VOTOS)}.json`) : null;
  const ficha = trozo?.[posicion % POR_TROZO_VOTOS] ?? null;
  const votantes = ficha ? await leerVotantes(env) : [];
  const votos = [];
  for (let i = 0; i < (ficha?.votos.length ?? 0); i += 3) {
    const [persona, nombre] = votantes[ficha.votos[i]];
    const voto = { id: persona, nombre, sentido: SENTIDOS[ficha.votos[i + 1]][0], grupo: ficha.grupos[ficha.votos[i + 2]] };
    if ((!s || voto.sentido === s[0]) && (!grupo || deGrupo(voto.grupo, grupo))) votos.push(voto);
  }
  votos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return {
    ...v,
    fuente_de_los_nombres: ficha?.fuente ?? null,
    // Sin lista de nombres, las otras del mismo asunto y cámara que sí la tienen.
    con_nombres_del_asunto: ficha || !v.expediente ? [] : r.votaciones.filter((x) => x.expediente === v.expediente && x.camara === v.camara && x.votos_con_nombre).map((x) => x.id),
    sin_nombre: (ficha?.sin_nombre ?? []).filter((f) => (!s || f.sentido === s[0]) && (!grupo || deGrupo(f.grupo, grupo))),
    filtro: { sentido: s?.[0] ?? null, grupo: grupo ?? null },
    votos,
  };
}

export function mdVotacion(v) {
  const leyes = leyesDe(v);
  const partes = [
    `# Votación \`${v.id}\`: ${v.fecha ?? "s/f"} · ${v.camara}`,
    `${v.asunto ?? ""}${v.resultado && v.resultado !== v.asunto ? `\n\n${v.resultado}` : ""}`,
    `${cuentasDe(v)}.${resumenGrupos(v) ? ` Por grupo (a favor-en contra-abstenciones${deLosVotos(v)}): ${resumenGrupos(v)}.` : ""}${leyes ? `\n\nLeyes: ${leyes}.` : ""}${v.decreto ? `\n\nDecreto: ${v.decreto.titulo} (DOF ${v.decreto.fecha}) ${v.decreto.dof ?? ""}` : ""}${v.otras_fuentes?.length ? `\n\nLa misma votación según otra fuente: ${v.otras_fuentes.map((x) => `\`${x}\``).join(", ")}.` : ""}`,
  ];
  if (!v.votos_con_nombre) {
    partes.push(`La fuente no publica el voto de cada legislador en esta votación: solo las cuentas.${v.con_nombres_del_asunto.length ? ` Del mismo asunto en esta cámara sí lo tienen: ${v.con_nombres_del_asunto.map((x) => `\`${x}\``).join(", ")}.` : ""}`);
  }
  else {
    const filtro = [v.filtro.sentido, v.filtro.grupo].filter(Boolean).join(", ");
    partes.push(`## Votos con nombre${filtro ? ` (${filtro})` : ""}: ${v.votos.length}${v.fuente_de_los_nombres !== v.id ? `\n\nLos nombres son los de \`${v.fuente_de_los_nombres}\`.` : ""}`);
    for (const [clave, , titulo] of SENTIDOS) {
      const xs = v.votos.filter((x) => x.sentido === clave);
      if (!xs.length) continue;
      const grupos = [...new Set(xs.map((x) => x.grupo))].sort((a, b) => xs.filter((x) => x.grupo === b).length - xs.filter((x) => x.grupo === a).length);
      partes.push(`### ${titulo}: ${xs.length}\n\n${grupos.map((g) => `- ${g} (${xs.filter((x) => x.grupo === g).length}): ${xs.filter((x) => x.grupo === g).map((x) => x.nombre).join("; ")}`).join("\n")}`);
    }
    if (v.sin_nombre.length) {
      partes.push(`### Votos que la fuente lista y no se atribuyen a un legislador\n\n${v.sin_nombre.map((f) => `- ${f.grupo ?? "sin grupo"}, ${f.sentido}: ${f.votos}`).join("\n")}`);
    }
    partes.push("Lo que presentó o cómo votó cada persona: herramientas `asuntos` (con `autor`) y `votos_legislador`, con su nombre.");
  }
  partes.push(v.url);
  return `${partes.join("\n\n")}\n`;
}

// Una persona por su id o por las palabras de su nombre; tiene que ser una sola.
function unaPersona(personas, pedido, herramienta) {
  const k = String(pedido ?? "").trim().replace(/^.*\/legisladores\//, "");
  const exacta = personas.find((p) => p.id === k.toLowerCase());
  if (exacta) return exacta;
  const ps = plano(k).split(/\s+/).filter(Boolean);
  const xs = ps.length ? personas.filter((p) => ps.every((w) => plano(p.nombre).includes(w))) : [];
  if (xs.length === 1) return xs[0];
  if (!xs.length) throw new ErrorDatos(`No hay ${herramienta} «${pedido}». Búscalo con la herramienta legisladores (parámetro nombre).`);
  throw new ErrorDatos(`«${pedido}» coincide con ${xs.length} personas; usa el id de una: ${xs.slice(0, 12).map((p) => `${p.nombre} (\`${p.id}\`)`).join(", ")}${xs.length > 12 ? "…" : ""}`);
}

export async function votosLegislador(env, { legislador, sentido, orden = "fecha", limite, pagina, ...filtros } = {}) {
  const r = await leerVotaciones(env);
  const votantes = await leerVotantes(env);
  const persona = unaPersona(votantes.map(([id, nombre]) => ({ id, nombre })), legislador, "un legislador con votos con nombre");
  const i = votantes.findIndex(([id]) => id === persona.id);
  const letras = (await json(env, `congreso/_/votos-persona/${Math.floor(i / POR_TROZO_PERSONAS)}.json`))?.[i % POR_TROZO_PERSONAS] ?? "";
  const s = sentidoPedido(sentido);
  const porLetra = Object.fromEntries(SENTIDOS.map(([clave, letra]) => [letra, clave]));
  const cuentas = Object.fromEntries(SENTIDOS.map(([clave]) => [clave, 0]));
  let xs = [];
  for (const { v, posicion } of await filtrar(env, r, filtros)) {
    const voto = porLetra[letras[posicion]];
    if (!voto) continue;
    cuentas[voto]++;
    if (!s || voto === s[0]) xs.push({ ...v, voto });
  }
  xs = ordenar(xs, orden);
  const ficha = (await json(env, "congreso/legisladores.json"))?.legisladores.find((l) => l.id === persona.id) ?? null;
  const p = paginar(xs, { limite, pagina }, 20, 100);
  return {
    legislador: { id: persona.id, nombre: persona.nombre, camara: ficha?.camara ?? null, grupo: ficha?.grupo ?? null, url: ficha?.url ?? null },
    cuentas,
    sentido: s?.[0] ?? null,
    total: p.total,
    pagina: p.pagina,
    paginas: p.paginas,
    orden,
    cobertura: coberturaVotaciones(r),
    votaciones: p.elementos,
  };
}

export function mdVotosLegislador(r) {
  const l = r.legislador;
  const titulos = Object.fromEntries(SENTIDOS.map(([clave, , titulo]) => [clave, titulo.toLowerCase()]));
  const c = r.cuentas;
  const resumen = `${c.a_favor} a favor, ${c.en_contra} en contra, ${cuenta(c.abstenciones, "abstención", "abstenciones")}, ${cuenta(c.ausentes, "ausencia", "ausencias")}, ${c.sin_votar} presente sin votar`;
  return `${cabecera(`Votos de ${l.nombre}${r.sentido ? ` (${titulos[r.sentido]})` : ""}`, r, r.votaciones.length)}

${[l.camara, l.grupo, l.url].filter(Boolean).join(" · ")}

En las votaciones con nombre que pasan los filtros: ${resumen}. Una votación sin su nombre (la fuente no publicó la lista, o no era legislador) no aparece.

${r.votaciones.length ? r.votaciones.map((v) => lineaVotacion(v, ` · **${titulos[v.voto]}**`)).join("\n") : `Ninguna votación coincide. ${mdCobertura(r.cobertura)}`}
${pieDePagina(r)}`;
}

// ------------------------------------------------------------------ legisladores

export async function legisladores(env, { camara, grupo, entidad, nombre, en_funciones = true, orden = "nombre", minimo_votaciones = 20, limite, pagina } = {}) {
  const r = await json(env, "congreso/legisladores.json");
  if (!r) throw new ErrorDatos(SIN_DATOS);
  const ps = plano(nombre ?? "").split(/\s+/).filter(Boolean);
  const activos = !esFalso(en_funciones);
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
  const p = paginar(xs, { limite, pagina }, 25, 200);
  return { total: p.total, pagina: p.pagina, paginas: p.paginas, por_grupo: porGrupo, orden, nota: r.nota, legisladores: p.elementos };
}

export function mdLegisladores(r) {
  if (!r.legisladores.length) return "Ningún legislador coincide.\n";
  const grupos = Object.entries(r.por_grupo)
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${g} ${n}`)
    .join(", ");
  const lineas = r.legisladores.map(
    (l) =>
      `- **${l.nombre}** (\`${l.id}\`) · ${l.camara ?? ""} · ${l.grupo ?? "sin grupo"}${l.entidad ? ` · ${l.entidad}` : ""}${l.en_funciones ? "" : ` · ${l.estatus}`}
  ${cuenta(l.votaciones, "votación", "votaciones")} con nombre: ${l.a_favor} a favor, ${l.en_contra} en contra, ${cuenta(l.abstenciones, "abstención", "abstenciones")}, ${cuenta(l.ausencias, "ausencia", "ausencias")} (${pct(l.ausencia)}). ${cuenta(l.iniciativas, "iniciativa", "iniciativas")} (${cuenta(l.iniciativas_aprobadas, "aprobada", "aprobadas")}). ${l.url}`,
  );
  return `${cabecera("Legisladores", r, r.legisladores.length)}

Por grupo: ${grupos}.

${r.nota} Sus votos, uno por uno: herramienta \`votos_legislador\`; lo que presentó: \`asuntos\` con \`autor\`.

${lineas.join("\n")}
${pieDePagina(r)}`;
}

// ------------------------------------------------------------------ asuntos

export const TIPOS_ASUNTO = { iniciativa: "Iniciativas", proposicion: "Proposiciones con punto de acuerdo", dictamen: "Dictámenes negativos" };

const comunes = (a, b) => {
  const s = new Set(b);
  return a.filter((x) => s.has(x));
};

export async function asuntos(env, { tipo = "iniciativa", texto, autor, documento, partido, resultado, desde, hasta, limite, pagina } = {}) {
  if (!TIPOS_ASUNTO[tipo]) throw new ErrorDatos(`Tipo desconocido: ${tipo}. Usa ${Object.keys(TIPOS_ASUNTO).join(", ")}.`);
  const coleccion = `congreso/${tipo}`;
  const f = await json(env, `congreso/_/${tipo}/f.json`);
  const col = await coleccionDeTipo(env, coleccion);
  if (!f || !col) throw new ErrorDatos(SIN_DATOS);
  // Cada filtro con índice da sus posiciones; las fichas vienen de la más
  // reciente a la más antigua, así que la posición ya es el orden.
  let posiciones = null;
  const cruzar = (xs) => {
    posiciones = posiciones ? comunes(posiciones, xs) : [...xs];
  };
  const busqueda = texto ? await posicionesCon(env, coleccion, texto) : null;
  if (busqueda) cruzar(busqueda.posiciones);
  let persona = null;
  if (autor) {
    const ls = (await json(env, "congreso/legisladores.json"))?.legisladores ?? [];
    persona = unaPersona(ls, autor, "un legislador");
    cruzar(f.autores[persona.id] ?? []);
  }
  let doc = null;
  if (documento) {
    doc = documentoDe(await catalogo(env), documento);
    if (!doc) throw new ErrorDatos(`No hay un documento «${documento}». Su clave se busca con buscar_documentos.`);
    cruzar(f.leyes[doc.documento] ?? []);
  }
  if (resultado && !f.resultados.includes(resultado)) throw new ErrorDatos(`Resultado desconocido: ${resultado}. Usa ${f.resultados.filter(Boolean).join(", ")}.`);
  const xs = (posiciones ?? Array.from({ length: f.n }, (_, i) => i))
    .filter(
      (i) =>
        (!desde || (f.fechas[i] ?? "") >= desde) &&
        (!hasta || (f.fechas[i] ?? "") <= hasta) &&
        (!resultado || f.resultados[f.resultado[i]] === resultado) &&
        (!partido || deGrupo(f.partidos[f.partido[i]] ?? "", partido)),
    )
    .sort((a, b) => a - b);
  const porResultado = {};
  for (const i of xs) porResultado[f.resultados[f.resultado[i]] ?? "sin dato"] = (porResultado[f.resultados[f.resultado[i]] ?? "sin dato"] ?? 0) + 1;
  const fechas = f.fechas.filter(Boolean);
  const p = paginar(xs, { limite, pagina }, 20, 100);
  return {
    tipo,
    total: p.total,
    pagina: p.pagina,
    paginas: p.paginas,
    por_resultado: porResultado,
    autor: persona ? { id: persona.id, nombre: persona.nombre } : null,
    documento: doc?.documento ?? null,
    palabras_ignoradas: busqueda?.ignoradas ?? [],
    periodo: { desde: fechas.at(-1) ?? null, hasta: fechas[0] ?? null, en_total: f.n },
    asuntos: (await Promise.all(p.elementos.map((i) => asuntoDe(env, col, i)))).filter(Boolean),
  };
}

export function mdAsuntos(r) {
  const filtros = [r.autor && `de ${r.autor.nombre}`, r.documento && `que reforman o expiden \`${r.documento}\` por su nombre`].filter(Boolean).join(", ");
  const resumen = Object.entries(r.por_resultado)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  return `${cabecera(`${TIPOS_ASUNTO[r.tipo]}${filtros ? ` ${filtros}` : ""}`, r, r.asuntos.length)}

De congreso-mexicano (SIL): ${r.periodo.en_total} en total, presentadas del ${r.periodo.desde} al ${r.periodo.hasta}; no hay datos de antes. De la más reciente a la más antigua.${resumen ? ` Por desenlace: ${resumen}.` : ""}${r.palabras_ignoradas.length ? ` Se ignoraron por comunes: ${r.palabras_ignoradas.join(", ")}.` : ""}

${r.asuntos.length ? r.asuntos.map((a) => lineaAsunto(r.tipo, a)).join("\n") : "Ningún asunto coincide."}
${pieDePagina(r)}`;
}
