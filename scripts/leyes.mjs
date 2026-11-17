// Página /leyes: qué leyes hay, para quien no programa. Por documento dice qué
// versión está vigente, cuántas veces se ha reformado y si viene una
// actualización, sin hablar de repositorios ni de procesos. Lo técnico está en
// /estado.

import { historiaDe } from "./bitacora.mjs";
import { ORG, REPOS, ESTADOS, conArticulo, TOTAL_INDICE_FEDERAL, esc, numero, fechaLarga, momento, plural, lista, documento, anclaTip } from "./lib/comun.mjs";

// Años de la fila de cuadros: desde 2000 hasta el año en curso. En el teléfono
// se ven solo los últimos AÑOS_EN_TELEFONO para que la fila quepa.
const DESDE_AÑO = 2000;
const AÑOS_EN_TELEFONO = 15;

const PDF_CPEUM = "https://www.diputados.gob.mx/LeyesBiblio/pdf/CPEUM.pdf";

// ------------------------------------------------------------------ datos

// Claves de documento que tocan los PR abiertos de cada repo. null cuando no
// se pudieron leer los PR o sus archivos: entonces no se afirma nada.
function documentosEnRevision(prs) {
  const porRepo = {};
  for (const [repo, r] of Object.entries(prs)) {
    if (!r.ok || r.datos.some((p) => p.archivos == null)) {
      porRepo[repo] = null;
      continue;
    }
    const claves = new Set();
    for (const p of r.datos) {
      for (const ruta of p.archivos) {
        const clave = claveDeRuta(repo, ruta);
        if (clave) claves.add(clave);
      }
    }
    porRepo[repo] = claves;
  }
  return porRepo;
}

function claveDeRuta(repo, ruta) {
  const partes = ruta.split("/");
  if (repo === REPOS.cpeum) return ["articulos", "metadata", "fuente"].includes(partes[0]) ? "cpeum" : null;
  if (repo === REPOS.estatales) {
    // La constitución se identifica por su estado; las demás leyes, por '<estado>/<ley>'.
    if (partes.length <= 2 || partes[0].startsWith(".")) return null;
    return partes[1] === "constitucion" ? partes[0] : `${partes[0]}/${partes[1]}`;
  }
  if (partes[0] === "metadata") return partes.length > 2 ? partes[1] : null;
  if (partes.length < 2 || partes[0].startsWith(".") || partes[0] === "scripts") return null;
  return partes[0];
}

const enRevision = (revision, repo, clave, pendiente = false) => {
  if (pendiente) return true;
  const claves = revision[repo];
  return claves ? claves.has(clave) : null;
};

const textoEnGitHub = (repo, ruta) => `https://github.com/${ORG}/${repo}/tree/main/${ruta}`;

// Tema de una ley para ordenarla: "Ley General de Salud" → "Salud". Casi todas
// empiezan con "Ley", así que ordenar por el nombre completo las juntaría en la L.
const PREFIJO = /^(?:(?:código|leyes|ley|estatuto|reglamento|presupuesto|decreto)\s+(?:(?:de las|de los|de la|del|de|para el|para la|para)\s+)?)+/i;
const ADJETIVOS = /^(?:(?:general|federal|orgánica|nacional|reglamentaria|marco)\s+)+/i;
const NEXOS = /^(?:(?:en materia de|de las|de los|de la|del|de|para la|para el|para|sobre la|sobre el|sobre|que|las|los|la|el)\s+)+/i;

// El prefijo se repite para que el reglamento de una ley quede junto a ella:
// "Reglamento de la Ley Aduanera" → "Aduanera".
function tema(nombre) {
  const t = nombre.replace(PREFIJO, "").replace(ADJETIVOS, "").replace(NEXOS, "");
  return t || nombre;
}

const letra = (texto) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .charAt(0)
    .toUpperCase();

