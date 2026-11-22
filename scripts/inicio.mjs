// Página de inicio. Se genera en cada despliegue para que las cifras, el
// status y las últimas reformas salgan de los repos de datos.

import { ORG, REPOS, ICONO, metaSocial, cabecera, pieSitio, tonoMas, esc, numero, plural, lista, fechaLarga, diaMexico, momento } from "./lib/comun.mjs";
import { ESTILO_SALUD, salud, insignia, cambios } from "./lib/resumen.mjs";
import { nivel, tira, mapa, conLeyes } from "./lib/cuadros.mjs";
import { ultimasReformas as reformasBitacora } from "./bitacora.mjs";

const REFORMAS_EN_INICIO = 3;

const TITULO = "OpenCodice reúne y publica la información oficial de las leyes y del Congreso de México.";
const DESCRIPCION =
  "Organización sin fines de lucro. El texto vigente de las leyes de México por artículo, cada reforma con su fecha y cada votación del Congreso con el voto de cada legislador, tomados de las fuentes oficiales.";

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
      description: DESCRIPCION,
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

// ------------------------------------------------------------------ figuras
//
// Todo cuadro es una unidad contable: un artículo, un legislador, un estado o
// dos artículos reformados. Son SVG generados aquí, que toman el color de las
// variables de estilo.css (y cambian con el tema).

const AÑO_ORIGINAL = 1917;
const POR_CUADRO = 2;

// Artículos de la Constitución reformados cada año: una columna por año, un
// cuadro por cada dos artículos.
function historial(vida, generada) {
  if (!vida) return "";
  const porAño = new Map();
  for (const a of vida.articulos) for (const f of a.fechas) porAño.set(+f.slice(0, 4), (porAño.get(+f.slice(0, 4)) ?? 0) + 1);
  const hasta = +generada.slice(0, 4);
  const años = Array.from({ length: hasta - AÑO_ORIGINAL + 1 }, (_, i) => AÑO_ORIGINAL + i);
  const alturas = años.map((a) => Math.ceil((porAño.get(a) ?? 0) / POR_CUADRO));
  const maxAlt = Math.max(...alturas, 1);
  const lado = 7;
  const paso = 9;
  const eje = 20;
  const alto = maxAlt * paso + eje;
  const cuadros = [];
  años.forEach((año, i) => {
    const x = i * paso;
    const n = alturas[i];
    if (!n) cuadros.push(`<rect x="${x}" y="${alto - eje - lado}" width="${lado}" height="${lado}" rx="2" class="e0"/>`);
    for (let j = 0; j < n; j++) {
      const titulo = j === n - 1 ? `<title>${año}: ${plural(porAño.get(año), "artículo reformado", "artículos reformados")}</title>` : "";
      cuadros.push(
        `<rect x="${x}" y="${alto - eje - (j + 1) * paso + 2}" width="${lado}" height="${lado}" rx="2" class="e${Math.max(2, nivel(j + 1, maxAlt))}">${titulo}</rect>`,
      );
    }
    if (año === AÑO_ORIGINAL || (año % 20 === 0 && año - AÑO_ORIGINAL >= 10 && hasta - año >= 4)) cuadros.push(`<text x="${x}" y="${alto - 3}" font-size="12" class="eje">${año}</text>`);
  });
  const mayores = [...porAño].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
  return `
      <figure class="ancha figura">
        <div class="desliza">
          <svg class="cuadros historial" viewBox="0 0 ${años.length * paso - 2} ${alto}" role="img" aria-label="Artículos de la Constitución reformados cada año, de ${AÑO_ORIGINAL} a ${hasta}. Los años con más reformas son ${lista(mayores.map(String))}.">
            ${cuadros.join("")}
          </svg>
        </div>
        <figcaption class="nota">Artículos de la Constitución reformados cada año, de ${AÑO_ORIGINAL} a ${hasta}. Cada cuadro son dos artículos.</figcaption>
      </figure>
`;
}

