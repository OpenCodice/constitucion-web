// Las herramientas de OpenCodice, definidas una vez: el MCP (`mcp.js`) las
// expone como tools, la API (`api.js`) como GET/POST /api/{nombre} y
// `openapi.json` sale de sus esquemas. Cada una devuelve `datos` (JSON) y `md`
// (lo mismo en Markdown, para un modelo). Todas son de solo lectura y
// deterministas: leen los archivos del despliegue y nada más.

import { SITIO, ErrorDatos, catalogo, json, texto as leerTexto, indiceDe, minimoDe, paginar, pieDePagina } from "./datos.js";
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
import {
  votaciones,
  mdVotaciones,
  votacionesPorLey,
  mdVotacionesPorLey,
  votacion,
  mdVotacion,
  votosLegislador,
  mdVotosLegislador,
  legisladores,
  mdLegisladores,
  asuntos,
  mdAsuntos,
  TIPOS_ASUNTO,
} from "./congreso.js";

const documento = {
  type: "string",
  description: "Clave del documento: «cpeum» (la Constitución), «lft», «lgs», «cff», «jalisco/constitucion», «cdmx/codigo-penal». También acepta la sigla. buscar_documentos la da.",
};
const limite = (max, def) => ({ type: "integer", minimum: 1, maximum: max, description: `Cuántos resultados por página (${def} si se omite, a lo más ${max}).` });
const pagina = { type: "integer", minimum: 1, description: "Página de resultados (1 si se omite). La respuesta dice cuántas hay." };
const fecha = (que) => ({ type: "string", description: `${que} (AAAA-MM-DD).` });
const SENTIDO = { type: "string", enum: ["a_favor", "en_contra", "abstencion", "ausente", "sin_votar"] };
// Los filtros de votaciones, comunes a las herramientas que las recorren.
const filtrosVotaciones = {
  camara: { type: "string", enum: ["diputados", "senado", "permanente"] },
  documento: { ...documento, description: "Solo las de esta ley: la reformó el decreto de la votación, o su asunto la reforma o expide por su nombre." },
  texto: { type: "string", description: "Palabras del asunto: «reforma judicial», «guardia nacional»." },
  grupo_en_contra: { type: "string", description: "Solo donde este grupo votó mayoritariamente en contra: «PAN», «Morena», «MC»." },
  en_lo_general: { type: "boolean", description: "true: solo votaciones en lo general (no las de artículos reservados)." },
  desde: fecha("Votadas desde esta fecha"),
  hasta: fecha("Votadas hasta esta fecha, inclusive"),
};

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export const HERRAMIENTAS = [
  {
    name: "buscar",
    title: "Buscar en las leyes y el Congreso",
    description:
      "Búsqueda literal en todo lo publicado: los artículos de todas las leyes (Constitución, leyes federales, fiscales y estatales) y los asuntos del Congreso (iniciativas, proposiciones, dictámenes, decretos del DOF y votaciones, por su título). Devuelve las unidades con todas las palabras, en cualquier orden (sin distinguir acentos ni mayúsculas; no busca frases), agrupadas por ley y por tipo, con un fragmento. No es semántica: para un tema, busca varias veces con las palabras que usaría la ley o una iniciativa (p. ej. para matrimonio entre personas del mismo sexo: «matrimonio igualitario», «matrimonio mismo sexo», «matrimonio dos personas»). Para iniciativas por autor, ley, fecha o desenlace: asuntos.",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Palabras a buscar, todas deben aparecer: «aguinaldo», «salario mínimo», «matrimonio igualitario»." },
        tipos: { type: "array", items: { type: "string", enum: TIPOS_BUSQUEDA }, description: "Solo estos tipos (todos si se omite): ley, iniciativa, proposicion, dictamen, decreto, votacion." },
        documento: { ...documento, description: "Solo en este documento (con más artículos de ejemplo)." },
        ambito: { type: "string", enum: Object.keys(AMBITOS), description: "Solo leyes de este ámbito." },
        limite: limite(50, 10),
        pagina: { ...pagina, description: "Página de los artículos (con `documento`) o de los asuntos de cada tipo (1 si se omite)." },
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
        limite: limite(400, 150),
        pagina,
      },
    },
    async run(env, args) {
      const cat = await catalogo(env);
      const p = paginar(buscarDocumentos(cat, args), args, 150, 400);
      const md = p.total
        ? `${plural(p.total, "documento", "documentos")}${p.total > p.elementos.length ? `, se muestran ${p.elementos.length}` : ""}.\n\n${p.elementos.map(lineaDocumento).join("\n")}\n${pieDePagina(p)}`
        : `Ningún documento coincide. Hay ${cat.documentos.length} en total; prueba con menos palabras o sin filtros.\n`;
      return { datos: { total: p.total, pagina: p.pagina, paginas: p.paginas, documentos: p.elementos }, md };
    },
  },
  {
    name: "indice_documento",
    title: "Índice de una ley",
    description: "Los artículos de un documento en orden, agrupados por título y capítulo, con la URL de cada uno, su fuente oficial, sus últimos cambios y, de cada artículo, las fechas de reforma que anotan las notas de su texto (`reformas_segun_notas`): con ellas se ve qué artículos se han reformado más en toda su historia, no solo desde que OpenCodice los registra.",
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
    description: "Los cambios registrados de un artículo (reformas, correcciones de extracción, alta), con su fecha de publicación, su página en la bitácora y la URL del texto en cada versión, y las fechas de reforma anteriores al registro que anotan las notas de su texto.",
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
    title: "Cambios registrados",
    description:
      "Las reformas (o altas, correcciones y retiros) registradas, de la publicación más reciente a la más antigua, con los artículos que tocaron. Filtra por documento, tipo y fecha. Con `documento` dice además desde cuándo se registra (su alta: lo anterior solo está en las notas de reforma del texto) y qué artículos han cambiado más veces desde entonces.",
    inputSchema: {
      type: "object",
      properties: {
        documento: { ...documento, description: "Solo los de este documento." },
        tipo: { type: "string", enum: ["reforma", "correccion", "alta", "retiro", "todos"], description: "Solo de este tipo (reforma si se omite; «todos» para verlos juntos)." },
        desde: fecha("Registrados desde esta fecha"),
        limite: limite(100, 20),
        pagina,
      },
    },
    async run(env, { documento: k, tipo = "reforma", desde, limite: lim, pagina: pag } = {}) {
      const r = await json(env, "bitacora/cambios.json");
      if (!r) throw new ErrorDatos("La bitácora no está disponible en este despliegue.");
      const d = k ? await documentoOError(env, k) : null;
      const delDocumento = r.cambios.filter((c) => !c.menor && !c.ajuste_inicial && (!d || c.documento === d.documento));
      const xs = delDocumento
        .filter((c) => (tipo === "todos" || c.tipo === tipo) && (!desde || c.fecha.slice(0, 10) >= desde))
        .sort((a, b) => (b.publicacion.at(-1) ?? b.fecha).localeCompare(a.publicacion.at(-1) ?? a.fecha));
      const p = paginar(xs, { limite: lim, pagina: pag }, 20, 100);
      // Desde cuándo hay registro de un documento y qué artículos han cambiado
      // más: sin esto, «pocos cambios» se lee como «casi no se ha reformado».
      let registro = null;
      if (d) {
        const alta = delDocumento.filter((c) => c.tipo === "alta").sort((a, b) => a.fecha.localeCompare(b.fecha))[0] ?? null;
        const veces = new Map();
        const reformas = delDocumento.filter((c) => c.tipo === "reforma");
        for (const c of reformas) {
          for (const a of new Set([...c.articulos_adicionados, ...c.articulos_modificados, ...c.articulos_derogados])) veces.set(a, (veces.get(a) ?? 0) + 1);
        }
        registro = {
          desde: alta?.fecha.slice(0, 10) ?? null,
          version_del_alta: alta?.publicacion.at(-1) ?? null,
          reformas: reformas.length,
          articulos_con_mas_reformas: [...veces].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([articulo, n]) => ({ articulo, reformas: n })),
        };
      }
      const lineas = p.elementos.map((c) => {
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
      });
      const nota = registro
        ? `${d.nombre} se registra desde ${registro.desde ? `su alta, el ${registro.desde}${registro.version_del_alta ? ` (versión publicada el ${registro.version_del_alta})` : ""}` : "su alta"}; ${plural(registro.reformas, "reforma registrada", "reformas registradas")} desde entonces. Las anteriores no están en este registro: se leen en las notas de reforma de cada artículo.${registro.articulos_con_mas_reformas.length ? ` Artículos con más reformas registradas: ${registro.articulos_con_mas_reformas.map((x) => `${x.articulo} (${x.reformas})`).join(", ")}.` : ""}`
        : "El registro de cada documento empieza en su alta en OpenCodice; las reformas anteriores solo están en las notas de reforma del texto.";
      const md = `${nota}\n\n${lineas.length ? `${plural(p.total, "cambio", "cambios")}${tipo === "todos" ? "" : ` de tipo ${tipo}`}${p.total > lineas.length ? `, se muestran ${lineas.length}` : ""}.\n\n${lineas.join("\n")}\n${pieDePagina(p)}` : `Ningún cambio${tipo === "todos" ? "" : ` de tipo ${tipo}`} coincide.\n`}`;
      return { datos: { total: p.total, pagina: p.pagina, paginas: p.paginas, registro, cambios: p.elementos }, md };
    },
  },
  {
    name: "votaciones",
    title: "Votaciones del Congreso",
    description:
      "Las votaciones nominales del Congreso de la Unión (Diputados, Senado, Comisión Permanente) con su id, sus cuentas totales y por grupo parlamentario, el asunto, sus leyes (las que reformó su decreto o que su asunto reforma o expide por su nombre) y qué tan dividida fue (`division`: la parte de los votos emitidos que tuvo el lado perdedor; 0 unanimidad, 0.5 empate). Para las más controvertidas: orden «division». Filtra por cámara, ley, palabras del asunto, fechas y grupo que votó mayoritariamente en contra. El voto de cada legislador: votacion. El conteo por ley: votaciones_por_ley.",
    inputSchema: {
      type: "object",
      properties: {
        orden: { type: "string", enum: ["fecha", "division", "en_contra", "ausentes"], description: "fecha (por omisión, la más reciente primero), division (las más divididas), en_contra, ausentes." },
        ...filtrosVotaciones,
        agrupar: { type: "boolean", description: "Una votación por asunto y cámara, la primera en el orden pedido (true por omisión). false: todas, también las de artículos reservados." },
        limite: limite(100, 20),
        pagina,
      },
    },
    async run(env, args) {
      const r = await votaciones(env, args);
      return { datos: r, md: mdVotaciones(r) };
    },
  },
  {
    name: "votaciones_por_ley",
    title: "Leyes con más votaciones divididas",
    description:
      "Las leyes ordenadas por cuántas de sus votaciones nominales fueron divididas: de cada ley, sus votaciones, las divididas (con `division` de al menos `division_minima`), su proporción, la división media y la votación más dividida. Responde «qué leyes fueron las más controvertidas» sin bajar todas las votaciones; la respuesta dice el periodo que cubren los datos, cómo se cuenta y cuántas votaciones no se pueden atribuir a una ley publicada.",
    inputSchema: {
      type: "object",
      properties: {
        division_minima: { type: "number", minimum: 0, maximum: 0.5, description: "Desde qué `division` cuenta una votación como dividida (0.2 si se omite: el lado perdedor tuvo al menos 20 % de los votos emitidos)." },
        orden: { type: "string", enum: ["divididas", "votaciones", "proporcion", "division_maxima"], description: "divididas (por omisión, las que más tienen), votaciones, proporcion, division_maxima." },
        ...filtrosVotaciones,
        limite: limite(100, 20),
        pagina,
      },
    },
    async run(env, args) {
      const r = await votacionesPorLey(env, args);
      return { datos: r, md: mdVotacionesPorLey(r) };
    },
  },
  {
    name: "votacion",
    title: "Una votación, con el voto de cada legislador",
    description:
      "Una votación nominal por su id (el que da votaciones: «sil-5135887-1»): asunto, cuentas, leyes, decreto y el voto de cada legislador por sentido y grupo, tal como lo publica la fuente. Con `sentido` o `grupo`, solo esos votos (por ejemplo quiénes votaron en contra).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id de la votación, o su URL en /congreso/votaciones/." },
        sentido: { ...SENTIDO, description: "Solo los votos en este sentido." },
        grupo: { type: "string", description: "Solo los de este grupo parlamentario: «PAN», «Morena», «MC»." },
      },
      required: ["id"],
    },
    async run(env, args) {
      const r = await votacion(env, args);
      return { datos: r, md: mdVotacion(r) };
    },
  },
  {
    name: "votos_legislador",
    title: "Cómo votó un legislador",
    description:
      "Las votaciones nominales en que aparece un legislador, con su voto en cada una y sus cuentas por sentido. Filtra por sentido (por ejemplo, en qué votó en contra), ley, palabras del asunto, cámara y fechas.",
    inputSchema: {
      type: "object",
      properties: {
        legislador: { type: "string", description: "Su id (el de legisladores: «kenia-lopez-rabadan») o palabras de su nombre que den con una sola persona." },
        sentido: { ...SENTIDO, description: "Solo las votaciones en que votó así." },
        orden: { type: "string", enum: ["fecha", "division", "en_contra", "ausentes"], description: "fecha (por omisión) o division (las más divididas primero)." },
        ...filtrosVotaciones,
        limite: limite(100, 20),
        pagina,
      },
      required: ["legislador"],
    },
    async run(env, args) {
      const r = await votosLegislador(env, args);
      return { datos: r, md: mdVotosLegislador(r) };
    },
  },
  {
    name: "asuntos",
    title: "Iniciativas y proposiciones",
    description:
      "Las iniciativas (o proposiciones con punto de acuerdo, o dictámenes negativos) presentadas en el Congreso, de la más reciente a la más antigua, con su id, autores, estatus y enlace al SIL. Filtra por autor (un legislador), ley que reforma o expide por su nombre, palabras del título, partido, desenlace y fechas de presentación. La respuesta dice el periodo que cubren los datos.",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: Object.keys(TIPOS_ASUNTO), description: "iniciativa (por omisión), proposicion o dictamen." },
        autor: { type: "string", description: "Legislador que lo presentó: su id o palabras de su nombre que den con una sola persona." },
        documento: { ...documento, description: "Solo los que reforman o expiden esta ley por su nombre en el título." },
        texto: { type: "string", description: "Palabras del título, todas deben aparecer: «prisión preventiva», «guardia nacional»." },
        partido: { type: "string", description: "Partido que la fuente le atribuye: «PAN», «Morena», «MC»." },
        resultado: { type: "string", enum: ["pendiente", "aprobado", "desechado", "retirado"], description: "Su desenlace." },
        desde: fecha("Presentados desde esta fecha"),
        hasta: fecha("Presentados hasta esta fecha, inclusive"),
        limite: limite(100, 20),
        pagina,
      },
    },
    async run(env, args) {
      const r = await asuntos(env, args);
      return { datos: r, md: mdAsuntos(r) };
    },
  },
  {
    name: "legisladores",
    title: "Legisladores",
    description:
      "Diputados y senadores con su grupo, entidad y estatus, y sus cuentas: votaciones nominales con su nombre, a favor, en contra, abstenciones, ausencias (y su tasa), iniciativas presentadas y aprobadas. Ordena por ausencia (los más ausentes), asistencia, iniciativas o nombre. Por omisión solo los que están en funciones. La ausencia es en votaciones nominales (no inasistencia a sesiones) y la fuente no dice si fue justificada; las votaciones ocurridas durante una licencia no se cuentan, porque las listas no incluyen a quien está de licencia.",
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
        pagina,
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
    args[k] = tipo === "integer" || tipo === "number" ? Number(v) : tipo === "boolean" ? v === "true" || v === "1" : tipo === "array" ? v.split(",").map((x) => x.trim()).filter(Boolean) : v;
  }
  return args;
}

export function faltantes(h, args) {
  return (h.inputSchema.required ?? []).filter((k) => args[k] == null || args[k] === "" || (Array.isArray(args[k]) && !args[k].length));
}
