// Página de inicio. Se genera en cada despliegue para que las cifras, el
// status y las últimas reformas salgan de los repos de datos.

import { ORG, REPOS, metaSocial, esc, numero, plural, fechaLarga, diaMexico, momento } from "./lib/comun.mjs";
import { ESTILO_SALUD, salud, insignia, cambios } from "./lib/resumen.mjs";
import { ultimasReformas as reformasBitacora } from "./bitacora.mjs";

const REFORMAS_EN_INICIO = 3;

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

// Artículo de ejemplo para citar: el 82 de la Constitución, con su última
// reforma tomada de la bitácora (un sha fijo envejece si el historial cambia).
function ejemploCita(bitacora) {
  const cambio = bitacora?.documentos.get("cpeum")?.cambios.find((c) => c.tipo === "reforma" && c.modificados.includes("082"));
  return {
    vigente: "/ley/cpeum/082",
    historia: "/ley/cpeum/082/historia",
    version: cambio ? `/ley/cpeum/082@${cambio.id}` : null,
    reforma: cambio ? `/bitacora/cpeum/${cambio.id}` : "/bitacora/cpeum/",
    fecha: cambio?.publicaciones.at(-1) ?? null,
  };
}

const MCP = "https://constitucion.app/mcp";

const repo = (r) => `https://github.com/${ORG}/${r}`;

// Las que quedan fuera es porque su extracción no reproduce fielmente el PDF;
// el motivo de cada una está en /leyes.
function fueraFederales(d) {
  const fuera = d.filter((x) => x.estado !== "incluida").length;
  return fuera
    ? `; <a href="/leyes">${plural(fuera, "queda fuera", "quedan fuera")}</a> porque su extracción no reproduce fielmente el PDF`
    : "";
}

// Las demás leyes de los estados viven en el mismo repo que sus constituciones.
function leyesEstatales(estados) {
  const leyes = estados.flatMap((e) => e.leyes ?? []).filter((d) => d.estado === "incluida");
  if (!leyes.length) return "";
  const n = new Set(leyes.map((d) => d.clave.split("/")[0])).size;
  return `, y <a href="/leyes#leyes-estados">${plural(leyes.length, "ley", "leyes")} de ${plural(n, "estado", "estados")}</a>`;
}

// Una línea por corpus; si su fuente no respondió, el nombre va sin cifra.
function corpus({ cpeum, federales, estatales, fiscal }) {
  const cifra = (r, f, resto = () => "") => (r.ok ? `: <span class="dato">${f(r.datos)}</span>${resto(r.datos)}` : "");
  return [
    `<a href="${repo(REPOS.cpeum)}">Constitución federal</a>${cifra(cpeum, (d) => `${numero(d.articulos)} artículos`)}.`,
    `<a href="${repo(REPOS.federales)}">Leyes federales</a>${cifra(federales, (d) => `${numero(d.filter((x) => x.estado === "incluida").length)} de ${numero(d.length)} leyes`, fueraFederales)}.`,
    `<a href="${repo(REPOS.estatales)}">Constituciones estatales</a>${cifra(estatales, (d) => `${numero(d.filter((e) => e.articulos != null).length)} de 32 entidades`, leyesEstatales)}.`,
    `<a href="${repo(REPOS.fiscal)}">Legislación fiscal</a>${cifra(fiscal, (d) => `${numero(d.length)} documentos`)}, con la Miscelánea y los criterios del SAT (<a href="https://sat.constitucion.app">detalle</a>).`,
  ]
    .map((l) => `        <li>${l}</li>`)
    .join("\n");
}

// Solo las reformas: las correcciones de extracción no cambian la ley. Salen
// de la bitácora (los trailers de cada commit); si su historial no se pudo
// leer, de los títulos de los commits recientes.
function ultimasReformas(actividad, bitacora) {
  const deBitacora = bitacora ? reformasBitacora(bitacora, REFORMAS_EN_INICIO) : [];
  if (deBitacora.length) {
    return `
      <h2>Últimas reformas</h2>
      <ul>
${deBitacora
  .map(
    (r) => `        <li>
          <a href="${esc(r.url)}">${esc(r.nombre)}: ${esc(r.titulo.replace(/^Reforma/, "reforma"))}</a>
          <span class="tenue">· ${r.resumen.charAt(0).toLowerCase()}${r.resumen.slice(1)} · registrada el ${esc(fechaLarga(r.dia))}</span>
        </li>`,
  )
  .join("\n")}
      </ul>
      <p><a href="/bitacora/">Ver todas en la bitácora →</a></p>
`;
  }
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
  const nuevas = s.nuevas.length ? ` · ${plural(s.nuevas.length, "más sin su primera corrida", "más sin su primera corrida")}` : "";
  const revision = `${nuevas}${s.ultimaRevision ? ` · última revisión: ${momento(s.ultimaRevision)}` : ""}`;
  return `<p class="status">${insignia(s)}<span class="tenue">${revision}</span></p>`;
}

