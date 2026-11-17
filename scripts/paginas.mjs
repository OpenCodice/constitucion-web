#!/usr/bin/env node
// Genera las páginas que dependen de los repos de datos: public/index.html
// (el inicio), public/leyes.html (/leyes, para el público), public/estado.html
// (/estado, el status del sistema), public/bitacora/ (la bitácora de
// cambios, del historial de git) y public/congreso/ (votaciones y
// legisladores, de congreso-mexicano).
// Corre en cada despliegue para que el sitio siga siendo estático; el único
// JavaScript en el navegador es public/hemiciclo.js, que solo mejora los
// hemiciclos ya generados aquí.
//
// Sin dependencias: fetch de Node y git. Si GITHUB_TOKEN existe se usa para la
// API (el límite anónimo es de 60 peticiones por hora). Ninguna falla de red
// detiene el despliegue: cada fuente que no responde se anota en la página.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { leerTodo, contarFallas } from "./lib/datos.mjs";
import { leerHistorial } from "./lib/historial.mjs";
import { leerVinculos } from "./lib/vinculos.mjs";
import { enParalelo } from "./lib/comun.mjs";
import { paginaEstado } from "./estado.mjs";
import { paginaLeyes } from "./leyes.mjs";
import { paginaInicio } from "./inicio.mjs";
import { modelo, paginasBitacora } from "./bitacora.mjs";
import { paginasCongreso } from "./congreso.mjs";

const publico = (archivo) => fileURLToPath(new URL(`../public/${archivo}`, import.meta.url));

const generada = new Date().toISOString();
// congreso-mexicano se lee después del historial: sus miles de archivos
// abiertos a la vez hacen fallar los `git` del historial (spawn EBADF).
const [datos, historial] = await Promise.all([leerTodo(generada), leerHistorial()]);
const vinculos = await leerVinculos();
const bitacora = modelo(historial);
datos.bitacora = bitacora;

// La bitácora se escribe entera cada vez: un documento retirado o un commit
// que ya no está no debe dejar páginas viejas.
const archivos = paginasBitacora(bitacora, generada, vinculos);
await rm(publico("bitacora"), { recursive: true, force: true });
await enParalelo([...archivos], 32, async ([ruta, contenido]) => {
  await mkdir(dirname(publico(ruta)), { recursive: true });
  await writeFile(publico(ruta), contenido);
});

// /congreso, del mismo modelo de congreso-mexicano que leyó la bitácora
// (`leerVinculos` lo devuelve tal cual), también entero cada vez.
const congreso = paginasCongreso(vinculos, generada, { bitacora });
await rm(publico("congreso"), { recursive: true, force: true });
await enParalelo([...congreso], 32, async ([ruta, contenido]) => {
  await mkdir(dirname(publico(ruta)), { recursive: true });
  await writeFile(publico(ruta), contenido);
});

await Promise.all([
  writeFile(publico("estado.html"), paginaEstado(datos, generada)),
  writeFile(publico("leyes.html"), paginaLeyes(datos, generada)),
  writeFile(publico("index.html"), paginaInicio(datos, generada)),
]);

const fallas = contarFallas(datos) + bitacora.fallas.length;
console.log(
  `index.html, estado.html, leyes.html, ${archivos.size} archivos de la bitácora (${bitacora.cambios.length} cambios, ${bitacora.documentos.size} documentos) y ${congreso.size} del Congreso generados${
    fallas ? ` con ${fallas} fuentes sin responder` : ""
  }`,
);
