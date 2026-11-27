// Lo que comparten las páginas generadas: constantes del proyecto, acceso a la
// red y formato de HTML.

import { ALTO, ANCHO, SITIO, registrar } from "./tarjeta.mjs";

export const ORG = "OpenCodice";

export const REPOS = {
  cpeum: "constitucion-mexicana",
  estatales: "leyes-estatales",
  fiscal: "fiscal-mexicano",
  federales: "leyes-federales",
};

// Documentos del índice de LeyesBiblio de la Cámara de Diputados. El índice no
// responde desde todas partes y el generador no debe depender de él, así que
// se usa este total conocido para calcular lo que falta por procesar.
export const TOTAL_INDICE_FEDERAL = 326;

// Clave de carpeta en leyes-estatales → nombre. Las claves de los estados que
// aún no están son una suposición; si el repo usa otra, la carpeta aparece
// igual, con su clave como nombre.
export const ESTADOS = [
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

// «Constitución de la Ciudad de México», no «de Ciudad de México».
export const conArticulo = (entidad) =>
  entidad === "Ciudad de México" ? "la Ciudad de México" : entidad === "Estado de México" ? "el Estado de México" : entidad;

// ------------------------------------------------------------------ red

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const TIEMPO_MAX = 20_000;

export class ErrorFuente extends Error {}

async function pedir(url, { api = false, cuerpo, texto = false } = {}) {
  const cabeceras = { "User-Agent": "opencodice-paginas" };
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
      return await (texto ? r.text() : r.json());
    } catch (e) {
      ultimo = e;
    }
  }
  throw new ErrorFuente(ultimo?.name === "TimeoutError" ? "sin respuesta" : String(ultimo?.message ?? ultimo));
}

export const crudo = (repo, ruta) => pedir(`${RAW}/${ORG}/${repo}/main/${ruta}`);
// Para lo que no es un solo JSON (un .jsonl).
export const crudoTexto = (repo, ruta) => pedir(`${RAW}/${ORG}/${repo}/main/${ruta}`, { texto: true });
export const api = (ruta) => pedir(`${API}${ruta}`, { api: true });

export async function graphql(query, variables) {
  const r = await pedir(`${API}/graphql`, { api: true, cuerpo: { query, variables } });
  if (!r || r.errors) throw new ErrorFuente(r?.errors?.[0]?.message ?? "GraphQL sin respuesta");
  return r.data;
}

// Ejecuta una lectura y convierte su falla en un valor que la página puede
// mostrar, para que una fuente caída no tumbe a las demás.
export async function intentar(fn) {
  try {
    return { ok: true, datos: await fn() };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Como Promise.all, pero con a lo más `n` peticiones a la vez: hay cientos de
// archivos pequeños por leer y no conviene abrirlos todos juntos.
export async function enParalelo(elementos, n, fn) {
  const resultados = new Array(elementos.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++;
      resultados[i] = await fn(elementos[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, elementos.length) }, trabajador));
  return resultados;
}

// ------------------------------------------------------------------ formato

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const numero = (n) => (n == null ? "—" : new Intl.NumberFormat("es-MX").format(n));

export const fechaLarga = (iso) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

const enMexico = (iso, opciones) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hourCycle: "h23", ...opciones }).format(new Date(iso));

// En prosa la fecha va completa; en las tablas, compacta y con columnas alineadas.
export const momento = (iso) =>
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

