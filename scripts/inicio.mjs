// Página de inicio. Se genera en cada despliegue para que las cifras, el
// status, las últimas reformas y el tejido salgan de los repos de datos.
//
// Es la única página con diseño propio (su tipografía, sus colores y el
// tejido); las demás usan estilo.css.

import { ORG, REPOS, metaSocial, esc, numero, plural, fechaLarga, diaMexico, momento, sumarDias } from "./lib/comun.mjs";
import { ESTILO_SALUD, salud, insignia, cambios } from "./lib/resumen.mjs";
import { ultimasReformas as reformasBitacora, historiaDe } from "./bitacora.mjs";
import { CORPUS, tejer, svgTejido, grupoTarjeta } from "./lib/tejido.mjs";
import { ZONA_ARTE } from "./lib/tarjeta.mjs";

const REFORMAS_EN_INICIO = 4;

// Un documento late en el tejido si se reformó o se corrigió en estos días.
const DIAS_RECIENTE = 30;

// Para los buscadores: el sitio y quién lo publica.
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://constitucion.app/#sitio",
      url: "https://constitucion.app/",
      name: "OpenCodice",
      inLanguage: "es-MX",
      description: "El texto vigente de la ley mexicana, un archivo por artículo, con cada reforma registrada en git.",
      publisher: { "@id": "https://constitucion.app/#organizacion" },
    },
    {
      "@type": "Organization",
      "@id": "https://constitucion.app/#organizacion",
      name: "OpenCodice",
      url: "https://constitucion.app/",
      sameAs: ["https://github.com/OpenCodice"],
    },
  ],
});

// Artículo de ejemplo para citar: el 82 de la Constitución en la reforma de
// octubre de 2026.
const EJEMPLO = { repo: REPOS.cpeum, ruta: "articulos/082.md", commit: "260df83" };

const repo = (r) => `https://github.com/${ORG}/${r}`;

// ------------------------------------------------------------------ tejido

// Las leyes federales se separan por su nombre, que dice qué clase de ley es.
function claseFederal(nombre) {
  if (/^Ley (General|Nacional)\b/.test(nombre)) return "general";
  if (/^(Ley Orgánica|Ley Reglamentaria|Código|Reglamento|Estatuto)\b/.test(nombre)) return "organica";
  return "federal";
}

// Cada documento publicado, con su corpus y su historia en la bitácora. Una
// fuente que no respondió deja fuera su corpus, no el tejido.
function documentosTejido({ cpeum, federales, estatales, fiscal, bitacora }, generada) {
  const desde = sumarDias(diaMexico(generada), -DIAS_RECIENTE);
  const recientes = new Set(
    (bitacora?.cambios ?? []).filter((c) => (c.clase === "reforma" || c.clase === "correccion") && c.dia >= desde).map((c) => c.documento),
  );
  const docs = [];
  const agregar = (clave, nombre, corpus) =>
    docs.push({ clave, nombre, corpus, url: historiaDe(bitacora, clave) ?? "/leyes", reciente: recientes.has(clave) });

  if (cpeum.ok) agregar("cpeum", "Constitución Política de los Estados Unidos Mexicanos", "cpeum");
  if (estatales.ok)
    for (const e of estatales.datos) {
      if (e.articulos != null) agregar(`${e.clave}/constitucion`, `Constitución de ${e.nombre}`, "constitucion");
      for (const l of e.leyes ?? []) if (l.estado === "incluida") agregar(l.clave, `${l.etiqueta} (${e.nombre})`, "estatal");
    }
  const federal = new Set();
  if (federales.ok)
    for (const d of federales.datos.filter((x) => x.estado === "incluida")) {
      federal.add(d.clave);
      agregar(d.clave, d.etiqueta, claseFederal(d.etiqueta));
    }
  // La misma ley en fiscal-mexicano y en leyes-federales se teje una vez.
  if (fiscal.ok) for (const d of fiscal.datos) if (!federal.has(d.clave)) agregar(d.clave, d.etiqueta ?? d.sigla ?? d.clave, "fiscal");
  return docs;
}

