// Servidor MCP de solo lectura en /mcp (transporte Streamable HTTP, sin
// sesiones ni SSE: cada petición POST es una llamada JSON-RPC completa).
//
// Sus herramientas son las mismas lecturas de /ley y de la bitácora, sobre los
// archivos del despliegue: deterministas, sin búsqueda semántica ni texto
// generado. Lo que devuelven es el texto publicado y sus metadatos.

import {
  SITIO,
  articuloDe,
  buscarDocumentos,
  buscarEn,
  catalogo,
  documentoDe,
  indiceDe,
  lineaDocumento,
  mdArticulo,
  mdBusqueda,
  mdHistoria,
  mdIndice,
  textoDe,
} from "./ley.js";

const VERSIONES = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCCIONES = `OpenCodice publica el texto vigente de la ley mexicana (Constitución, leyes federales, legislación fiscal, constituciones y leyes de los estados), extraído de los PDF oficiales, con la historia de cada cambio. Flujo habitual: buscar_documentos para encontrar la clave de una ley (cpeum, lft, lgs, jalisco/constitucion…), indice_documento para ver sus artículos, leer_articulo para el texto. buscar_en_documento es literal (sin acentos ni mayúsculas), no semántica. Cita con la URL que acompaña a cada artículo. No es la publicación oficial ni asesoría legal.`;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const documento = { type: "string", description: "Clave del documento: «cpeum», «lft», «lgs», «cff», «jalisco/constitucion», «cdmx/codigo-penal». También acepta la sigla. buscar_documentos la da." };

const HERRAMIENTAS = [
  {
    name: "buscar_documentos",
    title: "Buscar leyes",
    description:
      "Lista los documentos publicados (constituciones, leyes, códigos, reglamentos, disposiciones fiscales) cuyo nombre, sigla o clave contiene todas las palabras de la consulta. Sin consulta, todos los del ámbito o la entidad. Devuelve la clave de cada uno, que piden las demás herramientas.",
    inputSchema: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Palabras del nombre: «trabajo», «salud», «penal jalisco», «LISR»." },
        ambito: { type: "string", enum: ["constitucion", "federal", "fiscal", "constitucion-estatal", "estatal"], description: "Filtra por ámbito." },
        entidad: { type: "string", description: "Estado, para las leyes estatales: «Jalisco», «Ciudad de México», «nuevo-leon»." },
      },
    },
  },
  {
    name: "indice_documento",
    title: "Índice de una ley",
    description: "Los artículos de un documento en orden, agrupados por título y capítulo, con la URL de cada uno, su fuente oficial y sus últimos cambios.",
    inputSchema: { type: "object", properties: { documento }, required: ["documento"] },
  },
  {
    name: "leer_articulo",
    title: "Leer artículos",
    description:
      "Texto vigente de uno o varios artículos, tal como se extrajo del PDF oficial (con sus notas de reforma), con su URL para citar, su versión (commit) y su fuente.",
    inputSchema: {
      type: "object",
      properties: {
        documento,
        articulos: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
          description: "Artículos como se escriban: «1», «4o», «123», «77 Bis 35 A», «Regla 2.1.1». A lo más 20.",
        },
      },
      required: ["documento", "articulos"],
    },
  },
  {
    name: "buscar_en_documento",
    title: "Buscar en una ley",
    description:
      "Búsqueda literal dentro de uno o varios documentos: los artículos que contienen todas las palabras (sin distinguir acentos ni mayúsculas), con un fragmento. No es semántica: busca las palabras que usaría la ley.",
    inputSchema: {
      type: "object",
      properties: {
        documentos: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5, description: "Claves de los documentos (a lo más 5)." },
        texto: { type: "string", description: "Palabras a buscar: «salario mínimo», «aguinaldo»." },
        limite: { type: "integer", minimum: 1, maximum: 50, description: "Artículos por documento (20 si se omite)." },
      },
      required: ["documentos", "texto"],
    },
  },
  {
    name: "historia_articulo",
    title: "Historia de un artículo",
    description:
      "Los cambios registrados de un artículo (reformas, correcciones de extracción, alta), con su fecha de publicación, su página en la bitácora y la URL del texto en cada versión.",
    inputSchema: { type: "object", properties: { documento, articulo: { type: "string" } }, required: ["documento", "articulo"] },
  },
  {
    name: "cambios_recientes",
    title: "Cambios recientes",
    description: "Las reformas, altas y correcciones registradas, de la más reciente a la más antigua, con los artículos que tocaron. Filtra por documento, tipo y fecha.",
    inputSchema: {
      type: "object",
      properties: {
        documento: { type: "string", description: "Solo los de este documento." },
        tipo: { type: "string", enum: ["reforma", "correccion", "alta", "retiro"], description: "Solo de este tipo (reforma si se omite)." },
        desde: { type: "string", description: "Registrados desde esta fecha (AAAA-MM-DD)." },
        limite: { type: "integer", minimum: 1, maximum: 100, description: "Cuántos (20 si se omite)." },
      },
    },
  },
].map((h) => ({ ...h, annotations: SOLO_LECTURA }));

