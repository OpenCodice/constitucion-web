// Lo que sirve el Worker a los agentes (/ley, /mcp y las páginas en
// Markdown), con un despliegue sintético en lugar de env.ASSETS.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarClave, mapaClaves, resolverClave } from "../worker/claves.js";
import worker, { prefiereMarkdown } from "../worker/index.js";
import { diferenciaTexto } from "./lib/diferencias.mjs";

const art = (n, cuerpo) => `# Artículo ${n}.\n\n${cuerpo}`;
const TEXTOS = [
  ["001", art("1o", "Toda persona gozará de los derechos humanos.")],
  ["004", art("4o", "La mujer y el hombre son iguales ante la ley.")],
  ["077-bis-35-a", art("77 Bis 35 A", "El salario mínimo se fijará anualmente.")],
];

function documentoSintetico() {
  let texto = "";
  const articulos = TEXTOS.map(([clave, t], i) => {
    if (texto) texto += "\n\n";
    const ini = texto.length;
    texto += t;
    return { clave, etiqueta: t.split("\n")[0].slice(2), ubicacion: i < 2 ? "Título Primero / Capítulo I" : "Título Segundo", ini, fin: texto.length, cambios: i === 1 ? [0, 1] : [1] };
  });
  texto += "\n";
  const indice = {
    documento: "cpeum",
    nombre: "Constitución Política de los Estados Unidos Mexicanos",
    sigla: "CPEUM",
    ambito: "constitucion",
    entidad: null,
    repo: "constitucion-mexicana",
    carpeta: "articulos/",
    fuente: "https://www.diputados.gob.mx/LeyesBiblio/pdf/CPEUM.pdf",
    articulos,
    cambios: [
      { sha: "a".repeat(40), tipo: "reforma", clase: "reforma", dia: "2026-11-15", publicacion: ["2026-10-07"], medio: "DOF", bitacora: "https://constitucion.app/bitacora/cpeum/aaaaaaaaaaaa" },
      { sha: "b".repeat(40), tipo: "alta", clase: "alta", dia: "2026-06-09", publicacion: ["2026-06-02"], medio: "DOF", bitacora: "https://constitucion.app/bitacora/cpeum/bbbbbbbbbbbb" },
    ],
  };
  return { indice, texto };
}

const { indice, texto } = documentoSintetico();
const estatal = { ...indice, documento: "jalisco/constitucion", nombre: "Constitución de Jalisco", sigla: "Jalisco", ambito: "constitucion-estatal", entidad: "Jalisco" };
const ficha = (i) => ({ documento: i.documento, nombre: i.nombre, sigla: i.sigla, ambito: i.ambito, entidad: i.entidad, articulos: 3, url: `https://constitucion.app/ley/${i.documento}` });

const ARCHIVOS = {
  "/ley/catalogo.json": JSON.stringify({ documentos: [ficha(indice), ficha(estatal)] }),
  "/ley/_/cpeum.json": JSON.stringify(indice),
  "/ley/_/cpeum.md": texto,
  "/ley/_/jalisco/constitucion.json": JSON.stringify(estatal),
  "/ley/_/jalisco/constitucion.md": texto,
  "/llms.txt": "# OpenCodice\n",
  "/index.html": "<!doctype html><title>Inicio</title>",
  "/bitacora/cpeum/aaaaaaaaaaaa.html": "<!doctype html><title>Reforma</title>",
  "/bitacora/cpeum/aaaaaaaaaaaa.md": "# Reforma\n",
  "/bitacora/cambios.json": JSON.stringify({
    cambios: [
      { documento: "cpeum", nombre: indice.nombre, tipo: "reforma", menor: false, ajuste_inicial: false, fecha: "2026-11-15T00:00:00Z", publicacion: ["2026-10-07"], medio: "DOF", articulos_adicionados: [], articulos_modificados: ["004"], articulos_derogados: [], articulos_corregidos: [], pagina: "https://constitucion.app/bitacora/cpeum/aaaaaaaaaaaa" },
    ],
  }),
};

const env = {
  ASSETS: {
    async fetch(req) {
      const ruta = new URL(req.url ?? req).pathname;
      const clave = ruta === "/" ? "/index.html" : ruta.endsWith(".html") || ruta.includes(".") ? ruta : `${ruta}.html`;
      const cuerpo = ARCHIVOS[clave];
      return cuerpo == null ? new Response("no", { status: 404 }) : new Response(cuerpo, { headers: { "Content-Type": "text/html" } });
    },
  },
};

