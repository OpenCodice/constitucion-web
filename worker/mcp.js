// Servidor MCP de solo lectura en /mcp (transporte Streamable HTTP, sin
// sesiones ni SSE: cada POST es una llamada JSON-RPC completa). Sus
// herramientas son las de `herramientas.js`, las mismas de la API.

import { SITIO, ErrorDatos } from "./datos.js";
import { HERRAMIENTAS, herramienta, faltantes } from "./herramientas.js";

const VERSIONES = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const INSTRUCCIONES = `OpenCodice publica el texto vigente de la ley mexicana (Constitución, leyes federales, legislación fiscal, constituciones y leyes de los estados), extraído de los PDF oficiales, con cada reforma registrada, y los datos del Congreso de la Unión (votaciones nominales, legisladores, iniciativas, decretos). Todo es dato publicado, no texto generado: cita las URL que acompañan a cada resultado.

Cómo usarlo:
- Un tema («¿qué dice la ley sobre el matrimonio entre personas del mismo sexo?», «¿qué se ha propuesto sobre X?»): tema reúne en una respuesta los artículos vigentes, las iniciativas con su desenlace, las votaciones y quién las presentó. Es literal, así que repítelo con las palabras que usaría la ley o una iniciativa («matrimonio igualitario», «matrimonio mismo sexo», «matrimonio dos personas», «matrimonio hombre mujer») y luego leer_articulo para el texto. buscar hace lo mismo sin agrupar, con filtros por tipo, documento y ámbito.
- Una ley: buscar_documentos da su clave (cpeum, lft, lgs, jalisco/constitucion…); indice_documento, sus artículos; leer_articulo, el texto.
- Qué cambió en la última reforma de una ley: detalle_cambio (diff de cada artículo y su proceso legislativo).
- Qué decía un artículo en una fecha pasada: leer_articulo con \`fecha\`. De las leyes federales y la Constitución se conservan versiones desde 2006, no todas las reformas: la respuesta dice de qué versión es el texto, y historia_articulo lista las versiones en que cambió.
- Votaciones controvertidas: votaciones con orden «division». Las leyes con más votaciones divididas: votaciones_por_ley.
- Quién votó qué: votacion (con el id que da votaciones) lista el voto de cada legislador; votos_legislador, las votaciones de una persona.
- Lo que presentó un legislador, o las iniciativas sobre una ley: asuntos (con autor, documento, texto o fechas).
- Legisladores más ausentes: legisladores con orden «ausencia».
- Las listas vienen por páginas: la respuesta dice cuántas hay y \`pagina\` pide la siguiente. Cada herramienta acepta \`formato\`: «json» devuelve los mismos datos estructurados en vez de Markdown.
- Los datos tienen principio: el registro de cada ley empieza en su alta en OpenCodice (cambios_recientes lo dice) y los del Congreso cubren solo el periodo que cada respuesta indica. Que no haya registro no significa que no haya pasado.
No es la publicación oficial ni asesoría legal.`;

// En el MCP cada herramienta acepta además \`formato\`; la API elige por Accept.
const FORMATO = { type: "string", enum: ["markdown", "json"], description: "markdown (por omisión) o json: los mismos datos, estructurados." };
const conFormato = (esquema) => ({ ...esquema, properties: { ...esquema.properties, formato: FORMATO } });

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

const error = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const resultado = (id, result) => ({ jsonrpc: "2.0", id, result });

async function llamar(env, nombre, args) {
  const h = herramienta(nombre);
  if (!h) return null;
  const falta = faltantes(h, args);
  if (falta.length) return { content: [{ type: "text", text: `Falta ${falta.map((k) => `\`${k}\``).join(", ")}.` }], isError: true };
  try {
    const { formato, ...resto } = args;
    const { md, datos } = await h.run(env, resto);
    return { content: [{ type: "text", text: formato === "json" ? JSON.stringify(datos) : md }] };
  } catch (e) {
    if (!(e instanceof ErrorDatos)) console.error(e);
    return { content: [{ type: "text", text: e instanceof ErrorDatos ? e.message : "Error interno al leer los datos." }], isError: true };
  }
}

async function atender(env, m) {
  if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return error(m?.id, -32600, "Petición JSON-RPC inválida");
  if (!("id" in m)) return null;
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize":
      return resultado(m.id, {
        protocolVersion: VERSIONES.includes(p.protocolVersion) ? p.protocolVersion : VERSIONES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "opencodice", title: "OpenCodice: la ley mexicana vigente y el Congreso", version: "2.1.0", websiteUrl: SITIO },
        instructions: INSTRUCCIONES,
      });
    case "ping":
      return resultado(m.id, {});
    case "tools/list":
      return resultado(m.id, {
        tools: HERRAMIENTAS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema: conFormato(inputSchema), annotations: { title, ...SOLO_LECTURA } })),
      });
    case "tools/call": {
      const r = await llamar(env, p.name, p.arguments ?? {});
      return r ? resultado(m.id, r) : error(m.id, -32602, `Herramienta desconocida: ${p.name}`);
    }
    case "resources/list":
      return resultado(m.id, { resources: [] });
    case "resources/templates/list":
      return resultado(m.id, { resourceTemplates: [] });
    case "prompts/list":
      return resultado(m.id, { prompts: [] });
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
      `Servidor MCP de OpenCodice (Streamable HTTP, solo POST, sin autenticación).\n\nAgrégalo a tu cliente con la URL ${SITIO}/mcp. En Claude Code:\n\n  claude mcp add --transport http opencodice ${SITIO}/mcp\n\nEn Codex:\n\n  codex mcp add opencodice --url ${SITIO}/mcp\n\nEn Gemini CLI:\n\n  gemini mcp add --transport http opencodice ${SITIO}/mcp\n\nEn Cursor, en ~/.cursor/mcp.json:\n\n  { "mcpServers": { "opencodice": { "url": "${SITIO}/mcp" } } }\n\nEn ChatGPT (modo de desarrollador) o en Claude, como conector personalizado con esa URL, sin autenticación.\n\nHerramientas: ${HERRAMIENTAS.map((h) => h.name).join(", ")}.\nLas mismas, como API REST: ${SITIO}/api (OpenAPI en ${SITIO}/openapi.json).\nGuía: ${SITIO}/llms.txt\n`,
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
