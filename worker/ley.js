// /ley: el texto vigente de cada documento, para agentes y para quien quiera
// leer o citar un artículo con una URL. Todo sale de los archivos que
// `scripts/lib/corpus.mjs` escribe en public/ley/ en cada despliegue: el
// Worker no consulta nada más, así que lo que responde es exactamente lo
// publicado en main de los repos de datos al desplegar.

import { mapaClaves, resolverClave } from "./claves.js";

export const SITIO = "https://constitucion.app";
const NOTA = "Texto extraído del PDF oficial por OpenCodice. No es la publicación oficial ni asesoría legal.";

// ------------------------------------------------------------------ datos

// Un isolate atiende muchas peticiones: el catálogo y los últimos documentos
// leídos se guardan en memoria. El despliegue siguiente arranca isolates nuevos.
const memoria = new Map();
const MAX_MEMORIA = 12;

async function asset(env, ruta, como = "json") {
  const clave = `${como}:${ruta}`;
  if (memoria.has(clave)) {
    const v = memoria.get(clave);
    memoria.delete(clave);
    memoria.set(clave, v);
    return v;
  }
  const r = await env.ASSETS.fetch(new Request(`${SITIO}/${ruta}`));
  if (!r.ok) return null;
  const v = como === "json" ? await r.json() : await r.text();
  memoria.set(clave, v);
  while (memoria.size > MAX_MEMORIA) memoria.delete(memoria.keys().next().value);
  return v;
}

export const catalogo = (env) => asset(env, "ley/catalogo.json");
export const indiceDe = (env, doc) => asset(env, `ley/_/${doc}.json`);
export const textoDe = (env, doc) => asset(env, `ley/_/${doc}.md`, "texto");

const mapas = new WeakMap();
function mapaDe(indice) {
  if (!mapas.has(indice)) mapas.set(indice, mapaClaves(indice.articulos.map((a) => a.clave)));
  return mapas.get(indice);
}

export function articuloDe(indice, pedido) {
  const k = resolverClave(mapaDe(indice), pedido);
  return k ? indice.articulos.find((a) => a.clave === k) : null;
}

// Documento por su clave, sin importar mayúsculas: «CPEUM», «LGS», «Jalisco/Constitucion».
export function documentoDe(cat, pedido) {
  const k = String(pedido ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
  // La sigla de una constitución estatal es el nombre del estado: `/ley/jalisco`
  // lista las leyes de Jalisco, no abre su constitución.
  return (
    cat.documentos.find((d) => d.documento === k) ??
    cat.documentos.find((d) => d.ambito !== "constitucion-estatal" && d.sigla?.toLowerCase() === k) ??
    null
  );
}

// ------------------------------------------------------------------ formato

const yaml = (campos) =>
  `---\n${Object.entries(campos)
    .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : typeof v === "string" ? JSON.stringify(v) : v}`)
    .join("\n")}\n---\n`;

export const urlArticulo = (doc, clave) => `${SITIO}/ley/${doc}/${clave}`;
const corto = (sha) => sha.slice(0, 12);

const NOMBRE_TIPO = {
  reforma: "Reforma",
  correccion: "Corrección de extracción",
  alta: "Alta",
  retiro: "Retiro",
  metadatos: "Metadatos",
  ajuste: "Ajuste inicial",
};

function lineaCambio(c, extra = "") {
  const pub = c.publicacion?.length ? ` (${c.medio ?? "publicación"} ${c.publicacion.join(", ")})` : "";
  return `- ${c.dia} · ${NOMBRE_TIPO[c.clase] ?? c.tipo}${pub} · [bitácora](${c.bitacora})${extra}`;
}

export function mdArticulo(indice, a, texto) {
  const ultimo = a.cambios.length ? indice.cambios[a.cambios[0]] : null;
  return `${yaml({
    documento: indice.documento,
    nombre: indice.nombre,
    articulo: a.clave,
    etiqueta: a.etiqueta,
    ubicacion: a.ubicacion,
    derogado: a.derogado ? true : null,
    ultima_reforma: a.ultima_reforma,
    url: urlArticulo(indice.documento, a.clave),
    version: ultimo?.sha,
    permanente: ultimo ? `${urlArticulo(indice.documento, a.clave)}@${corto(ultimo.sha)}` : null,
    historia: `${urlArticulo(indice.documento, a.clave)}/historia`,
    fuente: indice.fuente,
    nota: NOTA,
  })}\n${texto.slice(a.ini, a.fin)}\n`;
}

export function mdHistoria(indice, a) {
  const url = urlArticulo(indice.documento, a.clave);
  const lineas = a.cambios.map((i) => {
    const c = indice.cambios[i];
    return lineaCambio(c, ` · [texto en esa versión](${url}@${corto(c.sha)})`);
  });
  return `${yaml({ documento: indice.documento, articulo: a.clave, etiqueta: a.etiqueta, url, ultima_reforma: a.ultima_reforma })}
