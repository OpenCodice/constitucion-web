// El índice de la búsqueda literal de /api/buscar y del MCP: qué unidades
// (artículos de cada ley, iniciativas, proposiciones, dictámenes, decretos y
// votaciones) contienen cada palabra. Se genera al desplegar y el Worker solo
// lo lee: la búsqueda es por palabras exactas (sin acentos ni mayúsculas),
// nunca semántica.
//
// - `buscar/meta.json`: las colecciones, cada una con el rango de ids de sus
//   unidades, y las palabras que no se indexan por comunes.
// - `buscar/{xx}.json`: palabra → ids, repartidas en PARTES archivos.
// - `congreso/_/{tipo}/{n}.json`: las fichas de los asuntos, de POR_TROZO en
//   POR_TROZO (los artículos ya están en `ley/_/`).

import { palabras, parteDe, codificar } from "../../worker/texto.js";

// Una palabra que está en más de esta parte de las unidades no distingue
// nada («artículo», «de», «ley»): no se indexa y la búsqueda la ignora.
// En un corpus chico (las pruebas) ninguna palabra es común: hace falta
// además que esté en al menos MIN_COMUN unidades.
const MAX_FRECUENCIA = 0.04;
const MIN_COMUN = 1000;
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
      for (const p of new Set(palabras(u.buscar))) {
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
  const limite = Math.max(siguiente * MAX_FRECUENCIA, MIN_COMUN);
  const vacias = [];
  const partes = new Map();
  for (const [p, xs] of ids) {
    if (xs.length > limite) {
      vacias.push(p);
      continue;
    }
    const k = parteDe(p);
    if (!partes.has(k)) partes.set(k, {});
    partes.get(k)[p] = codificar(xs);
  }
  for (const [k, contenido] of partes) archivos.set(`buscar/${k}.json`, JSON.stringify(contenido));
  archivos.set("buscar/meta.json", JSON.stringify({ unidades: siguiente, vacias: vacias.sort(), colecciones: meta }));
  return { archivos, palabras: ids.size, vacias: vacias.length };
}
