// El sitio es estático (./public). El Worker atiende lo que no es un archivo:
//
// - /ley/…: el texto vigente por documento y por artículo (worker/ley.js);
// - /mcp: el servidor MCP de solo lectura (worker/mcp.js);
// - la versión en Markdown de las páginas para quien la pide con
//   `Accept: text/markdown` (el inicio, /leyes y la bitácora);
// - las rutas del servicio de búsqueda que se retiró, con un 410.
//
// Todo lee los archivos del propio despliegue (env.ASSETS); nada consulta
// otro servicio en tiempo de lectura.

import { catalogo, mdCatalogo, respuestaMd, rutaLey } from "./ley.js";
import { rutaMcp } from "./mcp.js";

const RETIRADAS = ["/api/", "/pdf/"];

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
    if (RETIRADAS.some((r) => ruta.startsWith(r))) {
      return Response.json(
        {
          error: "Este servicio se retiró. El texto de cada ley está en https://constitucion.app/ley y el servidor MCP en https://constitucion.app/mcp.",
          guia: "https://constitucion.app/llms.txt",
        },
        { status: 410 },
      );
    }
    if (ruta === "/" || ruta === "/leyes" || ruta.startsWith("/bitacora/")) return negociar(request, env, url);
    return Response.redirect(new URL("/", url), 302);
  },
};
