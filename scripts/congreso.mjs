// /congreso: quién vota qué y qué presenta cada legislador, de
// congreso-mexicano (scripts/lib/congreso.mjs). Sin una página por asunto: son
// decenas de miles; cada uno se lista en la página de su autor y en la de su
// expediente, con enlace al SIL y a su JSON.
//
//   /congreso/                        qué es, de dónde sale, cifras, últimas votaciones
//   /congreso/votaciones/             todas las votaciones nominales, por mes
//   /congreso/votaciones/{id}         una votación: conteos, voto de cada quien y lo que no cuadra
//   /congreso/legisladores/           por cámara y grupo parlamentario
//   /congreso/legisladores/{persona}  mandatos, votos y lo que presentó
//   /congreso/expedientes/            los expedientes del SIL publicados
//   /congreso/expedientes/{id}        cronología, asuntos, votaciones y decreto
//
// Lo que la fuente publica se muestra tal como viene: los votos que cuenta y
// no atribuye a nadie, sus inconsistencias, las diferencias con otra fuente y
// los registros que dejó de publicar quedan a la vista, no se corrigen.

import { ESTADOS, ORG, esc, numero, plural, lista, fechaLarga, momento, tabla, documento as paginaHtml } from "./lib/comun.mjs";
import { ASUNTOS, BASE_CONGRESO, urlVotacion, urlLegislador, urlExpediente, urlSilExpediente, urlDato, urlFoto } from "./lib/congreso.mjs";
import { historiaDe } from "./bitacora.mjs";
import {
  ESTILO_HEMICICLO,
  asientosVotacion,
  composicion,
  figuraHemiciclo,
  grupo as grupoHemiciclo,
  listaDisidentes,
  lugar,
  resumenGrupos,
  resumenSentidos,
  svgMini,
} from "./lib/hemiciclo.mjs";

const REPO = "congreso-mexicano";
const ULTIMAS_EN_INDICE = 15;
// Denominaciones en tablas: la completa está en la página de la votación.
const RECORTE = 200;

const OPCIONES = [
  ["yes", "A favor"],
  ["no", "En contra"],
  ["abstain", "Abstención"],
  ["not voting", "Solo asistencia (quórum)"],
  ["absent", "Ausente"],
];
const NOMBRE_OPCION = Object.fromEntries(OPCIONES);
const opcion = (o) => NOMBRE_OPCION[o] ?? o;

const RESULTADO_VOTACION = { pass: "Aprobada", fail: "Rechazada" };
const RESULTADO_ECONOMICA = { pass: "Aprobada", fail: "Rechazada o desechada" };
const RESULTADO_ASUNTO = { pendiente: "Pendiente", aprobado: "Aprobado", desechado: "Desechado", retirado: "Retirado" };
const ORDEN_RESULTADO = ["pendiente", "aprobado", "desechado", "retirado"];
const TIPO_ASUNTO = { iniciativas: "Iniciativa", proposiciones: "Proposición", dictamenesNegativos: "Dictamen negativo" };
const CARPETA_ASUNTO = Object.fromEntries(Object.entries(ASUNTOS).map(([carpeta, clave]) => [clave, carpeta]));
const PRINCIPIO = {
  "mayoria-relativa": "mayoría relativa",
  "representacion-proporcional": "representación proporcional",
  "primera-minoria": "primera minoría",
};
const CAMARAS = [
  ["camara-de-diputados", "diputados", "Cámara de Diputados"],
  ["senado", "senado", "Senado"],
  ["comision-permanente", "permanente", "Comisión Permanente"],
];
const CAMARA_CORTA = Object.fromEntries(CAMARAS.map(([, c, n]) => [c, n]));
const ORG_CORTA = Object.fromEntries(CAMARAS.map(([o, , n]) => [o, n]));
const FUENTE_VOTACION = { sil: "SIL de Gobernación", senado: "sitio de votaciones del Senado", gaceta: "Gaceta Parlamentaria" };
const NOMBRES_ESTADOS = Object.fromEntries(ESTADOS);

const fuenteDe = (v) => FUENTE_VOTACION[v.id.split("-")[0]] ?? v.id.split("-")[0];
const camaraDe = (v) => CAMARA_CORTA[v.camara] ?? ORG_CORTA[v.organization_id] ?? v.camara ?? "—";
const fecha = (iso) => (iso ? `<span class="fecha">${fechaLarga(iso.slice(0, 10))}</span>` : "sin fecha");
const fechaCorta = (iso) => (iso ? `<span class="dato">${esc(iso.slice(0, 10))}</span>` : "—");
const sinSufijo = (s) => (s ?? "").replace(/\(a\)$/, "").trim();

function recortar(s, n = RECORTE) {
  const t = String(s ?? "");
  if (t.length <= n) return t;
  const corte = t.lastIndexOf(" ", n);
  return `${t.slice(0, corte > n / 2 ? corte : n)}…`;
}

// Rutas de cada registro en congreso-mexicano, para enlazar a su JSON.
const rutaVotacion = (v) => `votaciones/${v.legislative_period_id}/${v.camara}/${v.id}.json`;
const rutaExpediente = (e) => `expedientes/${e.id}.json`;
const rutaPersona = (p) => `personas/${p.id}.json`;
const rutaMandato = (m) => `mandatos/${m.legislative_period_id}/${m.organization_id === "senado" ? "senado" : "diputados"}/${m.id.replace(/^sil-/, "")}.json`;
const rutaAsunto = (tipo, a) => `${CARPETA_ASUNTO[tipo]}/${a.legislative_period_id}/${a.id}.json`;
const rutaDecreto = (d) => `decretos/${d.fecha.slice(0, 4)}/${d.id}.json`;

const enlaceJson = (ruta, texto = "JSON") => `<a href="${esc(urlDato(ruta))}">${texto}</a>`;

function nombrePersona(m, id) {
  return m.personas.get(id)?.name ?? id;
}
const enlacePersona = (m, id) => `<a href="${esc(urlLegislador(id))}">${esc(nombrePersona(m, id))}</a>`;

// Orden alfabético por apellido, como las listas oficiales.
function porApellido(m) {
  const clave = (id) => {
    const p = m.personas.get(id);
    return `${p?.family_name ?? ""} ${p?.given_name ?? p?.name ?? id}`;
  };
  return (a, b) => clave(a).localeCompare(clave(b), "es");
}

const porFechaDesc = (a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? "") || b.id.localeCompare(a.id);

function agrupar(xs, clave) {
  const g = new Map();
  for (const x of xs) {
    const k = clave(x);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(x);
  }
  return g;
}

const conteo = (v, o) => v.counts?.find((c) => c.option === o)?.value;

function conteosEnLinea(v) {
  return (v.counts ?? [])
    .map((c) => `${esc(opcion(c.option))} <span class="dato">${numero(c.value)}</span>`)
    .join(" · ");
}

// «Votación 2 del asunto» cuando un asunto tuvo varias nominales (lo general
// y lo particular, por ejemplo).
function ordinal(m, v) {
  const n = m.votacionesPorAsunto.get(claveAsunto(v))?.length ?? 0;
  return v.asunto && n > 1 && v.orden ? `votación ${v.orden} de ${n} del asunto` : "";
}

// Solo cuentan las votaciones del asunto en la misma fuente: la del Senado o la
// Gaceta es otro registro de la misma votación.
const claveAsunto = (v) => `${v.id.split("-")[0]}|${v.organization_id}|${v.asunto}`;

function tituloVotacion(v) {
  return v.motion?.denominacion || v.motion?.text || v.id;
}

function avisoRetirada(r, que) {
  const x = r.retirada_de_la_fuente;
  if (!x) return "";
  return `<p class="aviso">La fuente dejó de publicar ${que}; se notó el ${fecha(x.detectada)}. Se conserva la última versión obtenida${
    x.nota ? ` <span class="tenue">(${esc(x.nota)})</span>` : ""
  }.</p>`;
}

function fuentes(r) {
  if (!r.sources?.length) return '<p class="tenue">Sin fuentes registradas.</p>';
  return `<ul class="fuentes">
${r.sources
  .map(
    (s) =>
      `<li><a href="${esc(s.url)}">${esc(s.url)}</a> <span class="tenue">· consultada el ${s.consultado ? momento(s.consultado) : "—"}${
        s.sha256 ? ` · SHA-256 <code>${esc(s.sha256.slice(0, 16))}…</code>` : ""
      }${s.archivo ? ` · <a href="${esc(urlDato(s.archivo))}">copia</a>` : ""}</span></li>`,
  )
  .join("\n")}
</ul>`;
}

const ficha = (filas) =>
  `<dl class="ficha">\n${filas
    .filter(Boolean)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join("\n")}\n</dl>`;

// ------------------------------------------------------------------ página

