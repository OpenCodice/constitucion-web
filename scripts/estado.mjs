#!/usr/bin/env node
// Genera public/estado.html: qué hay publicado en los repos de datos de
// OpenCodice y qué está en progreso. Corre en cada despliegue (también cada
// hora) para que la página siga siendo estática y sin JavaScript en el
// navegador.
//
// Sin dependencias: solo fetch de Node. Si GITHUB_TOKEN existe se usa para la
// API (el límite anónimo es de 60 peticiones por hora). Ninguna falla de red
// detiene el despliegue: cada fuente que no responde se anota en la página.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ORG = "OpenCodice";
const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const SALIDA = fileURLToPath(new URL("../public/estado.html", import.meta.url));
const TIEMPO_MAX = 20_000;

// Corridas por vigilancia en la barra de estado, y semanas en la cuadrícula de
// cambios. Cada despliegue gasta una petición por cosa y repo, no por corrida.
const CORRIDAS = 40;
const SEMANAS = 26;

// Documentos del índice de LeyesBiblio de la Cámara de Diputados. El índice no
// responde desde todas partes y el generador no debe depender de él, así que
// se usa este total conocido para calcular lo que falta por procesar.
const TOTAL_INDICE_FEDERAL = 326;

// Clave de carpeta en leyes-estatales → nombre. Las claves de los estados que
// aún no están son una suposición; si el repo usa otra, la carpeta aparece
// igual en la tabla, con su clave como nombre.
const ESTADOS = [
  ["aguascalientes", "Aguascalientes"],
  ["baja-california", "Baja California"],
  ["baja-california-sur", "Baja California Sur"],
  ["campeche", "Campeche"],
  ["chiapas", "Chiapas"],
  ["chihuahua", "Chihuahua"],
  ["cdmx", "Ciudad de México"],
  ["coahuila", "Coahuila"],
  ["colima", "Colima"],
  ["durango", "Durango"],
  ["edomex", "Estado de México"],
  ["guanajuato", "Guanajuato"],
  ["guerrero", "Guerrero"],
  ["hidalgo", "Hidalgo"],
  ["jalisco", "Jalisco"],
  ["michoacan", "Michoacán"],
  ["morelos", "Morelos"],
  ["nayarit", "Nayarit"],
  ["nuevo-leon", "Nuevo León"],
  ["oaxaca", "Oaxaca"],
  ["puebla", "Puebla"],
  ["queretaro", "Querétaro"],
  ["quintana-roo", "Quintana Roo"],
  ["san-luis-potosi", "San Luis Potosí"],
  ["sinaloa", "Sinaloa"],
  ["sonora", "Sonora"],
  ["tabasco", "Tabasco"],
  ["tamaulipas", "Tamaulipas"],
  ["tlaxcala", "Tlaxcala"],
  ["veracruz", "Veracruz"],
  ["yucatan", "Yucatán"],
  ["zacatecas", "Zacatecas"],
];

const REPOS = {
  cpeum: "constitucion-mexicana",
  estatales: "leyes-estatales",
  fiscal: "fiscal-mexicano",
  federales: "leyes-federales",
};

// ------------------------------------------------------------------ red

class ErrorFuente extends Error {}

async function pedir(url, { api = false, cuerpo } = {}) {
  const cabeceras = { "User-Agent": "opencodice-estado" };
  if (api) {
    cabeceras.Accept = "application/vnd.github+json";
    cabeceras["X-GitHub-Api-Version"] = "2022-11-28";
    if (process.env.GITHUB_TOKEN) cabeceras.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch(url, {
        headers: cabeceras,
        signal: AbortSignal.timeout(TIEMPO_MAX),
        ...(cuerpo && { method: "POST", body: JSON.stringify(cuerpo) }),
      });
      if (r.status === 404) return null;
      // Un token sin acceso a otro repo no debe dejar sin datos públicos.
      if ((r.status === 401 || r.status === 403) && cabeceras.Authorization) {
        delete cabeceras.Authorization;
        continue;
      }
      if (!r.ok) throw new ErrorFuente(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      ultimo = e;
    }
  }
  throw new ErrorFuente(ultimo?.name === "TimeoutError" ? "sin respuesta" : String(ultimo?.message ?? ultimo));
}

const crudo = (repo, ruta) => pedir(`${RAW}/${ORG}/${repo}/main/${ruta}`);
const api = (ruta) => pedir(`${API}${ruta}`, { api: true });

async function graphql(query, variables) {
  const r = await pedir(`${API}/graphql`, { api: true, cuerpo: { query, variables } });
  if (!r || r.errors) throw new ErrorFuente(r?.errors?.[0]?.message ?? "GraphQL sin respuesta");
  return r.data;
}

