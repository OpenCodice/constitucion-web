// El sitio es estático (./public): lo que es un archivo se sirve directo,
// incluidos los datos (`/ley/{documento}.md` y `.json`, `/ley/catalogo.json`,
// `/congreso/*.json`, `/bitacora/cambios.json`). El Worker atiende lo demás:
//
// - /ley/…: un artículo, el índice de un documento y su historia (ley.js);
// - /api/…: las herramientas como API REST (api.js) y /openapi.json;
// - /mcp: las mismas herramientas como servidor MCP (mcp.js);
// - /tema?q=…: la vista por tema para personas (tema.js);
// - la versión en Markdown de las páginas para quien la pide con
//   `Accept: text/markdown` (el inicio, /leyes y la bitácora);
// - /pdf/…, del servicio de búsqueda que se retiró, con un 410;
// - /.well-known/… (el descubrimiento de OAuth), con un 404.
//
// Todo lee los archivos del propio despliegue (env.ASSETS); nada consulta
// otro servicio en tiempo de lectura.

import { mdCatalogo, respuestaMd, respuestaJson, rutaLey } from "./ley.js";
import { catalogo } from "./datos.js";
import { rutaMcp } from "./mcp.js";
import { rutaApi, openapi } from "./api.js";
import { rutaTema } from "./tema.js";

// ¿Prefiere Markdown a HTML? Por los pesos `q` del Accept; sin mención de
// HTML basta con que pida Markdown.
export function prefiereMarkdown(accept) {
  const pesos = {};
  for (const parte of (accept ?? "").split(",")) {
    const [tipo, ...params] = parte.trim().split(";");
    const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)).find(Boolean);
    pesos[tipo.trim().toLowerCase()] = q ? Number(q[1]) : 1;
  }
  const md = pesos["text/markdown"] ?? 0;
  return md > 0 && md >= (pesos["text/html"] ?? 0);
}

// La versión en Markdown de una página HTML, como archivo del despliegue.
function gemeloMarkdown(ruta) {
  if (ruta === "/") return "/llms.txt";
  if (ruta.startsWith("/bitacora/")) return ruta.endsWith("/") ? `${ruta}index.md` : `${ruta}.md`;
  return null;
}

async function negociar(request, env, url) {
  if (prefiereMarkdown(request.headers.get("Accept"))) {
    if (url.pathname === "/leyes") {
      const cat = await catalogo(env);
      if (cat) return respuestaMd(request, mdCatalogo(cat));
    }
    const gemelo = gemeloMarkdown(url.pathname);
    if (gemelo) {
      const r = await env.ASSETS.fetch(new Request(new URL(gemelo, url)));
      if (r.ok) return respuestaMd(request, await r.text(), 200, { "Content-Location": gemelo });
    }
  }
  const r = await env.ASSETS.fetch(request);
  if (r.status === 404) return Response.redirect(new URL("/", url), 302);
  const conVary = new Response(r.body, r);
  conVary.headers.append("Vary", "Accept");
  return conVary;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ruta = url.pathname;
    if (ruta === "/mcp" || ruta === "/mcp/") return rutaMcp(request, env);
    if (ruta === "/ley" || ruta.startsWith("/ley/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Accept" } });
      return rutaLey(request, env);
    }
    if (ruta === "/api" || ruta.startsWith("/api/")) return rutaApi(request, env);
    if (ruta === "/openapi.json") return respuestaJson(openapi(), 200, { "Access-Control-Allow-Origin": "*" });
    if (ruta.startsWith("/pdf/")) {
      return Response.json(
        { error: "Este servicio se retiró. El texto de cada ley está en https://constitucion.app/ley y la API en https://constitucion.app/api.", guia: "https://constitucion.app/llms.txt" },
        { status: 410 },
      );
    }
    if (ruta === "/tema") return rutaTema(request, env, prefiereMarkdown(request.headers.get("Accept")));
    if (ruta === "/" || ruta === "/leyes" || ruta.startsWith("/bitacora/")) return negociar(request, env, url);
    // Los clientes MCP buscan aquí si hay OAuth; redirigirlos al inicio los
    // confunde. Un 404 dice que el servidor no pide autenticación.
    if (ruta.startsWith("/.well-known/") || ruta === "/register") {
      return Response.json({ error: "No hay autenticación: el MCP (/mcp) y la API (/api) son abiertos." }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    }
    return Response.redirect(new URL("/", url), 302);
  },
};
