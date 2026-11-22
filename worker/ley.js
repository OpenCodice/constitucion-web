// Las leyes: buscar un documento, leer un artículo, su índice y su historia,
// en Markdown y en JSON. Lo usan las rutas /ley/…, la API y el MCP
// (`herramientas.js`). Todo sale de los archivos de `scripts/lib/corpus.mjs`.

import { mapaClaves, resolverClave } from "./claves.js";
import { plano } from "./texto.js";
import { SITIO, NOTA, ErrorDatos, catalogo, minimoDe, trozoDe, indiceDe } from "./datos.js";

export const urlArticulo = (doc, clave) => `${SITIO}/ley/${doc}/${clave}`;
const corto = (sha) => sha.slice(0, 12);
const sinPunto = (s) => String(s ?? "").replace(/[.\s]+$/, "");

export const yaml = (campos) =>
  `---\n${Object.entries(campos)
    .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : typeof v === "string" ? JSON.stringify(v) : v}`)
    .join("\n")}\n---\n`;

// ------------------------------------------------------------------ documentos

// Documento por su clave, sin importar mayúsculas, o por su sigla. La sigla de
// una constitución estatal es el nombre del estado, así que no cuenta:
// `/ley/jalisco` lista las leyes de Jalisco, no abre su constitución.
export function documentoDe(cat, pedido) {
  const k = String(pedido ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
  return (
    cat.documentos.find((d) => d.documento === k) ??
    cat.documentos.find((d) => d.ambito !== "constitucion-estatal" && d.sigla?.toLowerCase() === k) ??
    null
  );
}

export async function documentoOError(env, pedido) {
  const d = documentoDe(await catalogo(env), pedido);
  if (!d) throw new ErrorDatos(`No hay un documento «${pedido}» en OpenCodice. Su clave se busca con buscar_documentos (o en ${SITIO}/ley).`);
  return d;
}

export const AMBITOS = {
  constitucion: "Constitución federal",
  federal: "Leyes federales",
  fiscal: "Legislación fiscal",
  "constitucion-estatal": "Constituciones estatales",
  estatal: "Leyes de los estados",
};

export function buscarDocumentos(cat, { consulta, ambito, entidad } = {}) {
  const ps = plano(consulta ?? "").split(/\s+/).filter(Boolean);
  const ent = plano(entidad ?? "").trim();
  return cat.documentos.filter(
    (d) =>
      (!ambito || d.ambito === ambito) &&
      (!ent || plano(d.entidad ?? "") === ent || d.documento.startsWith(`${ent.replace(/\s+/g, "-")}/`)) &&
      ps.every((p) => plano(`${d.nombre} ${d.sigla ?? ""} ${d.documento} ${d.entidad ?? ""}`).includes(p)),
  );
}

export function lineaDocumento(d) {
  const ult = d.ultimo_cambio?.publicacion?.length ? `, versión del ${d.ultimo_cambio.publicacion.at(-1)}` : "";
  return `- [${d.nombre}](${d.url}): \`${d.documento}\`, ${d.articulos} artículos${ult}`;
}

export function mdCatalogo(cat, filtro = () => true, titulo = "OpenCodice: las leyes publicadas") {
  const partes = [];
  for (const [ambito, nombre] of Object.entries(AMBITOS)) {
    const xs = cat.documentos.filter((d) => d.ambito === ambito && filtro(d));
    if (xs.length) partes.push(`## ${nombre} (${xs.length})\n\n${xs.map(lineaDocumento).join("\n")}`);
  }
  return `# ${titulo}

Cada documento con su índice de artículos. Un artículo: \`${SITIO}/ley/{documento}/{artículo}\` (por ejemplo [/ley/cpeum/1](${SITIO}/ley/cpeum/1)). Guía: ${SITIO}/llms.txt. API: ${SITIO}/api. Catálogo en JSON: ${SITIO}/ley/catalogo.json.

${partes.join("\n\n") || "Ninguno."}
`;
}

// ------------------------------------------------------------------ artículos

const mapas = new WeakMap();
function mapaDe(minimo) {
  if (!mapas.has(minimo)) mapas.set(minimo, mapaClaves(minimo.claves));
  return mapas.get(minimo);
}

// El artículo pedido de un documento, como se escriba («4o», «77 Bis 35 A»),
// o null, con la ficha mínima del documento.
export async function leerArticulo(env, doc, pedido) {
  const minimo = await minimoDe(env, doc);
  if (!minimo) throw new ErrorDatos(`No se encontró el documento ${doc}.`);
  const clave = resolverClave(mapaDe(minimo), String(pedido ?? ""));
  if (!clave) return { minimo, articulo: null };
  return { minimo, articulo: await articuloPorPosicion(env, minimo, minimo.claves.indexOf(clave)) };
}

export async function articuloPorPosicion(env, minimo, i) {
  const trozo = await trozoDe(env, minimo.documento, minimo.trozo[i]);
  return trozo?.find((a) => a.clave === minimo.claves[i]) ?? null;
}

