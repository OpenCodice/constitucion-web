// Lo que comparten las páginas generadas: constantes del proyecto, acceso a la
// red y formato de HTML.

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

// ------------------------------------------------------------------ red

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const TIEMPO_MAX = 20_000;

export class ErrorFuente extends Error {}

async function pedir(url, { api = false, cuerpo } = {}) {
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
      return await r.json();
    } catch (e) {
      ultimo = e;
    }
  }
  throw new ErrorFuente(ultimo?.name === "TimeoutError" ? "sin respuesta" : String(ultimo?.message ?? ultimo));
}

export const crudo = (repo, ruta) => pedir(`${RAW}/${ORG}/${repo}/main/${ruta}`);
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

export const fallo = (que, r) => `<p class="aviso">No se pudo leer ${esc(que)}: ${esc(r.error)}.</p>`;

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
td time, td .dato { white-space: nowrap; }
.aviso { padding-left: 0.9em; border-left: 2px solid var(--texto); }
.generada { color: var(--tenue); font-size: 0.85em; }
h3 { margin: 2rem 0 0.8rem; font-size: 0.8em; font-weight: 600; }
.oculto { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.leyenda { display: flex; flex-wrap: wrap; gap: 0.4em 1.2em; align-items: center; font-size: 0.8em; color: var(--tenue); }
.leyenda > span { display: inline-flex; align-items: center; gap: 0.4em; white-space: nowrap; }
`;

const ICONO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23111'/%3E%3C/svg%3E";

export function documento({ titulo, h1, descripcion, estilo, cuerpo, pie }) {
  return `<!doctype html>
<html lang="es-MX">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(titulo)}</title>
    <meta name="description" content="${esc(descripcion)}" />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="${ICONO}" />
    <link rel="stylesheet" href="/estilo.css" />
    <style>${ESTILO_COMUN}${estilo}</style>
  </head>
  <body>
    <main>
      <header>
        <p class="marca"><a href="/">OpenCodice</a></p>
        <h1>${esc(h1)}</h1>
      </header>

${cuerpo}

      <footer>
        ${pie}
      </footer>
    </main>
  </body>
</html>
`;
}