// Motivo de exclusión de fuentes.json en palabras de cualquiera. Las reglas
// cubren los motivos que el proceso escribe hoy; lo demás cae en el genérico.
function motivoLlano(motivo = "") {
  if (/tabla|columna|f[óo]rmula/i.test(motivo)) {
    return "Su PDF trae tablas o fórmulas que todavía no podemos convertir a texto fiel.";
  }
  if (/marca de agua/i.test(motivo)) return "Una marca de agua del PDF se mezcla con el texto.";
  if (/0 unidades|al menos una unidad|numerad/i.test(motivo)) {
    return "Sus artículos no están numerados de una forma que podamos separar.";
  }
  if (/no reproducen el PDF/i.test(motivo)) {
    return "Al convertirla a texto, algunos artículos no quedan idénticos al PDF oficial.";
  }
  return "Todavía no podemos convertir su PDF a texto con la fidelidad necesaria.";
}

// ------------------------------------------------------------------ piezas

const NIVELES = [
  [1, "1 reforma"],
  [2, "2 reformas"],
  [3, "3 o 4 reformas"],
  [5, "5 o más reformas"],
];

const nivel = (n) => (n ? NIVELES.filter(([corte]) => n >= corte).length : 0);

function filaAños(reformas, hasta) {
  if (reformas == null) return "";
  const porAño = {};
  for (const f of reformas) porAño[f.slice(0, 4)] = (porAño[f.slice(0, 4)] ?? 0) + 1;
  const cuadros = [];
  const conReformas = [];
  for (let año = DESDE_AÑO; año <= hasta; año++) {
    const n = porAño[año] ?? 0;
    const texto = `${año}: ${n === 0 ? "sin reformas" : plural(n, "reforma", "reformas")}`;
    if (n) conReformas.push(`${año}, ${n}`);
    cuadros.push(`<span class="a${nivel(n)}${anclaTip(año - DESDE_AÑO, hasta - DESDE_AÑO + 1)}" data-tip="${texto}"></span>`);
  }
  const resumen = conReformas.length
    ? `Reformas por año desde ${DESDE_AÑO}: ${conReformas.join("; ")}. Los demás años, ninguna.`
    : `Sin reformas desde ${DESDE_AÑO}.`;
  return `<div class="años" role="img" aria-label="${esc(resumen)}">${cuadros.join("")}</div>`;
}

function indicador(revision) {
  if (revision == null) return "";
  return revision
    ? '<span class="indicador revision">Actualización en revisión</span>'
    : '<span class="indicador al-dia">Al día</span>';
}

function cuentaReformas(reformas, { anuales = false } = {}) {
  if (reformas == null) return "Sin datos de sus reformas";
  if (!reformas.length) return anuales ? "" : "Su texto no anota reformas";
  return `${plural(reformas.length, "reforma anotada", "reformas anotadas")} en su texto`;
}

// Un documento de la lista. `fecha` es la de su versión vigente; `donde`, el
// periódico oficial donde se publicó.
function itemDocumento(d, hasta) {
  const datos = [
    indicador(d.revision),
    d.fecha
      ? `${d.anual ? "Versión vigente publicada el" : `Última reforma publicada en ${esc(d.donde)}:`} <span class="fecha">${fechaLarga(d.fecha)}</span>`
      : "Fecha de su última reforma no disponible",
    cuentaReformas(d.reformas, { anuales: d.anual }),
  ].filter(Boolean);
  const enlaces = [
    `<a href="${esc(d.texto)}">Leer el texto</a>`,
    d.historia ? `<a href="${esc(d.historia)}">Sus cambios</a>` : "",
    d.pdf ? `<a href="${esc(d.pdf)}">PDF oficial</a>` : "",
  ].filter(Boolean);
  return `<li class="doc">
<p class="doc-nombre">${esc(d.nombre)}</p>
<p class="doc-datos">${datos.join(" · ")} · ${enlaces.join(" · ")}</p>
${filaAños(d.reformas, hasta)}
</li>`;
}

const listaDocumentos = (docs, hasta) => `<ul class="docs">\n${docs.map((d) => itemDocumento(d, hasta)).join("\n")}\n</ul>`;

const sinDatos = (que) =>
  `<p class="aviso">En este momento no pudimos consultar ${que}. La página se vuelve a generar en unas horas.</p>`;