function leyenda(t) {
  const cuenta = {};
  for (const c of t.celdas) cuenta[c.doc.corpus] = (cuenta[c.doc.corpus] ?? 0) + 1;
  const filas = CORPUS.filter(([c]) => cuenta[c]).map(
    ([c, nombre]) => `<li><span class="muestra c-${c}"></span>${esc(nombre)} <span class="cifra">${numero(cuenta[c])}</span></li>`,
  );
  if (t.celdas.some((c) => c.doc.reciente))
    filas.push(`<li><span class="muestra c-federal con-punto"></span>Con punto: se reformó en los últimos ${DIAS_RECIENTE} días</li>`);
  return filas.join("\n          ");
}

// ------------------------------------------------------------------ secciones

function fueraFederales(d) {
  const fuera = d.filter((x) => x.estado !== "incluida").length;
  return fuera ? ` <a href="/leyes">${plural(fuera, "queda fuera", "quedan fuera")}</a> porque su extracción no reproduce fielmente el PDF.` : "";
}

function leyesEstatales(estados) {
  const leyes = estados.flatMap((e) => e.leyes ?? []).filter((d) => d.estado === "incluida");
  if (!leyes.length) return "";
  const n = new Set(leyes.map((d) => d.clave.split("/")[0])).size;
  return ` Y <a href="/leyes#leyes-estados">${plural(leyes.length, "ley", "leyes")} de ${plural(n, "estado", "estados")}</a>; cada semana se suma uno.`;
}

// Una columna por corpus; si su fuente no respondió, va sin cifra.
function corpus({ cpeum, federales, estatales, fiscal }) {
  const col = (r, c, titulo, enlace, cifra, texto) => `
        <div class="doc">
          <span class="muestra c-${c}"></span>
          <h3><a href="${enlace}">${titulo}</a></h3>
          <span class="n">${r.ok ? cifra(r.datos) : "—"}</span>
          <p>${r.ok ? texto(r.datos) : "Su fuente no respondió en este despliegue."}</p>
        </div>`;
  return [
    col(cpeum, "cpeum", "Constitución federal", repo(REPOS.cpeum), (d) => numero(d.articulos), () => "artículos, con sus transitorios y cada reforma desde su alta."),
    col(federales, "federal", "Leyes federales", repo(REPOS.federales), (d) => numero(d.filter((x) => x.estado === "incluida").length), (d) => `de ${numero(d.length)} leyes de la Cámara de Diputados.${fueraFederales(d)}`),
    col(estatales, "constitucion", "Constituciones estatales", repo(REPOS.estatales), (d) => numero(d.filter((e) => e.articulos != null).length), (d) => `de 32 entidades.${leyesEstatales(d)}`),
    col(fiscal, "fiscal", "Legislación fiscal", "https://sat.constitucion.app", (d) => numero(d.length), () => "documentos, con la Miscelánea y los criterios del SAT."),
  ].join("");
}

// Solo las reformas: las correcciones de extracción no cambian la ley. Salen
// de la bitácora (los trailers de cada commit); si su historial no se pudo
// leer, de los títulos de los commits recientes.
function ultimasReformas(actividad, bitacora) {
  const deBitacora = bitacora ? reformasBitacora(bitacora, REFORMAS_EN_INICIO) : [];
  const filas = deBitacora.length
    ? deBitacora.map(
        (r) => `<li><span class="fecha">${esc(fechaLarga(r.dia))}</span><a href="${esc(r.url)}"><b>${esc(r.nombre)}</b><span>${esc(r.titulo)} · ${esc(r.resumen)}</span></a></li>`,
      )
    : cambios(actividad)
        .filter((c) => /^Reforma\b/.test(c.titulo))
        .slice(0, REFORMAS_EN_INICIO)
        .map((c) => `<li><span class="fecha">${esc(fechaLarga(diaMexico(c.fecha)))}</span><a href="${esc(c.url)}"><b>${esc(c.titulo)}</b></a></li>`);
  if (!filas.length) return "";
  return `
    <section class="banda">
      <div class="ancho dividido">
        <div>
          <p class="antetitulo">Bitácora</p>
          <h2>Últimas reformas</h2>
          <p class="entrada">Cada cambio queda con su fecha de publicación oficial, los artículos que toca y el PDF del que salió.</p>
          <p><a class="mas" href="/bitacora/">Toda la bitácora →</a></p>
        </div>
        <ul class="reformas">
          ${filas.join("\n          ")}
        </ul>
      </div>
    </section>`;
}

