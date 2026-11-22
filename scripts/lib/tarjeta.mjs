// La imagen que muestran las redes y los mensajeros al compartir una página
// (og:image): 1200×630, con el mismo estilo del sitio, blanco y negro.
//
// Cada página registra su tarjeta al generarse (`registrar`) y recibe su URL,
// que sale de un hash del contenido: las páginas con la misma tarjeta
// comparten la imagen y un despliegue solo dibuja las que no estén ya en el
// caché (`.tarjetas/`, que el workflow conserva entre corridas).
//
// La tarjeta es un SVG que resvg convierte en PNG. resvg no parte el texto en
// líneas, así que aquí se mide cada línea con los anchos de la propia fuente.

import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

export const SITIO = "https://constitucion.app";
export const ANCHO = 1200;
export const ALTO = 630;

// Cambia con el diseño para que el caché no sirva tarjetas viejas.
const VERSION = 3;

const COLOR = { fondo: "#ffffff", texto: "#111111", tenue: "#6b6b6b", linea: "#e4e4e4" };
const MARGEN = 84;
const INTERIOR = ANCHO - 2 * MARGEN;
const PESOS = [400, 500, 600];

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

// ------------------------------------------------------------------ fuente

// @fontsource publica Inter en WOFF y resvg solo lee TTF/OTF. Un WOFF 1.0 es
// el mismo sfnt con cada tabla comprimida aparte con zlib: se descomprime
// tabla por tabla y se rearma el directorio.
function woffASfnt(woff) {
  const n = woff.readUInt16BE(12);
  const tablas = [];
  for (let i = 0; i < n; i++) {
    const e = 44 + i * 20;
    const [offset, comprimida, original] = [woff.readUInt32BE(e + 4), woff.readUInt32BE(e + 8), woff.readUInt32BE(e + 12)];
    const datos = woff.subarray(offset, offset + comprimida);
    tablas.push({
      etiqueta: woff.subarray(e, e + 4),
      suma: woff.readUInt32BE(e + 16),
      datos: comprimida < original ? inflateSync(datos) : datos,
    });
  }
  const potencia = 2 ** Math.floor(Math.log2(n));
  const cabeza = Buffer.alloc(12 + 16 * n);
  woff.copy(cabeza, 0, 4, 8);
  cabeza.writeUInt16BE(n, 4);
  cabeza.writeUInt16BE(potencia * 16, 6);
  cabeza.writeUInt16BE(Math.log2(potencia), 8);
  cabeza.writeUInt16BE(n * 16 - potencia * 16, 10);
  const partes = [cabeza];
  let offset = cabeza.length;
  tablas.forEach((t, i) => {
    const e = 12 + i * 16;
    t.etiqueta.copy(cabeza, e);
    cabeza.writeUInt32BE(t.suma, e + 4);
    cabeza.writeUInt32BE(offset, e + 8);
    cabeza.writeUInt32BE(t.datos.length, e + 12);
    const relleno = (4 - (t.datos.length % 4)) % 4;
    partes.push(t.datos, Buffer.alloc(relleno));
    offset += t.datos.length + relleno;
  });
  return Buffer.concat(partes);
}