// ------------------------------------------------------------------ secciones

function documentosCpeum(cpeum, revision, b) {
  if (!cpeum.ok) return null;
  return [
    {
      nombre: "Constitución Política de los Estados Unidos Mexicanos",
      fecha: cpeum.datos.version,
      donde: "el DOF",
      reformas: cpeum.datos.reformas,
      revision: enRevision(revision, REPOS.cpeum, "cpeum"),
      texto: textoEnGitHub(REPOS.cpeum, "articulos"),
      historia: historiaDe(b, "cpeum"),
      pdf: PDF_CPEUM,
    },
  ];
}


function documentosEstatales(estatales, revision, b) {
  if (!estatales.ok) return null;
  return estatales.datos
    .filter((e) => e.articulos != null)
    .map((e) => ({
      nombre: `Constitución de ${conArticulo(e.nombre)}`,
      entidad: e.nombre,
      fecha: e.version,
      donde: e.periodico ? `${/^gaceta/i.test(e.periodico) ? "la" : "el"} ${e.periodico}` : "su periódico oficial",
      reformas: e.reformas,
      revision: enRevision(revision, REPOS.estatales, e.clave),
      texto: textoEnGitHub(REPOS.estatales, `${e.clave}/constitucion/articulos`),
      historia: historiaDe(b, `${e.clave}/constitucion`),
      pdf: null,
    }));
}

// Las demás leyes de cada estado, por estado: las publicadas y las que quedaron
// fuera, con su motivo.
function leyesEstatales(estatales, revision, b) {
  if (!estatales.ok) return null;
  return estatales.datos
    .filter((e) => e.leyes?.length)
    .map((e) => ({
      entidad: e.nombre,
      clave: e.clave,
      donde: e.periodico ? `${/^gaceta/i.test(e.periodico) ? "la" : "el"} ${e.periodico}` : "su periódico oficial",
      publicadas: e.leyes
        .filter((d) => d.estado === "incluida")
        .map((d) => ({
          nombre: d.etiqueta,
          fecha: d.version,
          donde: d.medio ? `${/^gaceta/i.test(d.medio) ? "la" : "el"} ${d.medio}` : "su periódico oficial",
          reformas: d.reformas,
          revision: enRevision(revision, REPOS.estatales, d.clave, Boolean(d.revision_pendiente)),
          texto: textoEnGitHub(REPOS.estatales, `${d.clave}/articulos`),
          historia: historiaDe(b, d.clave),
          pdf: d.url ?? null,
        }))
        .sort((x, y) => x.nombre.localeCompare(y.nombre, "es")),
      fuera: e.leyes.filter((d) => d.estado === "excluida").sort((x, y) => x.etiqueta.localeCompare(y.etiqueta, "es")),
    }));
}

function documentosFederales(federales, revision, b) {
  if (!federales.ok) return null;
  return federales.datos
    .filter((d) => d.estado === "incluida")
    .map((d) => ({
      nombre: d.etiqueta,
      tema: tema(d.etiqueta),
      fecha: d.version,
      donde: "el DOF",
      reformas: d.reformas,
      revision: enRevision(revision, REPOS.federales, d.clave, Boolean(d.revision_pendiente)),
      texto: textoEnGitHub(REPOS.federales, d.clave),
      historia: historiaDe(b, d.clave),
      pdf: d.url,
    }))
    .sort((a, b) => a.tema.localeCompare(b.tema, "es"));
}

const GRUPOS_FISCALES = [
  ["Leyes", ["ley"]],
  ["Reglamentos", ["reglamento"]],
  ["Reglas y resoluciones del SAT", ["rmf", "anexo-rmf", "criterios", "rfa", "rgce"]],
];