function status(vigilancia, generada) {
  const s = salud(vigilancia, generada);
  const revision = s.ultimaRevision ? `Última revisión de las fuentes: ${momento(s.ultimaRevision)}` : "";
  return `<p class="status">${insignia(s)}<span>${revision}</span><a href="/estado">Status del sistema →</a></p>`;
}

// ------------------------------------------------------------------ estilo

const ESTILO = `
@font-face { font-family: "Jost"; src: url("/fuentes/jost.woff2") format("woff2"); font-weight: 300 700; font-display: swap; }
:root {
  --fondo: #ffffff; --texto: #161616; --tenue: #5f5f5b; --linea: #e4e2dc;
  --cpeum: #D6322A; --constitucion: #3A6FB0; --general: #D8CDB2; --organica: #C2185B;
  --federal: #0F6B45; --estatal: #161616; --fiscal: #8C4A26; --punto-fiscal: rgba(0, 0, 0, 0.35);
  --sans: "Jost", "Futura", "Avenir Next", "Century Gothic", system-ui, sans-serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fondo: #111312; --texto: #ecebe6; --tenue: #9a9a94; --linea: #2a2c2a;
    --cpeum: #E5483F; --constitucion: #5B8FD6; --general: #CDBF9C; --organica: #E04A86;
    --federal: #2E9B6A; --estatal: #ecebe6; --fiscal: #A9643B;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--fondo); color: var(--texto); font: 400 16px/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--texto); outline-offset: 3px; }
.ancho { max-width: 1280px; margin: 0 auto; padding-inline: max(20px, env(safe-area-inset-left)) max(20px, env(safe-area-inset-right)); }
code { font: 0.88em ui-monospace, SFMono-Regular, Menlo, monospace; }

.barra { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding-block: 28px; }
.marca { font-weight: 600; font-size: 15px; line-height: 1.2; text-decoration: none; }
.barra nav { display: flex; flex-wrap: wrap; gap: 8px clamp(18px, 3.4vw, 52px); font-size: 12.5px; font-weight: 500; letter-spacing: 0.09em; text-transform: uppercase; }
.barra nav a { text-decoration: none; border-bottom: 1px solid transparent; padding-block: 3px; }
.barra nav a:hover { border-bottom-color: currentColor; }

.portada { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 40px; align-items: center; padding-block: 24px 56px; }
.portada h1 { font-weight: 400; font-size: clamp(52px, 7vw, 100px); line-height: 1.02; letter-spacing: -0.02em; margin: 0; text-wrap: balance; }
.portada .entrada { font-size: 18px; margin: 28px 0 0; max-width: 40ch; }
.acciones { display: flex; flex-wrap: wrap; gap: 14px 28px; margin-top: 32px; }
.acciones a { font-size: 13px; font-weight: 500; letter-spacing: 0.09em; text-transform: uppercase; text-decoration: none; border-bottom: 1.5px solid currentColor; padding-bottom: 3px; }
.acciones a.tenue { border-bottom-color: var(--linea); }

figure { margin: 0; min-width: 0; }
.tejido { display: block; width: 100%; height: auto; max-height: 620px; }
.tejido a rect { transition: opacity 0.15s; }
.tejido:hover a rect { opacity: 0.55; }
.tejido a:hover rect { opacity: 1; }
.c-cpeum { fill: var(--cpeum); background: var(--cpeum); }
.c-constitucion { fill: var(--constitucion); background: var(--constitucion); }
.c-general { fill: var(--general); background: var(--general); }
.c-organica { fill: var(--organica); background: var(--organica); }
.c-federal { fill: var(--federal); background: var(--federal); }
.c-estatal { fill: var(--estatal); background: var(--estatal); }
.c-fiscal { fill: url(#punteado); background: var(--fiscal); }
.punto { fill: var(--fondo); pointer-events: none; }
@media (prefers-reduced-motion: no-preference) {
  .reciente { animation: latido 2.6s ease-in-out infinite; }
  @keyframes latido { 50% { opacity: 0.45; } }
}
figcaption { margin-top: 20px; font-size: 14px; color: var(--tenue); }
.nota { min-height: 1.6em; margin: 0 0 12px; color: var(--texto); font-size: 15px; }
.leyenda { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 22px; }
.leyenda li { display: inline-flex; align-items: center; gap: 8px; }
.muestra { display: inline-block; width: 12px; height: 12px; flex: none; position: relative; }
.con-punto::after { content: ""; position: absolute; inset: 4px; background: var(--fondo); }
.cifra { font-variant-numeric: tabular-nums; color: var(--texto); }

.status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; margin: 0; padding-block: 18px; border-block: 1px solid var(--linea); font-size: 14px; color: var(--tenue); }
.status .insignia { font-size: 12px; color: var(--texto); }
.status a { margin-left: auto; color: var(--texto); text-decoration: none; }

.banda { padding-block: 72px; border-top: 1px solid var(--linea); }
.antetitulo { font-size: 12.5px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--tenue); margin: 0 0 14px; }
h2 { font-weight: 400; font-size: clamp(30px, 3.4vw, 44px); line-height: 1.12; letter-spacing: -0.015em; margin: 0; text-wrap: balance; }
.entrada { color: var(--tenue); }
.mas { font-size: 13px; font-weight: 500; letter-spacing: 0.09em; text-transform: uppercase; text-decoration: none; border-bottom: 1.5px solid currentColor; padding-bottom: 3px; }

.corpus { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 40px; border-top: 1.5px solid var(--texto); }
.doc { display: flex; flex-direction: column; gap: 10px; padding: 26px 24px 28px 0; }
.doc h3 a { text-decoration: none; }
.doc + .doc { padding-left: 24px; border-left: 1px solid var(--linea); }
.doc h3 { font-weight: 500; font-size: 20px; line-height: 1.25; margin: 6px 0 0; }
.doc h3 a:hover { text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 1px; }
.doc .n { font-size: 46px; font-weight: 300; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.doc p { margin: 0; color: var(--tenue); font-size: 15px; }
.doc p a { color: var(--texto); }

.dividido { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 56px; }
.dividido .entrada { margin: 18px 0 24px; max-width: 34ch; }
.reformas { list-style: none; margin: 0; padding: 0; border-top: 1.5px solid var(--texto); }
.reformas li { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 20px; padding-block: 18px; border-bottom: 1px solid var(--linea); }
.reformas .fecha { color: var(--tenue); font-size: 14.5px; font-variant-numeric: tabular-nums; }
.reformas a { text-decoration: none; min-width: 0; }
.reformas b { display: block; font-weight: 500; font-size: 17px; }
.reformas a:hover b { text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 1px; }
.reformas a span { color: var(--tenue); font-size: 14.5px; }

.pasos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 40px; border-top: 1.5px solid var(--texto); }
.paso { padding: 24px 28px 8px 0; }
.paso + .paso { padding-left: 28px; border-left: 1px solid var(--linea); }
.paso .num { font-size: 12.5px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: var(--tenue); }
.paso h3 { font-weight: 500; font-size: 21px; margin: 12px 0 8px; }
.paso p { margin: 0; color: var(--tenue); font-size: 15.5px; }
.paso p a, .paso p code { color: var(--texto); }
pre { margin: 14px 0 0; padding: 12px 14px; background: color-mix(in srgb, var(--texto) 6%, transparent); overflow-x: auto; font-size: 14px; }

footer { border-top: 1.5px solid var(--texto); padding-block: 40px 48px; font-size: 14px; }
.pie { display: grid; grid-template-columns: minmax(0, 1.5fr) repeat(3, minmax(0, 1fr)); gap: 32px; }
.pie h4 { margin: 0 0 12px; font-size: 12px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--tenue); }
.pie ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.pie a { text-decoration: none; }
.pie a:hover { text-decoration: underline; }
.pie p { color: var(--tenue); margin: 12px 0 0; max-width: 40ch; }
.franja { display: grid; grid-template-columns: 1fr 3fr 2fr 1fr 4fr 1fr 2fr; height: 8px; }

@media (max-width: 960px) {
  .portada { grid-template-columns: minmax(0, 1fr); }
  .corpus { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .doc:nth-child(3) { padding-left: 0; border-left: 0; }
  .doc:nth-child(n+3) { border-top: 1px solid var(--linea); }
  .dividido { grid-template-columns: minmax(0, 1fr); gap: 28px; }
  .pie { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .pie > :first-child { grid-column: 1 / -1; }
}
@media (max-width: 680px) {
  .barra { flex-direction: column; align-items: flex-start; gap: 14px; }
  .pasos, .corpus { grid-template-columns: minmax(0, 1fr); }
  .paso + .paso, .doc + .doc { padding-left: 0; border-left: 0; border-top: 1px solid var(--linea); }
  .reformas li { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .status a { margin-left: 0; }
  .banda { padding-block: 52px; }
  .pie { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
`;

