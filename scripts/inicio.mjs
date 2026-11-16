// Página de inicio. Se genera en cada despliegue para que las cifras, el
// status y las últimas reformas salgan de los repos de datos.

import { ORG, REPOS, esc, numero, fechaLarga, diaMexico, momento } from "./lib/comun.mjs";
import { ESTILO_SALUD, salud, insignia, cambios } from "./lib/resumen.mjs";

const REFORMAS_EN_INICIO = 3;

// Artículo de ejemplo para citar: el 82 de la Constitución en la reforma de
// octubre de 2026.
const EJEMPLO = { repo: REPOS.cpeum, ruta: "articulos/082.md", commit: "632cab6" };

const repo = (r) => `https://github.com/${ORG}/${r}`;

// Una línea por corpus; si su fuente no respondió, el nombre va sin cifra.
function corpus({ cpeum, federales, estatales, fiscal }) {
  const cifra = (r, f) => (r.ok ? `: <span class="dato">${f(r.datos)}</span>` : "");
  return [
    `<a href="${repo(REPOS.cpeum)}">Constitución federal</a>${cifra(cpeum, (d) => `${numero(d.articulos)} artículos`)}.`,
    `<a href="${repo(REPOS.federales)}">Leyes federales</a>${cifra(federales, (d) => `${numero(d.filter((x) => x.estado === "incluida").length)} leyes`)}.`,
    `<a href="${repo(REPOS.estatales)}">Constituciones estatales</a>${cifra(estatales, (d) => `${numero(d.filter((e) => e.articulos != null).length)} de 32 entidades`)}.`,
    `<a href="${repo(REPOS.fiscal)}">Legislación fiscal</a>${cifra(fiscal, (d) => `${numero(d.length)} documentos`)}, con la Miscelánea y los criterios del SAT.`,
  ]
    .map((l) => `        <li>${l}</li>`)
    .join("\n");
}

// Solo las reformas: las correcciones de extracción no cambian la ley.
function ultimasReformas(actividad) {
  const reformas = cambios(actividad)
    .filter((c) => /^Reforma\b/.test(c.titulo))
    .slice(0, REFORMAS_EN_INICIO);
  if (!reformas.length) return "";
  const filas = reformas
    .map(
      (c) => `        <li>
          <a href="${esc(c.url)}">${esc(c.titulo)}</a>
          <span class="tenue">· incorporada el ${esc(fechaLarga(diaMexico(c.fecha)))}</span>
        </li>`,
    )
    .join("\n");
  return `
      <h2>Últimas reformas</h2>
      <ul>
${filas}
      </ul>
`;
}

function status(vigilancia, generada) {
  const s = salud(vigilancia, generada);
  const revision = s.ultimaRevision ? ` · última revisión: ${momento(s.ultimaRevision)}` : "";
  return `<p class="status">${insignia(s)}<span class="tenue">${revision}</span></p>`;
}

export function paginaInicio(datos, generada) {
  const { commit, ruta } = EJEMPLO;
  const base = repo(EJEMPLO.repo);
  return `<!doctype html>
<html lang="es-MX">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCodice — las leyes de México, versionadas</title>
    <meta
      name="description"
      content="El texto vigente de la Constitución, las leyes federales, las constituciones estatales y la legislación fiscal de México, un archivo por artículo, con cada reforma registrada en git."
    />
    <meta property="og:title" content="OpenCodice — las leyes de México, versionadas" />
    <meta
      property="og:description"
      content="El texto vigente de la ley mexicana, un archivo por artículo, con cada reforma registrada en git."
    />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://constitucion.app/" />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23111'/%3E%3C/svg%3E" />
    <link rel="alternate" type="text/plain" href="/llms.txt" title="Guía para agentes" />
    <link rel="stylesheet" href="/estilo.css" />
    <style>${ESTILO_SALUD}
.status { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3em 0.6em; font-size: 0.85em; }
.status .insignia { font-size: 0.82em; }
</style>
  </head>
  <body>
    <main>
      <header>
        <div class="cabecera">
          <p class="marca">OpenCodice</p>
          <nav aria-label="Secciones">
            <a href="/leyes">Leyes</a>
            <a href="/estado">Status</a>
            <a href="https://github.com/${ORG}">GitHub</a>
          </nav>
        </div>
        <h1>Las leyes de México, versionadas como código.</h1>
      </header>

      <p>
        El texto vigente de la ley mexicana, un archivo por artículo, en git. Cada reforma queda
        registrada con la diferencia exacta, como
        <a href="${base}/commit/${commit}">la de octubre de 2026 a los artículos 82, 116 y 122</a>
        de la Constitución.
      </p>
      <p>
        <strong>Se mantiene solo:</strong> cada semana revisa las fuentes oficiales, verifica cada
        cambio contra el PDF y publica únicamente lo verificado, sin que nadie edite el texto.
        <strong>Es abierto:</strong> los datos son de dominio público y el código es libre.
      </p>

      <h2>Qué hay hoy</h2>
      <ul>
${corpus(datos)}
      </ul>
      <p><a href="/leyes">Ver todas las leyes y su última reforma →</a></p>
${ultimasReformas(datos.actividad)}
      <h2>Cómo se mantiene</h2>
      ${status(datos.vigilancia, generada)}
      <p>
        Cada lunes se descargan los PDF oficiales y se vuelve a extraer el texto: las leyes
        federales y la Constitución, de la compilación de la Cámara de Diputados; las
        constituciones estatales, de cada congreso o periódico oficial; y la Miscelánea y los
        criterios, del SAT.
      </p>
      <p>
        Si algo cambió, un agente de IA compara cada artículo contra el PDF y, si la extracción
        tiene un defecto, corrige el extractor. Después pasan pruebas automáticas que el agente
        no controla. Solo si todo queda verificado se publica; si no, se conserva el texto
        vigente y se reintenta la semana siguiente. La IA solo se usa para mantener los datos,
        nunca al consultarlos. <a href="/estado">Ver el status del sistema →</a>
      </p>

      <h2>Para citar</h2>
      <p>
        Cada artículo tiene una dirección fija y cada versión, un enlace permanente que no cambia
        aunque la ley se reforme después. Por ejemplo, el artículo 82 de la Constitución:
        <a href="${base}/blob/main/${ruta}">texto vigente</a>,
        <a href="${base}/commits/main/${ruta}">su historial</a> y
        <a href="${base}/blob/${commit}/${ruta}">la versión de la reforma de octubre de 2026</a>.
      </p>

      <h2>Para agentes de IA</h2>
      <p>
        Son archivos Markdown: un agente puede clonar el repositorio o leer cada artículo por su
        URL. <a href="/llms.txt"><code>/llms.txt</code></a> explica cómo están organizados.
      </p>
      <pre><code>git clone https://github.com/${ORG}/${REPOS.federales}</code></pre>

      <footer>
        <p>
          Los datos son de dominio público
          (<a href="https://creativecommons.org/publicdomain/zero/1.0/deed.es">CC0</a>) y el código
          es MIT: se pueden usar y redistribuir sin restricciones.
        </p>
        <p>
          No sustituye a la publicación oficial ni es asesoría legal. El registro de diferencias
          empieza en junio de 2026.
        </p>
      </footer>
    </main>
  </body>
</html>
`;
}
