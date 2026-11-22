// Las herramientas de OpenCodice, definidas una vez: el MCP (`mcp.js`) las
// expone como tools, la API (`api.js`) como GET/POST /api/{nombre} y
// `openapi.json` sale de sus esquemas. Cada una devuelve `datos` (JSON) y `md`
// (lo mismo en Markdown, para un modelo). Todas son de solo lectura y
// deterministas: leen los archivos del despliegue y nada más.

import { SITIO, ErrorDatos, catalogo, json, texto as leerTexto, indiceDe, minimoDe } from "./datos.js";
import {
  AMBITOS,
  buscarDocumentos,
  datosArticulo,
  datosHistoria,
  documentoOError,
  leerArticulo,
  lineaDocumento,
  mdArticulo,
  mdHistoria,
  mdIndice,
} from "./ley.js";
import { buscar, mdBusqueda, TIPOS_BUSQUEDA } from "./busqueda.js";
import { votaciones, mdVotaciones, legisladores, mdLegisladores } from "./congreso.js";

const documento = {
  type: "string",
  description: "Clave del documento: «cpeum» (la Constitución), «lft», «lgs», «cff», «jalisco/constitucion», «cdmx/codigo-penal». También acepta la sigla. buscar_documentos la da.",
};
const limite = (max, def) => ({ type: "integer", minimum: 1, maximum: max, description: `Cuántos resultados (${def} si se omite, a lo más ${max}).` });

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export const HERRAMIENTAS = [
  {
    name: "buscar",
    title: "Buscar en las leyes y el Congreso",
    description:
      "Búsqueda literal en todo lo publicado: los artículos de todas las leyes (Constitución, leyes federales, fiscales y estatales) y los asuntos del Congreso (iniciativas, proposiciones, dictámenes, decretos del DOF y votaciones). Devuelve las unidades con todas las palabras (sin distinguir acentos ni mayúsculas), agrupadas por ley y por tipo, con un fragmento. No es semántica: para un tema, busca varias veces con las palabras que usaría la ley o una iniciativa (p. ej. para matrimonio entre personas del mismo sexo: «matrimonio igualitario», «matrimonio mismo sexo», «matrimonio dos personas»).",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Palabras a buscar, todas deben aparecer: «aguinaldo», «salario mínimo», «matrimonio igualitario»." },
        tipos: { type: "array", items: { type: "string", enum: TIPOS_BUSQUEDA }, description: "Solo estos tipos (todos si se omite): ley, iniciativa, proposicion, dictamen, decreto, votacion." },
        documento: { ...documento, description: "Solo en este documento (con más artículos de ejemplo)." },
        ambito: { type: "string", enum: Object.keys(AMBITOS), description: "Solo leyes de este ámbito." },
        limite: limite(50, 10),
      },
      required: ["texto"],
    },
    async run(env, args) {
      let doc = null;
      if (args.documento) doc = (await documentoOError(env, args.documento)).documento;
      const tipos = typeof args.tipos === "string" ? args.tipos.split(",") : args.tipos;
      const r = await buscar(env, { ...args, tipos: doc && !tipos ? ["ley"] : tipos, documento: doc });
      return { datos: r, md: mdBusqueda(r) };
    },
  },
  {
    name: "buscar_documentos",
    title: "Buscar leyes por nombre",
    description:
      "Los documentos publicados (constituciones, leyes, códigos, reglamentos, disposiciones fiscales) cuyo nombre, sigla o clave contiene todas las palabras de la consulta. Sin consulta, todos los del ámbito o el estado. Da la clave que piden las demás herramientas.",
    inputSchema: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Palabras del nombre: «trabajo», «salud», «penal», «LISR»." },
        ambito: { type: "string", enum: Object.keys(AMBITOS), description: "Filtra por ámbito." },
        entidad: { type: "string", description: "Estado, para las leyes estatales: «Jalisco», «Ciudad de México»." },
      },
    },
    async run(env, args) {
      const cat = await catalogo(env);
      const xs = buscarDocumentos(cat, args);
      const max = 150;
      const md = xs.length
        ? `${plural(xs.length, "documento", "documentos")}.\n\n${xs.slice(0, max).map(lineaDocumento).join("\n")}${xs.length > max ? `\n\n(y ${xs.length - max} más: afina la consulta)` : ""}\n`
        : `Ningún documento coincide. Hay ${cat.documentos.length} en total; prueba con menos palabras o sin filtros.\n`;
      return { datos: { total: xs.length, documentos: xs }, md };
    },
  },
  {
    name: "indice_documento",
    title: "Índice de una ley",
    description: "Los artículos de un documento en orden, agrupados por título y capítulo, con la URL de cada uno, su fuente oficial y sus últimos cambios.",
    inputSchema: { type: "object", properties: { documento }, required: ["documento"] },
    async run(env, { documento: k }) {
      const d = await documentoOError(env, k);
      const indice = await indiceDe(env, d.documento);
      return { datos: indice, md: mdIndice(indice) };
    },
  },
  {
    name: "leer_articulo",
    title: "Leer artículos",
    description: "Texto vigente de uno o varios artículos, tal como se extrajo del PDF oficial (con sus notas de reforma), con su URL para citar, su versión (commit) y su fuente.",
    inputSchema: {
      type: "object",
      properties: {
        documento,
        articulos: { type: "array", items: { type: "string" }, maxItems: 20, description: "Artículos como se escriban: «1», «4o», «123», «77 Bis 35 A», «Regla 2.1.1». A lo más 20." },
      },
      required: ["documento", "articulos"],
    },
    async run(env, { documento: k, articulos, articulo }) {
      const pedidos = (typeof articulos === "string" ? articulos.split(",") : articulos) ?? (articulo ? [articulo] : []);
      if (!pedidos.length) throw new ErrorDatos("Falta `articulos`.");
      if (pedidos.length > 20) throw new ErrorDatos("A lo más 20 artículos por llamada.");
      const d = await documentoOError(env, k);
      const leidos = [];
      for (const p of pedidos) leidos.push({ p, ...(await leerArticulo(env, d.documento, p)) });
      return {
        datos: { documento: d.documento, articulos: leidos.map(({ p, minimo, articulo: a }) => (a ? datosArticulo(minimo, a) : { pedido: p, error: "no existe" })) },
        md: leidos.map(({ p, minimo, articulo: a }) => (a ? mdArticulo(minimo, a) : `${d.nombre} no tiene un artículo «${p}». Su índice: ${SITIO}/ley/${d.documento}\n`)).join("\n"),
      };
    },
  },
  {
    name: "historia_articulo",
    title: "Historia de un artículo",
    description: "Los cambios registrados de un artículo (reformas, correcciones de extracción, alta), con su fecha de publicación, su página en la bitácora y la URL del texto en cada versión.",
    inputSchema: { type: "object", properties: { documento, articulo: { type: "string" } }, required: ["documento", "articulo"] },
    async run(env, { documento: k, articulo }) {
      const d = await documentoOError(env, k);
      const { minimo, articulo: a } = await leerArticulo(env, d.documento, articulo);
      if (!a) throw new ErrorDatos(`${d.nombre} no tiene un artículo «${articulo}». Su índice: ${SITIO}/ley/${d.documento}`);
      return { datos: datosHistoria(minimo, a), md: mdHistoria(minimo, a) };
    },
  },
  {
    name: "detalle_cambio",
    title: "Qué cambió en una reforma",
    description:
      "Un cambio registrado de un documento con todo su detalle: la diferencia del texto de cada artículo (diff por párrafos), su publicación, su fuente y, en las reformas, su proceso legislativo (decreto del DOF, votación de cada cámara, iniciativas y autores). Por omisión, la última reforma del documento.",
    inputSchema: {
      type: "object",
      properties: {
        documento,
        cambio: { type: "string", description: "«ultima_reforma» (por omisión), «ultimo» (cualquier tipo) o el sha del commit (al menos 7 caracteres, de historia_articulo o cambios_recientes)." },
      },
      required: ["documento"],
    },
    async run(env, { documento: k, cambio = "ultima_reforma" }) {
      const d = await documentoOError(env, k);
      const minimo = await minimoDe(env, d.documento);
      const cs = minimo.cambios;
      const c =
        cambio === "ultima_reforma"
          ? cs.find((x) => x.tipo === "reforma")
          : cambio === "ultimo"
            ? cs.find((x) => x.clase !== "metadatos" && x.clase !== "ajuste")
            : /^[0-9a-f]{7,40}$/i.test(cambio)
              ? cs.find((x) => x.sha.startsWith(cambio.toLowerCase()))
              : null;
      if (!c) {
        const lista = cs.map((x) => `- ${x.sha.slice(0, 12)} · ${x.dia} · ${x.clase}`).join("\n");
        throw new ErrorDatos(
          cambio === "ultima_reforma"
            ? `${d.nombre} no tiene reformas registradas desde su alta en OpenCodice. Sus cambios:\n${lista}`
            : `«${cambio}» no es un cambio de ${d.nombre}. Sus cambios:\n${lista}`,
        );
      }
      const md = await leerTexto(env, `bitacora/${d.documento}/${c.sha.slice(0, 12)}.md`);
      if (!md) throw new ErrorDatos(`No se encontró la página de ese cambio: ${c.bitacora}`);
      return { datos: { documento: d.documento, nombre: d.nombre, ...c, markdown: md }, md };
    },
  },
  {
    name: "cambios_recientes",
    title: "Cambios recientes",
    description: "Las reformas (o altas, correcciones y retiros) registradas, de la publicación más reciente a la más antigua, con los artículos que tocaron. Filtra por documento, tipo y fecha.",
    inputSchema: {
      type: "object",
      properties: {
        documento: { ...documento, description: "Solo los de este documento." },
        tipo: { type: "string", enum: ["reforma", "correccion", "alta", "retiro"], description: "Solo de este tipo (reforma si se omite)." },
        desde: { type: "string", description: "Registrados desde esta fecha (AAAA-MM-DD)." },
        limite: limite(100, 20),
      },
    },
    async run(env, { documento: k, tipo = "reforma", desde, limite: lim = 20 } = {}) {
      const r = await json(env, "bitacora/cambios.json");
      if (!r) throw new ErrorDatos("La bitácora no está disponible en este despliegue.");
      const doc = k ? (await documentoOError(env, k)).documento : null;
      const n = Math.min(Math.max(1, Number(lim) || 20), 100);
      const xs = r.cambios
        .filter((c) => !c.menor && !c.ajuste_inicial && c.tipo === tipo && (!doc || c.documento === doc) && (!desde || c.fecha.slice(0, 10) >= desde))
        .sort((a, b) => (b.publicacion.at(-1) ?? b.fecha).localeCompare(a.publicacion.at(-1) ?? a.fecha));
      const md = xs.length
        ? xs
            .slice(0, n)
            .map((c) => {
              const arts = [
                ["adiciona", c.articulos_adicionados],
                ["modifica", c.articulos_modificados],
                ["deroga", c.articulos_derogados],
                ["corrige", c.articulos_corregidos],
              ]
                .filter(([, l]) => l.length)
                .map(([v, l]) => `${v} ${l.length > 30 ? `${l.length} artículos` : l.join(", ")}`)
                .join("; ");
              const pub = c.publicacion.length ? `${c.medio ?? ""} ${c.publicacion.join(", ")}`.trim() : `registrado ${c.fecha.slice(0, 10)}`;
              return `- ${c.nombre} (\`${c.documento}\`) · ${c.tipo} · ${pub}${arts ? ` · ${arts}` : ""} · sha ${c.sha.slice(0, 12)} · ${c.pagina}`;
            })
            .join("\n") + "\n"
        : "Ningún cambio coincide.\n";
      return { datos: { total: xs.length, cambios: xs.slice(0, n) }, md };
    },
  },
  {
    name: "votaciones",
    title: "Votaciones del Congreso",
    description:
      "Las votaciones nominales del Congreso de la Unión (Diputados, Senado, Comisión Permanente) con sus cuentas totales y por grupo parlamentario, el asunto, las leyes que reformó su decreto y qué tan dividida fue (`division`: la parte de los votos emitidos que tuvo el lado perdedor; 0 unanimidad, 0.5 empate). Para las más controvertidas: orden «division». Filtra por cámara, ley, palabras del asunto, fechas y grupo que votó mayoritariamente en contra.",
    inputSchema: {
      type: "object",
      properties: {
        orden: { type: "string", enum: ["fecha", "division", "en_contra", "ausentes"], description: "fecha (por omisión, la más reciente primero), division (las más divididas), en_contra, ausentes." },
        camara: { type: "string", enum: ["diputados", "senado", "permanente"] },
        documento: { ...documento, description: "Solo las de esta ley (por su decreto o por su nombre en el asunto)." },
        texto: { type: "string", description: "Palabras del asunto: «reforma judicial», «guardia nacional»." },
        grupo_en_contra: { type: "string", description: "Solo donde este grupo votó mayoritariamente en contra: «PAN», «Morena», «MC»." },
        en_lo_general: { type: "boolean", description: "true: solo votaciones en lo general (no las de artículos reservados)." },
        agrupar: { type: "boolean", description: "Una votación por asunto y cámara, la primera en el orden pedido (true por omisión)." },
        desde: { type: "string", description: "AAAA-MM-DD." },
        hasta: { type: "string", description: "AAAA-MM-DD." },
        limite: limite(100, 20),
      },
    },
    async run(env, args) {
      const r = await votaciones(env, args);
      return { datos: r, md: mdVotaciones(r) };
    },
  },
  {
    name: "legisladores",
    title: "Legisladores",
    description:
      "Diputados y senadores con su grupo, entidad y estatus, y sus cuentas: votaciones nominales con su nombre, a favor, en contra, abstenciones, ausencias (y su tasa), iniciativas presentadas y aprobadas. Ordena por ausencia (los más ausentes), asistencia, iniciativas o nombre. Por omisión solo los que están en funciones.",
    inputSchema: {
      type: "object",
      properties: {
        camara: { type: "string", enum: ["diputados", "senado"] },
        grupo: { type: "string", description: "Grupo parlamentario: «Morena», «PAN», «PRI», «PVEM», «PT», «MC»." },
        entidad: { type: "string", description: "Estado que representa." },
        nombre: { type: "string", description: "Palabras del nombre." },
        en_funciones: { type: "boolean", description: "false para incluir a quienes dejaron el cargo (true por omisión)." },
        orden: { type: "string", enum: ["nombre", "ausencia", "asistencia", "ausencias", "iniciativas", "en_contra"], description: "ausencia: la tasa más alta primero; ausencias: el número." },
        minimo_votaciones: { type: "integer", minimum: 0, description: "Para ordenar por tasa, solo quienes tienen al menos estas votaciones (20 por omisión)." },
        limite: limite(200, 25),
      },
    },
    async run(env, args) {
      const r = await legisladores(env, args);
      return { datos: r, md: mdLegisladores(r) };
    },
  },
];

export const herramienta = (nombre) => HERRAMIENTAS.find((h) => h.name === nombre) ?? null;

// Convierte los parámetros de una URL a los tipos del esquema: enteros,
// booleanos y listas separadas por coma.
export function argumentosDeUrl(h, params) {
  const args = {};
  for (const [k, v] of params) {
    const tipo = h.inputSchema.properties[k]?.type;
    if (!tipo) continue;
    args[k] = tipo === "integer" ? Number(v) : tipo === "boolean" ? v === "true" || v === "1" : tipo === "array" ? v.split(",").map((x) => x.trim()).filter(Boolean) : v;
  }
  return args;
}

export function faltantes(h, args) {
  return (h.inputSchema.required ?? []).filter((k) => args[k] == null || args[k] === "" || (Array.isArray(args[k]) && !args[k].length));
}