function documentosFiscales(fiscal, federales, revision, b) {
  if (!fiscal.ok) return null;
  // Los PDF oficiales de las leyes fiscales son los mismos del índice federal.
  const pdfs = federales.ok ? Object.fromEntries(federales.datos.map((d) => [d.clave, d.url])) : {};
  return fiscal.datos.map((d) => ({
    nombre: d.etiqueta,
    tipo: d.tipo,
    anual: !["ley", "reglamento"].includes(d.tipo),
    fecha: d.version,
    donde: "el DOF",
    reformas: d.reformas,
    revision: enRevision(revision, REPOS.fiscal, d.clave),
    texto: textoEnGitHub(REPOS.fiscal, d.clave),
    historia: historiaDe(b, d.clave),
    pdf: pdfs[d.clave] ?? null,
  }));
}

function resumen({ cpeum, estatales, leyesEstados, federales, fiscal, excluidas, faltanFederales }) {
  const enRev = (docs) => docs?.filter((d) => d.revision).length ?? 0;
  const items = [];

  if (cpeum) {
    const c = cpeum[0];
    items.push(
      `<li><a href="#constitucion">La Constitución</a>: ${
        c.revision ? "tiene una actualización en revisión" : "está al día"
      }; su última reforma se publicó el ${fechaLarga(c.fecha)}.</li>`,
    );
  } else items.push('<li><a href="#constitucion">La Constitución</a>: no pudimos consultarla en este momento.</li>');

  if (estatales) {
    items.push(
      `<li><a href="#estados">Constituciones de los estados</a>: tenemos ${numero(estatales.length)} de 32${
        estatales.length <= 6 ? ` (${lista(estatales.map((e) => esc(e.entidad)))})` : ""
      }.${estatales.length < 32 ? " Las demás todavía no." : ""}</li>`,
    );
  } else items.push('<li><a href="#estados">Constituciones de los estados</a>: no pudimos consultarlas en este momento.</li>');

  if (leyesEstados?.length) {
    const n = leyesEstados.reduce((s, e) => s + e.publicadas.length, 0);
    const rev = leyesEstados.reduce((s, e) => s + enRev(e.publicadas), 0);
    items.push(
      `<li><a href="#leyes-estados">Leyes de los estados</a>: ${plural(n, "ley", "leyes")} de ${lista(
        leyesEstados.map((e) => esc(e.entidad)),
      )}.${rev ? ` ${plural(rev, "tiene", "tienen")} una actualización en revisión.` : ""}</li>`,
    );
  }

  if (federales) {
    const partes = [`${numero(federales.length)} disponibles`];
    if (excluidas) partes.push(`${numero(excluidas)} que todavía no podemos ofrecer`);
    if (faltanFederales > 0) partes.push(`${numero(faltanFederales)} por revisar`);
    const rev = enRev(federales);
    items.push(
      `<li><a href="#federales">Leyes federales</a>: ${lista(partes)}.${
        rev ? ` ${plural(rev, "tiene", "tienen")} una actualización en revisión.` : ""
      }</li>`,
    );
  } else items.push('<li><a href="#federales">Leyes federales</a>: no pudimos consultarlas en este momento.</li>');

  if (fiscal) {
    const rev = enRev(fiscal);
    items.push(
      `<li><a href="#fiscal">Legislación fiscal</a>: ${numero(fiscal.length)} documentos, entre leyes y
  reglamentos fiscales, la Resolución Miscelánea Fiscal y sus anexos.${
    rev ? ` ${plural(rev, "tiene", "tienen")} una actualización en revisión.` : ""
  }</li>`,
    );
  } else items.push('<li><a href="#fiscal">Legislación fiscal</a>: no pudimos consultarla en este momento.</li>');

  return `<h2 id="resumen">En resumen</h2>\n<ul class="resumen">\n${items.join("\n")}\n</ul>`;
}

function comoLeer(hasta) {
  const muestras = [
    '<span><span class="cuadro a0"></span> sin reformas</span>',
    ...NIVELES.map(([, etiqueta], i) => `<span><span class="cuadro a${i + 1}"></span> ${etiqueta}</span>`),
  ].join(" ");
  return `<h2 id="como-leer">Cómo leer la lista</h2>
<p>
  De cada documento decimos cuándo se publicó su última reforma y cuántas reformas anota su
  texto. La fila de cuadros va de ${DESDE_AÑO} a ${hasta}<span class="solo-telefono"> (en el
  teléfono, desde ${hasta - AÑOS_EN_TELEFONO + 1})</span>, un cuadro por año: entre más oscuro, más
  reformas ese año.
</p>
<p class="leyenda" aria-hidden="true">${muestras}</p>
<ul class="estados-doc">
  <li><span class="indicador al-dia">Al día</span>: el texto corresponde a la versión oficial más reciente que conocemos.</li>
  <li><span class="indicador revision">Actualización en revisión</span>: hay una versión nueva que estamos revisando antes de publicarla.</li>
</ul>`;
}