// Ejecuta una lectura y convierte su falla en un valor que la página puede
// mostrar, para que una fuente caída no tumbe a las demás.
async function intentar(fn) {
  try {
    return { ok: true, datos: await fn() };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ------------------------------------------------------------------ lectura

async function leerCpeum() {
  const meta = await crudo(REPOS.cpeum, "metadata/articulos.json");
  if (!meta) throw new ErrorFuente("no se encontró metadata/articulos.json");
  return { articulos: meta.articulos.length, version: meta.version };
}

async function leerEstatales() {
  const raiz = await api(`/repos/${ORG}/${REPOS.estatales}/contents/`);
  if (!raiz) throw new ErrorFuente("no se encontró el repositorio");
  const carpetas = raiz.filter((e) => e.type === "dir" && !e.name.startsWith(".")).map((e) => e.name);
  const publicados = {};
  await Promise.all(
    carpetas.map(async (c) => {
      const meta = await crudo(REPOS.estatales, `${c}/constitucion/metadata/articulos.json`);
      if (meta) publicados[c] = { articulos: meta.articulos.length, version: meta.version };
    }),
  );
  const conocidos = new Set(ESTADOS.map(([c]) => c));
  const filas = ESTADOS.map(([clave, nombre]) => ({ clave, nombre, ...publicados[clave] }));
  for (const c of Object.keys(publicados)) {
    if (!conocidos.has(c)) filas.push({ clave: c, nombre: c, ...publicados[c] });
  }
  filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return filas;
}

async function leerFiscal() {
  const meta = await crudo(REPOS.fiscal, "metadata/documentos.json");
  if (!meta) throw new ErrorFuente("no se encontró metadata/documentos.json");
  return meta.documentos;
}

async function leerFederales() {
  const fuentes = await crudo(REPOS.federales, "fuentes.json");
  if (!fuentes) throw new ErrorFuente("no se encontró fuentes.json");
  return fuentes.documentos;
}

async function leerVigilancia(repo) {
  const { workflows } = await api(`/repos/${ORG}/${repo}/actions/workflows?per_page=100`);
  const vigilar = workflows.filter((w) => /\/vigilar[^/]*\.ya?ml$/.test(w.path) && w.state === "active");
  return Promise.all(
    vigilar.map(async (w) => {
      const { workflow_runs } = await api(
        `/repos/${ORG}/${repo}/actions/workflows/${w.id}/runs?per_page=${CORRIDAS}`,
      );
      return { repo, nombre: w.name, archivo: w.path.split("/").pop(), url: w.html_url, corridas: workflow_runs };
    }),
  );
}

async function leerPrs(repo) {
  const prs = await api(`/repos/${ORG}/${repo}/pulls?state=open&per_page=100`);
  return (prs ?? []).map((p) => ({ repo, ...p }));
}

async function leerUltimoCommit(repo) {
  const commits = await api(`/repos/${ORG}/${repo}/commits?per_page=1`);
  const c = commits?.[0];
  return c ? { fecha: c.commit.committer.date, titulo: c.commit.message.split("\n")[0], url: c.html_url } : null;
}

// Commits de main desde `desde`, con cuántos archivos cambió cada uno. GraphQL
// da esa cuenta en la misma consulta (REST pediría una petición por commit);
// pide token, así que sin él se cae a REST y solo se cuentan commits.
const HISTORIA = `query($owner: String!, $name: String!, $since: GitTimestamp!, $after: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { target { ... on Commit {
      history(first: 100, since: $since, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { committedDate changedFilesIfAvailable }
      }
    } } }
  }
}`;
const PAGINAS_MAX = 5;

async function leerActividad(repo, desde) {
  if (process.env.GITHUB_TOKEN) {
    try {
      const commits = [];
      let after = null;
      for (let i = 0; i < PAGINAS_MAX; i++) {
        const d = await graphql(HISTORIA, { owner: ORG, name: repo, since: desde, after });
        const h = d.repository.defaultBranchRef.target.history;
        commits.push(...h.nodes.map((n) => ({ fecha: n.committedDate, archivos: n.changedFilesIfAvailable })));
        if (!h.pageInfo.hasNextPage) break;
        after = h.pageInfo.endCursor;
      }
      return { conArchivos: true, commits };
    } catch {
      // Sigue con REST.
    }
  }
  const commits = [];
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const lote = await api(`/repos/${ORG}/${repo}/commits?since=${desde}&per_page=100&page=${pagina}`);
    commits.push(...(lote ?? []).map((c) => ({ fecha: c.commit.committer.date, archivos: null })));
    if (!lote || lote.length < 100) break;
  }
  return { conArchivos: false, commits };
}

// ------------------------------------------------------------------ formato

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const numero = (n) => (n == null ? "—" : new Intl.NumberFormat("es-MX").format(n));

const fechaLarga = (iso) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

const enMexico = (iso, opciones) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hourCycle: "h23", ...opciones }).format(new Date(iso));

// En prosa la fecha va completa; en las tablas, compacta y con columnas alineadas.
const momento = (iso) =>
  `<time datetime="${esc(new Date(iso).toISOString())}">${esc(
    enMexico(iso, { dateStyle: "long", timeStyle: "short" }),
  )}</time>`;