// Lo que una reforma tocó de su ley: un cuadro por artículo, en su orden.
function huella(r, articulosDe) {
  const orden = articulosDe?.get(r.clave);
  const tocados = new Set(r.tocados);
  const derogados = new Set(r.derogados);
  if (!orden?.length || !(tocados.size + derogados.size)) return "";
  const clases = orden.map((k) => (derogados.has(k) ? "c-derogado" : tocados.has(k) ? "c-cambio" : "e0"));
  const larga = orden.length > 300;
  const partes = [plural(orden.length, "artículo", "artículos"), `${numero(tocados.size)} con cambios`];
  if (derogados.size) partes.push(plural(derogados.size, "derogado", "derogados"));
  return tira(clases, larga ? 100 : 68, partes.join("; "), larga ? 1 : 2);
}

// ------------------------------------------------------------------ secciones

// Las que quedan fuera es porque su extracción no reproduce fielmente el PDF;
// el motivo de cada una está en /leyes.
const incluidas = (docs) => docs.filter((x) => x.estado === "incluida").length;

function filaPublica(href, cifra, nombre, frase) {
  return `      <a class="fila" href="${href}">
        <span class="cifra">${cifra}</span>
        <span><strong>${nombre}.</strong> ${frase}</span>
        <span class="flecha" aria-hidden="true">→</span>
      </a>`;
}

// Una fila por colección; si su fuente no respondió, la colección no se cuenta
// ni se nombra.
function quePublica({ cpeum, federales, estatales, fiscal, bitacora, congreso }) {
  const filas = [];
  const partes = [];
  let leyes = 0;
  if (cpeum.ok) {
    leyes += 1;
    partes.push("la Constitución");
  }
  if (federales.ok) {
    const n = incluidas(federales.datos);
    leyes += n;
    partes.push(`<span class="dato">${plural(n, "ley federal", "leyes federales")}</span>`);
  }
  if (estatales.ok) {
    const constituciones = estatales.datos.filter((e) => e.articulos != null).length;
    const deEstados = estatales.datos.flatMap((e) => e.leyes ?? []).filter((d) => d.estado === "incluida");
    leyes += constituciones + deEstados.length;
    partes.push(`<span class="dato">${plural(constituciones, "constitución estatal", "constituciones estatales")}</span>`);
    if (deEstados.length) {
      const estados = new Set(deEstados.map((d) => d.clave.split("/")[0])).size;
      partes.push(`<span class="dato">${plural(deEstados.length, "ley", "leyes")}</span> de ${plural(estados, "estado", "estados")}`);
    }
  }
  if (leyes) filas.push(filaPublica("/leyes", numero(leyes), "Leyes", `${lista(partes).replace(/^l/, "L")}.`));
  if (congreso) {
    const enFunciones = congreso.legisladores.filter((l) => l.en_funciones).length;
    const desde = congreso.votaciones.map((v) => v.fecha).filter(Boolean).sort()[0];
    filas.push(
      filaPublica(
        "/congreso/",
        numero(enFunciones),
        "Congreso",
        `Los legisladores en funciones, con <span class="dato">${plural(congreso.votaciones.length, "votación nominal", "votaciones nominales")}</span>${desde ? ` desde el ${fechaLarga(desde)}` : ""}.`,
      ),
    );
  }
  if (fiscal.ok) {
    filas.push(filaPublica("https://sat.constitucion.app", numero(fiscal.datos.length), "Fiscal", "La legislación fiscal, con la Miscelánea, sus anexos y los criterios del SAT."));
  }
  if (bitacora?.cambios.length) {
    filas.push(filaPublica("/bitacora/", numero(bitacora.cambios.length), "Bitácora", "Los cambios registrados, cada uno con su documento oficial y su fecha."));
  }
  if (!filas.length) return "";
  return `
      <h2>Qué publica</h2>
      <div class="filas">
${filas.join("\n")}
      </div>
`;
}

