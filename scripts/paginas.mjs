#!/usr/bin/env node
// Genera las páginas que dependen de los repos de datos: public/ley/ (el
// texto vigente por documento, que sirve el Worker en /ley), public/index.html
// (el inicio), public/leyes.html (/leyes, para el público), public/estado.html
// (/estado, el status del sistema), public/bitacora/ (la bitácora de
// cambios, del historial de git) y public/congreso/ (votaciones y
// legisladores, de congreso-mexicano).
// Corre en cada despliegue para que el sitio siga siendo estático; el único
// JavaScript en el navegador es public/hemiciclo.js, que solo mejora los
// hemiciclos ya generados aquí.
//
// Los datos se leen sin dependencias (fetch de Node y git); las tarjetas para
// redes se dibujan con resvg (`lib/tarjeta.mjs`). Si GITHUB_TOKEN existe se usa para la
// API (el límite anónimo es de 60 peticiones por hora). Ninguna falla de red
// detiene el despliegue: cada fuente que no responde se anota en la página.

import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
import { urlFoto } from "./lib/congreso.mjs";
import { SITIO, escribirTarjetas, fijarFirma } from "./lib/tarjeta.mjs";
import { nivel } from "./lib/cuadros.mjs";
import { leerCorpus, fichaCatalogo, llmsCompleto, archivosDocumento } from "./lib/corpus.mjs";
import { resumenVotaciones, resumenLegisladores, coleccionesCongreso, archivosVotos, filtrosAsuntos } from "./lib/abiertos.mjs";
import { indiceBusqueda } from "./lib/busqueda.mjs";

const raiz = (archivo) => fileURLToPath(new URL(`../${archivo}`, import.meta.url));
const publico = (archivo) => fileURLToPath(new URL(`../public/${archivo}`, import.meta.url));

const generada = new Date().toISOString();
// congreso-mexicano se lee después del historial: sus miles de archivos
// abiertos a la vez hacen fallar los `git` del historial (spawn EBADF).
const [datos, historial] = await Promise.all([leerTodo(generada), leerHistorial()]);
const bitacora = modelo(historial);
datos.bitacora = bitacora;

// /ley: el texto vigente de cada documento, de main de los mismos clones (antes
// de leer congreso-mexicano, por la misma razón). Entero cada vez, como la
// bitácora: un documento retirado no debe quedar servido.
const corpus = await leerCorpus(historial, bitacora);
const fichas = corpus.documentos.map(fichaCatalogo);
const escribir = (mapa, n = 32) =>
  enParalelo([...mapa], n, async ([ruta, contenido]) => {
    await mkdir(dirname(publico(ruta)), { recursive: true });
    await writeFile(publico(ruta), contenido);
  });
await rm(publico("ley"), { recursive: true, force: true });
await enParalelo(corpus.documentos, 8, (d) => escribir(archivosDocumento(d), 8));
await writeFile(
  publico("ley/catalogo.json"),
  JSON.stringify(
    {
      generada,
      nota: "El texto vigente de cada documento publicado en OpenCodice. Índice de cada uno en `url` (Markdown) o `url` + `.json`; texto completo en `texto`. No es la publicación oficial ni asesoría legal.",
      documentos: fichas,
    },
    null,
    1,
  ),
);
await writeFile(publico("llms-full.txt"), llmsCompleto(fichas, generada));
datos.corpus = { documentos: fichas.length, articulos: fichas.reduce((n, f) => n + f.articulos, 0) };

const vinculos = await leerVinculos();

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
// Las fotos de los legisladores, copiadas de congreso-mexicano (`fuentes/`).
if (vinculos.ok) {
  await mkdir(publico("congreso/fotos"), { recursive: true });
  await enParalelo([...vinculos.fotos.values()], 32, (f) =>
    copyFile(join(vinculos.raiz, f.archivo), publico(urlFoto(f).slice(1))),
  );
}

