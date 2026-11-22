// La bitácora (/bitacora/): las reformas de la ley mexicana tal como quedaron
// en el historial de git de los repos de datos. Todo sale de los trailers de
// cada commit (scripts/lib/historial.mjs) y del texto de sus artículos:
//
//   /bitacora/                      reformas, por fecha de publicación
//   /bitacora/correcciones          correcciones de extracción
//   /bitacora/metadatos             cambios que solo tocaron la metadata
//   /bitacora/altas                 altas y retiros de documentos
//   /bitacora/documentos            todos los documentos con su historia
//   /bitacora/{documento}/          historia de un documento
//   /bitacora/{documento}/{sha12}   un cambio: ficha, artículos y diferencias
//   /bitacora/cambios.json          lo mismo, para máquinas
//   /bitacora/reformas.xml          Atom de las reformas
//
// Los commits `Tipo: indice` (README, registros compartidos) no son cambios de
// ningún documento y no aparecen.
//
// Cada cambio tiene además una clase, que decide dónde se lista y cómo se
// cuenta: su Tipo, salvo los cambios menores. Una corrección sin artículos
// corregidos (antes de que existiera `Tipo: metadatos`) cuenta como
// `metadatos`, y una corrección o cambio de metadatos de los primeros días de
// un documento es un `ajuste` inicial, que se pliega bajo su alta (ver
// ajustesIniciales).

import {
  ORG,
  REPOS,
  ESTADOS,
  conArticulo,
  esc,
  numero,
  plural,
  lista,
  fechaLarga,
  diaMexico,
  momento,
  tabla,
  documento as paginaHtml,
} from "./lib/comun.mjs";
import { TIPOS_DOCUMENTO, articulosDe, dirMetadata } from "./lib/historial.mjs";
import { diferenciaArticulo, diferenciaTexto, encabezado } from "./lib/diferencias.mjs";
import { vinculosDe } from "./lib/vinculos.mjs";
import { urlVotacion, urlLegislador, urlExpediente, urlSilExpediente } from "./lib/congreso.mjs";
import { ESTILO_HEMICICLO, asientosVotacion, resumenSentidos, svgMini } from "./lib/hemiciclo.mjs";
import { ESTILO_CADENA, cadenaDe, htmlCadena, htmlQuien, htmlVotos, htmlCongresos, votacionPrincipal } from "./lib/cadena.mjs";
import { ESTILO_VIDA, FILAS_VIDA, vidaDocumento, htmlCuadricula, htmlLineaVida, resumenVida } from "./lib/vida.mjs";
import { decretosDelRegistro, tituloSinDecreto } from "./lib/decretos.mjs";

const SITIO = "https://constitucion.app";
const BASE = "/bitacora";

// Etiquetas de artículos que se nombran en una línea antes de resumir con la
// cuenta, como en el título de los commits.
const EN_LINEA = 8;

// Artículos cuya diferencia se muestra en la página de un cambio; los demás
// se enlazan a GitHub. Una corrección grande toca un centenar.
const DIFERENCIAS_MAX = 150;

const REFORMAS_EN_ATOM = 50;

const NOMBRE_TIPO = {
  reforma: "Reforma",
  correccion: "Corrección de extracción",
  alta: "Alta",
  retiro: "Retiro",
  metadatos: "Metadatos",
};
const NOMBRE_CLASE = { ...NOMBRE_TIPO, ajuste: "Ajuste inicial" };

// Ventana de los ajustes iniciales, en días desde el commit de alta. Al dar de
// alta un corpus se publicaba cada ley y en las horas siguientes se mejoraba
// el parser con lo que mostraba la verificación: esas correcciones son parte
// de la puesta en marcha, no de un texto que ya se consultaba. En el
// historial caen todas en menos de un día; las siguientes son de meses
// después, así que una semana las separa sin ambigüedad.
const DIAS_AJUSTE = 7;

// Orden de los repos cuando un mismo documento está en dos: leyes-federales
// es el registro general; fiscal-mexicano, el corpus especializado.
const ORDEN_REPOS = [REPOS.cpeum, REPOS.estatales, REPOS.federales, REPOS.fiscal];

const NOMBRES_ESTADOS = Object.fromEntries(ESTADOS);

const gh = (repo, resto = "") => `https://github.com/${ORG}/${repo}${resto}`;
const urlCommit = (c) => gh(c.repo, `/commit/${c.sha}`);
const urlDocumento = (doc) => `${BASE}/${doc}/`;
const urlCambio = (c) => `${BASE}/${c.documento}/${c.id}`;
const urlDecreto = (d) => `${BASE}/decretos/${d.id}`;

const mesLargo = (dia) =>
  new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${dia}T00:00:00Z`));

// ------------------------------------------------------------------ modelo

function nombreDocumento(doc, historial) {
  if (doc === "cpeum") return { nombre: "Constitución Política de los Estados Unidos Mexicanos", sigla: "CPEUM", corpus: "cpeum" };
  if (doc.endsWith("/constitucion")) {
    const estado = doc.split("/")[0];
    const entidad = NOMBRES_ESTADOS[estado] ?? estado;
    return { nombre: `Constitución de ${conArticulo(entidad)}`, sigla: entidad, corpus: "estatal", entidad };
  }
  if (doc.includes("/")) {
    // Otra ley de un estado: 'jalisco/codigo-civil', con el nombre de fuentes.json.
    const estado = doc.split("/")[0];
    const entidad = NOMBRES_ESTADOS[estado] ?? estado;
    const n = historial[REPOS.estatales]?.ok && historial[REPOS.estatales].datos.nombres[doc];
    return { nombre: n?.nombre ?? doc, sigla: n?.sigla ?? doc, corpus: "estatal-ley", entidad };
  }
  for (const repo of [REPOS.federales, REPOS.fiscal]) {
    const n = historial[repo]?.ok && historial[repo].datos.nombres[doc];
    if (n?.nombre) return { nombre: n.nombre, sigla: n.sigla ?? doc.toUpperCase(), corpus: repo };
  }
  return { nombre: doc.toUpperCase(), sigla: doc.toUpperCase(), corpus: REPOS.federales };
}

// Etiqueta corta de un artículo: «82», «10 Bis», «Regla 2.1.1». Sale del
// encabezado de su archivo; si no lo hay, de su clave.
function etiquetaCorta(clave, texto) {
  const e = encabezado(texto?.despues) ?? encabezado(texto?.antes);
  if (!e) return clave;
  return e.replace(/^Art[íi]culo\s+/i, "").replace(/[.\s]+$/, "") || e;
}

const clavePublicacion = (c) => (c.publicaciones.length ? `${c.documento}|${c.tipo}|${c.publicaciones.join(",")}` : null);

export function modelo(historial) {
  const cambios = [];
  for (const repo of ORDEN_REPOS) {
    const r = historial[repo];
    if (!r?.ok) continue;
    for (const c of r.datos.commits) {
      if (!c.documento || !TIPOS_DOCUMENTO.includes(c.tipo)) continue;
      cambios.push({
        ...c,
        id: c.sha.slice(0, 12),
        dia: diaMexico(c.fecha),
        etiquetas: Object.fromEntries(articulosDe(c).map((k) => [k, etiquetaCorta(k, c.textos[k])])),
      });
    }
  }

  // La misma ley está en fiscal-mexicano y leyes-federales con la misma clave
  // a propósito; su reforma o alta es un solo hecho, aunque quede en dos
  // commits. Se agrupan por (Documento, Tipo, Publicacion), uno por repo: el
  // índice muestra uno y la página de cada commit enlaza al otro.
  const grupos = new Map();
  const grupoDe = new Map();
  for (const c of cambios) {
    const k = clavePublicacion(c);
    if (!k) continue;
    const g = grupos.get(k);
    if (!g) grupos.set(k, [c]);
    else if (!g.some((o) => o.repo === c.repo)) g.push(c);
    else continue;
    grupoDe.set(c, grupos.get(k));
  }
  for (const c of cambios) {
    const g = grupoDe.get(c) ?? [c];
    c.otros = g.filter((o) => o !== c);
    // El primero en registrarse representa al grupo.
    c.principal = [...g].sort((a, b) => a.fecha.localeCompare(b.fecha))[0] === c;
  }

  const documentos = new Map();
  for (const c of cambios) {
    if (!documentos.has(c.documento)) {
      documentos.set(c.documento, {
        clave: c.documento,
        ...nombreDocumento(c.documento, historial),
        repos: new Set(),
        cambios: [],
        reformasAnteriores: null,
        indice: null,
      });
    }
    const d = documentos.get(c.documento);
    d.repos.add(c.repo);
    d.cambios.push(c);
    d.reformasAnteriores ??= historial[c.repo].datos.reformas[c.documento] ?? null;
    d.indice ??= historial[c.repo].datos.articulos?.[c.documento] ?? null;
  }
  for (const d of documentos.values()) {
    d.cambios.sort((a, b) => b.fecha.localeCompare(a.fecha));
    // Retirado si su último cambio en cada repo donde estuvo es un retiro.
    d.retirado = [...d.repos].every((repo) => d.cambios.find((c) => c.repo === repo).tipo === "retiro");
    for (const c of d.cambios) c.doc = d;
    ajustesIniciales(d);
    d.vida = vidaDocumento(d.reformasAnteriores, d.indice);
  }

  const fallas = Object.entries(historial)
    .filter(([, r]) => !r.ok)
    .map(([repo, r]) => ({ repo, error: r.error }));
  return { cambios, documentos, fallas };
}

// Una corrección o un cambio de metadatos es un ajuste inicial si es del mismo
// repo que el alta más reciente anterior a él, a lo más DIAS_AJUSTE días
// después de ella por fecha de commit y antes de cualquier reforma del
// documento posterior al alta (una corrección después de una reforma ya
// corrige lo que se publicó de ella). Sin commit de alta no hay plegado. El
// orden se toma del log de cada repo, porque las fechas pueden repetirse.
function ajustesIniciales(d) {
  for (const c of d.cambios) {
    c.menor = c.tipo === "metadatos" || (c.tipo === "correccion" && !c.corregidos.length);
    c.alta = null;
    if (c.tipo === "alta") c.ajustes = [];
  }
  for (const c of d.cambios) {
    if (c.tipo !== "correccion" && c.tipo !== "metadatos") continue;
    const delRepo = d.cambios.filter((x) => x.repo === c.repo);
    const alta = delRepo.filter((x) => x.tipo === "alta" && x.orden > c.orden).sort((a, b) => a.orden - b.orden)[0];
    if (!alta) continue;
    const dias = (Date.parse(c.fecha) - Date.parse(alta.fecha)) / 86_400_000;
    const reformaEntre = delRepo.some((x) => x.tipo === "reforma" && x.orden < alta.orden && x.orden > c.orden);
    if (dias <= DIAS_AJUSTE && !reformaEntre) {
      c.alta = alta;
      alta.ajustes.push(c);
    }
  }
  for (const c of d.cambios) {
    c.clase = c.alta ? "ajuste" : c.menor ? "metadatos" : c.tipo;
    c.ajustes?.sort((a, b) => b.orden - a.orden);
  }
}

// Clase de cada commit por su sha, para quien cuenta cambios fuera de la
// bitácora (/estado).
export const clasesPorSha = (m) => new Map(m.cambios.map((c) => [c.sha, c.clase]));

// ------------------------------------------------------------------ piezas

const fechaPublicacion = (c) => c.publicaciones.at(-1) ?? null;

// Orden de las reformas: por fecha de publicación y, entre las del mismo día,
// por registro. Una reforma vieja que se registra hoy (al reconstruir la
// historia de un documento) no es una reforma reciente.
const porPublicacion = (a, b) =>
  (fechaPublicacion(b) ?? b.dia).localeCompare(fechaPublicacion(a) ?? a.dia) || b.fecha.localeCompare(a.fecha);

function textoArticulos(c, claves) {
  if (claves.length > EN_LINEA) return plural(claves.length, "artículo", "artículos");
  const ets = claves.map((k) => esc(c.etiquetas[k] ?? k));
  return `${claves.length === 1 ? "art." : "arts."} ${lista(ets)}`;
}

const nombreArchivo = (c, a) => a.ruta.slice(dirMetadata(c.documento).length);

function textoArchivos(c) {
  const as = c.archivosMetadata;
  if (as.length > EN_LINEA) return plural(as.length, "archivo", "archivos");
  return lista(as.map((a) => esc(nombreArchivo(c, a))));
}

// Qué hizo el cambio, en una línea.
function resumenCambio(c) {
  if (c.tipo === "reforma") {
    const partes = [
      [c.adicionados, "adiciona"],
      [c.modificados, "modifica"],
      [c.derogados, "deroga"],
    ]
      .filter(([l]) => l.length)
      .map(([l, verbo]) => `${verbo} ${textoArticulos(c, l)}`);
    const t = partes.join("; ") || "solo cambió la metadata";
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  if (c.tipo === "correccion" && c.corregidos.length) return `Corrige la lectura de ${textoArticulos(c, c.corregidos)}`;
  if (c.menor) return `Solo cambió la metadata${c.archivosMetadata.length ? `: ${textoArchivos(c)}` : ""}`;
  const n = c.articulosArchivo.filter((a) => a.estado === (c.tipo === "alta" ? "A" : "D")).length;
  return c.tipo === "alta" ? `Entra con ${plural(n, "artículo", "artículos")}` : `Sale con ${plural(n, "artículo", "artículos")}`;
}

const etiquetaTipo = (c) => `<span class="tipo t-${c.clase}">${esc(NOMBRE_CLASE[c.clase])}</span>`;

// Los ajustes iniciales de un alta, en una línea de enlaces.
function lineaAjustes(c) {
  if (!c.ajustes?.length) return "";
  const enlaces = c.ajustes.map(
    (a) => `<a href="${esc(urlCambio(a))}">${a.corregidos.length ? plural(a.corregidos.length, "artículo", "artículos") : "metadata"}</a>`,
  );
  return `\n<p class="c-datos">${c.ajustes.length === 1 ? "Ajuste inicial" : `${numero(c.ajustes.length)} ajustes iniciales`}: ${enlaces.join(", ")}</p>`;
}

const medioYFecha = (c) => {
  const f = fechaPublicacion(c);
  return f ? `${esc(c.medio ?? "")} <span class="fecha">${fechaLarga(f)}</span>`.trim() : "";
};

// Fila de una lista de cambios. `conDocumento` cuando la lista mezcla
// documentos; `fecha` elige si se muestra la de publicación o la de registro.
function filaCambio(c, { conDocumento = true, fecha = "registro" } = {}) {
  const publicada = fechaPublicacion(c) && (fecha === "publicacion" || c.tipo === "reforma");
  const cuando = publicada ? medioYFecha(c) : `Registrado el <span class="fecha">${fechaLarga(c.dia)}</span>`;
  const extra = [];
  if (publicada) extra.push(`registrado el <span class="fecha">${fechaLarga(c.dia)}</span>`);
  else if (fechaPublicacion(c) && c.tipo === "alta") extra.push(`versión ${medioYFecha(c)}`);
  if (c.doc.repos.size > 1) extra.push(esc(c.repo));
  if (c.otros.length) extra.push(`también en ${lista(c.otros.map((o) => esc(o.repo)))}`);
  return `<li class="cambio">