export function paginaInicio(datos, generada) {
  const cita = ejemploCita(datos.bitacora);
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
    ${metaSocial({
      url: "/",
      titulo: "OpenCodice — las leyes de México, versionadas",
      descripcion: "El texto vigente de la ley mexicana, un archivo por artículo, con cada reforma registrada en git.",
      tarjeta: {
        titulo: "Las leyes de México, versionadas como código.",
        detalle: "La Constitución, las leyes federales y estatales y la legislación fiscal: un archivo por artículo y cada reforma, un commit.",
      },
    })}
    <script type="application/ld+json">${JSON_LD}</script>
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23111'/%3E%3C/svg%3E" />
    <link rel="alternate" type="text/plain" href="/llms.txt" title="Guía para agentes" />
    <link rel="alternate" type="text/markdown" href="/llms.txt" title="Esta página en Markdown" />
    <link rel="stylesheet" href="/estilo.css" />
    <style>${ESTILO_SALUD}
.status { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3em 0.6em; font-size: 0.85em; }
.status .insignia { font-size: 0.82em; }
pre.cmd { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
  </head>
  <body>
    <main>
      <header>
        <div class="cabecera">
          <p class="marca">OpenCodice</p>
          <nav aria-label="Secciones">
            <a href="/leyes">Leyes</a>
            <a href="/bitacora/">Bitácora</a>
            <a href="/congreso/">Congreso</a>
            <a href="/estado">Status</a>
            <a href="https://github.com/${ORG}">GitHub</a>
          </nav>
        </div>
        <h1>Las leyes de México, versionadas como código.</h1>
      </header>

      <p>
        El texto vigente de la ley mexicana, un archivo por artículo, en git. Cada reforma queda
        registrada con la diferencia exacta, como
        <a href="${cita.reforma}">la de${cita.fecha ? ` ${fechaLarga(cita.fecha)}` : ""} a los artículos 82, 116 y 122</a>
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
${ultimasReformas(datos.actividad, datos.bitacora)}
      <h2>El historial es el producto</h2>
      <p>
        Los repositorios de datos solo tienen commits de texto legal, uno por documento, y el
        título dice qué pasó:
      </p>
      <ul>
        <li><code>Reforma CPEUM (DOF 2026-10-07): arts. 82, 116, 122</code>: cambió la ley.</li>
        <li><code>Corrección de extracción cdmx: 23 artículos</code>: la misma ley, mejor leída del PDF.</li>
        <li><code>Alta de LGS</code> o <code>Retiro de …</code>: entra o sale un documento.</li>
      </ul>
      <p>
        Así, <code>git log -- lgs/</code> es la historia de la Ley General de Salud. Sin usar
        git, <a href="/bitacora/">la bitácora</a> muestra cada cambio con los artículos que tocó
        y la diferencia de su texto.
      </p>
      <p>
        La historia de cada documento empieza en su alta. Las reformas anteriores no están como
        commits: solo sus fechas, en <code>metadata/reformas.json</code>.
      </p>

      <p>
        <a href="/congreso/">En el Congreso</a>: cada votación nominal con el voto de cada diputado
        y senador, y lo que presenta cada legislador y en qué quedó.
      </p>

      <h2>Cómo se mantiene</h2>
      ${status(datos.vigilancia, generada)}
      <p>
        Cada lunes se descargan los PDF oficiales y un extractor determinista vuelve a generar el
        texto: la Constitución y las leyes federales, de la Cámara de Diputados; las
        constituciones estatales, de cada congreso o periódico oficial; y la Miscelánea y los
        criterios, del SAT. Los sitios estatales que solo responden desde México se descargan
        desde un servidor en México, y Baja California Sur, que solo publica en Word, se
        convierte a PDF y se guardan los dos.
      </p>
      <p>
        Un agente de IA revisa contra el PDF solo lo que cambió y, si encuentra un defecto de
        extracción, repara el extractor. Deciden pruebas deterministas que el agente no
        controla: solo se publica lo verificado y lo demás espera a la semana siguiente. Nadie
        edita el texto legal a mano. <a href="/estado">Ver el status del sistema →</a>
      </p>

      <h2>Para citar</h2>
      <p>
        Cada artículo tiene una dirección fija y cada versión, un enlace permanente que no cambia
        aunque la ley se reforme después. Por ejemplo, el artículo 82 de la Constitución:
        <a href="${cita.vigente}">texto vigente</a>,
        <a href="${cita.historia}">su historia</a>${cita.version ? ` y
        <a href="${cita.version}">la versión de su reforma del ${fechaLarga(cita.fecha)}</a>` : ""}.
      </p>

      <h2 id="agentes">Para agentes de IA</h2>
      <p>
        Un agente puede consultar todo esto por un servidor MCP o una API, sin autenticación:
        buscar en todas las leyes y en el Congreso, leer cada artículo, ver qué cambió en una
        reforma y cómo se votó, y consultar a cada legislador. Lo que recibe es el texto y los
        datos publicados, con su enlace para verificarlos: no hay respuestas generadas, y la
        búsqueda es literal.
      </p>
      <p>El servidor MCP, para cualquier cliente (Streamable HTTP, sin autenticación):</p>
      <pre class="cmd"><code>${MCP}</code></pre>
      <p>
        En ChatGPT (modo de desarrollador) o en Claude se agrega como conector con esa URL,
        sin autenticación. Desde la terminal:
      </p>
      <pre class="cmd"><code># Claude Code
claude mcp add --transport http opencodice ${MCP}
# Codex
codex mcp add opencodice --url ${MCP}</code></pre>
      <ul>
        <li>
          Cada artículo en Markdown, con su fuente, su versión y su URL para citar:
          <a href="/ley/cpeum/123"><code>/ley/cpeum/123</code></a>,
          <a href="/ley/lft/87"><code>/ley/lft/87</code></a>,
          <a href="/ley/jalisco/constitucion/4"><code>/ley/jalisco/constitucion/4</code></a>;
          el índice de cada ley, en <a href="/ley/lgs"><code>/ley/lgs</code></a>.
        </li>
        <li>
          La API, con las mismas herramientas que el MCP:
          <a href="/api/votaciones?orden=division&amp;en_lo_general=true"><code>/api/votaciones?orden=division</code></a>,
          <a href="/api/legisladores?orden=ausencia"><code>/api/legisladores?orden=ausencia</code></a>,
          <a href="/api/buscar?texto=matrimonio%20igualitario"><code>/api/buscar?texto=…</code></a>.
          Todas en <a href="/api"><code>/api</code></a> y descritas en <a href="/openapi.json"><code>/openapi.json</code></a>.
        </li>
        <li>
          <a href="/llms.txt"><code>/llms.txt</code></a> explica las rutas y
          <a href="/llms-full.txt"><code>/llms-full.txt</code></a> lista cada ley${datos.corpus ? ` (${numero(datos.corpus.documentos)} documentos, ${numero(datos.corpus.articulos)} artículos)` : ""}.
          Para todo el texto y su historia, se clona el repositorio:
        </li>
      </ul>
      <pre class="cmd"><code>git clone https://github.com/${ORG}/${REPOS.federales}</code></pre>

      <h2>Lo que sigue</h2>
      <p>
        Las demás leyes de cada estado (códigos civiles y penales, leyes orgánicas) y, junto a
        cada reforma de la bitácora, el decreto que la publicó y su paso por el Congreso.
      </p>

      <footer>
        <p>
          <a href="/leyes">Qué leyes hay</a> · <a href="/bitacora/">Bitácora de reformas</a> ·
          <a href="/estado">Status del sistema</a> · <a href="https://github.com/${ORG}">GitHub</a>
        </p>
        <p>
          Para agentes: <a href="/llms.txt">guía</a> · <a href="/api">API</a> ·
          <a href="/openapi.json">OpenAPI</a> · servidor MCP en <code>${MCP}</code>
        </p>
        <p>
          Los datos son de dominio público
          (<a href="https://creativecommons.org/publicdomain/zero/1.0/deed.es">CC0</a>) y el código
          es MIT: se pueden usar y redistribuir sin restricciones.
        </p>
        <p>
          No sustituye a la publicación oficial ni es asesoría legal.
        </p>
      </footer>
    </main>
  </body>
</html>
`;
}