function seccionEstados(docs, estatales, hasta) {
  if (!docs) return `<h2 id="estados">Constituciones de los estados</h2>\n${sinDatos("las constituciones estatales")}`;
  const sinTexto = estatales.datos.filter((e) => e.articulos == null);
  const fuera = sinTexto.filter((e) => e.situacion === "fuera" && e.motivo);
  const preparando = sinTexto.filter((e) => !fuera.includes(e));
  const motivos = fuera.length
    ? `<p>Por ahora no podemos publicar la de:</p>
<ul class="tenue">
${fuera.map((e) => `  <li><strong>${esc(e.nombre)}</strong>: ${esc(e.motivo)}</li>`).join("\n")}
</ul>`
    : "";
  return `<h2 id="estados">Constituciones de los estados</h2>
${listaDocumentos(docs, hasta)}
${preparando.length ? `<p class="tenue">Estamos preparando la de ${lista(preparando.map((e) => esc(e.nombre)))}.</p>` : ""}
${motivos}`;
}

function seccionLeyesEstatales(porEstado, hasta) {
  const titulo = '<h2 id="leyes-estados">Leyes de los estados</h2>';
  if (!porEstado) return `${titulo}\n${sinDatos("las leyes estatales")}`;
  if (!porEstado.length) return "";
  const bloques = porEstado.map((e) => {
    const fuera = e.fuera.length
      ? `<ul class="excluidas">
${e.fuera
  .map(
    (d) =>
      `<li><p class="doc-nombre">${esc(d.etiqueta)}</p><p class="doc-datos">Todavía no la ofrecemos: ${esc(
        /no reproducen|invariantes|revisión completa/i.test(d.motivo ?? "") ? motivoLlano(d.motivo) : d.motivo ?? "",
      )}${d.url ? ` · <a href="${esc(d.url)}">PDF oficial</a>` : ""}</p></li>`,
  )
  .join("\n")}
</ul>`
      : "";
    return `<h3 id="leyes-${esc(e.clave)}">${esc(e.entidad)}</h3>
${e.publicadas.length ? listaDocumentos(e.publicadas, hasta) : ""}
${fuera}`;
  });
  return `${titulo}
<p>
  Además de su constitución, empezamos con los códigos y leyes orgánicas de algunos estados.
  Cada una sale del sitio oficial donde el estado publica su texto vigente.
</p>
${bloques.join("\n")}`;
}

