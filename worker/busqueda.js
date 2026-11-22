// Búsqueda literal en todo lo publicado: los artículos de cada ley y los
// asuntos del Congreso (iniciativas, proposiciones, dictámenes, decretos y
// votaciones). Una unidad coincide si tiene todas las palabras, sin acentos ni
// mayúsculas. No hay sinónimos ni interpretación: quien pregunta (un agente)
// elige las palabras que usaría la ley.
//
// Lee el índice de `scripts/lib/busqueda.mjs`: palabra → ids de unidad, y de
// cada colección su rango de ids.

import { palabras, parteDe, decodificar } from "./texto.js";
import { SITIO, ErrorDatos, json, minimoDe, paginar, pieDePagina } from "./datos.js";
import { articuloPorPosicion, urlArticulo } from "./ley.js";

const POR_TROZO = 400;
const LEYES_CON_EJEMPLOS = 8;

const meta = (env) => json(env, "buscar/meta.json");

function interseccion(listas) {
  const [primera, ...resto] = [...listas].sort((a, b) => a.length - b.length);
  const conjuntos = resto.map((l) => new Set(l));
  return primera.filter((id) => conjuntos.every((s) => s.has(id)));
}

// La colección de un id, por búsqueda binaria sobre los inicios.
function coleccionDe(cols, id) {
  let a = 0;
  let b = cols.length - 1;
  while (a < b) {
    const m = (a + b + 1) >> 1;
    if (cols[m].inicio <= id) a = m;
    else b = m - 1;
  }
  return cols[a];
}

function fragmento(texto, ps) {
  const t = texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Sin acentos la longitud se conserva (el texto está en NFC), así que la
  // posición vale en el original.
  const original = t.length === texto.length ? texto : t;
  const i = ps.map((p) => t.indexOf(p)).filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0;
  const ini = Math.max(0, i - 140);
  const fin = Math.min(t.length, i + 220);
  return `${ini ? "…" : ""}${original.slice(ini, fin).replace(/\s+/g, " ").trim()}${fin < t.length ? "…" : ""}`;
}

const TIPOS = {
  ley: "Artículos de leyes",
  iniciativa: "Iniciativas",
  proposicion: "Proposiciones con punto de acuerdo",
  dictamen: "Dictámenes negativos",
  decreto: "Decretos del DOF",
  votacion: "Votaciones",
};
export const TIPOS_BUSQUEDA = Object.keys(TIPOS);

export async function asuntoDe(env, col, pos) {
  const trozo = await json(env, `${col.coleccion.replace(/^congreso\//, "congreso/_/")}/${Math.floor(pos / POR_TROZO)}.json`);
  return trozo?.[pos % POR_TROZO] ?? null;
}

// Los ids de las unidades que tienen todas las palabras, y qué se hizo con
// cada palabra.
async function unidadesCon(env, m, texto) {
  const vacias = new Set(m.vacias);
  const todas = [...new Set(palabras(texto))];
  const ignoradas = todas.filter((p) => vacias.has(p));
  const usadas = todas.filter((p) => !vacias.has(p));
  if (!usadas.length) {
    throw new ErrorDatos(
      todas.length
        ? `Las palabras «${ignoradas.join(" ")}» son demasiado comunes para buscarlas solas; agrega una más específica.`
        : "Falta el texto a buscar.",
    );
  }
  const partes = await Promise.all([...new Set(usadas.map(parteDe))].map(async (k) => [k, (await json(env, `buscar/${k}.json`)) ?? {}]));
  const porParte = new Map(partes);
  const listas = usadas.map((p) => {
    const c = porParte.get(parteDe(p))[p];
    return c ? decodificar(c) : [];
  });
  const sinNada = usadas.filter((_, i) => !listas[i].length);
  return { ids: sinNada.length ? [] : interseccion(listas), usadas, ignoradas, sinNada };
}

// Las posiciones, dentro de una colección, de las unidades con todas las palabras.
export async function posicionesCon(env, coleccion, texto) {
  const m = await meta(env);
  const col = m?.colecciones.find((c) => c.coleccion === coleccion);
  if (!col) throw new ErrorDatos("El índice de búsqueda no está disponible en este despliegue.");
  const r = await unidadesCon(env, m, texto);
  return { ...r, col, posiciones: r.ids.filter((id) => id >= col.inicio && id < col.inicio + col.n).map((id) => id - col.inicio) };
}

export const coleccionDeTipo = async (env, coleccion) => (await meta(env))?.colecciones.find((c) => c.coleccion === coleccion) ?? null;

