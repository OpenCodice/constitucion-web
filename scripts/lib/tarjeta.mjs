// La imagen que muestran las redes y los mensajeros al compartir una página
// (og:image): 1200×630, con el mismo estilo del sitio, blanco y negro.
//
// Cada página registra su tarjeta al generarse (`registrar`) y recibe su URL,
// que sale de un hash del contenido: las páginas con la misma tarjeta
// comparten la imagen y un despliegue solo dibuja las que no estén ya en el
// caché (`.tarjetas/`, que el workflow conserva entre corridas).

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

export const SITIO = "https://constitucion.app";
export const ANCHO = 1200;
export const ALTO = 630;

// Cambia con el diseño para que el caché no sirva tarjetas viejas.
const VERSION = 1;

const COLOR = { fondo: "#ffffff", texto: "#111111", tenue: "#6b6b6b", linea: "#e4e4e4" };

const registradas = new Map();

export function idTarjeta({ etiqueta = "", titulo, detalle = "", sitio = "constitucion.app" }) {
  return createHash("sha256")
    .update(JSON.stringify([VERSION, etiqueta, titulo, detalle, sitio]))
    .digest("hex")
    .slice(0, 16);
}

export function registrar(tarjeta) {
  const id = idTarjeta(tarjeta);
  registradas.set(id, tarjeta);
  return `${SITIO}/og/${id}.png`;
}

// Recorta en un espacio para que el texto no termine a media palabra; satori
// agrega los puntos suspensivos al cortar líneas, pero no limita la longitud.
function recortar(texto, max) {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max).replace(/\s+\S*$/, "");
  return `${corte}…`;
}

// Un título largo se achica en vez de cortarse.
const tamañoTitulo = (n) => (n <= 40 ? 72 : n <= 70 ? 62 : n <= 110 ? 52 : 44);

const MARGEN = 84;
const INTERIOR = ANCHO - 2 * MARGEN;

const nodo = (type, style, children) => ({ type, props: { style, children } });

function arbol({ etiqueta = "", titulo, detalle = "", sitio = "constitucion.app" }) {
  const t = recortar(titulo, 160);
  const tamaño = tamañoTitulo(t.length);
  return nodo(
    "div",
    { width: ANCHO, height: ALTO, display: "flex", background: COLOR.fondo, color: COLOR.texto, fontFamily: "Inter" },
    [
      nodo(
        "div",
        // Sin padding en la raíz: satori lo suma al ancho en lugar de restarlo.
        { position: "absolute", left: MARGEN, top: 72, width: INTERIOR, height: ALTO - 72 - 60, display: "flex", flexDirection: "column" },
        [
      nodo("div", { display: "flex", alignItems: "center", fontSize: 30, fontWeight: 600, letterSpacing: "-0.01em" }, [
        nodo("div", { width: 26, height: 26, background: COLOR.texto, marginRight: 16 }, []),
        "OpenCodice",
      ]),
      nodo("div", { display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 0, justifyContent: "center", width: INTERIOR }, [
        etiqueta
          ? nodo("div", { display: "flex", fontSize: 28, fontWeight: 500, color: COLOR.tenue, marginBottom: 18 }, recortar(etiqueta, 70))
          : "",
        nodo(
          "div",
          {
            display: "block",
            width: INTERIOR,
            fontSize: tamaño,
            fontWeight: 600,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            textWrap: "balance",
            lineClamp: 3,
          },
          t,
        ),
        detalle
          ? nodo(
              "div",
              { display: "block", width: INTERIOR, marginTop: 26, fontSize: 28, lineHeight: 1.4, color: COLOR.tenue, lineClamp: tamaño > 52 ? 3 : 2 },
              recortar(detalle, 240),
            )
          : "",
      ].filter(Boolean)),
      nodo(
        "div",
        {
          display: "flex",
          width: INTERIOR,
          flexShrink: 0,
          justifyContent: "space-between",
          paddingTop: 22,
          borderTop: `1px solid ${COLOR.linea}`,
          fontSize: 24,
          color: COLOR.tenue,
        },
        [nodo("div", { display: "flex" }, sitio), nodo("div", { display: "flex" }, "La ley mexicana, versionada en git")],
      ),
        ],
      ),
    ],
  );
}

let fuentes;
async function cargarFuentes() {
  if (fuentes) return fuentes;
  const requerir = createRequire(import.meta.url);
  const archivo = (peso) => requerir.resolve(`@fontsource/inter/files/inter-latin-${peso}-normal.woff`);
  fuentes = await Promise.all(
    [400, 500, 600].map(async (weight) => ({ name: "Inter", weight, style: "normal", data: await readFile(archivo(weight)) })),
  );
  return fuentes;
}

export async function dibujar(tarjeta) {
  const [{ default: satori }, { Resvg }] = await Promise.all([import("satori"), import("@resvg/resvg-js")]);
  const svg = await satori(arbol(tarjeta), { width: ANCHO, height: ALTO, fonts: await cargarFuentes() });
  return new Resvg(svg, { fitTo: { mode: "width", value: ANCHO } }).render().asPng();
}

// Escribe en `destino` las tarjetas registradas, tomando del caché las que ya
// se dibujaron; el caché se queda solo con las que siguen en uso.
export async function escribirTarjetas(destino, cache) {
  await rm(destino, { recursive: true, force: true });
  await mkdir(destino, { recursive: true });
  await mkdir(cache, { recursive: true });
  const previas = new Set(await readdir(cache));
  let nuevas = 0;
  for (const [id, tarjeta] of registradas) {
    const archivo = `${id}.png`;
    if (!previas.has(archivo)) {
      await writeFile(join(cache, archivo), await dibujar(tarjeta));
      nuevas++;
    }
    await copyFile(join(cache, archivo), join(destino, archivo));
  }
  for (const archivo of previas) if (!registradas.has(archivo.replace(/\.png$/, ""))) await rm(join(cache, archivo));
  return { total: registradas.size, nuevas };
}