const ESTILO = `
.mini-yo{max-width:15rem;margin:0 0 1.5rem}
.retrato { float: right; margin: 0 0 1rem 1.25rem; font-size: 0.7em; color: var(--tenue); text-align: center; }
.retrato img { display: block; width: 145px; height: auto; aspect-ratio: 145 / 181; border-radius: 4px; background: var(--linea); }
.retrato figcaption { margin-top: 0.3em; }
.miniretrato { width: 1.6em; height: 2em; object-fit: cover; border-radius: 2px; vertical-align: middle; margin-right: 0.5em; background: var(--linea); }
@media (max-width: 30rem) { .retrato { float: none; margin: 0 0 1rem; } }
.sobre { margin: -2.5rem 0 1.25rem; font-size: 0.9em; color: var(--tenue); }
.ficha { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.35em 1.2em; margin: 0 0 2rem; font-size: 0.85em; }
.ficha dt { color: var(--tenue); }
.ficha dd { margin: 0; overflow-wrap: anywhere; }
.fecha { white-space: nowrap; }
.cuenta { color: var(--tenue); font-size: 0.85em; font-weight: 400; font-variant-numeric: tabular-nums; }
.fuentes { padding-left: 1.2em; font-size: 0.8em; overflow-wrap: anywhere; }
.lista { list-style: none; padding: 0; margin: 0 0 2rem; }
.lista > li { margin: 0; padding: 0.6rem 0; border-bottom: 1px solid var(--linea); }
.l-titulo { margin: 0; font-size: 0.9em; line-height: 1.4; }
.l-datos { margin: 0.15rem 0 0; font-size: 0.75em; line-height: 1.5; color: var(--tenue); }
.sentido { margin: 2rem 0 0.4rem; font-size: 0.95em; font-weight: 600; }
.votos { margin: 0 0 1rem; font-size: 0.85em; }
.votos dt { margin: 0.8em 0 0.15em; font-weight: 600; }
.votos dd { margin: 0; line-height: 1.6; }
.sin-atribuir { margin: 0.2em 0 0; color: var(--tenue); }
.aviso ul { margin: 0.4em 0 0; font-size: 0.9em; }
td.texto { min-width: 16em; }
`;

// Las páginas con hemiciclo cargan su estilo y public/hemiciclo.js.
const SCRIPT_HEMICICLO = '<script src="/hemiciclo.js" defer></script>';

// `hemiciclo`: false, "css" (solo miniaturas) o "js" (hemiciclo interactivo).
function pagina({ titulo, h1, descripcion, cuerpo, generada, url, tarjeta, sobre = "", hemiciclo = false }) {
  return paginaHtml({
    ruta: `${BASE_CONGRESO}/`,
    url,
    tarjeta,
    titulo: `${titulo} — OpenCodice`,
    h1,
    descripcion,
    estilo: hemiciclo ? `${ESTILO}${ESTILO_HEMICICLO}` : ESTILO,
    cabeza: hemiciclo === "js" ? SCRIPT_HEMICICLO : "",
    cuerpo: `${sobre}${cuerpo}`,
    pie: `<p>
          <a href="${BASE_CONGRESO}/">Congreso</a> · <a href="${BASE_CONGRESO}/camaras">Cámaras</a> · <a href="${BASE_CONGRESO}/votaciones/">Votaciones</a> ·
          <a href="${BASE_CONGRESO}/legisladores/">Legisladores</a> · <a href="${BASE_CONGRESO}/expedientes/">Expedientes</a> ·
          <a href="https://github.com/${ORG}/${REPO}">Datos en ${ORG}/${REPO}</a>
        </p>
        <p>Generada el ${momento(generada)} de ${ORG}/${REPO}, que sale del SIL de Gobernación, el DOF, el sitio del Senado y la Gaceta Parlamentaria. No sustituye a las fuentes oficiales.</p>`,
  });
}

const migas = (...partes) =>
  `<p class="sobre">${[`<a href="${BASE_CONGRESO}/">Congreso</a>`, ...partes].filter(Boolean).join(" · ")}</p>`;

// ------------------------------------------------------------------ índice

function cuentaResultados(asuntos) {
  const n = Object.fromEntries(ORDEN_RESULTADO.map((r) => [r, 0]));
  let otros = 0;
  for (const a of asuntos) {
    const r = a.estatus?.resultado;
    if (r in n) n[r]++;
    else otros++;
  }
  return { n, otros };
}

function lineaResultados(asuntos, genero = "a") {
  const { n, otros } = cuentaResultados(asuntos);
  const fem = (r) => RESULTADO_ASUNTO[r].toLowerCase().replace(/o$/, genero);
  const partes = ORDEN_RESULTADO.map((r) => `${numero(n[r])} ${n[r] === 1 ? fem(r) : `${fem(r)}s`}`);
  if (otros) partes.push(`${numero(otros)} sin desenlace en la fuente`);
  return lista(partes);
}

// "OpenCodice/congreso-extractor:lecturas/…" → el archivo en GitHub.
const registroLectura = (r) => {
  const [repo, ruta] = String(r).split(":");
  return `https://github.com/${repo}/blob/main/${ruta}`;
};

function filaVotacion(m, v, { conCamara = true } = {}) {
  const res = RESULTADO_VOTACION[v.result] ?? "sin resultado en la fuente";
  const marcas = [];
  if (!v.votos_publicados) marcas.push("solo conteos");
  if (v.votos_faltantes?.length) marcas.push("votos sin atribuir");
  if (v.inconsistencias?.length) marcas.push("inconsistencias de la fuente");
  if (v.discrepancias?.length) marcas.push("difiere de otra fuente");
  if (v.retirada_de_la_fuente) marcas.push("retirada de la fuente");
  if (v.lecturas?.length) marcas.push("leída por agente, verificada");
  const extra = [ordinal(m, v), v.id.startsWith("sil-") ? "" : `según el ${fuenteDe(v)}`].filter(Boolean);
  return `<li>
<p class="l-titulo"><a href="${esc(urlVotacion(v.id))}">${esc(recortar(tituloVotacion(v)))}</a></p>
<p class="l-datos">${fecha(v.start_date)}${conCamara ? ` · ${esc(camaraDe(v))}` : ""} · ${res} · ${conteosEnLinea(v)}${
    extra.length ? ` · ${esc(extra.join(" · "))}` : ""
  }${marcas.length ? ` · <strong>${esc(marcas.join(" · "))}</strong>` : ""}</p>
</li>`;
}

function paginaIndice(m, generada) {
  const vs = [...m.votaciones.values()];
  const conVotos = vs.filter((v) => v.votos_publicados).length;
  const porFuente = agrupar(vs, fuenteDe);
  const mandatos = [...m.mandatos.values()];
  const porCamara = (org) => mandatos.filter((x) => x.organization_id === org).length;
  const ini = m.asuntos.iniciativas ?? [];
  const pro = m.asuntos.proposiciones ?? [];
  const legislaturas = [...new Set(vs.map((v) => v.legislative_period_id).concat(mandatos.map((x) => x.legislative_period_id)))]
    .filter(Boolean)
    .map((l) => l.toUpperCase());
  const nFaltan = vs.filter((v) => v.votos_faltantes?.length).length;
  const nIncons = vs.filter((v) => v.inconsistencias?.length).length;
  const nDiscr = vs.filter((v) => v.discrepancias?.length).length;
  const nRetiradas = vs.filter((v) => v.retirada_de_la_fuente).length;
  const decretosConExp = m.decretos.filter((d) => d.expedientes?.length).length;
  const ultimas = vs.sort(porFechaDesc).slice(0, ULTIMAS_EN_INDICE);

  const fila = (href, cifra, nombre, frase) =>
    href
      ? `<a class="fila" href="${href}"><span class="cifra">${numero(cifra)}</span><span><strong>${nombre}.</strong> ${frase}</span><span class="flecha" aria-hidden="true">→</span></a>`
      : `<div class="fila"><span class="cifra">${numero(cifra)}</span><span><strong>${nombre}.</strong> ${frase}</span><span></span></div>`;
  const cuerpo = `<p>
  Cada votación nominal del Congreso de la Unión con el voto de cada diputado o senador, y cada
  iniciativa y proposición con su autor y en qué quedó${
    legislaturas.length ? ` (${lista(legislaturas.map((l) => `${esc(l)} Legislatura`))})` : ""
  }.
</p>
<p class="tenue">
  Los datos salen del <a href="http://sil.gobernacion.gob.mx">Sistema de Información Legislativa</a>
  (SIL) de Gobernación, del sitio de votaciones del Senado, de la Gaceta Parlamentaria de la Cámara
  de Diputados y del Diario Oficial de la Federación. Están en ${`<a href="https://github.com/${ORG}/${REPO}">${ORG}/${REPO}</a>`},
  un registro por archivo, cada uno con la página oficial de la que salió, su fecha de consulta y su
  SHA-256. Los genera un programa (<a href="https://github.com/${ORG}/congreso-extractor">congreso-extractor</a>).
</p>
<p class="botones">
  <a class="boton" href="${BASE_CONGRESO}/votaciones/">Ver las votaciones</a>
  <a class="boton boton-borde" href="${BASE_CONGRESO}/legisladores/">Ver legisladores</a>
  <a href="${BASE_CONGRESO}/camaras">Quién ocupa cada lugar →</a>
</p>

<h2>Qué hay</h2>
<div class="filas">
${[
  fila(
    `${BASE_CONGRESO}/legisladores/`,
    m.personas.size,
    "Legisladores",
    `${plural(porCamara("camara-de-diputados"), "mandato de diputado", "mandatos de diputado")} y ${plural(porCamara("senado"), "de senador", "de senador")}, con propietarios y suplentes.`,
  ),
  fila(
    `${BASE_CONGRESO}/votaciones/`,
    vs.length,
    "Votaciones nominales",
    `${numero(conVotos)} con el voto de cada legislador y ${numero(vs.length - conVotos)} solo con conteos. ${lista([...porFuente].map(([f, xs]) => `${numero(xs.length)} del ${esc(f)}`))}.`,
  ),
  fila(null, ini.length, "Iniciativas", `${lineaResultados(ini).replace(/^./, (l) => l.toUpperCase())}.`),
  fila(null, pro.length, "Proposiciones con punto de acuerdo", `${lineaResultados(pro).replace(/^./, (l) => l.toUpperCase())}.`),
  fila(
    `${BASE_CONGRESO}/expedientes/`,
    m.expedientes.size,
    "Expedientes",
    `Los asuntos del SIL que llegaron a votación nominal, y ${plural(m.decretos.length, "decreto del DOF", "decretos del DOF")}, ${numero(decretosConExp)} ligados a su expediente.`,
  ),
].join("\n")}
</div>

${
  m.composiciones.length
    ? `<h2>Las cámaras hoy</h2>
<div class="minis">
${m.composiciones.map(miniComposicion).join("\n")}
</div>
<p><a href="${BASE_CONGRESO}/camaras">Ver quién ocupa cada lugar →</a></p>
`
    : ""
}
<h2>Lo que no cuadra entre fuentes</h2>
<p>
  Lo que una fuente publica se conserva aunque no cuadre consigo misma o con otra fuente; nada se
  ajusta. En cada votación se explica qué pasa:
</p>
<ul>
  <li>${plural(nFaltan, "votación tiene", "votaciones tienen")} votos que la fuente cuenta pero no atribuye a nadie (un nombre que no da con un único legislador, o un voto que el resumen cuenta y la lista no trae).</li>
  <li>${plural(nIncons, "votación tiene", "votaciones tienen")} inconsistencias de la propia fuente (grupos que no suman el total, listas con votos de más).</li>
  <li>${plural(nDiscr, "votación difiere", "votaciones difieren")} entre dos fuentes (el SIL y el Senado o la Gaceta).</li>
  <li>${plural(nRetiradas, "votación ya no está", "votaciones ya no están")} en su fuente: se conserva la última versión.</li>
</ul>

<h2>Últimas votaciones</h2>
${ultimas.length ? `<ul class="lista">\n${ultimas.map((v) => filaVotacion(m, v)).join("\n")}\n</ul>` : '<p class="tenue">Todavía no hay votaciones.</p>'}
<p><a href="${BASE_CONGRESO}/votaciones/">Ver todas las votaciones →</a></p>

<h2>Lo que no está</h2>
<ul>
  <li>Quién votó en las votaciones económicas: se votan sin registro nominal. Cada expediente las lista con su resultado.</li>
  <li>El voto individual de las votaciones que el SIL solo da como conteos (casi siempre las de lo particular), salvo cuando el Senado o la Gaceta las publican con nombres.</li>
  <li>El sentido del voto de cada congreso local en las reformas constitucionales: el SIL lista los que la aprobaron y solo a veces los que votaron en contra.</li>
  <li>Firmantes adicionales: el SIL registra al autor o autores; una iniciativa suscrita por más legisladores puede listar solo a quien la presentó.</li>
  <li>Cambios de bancada: el partido de cada mandato es el que el SIL muestra hoy; el de cada voto, el que mostró la lista de esa votación.</li>
</ul>`;
  return pagina({
    url: `${BASE_CONGRESO}/`,
    titulo: "Congreso",
    h1: "Congreso",
    descripcion: "Cada votación nominal del Congreso de la Unión con el voto de cada legislador, y lo que presenta cada diputado y senador, de fuentes oficiales.",
    cuerpo,
    generada,
    hemiciclo: m.composiciones.length ? "css" : false,
  });
}