// Solo las reformas: las correcciones de extracción no cambian la ley. Salen
// de la bitácora (los trailers de cada commit); si su historial no se pudo
// leer, de los títulos de los commits recientes.
function ultimasReformas(actividad, bitacora, articulosDe) {
  const deBitacora = bitacora ? reformasBitacora(bitacora, REFORMAS_EN_INICIO) : [];
  if (deBitacora.length) {
    let conHuella = false;
    const reformas = deBitacora
      .map((r) => {
        const cuadros = huella(r, articulosDe);
        conHuella ||= Boolean(cuadros);
        return `      <div class="reforma">
        <p>
          <a href="${esc(r.url)}">${esc(r.nombre)}</a>: ${esc(r.titulo.replace(/^Reforma/, "reforma"))}.
          <span class="tenue">${esc(r.resumen)}.</span>
        </p>
        ${cuadros}
      </div>`;
      })
      .join("\n");
    return `
      <h2>Últimas reformas</h2>
${reformas}
      ${conHuella ? '<p class="nota">Cada cuadro es un artículo de la ley. En azul, los que cambió la reforma; en rojo, los que derogó.</p>' : ""}
      <p><a class="fuerte" href="/bitacora/">Ver todas en la bitácora →</a></p>
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

function constitucionesEstatales(estatales) {
  if (!estatales.ok) return "";
  const figura = mapa(estatales.datos);
  if (!figura) return "";
  const publicados = estatales.datos.filter((e) => e.articulos != null);
  const porTamaño = [...publicados].sort((a, b) => a.articulos - b.articulos);
  const menor = porTamaño[0];
  const mayor = porTamaño.at(-1);
  const leyes = publicados.filter(conLeyes).length;
  return `
      <h2>Constituciones estatales</h2>
      <p>
        ${publicados.length === 32 ? "Están las 32" : `Están ${numero(publicados.length)} de las 32`}. El mapa muestra cuántos artículos tiene cada una, de
        <span class="dato">${numero(menor.articulos)}</span> en ${esc(menor.nombre)} a <span class="dato">${numero(mayor.articulos)}</span> en ${esc(mayor.nombre)}.${
          leyes ? ` Con borde, ${plural(leyes, "el estado que ya tiene", "los estados que ya tienen")} sus demás leyes.` : ""
        }
      </p>
      ${figura}
`;
}

// Un cuadro por legislador en funciones, ordenados por su parte de ausencias.
function seccionCongreso(congreso) {
  if (!congreso) {
    return `
      <h2>Congreso</h2>
      <p>
        <a href="/congreso/">Cada votación nominal</a> de la Cámara de Diputados y del Senado con el voto de cada
        legislador, y lo que presenta cada uno y en qué quedó.
      </p>
`;
  }
  const enFunciones = congreso.legisladores.filter((l) => l.en_funciones);
  const max = Math.max(...enFunciones.map((l) => l.ausencia ?? 0), 0.01);
  const camara = (nombre, titulo) => {
    const suyos = enFunciones.filter((l) => l.camara === nombre).sort((a, b) => (a.ausencia ?? 0) - (b.ausencia ?? 0));
    if (!suyos.length) return "";
    const conDato = suyos.filter((l) => l.ausencia != null);
    const mediana = conDato.length ? Math.round(conDato[Math.floor(conDato.length / 2)].ausencia * 100) : null;
    const nombreFigura = `${numero(suyos.length)} legisladores, ordenados por su parte de ausencias en votaciones nominales${mediana == null ? "" : `. La mediana es ${mediana} por ciento`}.`;
    return `<p class="nota">${titulo}, ${numero(suyos.length)} en funciones</p>
        ${tira(suyos.map((l) => `e${nivel(l.ausencia ?? 0, max)}`), 63, nombreFigura)}`;
  };
  return `
      <h2>Congreso</h2>
      <p>
        Cada votación nominal de la Cámara de Diputados y del Senado con el voto de cada legislador, y lo que
        presenta cada uno y en qué quedó. Los datos vienen del SIL, la Gaceta Parlamentaria y el Senado.
      </p>
      <div class="camaras">
        ${camara("Cámara de Diputados", "Cámara de Diputados")}
        ${camara("Cámara de Senadores", "Senado")}
      </div>
      <p class="nota">
        Cada cuadro es un legislador, ordenados por su parte de ausencias en votaciones nominales: ${tonoMas()},
        más ausencias. La más alta es de ${Math.round(max * 100)} %.
      </p>
      <p class="botones"><a class="boton boton-borde" href="/congreso/legisladores/">Ver legisladores</a></p>
`;
}

function status(vigilancia, generada) {
  const s = salud(vigilancia, generada);
  const nuevas = s.nuevas.length ? ` · ${plural(s.nuevas.length, "más sin su primera corrida", "más sin su primera corrida")}` : "";
  const revision = `${nuevas}${s.ultimaRevision ? ` · última revisión: ${momento(s.ultimaRevision)}` : ""}`;
  return `<p class="status">${insignia(s)}<span class="tenue">${revision}</span></p>`;
}

// Cómo se agrega el servidor en cada cliente, en orden alfabético: un comando
// o archivo (`codigo`) o una instrucción (`texto`).
const CLIENTES = [
  { clave: "chatgpt", nombre: "ChatGPT", texto: "En Configuración → Conectores, con el modo de desarrollador activo, se crea un conector con la URL, sin autenticación." },
  { clave: "claude", nombre: "Claude", texto: "En Configuración → Conectores se agrega un conector personalizado con la URL, sin autenticación." },
  { clave: "claude-code", nombre: "Claude Code", codigo: `claude mcp add --transport http opencodice ${MCP}` },
  { clave: "codex", nombre: "Codex", codigo: `codex mcp add opencodice --url ${MCP}` },
  { clave: "cursor", nombre: "Cursor", nota: "En <code>~/.cursor/mcp.json</code>:", codigo: `{
  "mcpServers": {
    "opencodice": { "url": "${MCP}" }
  }
}` },
  { clave: "gemini", nombre: "Gemini CLI", codigo: `gemini mcp add --transport http opencodice ${MCP}` },
  { clave: "vscode", nombre: "VS Code", codigo: `code --add-mcp '{"name":"opencodice","type":"http","url":"${MCP}"}'` },
];

// Pestañas sin JavaScript: un grupo de radios, y el CSS muestra el panel del
// marcado. Sin CSS se leen todos los paneles, cada uno con su nombre.
function clientesMcp() {
  const radios = CLIENTES.map(
    (c, i) => `<input type="radio" name="cliente" id="cl-${c.clave}"${i ? "" : " checked"} /><label for="cl-${c.clave}">${c.nombre}</label>`,
  ).join("\n        ");
  const paneles = CLIENTES.map(
    (c) =>
      `<div class="panel" id="p-${c.clave}"><strong class="panel-nombre">${c.nombre}. </strong>${c.texto ? `<p>${c.texto}</p>` : ""}${c.nota ? `<p>${c.nota}</p>` : ""}${
        c.codigo ? `<pre class="cmd"><code>${esc(c.codigo)}</code></pre>` : ""
      }</div>`,
  ).join("\n        ");
  return `<div class="clientes" role="group" aria-label="Cliente de MCP">
        ${radios}
        ${paneles}
      </div>`;
}

const ESTILO_CLIENTES = `
.clientes { display: flex; flex-wrap: wrap; gap: 0 1.25rem; margin: 1rem 0 1.75rem; }
.clientes input { position: absolute; opacity: 0; pointer-events: none; }
.clientes label { padding: 0.375rem 0; font-size: 0.89em; color: var(--tenue); border-bottom: 2px solid transparent; cursor: pointer; }
.clientes label:hover { color: var(--texto); }
.clientes input:checked + label { color: var(--texto); font-weight: 500; border-bottom-color: var(--texto); }
.clientes input:focus-visible + label { outline: 2px solid var(--enlace); outline-offset: 3px; }
.clientes .panel { display: none; order: 1; flex: 0 0 100%; min-width: 0; padding-top: 1rem; border-top: 1px solid var(--linea); margin-top: -1px; }
.clientes .panel-nombre { display: none; }
.clientes .panel p { margin: 0 0 0.75rem; }
.clientes .panel pre { margin: 0; }
${CLIENTES.map((c) => `#cl-${c.clave}:checked ~ #p-${c.clave}`).join(", ")} { display: block; }
`;

const ESTILO_INICIO = `
main > header { margin-bottom: 1.5rem; }
.intro p { margin-bottom: 1.25rem; }
.intro .botones { margin-top: 1.75rem; }
.figura { margin-top: 4rem; margin-bottom: 0; }
.figura .historial { min-width: 44rem; }
/* En pantallas angostas la figura se desliza y abre en los años recientes. */
.figura .desliza { direction: rtl; }
.figura .desliza > * { direction: ltr; }
.figura figcaption { max-width: calc(var(--columna) - 2.5rem); margin: 0.75rem auto 0; }
.reforma { margin-bottom: 2rem; }
.reforma p { margin-bottom: 0.625rem; }
.reforma p a, .fuerte { font-weight: 500; }
.camaras .nota { margin: 1rem 0 0.5rem; }
.camaras + .nota { margin-top: 1rem; }
.status { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3em 0.6em; font-size: 0.85em; }
.status .insignia { font-size: 0.82em; }
pre.cmd { white-space: pre-wrap; overflow-wrap: anywhere; }
`;

export function paginaInicio(datos, generada) {
  const cita = ejemploCita(datos.bitacora);
  return `<!doctype html>
<html lang="es-MX">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCodice — información oficial de las leyes y del Congreso de México</title>
    <meta name="description" content="${esc(DESCRIPCION)}" />
    ${metaSocial({
      url: "/",
      titulo: "OpenCodice — información oficial de las leyes y del Congreso de México",
      descripcion: DESCRIPCION,
      tarjeta: {
        titulo: TITULO,
        detalle: "Organización sin fines de lucro. El texto de cada ley por artículo, cada reforma con su fecha y cada votación con el voto de cada legislador.",
      },
    })}
    <script type="application/ld+json">${JSON_LD}</script>
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="${ICONO}" />
    <link rel="alternate" type="text/plain" href="/llms.txt" title="Guía para agentes" />
    <link rel="alternate" type="text/markdown" href="/llms.txt" title="Esta página en Markdown" />
    <link rel="stylesheet" href="/estilo.css" />
    <style>${ESTILO_SALUD}${ESTILO_INICIO}${ESTILO_CLIENTES}</style>
  </head>
  <body>
    <main>
      <header>
        ${cabecera("/")}
        <h1>${TITULO}</h1>
      </header>

      <div class="intro">
        <p>
          Es una organización sin fines de lucro. Parte de lo que publican el Diario Oficial, la Cámara de
          Diputados, el Senado, los congresos estatales y el SAT, y lo entrega ordenado: el texto de cada ley
          por artículo, cada reforma con su fecha y cada votación con el voto de cada legislador.
        </p>
        <p class="tenue">
          Los datos son de dominio público y se consultan en esta página, por API o por un servidor MCP.
        </p>
        <p class="botones">
          <a class="boton" href="/leyes">Consultar las leyes</a>
          <a class="boton boton-borde" href="/congreso/">Consultar el Congreso</a>
          <a href="#agentes">Conectar un agente de IA →</a>
        </p>
      </div>
${historial(datos.bitacora?.documentos.get("cpeum")?.vida, generada)}${quePublica(datos)}${ultimasReformas(datos.actividad, datos.bitacora, datos.articulosDe)}${constitucionesEstatales(datos.estatales)}${seccionCongreso(datos.congreso)}
      <h2>De dónde sale cada dato</h2>
      <p>
        Los datos se guardan con control de versiones: cada uno tiene fecha, vigencia y el documento oficial
        del que salió. Las fuentes se revisan cada semana y un cambio se publica cuando coincide con el
        documento original. <a href="/estado">Ver el status del sistema →</a>
      </p>
      ${status(datos.vigilancia, generada)}

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
        Hay un servidor MCP y una API de solo lectura, sin autenticación. Sirven para buscar en las leyes y
        en el Congreso, leer un artículo, ver qué cambió en una reforma y cómo se votó, y consultar a cada
        legislador. La búsqueda es literal y cada respuesta trae el texto publicado con su enlace.
      </p>
      <p>El servidor MCP es de protocolo abierto (Streamable HTTP) y lo usa cualquier cliente con esta URL:</p>
      <pre class="cmd"><code>${MCP}</code></pre>
      <p>Cómo se agrega en algunos clientes:</p>
      ${clientesMcp()}
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
    </main>
    ${pieSitio()}
  </body>
</html>
`;
}