// El nombre del documento bajo el cursor, en la nota del tejido. Sin
// JavaScript cada cuadro lleva su <title>.
const GUION = `
(() => {
  const nota = document.querySelector(".nota");
  const tejido = document.querySelector(".tejido");
  if (!nota || !tejido) return;
  const inicial = nota.textContent;
  tejido.addEventListener("pointerover", (e) => {
    const a = e.target.closest("a[data-n]");
    if (a) nota.textContent = a.dataset.n;
  });
  tejido.addEventListener("pointerleave", () => { nota.textContent = inicial; });
})();
`;

// ------------------------------------------------------------------ página

export function paginaInicio(datos, generada) {
  const { commit, ruta } = EJEMPLO;
  const base = repo(EJEMPLO.repo);
  const t = tejer(documentosTejido(datos, generada));
  return `<!doctype html>
<html lang="es-MX">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>OpenCodice — las leyes de México, versionadas</title>
    <meta
      name="description"
      content="El texto vigente de la Constitución, las leyes federales, las constituciones estatales y la legislación fiscal de México, un archivo por artículo, con cada reforma registrada en git."
    />
    ${metaSocial({
      url: "/",
      titulo: "OpenCodice — las leyes de México, versionadas",
      descripcion: "El texto vigente de la ley mexicana, un archivo por artículo, con cada reforma registrada en git.",
      tarjeta: {
        titulo: "Las leyes de México",
        detalle: "Un cuadro por cada documento publicado, con la Constitución al centro, y cada reforma registrada en git.",
        arte: t.total ? grupoTarjeta(t, ZONA_ARTE) : "",
      },
    })}
    <script type="application/ld+json">${JSON_LD}</script>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='8' height='8' fill='%23D6322A'/%3E%3Crect x='8' width='8' height='8' fill='%230F6B45'/%3E%3Crect y='8' width='8' height='8' fill='%233A6FB0'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%23161616'/%3E%3C/svg%3E" />
    <link rel="preload" href="/fuentes/jost.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="alternate" type="text/plain" href="/llms.txt" title="Guía para agentes" />
    <style>${ESTILO_SALUD}${ESTILO}</style>
  </head>
  <body>
    <header class="ancho barra">
      <a class="marca" href="/">OpenCodice<br />Leyes de México</a>
      <nav aria-label="Secciones">
        <a href="/leyes">Leyes</a>
        <a href="/bitacora/">Bitácora</a>
        <a href="/congreso/">Congreso</a>
        <a href="/estado">Status</a>
        <a href="https://github.com/${ORG}">GitHub</a>
      </nav>
    </header>

    <main>
      <section class="ancho portada">
        <div>
          <h1>Las leyes de México</h1>
          <p class="entrada">
            El texto vigente de la Constitución y de las leyes federales y estatales, un artículo
            por archivo. Cada reforma queda registrada con la diferencia exacta y el PDF oficial del
            que salió.
          </p>
          <div class="acciones">
            <a href="/bitacora/">Ver las reformas</a>
            <a class="tenue" href="/leyes">Qué leyes hay</a>
          </div>
        </div>
${
  t.total
    ? `        <figure>
          ${svgTejido(t)}
          <figcaption>
            <p class="nota">Cada cuadro es un documento publicado: ${numero(t.total)}. La Constitución, al centro.</p>
            <ul class="leyenda">
          ${leyenda(t)}
            </ul>
          </figcaption>
        </figure>`
    : ""
}
      </section>

      <div class="ancho">${status(datos.vigilancia, generada)}</div>

      <section class="banda">
        <div class="ancho">
          <p class="antetitulo">Qué hay hoy</p>
          <h2>Todo el texto vigente, desde el PDF oficial.</h2>
          <div class="corpus">${corpus(datos)}
          </div>
        </div>
      </section>
${ultimasReformas(datos.actividad, datos.bitacora)}
      <section class="banda">
        <div class="ancho">
          <p class="antetitulo">Cómo se mantiene</p>
          <h2>Se actualiza solo, y solo publica lo verificado.</h2>
          <div class="pasos">
            <div class="paso">
              <span class="num">Cada lunes</span>
              <h3>Descarga y extracción</h3>
              <p>Se descargan los PDF oficiales de la Cámara de Diputados, el SAT y los congresos y periódicos oficiales de los estados, y un extractor determinista vuelve a generar cada artículo.</p>
            </div>
            <div class="paso">
              <span class="num">Si algo cambió</span>
              <h3>Verificación contra el PDF</h3>
              <p>Un agente de IA revisa lo que cambió contra el PDF y, si la extracción tiene un defecto, repara el extractor. Deciden pruebas deterministas que el agente no controla.</p>
            </div>
            <div class="paso">
              <span class="num">Solo lo verificado</span>
              <h3>Publicación con historial</h3>
              <p>Cada reforma entra como un commit propio, con su fecha, sus artículos y la huella del PDF. Lo que no se verifica espera a la semana siguiente. Nadie edita el texto a mano.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="banda">
        <div class="ancho">
          <p class="antetitulo">Para quien la usa</p>
          <h2>Una ley que se clona, se cita y se compara.</h2>
          <div class="pasos">
            <div class="paso">
              <span class="num">El historial</span>
              <h3>Cada commit, un hecho</h3>
              <p>Los repositorios solo tienen commits de texto legal, uno por documento: <code>Reforma CPEUM (DOF 2026-10-07): arts. 82, 116, 122</code>. Así, <code>git log -- lgs/</code> es la historia de la Ley General de Salud.</p>
            </div>
            <div class="paso">
              <span class="num">Para citar</span>
              <h3>Enlaces que no cambian</h3>
              <p>Cada artículo tiene una dirección fija y cada versión, un enlace permanente. El artículo 82: <a href="${base}/blob/main/${ruta}">vigente</a>, <a href="${base}/commits/main/${ruta}">su historial</a> y <a href="${base}/blob/${commit}/${ruta}">la versión de octubre de 2026</a>.</p>
            </div>
            <div class="paso">
              <span class="num">Para agentes de IA</span>
              <h3>Archivos Markdown</h3>
              <p>Un agente puede clonar el repositorio o leer cada artículo por su URL; <a href="/llms.txt"><code>/llms.txt</code></a> explica las rutas. No hay respuestas generadas: la IA solo mantiene los datos.</p>
              <pre><code>git clone https://github.com/${ORG}/${REPOS.federales}</code></pre>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer>
      <div class="ancho pie">
        <div>
          <a class="marca" href="/">OpenCodice<br />Leyes de México</a>
          <p>Los datos son de dominio público (<a href="https://creativecommons.org/publicdomain/zero/1.0/deed.es">CC0</a>) y el código es MIT. No sustituye a la publicación oficial ni es asesoría legal.</p>
        </div>
        <div>
          <h4>Consultar</h4>
          <ul><li><a href="/leyes">Qué leyes hay</a></li><li><a href="/bitacora/">Bitácora de reformas</a></li><li><a href="/congreso/">Congreso</a></li><li><a href="https://sat.constitucion.app">Fiscal</a></li></ul>
        </div>
        <div>
          <h4>Datos</h4>
          <ul><li><a href="${repo(REPOS.cpeum)}">Constitución</a></li><li><a href="${repo(REPOS.federales)}">Leyes federales</a></li><li><a href="${repo(REPOS.estatales)}">Leyes estatales</a></li><li><a href="${repo(REPOS.fiscal)}">Fiscal</a></li></ul>
        </div>
        <div>
          <h4>Proyecto</h4>
          <ul><li><a href="/estado">Status del sistema</a></li><li><a href="/llms.txt">Guía para agentes</a></li><li><a href="https://github.com/${ORG}">GitHub</a></li></ul>
        </div>
      </div>
    </footer>
    <div class="franja" aria-hidden="true"><i class="c-cpeum"></i><i class="c-federal"></i><i class="c-general"></i><i class="c-estatal"></i><i class="c-constitucion"></i><i class="c-fiscal"></i><i class="c-organica"></i></div>
    <script>${GUION}</script>
  </body>
</html>
`;
}