// Los datos abiertos del Congreso (votaciones y legisladores con sus
// cuentas) y el índice de la búsqueda literal, para la API y el MCP. Van
// después de /congreso, que se borra al generarse.
const nombresLey = new Map(fichas.map((f) => [f.documento, f.nombre]));
const votaciones = vinculos.ok ? resumenVotaciones(vinculos, nombresLey) : [];
const legisladores = vinculos.ok ? resumenLegisladores(vinculos) : [];
const nota = "De congreso-mexicano (SIL, Gaceta Parlamentaria y Senado). Las cuentas son las de cada fuente; `division` es la parte de los votos emitidos que tuvo el lado perdedor (0 unanimidad, 0.5 empate). `leyes` son las que reformó el decreto de la votación (`origen: decreto`) y las que su asunto reforma o expide por su nombre (`origen: asunto`).";
if (vinculos.ok) {
  await mkdir(publico("congreso"), { recursive: true });
  await writeFile(publico("congreso/votaciones.json"), JSON.stringify({ generada, nota, votaciones }));
  await writeFile(
    publico("congreso/legisladores.json"),
    JSON.stringify({ generada, nota: "De congreso-mexicano. `ausencia` es la parte de sus votaciones nominales con nombre en que se le registró ausente: no es inasistencia a sesiones, y la fuente no dice si la ausencia fue justificada. Quien está de licencia no aparece en las listas de votación, así que ese periodo no cuenta.", legisladores }),
  );
  await escribir(archivosVotos(vinculos, votaciones));
}
await rm(publico("buscar"), { recursive: true, force: true });
const asuntos = vinculos.ok ? coleccionesCongreso(vinculos, votaciones, nombresLey) : [];
await escribir(filtrosAsuntos(asuntos));
const busqueda = indiceBusqueda([
  ...corpus.documentos.map((d) => ({
    coleccion: d.clave,
    tipo: "ley",
    nombre: d.indice.nombre,
    ambito: d.indice.ambito,
    unidades: d.indice.articulos.map((a) => ({ buscar: a.texto })),
  })),
  ...asuntos,
]);
await escribir(busqueda.archivos);

// Lo que el inicio dibuja: el orden de los artículos de cada documento (para
// situar los que tocó una reforma) y las cuentas del Congreso.
datos.articulosDe = new Map(corpus.documentos.map((d) => [d.clave, d.indice.articulos.map((x) => x.clave)]));
datos.congreso = vinculos.ok ? { legisladores, votaciones } : null;

await Promise.all([
  writeFile(publico("estado.html"), paginaEstado(datos, generada)),
  writeFile(publico("leyes.html"), paginaLeyes(datos, generada)),
  writeFile(publico("index.html"), paginaInicio(datos, generada)),
]);

// La tira de las tarjetas: los artículos de la Constitución por su número de
// reformas, como en su página.
const vidaCpeum = bitacora.documentos.get("cpeum")?.vida;
if (vidaCpeum) {
  const max = Math.max(...vidaCpeum.articulos.map((x) => x.fechas.length), 1);
  fijarFirma(vidaCpeum.articulos.map((x) => nivel(x.fechas.length, max)));
}

// Cada página registró su tarjeta al generarse; aquí se dibujan las que no
// estén en el caché.
const tarjetas = await escribirTarjetas(publico("og"), raiz(".tarjetas"));

// La dirección de cada página, como la sirve Cloudflare: sin `.html` y con
// `/` final en los `index.html`.
const urlDe = (archivo) => `${SITIO}/${archivo.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "")}`;
const paginas = ["index.html", "leyes.html", "estado.html", ...archivos.keys(), ...congreso.keys()].filter((a) => a.endsWith(".html"));
await writeFile(
  publico("sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paginas.map((a) => `<url><loc>${urlDe(a)}</loc></url>`).join("\n")}
</urlset>
`,
);

const fallas = contarFallas(datos) + bitacora.fallas.length + corpus.fallas.length;
console.log(
  `${corpus.documentos.length} documentos en /ley (${busqueda.palabras} palabras en el índice), index.html, estado.html, leyes.html, ${archivos.size} archivos de la bitácora (${bitacora.cambios.length} cambios, ${bitacora.documentos.size} documentos) y ${congreso.size} del Congreso generados, ${tarjetas.total} tarjetas (${tarjetas.nuevas} nuevas) y el sitemap${
    fallas ? ` con ${fallas} fuentes sin responder` : ""
  }`,
);