function paginaSinDatos(congreso, generada) {
  return pagina({
    url: `${BASE_CONGRESO}/`,
    titulo: "Congreso",
    h1: "Congreso",
    descripcion: "Las votaciones y legisladores del Congreso de la Unión, de congreso-mexicano.",
    cuerpo: `<p class="aviso">No se pudieron leer los datos del Congreso (${esc(congreso?.error ?? "sin datos")}). Esta versión del sitio sale sin ellos; los datos siguen en <a href="https://github.com/${ORG}/${REPO}">${ORG}/${REPO}</a>.</p>`,
    generada,
  });
}

// ------------------------------------------------------------------ votaciones

function indiceVotaciones(m, generada) {
  const vs = [...m.votaciones.values()].sort(porFechaDesc);
  const porMes = agrupar(vs, (v) => (v.start_date ? v.start_date.slice(0, 7) : "sin fecha"));
  const mes = (k) =>
    k === "sin fecha"
      ? "Sin fecha"
      : new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${k}-01T00:00:00Z`));
  const cuerpo = `${migas()}
<p>
  Las ${plural(vs.length, "votación nominal", "votaciones nominales")} registradas, de la más reciente a la más
  antigua. Se marca la que solo tiene conteos, la que tiene votos que la fuente no atribuye a nadie,
  inconsistencias de la fuente o diferencias con otra fuente.
</p>
${[...porMes]
  .map(([k, xs]) => `<h3 class="sentido">${esc(mes(k))} <span class="cuenta">${numero(xs.length)}</span></h3>\n<ul class="lista">\n${xs.map((v) => filaVotacion(m, v)).join("\n")}\n</ul>`)
  .join("\n")}`;
  return pagina({
    url: `${BASE_CONGRESO}/votaciones/`,
    titulo: "Votaciones del Congreso",
    h1: "Votaciones nominales",
    descripcion: "Todas las votaciones nominales registradas del Congreso de la Unión, con sus conteos.",
    cuerpo,
    generada,
  });
}

// Conteos de la fuente frente a los votos con nombre y los no atribuidos.
function tablaConteos(v) {
  const listados = agrupar(v.votes ?? [], (x) => x.option);
  const faltan = new Map();
  for (const f of v.votos_faltantes ?? []) faltan.set(f.option, (faltan.get(f.option) ?? 0) + f.value);
  const opciones = OPCIONES.map(([o]) => o).filter(
    (o) => conteo(v, o) != null || listados.has(o) || faltan.has(o),
  );
  for (const c of v.counts ?? []) if (!opciones.includes(c.option)) opciones.push(c.option);
  const columnas = [{ titulo: "Sentido" }, { titulo: "Conteo de la fuente", num: true }];
  if (v.votos_publicados) columnas.push({ titulo: "Con nombre", num: true }, { titulo: "Sin atribuir", num: true });
  const filas = opciones.map((o) => {
    const f = [esc(opcion(o)), numero(conteo(v, o))];
    if (v.votos_publicados) f.push(numero(listados.get(o)?.length ?? 0), faltan.get(o) ? `<strong>${numero(faltan.get(o))}</strong>` : "0");
    return f;
  });
  return tabla({ id: "conteos", titulo: "Conteos", columnas, filas });
}

function tablaGrupos(v) {
  const gs = v.group_results ?? [];
  if (!gs.length) return "";
  const opciones = OPCIONES.map(([o]) => o).filter((o) => gs.some((g) => o in g));
  const listados = agrupar(v.votes ?? [], (x) => x.grupo_fuente);
  const columnas = [
    { titulo: "Grupo" },
    ...opciones.map((o) => ({ titulo: opcion(o), num: true })),
    { titulo: "Total", num: true },
  ];
  if (v.votos_publicados) columnas.push({ titulo: "Con nombre", num: true });
  const filas = gs.map((g) => {
    const f = [esc(g.grupo), ...opciones.map((o) => numero(g[o] ?? 0)), numero(g.total ?? opciones.reduce((s, o) => s + (g[o] ?? 0), 0))];
    if (v.votos_publicados) f.push(numero(listados.get(g.grupo)?.length ?? 0));
    return f;
  });
  return tabla({ id: "grupos", titulo: "Resumen por grupo parlamentario, según la fuente", columnas, filas });
}

const signo = (n) => (n > 0 ? `+${numero(n)}` : numero(n));

function seccionNoCuadra(m, v) {
  const partes = [];
  if (v.votos_faltantes?.length) {
    const total = v.votos_faltantes.reduce((s, f) => s + f.value, 0);
    partes.push(`<p class="aviso">${plural(total, "voto que la fuente cuenta no se atribuye", "votos que la fuente cuenta no se atribuyen")} a ningún legislador: ${
      v.votos_faltantes.some((f) => f.nombres_fuente?.length)
        ? "el nombre como lo escribe la fuente no da con un único legislador, o dos filas dan con la misma persona"
        : `el resumen de la fuente ${total === 1 ? "lo cuenta y su lista nominal no lo trae" : "los cuenta y su lista nominal no los trae"}`
    }. Se muestran abajo, en su sentido y grupo, sin adivinar de quién son.</p>`);
  }
  if (v.lecturas?.length) {
    const PAGINA = { votacion: "la página de la votación", tabla: "la tabla de la votación", lista: "la lista nominal" };
    partes.push(`<div class="aviso"><p>${v.lecturas.map((l) => PAGINA[l.pagina] ?? l.pagina).join(" y ")} ${v.lecturas.length > 1 ? "traían" : "traía"} un formato que el programa todavía no lee: ${v.lecturas.length > 1 ? "las leyó" : "la leyó"} un agente, y su lectura se publica porque pasó una verificación automática:</p>
<ul>${(v.lecturas[0].verificacion ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<p class="tenue">Registro: ${v.lecturas.map((l) => `<a href="${esc(registroLectura(l.registro))}">${esc(l.pagina)}</a>`).join(", ")}. Cuando el programa se corrija, su lectura reemplazará a esta.</p></div>`);
  }
  if (v.inconsistencias?.length) {
    partes.push(`<div class="aviso"><p>La fuente no cuadra consigo misma; se publica tal como viene y los conteos no se ajustan:</p>
<ul>${v.inconsistencias.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`);
  }
  const dc = Object.entries(v.diferencia_conteos ?? {});
  const dg = Object.entries(v.diferencia_grupos ?? {});
  if (dc.length || dg.length) {
    const txt = [];
    if (dc.length) txt.push(`por sentido, ${lista(dc.map(([o, n]) => `${esc(opcion(o))} ${signo(n)}`))}`);
    if (dg.length) txt.push(`por grupo, ${lista(dg.map(([g, n]) => `${esc(g)} ${signo(n)}`))}`);
    partes.push(`<p class="aviso">Votos listados (con los no atribuidos) menos el conteo de la fuente: ${txt.join("; ")}.</p>`);
  }
  return partes.join("\n");
}

// Diferencias con la misma votación en otra fuente.
function seccionOtrasFuentes(m, v) {
  const partes = [];
  const opcionEn = (vid, persona) => m.votaciones.get(vid)?.votes?.find((x) => x.voter_id === persona)?.option;
  const personas = (ids, otra) =>
    lista(
      ids.map((id) => {
        const aqui = opcionEn(v.id, id);
        const alla = otra ? opcionEn(otra.id, id) : null;
        const detalle = [aqui && `aquí: ${opcion(aqui)}`, alla && `${fuenteDe(otra)}: ${opcion(alla)}`].filter(Boolean).join("; ");
        return `${enlacePersona(m, id)}${detalle ? ` <span class="tenue">(${esc(detalle)})</span>` : ""}`;
      }),
    );
  if (v.votacion_sil) {
    const sil = m.votaciones.get(v.votacion_sil);
    partes.push(
      `<p>Es la misma votación que ${sil ? `<a href="${esc(urlVotacion(sil.id))}">la del SIL</a>` : `<code>${esc(v.votacion_sil)}</code> del SIL, que no está publicada`}; cada fuente se conserva en su propio registro y ninguna corrige a la otra.</p>`,
    );
  }
  for (const d of v.discrepancias ?? []) {
    const otra = m.votaciones.get(d.votacion);
    const ref = otra ? `<a href="${esc(urlVotacion(otra.id))}">${esc(fuenteDe(otra))}</a>` : `<code>${esc(d.votacion)}</code>`;
    const items = [];
    if (d.counts_sil) items.push(`<li>Conteos del SIL: ${conteosEnLinea({ counts: d.counts_sil })}; aquí: ${conteosEnLinea(v)}.</li>`);
    if (d.votantes_distintos?.length) items.push(`<li>Votaron distinto según una y otra fuente: ${personas(d.votantes_distintos, otra)}.</li>`);
    if (d.no_listados_en_sil?.length) items.push(`<li>El SIL los cuenta sin nombrarlos y esta fuente sí los nombra: ${personas(d.no_listados_en_sil, null)}.</li>`);
    if (d.votantes_ausentes_en_sil?.length) items.push(`<li>Están en esta lista y no en la del SIL: ${personas(d.votantes_ausentes_en_sil, null)}.</li>`);
    partes.push(`<div class="aviso"><p>Difiere de la misma votación según el ${ref}:</p>\n<ul>${items.join("\n")}</ul></div>`);
  }
  const otras = m.otrasFuentes.get(v.id) ?? [];
  if (otras.length) {
    partes.push(`<p>La misma votación según otra fuente:</p>
<ul>${otras
      .map((o) => {
        const d = o.discrepancias?.find((x) => x.votacion === v.id);
        const nota = d
          ? [
              d.counts_sil && "conteos distintos",
              d.votantes_distintos?.length && plural(d.votantes_distintos.length, "legislador votó distinto", "legisladores votaron distinto"),
              d.no_listados_en_sil?.length && `nombra a ${plural(d.no_listados_en_sil.length, "legislador", "legisladores")} que aquí no tienen nombre`,
              d.votantes_ausentes_en_sil?.length && plural(d.votantes_ausentes_en_sil.length, "legislador que aquí no está", "legisladores que aquí no están"),
            ].filter(Boolean)
          : [];
        return `<li><a href="${esc(urlVotacion(o.id))}">${esc(fuenteDe(o))}</a> <span class="tenue">· ${o.votos_publicados ? "con el voto de cada legislador" : "solo conteos"}${
          nota.length ? ` · difiere: ${nota.join(", ")}` : d === undefined ? " · sin diferencias anotadas" : ""
        }</span></li>`;
      })
      .join("\n")}</ul>`);
  }
  return partes.join("\n");
}

function seccionVotos(m, v) {
  if (!v.votos_publicados) {
    const otras = (m.otrasFuentes.get(v.id) ?? []).filter((o) => o.votos_publicados);
    return `<p>
  ${v.id.startsWith("sil-") ? "El SIL solo desglosa el voto de cada legislador en una votación nominal por asunto; de esta da solo los conteos." : "Esta fuente da solo los conteos de esta votación."}
  ${otras.length ? `El voto de cada legislador está en ${lista(otras.map((o) => `<a href="${esc(urlVotacion(o.id))}">la votación según el ${esc(fuenteDe(o))}</a>`))}.` : "No hay otra fuente publicada aquí con el voto de cada legislador."}
</p>`;
  }
  const orden = porApellido(m);
  const porOpcion = agrupar(v.votes ?? [], (x) => x.option);
  const faltan = agrupar(v.votos_faltantes ?? [], (f) => f.option);
  const opciones = OPCIONES.map(([o]) => o).filter((o) => porOpcion.has(o) || faltan.has(o));
  for (const o of [...porOpcion.keys(), ...faltan.keys()]) if (!opciones.includes(o)) opciones.push(o);
  const hayEnlace = (v.votes ?? []).some((x) => x.enlace);
  const bloques = opciones.map((o) => {
    const votos = porOpcion.get(o) ?? [];
    const sinNombre = faltan.get(o) ?? [];
    const total = votos.length + sinNombre.reduce((s, f) => s + f.value, 0);
    const porGrupo = agrupar(votos, (x) => x.grupo_fuente ?? "Sin grupo en la fuente");
    for (const f of sinNombre) if (!porGrupo.has(f.grupo ?? "Sin grupo en la fuente")) porGrupo.set(f.grupo ?? "Sin grupo en la fuente", []);
    const grupos = [...porGrupo].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "es"));
    const dl = grupos
      .map(([g, xs]) => {
        const nombres = xs
          .sort((a, b) => orden(a.voter_id, b.voter_id))
          .map((x) => `${enlacePersona(m, x.voter_id)}${x.enlace ? `<span class="tenue" data-tip="${esc(`Nombre escrito distinto en la fuente; ligado por: ${x.enlace}`)}" tabindex="0">°</span>` : ""}`)
          .join(", ");
        const sa = sinNombre.filter((f) => (f.grupo ?? "Sin grupo en la fuente") === g);
        const nsa = sa.reduce((s, f) => s + f.value, 0);
        const textoSa = nsa
          ? `<p class="sin-atribuir">${plural(nsa, "voto sin atribuir", "votos sin atribuir")}${
              sa.some((f) => f.nombres_fuente?.length)
                ? `; la fuente escribe: ${lista(sa.flatMap((f) => f.nombres_fuente ?? []).map((n) => `«${esc(n)}»`))}`
                : (nsa === 1 ? ": la fuente lo cuenta y no dice quién" : ": la fuente los cuenta y no dice quiénes")
            }.</p>`
          : "";
        return `<dt>${esc(g)} <span class="cuenta">${numero(xs.length + nsa)}</span></dt><dd>${nombres || '<span class="tenue">Ninguno con nombre.</span>'}${textoSa}</dd>`;
      })
      .join("\n");
    return `<h3 class="sentido" id="${esc(o.replace(/\s+/g, "-"))}">${esc(opcion(o))} <span class="cuenta">${numero(total)}</span></h3>\n<dl class="votos">\n${dl}\n</dl>`;
  });
  return `<p class="tenue">Agrupados por el grupo parlamentario que la lista de esta votación muestra para cada legislador.${
    hayEnlace ? " ° El nombre en la fuente se escribe distinto; pase el cursor para ver cómo se ligó." : ""
  }</p>
${bloques.join("\n")}`;
}

// El hemiciclo de la votación: cada asiento con el color de su voto, en el
// sector de su grupo; los votos que la fuente no atribuye, sin nombre.
function seccionHemiciclo(m, v) {
  if (!v.votos_publicados || !v.votes?.length) return "";
  const xs = asientosVotacion(m, v);
  const cuenta = (o) => xs.filter((x) => x.sentido === o).length;
  const res = RESULTADO_VOTACION[v.result];
  const sinNombre = xs.filter((x) => !x.persona).length;
  const disidentes = xs.filter((x) => x.disidente).length;
  const etiqueta = `Hemiciclo de la votación: ${resumenSentidos(xs)}. Por grupo: ${resumenGrupos(xs)}.${
    disidentes ? ` ${plural(disidentes, "voto distinto", "votos distintos")} a la mayoría de su grupo.` : ""
  } Cada asiento enlaza a la página del legislador; la lista completa está más abajo.`;
  const nota = `Un asiento por voto (${plural(xs.length, "asiento", "asientos")}${
    sinNombre ? `, ${plural(sinNombre, "sin nombre", "sin nombre")}: la fuente ${sinNombre === 1 ? "lo cuenta y no dice de quién es" : "los cuenta y no dice de quiénes son"}` : ""
  }), con el grupo que la lista de esta votación da a cada quien. La disposición es esquemática: no son los lugares del salón de sesiones. Con borde, quien votó distinto a la mayoría de su grupo (entre a favor, en contra y abstención; las ausencias no cuentan, y en un grupo sin una mayoría clara o en los legisladores sin grupo no se marca a nadie).`;
  // «Aprobada, 344 a 116»: a favor y en contra, de los asientos.
  const centro = [[res ?? "A favor y en contra", "c2"], [`${numero(cuenta("yes"))} a ${numero(cuenta("no"))}`, "c1"]];
  return `<h2 id="hemiciclo">Cómo votó cada quien</h2>
${figuraHemiciclo(xs, { modo: "votacion", etiqueta, centro, nota })}
${
  disidentes
    ? `<h3 class="sentido">Votaron distinto a la mayoría de su grupo <span class="cuenta">${numero(disidentes)}</span></h3>\n${listaDisidentes(xs)}`
    : '<p class="tenue">Nadie votó distinto a la mayoría de su grupo (sin contar ausencias).</p>'
}`;
}

function paginaVotacion(m, v, generada) {
  const exp = v.expediente_id ? m.expedientes.get(v.expediente_id) : null;
  const filas = [
    ["Cámara", esc(camaraDe(v))],
    ["Fecha", `${fecha(v.start_date)}${v.fecha_fuente ? ` <span class="tenue">(${esc(v.fecha_fuente)})</span>` : ""}`],
    ["Fuente", esc(fuenteDe(v))],
    ["Resultado", RESULTADO_VOTACION[v.result] ? esc(RESULTADO_VOTACION[v.result]) : '<span class="tenue">la fuente no lo da</span>'],
    ["Conteos", conteosEnLinea(v) || "—"],
    v.motion?.clasificacion && ["Clasificación", esc(v.motion.clasificacion)],
    v.motion?.text && ["Lo que dice la fuente", esc(v.motion.text)],
    ordinal(m, v) && ["Orden", esc(ordinal(m, v))],
    [
      "Expediente",
      exp
        ? `<a href="${esc(urlExpediente(exp.id))}">${esc(recortar(exp.denominacion, 120))}</a>`
        : v.expediente_id
          ? `<code>${esc(v.expediente_id)}</code> <span class="tenue">(no publicado en ${REPO})</span>`
          : '<span class="tenue">sin ligar a un expediente</span>',
    ],
    ["Datos", enlaceJson(rutaVotacion(v), `<code>${esc(rutaVotacion(v))}</code>`)],
  ];
  const cuerpo = `${migas(`<a href="${BASE_CONGRESO}/votaciones/">Votaciones</a>`, exp ? `<a href="${esc(urlExpediente(exp.id))}">Expediente</a>` : "")}
${avisoRetirada(v, "esta votación")}
<p>${esc(v.motion?.denominacion ?? "")}</p>
${ficha(filas)}
${seccionNoCuadra(m, v)}
${seccionOtrasFuentes(m, v)}
${seccionHemiciclo(m, v)}
${tablaConteos(v)}
${tablaGrupos(v)}
<h2 id="votos">El voto de cada legislador</h2>
${seccionVotos(m, v)}
<h2 id="fuentes">Fuentes</h2>
${fuentes(v)}`;
  return pagina({
    url: urlVotacion(v.id),
    tarjeta: { etiqueta: "Congreso · Votaciones", detalle: recortar(tituloVotacion(v), 200) },
    titulo: `Votación ${v.id}`,
    h1: `Votación en ${camaraDe(v) === "Senado" ? "el Senado" : `la ${camaraDe(v)}`}, ${v.start_date ? fechaLarga(v.start_date) : "sin fecha"}`,
    descripcion: `${recortar(tituloVotacion(v), 150)} — votación nominal con el voto de cada legislador.`,
    cuerpo,
    generada,
    hemiciclo: v.votos_publicados && v.votes?.length ? "js" : false,
  });
}

// ------------------------------------------------------------------ cámaras

const CAMARAS_HOY = [
  ["camara-de-diputados", "Cámara de Diputados", "diputados", "diputado"],
  ["senado", "Senado", "senadores", "senador"],
];

// La composición de cada cámara con mandatos registrados.
function composiciones(m) {
  return CAMARAS_HOY.map(([org, nombre, plurales, singular]) => ({ ...composicion(m, org), nombre, plurales, singular })).filter((c) => c.mandatos);
}

function etiquetaComposicion(c) {
  return `Composición de la ${c.nombre === "Senado" ? "Cámara de Senadores" : c.nombre}: ${plural(c.total, c.singular, c.plurales)} en funciones. ${resumenGrupos(c.asientos)}.`;
}

// Total frente a lo que fija la Constitución, dicho tal cual si no cuadra.
function cuadre(c) {
  if (c.esperado == null) return "";
  if (c.total === c.esperado) return `Da ${numero(c.total)}, los ${numero(c.esperado)} que fija la Constitución.`;
  return `<strong>Da ${numero(c.total)}, no los ${numero(c.esperado)} que fija la Constitución</strong> (${c.total < c.esperado ? `faltan ${numero(c.esperado - c.total)}` : `sobran ${numero(c.total - c.esperado)}`}): así lo registra hoy el SIL, y no se ajusta aquí.`;
}

function miniComposicion(c) {
  return `<figure class="mini"><a href="${BASE_CONGRESO}/camaras#${esc(c.organizacion)}">${svgMini(c.asientos, { modo: "composicion", etiqueta: etiquetaComposicion(c) })}<span class="mini-t">${esc(c.nombre)}</span></a>
<span>${plural(c.total, c.singular, c.plurales)}: ${resumenGrupos(c.asientos)}</span></figure>`;
}

function paginaCamaras(m, cs, generada) {
  const secciones = cs.map((c) => {
    const fuera = c.fuera.map(([e, n]) => (e === "sin estatus" ? `${numero(n)} sin estatus en el SIL` : `${numero(n)} con estatus «${esc(e)}»`));
    return `<h2 id="${esc(c.organizacion)}">${esc(c.nombre)} <span class="cuenta">${esc((c.legislatura ?? "").toUpperCase())} Legislatura</span></h2>
${figuraHemiciclo(c.asientos, {
  modo: "composicion",
  etiqueta: `${etiquetaComposicion(c)} Cada asiento enlaza a la página del legislador.`,
  centro: [[numero(c.total), "c1"], [c.plurales, "c2"]],
  nota: `Disposición esquemática, no los lugares del salón de sesiones. Grupo parlamentario según el SIL, consultado el ${c.consultado ? momento(c.consultado) : "—"}.`,
})}
<p>
  ${cuadre(c)} De ${plural(c.mandatos, "mandato registrado", "mandatos registrados")} en la legislatura, se cuentan ${numero(c.total)}${
    c.suplentes ? ` (${c.suplentes === 1 ? "1 es suplente que entró" : `${numero(c.suplentes)} son suplentes que entraron`} en lugar de su propietario)` : ""
  }${fuera.length ? `; no se cuentan ${lista(fuera)}` : ""}.${
    c.formulasDobles ? ` <strong>En ${plural(c.formulasDobles, "fórmula", "fórmulas")} el SIL da como activos al propietario y a su suplente a la vez;</strong> los dos se cuentan.` : ""
  }
</p>`;
  });
  const cuerpo = `${migas()}
<p>
  Quién ocupa hoy cada lugar en el Congreso de la Unión, por grupo parlamentario: un asiento por
  legislador en funciones. Pase el cursor (o toque) un asiento para ver quién es; la leyenda filtra
  por grupo y el buscador encuentra un nombre. Sin JavaScript, cada asiento es un enlace.
</p>
<p class="tenue">
  Regla: se cuenta cada mandato de la legislatura más reciente cuyo estatus en el SIL es «Activo».
  El SIL lo marca en quien ocupa el lugar hoy: el propietario o, si este pidió licencia, se separó
  o murió, el suplente que entró en su lugar (con su propio mandato). Las licencias y
  reincorporaciones de cada quien están en su página. El grupo es el que el SIL muestra hoy; los
  cambios de bancada no se registran.
</p>
${secciones.join("\n")}
<p><a href="${BASE_CONGRESO}/legisladores/">Todos los legisladores, con propietarios y suplentes →</a></p>`;
  return pagina({
    url: `${BASE_CONGRESO}/camaras`,
    titulo: "Las cámaras hoy",
    h1: "Las cámaras hoy",
    descripcion: "Composición de la Cámara de Diputados y del Senado por grupo parlamentario: un asiento por legislador en funciones, según el SIL.",
    cuerpo,
    generada,
    hemiciclo: "js",
  });
}

// ------------------------------------------------------------------ legisladores

const grupoMandato = (m, x) => m.organizaciones.get(x.on_behalf_of_id)?.name ?? x.partido_fuente ?? "Sin grupo";

// La foto oficial del SIL, si congreso-mexicano la tiene copiada.
function retrato(m, id, nombre) {
  const f = m.fotos?.get(id);
  return f
    ? `<figure class="retrato"><img src="${esc(urlFoto(f))}" width="145" height="181" alt="Foto oficial de ${esc(nombre)}"><figcaption>Foto: <a href="${esc(f.url)}">SIL</a></figcaption></figure>`
    : "";
}

const miniRetrato = (m, id) => {
  const f = m.fotos?.get(id);
  return f ? `<img class="miniretrato" src="${esc(urlFoto(f))}" width="29" height="36" alt="" loading="lazy">` : "";
};

function indiceLegisladores(m, generada) {
  const mandatos = [...m.mandatos.values()];
  const orden = porApellido(m);
  const secciones = CAMARAS.filter(([org]) => mandatos.some((x) => x.organization_id === org)).map(([org, , nombre]) => {
    const deCamara = mandatos.filter((x) => x.organization_id === org);
    const porGrupo = [...agrupar(deCamara, (x) => grupoMandato(m, x))].sort((a, b) => b[1].length - a[1].length);
    const tablas = porGrupo.map(([g, xs], i) => {
      const filas = xs
        .sort((a, b) => orden(a.person_id, b.person_id))
        .map((x) => [
          `${miniRetrato(m, x.person_id)}${enlacePersona(m, x.person_id)}`,
          esc(lugar(x) || "—"),
          esc(PRINCIPIO[x.principio] ?? x.principio ?? "—"),
          esc(x.calidad ?? "—"),
          esc(sinSufijo(x.estatus) || "—"),
          numero(m.votosPorPersona.get(x.person_id)?.length ?? 0),
          numero(m.asuntosPorPersona.get(x.person_id)?.length ?? 0),
        ]);
      return tabla({
        id: `${org}-${i}`,
        titulo: `${g} (${numero(xs.length)})`,
        columnas: [
          { titulo: "Nombre" },
          { titulo: "Entidad y distrito" },
          { titulo: "Principio" },
          { titulo: "Calidad" },
          { titulo: "Estatus" },
          { titulo: "Votos", num: true },
          { titulo: "Asuntos", num: true },
        ],
        filas,
      });
    });
    return `<h2 id="${esc(org)}">${esc(nombre)} <span class="cuenta">${plural(deCamara.length, "mandato", "mandatos")}</span></h2>\n${tablas.join("\n")}`;
  });
  const cuerpo = `${migas()}
<p>
  Cada mandato según el SIL, con el grupo parlamentario que el SIL le muestra hoy (los cambios de
  bancada no se registran). «Votos» son las votaciones nominales en que su voto tiene nombre;
  «Asuntos», las iniciativas y proposiciones que el SIL le atribuye como autor.
</p>
${secciones.join("\n")}`;
  return pagina({
    url: `${BASE_CONGRESO}/legisladores/`,
    titulo: "Legisladores",
    h1: "Legisladores",
    descripcion: "Diputados y senadores por cámara y grupo parlamentario, con sus votos y lo que presentaron.",
    cuerpo,
    generada,
  });
}

function seccionMandato(m, x) {
  const formula = x.formula_id && m.mandatos.get(x.formula_id);
  const filas = [
    ["Cámara", esc(m.organizaciones.get(x.organization_id)?.name ?? x.organization_id)],
    ["Legislatura", esc((x.legislative_period_id ?? "").toUpperCase())],
    ["Grupo parlamentario", `${esc(grupoMandato(m, x))}${x.partido_fuente ? ` <span class="tenue">(${esc(x.partido_fuente)} en el SIL hoy)</span>` : ""}`],
    ["Calidad", esc(x.calidad ?? "—")],
    ["Principio de elección", esc(PRINCIPIO[x.principio] ?? x.principio ?? "—")],
    lugar(x) && ["Entidad y distrito", esc(lugar(x))],
    ["Estatus", esc(sinSufijo(x.estatus) || "—")],
    x.start_date && ["Desde", fecha(x.start_date)],
    (x.formula || formula) && [
      "Fórmula",
      formula ? enlacePersona(m, formula.person_id) : esc(x.formula),
    ],
    ["Datos", enlaceJson(rutaMandato(x), `<code>${esc(rutaMandato(x))}</code>`)],
  ];
  const licencias = x.licencias?.length
    ? tabla({
        id: `lic-${x.id}`,
        titulo: "Licencias y reincorporaciones",
        columnas: [{ titulo: "Tipo" }, { titulo: "Inicio" }, { titulo: "Fin" }, { titulo: "En funciones" }, { titulo: "Estatus" }],
        filas: [...x.licencias]
          .sort((a, b) => (a.inicio ?? "").localeCompare(b.inicio ?? ""))
          .map((l) => [esc(l.tipo ?? "—"), fechaCorta(l.inicio), fechaCorta(l.fin), esc(l.en_funciones ?? "—"), esc(l.estatus ?? "—")]),
      })
    : "";
  const comisiones = x.comisiones?.length
    ? tabla({
        id: `com-${x.id}`,
        titulo: "Comisiones",
        columnas: [{ titulo: "Comisión" }, { titulo: "Puesto" }, { titulo: "Inicio" }, { titulo: "Fin" }, { titulo: "Estatus" }],
        filas: [...x.comisiones]
          .sort((a, b) => (b.inicio ?? "").localeCompare(a.inicio ?? ""))
          .map((c) => [esc(c.comision), esc(c.puesto ?? "—"), fechaCorta(c.inicio), fechaCorta(c.fin), esc(c.estatus ?? "—")]),
      })
    : "";
  return `${ficha(filas)}\n${licencias}\n${comisiones}`;
}

function seccionVotosPersona(m, id, mandatos) {
  const votos = m.votosPorPersona.get(id) ?? [];
  const orgs = new Set(mandatos.map((x) => x.organization_id));
  const deSuCamara = [...m.votaciones.values()].filter((v) => orgs.has(v.organization_id));
  const conFaltantes = deSuCamara.filter((v) => v.votos_faltantes?.length).length;
  const soloConteos = deSuCamara.filter((v) => !v.votos_publicados).length;
  const cuentas = agrupar(votos, (x) => x.voto.option);
  const resumen = OPCIONES.filter(([o]) => cuentas.has(o)).map(([o, n]) => `${esc(n.toLowerCase())}: <span class="dato">${numero(cuentas.get(o).length)}</span>`);
  for (const [o, xs] of cuentas) if (!NOMBRE_OPCION[o]) resumen.push(`${esc(o)}: ${numero(xs.length)}`);
  const notas = [];
  if (soloConteos) notas.push(`${plural(soloConteos, "votación nominal", "votaciones nominales")} de su cámara solo ${soloConteos === 1 ? "tiene" : "tienen"} conteos, sin el voto de cada quien`);
  const conOtroSentido = votos.filter(({ votacion: v, fuente, voto }) =>
    [v, ...(m.otrasFuentes.get(v.id) ?? [])].some((o) => o !== fuente && o.votes?.some((y) => y.voter_id === id && y.option !== voto.option)),
  ).length;
  if (conOtroSentido) notas.push(`en ${plural(conOtroSentido, "votación", "votaciones")} otra fuente le registra un sentido distinto; aquí se cuenta el del SIL cuando publica los nombres`);
  if (conFaltantes) notas.push(`${plural(conFaltantes, "votación", "votaciones")} de su cámara ${conFaltantes === 1 ? "tiene" : "tienen"} votos que la fuente no atribuye a nadie; si alguno es suyo, no aparece aquí`);
  const filas = votos.map(({ votacion: v, fuente, voto: x }) => [
    fechaCorta(v.start_date),
    `<a href="${esc(urlVotacion(v.id))}">${esc(recortar(tituloVotacion(v), 160))}</a>${
      v.organization_id === "comision-permanente" ? ' <span class="tenue">· Comisión Permanente</span>' : ""
    }${fuente.id.startsWith("sil-") ? "" : ` <span class="tenue">· ${esc(fuenteDe(fuente))}</span>`}`,
    esc(opcion(x.option)),
    esc(x.grupo_fuente ?? "—"),
  ]);
  return `<p>${votos.length ? `Votó con nombre en ${plural(votos.length, "votación nominal", "votaciones nominales")}: ${resumen.join(", ")}.` : "No tiene votos con nombre registrados."}</p>
${notas.length ? `<p class="tenue">${notas.map((n) => `${n.charAt(0).toUpperCase()}${n.slice(1)}.`).join(" ")}</p>` : ""}
${tabla({
  id: "tabla-votos",
  titulo: "Sus votos, del más reciente al más antiguo",
  columnas: [{ titulo: "Fecha" }, { titulo: "Votación" }, { titulo: "Sentido" }, { titulo: "Grupo en la lista" }],
  filas,
  vacio: "Ninguno.",
})}`;
}

function seccionAsuntosPersona(m, id) {
  const asuntos = (m.asuntosPorPersona.get(id) ?? []).slice().sort(
    (a, b) => (b.asunto.fecha_presentacion ?? "").localeCompare(a.asunto.fecha_presentacion ?? "") || b.asunto.id.localeCompare(a.asunto.id),
  );
  if (!asuntos.length) return '<p class="tenue">El SIL no le atribuye iniciativas ni proposiciones.</p>';
  const porTipo = agrupar(asuntos, (x) => x.tipo);
  const resumen = [...porTipo]
    .map(([tipo, xs]) => {
      const nombre = { iniciativas: ["iniciativa", "iniciativas"], proposiciones: ["proposición", "proposiciones"], dictamenesNegativos: ["dictamen negativo", "dictámenes negativos"] }[tipo] ?? [tipo, tipo];
      return `<li>${plural(xs.length, ...nombre)}: ${lineaResultados(xs.map((x) => x.asunto), tipo === "dictamenesNegativos" ? "o" : "a")}.</li>`;
    })
    .join("\n");
  const filas = asuntos.map(({ tipo, asunto: a }) => {
    const otros = (a.presentadores ?? []).filter((p) => p.person_id !== id).length;
    const exp = a.expediente_id && m.expedientes.get(a.expediente_id);
    // Sin `comision` desglosada (las de trabajo de la Permanente), el texto de la fuente.
    const comisiones = (a.comisiones ?? []).map((c) => (c.comision ? `${c.camara ? `${c.camara}: ` : ""}${c.comision}` : c.texto ?? "—"));
    const enlaces = [
      `<a href="${esc(urlSilExpediente(a))}">SIL</a>`,
      enlaceJson(rutaAsunto(tipo, a)),
      exp ? `<a href="${esc(urlExpediente(exp.id))}">expediente</a>` : "",
    ].filter(Boolean);
    return [
      fechaCorta(a.fecha_presentacion),
      esc(TIPO_ASUNTO[tipo] ?? tipo),
      `${esc(a.denominacion ?? "")}${otros ? ` <span class="tenue">· con ${plural(otros, "autor más", "autores más")}</span>` : ""}`,
      `${esc(RESULTADO_ASUNTO[a.estatus?.resultado] ?? a.estatus?.resultado ?? "—")}${
        a.estatus?.estado ? `<br><span class="tenue">${esc(a.estatus.estado)}${a.estatus.fecha ? `, ${esc(a.estatus.fecha)}` : ""}</span>` : ""
      }${a.retirada_de_la_fuente ? '<br><span class="tenue">ya no está en la fuente</span>' : ""}`,
      esc(comisiones.join("; ") || "—"),
      enlaces.join(" · "),
    ];
  });
  return `<ul>\n${resumen}\n</ul>
${tabla({
  id: "tabla-asuntos",
  titulo: "Lo que presentó, del más reciente al más antiguo",
  columnas: [{ titulo: "Fecha" }, { titulo: "Tipo" }, { titulo: "Denominación" }, { titulo: "Estatus" }, { titulo: "Turnado a" }, { titulo: "Ver" }],
  filas,
})}`;
}

// Su asiento en el hemiciclo de su cámara, si está en funciones.
function lugarEnCamara(m, id) {
  for (const c of m.composiciones) {
    const i = c.asientos.findIndex((x) => x.persona === id);
    if (i < 0) continue;
    const x = c.asientos[i];
    const g = grupoHemiciclo(x.grupo);
    const enGrupo = c.asientos.filter((y) => y.grupo === x.grupo).length;
    const nombreGrupo = x.grupo === "sg" ? x.grupoFuente || g.sigla : g.sigla;
    return `<figure class="mini mini-yo"><a href="${BASE_CONGRESO}/camaras#${esc(c.organizacion)}">${svgMini(c.asientos, {
      modo: "composicion",
      etiqueta: `Su lugar en la ${c.nombre === "Senado" ? "Cámara de Senadores" : c.nombre}: ${nombreGrupo}, uno de ${numero(enGrupo)} de ${numero(c.total)}.`,
      resaltar: i,
      atenuar: true,
    })}<span class="mini-t">En funciones en ${c.nombre === "Senado" ? "el Senado" : `la ${esc(c.nombre)}`}</span></a>
<span>${x.grupo === "sg" ? `${esc(nombreGrupo)}, sin grupo parlamentario` : `${esc(g.nombre)}: ${numero(enGrupo)} de ${numero(c.total)} ${esc(c.plurales)}`}${x.calidad === "suplente" ? ", como suplente en funciones" : ""}. Lugar esquemático.</span></figure>`;
  }
  return "";
}

function paginaLegislador(m, id, generada) {
  const p = m.personas.get(id) ?? { id, name: id };
  const mandatos = (m.mandatosPorPersona.get(id) ?? []).slice().sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));
  const asuntos = m.asuntosPorPersona.get(id) ?? [];
  const pendientes = asuntos.filter((x) => x.asunto.estatus?.resultado === "pendiente").length;
  const actual = mandatos[0];
  const cuerpo = `${migas(`<a href="${BASE_CONGRESO}/legisladores/">Legisladores</a>`)}
${retrato(m, id, p.name)}
<p>
  ${actual ? `${esc(m.organizaciones.get(actual.organization_id)?.name ?? actual.organization_id)}, ${esc(grupoMandato(m, actual))}${lugar(actual) ? `, ${esc(lugar(actual))}` : ""}. ` : ""}${
    asuntos.length
      ? `El SIL le atribuye ${plural(asuntos.length, "asunto", "asuntos")}; ${numero(pendientes)} ${pendientes === 1 ? "sigue pendiente" : "siguen pendientes"}.`
      : ""
  }
  <span class="tenue">${enlaceJson(rutaPersona(p), "Sus datos")}.</span>
</p>
${lugarEnCamara(m, id)}
<h2 id="mandatos">${mandatos.length === 1 ? "Mandato" : "Mandatos"}</h2>
${mandatos.map((x) => seccionMandato(m, x)).join("\n") || '<p class="tenue">Sin mandatos registrados.</p>'}
<h2 id="votos">Cómo votó</h2>
${seccionVotosPersona(m, id, mandatos)}
<h2 id="asuntos">Lo que presentó</h2>
<p class="tenue">
  Iniciativas y proposiciones en que el SIL lo registra como autor, con su estatus según el SIL. Una
  iniciativa suscrita por más legisladores puede listar solo a quien la presentó.
</p>
${seccionAsuntosPersona(m, id)}`;
  return pagina({
    url: urlLegislador(id),
    tarjeta: { etiqueta: "Congreso · Legisladores", detalle: "Sus mandatos, cómo votó en cada votación nominal y las iniciativas y proposiciones que presentó." },
    titulo: p.name,
    h1: p.name,
    descripcion: `${p.name}: sus mandatos, cómo votó en cada votación nominal y las iniciativas y proposiciones que presentó.`,
    cuerpo,
    generada,
    hemiciclo: m.composiciones.some((c) => c.asientos.some((x) => x.persona === id)) ? "css" : false,
  });
}

// ------------------------------------------------------------------ expedientes

const ultimaFecha = (e) => [e.publicado_dof, ...(e.cronologia ?? []).map((c) => c.fecha)].filter(Boolean).sort().at(-1) ?? "";

function indiceExpedientes(m, generada) {
  const es = [...m.expedientes.values()].sort((a, b) => ultimaFecha(b).localeCompare(ultimaFecha(a)) || b.id.localeCompare(a.id));
  const filas = es.map((e) => [
    fechaCorta(ultimaFecha(e)),
    `<a href="${esc(urlExpediente(e.id))}">${esc(recortar(e.denominacion))}</a>${e.retirada_de_la_fuente ? ' <span class="tenue">· ya no está en la fuente</span>' : ""}`,
    esc(e.ultimo_estatus ?? "—"),
    numero((m.votacionesPorExpediente.get(e.id) ?? []).length),
  ]);
  const cuerpo = `${migas()}
<p>
  Los ${plural(es.length, "expediente", "expedientes")} del SIL publicados: los asuntos que llegaron a votación
  nominal, del movimiento más reciente al más antiguo.
</p>
${tabla({
  id: "expedientes",
  titulo: "Expedientes",
  columnas: [{ titulo: "Último movimiento" }, { titulo: "Denominación" }, { titulo: "Último estatus" }, { titulo: "Votaciones", num: true }],
  filas,
})}`;
  return pagina({
    url: `${BASE_CONGRESO}/expedientes/`,
    titulo: "Expedientes del Congreso",
    h1: "Expedientes",
    descripcion: "Los expedientes del proceso legislativo del SIL que llegaron a votación nominal.",
    cuerpo,
    generada,
  });
}

function autores(m, a) {
  return lista(
    (a.presentadores ?? []).map((p) =>
      p.person_id && m.personas.has(p.person_id) ? enlacePersona(m, p.person_id) : esc(p.nombre_fuente ?? p.tipo ?? "—"),
    ),
  );
}

// Las económicas, del campo del expediente; si el registro aún no lo trae,
// de sus trámites del SIL: la cámara y la fecha son las del dictamen, y el
// resultado queda en el texto, sin clasificarlo aquí.
function economicas(m, e) {
  if (e.votaciones_economicas) return e.votaciones_economicas;
  const camaraAsunto = new Map();
  for (const v of m.votacionesPorExpediente.get(e.id) ?? []) if (v.asunto) camaraAsunto.set(v.asunto, v.camara);
  const fechaAsunto = new Map((e.asuntos ?? []).map((a) => [a.clave, a.fecha]));
  return Object.entries(e.tramites ?? {}).flatMap(([asunto, ts]) =>
    ts
      .filter((t) => t.tipo === "Votación económica")
      .map((t) => ({ asunto, camara: camaraAsunto.get(asunto) ?? null, fecha: fechaAsunto.get(asunto) ?? null, texto: t.texto })),
  );
}

function seccionDecreto(m, e, bitacora) {
  const d = m.decretoPorExpediente.get(e.id);
  if (!d) return e.publicado_dof ? `<p class="tenue">El SIL lo da por publicado en el DOF el ${fecha(e.publicado_dof)}, pero su decreto no está ligado a este expediente.</p>` : "";
  const docs = (d.documentos ?? []).map((x) => {
    const historia = bitacora ? historiaDe(bitacora, x.documento) : `/bitacora/${x.documento}/`;
    const commits = (x.commits ?? []).map((c) => {
      const cambio = bitacora?.cambios.find((b) => b.sha === c.sha && b.documento === x.documento);
      const git = `<a href="${esc(`https://github.com/${c.repo}/commit/${c.sha}`)}"><code>${esc(c.repo)}@${esc(c.sha.slice(0, 9))}</code></a>`;
      return cambio ? `<a href="${esc(`/bitacora/${x.documento}/${cambio.id}`)}">el cambio en la bitácora</a> (${git})` : git;
    });
    return `<li>${historia ? `<a href="${esc(historia)}">${esc(x.documento)}</a> en la bitácora` : `<code>${esc(x.documento)}</code>`}, publicación ${fecha(x.publicacion)}${
      commits.length ? ` · ${commits.join(", ")}` : ""
    }</li>`;
  });
  const vinculo = (d.expedientes ?? []).find((x) => x.id === e.id);
  const loc = d.legislaturas_estatales;
  return `${ficha([
    ["Decreto", `<a href="${esc(d.url)}">${esc(d.titulo)}</a>`],
    ["Publicado", `DOF, ${fecha(d.fecha)}${d.edicion ? ` <span class="tenue">(edición ${esc(d.edicion)})</span>` : ""}`],
    vinculo?.criterio && ["Cómo se ligó", esc(vinculo.criterio)],
    ["Datos", enlaceJson(rutaDecreto(d), `<code>${esc(rutaDecreto(d))}</code>`)],
  ])}
${docs.length ? `<p>Lo que reforma, en OpenCodice:</p>\n<ul>${docs.join("\n")}</ul>` : ""}
${
  loc
    ? `<p>Congresos locales que la aprobaron según el SIL (${numero(loc.votos_aprobatorios ?? loc.aprobaron?.length ?? 0)}): ${lista(
        (loc.aprobaron ?? []).map((x) => esc(NOMBRES_ESTADOS[x] ?? x)),
      )}.${loc.no_aprobaron?.length ? ` En contra: ${lista(loc.no_aprobaron.map((x) => esc(NOMBRES_ESTADOS[x] ?? x)))}.` : ""}${loc.nota ? ` <span class="tenue">${esc(loc.nota.charAt(0).toUpperCase() + loc.nota.slice(1))}.</span>` : ""}</p>`
    : ""
}`;
}

function paginaExpediente(m, e, generada, bitacora) {
  const vs = m.votacionesPorExpediente.get(e.id) ?? [];
  const faltantes = (e.votaciones ?? []).filter((id) => !m.votaciones.has(id));
  const integran = (m.asuntosPorSeguimiento.get(e.seguimiento) ?? []).slice().sort((a, b) => (a.asunto.fecha_presentacion ?? "").localeCompare(b.asunto.fecha_presentacion ?? ""));
  const econ = economicas(m, e);
  const denomAsunto = new Map((e.asuntos ?? []).map((a) => [a.clave, a]));
  const cuerpo = `${migas(`<a href="${BASE_CONGRESO}/expedientes/">Expedientes</a>`)}
${avisoRetirada(e, "este expediente")}
${ficha([
  ["Último estatus", esc(e.ultimo_estatus ?? "—")],
  ["Cámara de origen", esc(e.camara_origen ?? "—")],
  ["Cámara revisora", esc(e.camara_revisora ?? "—")],
  e.legislatura && ["Legislatura", esc(e.legislatura)],
  e.publicado_dof && ["Publicado en el DOF", fecha(e.publicado_dof)],
  ["SIL", `<a href="${esc(urlSilExpediente(e))}">ficha del seguimiento ${esc(e.seguimiento)}</a>`],
  ["Datos", enlaceJson(rutaExpediente(e), `<code>${esc(rutaExpediente(e))}</code>`)],
])}
<h2 id="cronologia">Cronología</h2>
${
  e.cronologia?.length
    ? `<ul>${e.cronologia.map((c) => `<li>${fecha(c.fecha)}: ${esc(c.estatus)}</li>`).join("\n")}</ul>`
    : '<p class="tenue">El SIL no da su cronología.</p>'
}
<h2 id="votaciones">Votaciones nominales</h2>
${vs.length ? `<ul class="lista">\n${vs.map((v) => filaVotacion(m, v)).join("\n")}\n</ul>` : '<p class="tenue">Ninguna publicada.</p>'}
${faltantes.length ? `<p class="aviso">El expediente lista ${plural(faltantes.length, "votación", "votaciones")} sin registro propio aquí: ${faltantes.map((x) => `<code>${esc(x)}</code>`).join(", ")}.</p>` : ""}
<h2 id="economicas">Votaciones económicas</h2>
${
  econ.length
    ? `<p class="tenue">Se votan sin registro nominal: no se sabe quién votó qué, solo lo que se decidió.</p>
${tabla({
  id: "tabla-economicas",
  titulo: "Votaciones económicas",
  columnas: [{ titulo: "Fecha" }, { titulo: "Cámara" }, { titulo: "Lo que se votó" }, ...(e.votaciones_economicas ? [{ titulo: "Resultado" }] : [])],
  filas: econ.map((x) => [
    fechaCorta(x.fecha),
    esc(CAMARA_CORTA[x.camara] ?? x.camara ?? "—"),
    `${esc(x.texto)}${denomAsunto.get(x.asunto) ? ` <span class="tenue">· ${esc(denomAsunto.get(x.asunto).tipo)}</span>` : ""}`,
    ...(e.votaciones_economicas ? [esc(RESULTADO_ECONOMICA[x.result] ?? "la fuente no lo da")] : []),
  ]),
})}`
    : '<p class="tenue">El SIL no registra votaciones económicas en este expediente.</p>'
}
<h2 id="iniciativas">Iniciativas y proposiciones que lo integran</h2>
${
  integran.length
    ? tabla({
        id: "tabla-integran",
        titulo: "Asuntos con su autor",
        columnas: [{ titulo: "Fecha" }, { titulo: "Tipo" }, { titulo: "Denominación" }, { titulo: "Autores" }, { titulo: "Estatus" }, { titulo: "Ver" }],
        filas: integran.map(({ tipo, asunto: a }) => [
          fechaCorta(a.fecha_presentacion),
          esc(TIPO_ASUNTO[tipo] ?? tipo),
          esc(a.denominacion ?? ""),
          autores(m, a),
          esc(RESULTADO_ASUNTO[a.estatus?.resultado] ?? a.estatus?.resultado ?? "—"),
          `<a href="${esc(urlSilExpediente(a))}">SIL</a> · ${enlaceJson(rutaAsunto(tipo, a))}`,
        ]),
      })
    : '<p class="tenue">Ninguna publicada con su autor.</p>'
}
<h2 id="asuntos">Asuntos del expediente</h2>
${tabla({
  id: "tabla-asuntos",
  titulo: "Iniciativas, dictámenes, minutas y declaratorias, según el SIL",
  columnas: [{ titulo: "Fecha" }, { titulo: "Tipo" }, { titulo: "Denominación" }, { titulo: "Documento" }],
  filas: (e.asuntos ?? []).map((a) => [fechaCorta(a.fecha), esc(a.tipo ?? "—"), esc(a.denominacion ?? ""), a.pdf ? `<a href="${esc(a.pdf)}">PDF</a>` : "—"]),
})}
<h2 id="decreto">Decreto</h2>
${seccionDecreto(m, e, bitacora) || '<p class="tenue">Sin decreto publicado en el DOF.</p>'}
<h2 id="fuentes">Fuentes</h2>
${fuentes(e)}`;
  return pagina({
    url: urlExpediente(e.id),
    tarjeta: { etiqueta: `Congreso · Expediente ${e.seguimiento}` },
    titulo: `Expediente ${e.seguimiento}`,
    h1: recortar(e.denominacion, 220),
    descripcion: `Expediente ${e.seguimiento} del SIL: cronología, votaciones con el voto de cada legislador y decreto.`,
    cuerpo,
    generada,
  });
}

// ------------------------------------------------------------------ todo

// Ruta del archivo en public/ → HTML. `bitacora` (opcional) para enlazar solo
// a historias de documentos que existen.
export function paginasCongreso(congreso, generada, { bitacora } = {}) {
  const archivos = new Map();
  if (!congreso?.ok) {
    archivos.set("congreso/index.html", paginaSinDatos(congreso, generada));
    return archivos;
  }
  const m = { ...congreso, votacionesPorAsunto: agrupar([...congreso.votaciones.values()], claveAsunto) };
  m.composiciones = composiciones(m);
  archivos.set("congreso/index.html", paginaIndice(m, generada));
  if (m.composiciones.length) archivos.set("congreso/camaras.html", paginaCamaras(m, m.composiciones, generada));
  archivos.set("congreso/votaciones/index.html", indiceVotaciones(m, generada));
  archivos.set("congreso/legisladores/index.html", indiceLegisladores(m, generada));
  archivos.set("congreso/expedientes/index.html", indiceExpedientes(m, generada));
  for (const v of m.votaciones.values()) archivos.set(`congreso/votaciones/${v.id}.html`, paginaVotacion(m, v, generada));
  const personas = new Set([...m.personas.keys(), ...m.mandatosPorPersona.keys()]);
  for (const id of personas) archivos.set(`congreso/legisladores/${id}.html`, paginaLegislador(m, id, generada));
  for (const e of m.expedientes.values()) archivos.set(`congreso/expedientes/${e.id}.html`, paginaExpediente(m, e, generada, bitacora));
  return archivos;
}