class ErrorHerramienta extends Error {}

async function docYIndice(env, clave) {
  const cat = await catalogo(env);
  const d = documentoDe(cat, clave);
  if (!d) throw new ErrorHerramienta(`No hay un documento «${clave}». Usa buscar_documentos para encontrar su clave.`);
  return { cat, d, indice: await indiceDe(env, d.documento) };
}

const LLAMADAS = {
  async buscar_documentos(env, { consulta, ambito, entidad } = {}) {
    const cat = await catalogo(env);
    const xs = buscarDocumentos(cat, { consulta, ambito, entidad });
    if (!xs.length) return `Ningún documento coincide. Hay ${cat.documentos.length} en total; prueba con menos palabras o sin filtros.`;
    const max = 150;
    return `${xs.length === 1 ? "1 documento" : `${xs.length} documentos`}.\n\n${xs.slice(0, max).map(lineaDocumento).join("\n")}${xs.length > max ? `\n\n(y ${xs.length - max} más: afina la consulta)` : ""}`;
  },

  async indice_documento(env, { documento: k }) {
    const { indice } = await docYIndice(env, k);
    return mdIndice(indice);
  },

  async leer_articulo(env, { documento: k, articulos, articulo }) {
    const pedidos = articulos ?? (articulo ? [articulo] : []);
    if (!pedidos.length) throw new ErrorHerramienta("Falta `articulos`.");
    if (pedidos.length > 20) throw new ErrorHerramienta("A lo más 20 artículos por llamada.");
    const { d, indice } = await docYIndice(env, k);
    const texto = await textoDe(env, d.documento);
    return pedidos
      .map((p) => {
        const a = articuloDe(indice, String(p));
        return a ? mdArticulo(indice, a, texto) : `${indice.nombre} no tiene un artículo «${p}». Su índice: ${SITIO}/ley/${d.documento}\n`;
      })
      .join("\n");
  },

  async buscar_en_documento(env, { documentos, documento: uno, texto: consulta, limite = 20 }) {
    const claves = documentos ?? (uno ? [uno] : []);
    if (!claves.length || claves.length > 5) throw new ErrorHerramienta("Pide de 1 a 5 documentos.");
    if (!consulta?.trim()) throw new ErrorHerramienta("Falta `texto`.");
    const n = Math.min(Math.max(1, Number(limite) || 20), 50);
    const partes = [];
    for (const k of claves) {
      const { d, indice } = await docYIndice(env, k);
      partes.push(mdBusqueda(indice, consulta, buscarEn(indice, await textoDe(env, d.documento), consulta, n), n));
    }
    return partes.join("\n");
  },

  async historia_articulo(env, { documento: k, articulo }) {
    const { d, indice } = await docYIndice(env, k);
    const a = articuloDe(indice, String(articulo ?? ""));
    if (!a) throw new ErrorHerramienta(`${indice.nombre} no tiene un artículo «${articulo}». Su índice: ${SITIO}/ley/${d.documento}`);
    return mdHistoria(indice, a);
  },

  async cambios_recientes(env, { documento: k, tipo = "reforma", desde, limite = 20 } = {}) {
    const r = await env.ASSETS.fetch(new Request(`${SITIO}/bitacora/cambios.json`));
    if (!r.ok) throw new ErrorHerramienta("La bitácora no está disponible en este despliegue.");
    const { cambios } = await r.json();
    let doc = null;
    if (k) {
      const d = documentoDe(await catalogo(env), k);
      doc = d?.documento ?? String(k).toLowerCase();
    }
    const n = Math.min(Math.max(1, Number(limite) || 20), 100);
    const xs = cambios
      .filter((c) => !c.menor && !c.ajuste_inicial && c.tipo === tipo && (!doc || c.documento === doc) && (!desde || c.fecha.slice(0, 10) >= desde))
      .sort((a, b) => (b.publicacion.at(-1) ?? b.fecha).localeCompare(a.publicacion.at(-1) ?? a.fecha))
      .slice(0, n);
    if (!xs.length) return "Ningún cambio coincide.";
    return xs
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
        return `- ${c.nombre} (\`${c.documento}\`) · ${c.tipo} · ${pub}${arts ? ` · ${arts}` : ""} · ${c.pagina}`;
      })
      .join("\n");
  },
};