const partesMexico = (iso) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );

const textoCorto = (iso) => {
  const p = partesMexico(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

const momentoCorto = (iso) => `<time datetime="${esc(new Date(iso).toISOString())}">${textoCorto(iso)}</time>`;

// Día del calendario en la Ciudad de México, como 'YYYY-MM-DD'.
const diaMexico = (iso) => {
  const p = partesMexico(iso);
  return `${p.year}-${p.month}-${p.day}`;
};

const dia = (iso) => (iso ? `<span class="dato">${esc(iso)}</span>` : "—");

const masReciente = (fechas) => fechas.filter(Boolean).sort().at(-1);

const enlaceRepo = (repo, texto = `${ORG}/${repo}`) =>
  `<a href="https://github.com/${ORG}/${esc(repo)}">${esc(texto)}</a>`;

function plural(n, uno, varios) {
  return `${numero(n)} ${n === 1 ? uno : varios}`;
}

function lista(nombres) {
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
}

// Las tablas anchas se desplazan dentro de su contenedor, no la página entera.
function tabla({ id, titulo, columnas, filas, vacio = "Ninguna." }) {
  if (!filas.length) return `<p class="tenue">${esc(vacio)}</p>`;
  const cabeza = columnas
    .map((c) => `<th scope="col"${c.num ? ' class="num"' : ""}>${esc(c.titulo)}</th>`)
    .join("");
  const cuerpo = filas
    .map(
      (f) =>
        `<tr>${f
          .map((celda, i) => {
            const clase = columnas[i].num ? ' class="num"' : "";
            return i === 0 ? `<th scope="row"${clase}>${celda}</th>` : `<td${clase}>${celda}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("\n");
  return `<div class="desplazable" role="region" aria-labelledby="${id}" tabindex="0">
<table>
<caption id="${id}">${esc(titulo)}</caption>
<thead><tr>${cabeza}</tr></thead>
<tbody>
${cuerpo}
</tbody>
</table>
</div>`;
}

const fallo = (que, r) => `<p class="aviso">No se pudo leer ${esc(que)}: ${esc(r.error)}.</p>`;

const ESTADO_CORRIDA = {
  queued: "En cola",
  in_progress: "En curso",
  waiting: "En espera",
  pending: "Pendiente",
  requested: "Solicitada",
};
const CONCLUSION = {
  success: "Correcta",
  failure: "Falló",
  cancelled: "Cancelada",
  skipped: "Omitida",
  timed_out: "Excedió el tiempo",
  action_required: "Requiere acción",
  neutral: "Neutral",
  startup_failure: "No arrancó",
  stale: "Vencida",
};
const EVENTO = { schedule: "programada", workflow_dispatch: "manual", push: "push", pull_request: "PR" };

function estadoCorrida(c) {
  if (c.status !== "completed") return ESTADO_CORRIDA[c.status] ?? c.status;
  return CONCLUSION[c.conclusion] ?? c.conclusion ?? "Terminada";
}

// ------------------------------------------------------------------ página

function seccionResumen({ cpeum, estatales, fiscal, federales, commits }) {
  const ultimo = (repo) => {
    const r = commits[repo];
    return r.ok && r.datos ? `<a href="${esc(r.datos.url)}">${momentoCorto(r.datos.fecha)}</a>` : "—";
  };
  const filas = [];
  const avisos = [];

  if (cpeum.ok) {
    filas.push([
      enlaceRepo(REPOS.cpeum, "Constitución federal"),
      "1",
      numero(cpeum.datos.articulos),
      dia(cpeum.datos.version),
      ultimo(REPOS.cpeum),
    ]);
  } else avisos.push(fallo(`${ORG}/${REPOS.cpeum}`, cpeum));

  if (estatales.ok) {
    const pub = estatales.datos.filter((e) => e.articulos != null);
    filas.push([
      enlaceRepo(REPOS.estatales, "Constituciones estatales"),
      `${pub.length} de 32`,
      numero(pub.reduce((s, e) => s + e.articulos, 0)),
      dia(masReciente(pub.map((e) => e.version))),
      ultimo(REPOS.estatales),
    ]);
  } else avisos.push(fallo(`${ORG}/${REPOS.estatales}`, estatales));

  if (fiscal.ok) {
    filas.push([
      enlaceRepo(REPOS.fiscal, "Legislación fiscal"),
      numero(fiscal.datos.length),
      numero(fiscal.datos.reduce((s, d) => s + (d.num_articulos ?? 0), 0)),
      dia(masReciente(fiscal.datos.map((d) => d.version))),
      ultimo(REPOS.fiscal),
    ]);
  } else avisos.push(fallo(`${ORG}/${REPOS.fiscal}`, fiscal));

  if (federales.ok) {
    const inc = federales.datos.filter((d) => d.estado === "incluida");
    filas.push([
      enlaceRepo(REPOS.federales, "Leyes federales"),
      `${numero(inc.length)} de ${numero(Math.max(TOTAL_INDICE_FEDERAL, federales.datos.length))}`,
      numero(inc.reduce((s, d) => s + (d.unidades ?? 0), 0)),
      dia(masReciente(inc.map((d) => d.version))),
      ultimo(REPOS.federales),
    ]);
  } else avisos.push(fallo(`${ORG}/${REPOS.federales}`, federales));

  return `<h2 id="resumen">Qué hay publicado</h2>
${tabla({
  id: "t-resumen",
  titulo: "Corpus publicados",
  columnas: [
    { titulo: "Corpus" },
    { titulo: "Documentos", num: true },
    { titulo: "Artículos", num: true },
    { titulo: "Reforma más reciente" },
    { titulo: "Último commit" },
  ],
  filas,
})}
${avisos.join("\n")}
<p class="tenue">
  “Reforma más reciente” es la fecha de publicación oficial más reciente entre los documentos
  del corpus. En la legislación fiscal la cifra de artículos cuenta unidades: también reglas,
  fichas y criterios.
</p>`;
}

// Tipo de barra por resultado. La falla es la única en color y además más alta,
// para que no dependa solo del color.
function claseCorrida(c) {
  if (c.status !== "completed") return "b-curso";
  if (["failure", "timed_out", "startup_failure"].includes(c.conclusion)) return "b-falla";
  if (c.conclusion === "success") return "b-ok";
  return "b-omitida";
}

const LEYENDA_BARRAS = `<p class="leyenda" aria-hidden="true">
  <span><span class="barra b-ok"></span> Correcta</span>
  <span><span class="barra b-falla"></span> Falló</span>
  <span><span class="barra b-omitida"></span> Cancelada u omitida</span>
  <span><span class="barra b-curso"></span> En curso</span>
</p>`;

function filaVigilancia(w, varias) {
  // La API las da de la más reciente a la más antigua.
  const corridas = w.corridas.slice(0, CORRIDAS).reverse();
  const nombre = `${enlaceRepo(w.repo, w.repo)}${varias ? ` <a class="tenue" href="${esc(w.url)}">${esc(w.archivo)}</a>` : ""}`;
  if (!corridas.length) {
    return `<div class="vigilancia"><p class="vig-nombre">${nombre}</p><p class="vig-resumen">Sin corridas.</p></div>`;
  }
  const cuenta = (clase) => corridas.filter((c) => claseCorrida(c) === clase).length;
  const ok = cuenta("b-ok");
  const ultima = corridas.at(-1);
  const inicio = CORRIDAS - corridas.length + 1;
  const barras = corridas
    .map((c, i) => {
      const fecha = c.run_started_at ?? c.created_at;
      const texto = `${textoCorto(fecha)}: ${estadoCorrida(c)}, ${EVENTO[c.event] ?? c.event}`;
      const pos = i === 0 && inicio > 1 ? ` style="grid-column-start: ${inicio}"` : "";
      return `<li${pos}><a class="barra ${claseCorrida(c)}" href="${esc(c.html_url)}" title="${esc(texto)}" aria-label="${esc(texto)}"></a></li>`;
    })
    .join("");
  const detalle = [
    [cuenta("b-falla"), "fallida", "fallidas"],
    [cuenta("b-omitida"), "cancelada u omitida", "canceladas u omitidas"],
    [cuenta("b-curso"), "en curso", "en curso"],
  ]
    .filter(([n]) => n)
    .map(([n, uno, varios]) => plural(n, uno, varios));
  return `<div class="vigilancia">
<p class="vig-nombre">${nombre}</p>
<ol class="barras" aria-label="Últimas ${corridas.length} corridas de ${esc(w.archivo)}, de la más antigua a la más reciente">${barras}</ol>
<p class="vig-resumen">${numero(ok)} de ${numero(corridas.length)} correctas${
    detalle.length ? `<span class="oculto"> (${detalle.join(", ")})</span>` : ""
  } · última: <a href="${esc(ultima.html_url)}">${esc(estadoCorrida(ultima).toLowerCase())}</a>, ${momentoCorto(
    ultima.run_started_at ?? ultima.created_at,
  )}</p>
</div>`;
}

function seccionProgreso({ vigilancia, prs }) {
  const filasV = [];
  const avisos = [];
  for (const [repo, r] of Object.entries(vigilancia)) {
    if (!r.ok) {
      avisos.push(fallo(`la vigilancia de ${ORG}/${repo}`, r));
      continue;
    }
    for (const w of r.datos) filasV.push(filaVigilancia(w, r.datos.length > 1));
  }

  const filasP = [];
  for (const [repo, r] of Object.entries(prs)) {
    if (!r.ok) {
      avisos.push(fallo(`los PR de ${ORG}/${repo}`, r));
      continue;
    }
    for (const p of r.datos) {
      const etiquetas = p.labels.map((l) => esc(l.name)).join(", ");
      filasP.push([
        `<a href="${esc(p.html_url)}">#${p.number}</a>`,
        esc(repo),
        esc(p.title) + (p.draft ? ' <span class="tenue">(borrador)</span>' : ""),
        etiquetas || "—",
        momentoCorto(p.created_at),
      ]);
    }
  }

  return `<h2 id="progreso">En progreso</h2>
<p>
  Cada lunes a las 09:00 UTC un workflow de vigilancia por repositorio descarga los PDF
  oficiales y vuelve a extraer el texto. Si algo cambió, abre un pull request: se fusiona
  solo cuando la extracción quedó verificada y, si no, queda como borrador para revisión.
</p>
<h3>Últimas corridas de cada vigilancia</h3>
${filasV.length ? `${LEYENDA_BARRAS}\n${filasV.join("\n")}` : '<p class="tenue">No se encontraron workflows de vigilancia.</p>'}
${tabla({
  id: "t-prs",
  titulo: "Pull requests abiertos",
  columnas: [
    { titulo: "PR" },
    { titulo: "Repositorio" },
    { titulo: "Título" },
    { titulo: "Etiquetas" },
    { titulo: "Abierto" },
  ],
  filas: filasP,
  vacio: "No hay pull requests abiertos en los repositorios de datos.",
})}
${avisos.join("\n")}`;
}

function seccionEstatales(estatales) {
  if (!estatales.ok) {
    return `<h2 id="estatales">Constituciones estatales</h2>\n${fallo(`${ORG}/${REPOS.estatales}`, estatales)}`;
  }
  const filas = estatales.datos;
  const pub = filas.filter((e) => e.articulos != null);
  const faltan = filas.length - pub.length;
  return `<h2 id="estatales">Constituciones estatales</h2>
<p>
  Publicadas: ${lista(pub.map((e) => esc(e.nombre))) || "ninguna"}.
  ${faltan > 0 ? `Faltan ${plural(faltan, "entidad", "entidades")}; no hay fecha comprometida para ellas.` : ""}
  Cada una vive en <code>{estado}/constitucion/</code> del repositorio
  ${enlaceRepo(REPOS.estatales)}.
</p>
${tabla({
  id: "t-estatales",
  titulo: "Las 32 entidades federativas",
  columnas: [{ titulo: "Entidad" }, { titulo: "Estado" }, { titulo: "Artículos", num: true }, { titulo: "Última reforma" }],
  filas: filas.map((e) => [
    e.articulos != null
      ? `<a href="https://github.com/${ORG}/${REPOS.estatales}/tree/main/${esc(e.clave)}/constitucion">${esc(e.nombre)}</a>`
      : esc(e.nombre),
    e.articulos != null ? "Publicada" : '<span class="tenue">Falta</span>',
    e.articulos != null ? numero(e.articulos) : "—",
    dia(e.version),
  ]),
})}`;
}

function seccionFederales(federales) {
  if (!federales.ok) {
    return `<h2 id="federales">Leyes federales</h2>\n${fallo(`${ORG}/${REPOS.federales}`, federales)}`;
  }
  const docs = federales.datos;
  const porNombre = (a, b) => a.etiqueta.localeCompare(b.etiqueta, "es");
  const inc = docs.filter((d) => d.estado === "incluida").sort(porNombre);
  const exc = docs.filter((d) => d.estado === "excluida").sort(porNombre);
  const total = Math.max(TOTAL_INDICE_FEDERAL, docs.length);
  const faltan = total - docs.length;
  const reparadas = inc.filter((d) => d.alta?.via === "reparada").length;
  const pendientes = inc.filter((d) => d.revision_pendiente).length;
  const carpeta = (d) =>
    `<a href="https://github.com/${ORG}/${REPOS.federales}/tree/main/${esc(d.clave)}"><code>${esc(d.clave)}</code></a>`;
  const pdf = (d) => (d.url ? `<a href="${esc(d.url)}">PDF</a>` : "—");

  return `<h2 id="federales">Leyes federales</h2>
<p>
  De los ${numero(total)} documentos del corpus federal (el índice de leyes vigentes de la
  Cámara de Diputados más los reglamentos fiscales),
  <span class="dato">${numero(inc.length)}</span> están publicados en
  ${enlaceRepo(REPOS.federales)}${reparadas ? ` (${plural(reparadas, "entró", "entraron")} después de que el agente corrigió el extractor)` : ""}
  y <span class="dato">${numero(exc.length)}</span> quedaron fuera del corpus, cada uno con su
  motivo en la tabla de abajo.
  ${faltan > 0 ? `${faltan === 1 ? "Falta" : "Faltan"} <span class="dato">${numero(faltan)}</span> por procesar.` : "No queda ninguno por procesar."}
</p>
${
  pendientes
    ? `<p>${plural(pendientes, "ley publicada tiene", "leyes publicadas tienen")} una versión nueva del PDF que aún no se pudo extraer con fidelidad; mientras tanto conservan la versión anterior y aparecen marcadas en la tabla.</p>`
    : ""
}
${tabla({
  id: "t-incluidas",
  titulo: `Leyes federales publicadas (${numero(inc.length)})`,
  columnas: [
    { titulo: "Ley" },
    { titulo: "Clave" },
    { titulo: "Artículos", num: true },
    { titulo: "Última reforma" },
    { titulo: "Fuente oficial" },
  ],
  filas: inc.map((d) => [
    esc(d.etiqueta) + (d.revision_pendiente ? ' <span class="tenue">(versión nueva pendiente)</span>' : ""),
    carpeta(d),
    numero(d.unidades),
    dia(d.version),
    pdf(d),
  ]),
})}
${tabla({
  id: "t-excluidas",
  titulo: `Fuera del corpus (${numero(exc.length)})`,
  columnas: [{ titulo: "Ley" }, { titulo: "Clave" }, { titulo: "Motivo" }, { titulo: "Fuente oficial" }],
  filas: exc.map((d) => [esc(d.etiqueta), `<code>${esc(d.clave)}</code>`, esc(d.motivo ?? "—"), pdf(d)]),
})}
<p class="tenue">
  Las leyes fuera del corpus se reintentan solas cuando cambia su PDF o el extractor.
</p>`;
}

// Intensidad de cada día según archivos cambiados; los cortes son potencias de
// diez porque una alta de leyes cambia miles de archivos y una reforma, unos
// cuantos. Sin la cuenta de archivos se usan commits.
const NIVELES_ARCHIVOS = [[1, "1 a 9"], [10, "10 a 99"], [100, "100 a 999"], [1000, "1,000 o más"]];
const NIVELES_COMMITS = [[1, "1"], [2, "2"], [3, "3 o 4"], [5, "5 o más"]];
const DIAS_SEMANA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const sumarDias = (dia, n) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function inicioActividad(generada) {
  const hoy = diaMexico(generada);
  const semana = (new Date(`${hoy}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { hoy, inicio: sumarDias(hoy, -semana - (SEMANAS - 1) * 7) };
}

function seccionActividad(actividad, generada) {
  const titulo = '<h2 id="actividad">Cambios en los datos</h2>';
  const leidos = Object.entries(actividad).filter(([, r]) => r.ok);
  const avisos = Object.entries(actividad)
    .filter(([, r]) => !r.ok)
    .map(([repo, r]) => fallo(`los commits de ${ORG}/${repo}`, r));
  if (!leidos.length) return `${titulo}\n${avisos.join("\n")}`;

  const conArchivos = leidos.every(([, r]) => r.datos.conArchivos);
  const { hoy, inicio } = inicioActividad(generada);
  const porDia = {};
  for (const [, r] of leidos) {
    for (const c of r.datos.commits) {
      const d = diaMexico(c.fecha);
      if (d < inicio || d > hoy) continue;
      const v = (porDia[d] ??= { commits: 0, archivos: 0, incompleto: false });
      v.commits++;
      if (c.archivos == null) v.incompleto = true;
      else v.archivos += c.archivos;
    }
  }
  const niveles = conArchivos ? NIVELES_ARCHIVOS : NIVELES_COMMITS;
  const nivel = (v) => {
    if (!v?.commits) return 0;
    const x = conArchivos ? v.archivos : v.commits;
    return Math.max(1, niveles.filter(([corte]) => x >= corte).length);
  };
  const describir = (d, v) => {
    const cuando = `${d} (${DIAS_SEMANA[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]})`;
    if (!v) return `${cuando}: sin cambios`;
    const archivos = conArchivos ? `, ${numero(v.archivos)}${v.incompleto ? " o más" : ""} ${v.archivos === 1 ? "archivo" : "archivos"}` : "";
    return `${cuando}: ${plural(v.commits, "commit", "commits")}${archivos}`;
  };

  // Etiqueta de mes en la primera semana de cada mes; se omite la de un mes
  // que apenas asoma al inicio, para que no se encime con la siguiente.
  const meses = [];
  for (let semana = 0; semana < SEMANAS; semana++) {
    const mes = Number(sumarDias(inicio, semana * 7).slice(5, 7)) - 1;
    if (meses.at(-1)?.mes !== mes) meses.push({ semana, mes });
  }
  if (meses.length > 1 && meses[1].semana < 3) meses.shift();
  const celdas = meses.map(
    ({ semana, mes }) => `<span class="mes" style="grid-column: ${semana + 2}">${MESES[mes]}</span>`,
  );
  for (let semana = 0; semana < SEMANAS; semana++) {
    const lunes = sumarDias(inicio, semana * 7);
    for (let dia = 0; dia < 7; dia++) {
      const d = sumarDias(lunes, dia);
      if (d > hoy) break;
      const v = porDia[d];
      celdas.push(
        `<span class="c n${nivel(v)}" style="grid-area: ${dia + 2} / ${semana + 2}" title="${esc(describir(d, v))}"></span>`,
      );
    }
  }
  for (const dia of [0, 2, 4]) {
    celdas.push(`<span class="dia-sem" style="grid-row: ${dia + 2}">${DIAS_SEMANA[dia]}</span>`);
  }

  const dias = Object.entries(porDia);
  const commits = dias.reduce((s, [, v]) => s + v.commits, 0);
  const archivos = dias.reduce((s, [, v]) => s + v.archivos, 0);
  const pico = dias.sort(([, a], [, b]) => (conArchivos ? b.archivos - a.archivos : b.commits - a.commits))[0];
  const resumen =
    `Del ${fechaLarga(inicio)} al ${fechaLarga(hoy)}: ${plural(commits, "commit", "commits")}` +
    (conArchivos ? ` y ${plural(archivos, "archivo cambiado", "archivos cambiados")}` : "") +
    ` en ${plural(dias.length, "día", "días")}` +
    (pico ? `. El día con más cambios fue el ${fechaLarga(pico[0])} (${describir(pico[0], pico[1]).split(": ")[1]}).` : ".");
  const unidad = conArchivos ? "archivos cambiados" : "commits";
  const muestras = [
    `<span><span class="c n0"></span> ninguno</span>`,
    ...niveles.map(([, etiqueta], i) => `<span><span class="c n${i + 1}"></span> ${esc(etiqueta)}</span>`),
  ].join(" ");

  return `${titulo}
<p>
  Cada cuadro es un día de las últimas ${SEMANAS} semanas, en los cuatro repositorios de datos
  juntos; las columnas son semanas y las filas, días. Cuenta los commits de <code>main</code>,
  también los de mantenimiento de los propios repositorios.
</p>
<figure class="actividad">
<div class="cuadricula" role="img" aria-label="${esc(`Cambios por día en los repositorios de datos. ${resumen}`)}">
${celdas.join("\n")}
</div>
<figcaption>
<p class="leyenda" aria-hidden="true"><span>${conArchivos ? "Archivos cambiados por día:" : "Commits por día:"}</span> ${muestras}</p>
<p>${esc(resumen)}</p>
${
  conArchivos
    ? `<p class="tenue">Los archivos incluyen el texto de los artículos y la metadata que se genera con él.</p>`
    : `<p class="tenue">La API no dio la cuenta de archivos de cada commit, así que la intensidad cuenta ${unidad}.</p>`
}
</figcaption>
</figure>
${avisos.join("\n")}`;
}

const ESTILO = `
main { max-width: 50rem; }
.desplazable { overflow-x: auto; margin: 0 0 1.75em; }
.desplazable:focus-visible { outline: 2px solid var(--texto); outline-offset: 3px; }
table { width: 100%; border-collapse: collapse; font-size: 0.8em; line-height: 1.4; font-variant-numeric: tabular-nums; }
caption { caption-side: top; text-align: left; padding-bottom: 0.6em; font-weight: 600; }
th, td { padding: 0.45em 0.9em 0.45em 0; border-bottom: 1px solid var(--linea); text-align: left; vertical-align: top; }
th:last-child, td:last-child { padding-right: 0; }
thead th { font-weight: 500; color: var(--tenue); white-space: nowrap; }
tbody th { font-weight: 400; }
.num { text-align: right; white-space: nowrap; }
td time, td .dato { white-space: nowrap; }
.aviso { padding-left: 0.9em; border-left: 2px solid var(--texto); }
.generada { color: var(--tenue); font-size: 0.85em; }
h3 { margin: 2rem 0 0.8rem; font-size: 0.8em; font-weight: 600; }
.oculto { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Colores de los visuales. El rojo es el único color de la página y solo
   marca lo que pide atención. */
:root {
  --barra: #7a7a7a;
  --rojo: #b42318;
  --n0: #ececec; --n1: #c6c6c6; --n2: #969696; --n3: #5c5c5c; --n4: #111111;
}
@media (prefers-color-scheme: dark) {
  :root {
    --barra: #8c8c8c;
    --rojo: #e0605a;
    --n0: #1d1d1d; --n1: #3c3c3c; --n2: #6a6a6a; --n3: #a6a6a6; --n4: #f2f2f2;
  }
}

.leyenda { display: flex; flex-wrap: wrap; gap: 0.4em 1.2em; align-items: center; font-size: 0.8em; color: var(--tenue); }
.leyenda > span { display: inline-flex; align-items: center; gap: 0.4em; white-space: nowrap; }

.vigilancia { display: grid; grid-template-columns: 12rem 1fr; gap: 0.3rem 1rem; align-items: end; margin: 0 0 1rem; font-size: 0.85em; }
.vig-nombre, .vig-resumen { margin: 0; }
.vig-resumen { grid-column: 2; color: var(--tenue); font-size: 0.9em; }
.barras { display: grid; grid-template-columns: repeat(${CORRIDAS}, 1fr); gap: 2px; height: 2.2rem; margin: 0; padding: 0; list-style: none; }
.barras li { display: flex; align-items: flex-end; margin: 0; min-width: 0; }
.barra { display: block; width: 100%; height: 60%; border-radius: 1px; background: var(--barra); }
.barra.b-falla { height: 100%; background: var(--rojo); }
.barra.b-omitida { background: transparent; box-shadow: inset 0 0 0 1px var(--tenue); }
.barra.b-curso { background: repeating-linear-gradient(135deg, var(--barra) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--barra); }
a.barra:hover, a.barra:focus-visible { outline: 2px solid var(--texto); outline-offset: 1px; }
.leyenda .barra { display: inline-block; width: 0.55rem; height: 0.75rem; }
.leyenda .barra.b-falla { height: 1.15rem; }
@media (max-width: 36rem) {
  .vigilancia { grid-template-columns: 1fr; }
  .vig-resumen { grid-column: 1; }
  .barras { gap: 1px; }
}

.actividad { margin: 0 0 1.5em; }
.cuadricula { display: grid; grid-template-columns: 1.9rem repeat(${SEMANAS}, minmax(0, 1fr)); gap: 3px; max-width: 34rem; font-size: 0.7em; color: var(--tenue); }
.cuadricula .c { aspect-ratio: 1; border-radius: 2px; }
.mes { grid-row: 1; white-space: nowrap; line-height: 1.6; }
.dia-sem { grid-column: 1; line-height: 1; align-self: center; }
.c { display: inline-block; background: var(--n0); }
.leyenda .c { width: 0.8rem; height: 0.8rem; border-radius: 2px; }
.n1 { background: var(--n1); } .n2 { background: var(--n2); } .n3 { background: var(--n3); } .n4 { background: var(--n4); }
.actividad figcaption { margin-top: 0.8em; font-size: 0.85em; }
.actividad figcaption p { margin: 0 0 0.5em; }
@media (max-width: 36rem) { .cuadricula { gap: 2px; } }
`;

function pagina(datos, generada) {
  return `<!doctype html>
<html lang="es-MX">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Estado — OpenCodice</title>
    <meta name="description" content="Qué hay publicado en OpenCodice y qué está en progreso: constitución federal, constituciones estatales, legislación fiscal y leyes federales." />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23111'/%3E%3C/svg%3E" />
    <link rel="stylesheet" href="/estilo.css" />
    <style>${ESTILO}</style>
  </head>
  <body>
    <main>
      <header>
        <p class="marca"><a href="/">OpenCodice</a></p>
        <h1>Estado del proyecto</h1>
      </header>

      <p>
        Qué hay publicado en los repositorios de datos y qué está en progreso. Las cifras se
        leen de los propios repositorios.
      </p>
      <p class="generada">Generada el ${momento(generada)}. Se actualiza cada tres horas. Todas las horas son de la Ciudad de México.</p>

${seccionResumen(datos)}

${seccionProgreso(datos)}

${seccionActividad(datos.actividad, generada)}

${seccionEstatales(datos.estatales)}

${seccionFederales(datos.federales)}

      <footer>
        <p>
          <a href="/">Inicio</a> · El código y los datos están en
          <a href="https://github.com/${ORG}">github.com/${ORG}</a>.
        </p>
      </footer>
    </main>
  </body>
</html>
`;
}

// ------------------------------------------------------------------ main

async function porRepo(fn) {
  const nombres = Object.values(REPOS);
  const resultados = await Promise.all(nombres.map((r) => intentar(() => fn(r))));
  return Object.fromEntries(nombres.map((r, i) => [r, resultados[i]]));
}

const generada = new Date().toISOString();
const { inicio: inicioCuadricula } = inicioActividad(generada);
// Un día de margen: el día se cuenta en hora de la Ciudad de México y la API filtra en UTC.
const desde = `${sumarDias(inicioCuadricula, -1)}T00:00:00Z`;
const [cpeum, estatales, fiscal, federales, vigilancia, prs, commits, actividad] = await Promise.all([
  intentar(leerCpeum),
  intentar(leerEstatales),
  intentar(leerFiscal),
  intentar(leerFederales),
  porRepo(leerVigilancia),
  porRepo(leerPrs),
  porRepo(leerUltimoCommit),
  porRepo((r) => leerActividad(r, desde)),
]);

await writeFile(SALIDA, pagina({ cpeum, estatales, fiscal, federales, vigilancia, prs, commits, actividad }, generada));

const fallas = [cpeum, estatales, fiscal, federales, ...Object.values(vigilancia), ...Object.values(prs), ...Object.values(commits), ...Object.values(actividad)]
  .filter((r) => !r.ok).length;
console.log(`estado.html generada${fallas ? ` con ${fallas} fuentes sin responder` : ""}`);