# ${a.etiqueta.replace(/[.\s]+$/, "")}: historia en OpenCodice

${lineas.length ? lineas.join("\n") : "Sin cambios registrados."}

La historia de cada documento en OpenCodice empieza en su alta. Las reformas anteriores no están como commits; sus fechas están en las notas del texto (por ejemplo _Párrafo reformado DOF 07-10-2026_)${a.ultima_reforma ? ` y la más reciente según esas notas es del ${a.ultima_reforma}` : ""}.
`;
}

export function mdIndice(indice) {
  const lineas = [];
  let lugar;
  for (const a of indice.articulos) {
    if (a.ubicacion && a.ubicacion !== lugar) {
      lugar = a.ubicacion;
      lineas.push(`\n## ${lugar}\n`);
    }
    lineas.push(`- [${a.etiqueta}](${urlArticulo(indice.documento, a.clave)})${a.derogado ? " (derogado)" : ""}`);
  }
  const ultimos = indice.cambios.filter((c) => c.clase !== "metadatos" && c.clase !== "ajuste").slice(0, 5);
  return `${yaml({
    documento: indice.documento,
    nombre: indice.nombre,
    sigla: indice.sigla,
    ambito: indice.ambito,
    entidad: indice.entidad,
    articulos: indice.articulos.length,
    fuente: indice.fuente,
    version_pdf: indice.version_pdf,
    texto: `${SITIO}/ley/${indice.documento}.md`,
    json: `${SITIO}/ley/${indice.documento}.json`,
    historia: `${SITIO}/bitacora/${indice.documento}/`,
    github: indice.github,
    nota: NOTA,
  })}
# ${indice.nombre}

${indice.articulos.length} artículos. Cada uno en \`${SITIO}/ley/${indice.documento}/{artículo}\`; el texto completo en [${indice.documento}.md](${SITIO}/ley/${indice.documento}.md).

## Últimos cambios

${ultimos.map((c) => lineaCambio(c)).join("\n") || "Ninguno."}

## Artículos
${lineas.join("\n")}
`;
}

export function mdTexto(indice, texto) {
  return `${yaml({
    documento: indice.documento,
    nombre: indice.nombre,
    sigla: indice.sigla,
    articulos: indice.articulos.length,
    url: `${SITIO}/ley/${indice.documento}.md`,
    indice: `${SITIO}/ley/${indice.documento}`,
    version: indice.cambios[0]?.sha,
    fuente: indice.fuente,
    nota: NOTA,
  })}\n${texto}`;
}

const NOMBRE_AMBITO = {
  constitucion: "Constitución federal",
  federal: "Leyes federales",
  fiscal: "Legislación fiscal",
  "constitucion-estatal": "Constituciones estatales",
  estatal: "Leyes de los estados",
};

export function lineaDocumento(d) {
  const ult = d.ultimo_cambio?.publicacion?.length ? `, versión del ${d.ultimo_cambio.publicacion.at(-1)}` : "";
  return `- [${d.nombre}](${d.url}): \`${d.documento}\`, ${d.articulos} artículos${ult}`;
}

export function mdCatalogo(cat, filtro = () => true, titulo = "OpenCodice: las leyes publicadas") {
  const partes = [];
  for (const [ambito, nombre] of Object.entries(NOMBRE_AMBITO)) {
    const xs = cat.documentos.filter((d) => d.ambito === ambito && filtro(d));
    if (xs.length) partes.push(`## ${nombre} (${xs.length})\n\n${xs.map(lineaDocumento).join("\n")}`);
  }
  return `# ${titulo}

Cada documento con su índice de artículos. Un artículo: \`${SITIO}/ley/{documento}/{artículo}\` (por ejemplo [/ley/cpeum/1](${SITIO}/ley/cpeum/1)). Guía: ${SITIO}/llms.txt. Catálogo en JSON: ${SITIO}/ley/catalogo.json.

${partes.join("\n\n") || "Ninguno."}
`;
}

// ------------------------------------------------------------------ búsqueda

