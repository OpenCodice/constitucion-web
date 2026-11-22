// La API REST: cada herramienta de `herramientas.js` en /api/{nombre}, por GET
// (parámetros en la URL; las listas, separadas por coma) o POST (JSON).
// Responde JSON, o Markdown a quien lo prefiere en Accept. /api lista las
// herramientas y /openapi.json las describe para generar clientes.

import { SITIO, ErrorDatos } from "./datos.js";
import { HERRAMIENTAS, herramienta, argumentosDeUrl, faltantes } from "./herramientas.js";
import { respuestaJson, respuestaMd } from "./ley.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Accept" };

const quiereMd = (request) => {
  const a = request.headers.get("Accept") ?? "";
  return a.includes("text/markdown") && !a.includes("application/json");
};

// Lo que se sirve tal cual, sin pasar por una herramienta.
const ARCHIVOS = [
  ["/ley/catalogo.json", "Todos los documentos publicados, con su clave, nombre, ámbito y número de artículos."],
  ["/ley/{documento}.json", "El índice de un documento: cada artículo con su etiqueta, ubicación y URL, y sus cambios."],
  ["/ley/{documento}.md", "El texto completo de un documento, en Markdown."],
  ["/ley/{documento}/{articulo}.json", "Un artículo, con su texto y metadatos."],
  ["/bitacora/cambios.json", "Todos los cambios registrados, con sus trailers de git."],
  ["/bitacora/{documento}/{sha12}.md", "Un cambio con la diferencia de cada artículo y su proceso legislativo."],
  ["/congreso/votaciones.json", "Todas las votaciones nominales con sus cuentas totales y por grupo."],
  ["/congreso/legisladores.json", "Todos los legisladores con sus cuentas de votos, ausencias e iniciativas."],
];

function indice() {
  return {
    nombre: "API de OpenCodice",
    descripcion: "El texto vigente de la ley mexicana y los datos del Congreso de la Unión, de solo lectura y sin autenticación. Las mismas herramientas que el servidor MCP (/mcp). Datos de dominio público (CC0); no es la publicación oficial ni asesoría legal.",
    openapi: `${SITIO}/openapi.json`,
    mcp: `${SITIO}/mcp`,
    guia: `${SITIO}/llms.txt`,
    herramientas: HERRAMIENTAS.map((h) => ({
      nombre: h.name,
      descripcion: h.description,
      url: `${SITIO}/api/${h.name}`,
      parametros: Object.fromEntries(Object.entries(h.inputSchema.properties).map(([k, v]) => [k, v.description ?? v.type])),
      requeridos: h.inputSchema.required ?? [],
    })),
    archivos: ARCHIVOS.map(([ruta, descripcion]) => ({ url: `${SITIO}${ruta}`, descripcion })),
  };
}

export function openapi() {
  const paths = {};
  for (const h of HERRAMIENTAS) {
    const props = h.inputSchema.properties;
    const req = new Set(h.inputSchema.required ?? []);
    paths[`/api/${h.name}`] = {
      get: {
        operationId: h.name,
        summary: h.title,
        description: h.description,
        parameters: Object.entries(props).map(([k, v]) => ({
          name: k,
          in: "query",
          required: req.has(k),
          description: `${v.description ?? ""}${v.type === "array" ? " Varios, separados por coma." : ""}`.trim(),
          schema: v.type === "array" ? { type: "string" } : { ...v, description: undefined },
        })),
        responses: {
          200: { description: "Resultado en JSON (o Markdown con Accept: text/markdown).", content: { "application/json": { schema: { type: "object" } }, "text/markdown": { schema: { type: "string" } } } },
          400: { description: "Faltan parámetros o no son válidos." },
          404: { description: "No existe lo pedido (documento, artículo, cambio)." },
        },
      },
      post: {
        operationId: `${h.name}_post`,
        summary: `${h.title} (POST)`,
        requestBody: { required: true, content: { "application/json": { schema: h.inputSchema } } },
        responses: { 200: { description: "Resultado en JSON.", content: { "application/json": { schema: { type: "object" } } } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "OpenCodice",
      version: "2.0.0",
      description: "El texto vigente de la ley mexicana (extraído de los PDF oficiales, con cada reforma registrada) y los datos del Congreso de la Unión. Solo lectura, sin autenticación, deterministas: ninguna respuesta es texto generado. También como servidor MCP en https://constitucion.app/mcp.",
      license: { name: "CC0 1.0 (datos)", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    },
    servers: [{ url: SITIO }],
    paths,
  };
}

export async function rutaApi(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const nombre = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  if (!nombre) return respuestaJson(indice(), 200, CORS);
  const h = herramienta(nombre);
  if (!h) return respuestaJson({ error: `No hay una herramienta «${nombre}».`, herramientas: HERRAMIENTAS.map((x) => x.name), ayuda: `${SITIO}/api` }, 404, CORS);
  let args;
  if (request.method === "POST") {
    try {
      args = await request.json();
    } catch {
      return respuestaJson({ error: "El cuerpo no es JSON válido." }, 400, CORS);
    }
  } else if (request.method === "GET") {
    args = argumentosDeUrl(h, url.searchParams);
  } else {
    return respuestaJson({ error: "Usa GET o POST." }, 405, { ...CORS, Allow: "GET, POST, OPTIONS" });
  }
  const falta = faltantes(h, args);
  if (falta.length) return respuestaJson({ error: `Falta ${falta.join(", ")}.`, ayuda: `${SITIO}/api` }, 400, CORS);
  try {
    const { datos, md } = await h.run(env, args);
    return quiereMd(request) ? respuestaMd(request, md, 200, CORS) : respuestaJson(datos, 200, CORS);
  } catch (e) {
    if (!(e instanceof ErrorDatos)) {
      console.error(e);
      return respuestaJson({ error: "Error interno al leer los datos." }, 500, CORS);
    }
    const status = /no hay|no tiene|no es un|no se encontr/i.test(e.message) ? 404 : 400;
    return respuestaJson({ error: e.message }, status, CORS);
  }
}
