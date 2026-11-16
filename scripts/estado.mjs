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

async function pedir(url, { api = false } = {}) {
  const cabeceras = { "User-Agent": "opencodice-estado" };
  if (api) {
    cabeceras.Accept = "application/vnd.github+json";
    cabeceras["X-GitHub-Api-Version"] = "2022-11-28";
    if (process.env.GITHUB_TOKEN) cabeceras.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(TIEMPO_MAX) });
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
      const { workflow_runs } = await api(`/repos/${ORG}/${repo}/actions/workflows/${w.id}/runs?per_page=1`);
      return { repo, nombre: w.name, archivo: w.path.split("/").pop(), url: w.html_url, corrida: workflow_runs[0] };
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

const momentoCorto = (iso) => {
  const p = Object.fromEntries(
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
  return `<time datetime="${esc(new Date(iso).toISOString())}">${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}</time>`;
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

function seccionProgreso({ vigilancia, prs }) {
  const filasV = [];
  const avisos = [];
  for (const [repo, r] of Object.entries(vigilancia)) {
    if (!r.ok) {
      avisos.push(fallo(`la vigilancia de ${ORG}/${repo}`, r));
      continue;
    }
    for (const w of r.datos) {
      const c = w.corrida;
      filasV.push([
        enlaceRepo(repo, repo),
        `<a href="${esc(w.url)}">${esc(w.archivo)}</a>`,
        c ? `<a href="${esc(c.html_url)}">${esc(estadoCorrida(c))}</a>` : "Sin corridas",
        c ? momentoCorto(c.run_started_at ?? c.created_at) : "—",
        c ? esc(EVENTO[c.event] ?? c.event) : "—",
      ]);
    }
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
${tabla({
  id: "t-vigilancia",
  titulo: "Última corrida de cada vigilancia",
  columnas: [
    { titulo: "Repositorio" },
    { titulo: "Workflow" },
    { titulo: "Resultado" },
    { titulo: "Inicio" },
    { titulo: "Disparo" },
  ],
  filas: filasV,
  vacio: "No se encontraron workflows de vigilancia.",
})}
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
      <p class="generada">Generada el ${momento(generada)}. Se actualiza cada hora. Todas las horas son de la Ciudad de México.</p>

${seccionResumen(datos)}

${seccionProgreso(datos)}

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
const [cpeum, estatales, fiscal, federales, vigilancia, prs, commits] = await Promise.all([
  intentar(leerCpeum),
  intentar(leerEstatales),
  intentar(leerFiscal),
  intentar(leerFederales),
  porRepo(leerVigilancia),
  porRepo(leerPrs),
  porRepo(leerUltimoCommit),
]);

await writeFile(SALIDA, pagina({ cpeum, estatales, fiscal, federales, vigilancia, prs, commits }, generada));

const fallas = [cpeum, estatales, fiscal, federales, ...Object.values(vigilancia), ...Object.values(prs), ...Object.values(commits)]
  .filter((r) => !r.ok).length;
console.log(`estado.html generada${fallas ? ` con ${fallas} fuentes sin responder` : ""}`);