<p class="c-titulo">${etiquetaTipo(c)} <a href="${esc(urlCambio(c))}">${conDocumento ? esc(c.doc.nombre) : cuando}</a></p>
<p class="c-datos">${conDocumento ? `${cuando} · ` : ""}${resumenCambio(c)}${extra.length ? ` · ${extra.join(" · ")}` : ""}</p>${lineaAjustes(c)}
</li>`;
}

const listaCambios = (cs, opciones) => `<ul class="cambios">\n${cs.map((c) => filaCambio(c, opciones)).join("\n")}\n</ul>`;

function agrupar(cs, clave) {
  const g = new Map();
  for (const c of cs) {
    const k = clave(c);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(c);
  }
  return [...g.entries()];
}

const PESTAÑAS = [
  ["", "Reformas"],
  ["/correcciones", "Correcciones"],
  ["/altas", "Altas y retiros"],
  ["/documentos", "Documentos"],
  ["/decretos/", "Decretos"],
];

function pestañas(actual, cuentas) {
  return `<nav class="pestañas" aria-label="Vistas de la bitácora">${PESTAÑAS.map(
    ([ruta, nombre]) =>
      `<a href="${BASE}${ruta || "/"}"${ruta === actual ? ' aria-current="page"' : ""}>${nombre} <span class="cuenta">${numero(cuentas[ruta])}</span></a>`,
  ).join("")}</nav>`;
}

const avisoFallas = (fallas) =>
  fallas.length
    ? `<p class="aviso">No se pudo leer el historial de ${lista(fallas.map((f) => `${esc(f.repo)} (${esc(f.error)})`))}; sus cambios faltan en esta versión de la página.</p>`
    : "";

const ESTILO = `
:root { --puesto: #1a7f37; --quitado: #b42318; --puesto-f: #dafbe1; --quitado-f: #ffebe9; }
@media (prefers-color-scheme: dark) {
  :root { --puesto: #56d364; --quitado: #f47067; --puesto-f: #12361e; --quitado-f: #3d1416; }
}
.pestañas { display: flex; flex-wrap: wrap; gap: 0.3em 1.2em; margin: 0 0 2rem; font-size: 0.9em; }
.pestañas a { text-decoration: none; }
.pestañas a[aria-current="page"] { text-decoration: underline; text-decoration-thickness: 2px; }
.cuenta { color: var(--tenue); font-size: 0.85em; font-variant-numeric: tabular-nums; }
.cambios { list-style: none; padding: 0; margin: 0 0 2rem; }
.cambio { margin: 0; padding: 0.7rem 0; border-bottom: 1px solid var(--linea); }
.c-titulo { margin: 0; font-size: 0.95em; line-height: 1.35; }
.c-datos { margin: 0.15rem 0 0; font-size: 0.75em; line-height: 1.5; color: var(--tenue); }
.fecha { white-space: nowrap; }
.tipo { display: inline-block; margin-right: 0.35em; padding: 0 0.45em; border: 1px solid var(--linea); border-radius: 3px;
  font-size: 0.7em; font-weight: 500; line-height: 1.6; vertical-align: 0.12em; white-space: nowrap; color: var(--tenue); }
.t-reforma { color: var(--texto); border-color: var(--texto); }
h3.grupo { margin: 2rem 0 0.2rem; font-size: 0.85em; font-weight: 600; text-transform: capitalize; }
.ficha { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.35em 1.2em; margin: 0 0 2rem; font-size: 0.85em; }
.ficha dt { color: var(--tenue); }
.ficha dd { margin: 0; overflow-wrap: anywhere; }
.ficha code { font-size: 0.85em; }
.sobre { margin: -2.5rem 0 1.25rem; font-size: 0.9em; color: var(--tenue); }
.articulos { padding-left: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 0.2em 0.9em; font-size: 0.9em; }
.articulos li { margin: 0; }
.articulo { margin: 2.5rem 0 0; }
.articulo h3 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.2em 0.8em; margin: 0 0 0.6rem; font-size: 0.95em; }
.articulo h3 .enlaces { font-size: 0.8em; font-weight: 400; color: var(--tenue); }
.dif { border-left: 2px solid var(--linea); padding-left: 0.9rem; font-size: 0.88em; }
.dif p { margin: 0 0 0.7em; white-space: pre-wrap; overflow-wrap: anywhere; }
.dif .enc { font-weight: 600; }
.dif .nota { font-style: italic; color: var(--tenue); font-size: 0.92em; }
.dif .igual { color: var(--tenue); }
.dif .omitidos { color: var(--tenue); font-size: 0.85em; }
.dif .omitidos::before { content: "⋯ "; }
.dif .puesto { border-left: 3px solid var(--puesto); margin-left: calc(-0.9rem - 2px); padding-left: calc(0.9rem - 1px); }
.dif .quitado { border-left: 3px solid var(--quitado); margin-left: calc(-0.9rem - 2px); padding-left: calc(0.9rem - 1px); }
.dif .mod { border-left: 3px solid var(--tenue); margin-left: calc(-0.9rem - 2px); padding-left: calc(0.9rem - 1px); }
ins { background: var(--puesto-f); color: inherit; text-decoration: underline; text-decoration-color: var(--puesto); text-underline-offset: 0.2em; }
del { background: var(--quitado-f); color: inherit; text-decoration: line-through; text-decoration-color: var(--quitado); }
ins::before, ins::after, del::before, del::after {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
ins::before { content: " [texto nuevo: "; } del::before { content: " [texto quitado: "; }
ins::after, del::after { content: "] "; }
.muestra { padding: 0 0.25em; }
.vecinos { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; font-size: 0.85em; }
.anteriores { font-size: 0.85em; }
.anteriores summary { cursor: pointer; }
.anteriores ul { list-style: none; padding: 0; margin: 0.8rem 0 0; }
.anteriores li { margin: 0 0 0.3em; }
.archivos { padding-left: 1.2em; font-size: 0.85em; overflow-wrap: anywhere; }
.docs-b { list-style: none; padding: 0; margin: 0 0 2rem; }
.docs-b li { margin: 0; padding: 0.55rem 0; border-bottom: 1px solid var(--linea); }
.docs-b .c-titulo a { text-decoration: none; } .docs-b .c-titulo a:hover { text-decoration: underline; }
.iniciativas { padding-left: 1.2em; font-size: 0.85em; }
.iniciativas li { margin: 0 0 0.5em; }
.proceso h4 { margin: 1.5rem 0 0.6rem; font-size: 0.8em; font-weight: 600; }
.evidencia { margin-top: 0.3em; font-size: 0.9em; color: var(--tenue); }
.evidencia summary { cursor: pointer; }
.evidencia ul { padding-left: 1.2em; margin: 0.4em 0; }
.decretos { list-style: none; padding: 0; margin: 0 0 2rem; }
.decretos li { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: 0.1rem 1rem; margin: 0; padding: 0.7rem 0; border-bottom: 1px solid var(--linea); align-items: baseline; }
.decretos .f { grid-row: span 2; color: var(--tenue); font-size: 0.8em; font-variant-numeric: tabular-nums; }
.decretos .q { font-size: 0.95em; line-height: 1.35; }
.decretos .d { grid-column: 2; font-size: 0.75em; line-height: 1.5; color: var(--tenue); }
.decretos .si { color: var(--puesto); font-weight: 600; font-variant-numeric: tabular-nums; }
.decretos .no { color: var(--quitado); font-weight: 600; font-variant-numeric: tabular-nums; }
@media (max-width: 40rem) { .decretos li { grid-template-columns: minmax(0, 1fr); } .decretos .f { grid-row: auto; } .decretos .d { grid-column: 1; } }
.titulo-dof { font-size: 0.85em; color: var(--tenue); }
`;

function pagina({ titulo, h1, descripcion, cuerpo, generada, url, tarjeta, tipo, sobre = "", markdown, jsonld }) {
  const html = paginaHtml({
    ruta: `${BASE}/`,
    url,
    tarjeta,
    tipo,
    titulo: `${titulo} — OpenCodice`,
    h1,
    descripcion,
    // Cada página lleva solo el estilo de lo que muestra; el script de los
    // hemiciclos, solo si tiene uno interactivo.
    estilo: [
      ESTILO,
      cuerpo.includes('class="mini-svg') || cuerpo.includes('class="hemiciclo"') ? ESTILO_HEMICICLO : "",
      cuerpo.includes('class="tira"') || cuerpo.includes('class="estados"') ? ESTILO_CADENA : "",
      cuerpo.includes('class="cuadricula"') || cuerpo.includes('class="vida-c"') ? ESTILO_VIDA : "",
    ].join(""),
    cabeza: [
      `<link rel="alternate" type="application/atom+xml" href="${BASE}/reformas.xml" title="Reformas registradas en OpenCodice" />`,
      markdown ? `<link rel="alternate" type="text/markdown" href="${markdown}" title="Esta página en Markdown" />` : "",
      jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : "",
      cuerpo.includes('<figure class="hemiciclo"') ? '<script src="/hemiciclo.js" defer></script>' : "",
    ]
      .filter(Boolean)
      .join("\n    "),
    cuerpo: `${sobre}${cuerpo}`,
    pie: `<p>
          <a href="${BASE}/">Bitácora</a> · <a href="${BASE}/metadatos">Cambios de metadatos</a> · <a href="/leyes">Qué leyes hay</a> · <a href="/estado">Status del sistema</a> ·
          <a href="${BASE}/reformas.xml">Atom de las reformas</a> · <a href="${BASE}/cambios.json">cambios.json</a>
        </p>
        <p>Generada el ${momento(generada)} del historial de git de los repos de datos. No sustituye a la publicación oficial ni es asesoría legal.</p>`,
  });
  const alterno = `<link rel="alternate" type="application/atom+xml" href="${BASE}/reformas.xml" title="Reformas — OpenCodice" />`;
  return html.replace("</head>", `  ${alterno}\n  </head>`);
}

// ------------------------------------------------------------------ índices

function cuentas(m) {
  const principales = m.cambios.filter((c) => c.principal);
  return {
    "": principales.filter((c) => c.tipo === "reforma").length,
    "/correcciones": m.cambios.filter((c) => c.clase === "correccion").length,
    "/altas": principales.filter((c) => c.tipo === "alta" || c.tipo === "retiro").length,
    "/documentos": m.documentos.size,
    "/decretos/": m.decretos?.length ?? 0,
  };
}

const INTRO = `<p>
  Cada cambio al texto de la ley que registró OpenCodice, con los artículos que tocó y la
  diferencia exacta de su texto. Sale del historial de git de los repositorios de datos: cada
  commit es un cambio a un documento y lleva datos que escribe un programa (qué documento, qué
  tipo de cambio, cuándo se publicó y qué artículos), no una persona ni una IA.
</p>`;

function indiceReformas(m, generada) {
  const reformas = m.cambios
    .filter((c) => c.tipo === "reforma" && c.principal)
    .sort(porPublicacion);
  const porAño = agrupar(reformas, (c) => (fechaPublicacion(c) ?? c.dia).slice(0, 4));
  const cuerpo = `${INTRO}
${pestañas("", cuentas(m))}
${avisoFallas(m.fallas)}
<p>
  Las reformas, por la fecha en que se publicaron en el Diario Oficial o en el periódico oficial
  del estado. La historia de cada documento empieza en su alta: de las reformas anteriores
  conocemos la fecha, que está en la página de cada documento, y de las federales más recientes,
  su <a href="${BASE}/decretos/">decreto</a> con su proceso legislativo.
</p>
${
  porAño.length
    ? porAño.map(([año, cs]) => `<h3 class="grupo" id="a${año}">${año}</h3>\n${listaCambios(cs, { fecha: "publicacion" })}`).join("\n")
    : '<p class="tenue">Todavía no hay reformas registradas.</p>'
}`;
  return pagina({
    url: `${BASE}/`,
    titulo: "Bitácora",
    h1: "Bitácora de reformas",
    descripcion: "Las reformas a la ley mexicana registradas en OpenCodice, con los artículos que cambiaron y la diferencia de su texto.",
    cuerpo,
    generada,
  });
}

function indicePorMes(m, generada, { ruta, filtro, titulo, h1, texto, descripcion }) {
  const cs = m.cambios
    .filter(filtro)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const porMes = agrupar(cs, (c) => c.dia.slice(0, 7));
  const cuerpo = `${INTRO}
${pestañas(ruta, cuentas(m))}
${avisoFallas(m.fallas)}
${texto}
${porMes.map(([mes, g]) => `<h3 class="grupo">${esc(mesLargo(`${mes}-01`))}</h3>\n${listaCambios(g)}`).join("\n") || '<p class="tenue">Ninguno.</p>'}`;
  return pagina({ url: `${BASE}${ruta}`, titulo, h1, descripcion, cuerpo, generada });
}

const GRUPOS_DOCUMENTOS = [
  ["cpeum", "La Constitución"],
  ["estatal", "Constituciones de los estados"],
  ["estatal-ley", "Leyes de los estados"],
  [REPOS.federales, "Leyes federales"],
  [REPOS.fiscal, "Legislación fiscal"],
];

function indiceDocumentos(m, generada) {
  const docs = [...m.documentos.values()];
  const bloques = GRUPOS_DOCUMENTOS.map(([corpus, nombre]) => {
    const ds = docs
      .filter((d) => (d.corpus === corpus))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    if (!ds.length) return "";
    return `<h3 class="grupo">${esc(nombre)}</h3>
<ul class="docs-b">
${ds
  .map((d) => {
    const n = (t) => d.cambios.filter((c) => c.clase === t).length;
    const datos = [
      n("reforma") ? plural(n("reforma"), "reforma", "reformas") : "sin reformas registradas",
      n("correccion") ? plural(n("correccion"), "corrección", "correcciones") : "",
      d.retirado ? "retirado" : "",
      `último cambio el <span class="fecha">${fechaLarga(d.cambios[0].dia)}</span>`,
    ].filter(Boolean);
    return `<li><p class="c-titulo"><a href="${esc(urlDocumento(d.clave))}">${esc(d.nombre)}</a></p><p class="c-datos">${datos.join(" · ")}</p></li>`;
  })
  .join("\n")}
</ul>`;
  }).join("\n");
  const cuerpo = `${INTRO}
${pestañas("/documentos", cuentas(m))}
${avisoFallas(m.fallas)}
<p>Cada documento con su historia: su alta, sus reformas y las correcciones de su extracción.</p>
${bloques}`;
  return pagina({
    url: `${BASE}/documentos`,
    titulo: "Documentos en la bitácora",
    h1: "Bitácora: documentos",
    descripcion: "La historia de cada documento de OpenCodice: su alta, sus reformas y las correcciones de su extracción.",
    cuerpo,
    generada,
  });
}

// ------------------------------------------------------------------ documento

function textoVigente(d) {
  const repo = [...d.repos][0];
  const ruta = d.clave === "cpeum" ? "articulos" : d.corpus.startsWith("estatal") ? `${d.clave}/articulos` : d.clave;
  return { repo, ruta };
}

function reformasAnteriores(d) {
  const r = d.reformasAnteriores;
  const alta = d.cambios.at(-1);
  if (!r?.length) return "";
  const antes = r.filter((x) => x.fecha <= (fechaPublicacion(alta) ?? alta.dia));
  if (!antes.length) return "";
  const porAño = agrupar([...antes].reverse(), (x) => x.fecha.slice(0, 4));
  return `<h2 id="anteriores">Antes de su alta</h2>
<p>
  Las reformas anteriores a su alta no están como cambios: su texto anota ${plural(antes.length, "fecha de reforma", "fechas de reforma")},
  de ${fechaLarga(antes[0].fecha)} a ${fechaLarga(antes.at(-1).fecha)}.
</p>
<details class="anteriores">
<summary>Ver las fechas</summary>
<ul>
${porAño
  .map(
    ([año, xs]) =>
      `<li><strong>${año}</strong>: ${xs
        .reverse()
        .map((x) => `<span class="fecha">${esc(new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${x.fecha}T00:00:00Z`)))}</span> (${plural(x.articulos, "art.", "arts.")})`)
        .join(", ")}</li>`,
  )
  .join("\n")}
</ul>
</details>`;
}

// Los artículos del documento por número de reformas, de las notas de reforma
// de su texto vigente. Sin reformas.json no hay sección.
function seccionCuadricula(d) {
  if (!d.vida) return "";
  const original = d.vida.omitidas ? " Las fechas de 1917 son la publicación original, no reformas, y no se cuentan." : "";
  return `<h2 id="articulos-reformas">Sus artículos</h2>
<p>
  Cada cuadro es un artículo de su texto vigente; más oscuro, más reformas. Las cuenta el propio texto en
  sus notas de reforma (<code>reformas.json</code>), también las anteriores a su alta.${original}
</p>
${htmlCuadricula(d.vida, { nombre: d.nombre })}
<p class="tenue">${resumenVida(d.vida)}</p>`;
}

function paginaDocumento(m, d, generada) {
  const { repo, ruta } = textoVigente(d);
  const n = (t) => d.cambios.filter((c) => c.clase === t).length;
  const resumen = [
    plural(n("reforma"), "reforma", "reformas"),
    plural(n("correccion"), "corrección de extracción", "correcciones de extracción"),
  ];
  if (n("metadatos")) resumen.push(plural(n("metadatos"), "cambio de metadatos", "cambios de metadatos"));
  const ajustes =
    n("ajuste") === 1
      ? " El ajuste de su lectura en los días siguientes a su alta está bajo ella."
      : n("ajuste")
        ? ` Los ${numero(n("ajuste"))} ajustes de su lectura en los días siguientes a su alta están bajo ella.`
        : "";
  const sobre = `<p class="sobre"><a href="${BASE}/documentos">Bitácora</a>${d.sigla && d.sigla !== d.nombre ? ` · ${esc(d.sigla)}` : ""}${d.retirado ? " · retirado" : ""}</p>`;
  const enlaces = [...d.repos]
    .map((r) => {
      const ruta2 = r === repo ? ruta : textoVigente({ ...d, repos: new Set([r]) }).ruta;
      return `<a href="${esc(gh(r, `/tree/main/${ruta2}`))}">texto en ${esc(r)}</a> (<a href="${esc(gh(r, `/commits/main/${ruta2}`))}">historial</a>)`;
    })
    .join(" · ");
  const cuerpo = `<p>
  Desde su alta el ${fechaLarga(d.cambios.at(-1).dia)}, OpenCodice registró ${lista(resumen)}.${ajustes}
  ${d.retirado ? "Ya no se publica: su extracción dejó de reproducir fielmente el PDF oficial." : ""}
</p>
<p class="tenue">${enlaces}</p>
<h2 id="cambios">Cambios registrados</h2>
${listaCambios(
  d.cambios.filter((c) => c.clase !== "ajuste"),
  { conDocumento: false, fecha: "registro" },
)}
${seccionCuadricula(d)}
${seccionDecretos(m, d)}
${reformasAnteriores(d)}`;
  return pagina({
    url: urlDocumento(d.clave),
    tarjeta: { titulo: d.nombre, detalle: "Su historia: el alta, las reformas y las correcciones de su extracción, con la diferencia de su texto." },
    markdown: `${urlDocumento(d.clave)}index.md`,
    jsonld: d.retirado ? null : jsonldDocumento(d),
    titulo: `${d.nombre}: historia`,
    h1: d.nombre,
    descripcion: `Historia de ${d.nombre} en OpenCodice: reformas, correcciones de extracción y la diferencia de su texto.`,
    cuerpo,
    sobre,
    generada,
  });
}

// ------------------------------------------------------------------ cambio

function fichaCambio(c) {
  const filas = [];
  const nota = {
    correccion: "la ley no cambió: se leyó mejor el mismo PDF",
    metadatos: "solo cambió la metadata del documento, no el texto de sus artículos",
    ajuste: "ajuste inicial: se afinó la lectura del PDF en los días siguientes a su alta",
  }[c.clase];
  filas.push(["Tipo", `${esc(NOMBRE_TIPO[c.tipo])}${nota ? ` <span class="tenue">· ${nota}</span>` : ""}`]);
  if (c.alta) filas.push(["Ajuste de", `<a href="${esc(urlCambio(c.alta))}">${esc(tituloCambio(c.alta))}</a>`]);
  if (c.ajustes?.length) filas.push(["Ajustes iniciales", `<a href="#ajustes">${plural(c.ajustes.length, "commit", "commits")}</a>`]);
  if (c.publicaciones.length) {
    const origen =
      c.origen === "notas"
        ? "fechas nuevas en las notas de reforma del texto"
        : c.origen === "portada"
          ? "fecha de la versión en la portada del PDF"
          : "";
    filas.push([
      c.tipo === "alta" ? "Versión" : c.publicaciones.length > 1 ? "Publicaciones" : "Publicación",
      `${c.medio ? `${esc(c.medio)}: ` : ""}${lista(c.publicaciones.map((f) => `<span class="fecha">${fechaLarga(f)}</span>`))}${
        origen ? ` <span class="tenue">(${origen})</span>` : ""
      }`,
    ]);
  } else if (c.medio) filas.push(["Medio", esc(c.medio)]);
  filas.push(["Registrado", momento(c.fecha)]);
  if (c.fuente) filas.push(["Fuente oficial", `<a href="${esc(c.fuente)}">${esc(c.fuente)}</a>`]);
  if (c.sha256) filas.push(["SHA-256 de la fuente", `<code>${esc(c.sha256)}</code>`]);
  if (c.extractor) {
    const [repoExt, ver] = c.extractor.split("@");
    filas.push(["Extractor", `<a href="${esc(`https://github.com/${repoExt}/tree/${ver}`)}"><code>${esc(c.extractor)}</code></a>`]);
  }
  filas.push(["Commit", `<a href="${esc(urlCommit(c))}"><code>${esc(c.repo)}@${esc(c.sha.slice(0, 9))}</code></a>`]);
  if (c.separacion === "no-disponible") {
    filas.push(["Nota", "No se conocía el extractor de la versión anterior, así que este cambio puede incluir también correcciones de extracción."]);
  }
  for (const o of c.otros) {
    filas.push(["También en", `<a href="${esc(urlCambio(o))}">${esc(o.repo)}</a> (<a href="${esc(urlCommit(o))}">commit</a>)`]);
  }
  return `<dl class="ficha">\n${filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("\n")}\n</dl>`;
}

const ESTADO_ARTICULO = [
  ["adicionados", "Adicionado", "Adicionados"],
  ["modificados", "Modificado", "Modificados"],
  ["derogados", "Derogado", "Derogados"],
  ["corregidos", "Corregido", "Corregidos"],
];

const ESTADO_ARCHIVO = { A: "agregado", M: "modificado", D: "borrado" };

function seccionArticulos(c) {
  const claves = articulosDe(c);
  if (c.tipo === "alta" || c.tipo === "retiro") {
    const { ruta } = textoVigente({ ...c.doc, repos: new Set([c.repo]) });
    const rev = c.tipo === "retiro" ? `${c.sha}^` : c.sha;
    return `<h2 id="articulos">Artículos</h2>
<p>
  ${resumenCambio(c)}. ${c.tipo === "alta" ? "Su texto completo en esta versión" : "Su último texto publicado"} está en
  <a href="${esc(gh(c.repo, `/tree/${rev}/${ruta}`))}">GitHub</a>.
</p>`;
  }
  if (!claves.length) {
    const as = c.archivosMetadata;
    return `<h2 id="articulos">Artículos</h2>
<p>Ningún artículo cambió: solo la metadata del documento (índice, segmentos o notas de reforma).</p>${
      as.length
        ? `
<h3>Archivos de metadata</h3>
<ul class="archivos">
${as.map((a) => `<li><a href="${esc(gh(c.repo, `/blob/${a.estado === "D" ? `${c.sha}^` : c.sha}/${a.ruta}`))}"><code>${esc(a.ruta)}</code></a> <span class="tenue">${ESTADO_ARCHIVO[a.estado] ?? esc(a.estado)}</span></li>`).join("\n")}
</ul>`
        : ""
    }`;
  }
  const grupos = ESTADO_ARTICULO.filter(([k]) => c[k].length)
    .map(
      ([k, , plural]) => `<h3>${plural} (${numero(c[k].length)})</h3>
<ul class="articulos">${c[k].map((a) => `<li><a href="#art-${esc(a)}">${esc(c.etiquetas[a] ?? a)}</a></li>`).join("")}</ul>`,
    )
    .join("\n");
  const estado = Object.fromEntries(ESTADO_ARTICULO.flatMap(([k, uno]) => c[k].map((a) => [a, uno])));
  const mostrados = claves.slice(0, DIFERENCIAS_MAX);
  const difs = mostrados
    .map((k) => {
      const t = c.textos[k] ?? {};
      const d = diferenciaArticulo(t.antes, t.despues);
      const enlaces = [
        t.antes != null ? `<a href="${esc(gh(c.repo, `/blob/${c.sha}^/${t.ruta}`))}">antes</a>` : "",
        t.despues != null ? `<a href="${esc(gh(c.repo, `/blob/${c.sha}/${t.ruta}`))}">después</a>` : "",
        `<a href="${esc(gh(c.repo, `/commits/main/${t.ruta}`))}">historial</a>`,
      ].filter(Boolean);
      const cuerpo =
        t.antes == null && t.despues == null
          ? '<p class="tenue">El archivo del artículo no está ni antes ni después de este commit.</p>'
          : d.iguales
            ? '<p class="tenue">Su texto no cambió en este commit.</p>'
            : `<div class="dif">\n${d.html}\n${
                d.truncado
                  ? `<p class="omitidos">${plural(d.truncado, "párrafo más", "párrafos más")}: la diferencia completa está en <a href="${esc(urlCommit(c))}">el commit</a>.</p>`
                  : ""
              }</div>`;
      return `<section class="articulo" id="art-${esc(k)}">
<h3>${esc(encabezado(t.despues) ?? encabezado(t.antes) ?? k)} <span class="tipo">${esc(estado[k])}</span> <span class="enlaces">${enlaces.join(" · ")}</span></h3>
${cuerpo}
</section>`;
    })
    .join("\n");
  const resto = claves.length - mostrados.length;
  return `<h2 id="articulos">Artículos</h2>
${grupos}
<h2 id="texto">El texto, antes y después</h2>
<p class="leyenda"><span><del class="muestra">tachado</del> texto quitado</span> <span><ins class="muestra">subrayado</ins> texto nuevo</span> <span>los párrafos sin cambios se resumen</span></p>
${difs}
${resto > 0 ? `<p class="aviso">Faltan ${plural(resto, "artículo", "artículos")} más; su diferencia está en <a href="${esc(urlCommit(c))}">el commit</a>.</p>` : ""}`;
}

function vecinos(c) {
  const cs = c.doc.cambios;
  const i = cs.indexOf(c);
  const anterior = cs[i + 1];
  const siguiente = cs[i - 1];
  const enlace = (x, flecha) =>
    x ? `<a href="${esc(urlCambio(x))}">${flecha === "←" ? "← " : ""}${esc(NOMBRE_CLASE[x.clase])}, ${fechaLarga(x.dia)}${flecha === "→" ? " →" : ""}</a>` : "<span></span>";
  return `<nav class="vecinos" aria-label="Cambios vecinos del documento">${enlace(anterior, "←")}${enlace(siguiente, "→")}</nav>`;
}

// ---------------------------------------------- proceso legislativo

const NOMBRE_FUENTE_VOTACION = { senado: "el sitio del Senado", gaceta: "la Gaceta Parlamentaria", sil: "el SIL" };
const fuenteVotacion = (id) => NOMBRE_FUENTE_VOTACION[id.split("-")[0]] ?? "otra fuente";
const RESULTADO = { pass: "Aprobada", fail: "Rechazada" };
const AUTORES_MAX = 8;
// «OpenCodice/congreso-extractor:resoluciones/decretos/…» → el archivo en GitHub.
const urlResolucion = (r) => {
  const [repo, ruta] = r.split(":");
  return ruta ? `https://github.com/${repo}/blob/main/${ruta}` : null;
};
const mayuscula = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// El SIL repite los conteos al final del texto de la votación; ya van en sus columnas.
const queSeVoto = (v) => {
  const t = (v.motion?.text ?? "").replace(/\s*A favor:.*$/is, "").trim();
  return t || v.motion?.denominacion || "Votación";
};

function textoDiscrepancia(d) {
  const partes = [];
  if (d.counts_sil) partes.push("en los conteos");
  if (d.votantes_distintos?.length) partes.push(`en el voto de ${plural(d.votantes_distintos.length, "legislador", "legisladores")}`);
  const solo = (d.no_listados_en_sil ?? d.votantes_ausentes_en_sil ?? []).length;
  if (solo) partes.push(`en ${plural(solo, "legislador que el SIL no lista", "legisladores que el SIL no lista")}`);
  return partes.length ? lista(partes) : "en algún dato";
}

function notasVotacion(v, otras) {
  const notas = [];
  for (const o of otras) {
    const difiere = o.discrepancias?.length ? `; las dos fuentes difieren ${lista(o.discrepancias.map(textoDiscrepancia))}` : "";
    notas.push(`También en <a href="${esc(urlVotacion(o.id))}">${fuenteVotacion(o.id)}</a>${difiere}.`);
  }
  if (!v.votos_publicados && !otras.some((o) => o.votos_publicados)) notas.push("La fuente no publica el voto de cada legislador.");
  for (const x of [v, ...otras].filter((x) => x.inconsistencias?.length)) {
    notas.push(`Lo que publica ${fuenteVotacion(x.id)} no cuadra consigo mismo; los detalles están en <a href="${esc(urlVotacion(x.id))}">la votación</a>.`);
  }
  return notas.length ? `<br><span class="tenue">${notas.join(" ")}</span>` : "";
}

// Un hemiciclo pequeño por votación con el voto de cada quien (de la fuente
// que lo publique), enlazado a su página. Sin JavaScript.
function minisVotaciones(m, grupo) {
  const minis = grupo.votaciones
    .map(({ votacion: v, otras }) => {
      const conVotos = [v, ...otras].find((x) => x.votos_publicados && x.votes?.length);
      if (!conVotos) return "";
      const xs = asientosVotacion(m, conVotos);
      const resumen = resumenSentidos(xs);
      const fecha = v.start_date ? fechaLarga(v.start_date) : "sin fecha";
      return `<figure class="mini"><a href="${esc(urlVotacion(conVotos.id))}">${svgMini(xs, {
        modo: "votacion",
        etiqueta: `Hemiciclo de la votación del ${fecha}: ${resumen}.`,
      })}<span class="mini-t">${esc(fecha)}${RESULTADO[v.result] ? ` · ${esc(RESULTADO[v.result])}` : ""}</span></a>
<span>${resumen}</span></figure>`;
    })
    .filter(Boolean);
  return minis.length ? `<div class="minis">\n${minis.join("\n")}\n</div>` : "";
}

function tablaVotaciones(grupo, id) {
  const conteo = (v, opcion) => numero(v.counts?.find((x) => x.option === opcion)?.value);
  return tabla({
    id,
    titulo: grupo.nombre ?? "Votaciones",
    columnas: [
      { titulo: "Fecha" },
      { titulo: "Qué se votó" },
      { titulo: "Resultado" },
      { titulo: "A favor", num: true },
      { titulo: "En contra", num: true },
      { titulo: "Abstenciones", num: true },
      { titulo: "Ausentes", num: true },
    ],
    filas: grupo.votaciones.map(({ votacion: v, otras }) => [
      v.start_date ? `<span class="fecha">${fechaLarga(v.start_date)}</span>` : "—",
      `<a href="${esc(urlVotacion(v.id))}">${esc(queSeVoto(v))}</a>${notasVotacion(v, otras)}`,
      RESULTADO[v.result] ?? "—",
      conteo(v, "yes"),
      conteo(v, "no"),
      conteo(v, "abstain"),
      conteo(v, "absent"),
    ]),
  });
}

function textoAutor(a) {
  if (a.tipo === "legislador") return `<a href="${esc(urlLegislador(a.person_id))}">${esc(a.nombre)}</a>${a.partido ? ` (${esc(a.partido)})` : ""}`;
  // «del PAN», «de Morena».
  if (a.tipo === "grupo_parlamentario") return `el grupo parlamentario ${/^[A-Z]+$/.test(a.nombre) ? "del" : "de"} ${esc(a.nombre)}`;
  if (a.tipo === "ejecutivo_federal") return "el Ejecutivo Federal";
  return esc(a.nombre);
}

function listaIniciativas(xs) {
  return `<ul class="iniciativas">
${xs
  .map((a) => {
    let autores;
    if (!a.autores) autores = "su autor no está registrado";
    else if (!a.autores.length) autores = "sin autor registrado";
    else {
      const nombres = a.autores.slice(0, AUTORES_MAX).map(textoAutor);
      const resto = a.autores.length - nombres.length;
      autores = `por ${lista(resto > 0 ? [...nombres, plural(resto, "autor más", "autores más")] : nombres)}`;
    }
    const fecha = a.fecha ? `presentada el <span class="fecha">${fechaLarga(a.fecha)}</span>, ` : "";
    const texto = a.pdf ? ` · <a href="${esc(a.pdf)}">texto</a>` : "";
    return `<li>${esc(a.denominacion)} <span class="tenue">— ${fecha}${autores}${texto}</span></li>`;
  })
  .join("\n")}
</ul>`;
}

function textoExpediente(x) {
  const e = x.expediente;
  const nombre = e
    ? `<a href="${esc(urlExpediente(e.id))}">${esc(e.denominacion)}</a> · <a href="${esc(urlSilExpediente(e))}">ficha en el SIL</a>`
    : `<code>${esc(x.enlace.id)}</code>`;
  const camaras = e?.camara_origen
    ? `<br><span class="tenue">Cámara de origen: ${esc(e.camara_origen)}${e.camara_revisora ? `; revisora: ${esc(e.camara_revisora)}` : ""}.</span>`
    : "";
  if (!x.enlace.resolucion) return `${nombre}${camaras}`;
  const registro = urlResolucion(x.enlace.resolucion);
  const citas = (x.enlace.evidencia ?? [])
    .map((c) => `<li>${c.fuente === "dof" ? "Del decreto" : "Del expediente"}: «${esc(c.texto)}»</li>`)
    .join("");
  return `${nombre}${camaras}
<br><span class="tenue">Este enlace no lo hizo el programa: lo propuso un agente con citas textuales del decreto y del expediente, un programa comprobó que cada cita esté en su fuente y otro agente lo confirmó.</span>
<details class="evidencia"><summary>Evidencia</summary><ul>${citas}</ul>${registro ? `<p><a href="${esc(registro)}">Registro de la resolución</a></p>` : ""}</details>`;
}

function textoCandidatos(p) {
  if (!p.candidatos.length) return "No se identificó su expediente en el SIL.";
  const xs = p.candidatos.map((c) => {
    const nombre = c.expediente ? `<a href="${esc(urlExpediente(c.id))}">${esc(c.expediente.denominacion)}</a>` : `<code>${esc(c.id)}</code>`;
    return `<li>${nombre}${c.parecido != null ? ` <span class="tenue">(parecido del título: ${numero(Math.round(c.parecido * 100))} %)</span>` : ""}</li>`;
  });
  return `No se pudo saber con certeza cuál expediente del SIL le corresponde; ${p.candidatos.length === 1 ? "el posible es" : "los posibles son"}:
<ul>${xs.join("")}</ul>`;
}

function textoLegislaturas(l) {
  const nombres = (l.aprobaron ?? []).map((k) => esc(NOMBRES_ESTADOS[k] ?? k));
  const n = l.votos_aprobatorios ?? nombres.length;
  const fecha = l.fecha ? `, según la declaratoria del <span class="fecha">${fechaLarga(l.fecha)}</span>` : "";
  const contra = (l.no_aprobaron ?? []).map((k) => esc(NOMBRES_ESTADOS[k] ?? k));
  return `Lo aprobaron ${plural(n, "congreso local", "congresos locales")}${fecha}${nombres.length ? `: ${lista(nombres)}` : ""}.${
    contra.length ? ` En contra, según el SIL: ${lista(contra)}.` : ""
  }${
    l.nota ? ` <span class="tenue">${esc(mayuscula(l.nota))}.</span>` : ""
  }`;
}

function bloqueProceso(p, h, m, { resumido = false } = {}) {
  const d = p.decreto;
  const filas = [
    ["Decreto", d.url ? `<a href="${esc(d.url)}">${esc(d.titulo)}</a>` : esc(d.titulo)],
    ["Publicado", `DOF, <span class="fecha">${fechaLarga(d.fecha)}</span>`],
  ];
  if (p.mismoDia) {
    filas.push([
      "Nota",
      `Ese día el DOF publicó ${plural(p.mismoDia.length, "decreto", "decretos")} sobre este documento y este cambio los trae juntos: no se sabe qué artículos vienen de cada uno.`,
    ]);
  }
  if (p.expedientes.length) {
    for (const x of p.expedientes) filas.push(["Expediente", textoExpediente(x)]);
  } else filas.push(["Expediente", textoCandidatos(p)]);
  if (p.legislaturas) filas.push(["Congresos locales", textoLegislaturas(p.legislaturas)]);
  const partes = [`<dl class="ficha">\n${filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("\n")}\n</dl>`];
  for (const x of p.expedientes) {
    const sufijo = p.expedientes.length > 1 ? ` del expediente ${esc(x.enlace.id)}` : "";
    if (x.iniciativas.length && !resumido) partes.push(`<${h}>Iniciativas${sufijo}</${h}>\n${listaIniciativas(x.iniciativas)}`);
    if (x.votaciones.length || x.economicas.length) {
      partes.push(`<${h}>Votaciones${sufijo}</${h}>`);
      x.votaciones.forEach((g, i) => partes.push(tablaVotaciones(g, `vot-${d.id}-${x.enlace.id}-${i}`), resumido ? "" : minisVotaciones(m, g)));
      if (!x.votaciones.length) partes.push('<p class="tenue">No hubo votaciones nominales registradas.</p>');
      if (x.economicas.length) {
        const cuentas = x.economicas.map((e) => `${plural(e.n, "votación económica", "votaciones económicas")}${e.nombre ? ` en ${esc(e.nombre)}` : ""}`);
        partes.push(`<p class="tenue">Además hubo ${lista(cuentas)}: se votan sin registro nominal, así que no queda constancia de quién votó ni en qué sentido.</p>`);
      }
    }
  }
  return partes.join("\n");
}

// La cadena de cada decreto (arriba de la página) y, debajo, quién la
// propuso, cómo votó cada cámara, los congresos locales y el detalle del
// proceso legislativo. Sin decretos, nada.
function seccionVinculos(c, fuente) {
  const ps = vinculosDe(fuente, c);
  if (!ps.length) return { cadena: "", html: "" };
  const varios = ps.length > 1;
  const cads = ps.map((p) => cadenaDe(fuente, p, c, { articulos: textoArticulos(c, articulosDe(c)) }));
  const sufijo = (i) => (varios ? `-${i + 1}` : "");
  const deDecreto = (i) => (varios ? ` <span class="tenue">· decreto ${i + 1} de ${ps.length}</span>` : "");

  const cadena = `<h2 id="cadena">La cadena de la reforma</h2>
<p class="tenue">Cada paso con su fecha y los días desde el anterior. Un paso sin dato queda vacío, con su motivo.</p>
${cads
  .map(
    (cad, i) =>
      `${varios ? `<h3>Decreto ${i + 1} de ${ps.length}</h3>\n` : ""}<div class="ancho">\n${htmlCadena(cad, sufijo(i))}\n</div>`,
  )
  .join("\n")}`;

  const secciones = cads.flatMap((cad, i) => {
    const xs = [];
    const quien = htmlQuien(cad);
    if (quien) xs.push(`<h2 id="iniciativas${sufijo(i)}">Quién la propuso${deDecreto(i)}</h2>\n${quien}`);
    const votos = htmlVotos(fuente, cad, sufijo(i));
    if (votos) xs.push(`<h2 id="votos${sufijo(i)}">Cómo votaron${deDecreto(i)}</h2>\n${votos}`);
    const estados = htmlCongresos(cad);
    if (estados) xs.push(`<h2 id="estados${sufijo(i)}">Los congresos locales${deDecreto(i)}</h2>\n${estados}`);
    return xs;
  });

  // Lo que ya está arriba (iniciativas y hemiciclos de un expediente que ligó
  // el programa) no se repite en el detalle.
  const bloques = ps.map((p, i) => {
    const opciones = { resumido: Boolean(cads[i].expediente) };
    return varios
      ? `<h3>Decreto ${i + 1} de ${ps.length}</h3>\n<section class="proceso">\n${bloqueProceso(p, "h4", fuente, opciones)}\n</section>`
      : bloqueProceso(p, "h3", fuente, opciones);
  });
  const html = `${secciones.join("\n")}
<h2 id="proceso">Proceso legislativo</h2>
<p class="tenue">Del Diario Oficial de la Federación y del Sistema de Información Legislativa (SIL) de Gobernación, según <a href="https://github.com/${ORG}/congreso-mexicano">${ORG}/congreso-mexicano</a>.</p>
${bloques.join("\n")}`;
  return { cadena, html };
}

const textoVida = (vida) =>
  `<p>Cada punto es una reforma que anota el texto vigente en sus notas de reforma${vida.omitidas ? ", sin la publicación original de 1917" : ""}.</p>`;

// Los artículos que no caben en la línea de vida: se nombran si son pocos.
const NOMBRAR_RESTO = 20;
function restoVida(vida, claves, documento, etiquetas = {}) {
  const resto = claves.slice(FILAS_VIDA);
  if (!resto.length) return "";
  if (resto.length <= NOMBRAR_RESTO) {
    const nombres = resto.map((k) => vida.articulos.find((a) => a.clave === k)?.etiqueta ?? etiquetas[k] ?? k);
    return `<p class="tenue">Y ${plural(resto.length, "artículo más", "artículos más")}: ${esc(lista(nombres))}.</p>`;
  }
  return `<p class="tenue">Se muestran ${numero(FILAS_VIDA)} de ${plural(claves.length, "artículo", "artículos")}; la historia de cada uno está en <a href="${esc(urlDocumento(documento))}">la página del documento</a>.</p>`;
}

// La línea de vida de los artículos que tocó una reforma, con ella resaltada.
function seccionVida(c) {
  const d = c.doc.vida;
  if (!d || c.tipo !== "reforma") return "";
  const claves = [...c.adicionados, ...c.modificados, ...c.derogados];
  const svg = htmlLineaVida(d, claves, c.publicaciones, { etiquetas: c.etiquetas, sigla: c.doc.sigla });
  if (!svg) return "";
  return `<h2 id="vida">La vida de estos artículos</h2>
${textoVida(d)}
${svg}
${restoVida(d, claves, c.documento, c.etiquetas)}
<h3 class="grupo-vida">Dónde están en ${esc(c.doc.sigla ?? c.doc.nombre)}</h3>
<p>Cada cuadro es un artículo del texto vigente; más oscuro, más reformas. Con borde, los de esta reforma.</p>
${htmlCuadricula(d, { nombre: c.doc.nombre, resaltar: new Set(claves) })}
<p class="tenue">${resumenVida(d)}</p>`;
}

function tituloCambio(c) {
  const f = fechaPublicacion(c);
  if (c.tipo === "reforma") return f ? `Reforma del ${fechaLarga(f)}` : `Reforma registrada el ${fechaLarga(c.dia)}`;
  if (c.clase === "ajuste") return `Ajuste inicial del ${fechaLarga(c.dia)}`;
  if (c.clase === "metadatos") return `Cambio de metadatos del ${fechaLarga(c.dia)}`;
  if (c.tipo === "correccion") return `Corrección de extracción del ${fechaLarga(c.dia)}`;
  if (c.tipo === "alta") return `Alta del ${fechaLarga(c.dia)}`;
  return `Retiro del ${fechaLarga(c.dia)}`;
}

function seccionAjustes(c) {
  if (!c.ajustes?.length) return "";
  return `<h2 id="ajustes">Ajustes iniciales</h2>
<p>
  En los días siguientes a su alta, y antes de su primera reforma, se afinó la lectura del PDF
  en ${plural(c.ajustes.length, "commit", "commits")}. La ley no cambió, y no se cuentan como correcciones de extracción.
</p>
${listaCambios(c.ajustes, { conDocumento: false })}`;
}

function paginaCambio(c, generada, vinculos) {
  const sobre = `<p class="sobre"><a href="${esc(urlDocumento(c.documento))}">${esc(c.doc.nombre)}</a></p>`;
  const proceso = seccionVinculos(c, vinculos);
  const cuerpo = `<p>${resumenCambio(c)}.</p>
${proceso.cadena}
${proceso.html}
${proceso.cadena ? '<h2 id="registro">El registro</h2>\n' : ""}${fichaCambio(c)}
${seccionArticulos(c)}
${seccionVida(c)}
${seccionAjustes(c)}
<h2>En la historia del documento</h2>
${vecinos(c)}`;
  const h1 = tituloCambio(c);
  const resumen = `${resumenCambio(c).replace(/<[^>]+>/g, "")}.`;
  return pagina({
    url: urlCambio(c),
    tipo: "article",
    markdown: `${urlCambio(c)}.md`,
    tarjeta: { etiqueta: c.doc.nombre, detalle: resumen },
    titulo: `${h1} · ${c.doc.sigla ?? c.doc.nombre}`,
    h1,
    descripcion: `${NOMBRE_CLASE[c.clase]} de ${c.doc.nombre}: ${resumen}`,
    cuerpo,
    sobre,
    generada,
  });
}

// ------------------------------------------------------------------ decretos

// Los decretos de congreso-mexicano con lo que el registro sabe de cada uno:
// el commit de reforma que lo registra (si lo hay; si no, su propia página) y
// su cadena, de la que salen los conteos de las listas.
function registroDecretos(m, vinculos) {
  if (!vinculos?.ok) return [];
  const conCommit = new Map();
  const reformas = m.cambios.filter((c) => c.tipo === "reforma").sort((a, b) => Number(b.principal) - Number(a.principal));
  for (const c of reformas) for (const p of vinculosDe(vinculos, c)) if (!conCommit.has(p.decreto.id)) conCommit.set(p.decreto.id, c);
  const es = decretosDelRegistro(vinculos.decretos, m.documentos, conCommit);
  for (const e of es) {
    e.url = e.cambio ? urlCambio(e.cambio) : urlDecreto(e.decreto);
    const x = e.primario;
    const cambio = { documento: x.clave, publicaciones: [x.publicacion], tipo: "reforma", sha: null, dia: null };
    e.proceso = vinculosDe(vinculos, cambio).find((p) => p.decreto.id === e.decreto.id) ?? null;
    e.cad = e.proceso ? cadenaDe(vinculos, e.proceso, cambio, { registro: textoRegistro(e.docs) }) : null;
  }
  return es;
}

const nombreCorto = (x) => x.doc?.sigla ?? x.doc?.nombre ?? x.clave;

// Lo que dice el último paso de la cadena de un decreto sin commit, de cada
// documento que toca, agrupados por cómo quedan frente al registro.
function textoRegistro(docs) {
  const alta = (x) => (x.alta ? `<a href="${esc(urlCambio(x.alta))}">${esc(nombreCorto(x))}</a>` : esc(nombreCorto(x)));
  const de = (estado) => docs.filter((x) => x.doc && x.estado === estado);
  const partes = [];
  const incluido = de("incluido");
  if (incluido.length) partes.push(`Ya incluido: el alta de ${lista(incluido.map(alta))} es la versión de este decreto.`);
  for (const x of de("anterior")) partes.push(`Anterior al registro de ${alta(x)}, que entró con su versión del ${fechaLarga(x.version)}.`);
  for (const x of de("pendiente")) partes.push(`Sin commit todavía en ${esc(nombreCorto(x))}: su versión en OpenCodice es del ${fechaLarga(x.version)}, anterior a este decreto.`);
  const fuera = docs.filter((x) => !x.doc);
  if (fuera.length) partes.push(`${lista(fuera.map((x) => esc(x.clave)))} no ${fuera.length === 1 ? "está" : "están"} en el registro de OpenCodice.`);
  return partes.join(" ") || "Sin commit.";
}

const tituloDecreto = (e) => e.tema ?? tituloSinDecreto(e.decreto.titulo);

function conteosDecreto(e) {
  if (!e.cad) return "";
  if (!e.cad.expediente) return "sin expediente del SIL identificado con certeza";
  const xs = e.cad.votos
    .filter((v) => v.principal)
    .map((v) => {
      const k = Object.fromEntries((v.principal.votacion.counts ?? []).map((o) => [o.option, o.value]));
      return `${esc(v.camara.nombre)} <span class="si">${numero(k.yes)}</span>–<span class="no">${numero(k.no)}</span>`;
    });
  return xs.length ? xs.join(" · ") : "sin votación nominal en el SIL";
}

function filaDecreto(e, { documento = null } = {}) {
  const d = e.decreto;
  const otros = e.docs.filter((x) => x.clave !== documento);
  const leyes = documento
    ? otros.length
      ? `reforma también ${lista(otros.map((x) => (x.doc ? `<a href="${esc(urlDocumento(x.clave))}">${esc(nombreCorto(x))}</a>` : esc(x.clave))))}`
      : ""
    : lista(e.docs.map((x) => (x.doc ? `<a href="${esc(urlDocumento(x.clave))}">${esc(nombreCorto(x))}</a>` : esc(x.clave))));
  const datos = [conteosDecreto(e), leyes, e.cambio ? "con su commit en el registro" : ""].filter(Boolean).join(" · ");
  return `<li><span class="f">${d.fecha ? fechaLarga(d.fecha) : "sin fecha"}</span><a class="q" href="${esc(e.url)}">${esc(tituloDecreto(e))}</a>${
    datos ? `<span class="d">${datos}</span>` : ""
  }</li>`;
}

const listaDecretos = (es, opciones) => `<ul class="decretos">\n${es.map((e) => filaDecreto(e, opciones)).join("\n")}\n</ul>`;

// En la página de cada documento: sus decretos, con o sin commit.
function seccionDecretos(m, d) {
  const es = (m.decretos ?? []).filter((e) => e.docs.some((x) => x.clave === d.clave));
  if (!es.length) return "";
  const sin = es.filter((e) => !e.cambio).length;
  return `<h2 id="decretos">Sus decretos</h2>
<p>
  ${es.length === 1 ? "El decreto del DOF que lo reformó" : `Los ${numero(es.length)} decretos del DOF que lo reformaron`}, según
  <a href="https://github.com/${ORG}/congreso-mexicano">${ORG}/congreso-mexicano</a>, con su proceso legislativo.${
    sin ? ` ${sin === es.length ? (sin === 1 ? "Es anterior" : "Son anteriores") : `${numero(sin)} ${sin === 1 ? "es anterior" : "son anteriores"}`} a su alta: no ${sin === 1 ? "tiene" : "tienen"} commit, pero sí su cadena hasta el DOF.` : ""
  }
</p>
${listaDecretos(es, { documento: d.clave })}`;
}

function indiceDecretos(m, generada) {
  const es = m.decretos ?? [];
  const porAño = agrupar(es, (e) => (e.decreto.fecha ?? "").slice(0, 4));
  const cuerpo = `${INTRO}
${pestañas("/decretos/", cuentas(m))}
${avisoFallas(m.fallas)}
<p>
  Los decretos del Diario Oficial de la Federación que reformaron alguna ley del registro, según
  <a href="https://github.com/${ORG}/congreso-mexicano">${ORG}/congreso-mexicano</a>, cada uno con su proceso
  legislativo. Casi todos son anteriores al alta de su ley y no tienen commit: su página lleva la
  cadena de la iniciativa al DOF y los artículos que anotan las notas de reforma de esa fecha.
</p>
${
  porAño.length
    ? porAño.map(([año, xs]) => `<h3 class="grupo" id="a${año}">${año}</h3>\n${listaDecretos(xs)}`).join("\n")
    : '<p class="tenue">No se pudieron leer los decretos de congreso-mexicano.</p>'
}`;
  return pagina({
    url: `${BASE}/decretos/`,
    titulo: "Decretos",
    h1: "Bitácora: decretos",
    descripcion: "Los decretos del DOF que reformaron las leyes de OpenCodice, con su proceso legislativo: iniciativa, comisión, votaciones y publicación.",
    cuerpo,
    generada,
  });
}

// Los artículos de cada documento según sus notas de reforma de esa fecha, y
// su línea de vida.
function articulosDecreto(e) {
  const varios = e.docs.length > 1;
  return e.docs
    .map((x) => {
      const titulo = varios ? `<h3>${x.doc ? `<a href="${esc(urlDocumento(x.clave))}">${esc(x.doc.nombre)}</a>` : esc(x.clave)}</h3>\n` : "";
      if (!x.doc) return `${titulo}<p class="tenue">No está en el registro de OpenCodice.</p>`;
      if (!x.claves?.length) return `${titulo}<p class="tenue">Sus notas de reforma no anotan artículos con fecha del ${fechaLarga(x.publicacion)}.</p>`;
      const vida = x.doc.vida;
      const nombres = x.claves.map((k) => vida?.articulos.find((a) => a.clave === k)?.etiqueta ?? k);
      const juntos = x.mismoDia.length
        ? ` <span class="tenue">Ese día el DOF publicó ${plural(x.mismoDia.length + 1, "decreto", "decretos")} sobre este documento y sus notas de reforma los juntan en una sola fecha: estos artículos son de todos ellos.</span>`
        : "";
      const svg = vida ? htmlLineaVida(vida, x.claves, [x.publicacion], { sigla: x.doc.sigla }) : "";
      return `${titulo}<p>${plural(x.claves.length, "artículo", "artículos")}, según las notas de reforma de su texto vigente: ${esc(lista(nombres))}.${juntos}</p>
${svg ? `${textoVida(vida)}\n${svg}\n${restoVida(vida, x.claves, x.clave)}` : ""}
<p class="tenue">Dónde están y cuántas reformas lleva cada artículo: <a href="${esc(urlDocumento(x.clave))}#articulos-reformas">${esc(x.doc.nombre)}</a>.</p>`;
    })
    .join("\n");
}

const TITULO_H1 = 120;

function paginaDecreto(e, m, vinculos, generada) {
  const d = e.decreto;
  const cad = e.cad;
  // Sin tema, el título mismo si es corto; si no, la fecha.
  const titulo = tituloSinDecreto(d.titulo);
  const h1 = e.tema ?? (titulo.length <= TITULO_H1 ? titulo : `Decreto del ${fechaLarga(d.fecha)}`);
  const dof = d.url ? `<a href="${esc(d.url)}">DOF, ${fechaLarga(d.fecha)}</a>` : `DOF, ${fechaLarga(d.fecha)}`;
  const leyes = e.docs.map((x) => (x.doc ? `<a href="${esc(urlDocumento(x.clave))}">${esc(x.doc.nombre)}</a>` : esc(x.clave)));
  const sinRegistro = e.docs.every((x) => x.estado === "incluido" || x.estado === "anterior");
  const secciones = [];
  if (cad) {
    secciones.push(`<h2 id="cadena">La cadena del decreto</h2>
<p class="tenue">Cada paso con su fecha y los días desde el anterior. Un paso sin dato queda vacío, con su motivo.</p>
<div class="ancho">
${htmlCadena(cad)}
</div>`);
    const quien = htmlQuien(cad);
    if (quien) secciones.push(`<h2 id="iniciativas">Quién la propuso</h2>\n${quien}`);
    const votos = htmlVotos(vinculos, cad);
    if (votos) secciones.push(`<h2 id="votos">Cómo votaron</h2>\n${votos}`);
    const estados = htmlCongresos(cad);
    if (estados) secciones.push(`<h2 id="estados">Los congresos locales</h2>\n${estados}`);
  }
  secciones.push(`<h2 id="articulos">Artículos que tocó</h2>\n${articulosDecreto(e)}`);
  if (e.proceso) {
    secciones.push(`<h2 id="proceso">Proceso legislativo</h2>
<p class="tenue">Del Diario Oficial de la Federación y del Sistema de Información Legislativa (SIL) de Gobernación, según <a href="https://github.com/${ORG}/congreso-mexicano">${ORG}/congreso-mexicano</a>.</p>
${bloqueProceso(e.proceso, "h3", vinculos, { resumido: Boolean(cad?.expediente) })}`);
  }
  const cuerpo = `<p class="titulo-dof">${h1 === titulo ? dof : `«${esc(d.titulo)}» — ${dof}`}</p>
<p>${e.docs.length === 1 ? "Reforma" : "Reforma estas leyes"}: ${lista(leyes)}.</p>
${sinRegistro ? `<p class="tenue">Es anterior a que OpenCodice registrara ${e.docs.length === 1 ? "esta ley" : "estas leyes"}: no tiene commit propio ni texto de antes y después. Su texto está en el decreto del DOF.</p>` : ""}
${secciones.join("\n")}`;
  const sobre = `<p class="sobre"><a href="${BASE}/decretos/">Decretos</a> · DOF, ${fechaLarga(d.fecha)}</p>`;
  return pagina({
    url: urlDecreto(d),
    tipo: "article",
    tarjeta: { etiqueta: "Decreto", detalle: `${tituloSinDecreto(d.titulo)}. DOF, ${fechaLarga(d.fecha)}.` },
    titulo: `${h1} · DOF ${fechaLarga(d.fecha)}`,
    h1,
    descripcion: `Decreto del DOF del ${fechaLarga(d.fecha)} y su proceso legislativo: ${tituloSinDecreto(d.titulo)}.`,
    cuerpo,
    sobre,
    generada,
  });
}

// ------------------------------------------------------------------ máquinas

function cambiosJson(m, generada) {
  return JSON.stringify(
    {
      generada,
      nota: "Cambios a documentos de los repos de datos de OpenCodice, leídos de los trailers de cada commit. Un mismo hecho puede estar en dos repos: comparten Documento, Tipo y Publicacion. menor: solo cambió la metadata (Tipo metadatos, o una corrección sin artículos corregidos). ajuste_inicial: corrección o cambio de metadatos de los primeros días del documento (a lo más 7 días después de su alta en el mismo repo y antes de su primera reforma); alta es el sha del alta al que se pliega.",
      cambios: m.cambios
        .slice()
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
        .map((c) => ({
          repo: c.repo,
          sha: c.sha,
          fecha: c.fecha,
          documento: c.documento,
          nombre: c.doc.nombre,
          tipo: c.tipo,
          publicacion: c.publicaciones,
          publicacion_origen: c.origen,
          medio: c.medio,
          articulos_adicionados: c.adicionados,
          articulos_modificados: c.modificados,
          articulos_derogados: c.derogados,
          articulos_corregidos: c.corregidos,
          fuente: c.fuente,
          fuente_sha256: c.sha256,
          extractor: c.extractor,
          clase: c.clase,
          menor: c.menor,
          ajuste_inicial: Boolean(c.alta),
          alta: c.alta?.sha ?? null,
          archivos_metadata: c.menor ? c.archivosMetadata.map((a) => a.ruta) : [],
          pagina: `${SITIO}${urlCambio(c)}`,
          commit: urlCommit(c),
        })),
    },
    null,
    1,
  );
}

function atom(m, generada) {
  const reformas = m.cambios
    .filter((c) => c.tipo === "reforma" && c.principal)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, REFORMAS_EN_ATOM);
  const x = (s) => esc(s);
  const entradas = reformas
    .map((c) => {
      const url = `${SITIO}${urlCambio(c)}`;
      const titulo = `${c.doc.nombre}: ${tituloCambio(c).replace(/^Reforma/, "reforma")}`;
      return `  <entry>
    <id>${x(url)}</id>
    <title>${x(titulo)}</title>
    <link href="${x(url)}" />
    <updated>${new Date(c.fecha).toISOString()}</updated>
    <summary>${x(`${resumenCambio(c).replace(/<[^>]+>/g, "")}.`)}</summary>
  </entry>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="es-MX">
  <id>${SITIO}${BASE}/</id>
  <title>Reformas — OpenCodice</title>
  <link href="${SITIO}${BASE}/" />
  <link rel="self" href="${SITIO}${BASE}/reformas.xml" />
  <updated>${reformas[0] ? new Date(reformas[0].fecha).toISOString() : generada}</updated>
${entradas}
</feed>
`;
}

// ------------------------------------------------------------------ salida

// Archivos de la bitácora: ruta relativa a public/ → contenido.
export function paginasBitacora(m, generada, vinculos) {
  m.decretos = registroDecretos(m, vinculos);
  const archivos = new Map();
  archivos.set("bitacora/index.html", indiceReformas(m, generada));
  archivos.set(
    "bitacora/correcciones.html",
    indicePorMes(m, generada, {
      ruta: "/correcciones",
      filtro: (c) => c.clase === "correccion",
      titulo: "Correcciones de extracción",
      h1: "Bitácora: correcciones",
      descripcion: "Las correcciones de extracción de OpenCodice: la misma ley, mejor leída de su PDF oficial.",
      texto: `<p>
  En una corrección la ley no cambió: el mismo PDF oficial se leyó mejor porque se arregló el
  extractor. Se listan por la fecha en que se registraron.
</p>
<p class="tenue">
  No están aquí los ajustes iniciales (las correcciones de los primeros días de cada documento,
  que se listan con <a href="${BASE}/altas">su alta</a>) ni los cambios que solo tocaron la metadata,
  que están en <a href="${BASE}/metadatos">su propia lista</a>.
</p>`,
    }),
  );
  archivos.set(
    "bitacora/metadatos.html",
    indicePorMes(m, generada, {
      ruta: "/metadatos",
      filtro: (c) => c.clase === "metadatos",
      titulo: "Cambios de metadatos",
      h1: "Bitácora: metadatos",
      descripcion: "Los cambios de OpenCodice que solo tocaron la metadata de un documento, no el texto de sus artículos.",
      texto: `<p>
  Cambios menores: solo cambió la metadata de un documento (su índice de artículos, sus segmentos o
  sus notas de reforma), no el texto de ningún artículo. Los de los primeros días de cada documento
  están con <a href="${BASE}/altas">su alta</a>.
</p>`,
    }),
  );
  archivos.set(
    "bitacora/altas.html",
    indicePorMes(m, generada, {
      ruta: "/altas",
      filtro: (c) => (c.tipo === "alta" || c.tipo === "retiro") && c.principal,
      titulo: "Altas y retiros",
      h1: "Bitácora: altas y retiros",
      descripcion: "Los documentos que entraron a OpenCodice o salieron de él.",
      texto: `<p>
  Un alta es la entrada de un documento: desde ahí empieza su historia. Un retiro es su salida,
  cuando su extracción deja de reproducir fielmente el PDF oficial. Bajo cada alta están sus
  ajustes iniciales: las correcciones de su lectura en los días siguientes.
</p>`,
    }),
  );
  archivos.set("bitacora/documentos.html", indiceDocumentos(m, generada));
  for (const d of m.documentos.values()) {
    archivos.set(`bitacora/${d.clave}/index.html`, paginaDocumento(m, d, generada));
    for (const c of d.cambios) archivos.set(`bitacora/${d.clave}/${c.id}.html`, paginaCambio(c, generada, vinculos));
    archivos.set(`bitacora/${d.clave}/index.md`, mdDocumento(d));
    for (const c of d.cambios) archivos.set(`bitacora/${d.clave}/${c.id}.md`, mdCambio(c, vinculos));
  }
  archivos.set("bitacora/index.md", mdReformas(m));
  archivos.set("bitacora/decretos/index.html", indiceDecretos(m, generada));
  for (const e of m.decretos) if (!e.cambio) archivos.set(`bitacora/decretos/${e.decreto.id}.html`, paginaDecreto(e, m, vinculos, generada));
  archivos.set("bitacora/cambios.json", cambiosJson(m, generada));
  archivos.set("bitacora/reformas.xml", atom(m, generada));
  return archivos;
}

// ------------------------------------------------------------------ markdown

// La versión en Markdown de cada página de la bitácora, para agentes: la
// sirve el Worker a quien pide `Accept: text/markdown` y la enlaza cada página
// con `rel="alternate"`. Los mismos datos que el HTML, sin el proceso
// legislativo (está en congreso-mexicano) y con el diff como texto.

const sinHtml = (s) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const frente = (campos) =>
  `---\n${Object.entries(campos)
    .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(v)}`)
    .join("\n")}\n---\n`;

const urlLey = (doc, clave) => `${SITIO}/ley/${doc}${clave ? `/${clave}` : ""}`;

const lineaMd = (c, conDocumento) =>
  `- ${fechaPublicacion(c) ?? c.dia} · ${conDocumento ? `${c.doc.nombre} · ` : ""}${tituloCambio(c)} · ${sinHtml(resumenCambio(c))} · ${SITIO}${urlCambio(c)}`;

// El proceso legislativo de un cambio, en Markdown: lo mismo que la cadena de
// la página (decreto, expediente, votación principal de cada cámara,
// iniciativas), sin interpretar nada.
const SENTIDO_MD = { yes: "a favor", no: "en contra", abstain: "abstenciones", absent: "ausentes" };

function mdProceso(c, vinculos) {
  const ps = vinculosDe(vinculos, c);
  if (!ps.length) return null;
  const lineas = [];
  for (const p of ps) {
    const d = p.decreto;
    lineas.push(`- Decreto${d.fecha ? ` del DOF del ${d.fecha}` : ""}: ${d.titulo ?? d.id}${d.url ? ` (${d.url})` : ""}`);
    for (const x of p.expedientes) {
      if (!x.expediente) continue;
      lineas.push(`- Expediente del SIL: ${SITIO}${urlExpediente(x.expediente.id)}`);
      for (const g of x.votaciones) {
        const e = votacionPrincipal(g.votaciones);
        if (!e) continue;
        const v = e.votacion;
        const cuenta = (v.counts ?? [])
          .filter((k) => SENTIDO_MD[k.option] && k.value)
          .map((k) => `${k.value} ${SENTIDO_MD[k.option]}`)
          .join(", ");
        lineas.push(`- Votación en ${g.nombre ?? "el Congreso"}${v.start_date ? ` (${v.start_date})` : ""}: ${cuenta || "sin conteo"}. ${SITIO}${urlVotacion(v.id)}`);
      }
      for (const g of x.economicas) lineas.push(`- ${g.nombre ?? "El Congreso"}: ${plural(g.n, "votación económica", "votaciones económicas")}, sin votos nominales.`);
      for (const i of x.iniciativas.slice(0, 5)) {
        const quien = (i.autores ?? []).map((a) => `${a.nombre}${a.partido ? ` (${a.partido})` : ""}`).join(", ");
        lineas.push(`- Iniciativa${i.fecha ? ` del ${i.fecha}` : ""}: ${i.denominacion}${quien ? ` Presentada por ${quien}.` : ""}`);
      }
      if (x.iniciativas.length > 5) lineas.push(`- Y ${x.iniciativas.length - 5} iniciativas más en el expediente.`);
    }
    if (!p.expedientes.length && p.candidatos.length) lineas.push(`- Su expediente del SIL no se identificó con certeza (${p.candidatos.length} posibles).`);
    if (p.legislaturas?.aprobaron?.length) lineas.push(`- Congresos locales que la aprobaron: ${p.legislaturas.aprobaron.length}.`);
  }
  return `## Proceso legislativo\n\n${lineas.join("\n")}`;
}

function mdCambio(c, vinculos) {
  const claves = articulosDe(c);
  const estado = Object.fromEntries(ESTADO_ARTICULO.flatMap(([k, uno]) => c[k].map((a) => [a, uno])));
  const partes = [
    frente({
      documento: c.documento,
      nombre: c.doc.nombre,
      tipo: c.tipo,
      clase: c.clase,
      publicacion: c.publicaciones,
      medio: c.medio,
      registrado: c.dia,
      fuente: c.fuente,
      fuente_sha256: c.sha256,
      extractor: c.extractor,
      commit: urlCommit(c),
      pagina: `${SITIO}${urlCambio(c)}`,
      texto_vigente: c.doc.retirado ? null : urlLey(c.documento),
    }),
    `# ${tituloCambio(c)}: ${c.doc.nombre}`,
    `${sinHtml(resumenCambio(c))}.`,
  ];
  if (c.otros.length) partes.push(`El mismo hecho está registrado también en ${c.otros.map((o) => `${o.repo} (${SITIO}${urlCambio(o)}.md)`).join(", ")}.`);
  if (c.alta) partes.push(`Ajuste inicial del alta: ${SITIO}${urlCambio(c.alta)}.md`);
  const proceso = mdProceso(c, vinculos);
  if (proceso) partes.push(proceso);
  if (c.tipo === "alta" || c.tipo === "retiro" || !claves.length) {
    if (!c.doc.retirado) partes.push(`Índice y texto vigente: ${urlLey(c.documento)}`);
    return `${partes.join("\n\n")}\n`;
  }
  const mostrados = claves.slice(0, DIFERENCIAS_MAX);
  for (const k of mostrados) {
    const t = c.textos[k];
    const enlace = estado[k] === "Derogado" || c.doc.retirado ? "" : `\n\nTexto vigente: ${urlLey(c.documento, k)}`;
    const titulo = (encabezado(t?.despues) ?? encabezado(t?.antes) ?? c.etiquetas[k] ?? k).replace(/[.\s]+$/, "");
    partes.push(`## ${titulo} (${(estado[k] ?? "").toLowerCase()})${enlace}

\`\`\`\`diff
${t ? diferenciaTexto(t.antes, t.despues) : "(sin texto)"}
\`\`\`\``);
  }
  if (claves.length > mostrados.length) partes.push(`Y ${claves.length - mostrados.length} artículos más, en el commit: ${urlCommit(c)}`);
  return `${partes.join("\n\n")}\n`;
}

function mdDocumento(d) {
  return `${frente({
    documento: d.clave,
    nombre: d.nombre,
    sigla: d.sigla,
    retirado: d.retirado || null,
    texto_vigente: d.retirado ? null : urlLey(d.clave),
    pagina: `${SITIO}${urlDocumento(d.clave)}`,
  })}
# ${d.nombre}: historia en OpenCodice

Cada cambio desde su alta, del más reciente al más antiguo. Cada uno tiene su página en Markdown (la URL con \`.md\`) con la diferencia de su texto.

${d.cambios
  .filter((c) => c.clase !== "ajuste")
  .map((c) => lineaMd(c, false))
  .join("\n")}
`;
}

function mdReformas(m) {
  const xs = m.cambios.filter((c) => c.tipo === "reforma" && c.principal).sort(porPublicacion);
  return `# Bitácora de reformas de OpenCodice

Las reformas registradas, de la publicación más reciente a la más antigua (${xs.length}). Todos los cambios con sus trailers: ${SITIO}${BASE}/cambios.json. Historia de un documento: ${SITIO}${BASE}/{documento}/index.md.

${xs.map((c) => lineaMd(c, true)).join("\n")}
`;
}

// schema.org/Legislation de un documento vigente, en su página de historia.
function jsonldDocumento(d) {
  const alta = d.cambios.at(-1);
  const ultimo = d.cambios.find((c) => c.fuente) ?? d.cambios[0];
  return {
    "@context": "https://schema.org",
    "@type": "Legislation",
    name: d.nombre,
    alternateName: d.sigla && d.sigla !== d.nombre ? d.sigla : undefined,
    legislationIdentifier: d.clave,
    legislationJurisdiction: d.entidad ? { "@type": "AdministrativeArea", name: d.entidad, containedInPlace: "México" } : "MX",
    legislationLegalForce: { "@id": "https://schema.org/InForce" },
    inLanguage: "es-MX",
    url: urlLey(d.clave),
    encoding: { "@type": "MediaObject", encodingFormat: "text/markdown", contentUrl: `${urlLey(d.clave)}.md` },
    isBasedOn: ultimo?.fuente ?? undefined,
    dateModified: fechaPublicacion(d.cambios.find((c) => c.tipo === "reforma") ?? alta) ?? undefined,
    publisher: { "@type": "Organization", name: "OpenCodice", url: SITIO },
    license: "https://creativecommons.org/publicdomain/zero/1.0/",
  };
}

// Las reformas publicadas más recientemente, para el inicio.
export function ultimasReformas(m, n) {
  return m.cambios
    .filter((c) => c.tipo === "reforma" && c.principal)
    .sort(porPublicacion)
    .slice(0, n)
    .map((c) => ({
      url: urlCambio(c),
      nombre: c.doc.nombre,
      titulo: tituloCambio(c),
      resumen: resumenCambio(c),
      dia: c.dia,
      clave: c.doc.clave,
      tocados: [...c.adicionados, ...c.modificados],
      derogados: c.derogados,
    }));
}

export const historiaDe = (m, clave) => (m?.documentos.has(clave) ? urlDocumento(clave) : null);

// Su texto vigente en /ley (el Worker lo sirve de public/ley/), si se publica.
export const enLey = (m, clave) => (m?.documentos.get(clave) && !m.documentos.get(clave).retirado ? `/ley/${clave}` : null);