export function datosArticulo(minimo, a) {
  const ultimo = a.cambios.length ? minimo.cambios[a.cambios[0]] : null;
  return {
    documento: minimo.documento,
    nombre: minimo.nombre,
    clave: a.clave,
    etiqueta: a.etiqueta,
    ubicacion: a.ubicacion ?? null,
    derogado: Boolean(a.derogado),
    ultima_reforma: a.ultima_reforma ?? null,
    url: urlArticulo(minimo.documento, a.clave),
    version: ultimo?.sha ?? null,
    permanente: ultimo ? `${urlArticulo(minimo.documento, a.clave)}@${corto(ultimo.sha)}` : null,
    historia: `${urlArticulo(minimo.documento, a.clave)}/historia`,
    fuente: minimo.fuente ?? null,
    texto: a.texto,
  };
}

export function mdArticulo(minimo, a) {
  const d = datosArticulo(minimo, a);
  return `${yaml({
    documento: d.documento,
    nombre: d.nombre,
    articulo: d.clave,
    etiqueta: d.etiqueta,
    ubicacion: d.ubicacion,
    derogado: d.derogado || null,
    ultima_reforma: d.ultima_reforma,
    url: d.url,
    version: d.version,
    permanente: d.permanente,
    historia: d.historia,
    fuente: d.fuente,
    nota: NOTA,
  })}\n${d.texto}\n`;
}

export function datosHistoria(minimo, a) {
  return {
    documento: minimo.documento,
    clave: a.clave,
    etiqueta: a.etiqueta,
    url: urlArticulo(minimo.documento, a.clave),
    ultima_reforma: a.ultima_reforma ?? null,
    reformas_segun_notas: a.reformas_segun_notas ?? null,
    cambios: a.cambios.map((i) => {
      const c = minimo.cambios[i];
      return { ...c, texto_en_esa_version: `${urlArticulo(minimo.documento, a.clave)}@${corto(c.sha)}` };
    }),
  };
}

const NOMBRE_CLASE = {
  reforma: "Reforma",
  correccion: "Corrección de extracción",
  alta: "Alta",
  retiro: "Retiro",
  metadatos: "Metadatos",
  ajuste: "Ajuste inicial",
};

export function lineaCambio(c, extra = "") {
  const pub = c.publicacion?.length ? ` (${c.medio ?? "publicación"} ${c.publicacion.join(", ")})` : "";
  return `- ${c.dia} · ${NOMBRE_CLASE[c.clase] ?? c.tipo}${pub} · [bitácora](${c.bitacora})${extra}`;
}

export function mdHistoria(minimo, a) {
  const h = datosHistoria(minimo, a);
  return `${yaml({ documento: h.documento, articulo: h.clave, etiqueta: h.etiqueta, url: h.url, ultima_reforma: h.ultima_reforma })}
# ${sinPunto(a.etiqueta)}: historia en OpenCodice

${h.cambios.map((c) => lineaCambio(c, ` · [texto en esa versión](${c.texto_en_esa_version})`)).join("\n") || "Sin cambios registrados."}

La historia de cada documento en OpenCodice empieza en su alta. Las reformas anteriores no están como commits; sus fechas están en las notas del texto (por ejemplo _Párrafo reformado DOF 07-10-2026_)${h.ultima_reforma ? ` y la más reciente según esas notas es del ${h.ultima_reforma}` : ""}.${h.reformas_segun_notas?.length ? ` Las notas de su texto vigente anotan ${h.reformas_segun_notas.length === 1 ? "una fecha" : `${h.reformas_segun_notas.length} fechas`} de reforma: ${h.reformas_segun_notas.join(", ")}. Una nota que la reforma siguiente sustituyó ya no está en el texto, así que pueden faltar fechas.` : ""} Lo que cambió en cada reforma, con la diferencia de su texto y su proceso legislativo, está en su página de la bitácora (detalle_cambio en el MCP).
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
    const n = a.reformas_segun_notas?.length;
    lineas.push(`- [${a.etiqueta}](${a.url})${a.derogado ? " (derogado)" : ""}${n ? ` · ${n === 1 ? "1 reforma" : `${n} reformas`} según sus notas, la última ${a.reformas_segun_notas.at(-1)}` : ""}`);
  }
  const conNotas = indice.articulos.filter((a) => a.reformas_segun_notas?.length).sort((x, y) => y.reformas_segun_notas.length - x.reformas_segun_notas.length);
  const masReformados = conNotas.length
    ? `\n## Artículos con más reformas según las notas de su texto\n\n${conNotas.slice(0, 15).map((a) => `${sinPunto(a.etiqueta)} (${a.reformas_segun_notas.length})`).join(", ")}. Cuenta las fechas de reforma que anota el texto vigente de cada artículo, desde su publicación; una nota que una reforma posterior sustituyó ya no se cuenta. Las fechas de cada uno, en el JSON (\`reformas_segun_notas\`) y en historia_articulo.\n`
    : "";
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

${indice.articulos.length} artículos. Cada uno en \`${SITIO}/ley/${indice.documento}/{artículo}\`; el texto completo en ${SITIO}/ley/${indice.documento}.md.

## Últimos cambios

${ultimos.map((c) => lineaCambio(c)).join("\n") || "Ninguno."}
${masReformados}
## Artículos
${lineas.join("\n")}
`;
}

