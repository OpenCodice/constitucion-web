// El texto vigente de cada documento, servido desde constitucion.app para que
// un agente lo lea con una URL, sin clonar nada (ver `archivosDocumento` y
// worker/ley.js). Los artículos de main tal cual, en el orden de su índice,
// con qué commits tocaron cada uno (de la bitácora).
//
// La misma ley está en leyes-federales y fiscal-mexicano con el mismo texto;
// se sirve la de leyes-federales y la otra queda en `tambien_en`.

import { REPOS, ORG } from "./comun.mjs";
import { arbol, clon, clonHistorico, dirArticulos, dirMetadata, esArticulo, leerBlobs, articulosDe } from "./historial.mjs";
import { encabezado } from "./diferencias.mjs";
import { SITIO } from "./tarjeta.mjs";

const PREFERENCIA = [REPOS.cpeum, REPOS.estatales, REPOS.federales, REPOS.fiscal];

const AMBITO = {
  cpeum: "constitucion",
  estatal: "constitucion-estatal",
  "estatal-ley": "estatal",
  [REPOS.federales]: "federal",
  [REPOS.fiscal]: "fiscal",
};


const leerJson = (texto) => {
  try {
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
};

// Las entradas del índice de un documento: `articulos`, `reglas`, `criterios`
// o `fichas`, según el corpus. Es la primera lista de objetos con clave.
function entradasIndice(indice) {
  if (!indice || typeof indice !== "object") return [];
  for (const v of Object.values(indice)) {
    if (Array.isArray(v) && v.length && typeof v[0]?.clave === "string") return v;
  }
  return [];
}

const ubicacion = (e) =>
  [e.titulo, e.capitulo, e.seccion]
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => x.trim())
    .join(" / ") || null;

const cambioCorto = (c) => ({
  sha: c.sha,
  tipo: c.tipo,
  clase: c.clase,
  dia: c.dia,
  publicacion: c.publicaciones,
  medio: c.medio,
  bitacora: `${SITIO}/bitacora/${c.documento}/${c.id}`,
});

// { documentos: [{ clave, texto, indice }], fallas } a partir del modelo de la
// bitácora (nombres, cambios y su clase) y de main de cada repo de datos.
export async function leerCorpus(historial, bitacora) {
  const arboles = new Map();
  const fallas = [];
  for (const repo of PREFERENCIA) {
    if (!historial[repo]?.ok) continue;
    try {
      const { dir, rev } = await clon(repo);
      arboles.set(repo, { dir, rev, rutas: await arbol(dir, rev), cabeza: historial[repo].datos.cabeza });
    } catch (e) {
      fallas.push({ repo, error: e.message });
    }
  }

  // Qué repo sirve cada documento y con qué archivos.
  const elegidos = new Map();
  for (const repo of PREFERENCIA) {
    const a = arboles.get(repo);
    if (!a) continue;
    const porDoc = new Map();
    for (const d of bitacora.documentos.values()) {
      if (d.retirado || !d.repos.has(repo) || elegidos.has(d.clave)) continue;
      porDoc.set(d.clave, []);
    }
    for (const ruta of a.rutas) {
      // La carpeta del documento: `articulos/`, `{estado}/{ley}/articulos/` o `{doc}/`.
      const doc =
        repo === REPOS.cpeum ? "cpeum" : repo === REPOS.estatales ? ruta.split("/").slice(0, 2).join("/") : ruta.split("/")[0];
      const lista = porDoc.get(doc);
      if (lista && esArticulo(ruta, doc)) lista.push(ruta);
    }
    for (const [doc, rutas] of porDoc) if (rutas.length) elegidos.set(doc, { repo, rutas });
  }

  const documentos = [];
  for (const repo of PREFERENCIA) {
    const a = arboles.get(repo);
    if (!a) continue;
    const docs = [...elegidos].filter(([, e]) => e.repo === repo);
    if (!docs.length) continue;
    const pedidos = docs.flatMap(([doc, e]) => [`${a.rev}:${dirMetadata(doc)}articulos.json`, ...e.rutas.map((r) => `${a.rev}:${r}`)]);
    let blobs;
    try {
      blobs = await leerBlobs(a.dir, pedidos);
    } catch (e) {
      fallas.push({ repo, error: e.message });
      continue;
    }
    for (const [doc, e] of docs) {
      documentos.push(armar(bitacora.documentos.get(doc), repo, a, e.rutas, blobs));
    }
  }
  documentos.sort((x, y) => x.indice.documento.localeCompare(y.indice.documento));
  return { documentos, fallas };
}

