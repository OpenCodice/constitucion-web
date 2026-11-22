// El texto vigente de cada documento, servido desde constitucion.app para que
// un agente lo lea con una URL, sin clonar nada (ver /ley en worker/index.js).
//
// Por documento se escriben dos archivos en public/ley/_/: el texto completo
// (los artículos de main tal cual, en el orden de su índice, separados por una
// línea en blanco) y un índice JSON con, por artículo, dónde empieza y acaba
// en ese texto y qué commits lo tocaron. El Worker corta un artículo de ahí:
// el sitio sigue sin depender de nada en tiempo de lectura, y no hacen falta
// 64 mil archivos sueltos.
//
// La misma ley está en leyes-federales y fiscal-mexicano con el mismo texto;
// se sirve la de leyes-federales y la otra queda en `tambien_en`.

import { REPOS, ORG } from "./comun.mjs";
import { arbol, clon, dirArticulos, dirMetadata, esArticulo, leerBlobs, articulosDe } from "./historial.mjs";
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

export const rutaTexto = (doc) => `ley/_/${doc}.md`;
export const rutaIndice = (doc) => `ley/_/${doc}.json`;

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

  let texto = "";
  const articulos = [];
  for (const k of claves) {
    const t = (blobs.get(`${a.rev}:${presentes.get(k)}`) ?? "").replace(/\s+$/, "");
    if (texto) texto += "\n\n";
    const ini = texto.length;
    texto += t;
    const e = entradas.get(k) ?? {};
    articulos.push({
      clave: k,
      etiqueta: e.etiqueta ?? encabezado(t) ?? k,
      ubicacion: ubicacion(e),
      derogado: e.derogado === true || undefined,
      ultima_reforma: e.ultima_reforma ?? undefined,
      ini,
      fin: texto.length,
      cambios: tocan.get(k) ?? [],
    });
  }
  texto += "\n";

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
  };
  return { clave: d.clave, texto, indice };
}

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

Para leer un artículo: \`https://constitucion.app/ley/{documento}/{artículo}\` (por ejemplo \`/ley/cpeum/123\`, \`/ley/lft/132\`, \`/ley/jalisco/constitucion/4\`). El artículo se escribe como sea: \`4\`, \`4o\`, \`004\`, \`77-bis-35-a\`, \`Regla 2.1.1\`. El servidor MCP está en \`https://constitucion.app/mcp\`.`,
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