// Búsqueda literal: sin acentos ni mayúsculas, todas las palabras en el mismo
// artículo. No interpreta nada; un agente que busca «despido» no encuentra
// «rescisión».
const plano = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export function buscarEn(indice, texto, consulta, limite = 20) {
  const palabras = plano(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  const resultados = [];
  for (const a of indice.articulos) {
    const original = texto.slice(a.ini, a.fin);
    // NFD + quitar marcas conserva la longitud solo si el texto ya está en
    // NFC (lo está: sale del extractor); por si acaso, el fragmento se corta
    // del texto sin acentos.
    const t = plano(original);
    if (!palabras.every((p) => t.includes(p))) continue;
    const i = t.indexOf(palabras[0]);
    const ini = Math.max(0, i - 160);
    const fin = Math.min(t.length, i + palabras[0].length + 160);
    const fragmento = (t.length === original.length ? original : t).slice(ini, fin).replace(/\s+/g, " ").trim();
    resultados.push({ clave: a.clave, etiqueta: a.etiqueta, url: urlArticulo(indice.documento, a.clave), fragmento: `${ini ? "…" : ""}${fragmento}${fin < t.length ? "…" : ""}` });
    if (resultados.length >= limite) break;
  }
  return resultados;
}

export function buscarDocumentos(cat, { consulta, ambito, entidad } = {}) {
  const ps = plano(consulta ?? "").split(/\s+/).filter(Boolean);
  return cat.documentos.filter(
    (d) =>
      (!ambito || d.ambito === ambito) &&
      (!entidad || plano(d.entidad ?? "") === plano(entidad) || d.documento.startsWith(`${plano(entidad).replace(/\s+/g, "-")}/`)) &&
      ps.every((p) => plano(`${d.nombre} ${d.sigla ?? ""} ${d.documento} ${d.entidad ?? ""}`).includes(p)),
  );
}

export function mdBusqueda(indice, consulta, resultados, limite) {
  if (!resultados.length) return `Sin resultados para «${consulta}» en ${indice.nombre}. La búsqueda es literal (sin acentos ni mayúsculas, todas las palabras en el mismo artículo): prueba con otras palabras.\n`;
  return `# «${consulta}» en ${indice.nombre}

${resultados.length === 1 ? "1 artículo" : `${resultados.length}${resultados.length >= limite ? " o más" : ""} artículos`} con todas las palabras.

${resultados.map((r) => `- [${r.etiqueta}](${r.url}): ${r.fragmento}`).join("\n")}
`;
}

// ------------------------------------------------------------------ rutas

const ENCABEZADOS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
  "X-Robots-Tag": "noindex",
};

// Markdown para quien lo pide (agentes) y texto plano para el navegador, que
// descargaría un `text/markdown` en vez de mostrarlo.
export function respuestaMd(request, cuerpo, status = 200, extra = {}) {
  const accept = request.headers.get("Accept") ?? "";
  const md = accept.includes("text/markdown") || !accept.includes("text/html");
  return new Response(cuerpo, {
    status,
    headers: { ...ENCABEZADOS, "Content-Type": `${md ? "text/markdown" : "text/plain"}; charset=utf-8`, Vary: "Accept", ...extra },
  });
}

const respuestaJson = (datos, status = 200) =>
  new Response(JSON.stringify(datos, null, 2), { status, headers: { ...ENCABEZADOS, "Content-Type": "application/json; charset=utf-8" } });

// Un artículo se sirve con la forma en que se pida («4o», «LFT/Artículo 132»),
// sin redirigir: hay clientes que no siguen redirecciones. La URL única va
// aquí y en el frontmatter.
const canonica = (url) => ({ Link: `<${url}>; rel="canonical"` });

const noEncontrado = (request, que, ayuda) =>
  respuestaMd(request, `# No encontrado\n\n${que}\n\n${ayuda ?? `El catálogo está en ${SITIO}/ley y la guía en ${SITIO}/llms.txt.`}\n`, 404);