function armar(d, repo, a, rutas, blobs) {
  const base = dirArticulos(d.clave);
  const idx = leerJson(blobs.get(`${a.rev}:${dirMetadata(d.clave)}articulos.json`));
  const entradas = new Map(entradasIndice(idx).map((e) => [e.clave, e]));
  const presentes = new Map(rutas.map((r) => [r.slice(base.length, -3), r]));
  // El orden del índice y, al final, lo que no esté en él.
  const claves = [
    ...[...entradas.keys()].filter((k) => presentes.has(k)),
    ...[...presentes.keys()].filter((k) => !entradas.has(k)).sort((x, y) => x.localeCompare(y, "es", { numeric: true })),
  ];

  const cambios = d.cambios.filter((c) => c.repo === repo);
  const posicion = new Map(cambios.map((c, i) => [c, i]));
  const tocan = new Map();
  for (const c of cambios) {
    const claves = new Set(articulosDe(c));
    if (c.tipo === "alta") for (const f of c.articulosArchivo) if (f.estado === "A") claves.add(f.ruta.slice(base.length, -3));
    for (const k of claves) {
      if (!tocan.has(k)) tocan.set(k, []);
      tocan.get(k).push(posicion.get(c));
    }
  }

  // Las fechas de reforma que anotan las notas del texto vigente de cada
  // artículo (metadata/reformas.json): su historia anterior al alta, que no
  // está como commits. Las de 1917 de la Constitución son su publicación.
  const fechas = new Map();
  for (const r of d.reformasAnteriores ?? []) {
    if (r.fecha < "1918-01-01") continue;
    for (const k of r.claves) {
      if (!fechas.has(k)) fechas.set(k, []);
      fechas.get(k).push(r.fecha);
    }
  }

  const articulos = claves.map((k) => {
    const t = (blobs.get(`${a.rev}:${presentes.get(k)}`) ?? "").replace(/\s+$/, "");
    const e = entradas.get(k) ?? {};
    return {
      clave: k,
      etiqueta: e.etiqueta ?? encabezado(t) ?? k,
      ubicacion: ubicacion(e),
      derogado: e.derogado === true || undefined,
      ultima_reforma: e.ultima_reforma ?? undefined,
      reformas_segun_notas: fechas.get(k)?.sort() ?? (d.reformasAnteriores ? [] : undefined),
      url: `${SITIO}/ley/${d.clave}/${k}`,
      cambios: tocan.get(k) ?? [],
      texto: t,
    };
  });

  const vigente = cambios.find((c) => c.fuente) ?? cambios[0];
  const otros = [...d.repos].filter((r) => r !== repo);
  const indice = {
    documento: d.clave,
    nombre: d.nombre,
    sigla: d.sigla,
    ambito: AMBITO[d.corpus] ?? "federal",
    entidad: d.entidad ?? null,
    medio: vigente?.medio ?? null,
    repo,
    carpeta: base,
    cabeza: a.cabeza,
    fuente: vigente?.fuente ?? idx?.fuente ?? null,
    fuente_sha256: vigente?.sha256 ?? null,
    version_pdf: idx?.version ?? null,
    vigencia: idx?.vigente_desde ? { desde: idx.vigente_desde, hasta: idx.vigente_hasta ?? null } : null,
    tambien_en: otros.length ? otros : undefined,
    github: `https://github.com/${ORG}/${repo}/tree/main/${base}`,
    articulos,
    cambios: cambios.map(cambioCorto),
    // Las versiones anteriores a su alta que se conservan (ver `leerAnteriores`).
    anteriores: d.versiones?.length ? { versiones: d.versiones.length, desde: d.versiones.at(-1).dia, hasta: d.versiones[0].dia } : undefined,
  };
  return { clave: d.clave, indice };
}