const pedir = (ruta, init = {}) => worker.fetch(new Request(`https://constitucion.app${ruta}`, init), env);
const md = { headers: { Accept: "text/markdown" } };

test("claves: las formas en que se escribe un artículo", () => {
  assert.equal(normalizarClave("Artículo 4o."), "4");
  assert.equal(normalizarClave("77 Bis 35 A"), "77-bis-35-a");
  assert.equal(normalizarClave("Regla 2.1.1."), "2.1.1");
  assert.equal(normalizarClave("1/CFF/N"), "1-cff-n");
  const m = mapaClaves(["001", "004", "077-bis-35-a", "1.1", "1-cff-n"]);
  for (const [pedido, clave] of [["4", "004"], ["4o", "004"], ["004", "004"], ["Art. 77 Bis 35-A", "077-bis-35-a"], ["Regla 1.1", "1.1"], ["Criterio 1/CFF/N", "1-cff-n"]]) {
    assert.equal(resolverClave(m, pedido), clave, pedido);
  }
  assert.equal(resolverClave(m, "5"), null);
});

test("/ley: un artículo, con su frontmatter y sin redirigir", async () => {
  const r = await pedir("/ley/CPEUM/4o", md);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Content-Type"), /text\/markdown/);
  assert.equal(r.headers.get("Link"), "<https://constitucion.app/ley/cpeum/004>; rel=\"canonical\"");
  const t = await r.text();
  assert.match(t, /^---\ndocumento: "cpeum"/);
  assert.match(t, /url: "https:\/\/constitucion.app\/ley\/cpeum\/004"/);
  assert.match(t, /version: "a{40}"/);
  assert.match(t, /permanente: "https:\/\/constitucion.app\/ley\/cpeum\/004@a{12}"/);
  assert.match(t, /---\n\n# Artículo 4o\.\n\nLa mujer y el hombre son iguales ante la ley\.\n$/);
  // El navegador lo recibe como texto plano para mostrarlo.
  const h = await pedir("/ley/cpeum/1", { headers: { Accept: "text/html,*/*" } });
  assert.match(h.headers.get("Content-Type"), /text\/plain/);
});

test("/ley: índice, texto completo, JSON, historia, versión y documento con diagonal", async () => {
  const i = await (await pedir("/ley/cpeum", md)).text();
  assert.match(i, /## Título Primero \/ Capítulo I\n\n- \[Artículo 1o\.\]\(https:\/\/constitucion.app\/ley\/cpeum\/001\)/);
  const completo = await (await pedir("/ley/cpeum.md", md)).text();
  assert.ok(completo.endsWith(texto));
  const j = await (await pedir("/ley/cpeum/77%20bis%2035%20a.json")).json();
  assert.equal(j.clave, "077-bis-35-a");
  assert.equal(j.texto, TEXTOS[2][1]);
  const h = await (await pedir("/ley/cpeum/4/historia", md)).text();
  assert.match(h, /# Artículo 4o: historia/);
  assert.match(h, /2026-11-15 · Reforma \(DOF 2026-10-07\)/);
  const v = await pedir("/ley/cpeum/4@bbbbbbb");
  assert.equal(v.status, 302);
  assert.equal(v.headers.get("Location"), `https://raw.githubusercontent.com/OpenCodice/constitucion-mexicana/${"b".repeat(40)}/articulos/004.md`);
  assert.equal((await pedir("/ley/cpeum/4@cccccccc")).status, 404);
  assert.match(await (await pedir("/ley/jalisco/constitucion/1", md)).text(), /documento: "jalisco\/constitucion"/);
  // Un estado lista sus leyes; su sigla no abre la constitución.
  assert.match(await (await pedir("/ley/jalisco", md)).text(), /^# Leyes de Jalisco/);
});

test("/ley: lo que no existe es 404 con ayuda", async () => {
  const a = await pedir("/ley/cpeum/999", md);
  assert.equal(a.status, 404);
  assert.match(await a.text(), /no tiene un artículo `999`[\s\S]*\/ley\/cpeum/);
  assert.equal((await pedir("/ley/nada", md)).status, 404);
  assert.equal((await pedir("/ley/cpeum/1/otra", md)).status, 404);
});

test("/ley/buscar: literal, sin acentos ni mayúsculas", async () => {
  const t = await (await pedir("/ley/buscar?q=SALARIO%20minimo&documento=cpeum", md)).text();
  assert.match(t, /1 artículo con todas las palabras/);
  assert.match(t, /\[Artículo 77 Bis 35 A\.\]\(https:\/\/constitucion.app\/ley\/cpeum\/077-bis-35-a\)/);
  assert.match(await (await pedir("/ley/buscar?q=jalisco", md)).text(), /Constitución de Jalisco/);
  assert.equal((await pedir("/ley/buscar", md)).status, 400);
});

const rpc = async (cuerpo) => {
  const r = await pedir("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(cuerpo) });
  return { status: r.status, json: r.status === 202 ? null : await r.json() };
};
const llamar = async (name, args) => (await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } })).json.result;

test("mcp: initialize, notificaciones y lista de herramientas", async () => {
  const { json } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba", version: "1" } } });
  assert.equal(json.result.protocolVersion, "2025-06-18");
  assert.deepEqual(json.result.capabilities, { tools: { listChanged: false } });
  assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const lista = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json.result.tools;
  assert.deepEqual(
    lista.map((h) => h.name),
    ["buscar_documentos", "indice_documento", "leer_articulo", "buscar_en_documento", "historia_articulo", "cambios_recientes"],
  );
  assert.ok(lista.every((h) => h.annotations.readOnlyHint && h.inputSchema.type === "object"));
  assert.equal((await rpc({ jsonrpc: "2.0", id: 3, method: "otra/cosa" })).json.error.code, -32601);
  const lote = await rpc([{ jsonrpc: "2.0", id: 4, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]);
  assert.deepEqual(lote.json, [{ jsonrpc: "2.0", id: 4, result: {} }]);
});

test("mcp: las herramientas leen lo mismo que /ley", async () => {
  const leer = await llamar("leer_articulo", { documento: "CPEUM", articulos: ["4o", "99"] });
  assert.ok(!leer.isError);
  assert.match(leer.content[0].text, /La mujer y el hombre son iguales/);
  assert.match(leer.content[0].text, /no tiene un artículo «99»/);
  assert.match((await llamar("buscar_documentos", { entidad: "Jalisco" })).content[0].text, /^1 documento\.[\s\S]*jalisco\/constitucion/);
  assert.match((await llamar("buscar_en_documento", { documentos: ["cpeum"], texto: "derechos humanos" })).content[0].text, /Artículo 1o/);
  assert.match((await llamar("historia_articulo", { documento: "cpeum", articulo: "4" })).content[0].text, /Alta \(DOF 2026-06-02\)/);
  assert.match((await llamar("cambios_recientes", { documento: "cpeum" })).content[0].text, /modifica 004/);
  const error = await llamar("indice_documento", { documento: "nada" });
  assert.equal(error.isError, true);
  assert.match(error.content[0].text, /buscar_documentos/);
});

test("mcp: GET explica cómo conectarse; un cliente que pide SSE recibe 405", async () => {
  assert.equal((await pedir("/mcp")).status, 200);
  assert.equal((await pedir("/mcp", { headers: { Accept: "text/event-stream" } })).status, 405);
});

test("negociación: Markdown para quien lo prefiere, HTML para los demás", async () => {
  assert.equal(prefiereMarkdown("text/markdown"), true);
  assert.equal(prefiereMarkdown("text/markdown, text/html;q=0.9"), true);
  assert.equal(prefiereMarkdown("text/html,application/xhtml+xml,*/*;q=0.8"), false);
  assert.equal(prefiereMarkdown("text/html;q=1, text/markdown;q=0.5"), false);
  const r = await pedir("/bitacora/cpeum/aaaaaaaaaaaa", md);
  assert.equal(await r.text(), "# Reforma\n");
  assert.equal(await (await pedir("/", md)).text(), "# OpenCodice\n");
  const html = await pedir("/bitacora/cpeum/aaaaaaaaaaaa", { headers: { Accept: "text/html" } });
  assert.match(await html.text(), /<title>Reforma/);
  assert.match(html.headers.get("Vary"), /Accept/);
  assert.match(await (await pedir("/leyes", md)).text(), /^# OpenCodice: las leyes publicadas/);
});

test("diferenciaTexto: párrafos quitados y puestos con contexto", () => {
  const antes = "# Artículo 1.\n\nUno.\n\nDos.\n\nTres.\n\nCuatro.\n\nCinco.";
  const despues = "# Artículo 1.\n\nUno.\n\nDos y medio.\n\nTres.\n\nCuatro.\n\nCinco.";
  assert.equal(diferenciaTexto(antes, despues), "@@ 1 párrafo sin cambios @@\n  Uno.\n- Dos.\n+ Dos y medio.\n  Tres.\n@@ 2 párrafos sin cambios @@");
});