// ------------------------------------------------------------------ rutas /ley

const ENCABEZADOS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
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

export const respuestaJson = (datos, status = 200, extra = {}) =>
  new Response(JSON.stringify(datos, null, 1), { status, headers: { ...ENCABEZADOS, "Content-Type": "application/json; charset=utf-8", ...extra } });

// Un artículo se sirve con la forma en que se pida («4o», «LFT»), sin
// redirigir: hay clientes que no siguen redirecciones. La URL única va aquí y
// en el frontmatter.
const canonica = (url) => ({ Link: `<${url}>; rel="canonical"` });

const noEncontrado = (request, que, ayuda) =>
  respuestaMd(request, `# No encontrado\n\n${que}\n\n${ayuda ?? `El catálogo está en ${SITIO}/ley y la guía en ${SITIO}/llms.txt.`}\n`, 404);

// Lo que llega aquí no es un archivo: `/ley/{Documento}.md` y `.json` se
// sirven directo y solo pasan por el Worker si el documento se pidió por su
// sigla o con mayúsculas.
export async function rutaLey(request, env) {
  const url = new URL(request.url);
  let ruta = decodeURIComponent(url.pathname).replace(/^\/ley\/?/, "").replace(/\/+$/, "");
  const cat = await catalogo(env);
  if (!cat) return respuestaMd(request, "El catálogo no está disponible en este despliegue.\n", 503);
  if (ruta === "" || ruta === "index.md") return respuestaMd(request, mdCatalogo(cat));
  if (ruta === "buscar") {
    // La búsqueda se mudó a la API; esta ruta era de la primera versión.
    return Response.redirect(`${SITIO}/api/buscar${url.search.replace(/([?&])q=/, "$1texto=")}`, 301);
  }

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

  if (!resto.length) {
    if (formato !== "md") return Response.redirect(`${SITIO}/ley/${doc.documento}.${formato === "json" ? "json" : "md"}`, 301);
    const indice = await indiceDe(env, doc.documento);
    if (!indice) return noEncontrado(request, `No se encontró el índice de \`${doc.documento}\`.`);
    return respuestaMd(request, mdIndice(indice), 200, canonica(`${SITIO}/ley/${doc.documento}`));
  }

  let [pedido, sub] = resto;
  if (resto.length > 2 || (sub && sub !== "historia")) {
    return noEncontrado(request, `Ruta desconocida: \`${url.pathname}\`.`, `Un artículo es \`/ley/${doc.documento}/{artículo}\` y su historia, \`/ley/${doc.documento}/{artículo}/historia\`.`);
  }
  let version = null;
  const arroba = pedido.indexOf("@");
  if (arroba >= 0) {
    version = pedido.slice(arroba + 1).toLowerCase();
    pedido = pedido.slice(0, arroba);
  }
  const { minimo, articulo: a } = await leerArticulo(env, doc.documento, pedido);
  if (!a) {
    return noEncontrado(request, `${doc.nombre} no tiene un artículo \`${pedido}\`.`, `Su índice, con la URL de cada artículo, está en ${SITIO}/ley/${doc.documento}.`);
  }

  if (version) {
    // Una versión anterior: el archivo en ese commit, en GitHub. Solo los
    // commits del documento, para no prometer una versión que no existe.
    const c = /^[0-9a-f]{7,40}$/.test(version) ? minimo.cambios.find((x) => x.sha.startsWith(version)) : null;
    if (!c) return noEncontrado(request, `\`${version}\` no es un commit de ${doc.nombre}.`, `Las versiones de este artículo están en ${urlArticulo(doc.documento, a.clave)}/historia.`);
    return Response.redirect(`https://raw.githubusercontent.com/OpenCodice/${minimo.repo}/${c.sha}/${minimo.carpeta}${a.clave}.md`, 302);
  }
  if (sub === "historia") {
    const u = `${urlArticulo(doc.documento, a.clave)}/historia`;
    return formato === "json" ? respuestaJson(datosHistoria(minimo, a), 200, canonica(u)) : respuestaMd(request, mdHistoria(minimo, a), 200, canonica(u));
  }
  const u = urlArticulo(doc.documento, a.clave);
  return formato === "json" ? respuestaJson(datosArticulo(minimo, a), 200, canonica(u)) : respuestaMd(request, mdArticulo(minimo, a), 200, canonica(u));
}