// Lo que se escribe de un documento, ruta → contenido:
//
// - `ley/{Documento}.md`: el texto completo, con su ficha en frontmatter, y
//   `ley/{Documento}.json`: su índice (cada artículo sin su texto). Se sirven
//   tal cual, sin pasar por el Worker.
// - `ley/_/{Documento}/i.json` y `ley/_/{Documento}/{n}.json`: para que el
//   Worker sirva un artículo sin leer la ley entera (los assets no aceptan
//   `Range`): un índice mínimo (claves y en qué trozo está cada una) y los
//   artículos en trozos de unos TROZO bytes.
const TROZO = 96 * 1024;

export function archivosDocumento({ clave, indice: i }) {
  const { articulos, ...ficha } = i;
  const archivos = new Map();
  const frente = [
    `documento: ${JSON.stringify(i.documento)}`,
    `nombre: ${JSON.stringify(i.nombre)}`,
    i.sigla ? `sigla: ${JSON.stringify(i.sigla)}` : null,
    `articulos: ${articulos.length}`,
    `url: ${JSON.stringify(`${SITIO}/ley/${i.documento}.md`)}`,
    `indice: ${JSON.stringify(`${SITIO}/ley/${i.documento}`)}`,
    i.cambios[0] ? `version: ${JSON.stringify(i.cambios[0].sha)}` : null,
    i.fuente ? `fuente: ${JSON.stringify(i.fuente)}` : null,
    `nota: ${JSON.stringify(NOTA)}`,
  ].filter(Boolean);
  archivos.set(`ley/${clave}.md`, `---\n${frente.join("\n")}\n---\n\n${articulos.map((a) => a.texto).join("\n\n")}\n`);
  archivos.set(`ley/${clave}.json`, JSON.stringify({ ...ficha, articulos: articulos.map(({ texto, ...a }) => a) }));

  const trozos = [[]];
  let tam = 0;
  const trozo = [];
  for (const a of articulos) {
    if (tam > TROZO) {
      trozos.push([]);
      tam = 0;
    }
    trozos.at(-1).push(a);
    trozo.push(trozos.length - 1);
    tam += Buffer.byteLength(a.texto) + 200;
  }
  trozos.forEach((xs, n) => archivos.set(`ley/_/${clave}/${n}.json`, JSON.stringify(xs.map(({ url, ...a }) => a))));
  archivos.set(`ley/_/${clave}/i.json`, JSON.stringify({ ...ficha, claves: articulos.map((a) => a.clave), trozo }));
  return archivos;
}

// ------------------------------------------------------------------ versiones anteriores
// El texto de cada artículo en las versiones anteriores al alta del
// documento (`d.versiones` de la bitácora, del repositorio historico), para
// que el Worker responda «el artículo a tal fecha» sin salir del despliegue.
//
// Por artículo, una línea de tiempo: [posición de la versión, texto] cada vez
// que su archivo cambió; `null` si esa versión lo retiró y `true` si desde
// ahí su texto ya es el vigente, que no se repite (es el caso de casi todos
// los artículos de la primera versión).

// { versiones, lineas } de un documento, o null si no tiene versiones
// anteriores. `vigentes`: clave → texto vigente.
export async function leerAnteriores(d, vigentes) {
  if (!d.versiones?.length) return null;
  const { dir } = await clonHistorico();
  const versiones = [...d.versiones].reverse();
  const base = `${d.clave}/`;
  const pedidos = [];
  for (const v of versiones) for (const f of v.articulosArchivo) if (f.estado !== "D") pedidos.push(`${v.sha}:${f.ruta}`);
  const blobs = await leerBlobs(dir, pedidos);
  const lineas = new Map();
  versiones.forEach((v, i) => {
    for (const f of v.articulosArchivo) {
      const clave = f.ruta.slice(base.length, -3);
      if (!lineas.has(clave)) lineas.set(clave, []);
      lineas.get(clave).push([i, f.estado === "D" ? null : (blobs.get(`${v.sha}:${f.ruta}`) ?? "").replace(/\s+$/, "")]);
    }
  });
  for (const [clave, linea] of lineas) {
    const ultimo = linea.at(-1);
    if (ultimo[1] != null && ultimo[1] === vigentes.get(clave)) ultimo[1] = true;
  }
  return {
    versiones: versiones.map((v) => ({
      publicacion: v.dia,
      origen: v.origen,
      medio: v.medio,
      fuente: v.fuente,
      fuente_sha256: v.sha256,
      bitacora: `${SITIO}/bitacora/${v.documento}/${v.id}`,
    })),
    lineas,
  };
}