export const textoCorto = (iso) => {
  const p = partesMexico(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

export const momentoCorto = (iso) => `<time datetime="${esc(new Date(iso).toISOString())}">${textoCorto(iso)}</time>`;

// Día del calendario en la Ciudad de México, como 'YYYY-MM-DD'.
export const diaMexico = (iso) => {
  const p = partesMexico(iso);
  return `${p.year}-${p.month}-${p.day}`;
};

export const sumarDias = (dia, n) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const dia = (iso) => (iso ? `<span class="dato">${esc(iso)}</span>` : "—");

export const masReciente = (fechas) => fechas.filter(Boolean).sort().at(-1);

export const enlaceRepo = (repo, texto = `${ORG}/${repo}`) =>
  `<a href="https://github.com/${ORG}/${esc(repo)}">${esc(texto)}</a>`;

export function plural(n, uno, varios) {
  return `${numero(n)} ${n === 1 ? uno : varios}`;
}

export function lista(nombres) {
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
}

// Las tablas anchas se desplazan dentro de su contenedor, no la página entera.
export function tabla({ id, titulo, columnas, filas, vacio = "Ninguna." }) {
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

// «Más oscuro» en el tema claro y «más claro» en el oscuro, donde la escala
// de los cuadros va al revés.
export const tonoMas = (inicial = "m") =>
  `<span class="solo-claro">${inicial}ás oscuro</span><span class="solo-oscuro">${inicial}ás claro</span>`;

export const fallo = (que, r) => `<p class="aviso">No se pudo leer ${esc(que)}: ${esc(r.error)}.</p>`;

// Ancla del tooltip según la posición del elemento en su fila (i de n): en
// los extremos se alinea con el borde para no salirse de la página.
export const anclaTip = (i, n) => (i < n / 3 ? " tip-i" : i >= (2 * n) / 3 ? " tip-d" : "");

const ESTILO_COMUN = `
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
td time, th time, td .dato { white-space: nowrap; }
.aviso { padding-left: 0.9em; border-left: 2px solid var(--texto); }
.generada { color: var(--tenue); font-size: 0.85em; }
.notas { margin-top: 4.5rem; padding-top: 1.25rem; border-top: 1px solid var(--linea); font-size: 0.833em; color: var(--tenue); }
.notas a { color: inherit; }
h3 { margin: 2rem 0 0.8rem; font-size: 0.8em; font-weight: 600; }
.oculto { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.leyenda { display: flex; flex-wrap: wrap; gap: 0.4em 1.2em; align-items: center; font-size: 0.8em; color: var(--tenue); }
.leyenda > span { display: inline-flex; align-items: center; gap: 0.4em; white-space: nowrap; }
[data-tip] { position: relative; }
[data-tip]:hover::after, [data-tip]:focus-visible::after {
  content: attr(data-tip); position: absolute; bottom: calc(100% + 0.45rem); left: 50%; transform: translateX(-50%);
  z-index: 10; width: max-content; max-width: 16rem; padding: 0.35rem 0.6rem; border-radius: 4px;
  background: var(--texto); color: var(--fondo); box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
  font-size: 0.75rem; font-weight: 400; line-height: 1.35; text-align: left; white-space: normal; pointer-events: none;
}
.tip-i:hover::after, .tip-i:focus-visible::after { left: 0; transform: none; }
.tip-d:hover::after, .tip-d:focus-visible::after { left: auto; right: 0; transform: none; }
`;

// Lo que leen los buscadores y las redes al enlazar una página: la URL
// canónica, Open Graph y la tarjeta de Twitter, con su imagen (`tarjeta.mjs`).
// Sin `url` (las pruebas) se omite lo que depende de ella.
export function metaSocial({ url, titulo, descripcion, tarjeta, tipo = "website" }) {
  const imagen = registrar({ titulo: tarjeta?.titulo ?? titulo, detalle: descripcion, ...tarjeta });
  const absoluta = url ? `${SITIO}${url}` : "";
  const alt = [tarjeta?.etiqueta, tarjeta?.titulo ?? titulo].filter(Boolean).join(": ");
  return [
    absoluta && `<link rel="canonical" href="${esc(absoluta)}" />`,
    `<meta property="og:site_name" content="OpenCodice" />`,
    `<meta property="og:locale" content="es_MX" />`,
    `<meta property="og:type" content="${tipo}" />`,
    absoluta && `<meta property="og:url" content="${esc(absoluta)}" />`,
    `<meta property="og:title" content="${esc(titulo)}" />`,
    `<meta property="og:description" content="${esc(descripcion)}" />`,
    `<meta property="og:image" content="${imagen}" />`,
    `<meta property="og:image:width" content="${ANCHO}" />`,
    `<meta property="og:image:height" content="${ALTO}" />`,
    `<meta property="og:image:alt" content="${esc(alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />`,
    `<meta name="theme-color" content="#0d0d0d" media="(prefers-color-scheme: dark)" />`,
  ]
    .filter(Boolean)
    .join("\n    ");
}

export const ICONO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23111'/%3E%3C/svg%3E";

const SECCIONES = [
  ["/leyes", "Leyes"],
  ["/bitacora/", "Bitácora"],
  ["/congreso/", "Congreso"],
  ["/estado", "Status"],
  ["https://github.com/OpenCodice", "GitHub"],
];

// La barra de secciones, con la actual marcada. En el inicio la marca no es un
// enlace a sí misma.
export function cabecera(ruta) {
  const enlaces = SECCIONES.map(
    ([href, nombre]) => `<a href="${href}"${href === ruta ? ' aria-current="page"' : ""}>${nombre}</a>`,
  ).join("\n            ");
  return `<div class="cabecera">
          <p class="marca">${ruta === "/" ? "OpenCodice" : '<a href="/">OpenCodice</a>'}</p>
          <nav aria-label="Secciones">
            ${enlaces}
          </nav>
        </div>`;
}

const PIE_COLUMNAS = [
  ["Consultar", [["/leyes", "Leyes"], ["/bitacora/", "Bitácora"], ["/congreso/", "Congreso"], ["/tema", "Temas"], ["/estado", "Status"]]],
  ["Para agentes de IA", [["/mcp", "Servidor MCP"], ["/api", "API"], ["/openapi.json", "OpenAPI"], ["/llms.txt", "llms.txt"]]],
  [
    "Organización",
    [
      ["https://github.com/OpenCodice", "GitHub"],
      ["https://creativecommons.org/publicdomain/zero/1.0/deed.es", "Datos en CC0"],
      ["https://github.com/OpenCodice/constitucion-extractor", "Código libre"],
    ],
  ],
];

// El pie de todas las páginas, fuera de <main> para que la ilustración vaya de
// lado a lado. Cada tema descarga solo su imagen.
export function pieSitio() {
  const columnas = PIE_COLUMNAS.map(
    ([titulo, enlaces]) =>
      `<nav aria-label="${titulo}"><span>${titulo}</span>${enlaces.map(([href, nombre]) => `<a href="${href}">${nombre}</a>`).join("")}</nav>`,
  ).join("\n          ");
  return `<footer class="pie">
      <div class="pie-cuerpo">
        <div class="pie-marca">
          <a href="/">OpenCodice</a>
          <p>Organización sin fines de lucro. Reúne y publica la información oficial de las leyes y del Congreso de México.</p>
        </div>
        <div class="pie-columnas">
          ${columnas}
        </div>
      </div>
      <p class="pie-legal">Los datos son de dominio público y el código es MIT. No sustituye a la publicación oficial ni es asesoría legal.</p>
      <picture>
        <source srcset="/img/plaza-noche.webp" media="(prefers-color-scheme: dark)" />
        <img src="/img/plaza-dia.webp" width="2172" height="549" loading="lazy" alt="Ilustración de una plaza colonial mexicana: un palacio con portales, una catedral barroca, jacarandas, una fuente, un kiosco y casas de teja." />
      </picture>
    </footer>`;
}

// `ruta` marca la sección actual en la barra; `url` es la de la página misma;
// `tarjeta`, el texto de su imagen para redes (por omisión, la sección, el h1
// y la descripción); `cabeza`, lo que una página agregue al <head> (un script
// con `defer`, por ejemplo); `pie`, las notas propias de la página (cuándo se
// generó, de dónde salen sus datos), que van al final de su contenido.
export function documento({ titulo, h1, descripcion, estilo, cuerpo, pie, ruta, url, tarjeta, tipo, cabeza = "" }) {
  const seccion = SECCIONES.find(([href]) => href === ruta)?.[1];
  const meta = metaSocial({
    url,
    titulo: titulo.replace(/ — OpenCodice$/, ""),
    descripcion,
    // En la portada de una sección la etiqueta repetiría el título.
    tarjeta: { etiqueta: seccion === h1 ? "" : seccion, titulo: h1, ...tarjeta },
    tipo,
  });
  return `<!doctype html>
<html lang="es-MX">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(titulo)}</title>
    <meta name="description" content="${esc(descripcion)}" />
    ${meta}
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="${ICONO}" />
    <link rel="stylesheet" href="/estilo.css" />
    <style>${ESTILO_COMUN}${estilo}</style>${cabeza ? `\n    ${cabeza}` : ""}
  </head>
  <body>
    <main>
      <header>
        ${cabecera(ruta)}
        <h1>${esc(h1)}</h1>
      </header>

${cuerpo}

      <div class="notas">
        ${pie}
      </div>
    </main>
    ${pieSitio()}
  </body>
</html>
`;
}