// Lo que hace falta para medir texto: unidades por em, ascendente y
// descendente (para colocar la línea base como lo hace CSS) y el avance de
// cada carácter, de las tablas head, hhea, hmtx y cmap (formato 4); y el
// nombre de la familia (tabla name), porque @fontsource publica cada peso
// como una familia aparte («Inter SemiBold») y resvg las busca así. Sin el
// kerning, que casi siempre acerca las letras: la medida queda un poco más
// ancha que el texto dibujado, nunca más angosta.
function metricas(sfnt) {
  const tablas = {};
  for (let i = 0; i < sfnt.readUInt16BE(4); i++) {
    const e = 12 + i * 16;
    tablas[sfnt.toString("latin1", e, e + 4)] = sfnt.readUInt32BE(e + 8);
  }
  const em = sfnt.readUInt16BE(tablas.head + 18);
  const hhea = tablas.hhea;
  const avances = [];
  for (let i = 0; i < sfnt.readUInt16BE(hhea + 34); i++) avances.push(sfnt.readUInt16BE(tablas.hmtx + i * 4));
  const glifos = new Map();
  const cmap = tablas.cmap;
  for (let i = 0; i < sfnt.readUInt16BE(cmap + 2); i++) {
    const sub = cmap + sfnt.readUInt32BE(cmap + 8 + i * 8);
    if (sfnt.readUInt16BE(sub) !== 4) continue;
    const segmentos = sfnt.readUInt16BE(sub + 6) / 2;
    const fin = sub + 14;
    const inicio = fin + segmentos * 2 + 2;
    const delta = inicio + segmentos * 2;
    const rango = delta + segmentos * 2;
    for (let s = 0; s < segmentos; s++) {
      const [a, b] = [sfnt.readUInt16BE(inicio + s * 2), sfnt.readUInt16BE(fin + s * 2)];
      const d = sfnt.readInt16BE(delta + s * 2);
      const r = sfnt.readUInt16BE(rango + s * 2);
      for (let c = a; c <= b && c !== 0xffff; c++) {
        const g = r ? sfnt.readUInt16BE(rango + s * 2 + r + (c - a) * 2) : c;
        if (g) glifos.set(c, (g + d) & 0xffff);
      }
    }
    break;
  }
  const avance = (g) => avances[Math.min(g, avances.length - 1)];
  const nombres = tablas.name;
  const cadenas = nombres + sfnt.readUInt16BE(nombres + 4);
  let familia;
  for (let i = 0; i < sfnt.readUInt16BE(nombres + 2) && !familia; i++) {
    const e = nombres + 6 + i * 12;
    if (sfnt.readUInt16BE(e) !== 3 || sfnt.readUInt16BE(e + 6) !== 1) continue;
    const inicio = cadenas + sfnt.readUInt16BE(e + 10);
    familia = Buffer.from(sfnt.subarray(inicio, inicio + sfnt.readUInt16BE(e + 8))).swap16().toString("utf16le");
  }
  return {
    familia,
    ascendente: sfnt.readInt16BE(hhea + 4) / em,
    descendente: -sfnt.readInt16BE(hhea + 6) / em,
    ancho: (c) => avance(glifos.get(c.codePointAt(0)) ?? 0) / em,
  };
}

let fuente;
async function cargarFuente() {
  if (fuente) return fuente;
  const requerir = createRequire(import.meta.url);
  const dir = await mkdtemp(join(tmpdir(), "tarjetas-"));
  const archivos = [];
  const medidas = {};
  for (const peso of PESOS) {
    const sfnt = woffASfnt(await readFile(requerir.resolve(`@fontsource/inter/files/inter-latin-${peso}-normal.woff`)));
    const archivo = join(dir, `inter-${peso}.ttf`);
    await writeFile(archivo, sfnt);
    archivos.push(archivo);
    medidas[peso] = metricas(sfnt);
  }
  fuente = { archivos, medidas };
  return fuente;
}

// ------------------------------------------------------------------ texto

const limpiar = (texto) => String(texto ?? "").replace(/\s+/g, " ").trim();

function medidor(m, tamaño, espaciado = 0) {
  return (texto) => [...texto].reduce((s, c) => s + m.ancho(c) * tamaño + espaciado, 0);
}

