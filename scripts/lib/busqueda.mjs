// El índice de la búsqueda literal de /api/buscar y del MCP: qué unidades
// (artículos de cada ley, iniciativas, proposiciones, dictámenes, decretos y
// votaciones) contienen cada palabra. Se genera al desplegar y el Worker solo
// lo lee: la búsqueda es por palabras exactas (sin acentos ni mayúsculas),
// nunca semántica.
//
// - `buscar/meta.json`: las colecciones, cada una con el rango de ids de sus
//   unidades, y las palabras que van en su propio archivo.
// - `buscar/{xx}.json`: palabra → ids, repartidas en PARTES archivos;
//   `buscar/g/{palabra}.json`, la lista de una palabra muy frecuente.
//   Las palabras entran por su raíz (`raiz` de texto.js: singular y plural
//   cuentan igual) y las vacías de la lista fija `VACIAS` no entran.
// - `congreso/_/{tipo}/{n}.json`: las fichas de los asuntos, de POR_TROZO en
//   POR_TROZO (los artículos ya están en `ley/_/`).

import { terminos, parteDe, codificar, VACIAS } from "../../worker/texto.js";

// Una palabra que está en más unidades que estas va en su propio archivo
// (`buscar/g/{palabra}.json`): así los 256 archivos compartidos siguen chicos
// y su lista solo se lee cuando alguien la busca.
const MAX_COMPARTIDA = 1500;
export const POR_TROZO = 400;

// colecciones: [{ coleccion, tipo, nombre, ambito?, unidades: [{ buscar }] }]
export function indiceBusqueda(colecciones) {
  const archivos = new Map();
  const ids = new Map();
  const meta = [];
  let siguiente = 0;
  for (const c of colecciones) {
    const fechas = c.tipo === "ley" ? [] : c.unidades.map((u) => u.fecha).filter(Boolean).sort();
    const periodo = fechas.length ? { desde: fechas[0], hasta: fechas.at(-1) } : undefined;
    meta.push({ coleccion: c.coleccion, tipo: c.tipo, nombre: c.nombre, ambito: c.ambito, periodo, inicio: siguiente, n: c.unidades.length });
    for (const u of c.unidades) {
      const id = siguiente++;
      for (const p of new Set(terminos(u.buscar))) {
        if (VACIAS.has(p)) continue;
        if (!ids.has(p)) ids.set(p, []);
        ids.get(p).push(id);
      }
    }
    if (c.tipo !== "ley") {
      for (let i = 0; i < c.unidades.length; i += POR_TROZO) {
        const trozo = c.unidades.slice(i, i + POR_TROZO).map(({ buscar, ...u }) => u);
        archivos.set(`${c.coleccion.replace(/^congreso\//, "congreso/_/")}/${i / POR_TROZO}.json`, JSON.stringify(trozo));
      }
    }
  }
  const grandes = [];
  const partes = new Map();
  for (const [p, xs] of ids) {
    if (xs.length > MAX_COMPARTIDA) {
      grandes.push(p);
      archivos.set(`buscar/g/${p}.json`, JSON.stringify(codificar(xs)));
      continue;
    }
    const k = parteDe(p);
    if (!partes.has(k)) partes.set(k, {});
    partes.get(k)[p] = codificar(xs);
  }
  for (const [k, contenido] of partes) archivos.set(`buscar/${k}.json`, JSON.stringify(contenido));
  archivos.set("buscar/meta.json", JSON.stringify({ unidades: siguiente, grandes: grandes.sort(), colecciones: meta }));
  return { archivos, palabras: ids.size, grandes: grandes.length };
}