function seccionFederales(docs, federales, hasta) {
  const titulo = '<h2 id="federales">Leyes federales</h2>';
  if (!docs) return `${titulo}\n${sinDatos("las leyes federales")}`;
  const porLetra = new Map();
  for (const d of docs) {
    const l = letra(d.tema);
    if (!porLetra.has(l)) porLetra.set(l, []);
    porLetra.get(l).push(d);
  }
  const indice = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    .split("")
    .map((l) => (porLetra.has(l) ? `<a href="#${l}">${l}</a>` : `<span aria-hidden="true">${l}</span>`))
    .join(" ");
  const bloques = [...porLetra.entries()]
    .map(([l, ds]) => `<h3 id="${l}" class="letra">${l}</h3>\n${listaDocumentos(ds, hasta)}`)
    .join("\n");

  const excluidas = federales.datos
    .filter((d) => d.estado === "excluida")
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
  const faltan = Math.max(TOTAL_INDICE_FEDERAL, federales.datos.length) - federales.datos.length;
  const noDisponibles = excluidas.length
    ? `<h3 id="no-disponibles">Las que todavía no están disponibles</h3>
<p>
  De estas leyes no ofrecemos el texto porque al convertir su PDF el resultado no sería fiel al
  original. Mientras tanto, el texto oficial está en su PDF.
</p>
<ul class="excluidas">
${excluidas
  .map(
    (d) =>
      `<li><p class="doc-nombre">${esc(d.etiqueta)}</p><p class="doc-datos">${esc(motivoLlano(d.motivo))}${
        d.url ? ` · <a href="${esc(d.url)}">PDF oficial</a>` : ""
      }</p></li>`,
  )
  .join("\n")}
</ul>`
    : "";

  return `${titulo}
<p>
  Ordenadas por su tema: la Ley General de Salud está en la S y el Código Penal Federal, en
  la P.${faltan > 0 ? ` Hay ${plural(faltan, "ley más", "leyes más")} en el índice oficial que todavía no hemos revisado.` : ""}
</p>
<nav class="letras" aria-label="Índice alfabético de las leyes federales">${indice}${
    excluidas.length ? ` · <a href="#no-disponibles">No disponibles</a>` : ""
  }</nav>
${bloques}
${noDisponibles}`;
}

function seccionFiscal(docs, hasta) {
  const titulo = '<h2 id="fiscal">Legislación fiscal</h2>';
  if (!docs) return `${titulo}\n${sinDatos("la legislación fiscal")}`;
  const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, "es");
  const bloques = GRUPOS_FISCALES.map(([nombre, tipos]) => {
    const ds = docs.filter((d) => tipos.includes(d.tipo)).sort(porNombre);
    return ds.length ? `<h3>${esc(nombre)}</h3>\n${listaDocumentos(ds, hasta)}` : "";
  });
  const conocidos = GRUPOS_FISCALES.flatMap(([, t]) => t);
  const otros = docs.filter((d) => !conocidos.includes(d.tipo)).sort(porNombre);
  if (otros.length) bloques.push(`<h3>Otros</h3>\n${listaDocumentos(otros, hasta)}`);
  return `${titulo}
<p>
  Las leyes fiscales también aparecen entre las leyes federales. Las reglas del SAT se publican
  de nuevo cada año, así que de ellas damos la fecha de su versión vigente.
</p>
${bloques.join("\n")}`;
}

// ------------------------------------------------------------------ página

const estilo = (hasta) => `
:root {
  --a0: #eaedeb; --a1: #bfdcc6; --a2: #7fb991; --a3: #3f8757; --a4: #1d5233;
  --al-dia: #2e7d4a; --revision: #a86400;
}
@media (prefers-color-scheme: dark) {
  :root {
    --a0: #222624; --a1: #2a5636; --a2: #3b8150; --a3: #5fae78; --a4: #a3e3b5;
    --al-dia: #5cbb7f; --revision: #e3a23a;
  }
}

.resumen li { margin-bottom: 0.6em; }

.docs, .excluidas, .estados-doc { list-style: none; padding: 0; margin: 0 0 2rem; }
.doc, .excluidas li {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 1.5rem; row-gap: 0.2rem;
  align-items: center; margin: 0; padding: 0.75rem 0; border-bottom: 1px solid var(--linea);
}
.doc-nombre { margin: 0; font-size: 0.95em; line-height: 1.35; }
.doc-datos { margin: 0; grid-column: 1; font-size: 0.75em; line-height: 1.5; color: var(--tenue); }
.fecha { white-space: nowrap; }

.indicador { display: inline-flex; align-items: center; gap: 0.4em; color: var(--texto); white-space: nowrap; }
.indicador::before { content: ""; width: 0.6em; height: 0.6em; flex: none; border-radius: 50%; background: var(--al-dia); }
.indicador.revision::before { border-radius: 1px; transform: rotate(45deg); background: var(--revision); }
.estados-doc li { margin-bottom: 0.4em; font-size: 0.85em; }

.años { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 2px; }
.años span, .cuadro { width: 0.6rem; height: 0.6rem; flex: none; border-radius: 2px; background: var(--a0); }
.cuadro { display: inline-block; }
.años .a1, .cuadro.a1 { background: var(--a1); } .años .a2, .cuadro.a2 { background: var(--a2); }
.años .a3, .cuadro.a3 { background: var(--a3); } .años .a4, .cuadro.a4 { background: var(--a4); }
.años span:hover { outline: 2px solid var(--texto); outline-offset: 1px; }
.solo-telefono { display: none; }

.letras { display: flex; flex-wrap: wrap; gap: 0.25em 0.6em; margin: 0 0 1rem; font-size: 0.9em; font-variant-numeric: tabular-nums; }
.letras span { color: var(--tenue); }
h3.letra { margin: 1.6rem 0 0.2rem; font-size: 1em; }

@media (max-width: 40rem) {
  .doc, .excluidas li { grid-template-columns: 1fr; }
  .años { grid-column: 1; grid-row: auto; margin-top: 0.3rem; }
  /* En el teléfono la fila empieza en el borde izquierdo y es corta. */
  .años [data-tip]:hover::after { left: 0; right: auto; transform: none; }
  .años span:nth-child(-n + ${hasta - DESDE_AÑO + 1 - AÑOS_EN_TELEFONO}) { display: none; }
  .solo-telefono { display: inline; }
}
`;