// `ley/_/{Documento}/h.json` (las versiones y en qué trozo está la línea de
// cada artículo) y `ley/_/{Documento}/h{n}.json` (las líneas, por trozos).
export function archivosAnteriores(clave, { versiones, lineas }) {
  const archivos = new Map();
  const trozos = [{}];
  const trozo = {};
  let tam = 0;
  for (const [k, linea] of [...lineas].sort(([x], [y]) => x.localeCompare(y, "es", { numeric: true }))) {
    if (tam > TROZO) {
      trozos.push({});
      tam = 0;
    }
    trozos.at(-1)[k] = linea;
    trozo[k] = trozos.length - 1;
    tam += linea.reduce((n, [, t]) => n + (typeof t === "string" ? Buffer.byteLength(t) : 0) + 16, 0);
  }
  trozos.forEach((x, n) => archivos.set(`ley/_/${clave}/h${n}.json`, JSON.stringify(x)));
  archivos.set(`ley/_/${clave}/h.json`, JSON.stringify({ documento: clave, versiones, trozo }));
  return archivos;
}

export const NOTA = "Texto extraído del PDF oficial por OpenCodice. No es la publicación oficial ni asesoría legal.";

// La ficha de cada documento en el catálogo (/ley/catalogo.json): sin
// artículos, para que un agente elija qué pedir.
export function fichaCatalogo({ indice: i }) {
  const ultimo = i.cambios.find((c) => c.clase !== "metadatos" && c.clase !== "ajuste") ?? i.cambios[0];
  return {
    documento: i.documento,
    nombre: i.nombre,
    sigla: i.sigla,
    ambito: i.ambito,
    entidad: i.entidad,
    articulos: i.articulos.length,
    ultimo_cambio: ultimo ? { tipo: ultimo.tipo, dia: ultimo.dia, publicacion: ultimo.publicacion } : null,
    url: `${SITIO}/ley/${i.documento}`,
    texto: `${SITIO}/ley/${i.documento}.md`,
    historia: `${SITIO}/bitacora/${i.documento}/`,
  };
}

const NOMBRE_AMBITO = {
  constitucion: "Constitución federal",
  federal: "Leyes federales",
  fiscal: "Legislación fiscal (solo lo que no está en leyes federales)",
  "constitucion-estatal": "Constituciones estatales",
  estatal: "Leyes de los estados",
};

// /llms-full.txt: el catálogo entero en texto, para un agente que solo puede
// leer una URL.
export function llmsCompleto(fichas, generada) {
  const partes = [
    `# OpenCodice: catálogo completo

> Cada documento publicado en OpenCodice con la URL de su índice (artículos, con su URL cada uno) y de su texto completo en Markdown. Guía corta: https://constitucion.app/llms.txt. Generado el ${generada.slice(0, 10)}.

Para leer un artículo: \`https://constitucion.app/ley/{documento}/{artículo}\` (por ejemplo \`/ley/cpeum/123\`, \`/ley/lft/132\`, \`/ley/jalisco/constitucion/4\`). El artículo se escribe como sea: \`4\`, \`4o\`, \`004\`, \`77-bis-35-a\`, \`Regla 2.1.1\`. La API está en \`https://constitucion.app/api\` y el servidor MCP en \`https://constitucion.app/mcp\`.`,
  ];
  for (const [ambito, titulo] of Object.entries(NOMBRE_AMBITO)) {
    const xs = fichas.filter((f) => f.ambito === ambito);
    if (!xs.length) continue;
    const lineas = xs.map(
      (f) =>
        `- [${f.nombre}](${f.url})${f.sigla && f.sigla !== f.nombre && f.sigla !== f.entidad ? ` (${f.sigla})` : ""}: \`${f.documento}\`, ${f.articulos} artículos${f.ultimo_cambio?.publicacion?.length ? `, versión del ${f.ultimo_cambio.publicacion.at(-1)}` : ""}. [Texto completo](${f.texto})`,
    );
    partes.push(`## ${titulo} (${xs.length})\n\n${lineas.join("\n")}`);
  }
  return `${partes.join("\n\n")}\n`;
}