export async function rutaLey(request, env) {
  const url = new URL(request.url);
  let ruta = decodeURIComponent(url.pathname).replace(/^\/ley\/?/, "").replace(/\/+$/, "");
  const cat = await catalogo(env);
  if (!cat) return respuestaMd(request, "El catálogo no está disponible en este despliegue.\n", 503);

  if (ruta === "" || ruta === "index.md") return respuestaMd(request, mdCatalogo(cat));
  if (ruta === "catalogo.json") return respuestaJson(cat);
  if (ruta === "buscar") return buscar(request, env, cat, url);

  let formato = "md";
  if (ruta.endsWith(".json")) {
    formato = "json";
    ruta = ruta.slice(0, -5);
  } else if (ruta.endsWith(".md")) {
    formato = "texto";
    ruta = ruta.slice(0, -3);
  }

  // La clave de un documento puede tener una diagonal (`jalisco/constitucion`):
  // gana la más larga que exista.
  const partes = ruta.split("/");
  let doc = null;
  let resto = [];
  for (let i = Math.min(partes.length, 2); i >= 1; i--) {
    const d = documentoDe(cat, partes.slice(0, i).join("/"));
    if (d) {
      doc = d;
      resto = partes.slice(i);
      break;
    }
  }
  if (!doc) {
    const estado = partes[0].toLowerCase();
    const del = cat.documentos.filter((d) => d.documento.startsWith(`${estado}/`));
    if (del.length && partes.length === 1) return respuestaMd(request, mdCatalogo(cat, (d) => d.documento.startsWith(`${estado}/`), `Leyes de ${del[0].entidad ?? estado}`));
    return noEncontrado(request, `No hay un documento \`${partes[0]}\` en OpenCodice.`);
  }
  const indice = await indiceDe(env, doc.documento);
  if (!indice) return noEncontrado(request, `No se encontró el índice de \`${doc.documento}\`.`);

  if (!resto.length) {
    if (formato === "json") return respuestaJson(indice);
    if (formato === "texto") return respuestaMd(request, mdTexto(indice, await textoDe(env, doc.documento)));
    return respuestaMd(request, mdIndice(indice), 200, canonica(`${SITIO}/ley/${doc.documento}`));
  }

  let [pedido, sub] = resto;
  if (resto.length > 2 || (sub && sub !== "historia")) return noEncontrado(request, `Ruta desconocida: \`${url.pathname}\`.`, `Un artículo es \`/ley/${doc.documento}/{artículo}\` y su historia, \`/ley/${doc.documento}/{artículo}/historia\`.`);
  let version = null;
  const arroba = pedido.indexOf("@");
  if (arroba >= 0) {
    version = pedido.slice(arroba + 1).toLowerCase();
    pedido = pedido.slice(0, arroba);
  }
  const a = articuloDe(indice, pedido);
  if (!a) {
    return noEncontrado(
      request,
      `${indice.nombre} no tiene un artículo \`${pedido}\`.`,
      `Su índice, con la URL de cada artículo, está en ${SITIO}/ley/${doc.documento}.`,
    );
  }
  if (version) {
    // Una versión anterior: el archivo en ese commit, en GitHub. Solo los
    // commits del documento, para no prometer una versión que no existe.
    const c = /^[0-9a-f]{7,40}$/.test(version) ? indice.cambios.find((x) => x.sha.startsWith(version)) : null;
    if (!c) return noEncontrado(request, `\`${version}\` no es un commit de ${indice.nombre}.`, `Las versiones de este artículo están en ${urlArticulo(doc.documento, a.clave)}/historia.`);
    return Response.redirect(`https://raw.githubusercontent.com/OpenCodice/${indice.repo}/${c.sha}/${indice.carpeta}${a.clave}.md`, 302);
  }

  if (sub === "historia") {
    if (formato === "json") return respuestaJson({ documento: doc.documento, articulo: a.clave, etiqueta: a.etiqueta, cambios: a.cambios.map((i) => indice.cambios[i]) });
    return respuestaMd(request, mdHistoria(indice, a), 200, canonica(`${urlArticulo(doc.documento, a.clave)}/historia`));
  }
  const texto = await textoDe(env, doc.documento);
  if (formato === "json") {
    const { ini, fin, cambios, ...resto2 } = a;
    return respuestaJson({
      documento: doc.documento,
      nombre: indice.nombre,
      ...resto2,
      url: urlArticulo(doc.documento, a.clave),
      texto: texto.slice(ini, fin),
      version: cambios.length ? indice.cambios[cambios[0]].sha : null,
      fuente: indice.fuente,
    });
  }
  return respuestaMd(request, mdArticulo(indice, a, texto), 200, canonica(urlArticulo(doc.documento, a.clave)));
}

async function buscar(request, env, cat, url) {
  const q = (url.searchParams.get("q") ?? "").trim();
  const docs = (url.searchParams.get("documento") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const ayuda = `Uso: \`${SITIO}/ley/buscar?q={palabras}&documento={clave}\` (hasta 5 documentos separados por coma). Sin \`documento\`, busca entre los nombres de los documentos.`;
  if (!q) return respuestaMd(request, `# Búsqueda literal\n\n${ayuda}\n`, 400);
  if (!docs.length) {
    const xs = buscarDocumentos(cat, { consulta: q });
    return respuestaMd(request, xs.length ? `# Documentos con «${q}» en su nombre\n\n${xs.map(lineaDocumento).join("\n")}\n` : `Ningún documento tiene «${q}» en su nombre.\n\n${ayuda}\n`);
  }
  if (docs.length > 5) return respuestaMd(request, `A lo más 5 documentos por búsqueda.\n\n${ayuda}\n`, 400);
  const partes = [];
  for (const k of docs) {
    const d = documentoDe(cat, k);
    if (!d) {
      partes.push(`No hay un documento \`${k}\`.\n`);
      continue;
    }
    const [indice, texto] = await Promise.all([indiceDe(env, d.documento), textoDe(env, d.documento)]);
    partes.push(mdBusqueda(indice, q, buscarEn(indice, texto, q, 30), 30));
  }
  return respuestaMd(request, partes.join("\n"));
}