export function paginaLeyes(datos, generada) {
  const revision = documentosEnRevision(datos.prs);
  const hasta = Number(new Date(generada).toLocaleString("en-US", { timeZone: "America/Mexico_City", year: "numeric" }));
  const b = datos.bitacora;
  const cpeum = documentosCpeum(datos.cpeum, revision, b);
  const estatales = documentosEstatales(datos.estatales, revision, b);
  const leyesEstados = leyesEstatales(datos.estatales, revision, b);
  const federales = documentosFederales(datos.federales, revision, b);
  const fiscal = documentosFiscales(datos.fiscal, datos.federales, revision, b);
  const excluidas = datos.federales.ok ? datos.federales.datos.filter((d) => d.estado === "excluida").length : 0;
  const faltanFederales = datos.federales.ok
    ? Math.max(TOTAL_INDICE_FEDERAL, datos.federales.datos.length) - datos.federales.datos.length
    : 0;

  const cuerpo = `      <p>
        Estas son las leyes mexicanas de las que tenemos el texto vigente, artículo por artículo.
        De cada una decimos qué versión está vigente, cuántas veces se ha reformado y si viene una
        actualización. En <a href="/bitacora/">la bitácora</a> está cada cambio con la diferencia
        de su texto.
      </p>
      <p class="generada">Actualizada el ${momento(generada)} (hora de la Ciudad de México).</p>

${resumen({ cpeum, estatales, leyesEstados, federales, fiscal, excluidas, faltanFederales })}

${comoLeer(hasta)}

<h2 id="constitucion">La Constitución</h2>
${cpeum ? listaDocumentos(cpeum, hasta) : sinDatos("la Constitución")}

${seccionEstados(estatales, datos.estatales, hasta)}

${seccionLeyesEstatales(leyesEstados, hasta)}

${seccionFederales(federales, datos.federales, hasta)}

${seccionFiscal(fiscal, hasta)}

<p class="tenue">
  Esto no sustituye a la publicación oficial ni es asesoría legal. Para cualquier efecto jurídico,
  la fuente es el Diario Oficial de la Federación o el periódico oficial de cada estado.
</p>`;

  return documento({
    ruta: "/leyes",
    url: "/leyes",
    titulo: "Qué leyes hay — OpenCodice",
    h1: "Qué leyes hay",
    descripcion:
      "Las leyes mexicanas de las que OpenCodice tiene el texto vigente: la Constitución, constituciones estatales, leyes federales y legislación fiscal, con su última reforma.",
    estilo: estilo(hasta),
    cuerpo,
    pie: `<p>
          <a href="/">Inicio</a> · <a href="/bitacora/">Bitácora de reformas</a> · <a href="/estado">Status del sistema</a> ·
          Los datos y su historial están en <a href="https://github.com/${ORG}">GitHub</a>.
        </p>`,
  });
}