// Parte en líneas que quepan en `ancho`; una palabra que no cabe sola se
// corta por caracteres.
function partir(texto, ancho, medir) {
  const lineas = [];
  let actual = "";
  for (const palabra of texto.split(" ")) {
    const junta = actual ? `${actual} ${palabra}` : palabra;
    if (medir(junta) <= ancho) {
      actual = junta;
      continue;
    }
    if (actual) lineas.push(actual);
    actual = palabra;
    while (medir(actual) > ancho) {
      let i = actual.length - 1;
      while (i > 1 && medir(actual.slice(0, i)) > ancho) i--;
      lineas.push(actual.slice(0, i));
      actual = actual.slice(i);
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

// Como `text-wrap: balance`: el ancho más angosto que no agrega líneas, para
// que la última no quede con una palabra sola.
function equilibrar(texto, ancho, medir) {
  const n = partir(texto, ancho, medir).length;
  if (n < 2) return partir(texto, ancho, medir);
  let [bajo, alto] = [ancho / n, ancho];
  while (alto - bajo > 2) {
    const medio = (bajo + alto) / 2;
    if (partir(texto, medio, medir).length > n) bajo = medio;
    else alto = medio;
  }
  return partir(texto, alto, medir);
}

// A lo más `max` líneas; si sobra texto, la última se recorta por palabras y
// termina en «…».
function limitar(lineas, max, ancho, medir) {
  if (lineas.length <= max) return lineas;
  const fuera = lineas.slice(0, max);
  let ultima = fuera[max - 1].split(" ");
  while (ultima.length > 1 && medir(`${ultima.join(" ")}…`) > ancho) ultima = ultima.slice(0, -1);
  fuera[max - 1] = `${ultima.join(" ").replace(/[\s,;:.·—-]+$/, "")}…`;
  return fuera;
}

// Un título largo se achica antes de cortarse.
const tamañoTitulo = (n) => (n <= 40 ? 72 : n <= 70 ? 62 : n <= 110 ? 52 : 44);

const xml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Un bloque de texto con su caja de línea, como en CSS: la línea base queda a
// la mitad del interlineado más el ascendente.
function bloque({ lineas, tamaño, interlinea, color, m, espaciado = 0 }) {
  const alto = tamaño * interlinea;
  const base = (alto - (m.ascendente + m.descendente) * tamaño) / 2 + m.ascendente * tamaño;
  return {
    alto: alto * lineas.length,
    svg: (y) =>
      lineas
        .map(
          (l, i) =>
            `<text x="${MARGEN}" y="${(y + i * alto + base).toFixed(1)}" font-family="${m.familia}" font-size="${tamaño}" fill="${color}"${
              espaciado ? ` letter-spacing="${espaciado}"` : ""
            }>${xml(l)}</text>`,
        )
        .join(""),
  };
}

export function svgTarjeta({ etiqueta = "", titulo, detalle = "", sitio = "constitucion.app" }, { medidas }) {
  const familia = (peso) => medidas[peso].familia;
  const t = limpiar(titulo);
  const tamaño = tamañoTitulo(t.length);
  const espaciado = -0.02 * tamaño;
  const medirTitulo = medidor(medidas[600], tamaño, espaciado);
  const partes = [];
  if (etiqueta) {
    const medir = medidor(medidas[500], 28);
    partes.push({
      ...bloque({ lineas: limitar(partir(limpiar(etiqueta), INTERIOR, medir), 1, INTERIOR, medir), tamaño: 28, interlinea: 1.2, color: COLOR.tenue, m: medidas[500] }),
      despues: 18,
    });
  }
  partes.push({
    ...bloque({
      lineas: limitar(equilibrar(t, INTERIOR, medirTitulo), 3, INTERIOR, medirTitulo),
      tamaño,
      interlinea: 1.15,
      color: COLOR.texto,
      m: medidas[600],
      espaciado,
    }),
    despues: 26,
  });

  // Entre la marca y la línea del pie, con aire arriba y abajo. El detalle
  // toma las líneas que dejen libres la etiqueta y el título, a lo más tres.
  const [arriba, abajo, aire] = [108, 518, 20];
  const usado = partes.reduce((s, p) => s + p.alto + p.despues, 0);
  const lineaDetalle = 28 * 1.4;
  const caben = Math.min(3, Math.floor((abajo - arriba - 2 * aire - usado) / lineaDetalle));
  if (detalle && caben > 0) {
    const medir = medidor(medidas[400], 28);
    partes.push({
      ...bloque({ lineas: limitar(partir(limpiar(detalle), INTERIOR, medir), caben, INTERIOR, medir), tamaño: 28, interlinea: 1.4, color: COLOR.tenue, m: medidas[400] }),
      despues: 0,
    });
  }
  partes.at(-1).despues = 0;

  const total = partes.reduce((s, p) => s + p.alto + p.despues, 0);
  let y = arriba + (abajo - arriba - total) / 2;
  const cuerpo = partes
    .map((p) => {
      const svg = p.svg(y);
      y += p.alto + p.despues;
      return svg;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="0 0 ${ANCHO} ${ALTO}" font-family="${familia(400)}">
<rect width="${ANCHO}" height="${ALTO}" fill="${COLOR.fondo}"/>
<rect x="${MARGEN}" y="77" width="26" height="26" fill="${COLOR.texto}"/>
<text x="${MARGEN + 42}" y="101" font-family="${familia(600)}" font-size="30" letter-spacing="-0.3" fill="${COLOR.texto}">OpenCodice</text>
${cuerpo}
<rect x="${MARGEN}" y="${abajo}" width="${INTERIOR}" height="1" fill="${COLOR.linea}"/>
<text x="${MARGEN}" y="564" font-size="24" fill="${COLOR.tenue}">${xml(sitio)}</text>
<text x="${ANCHO - MARGEN}" y="564" font-size="24" fill="${COLOR.tenue}" text-anchor="end">Información oficial de las leyes y del Congreso de México</text>
</svg>`;
}

export async function dibujar(tarjeta) {
  const [{ Resvg }, f] = await Promise.all([import("@resvg/resvg-js"), cargarFuente()]);
  const opciones = { font: { loadSystemFonts: false, fontFiles: f.archivos, defaultFontFamily: f.medidas[400].familia } };
  return new Resvg(svgTarjeta(tarjeta, f), opciones).render().asPng();
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