// { texto, tipos?, documento?, ambito?, limite?, pagina? } → resultado agrupado.
export async function buscar(env, { texto, tipos, documento, ambito, limite = 10, pagina } = {}) {
  const m = await meta(env);
  if (!m) throw new ErrorDatos("El índice de búsqueda no está disponible en este despliegue.");
  const { ids, usadas, ignoradas, sinNada } = await unidadesCon(env, m, texto);

  const tiposPedidos = new Set((tipos?.length ? tipos : TIPOS_BUSQUEDA).filter((t) => TIPOS[t]));
  const cols = m.colecciones;
  const grupos = new Map();
  for (const id of ids) {
    const col = coleccionDe(cols, id);
    if (!tiposPedidos.has(col.tipo)) continue;
    if (documento && col.coleccion !== documento) continue;
    if (ambito && col.tipo === "ley" && col.ambito !== ambito) continue;
    if (!grupos.has(col)) grupos.set(col, []);
    grupos.get(col).push(id - col.inicio);
  }

  const leyes = [...grupos].filter(([c]) => c.tipo === "ley").sort((a, b) => b[1].length - a[1].length);
  const congreso = [...grupos].filter(([c]) => c.tipo !== "ley");
  // `pagina` avanza en los artículos de un documento y en los asuntos de cada tipo.
  const pag = (xs) => paginar(xs, { limite, pagina }, 10, 50);

  const resultadoLeyes = await Promise.all(
    leyes.map(async ([col, pos], i) => {
      const r = { documento: col.coleccion, nombre: col.nombre, ambito: col.ambito, coincidencias: pos.length, url: `${SITIO}/ley/${col.coleccion}`, articulos: [] };
      const ejemplos = documento ? pag(pos).elementos : i < LEYES_CON_EJEMPLOS ? pos.slice(0, 3) : [];
      if (ejemplos.length) {
        const minimo = await minimoDe(env, col.coleccion);
        for (const p of ejemplos) {
          const a = await articuloPorPosicion(env, minimo, p);
          if (a) r.articulos.push({ clave: a.clave, etiqueta: a.etiqueta, url: urlArticulo(col.coleccion, a.clave), fragmento: fragmento(a.texto, usadas) });
        }
      }
      return r;
    }),
  );
  const resultadoCongreso = await Promise.all(
    congreso.map(async ([col, pos]) => ({
      tipo: col.tipo,
      nombre: TIPOS[col.tipo],
      coincidencias: pos.length,
      ejemplos: (await Promise.all(pag(pos).elementos.map((p) => asuntoDe(env, col, p)))).filter(Boolean),
    })),
  );
  const mayor = Math.max(0, ...(documento ? leyes : congreso).map(([, pos]) => pos.length));
  return {
    consulta: texto,
    palabras: usadas,
    ignoradas,
    sin_resultados_para: sinNada,
    pagina: pag([]).pagina,
    paginas: pag(new Array(mayor)).paginas,
    leyes: resultadoLeyes.slice(0, documento ? 1 : 40),
    documentos_con_coincidencias: resultadoLeyes.length,
    articulos_con_coincidencias: resultadoLeyes.reduce((s, x) => s + x.coincidencias, 0),
    congreso: resultadoCongreso,
  };
}

export const lineaAsunto = (tipo, a) => {
  if (tipo === "votacion") {
    return `- ${a.fecha ?? ""} · ${a.camara ?? ""}: ${a.asunto ?? a.resultado} · ${a.a_favor} a favor, ${a.en_contra} en contra, ${a.abstenciones} abstenciones · ${a.url}`;
  }
  if (tipo === "decreto") return `- ${a.fecha ?? ""} · ${a.titulo} · ${a.url}`;
  const quien = (a.autores ?? []).slice(0, 3).map((x) => `${x.nombre}${x.grupo ? ` (${x.grupo})` : ""}`).join(", ");
  return `- ${a.fecha ?? ""} · \`${a.id}\` · ${a.titulo}${quien ? ` · ${quien}${(a.autores?.length ?? 0) > 3 ? " y otros" : ""}` : ""}${a.estatus ? ` · ${a.estatus}` : ""}${a.expediente ? ` · ${a.expediente}` : a.sil ? ` · ${a.sil}` : ""}`;
};

export function mdBusqueda(r) {
  const partes = [`# Búsqueda: «${r.consulta}»`];
  const notas = [];
  if (r.ignoradas.length) notas.push(`Se ignoraron por comunes: ${r.ignoradas.join(", ")}.`);
  if (r.sin_resultados_para.length) notas.push(`Ninguna unidad contiene: ${r.sin_resultados_para.join(", ")}.`);
  notas.push("Búsqueda literal: unidades con todas las palabras (sin acentos ni mayúsculas). Prueba también con sinónimos y con las palabras que usaría la ley.");
  partes.push(notas.join(" "));
  if (r.leyes.length) {
    const lineas = r.leyes.map((l) => {
      const arts = l.articulos.map((a) => `  - [${a.etiqueta}](${a.url}): ${a.fragmento}`).join("\n");
      return `- **${l.nombre}** (\`${l.documento}\`): ${l.coincidencias === 1 ? "1 artículo" : `${l.coincidencias} artículos`}${arts ? `\n${arts}` : ""}`;
    });
    partes.push(`## Leyes: ${r.articulos_con_coincidencias} artículos en ${r.documentos_con_coincidencias} documentos\n\n${lineas.join("\n")}${r.documentos_con_coincidencias > r.leyes.length ? `\n\n(y ${r.documentos_con_coincidencias - r.leyes.length} documentos más)` : ""}`);
  }
  for (const g of r.congreso) {
    partes.push(`## ${g.nombre}: ${g.coincidencias}\n\n${g.ejemplos.map((a) => lineaAsunto(g.tipo, a)).join("\n")}${g.coincidencias > g.ejemplos.length ? `\n\n(se muestran ${g.ejemplos.length}, de la más reciente a la más antigua)` : ""}`);
  }
  if (r.paginas > 1) partes.push(pieDePagina(r).trim());
  if (!r.leyes.length && !r.congreso.length) partes.push("Sin resultados.");
  return `${partes.join("\n\n")}\n`;
}
