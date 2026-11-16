#!/usr/bin/env node
// Genera las páginas que dependen de los repos de datos: public/index.html
// (el inicio), public/leyes.html (/leyes, para el público) y public/estado.html
// (/estado, el status del sistema).
// Corre en cada despliegue para que el sitio siga siendo estático y sin
// JavaScript en el navegador.
//
// Sin dependencias: solo fetch de Node. Si GITHUB_TOKEN existe se usa para la
// API (el límite anónimo es de 60 peticiones por hora). Ninguna falla de red
// detiene el despliegue: cada fuente que no responde se anota en la página.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { leerTodo, contarFallas } from "./lib/datos.mjs";
import { paginaEstado } from "./estado.mjs";
import { paginaLeyes } from "./leyes.mjs";
import { paginaInicio } from "./inicio.mjs";

const publico = (archivo) => fileURLToPath(new URL(`../public/${archivo}`, import.meta.url));

const generada = new Date().toISOString();
const datos = await leerTodo(generada);

await Promise.all([
  writeFile(publico("estado.html"), paginaEstado(datos, generada)),
  writeFile(publico("leyes.html"), paginaLeyes(datos, generada)),
  writeFile(publico("index.html"), paginaInicio(datos, generada)),
]);

const fallas = contarFallas(datos);
console.log(`index.html, estado.html y leyes.html generadas${fallas ? ` con ${fallas} fuentes sin responder` : ""}`);
