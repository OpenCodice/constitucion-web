// La página base de /tema: el formulario y el lugar donde el Worker
// (`worker/tema.js`) pone el resultado de una consulta. Sin JavaScript: la
// consulta va en la URL (`/tema?q=…`) y la página se puede enlazar.

import { documento } from "./lib/comun.mjs";

const ESTILO = `
.tema-form { display: flex; gap: 0.5rem; margin: 0 0 2.5rem; }
.tema-form input { flex: 1; min-width: 0; padding: 0.55em 0.75em; border: 1px solid var(--linea); border-radius: 4px; background: var(--fondo); color: var(--texto); font: inherit; }
.tema-form input:focus-visible { outline: 2px solid var(--texto); outline-offset: 1px; }
.tema-form button { padding: 0.55em 1.1em; border: 1px solid var(--texto); border-radius: 4px; background: var(--texto); color: var(--fondo); font: inherit; font-weight: 500; cursor: pointer; }
section { margin: 0 0 2.75rem; }
.resumen { color: var(--tenue); font-size: 0.875em; }
.tema-lista { list-style: none; margin: 0; padding: 0; }
.tema-lista > li { padding: 0.6em 0; border-bottom: 1px solid var(--linea); }
.tema-lista small { display: block; margin-top: 0.2em; color: var(--tenue); font-size: 0.8em; }
.tema-lista .dato { margin-right: 0.5em; color: var(--tenue); font-size: 0.8em; }
.tema-lista .cuenta { color: var(--tenue); font-size: 0.8em; white-space: nowrap; }
.articulos { list-style: none; margin: 0.35em 0 0; padding: 0 0 0 1em; font-size: 0.875em; }
.articulos li { margin: 0.25em 0; }
.fragmento { color: var(--tenue); }
.ejemplos a { margin-right: 0.9em; white-space: nowrap; }
`;

const EJEMPLOS = ["matrimonio igualitario", "prisión preventiva", "salario mínimo", "inteligencia artificial", "vapeadores"];

export function paginaTema() {
  return documento({
    titulo: "Temas — OpenCodice",
    h1: "Temas",
    descripcion: "Lo publicado sobre un tema en una sola vista: los artículos vigentes, las iniciativas con su desenlace, las votaciones y quién las presentó.",
    estilo: ESTILO,
    ruta: "/tema",
    url: "/tema",
    cuerpo: `      <p>Escribe las palabras de un tema y se reúne lo publicado que las contiene: los artículos vigentes, las iniciativas y proposiciones con su desenlace, las votaciones y quién las presentó.</p>
      <form class="tema-form" action="/tema" method="get" role="search">
        <label class="oculto" for="q">Palabras del tema</label>
        <input type="search" id="q" name="q" value="" placeholder="matrimonio igualitario" autocomplete="off" required />
        <button type="submit">Buscar</button>
      </form>

      <!-- resultado -->

      <p class="resumen ejemplos">Por ejemplo: ${EJEMPLOS.map((e) => `<a href="/tema?q=${encodeURIComponent(e)}">${e}</a>`).join("")}</p>`,
    pie: `<p>La búsqueda es literal: reúne lo que tiene todas las palabras, sin distinguir acentos ni mayúsculas. No hay sinónimos ni interpretación; para otro ángulo del mismo tema, prueba con otras palabras. Lo mismo, para agentes de IA: <a href="/api/tema?texto=matrimonio+igualitario">/api/tema</a> y la herramienta <code>tema</code> del <a href="/mcp">servidor MCP</a>.</p>`,
  });
}