// ------------------------------------------------------------------ JSON-RPC

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

const error = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function atender(env, m) {
  if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return error(m?.id, -32600, "Petición JSON-RPC inválida");
  const notificacion = !("id" in m);
  if (notificacion) return null;
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id: m.id,
        result: {
          protocolVersion: VERSIONES.includes(p.protocolVersion) ? p.protocolVersion : VERSIONES[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "opencodice", title: "OpenCodice: la ley mexicana vigente", version: "1.0.0", websiteUrl: SITIO },
          instructions: INSTRUCCIONES,
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id: m.id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: m.id, result: { tools: HERRAMIENTAS } };
    case "tools/call": {
      const fn = LLAMADAS[p.name];
      if (!fn) return error(m.id, -32602, `Herramienta desconocida: ${p.name}`);
      try {
        const texto = await fn(env, p.arguments ?? {});
        return { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: texto }] } };
      } catch (e) {
        if (!(e instanceof ErrorHerramienta)) console.error(e);
        return {
          jsonrpc: "2.0",
          id: m.id,
          result: { content: [{ type: "text", text: e instanceof ErrorHerramienta ? e.message : "Error interno al leer los datos." }], isError: true },
        };
      }
    }
    case "resources/list":
      return { jsonrpc: "2.0", id: m.id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id: m.id, result: { prompts: [] } };
    default:
      return error(m.id, -32601, `Método no disponible: ${m.method}`);
  }
}

export async function rutaMcp(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") {
    // Sin flujo SSE: todo va por POST, y un cliente MCP que pide el flujo
    // recibe 405. A quien abre la URL en el navegador se le dice cómo
    // conectarse.
    const cliente = (request.headers.get("Accept") ?? "").includes("text/event-stream") || request.method !== "GET";
    return new Response(
      `Servidor MCP de OpenCodice (Streamable HTTP, solo POST).\n\nAgrégalo a tu cliente con la URL ${SITIO}/mcp. Por ejemplo, en Claude Code:\n\n  claude mcp add --transport http opencodice ${SITIO}/mcp\n\nGuía: ${SITIO}/llms.txt\n`,
      { status: cliente ? 405 : 200, headers: { ...CORS, Allow: "POST, OPTIONS", "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json(error(null, -32700, "JSON inválido"), { status: 400, headers: CORS });
  }
  const lote = Array.isArray(cuerpo);
  const respuestas = (await Promise.all((lote ? cuerpo : [cuerpo]).map((m) => atender(env, m)))).filter(Boolean);
  if (!respuestas.length) return new Response(null, { status: 202, headers: CORS });
  return Response.json(lote ? respuestas : respuestas[0], { headers: CORS });
}
