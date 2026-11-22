// Lo que sirve el Worker a los agentes (/ley, /api, /mcp y las páginas en
// Markdown), sobre un despliegue sintético armado con las mismas funciones
// que escriben los archivos de verdad (`archivosDocumento`, `indiceBusqueda`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarClave, mapaClaves, resolverClave } from "../worker/claves.js";
import { palabras, codificar, decodificar } from "../worker/texto.js";
import worker, { prefiereMarkdown } from "../worker/index.js";
import { HERRAMIENTAS } from "../worker/herramientas.js";
import { diferenciaTexto } from "./lib/diferencias.mjs";
import { archivosDocumento, fichaCatalogo } from "./lib/corpus.mjs";
import { indiceBusqueda } from "./lib/busqueda.mjs";
import { modeloCongreso } from "./lib/congreso.mjs";
import { archivosVotos, buscadorDeLeyes, enLoGeneral, filtrosAsuntos, resumenVotaciones } from "./lib/abiertos.mjs";

const art = (n, cuerpo) => `# Artículo ${n}.\n\n${cuerpo}`;
const SHA_REFORMA = "a".repeat(40);
const SHA_ALTA = "b".repeat(40);
const cambios = (doc) => [
  { sha: SHA_REFORMA, tipo: "reforma", clase: "reforma", dia: "2026-11-15", publicacion: ["2026-10-07"], medio: "DOF", bitacora: `https://constitucion.app/bitacora/${doc}/aaaaaaaaaaaa` },
  { sha: SHA_ALTA, tipo: "alta", clase: "alta", dia: "2026-06-09", publicacion: ["2026-06-02"], medio: "DOF", bitacora: `https://constitucion.app/bitacora/${doc}/bbbbbbbbbbbb` },
];

function documento(clave, extra, textos) {
  return {
    clave,
    indice: {
      documento: clave,
      repo: "constitucion-mexicana",
      carpeta: "articulos/",
      fuente: "https://www.diputados.gob.mx/LeyesBiblio/pdf/CPEUM.pdf",
      ...extra,
      articulos: textos.map(([k, t], i) => ({
        clave: k,
        etiqueta: t.split("\n")[0].slice(2),
        ubicacion: i < 2 ? "Título Primero / Capítulo I" : "Título Segundo",
        url: `https://constitucion.app/ley/${clave}/${k}`,
        cambios: k === "004" ? [0, 1] : [1],
        reformas_segun_notas: k === "004" ? ["1974-12-31", "2019-06-06"] : [],
        texto: t,
      })),
      cambios: cambios(clave),
    },
  };
}

const CPEUM = documento("cpeum", { nombre: "Constitución Política de los Estados Unidos Mexicanos", sigla: "CPEUM", ambito: "constitucion", entidad: null }, [
  ["001", art("1o", "Toda persona gozará de los derechos humanos.")],
  ["004", art("4o", "La mujer y el hombre son iguales ante la ley.")],
  ["077-bis-35-a", art("77 Bis 35 A", "El salario mínimo se fijará anualmente.")],
]);
const JALISCO = documento("jalisco/constitucion", { nombre: "Constitución de Jalisco", sigla: "Jalisco", ambito: "constitucion-estatal", entidad: "Jalisco" }, [
  ["001", art("1", "El matrimonio es la unión de dos personas.")],
]);

const VOTACIONES = [
  {
    id: "sil-1-1", fecha: "2026-09-22", camara: "Cámara de Diputados", asunto: "Reforma constitucional en materia de nacionalidad", resultado: "Aprobado en lo general", en_lo_general: true,
    a_favor: 344, en_contra: 116, abstenciones: 1, ausentes: 38, sin_votar: 0, division: 0.252,
    por_grupo: [{ grupo: "Morena", a_favor: 240, en_contra: 0, abstenciones: 0, ausentes: 13 }, { grupo: "PAN", a_favor: 0, en_contra: 70, abstenciones: 0, ausentes: 2 }],
    votos_con_nombre: true, expediente: "https://constitucion.app/congreso/expedientes/sil-9", decreto: null,
    leyes: [{ documento: "cpeum", nombre: "Constitución Política de los Estados Unidos Mexicanos", url: "https://constitucion.app/ley/cpeum" }],
    url: "https://constitucion.app/congreso/votaciones/sil-1-1",
  },
  {
    id: "sil-1-2", fecha: "2026-09-22", camara: "Cámara de Diputados", asunto: "Reforma constitucional en materia de nacionalidad", resultado: "Aprobado en lo particular", en_lo_general: false,
    a_favor: 300, en_contra: 150, abstenciones: 0, ausentes: 49, sin_votar: 0, division: 0.333, por_grupo: [],
    votos_con_nombre: true, expediente: "https://constitucion.app/congreso/expedientes/sil-9", decreto: null, leyes: [], url: "https://constitucion.app/congreso/votaciones/sil-1-2",
  },
  {
    id: "sil-2-1", fecha: "2026-03-01", camara: "Cámara de Senadores", asunto: "Ley de aguas", resultado: "Aprobado", en_lo_general: true,
    a_favor: 120, en_contra: 0, abstenciones: 0, ausentes: 8, sin_votar: 0, division: 0, por_grupo: [], votos_con_nombre: false, expediente: null, decreto: null, leyes: [],
    url: "https://constitucion.app/congreso/votaciones/sil-2-1",
  },
];
const LEGISLADORES = [
  { id: "ana", nombre: "Ana Pérez", camara: "Cámara de Diputados", grupo: "Morena", entidad: "jalisco", en_funciones: true, estatus: "Activo(a)", votaciones: 300, a_favor: 100, en_contra: 0, abstenciones: 0, ausencias: 200, ausencia: 0.667, iniciativas: 2, iniciativas_aprobadas: 0, url: "https://constitucion.app/congreso/legisladores/ana" },
  { id: "beto", nombre: "Beto Ruiz", camara: "Cámara de Senadores", grupo: "Partido Acción Nacional", entidad: "queretaro", en_funciones: true, estatus: "Activo(a)", votaciones: 400, a_favor: 300, en_contra: 90, abstenciones: 0, ausencias: 10, ausencia: 0.025, iniciativas: 30, iniciativas_aprobadas: 1, url: "https://constitucion.app/congreso/legisladores/beto" },
  { id: "caro", nombre: "Caro Gil", camara: "Cámara de Diputados", grupo: "Morena", entidad: "puebla", en_funciones: false, estatus: "Baja(a)", votaciones: 5, a_favor: 0, en_contra: 0, abstenciones: 0, ausencias: 5, ausencia: 1, iniciativas: 0, iniciativas_aprobadas: 0, url: "https://constitucion.app/congreso/legisladores/caro" },
];
const INICIATIVA = { id: "sil-5", fecha: "2026-09-14", titulo: "En materia de matrimonio igualitario", autores: [{ nombre: "Alma Vega", grupo: "Morena" }], partido: "Morena", estatus: "Pendiente", resultado: "pendiente", leyes: [], buscar: "En materia de matrimonio igualitario" };
const INICIATIVAS = [
  { id: "sil-7", fecha: "2026-10-20", titulo: "Que reforma el artículo 30 de la Constitución, sobre la nacionalidad", autores: [{ nombre: "Beto Ruiz", id: "beto", grupo: "Partido Acción Nacional" }], partido: "PAN", estatus: "Desechada", resultado: "desechado", leyes: ["cpeum"], buscar: "Que reforma el artículo 30 de la Constitución, sobre la nacionalidad" },
  INICIATIVA,
  { id: "sil-3", fecha: "2026-02-01", titulo: "Que expide la Ley de aguas", autores: [{ nombre: "Beto Ruiz", id: "beto", grupo: "Partido Acción Nacional" }], partido: "PAN", estatus: "Pendiente", resultado: "pendiente", leyes: [], buscar: "Que expide la Ley de aguas" },
];
// El modelo de congreso-mexicano del que salen los votos con nombre de las
// dos primeras votaciones; la tercera no los publica.
const voto = (voter_id, option, grupo_fuente) => ({ voter_id, option, grupo_fuente });
const MODELO = modeloCongreso({
  organizaciones: [{ id: "camara-de-diputados", name: "Cámara de Diputados" }],
  personas: [{ id: "ana", name: "Ana Pérez" }, { id: "beto", name: "Beto Ruiz" }, { id: "caro", name: "Caro Gil" }],
  mandatos: [],
  expedientes: [],
  decretos: [],
  votaciones: [
    { id: "sil-1-1", organization_id: "camara-de-diputados", start_date: "2026-09-22", motion: { denominacion: "Que reforma el artículo 30 de la Constitución Política de los Estados Unidos Mexicanos", text: "Aprobado en lo general" }, counts: [{ option: "yes", value: 2 }, { option: "no", value: 1 }], votos_publicados: true,
      votes: [voto("ana", "yes", "Morena"), voto("beto", "no", "PAN"), voto("caro", "yes", "Morena")], votos_faltantes: [{ grupo: "PAN", option: "no", value: 1, nombres_fuente: ["Fulano"] }] },
    { id: "sil-1-2", organization_id: "camara-de-diputados", start_date: "2026-09-22", motion: { denominacion: "Reserva", text: "Aprobado en lo particular" }, counts: [], votos_publicados: true, votes: [voto("ana", "absent", "Morena"), voto("beto", "no", "PAN")] },
    { id: "sil-2-1", organization_id: "camara-de-diputados", start_date: "2026-03-01", motion: { denominacion: "Ley de aguas", text: "Aprobado" }, counts: [], votes: [] },
  ],
});

const ARCHIVOS = new Map();
for (const d of [CPEUM, JALISCO]) for (const [ruta, contenido] of archivosDocumento(d)) ARCHIVOS.set(`/${ruta}`, contenido);
const busqueda = indiceBusqueda([
  ...[CPEUM, JALISCO].map((d) => ({ coleccion: d.clave, tipo: "ley", nombre: d.indice.nombre, ambito: d.indice.ambito, unidades: d.indice.articulos.map((a) => ({ buscar: a.texto })) })),
  { coleccion: "congreso/iniciativa", tipo: "iniciativa", nombre: "Iniciativas", unidades: INICIATIVAS },
  { coleccion: "congreso/votacion", tipo: "votacion", nombre: "Votaciones", unidades: VOTACIONES.map((v) => ({ ...v, buscar: v.asunto })) },
]);
for (const archivos of [busqueda.archivos, archivosVotos(MODELO, VOTACIONES), filtrosAsuntos([{ coleccion: "congreso/iniciativa", tipo: "iniciativa", unidades: INICIATIVAS }])]) {
  for (const [ruta, contenido] of archivos) ARCHIVOS.set(`/${ruta}`, contenido);
}
for (const [ruta, contenido] of Object.entries({
  "/ley/catalogo.json": JSON.stringify({ documentos: [CPEUM, JALISCO].map(fichaCatalogo) }),
  "/congreso/votaciones.json": JSON.stringify({ nota: "nota", votaciones: VOTACIONES }),
  "/congreso/legisladores.json": JSON.stringify({ nota: "nota", legisladores: LEGISLADORES }),
  "/llms.txt": "# OpenCodice\n",
  "/index.html": "<!doctype html><title>Inicio</title>",
  "/bitacora/cpeum/aaaaaaaaaaaa.html": "<!doctype html><title>Reforma</title>",
  "/bitacora/cpeum/aaaaaaaaaaaa.md": "# Reforma del 7 de octubre de 2026\n\n## Proceso legislativo\n",
  "/bitacora/cambios.json": JSON.stringify({
    cambios: [
      { documento: "cpeum", nombre: "CPEUM", tipo: "reforma", menor: false, ajuste_inicial: false, sha: SHA_REFORMA, fecha: "2026-11-15T00:00:00Z", publicacion: ["2026-10-07"], medio: "DOF", articulos_adicionados: [], articulos_modificados: ["004"], articulos_derogados: [], articulos_corregidos: [], pagina: "https://constitucion.app/bitacora/cpeum/aaaaaaaaaaaa" },
      { documento: "cpeum", nombre: "CPEUM", tipo: "alta", menor: false, ajuste_inicial: false, sha: SHA_ALTA, fecha: "2026-06-09T00:00:00Z", publicacion: ["2026-06-02"], medio: "DOF", articulos_adicionados: [], articulos_modificados: [], articulos_derogados: [], articulos_corregidos: [], pagina: "https://constitucion.app/bitacora/cpeum/bbbbbbbbbbbb" },
    ],
  }),
})) ARCHIVOS.set(ruta, contenido);

const env = {
  ASSETS: {
    async fetch(req) {
      const ruta = decodeURIComponent(new URL(req.url ?? req).pathname);
      const cuerpo = ARCHIVOS.get(ruta) ?? ARCHIVOS.get(`${ruta}.html`) ?? ARCHIVOS.get(ruta === "/" ? "/index.html" : null);
      return cuerpo == null ? new Response("no", { status: 404 }) : new Response(cuerpo, { headers: { "Content-Type": "text/html" } });
    },
  },
};

const pedir = (ruta, init = {}) => worker.fetch(new Request(`https://constitucion.app${ruta}`, init), env);
const md = { headers: { Accept: "text/markdown" } };
const api = async (ruta) => (await pedir(`/api/${ruta}`)).json();

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

test("texto: palabras sin acentos y listas de ids comprimidas", () => {
  assert.deepEqual(palabras("Matrimonio IGUALITARIO, año 2026"), ["matrimonio", "igualitario", "ano", "2026"]);
  const ids = [3, 4, 40, 1000, 99999];
  assert.deepEqual(decodificar(codificar(ids)), ids);
});

test("corpus: el texto completo y el índice se sirven tal cual; el Worker usa los trozos", () => {
  const archivos = archivosDocumento(CPEUM);
  assert.match(archivos.get("ley/cpeum.md"), /^---\ndocumento: "cpeum"[\s\S]*---\n\n# Artículo 1o\.[\s\S]*fijará anualmente\.\n$/);
  const indice = JSON.parse(archivos.get("ley/cpeum.json"));
  assert.equal(indice.articulos.length, 3);
  assert.equal(indice.articulos[0].texto, undefined);
  const minimo = JSON.parse(archivos.get("ley/_/cpeum/i.json"));
  assert.deepEqual(minimo.claves, ["001", "004", "077-bis-35-a"]);
  assert.deepEqual(minimo.trozo, [0, 0, 0]);
});

test("/ley: un artículo, con su frontmatter y sin redirigir", async () => {
  const r = await pedir("/ley/CPEUM/4o", md);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Content-Type"), /text\/markdown/);
  assert.equal(r.headers.get("Link"), '<https://constitucion.app/ley/cpeum/004>; rel="canonical"');
  const t = await r.text();
  assert.match(t, /^---\ndocumento: "cpeum"/);
  assert.match(t, /version: "a{40}"/);
  assert.match(t, /permanente: "https:\/\/constitucion.app\/ley\/cpeum\/004@a{12}"/);
  assert.match(t, /---\n\n# Artículo 4o\.\n\nLa mujer y el hombre son iguales ante la ley\.\n$/);
  const h = await pedir("/ley/cpeum/1", { headers: { Accept: "text/html,*/*" } });
  assert.match(h.headers.get("Content-Type"), /text\/plain/);
});

test("/ley: índice, JSON, historia, versión, estados y lo que no existe", async () => {
  const i = await (await pedir("/ley/cpeum", md)).text();
  assert.match(i, /## Título Primero \/ Capítulo I\n\n- \[Artículo 1o\.\]\(https:\/\/constitucion.app\/ley\/cpeum\/001\)/);
  const j = await (await pedir("/ley/cpeum/77%20bis%2035%20a.json")).json();
  assert.equal(j.clave, "077-bis-35-a");
  assert.match(j.texto, /salario mínimo/);
  assert.match(await (await pedir("/ley/cpeum/4/historia", md)).text(), /# Artículo 4o: historia[\s\S]*2026-11-15 · Reforma \(DOF 2026-10-07\)/);
  const v = await pedir("/ley/cpeum/4@bbbbbbb");
  assert.equal(v.status, 302);
  assert.equal(v.headers.get("Location"), `https://raw.githubusercontent.com/OpenCodice/constitucion-mexicana/${SHA_ALTA}/articulos/004.md`);
  assert.equal((await pedir("/ley/cpeum/4@cccccccc")).status, 404);
  assert.match(await (await pedir("/ley/jalisco/constitucion/1", md)).text(), /documento: "jalisco\/constitucion"/);
  assert.match(await (await pedir("/ley/jalisco", md)).text(), /^# Leyes de Jalisco/);
  // Por sigla, el texto completo redirige al archivo estático.
  assert.equal((await pedir("/ley/CPEUM.md")).headers.get("Location"), "https://constitucion.app/ley/cpeum.md");
  const a = await pedir("/ley/cpeum/999", md);
  assert.equal(a.status, 404);
  assert.match(await a.text(), /no tiene un artículo `999`/);
  assert.equal((await pedir("/ley/nada", md)).status, 404);
});

test("reformas según las notas: las fechas de cada artículo en el índice y en su historia", async () => {
  const i = await (await pedir("/ley/cpeum", md)).text();
  assert.match(i, /## Artículos con más reformas según las notas de su texto\n\nArtículo 4o \(2\)\./);
  assert.match(i, /\[Artículo 4o\.\]\(https:\/\/constitucion.app\/ley\/cpeum\/004\) · 2 reformas según sus notas, la última 2019-06-06/);
  assert.deepEqual((await api("indice_documento?documento=cpeum")).articulos.map((a) => a.reformas_segun_notas.length), [0, 2, 0]);
  const h = await api("historia_articulo?documento=cpeum&articulo=4");
  assert.deepEqual(h.reformas_segun_notas, ["1974-12-31", "2019-06-06"]);
  assert.match(await (await pedir("/ley/cpeum/4/historia", md)).text(), /anotan 2 fechas de reforma: 1974-12-31, 2019-06-06/);
});

test("buscar: literal en leyes y Congreso, con palabras comunes ignoradas", async () => {
  const r = await api("buscar?texto=Matrimonio");
  assert.equal(r.articulos_con_coincidencias, 1);
  assert.equal(r.leyes[0].documento, "jalisco/constitucion");
  assert.match(r.leyes[0].articulos[0].fragmento, /El matrimonio es la unión/);
  assert.equal(r.congreso[0].tipo, "iniciativa");
  assert.equal(r.congreso[0].ejemplos[0].titulo, INICIATIVA.titulo);
  const solo = await api("buscar?texto=matrimonio&tipos=ley");
  assert.equal(solo.congreso.length, 0);
  const doc = await api("buscar?texto=salario%20minimo&documento=CPEUM");
  assert.deepEqual(doc.leyes.map((l) => l.articulos.map((a) => a.clave)), [["077-bis-35-a"]]);
  const nada = await api("buscar?texto=inexistente");
  assert.deepEqual(nada.sin_resultados_para, ["inexistente"]);
  assert.equal((await pedir("/api/buscar")).status, 400);
});

test("votaciones: las más divididas, agrupadas por asunto, y filtros", async () => {
  const r = await api("votaciones?orden=division");
  assert.deepEqual(r.votaciones.map((v) => [v.id, v.otras_del_asunto]), [["sil-1-2", 1], ["sil-2-1", 0]]);
  const sinAgrupar = await api("votaciones?orden=division&agrupar=false");
  assert.equal(sinAgrupar.total, 3);
  assert.deepEqual((await api("votaciones?en_lo_general=true&documento=cpeum")).votaciones.map((v) => v.id), ["sil-1-1"]);
  assert.deepEqual((await api("votaciones?grupo_en_contra=Partido%20Accion%20Nacional")).votaciones.map((v) => v.id), ["sil-1-1"]);
  assert.deepEqual((await api("votaciones?camara=senado")).votaciones.map((v) => v.id), ["sil-2-1"]);
  // La memoria del isolate no se modifica entre peticiones.
  assert.deepEqual((await api("votaciones?orden=division")).votaciones.map((v) => v.otras_del_asunto), [1, 0]);
});

test("legisladores: los más ausentes, en funciones por omisión, grupo por sigla", async () => {
  const r = await api("legisladores?orden=ausencia");
  assert.deepEqual(r.legisladores.map((l) => l.id), ["ana", "beto"]);
  assert.deepEqual(r.por_grupo, { Morena: 1, "Partido Acción Nacional": 1 });
  assert.deepEqual((await api("legisladores?grupo=PAN")).legisladores.map((l) => l.id), ["beto"]);
  assert.deepEqual((await api("legisladores?en_funciones=false&orden=ausencias&minimo_votaciones=0")).legisladores.map((l) => l.id), ["ana", "beto", "caro"]);
  assert.match(await (await pedir("/api/legisladores?orden=ausencia", md)).text(), /\*\*Ana Pérez\*\*[\s\S]*200 ausencias \(66\.7 %\)/);
});

test("detalle_cambio: la última reforma con su página en Markdown", async () => {
  const r = await api("detalle_cambio?documento=cpeum");
  assert.equal(r.sha, SHA_REFORMA);
  assert.match(r.markdown, /## Proceso legislativo/);
  const e = await pedir("/api/detalle_cambio?documento=jalisco/constitucion&cambio=cccccccc");
  assert.equal(e.status, 404);
});

test("leyes de un asunto: el nombre completo tras un verbo de reforma, y el más largo si se enciman", () => {
  const nombradas = buscadorDeLeyes(
    new Map([
      ["cpeum", "Constitución Política de los Estados Unidos Mexicanos"],
      ["lamp", "Ley de Amparo, Reglamentaria de los artículos 103 y 107 de la Constitución Política de los Estados Unidos Mexicanos"],
      ["lgs", "Ley General de Salud"],
      ["ladua", "Ley Aduanera"],
      ["jalisco/constitucion", "Constitución Política del Estado de Jalisco"],
    ]),
  );
  assert.deepEqual(nombradas("Que reforma el artículo 19 de la Constitución Política de los Estados Unidos Mexicanos, en materia de prisión preventiva."), ["cpeum"]);
  assert.deepEqual(nombradas("Que reforma la Ley de Amparo, Reglamentaria de los artículos 103 y 107 de la Constitución Política de los Estados Unidos Mexicanos, y la LEY ADUANERA."), ["lamp", "ladua"]);
  // Reglamentaria de un artículo: nombra a la Constitución sin reformarla.
  assert.deepEqual(nombradas("Que expide la Ley General de Aguas, Reglamentaria del artículo 4o. de la Constitución Política de los Estados Unidos Mexicanos."), []);
  // Sin verbo de reforma antes, es una mención.
  assert.deepEqual(nombradas("Renuncia para los efectos del artículo 98 de la Constitución Política de los Estados Unidos Mexicanos."), []);
  // El principio del nombre de otra ley.
  assert.deepEqual(nombradas("Que expide la Ley General de Salud Mental y reforma la Ley General de Salud."), ["lgs"]);
  const filas = resumenVotaciones(MODELO, new Map([["cpeum", "Constitución Política de los Estados Unidos Mexicanos"]]));
  assert.deepEqual(filas.find((v) => v.id === "sil-1-1").leyes, [{ documento: "cpeum", nombre: "Constitución Política de los Estados Unidos Mexicanos", url: "https://constitucion.app/ley/cpeum", origen: "asunto" }]);
});

test("votaciones: sin conteo por grupo de la fuente, se cuenta de los votos con nombre", () => {
  const m = modeloCongreso({
    organizaciones: [{ id: "camara-de-senadores", name: "Cámara de Senadores" }, { id: "partido-pan", name: "Partido Acción Nacional" }],
    personas: [], mandatos: [], expedientes: [], decretos: [],
    votaciones: [
      { id: "sil-9-1", organization_id: "camara-de-senadores", start_date: "2026-10-01", motion: { text: "Aprobado" }, counts: [], votos_publicados: true,
        votes: [{ voter_id: "a", option: "yes", group_id: "partido-pan", grupo_fuente: "PAN" }, { voter_id: "b", option: "no", group_id: "partido-pan", grupo_fuente: "PAN" }, { voter_id: "c", option: "absent", grupo_fuente: "SG" }],
        votos_faltantes: [{ grupo: "PAN", option: "no", value: 2 }] },
      { id: "sil-9-2", organization_id: "camara-de-senadores", start_date: "2026-10-01", motion: { text: "Aprobado" }, counts: [],
        group_results: [{ grupo: "PAN", yes: 1, no: 0, abstain: 0, absent: 0 }] },
      { id: "sil-9-3", organization_id: "camara-de-senadores", start_date: "2026-10-01", motion: { text: "Aprobado" }, counts: [], votes: [] },
    ],
  });
  const filas = new Map(resumenVotaciones(m).map((v) => [v.id, v]));
  assert.deepEqual(filas.get("sil-9-1").por_grupo, [
    { grupo: "Partido Acción Nacional", a_favor: 1, en_contra: 3, abstenciones: 0, ausentes: 0 },
    { grupo: "SG", a_favor: 0, en_contra: 0, abstenciones: 0, ausentes: 1 },
  ]);
  assert.equal(filas.get("sil-9-1").por_grupo_origen, "votos_con_nombre");
  assert.deepEqual([filas.get("sil-9-2").por_grupo[0].grupo, filas.get("sil-9-2").por_grupo_origen], ["PAN", "fuente"]);
  assert.deepEqual([filas.get("sil-9-3").por_grupo, filas.get("sil-9-3").por_grupo_origen], [[], null]);
});

test("en lo general: no lo es la votación de los artículos reservados", () => {
  assert.equal(enLoGeneral("Aprobado en lo general y en lo particular de los artículos no reservados"), true);
  assert.equal(enLoGeneral("Aprobado en lo general y en lo particular de los artículos reservados 8, 11 y 12"), false);
  assert.equal(enLoGeneral("Aprobado en lo particular"), false);
});

test("votaciones: por documento solo las de sus leyes, y por páginas", async () => {
  // «Reforma constitucional…» no es de la Constitución de Jalisco aunque el asunto se le parezca.
  assert.equal((await api("votaciones?documento=jalisco/constitucion")).total, 0);
  const p2 = await api("votaciones?agrupar=false&limite=2&pagina=2");
  assert.deepEqual([p2.total, p2.pagina, p2.paginas, p2.votaciones.map((v) => v.id)], [3, 2, 2, ["sil-2-1"]]);
  assert.match(await (await pedir("/api/votaciones?agrupar=false&limite=2", md)).text(), /`sil-1-1`[\s\S]*\(`cpeum`\)[\s\S]*página 1 de 2; la siguiente, con `pagina`: 2/);
});

test("votaciones_por_ley: divididas por ley, con el periodo y lo que queda sin ley", async () => {
  const r = await api("votaciones_por_ley");
  assert.deepEqual(r.leyes.map((l) => [l.documento, l.votaciones, l.divididas, l.mas_dividida.id]), [["cpeum", 1, 1, "sil-1-1"]]);
  assert.deepEqual([r.votaciones_contadas, r.sin_ley, r.periodo], [3, { votaciones: 2, divididas: 1 }, { desde: "2026-03-01", hasta: "2026-09-22" }]);
  assert.equal((await api("votaciones_por_ley?division_minima=0.3")).leyes[0].divididas, 0);
  assert.equal((await pedir("/api/votaciones_por_ley?division_minima=0.9")).status, 400);
});

test("votacion: el voto de cada legislador, por sentido y grupo", async () => {
  const r = await api("votacion?id=sil-1-1");
  assert.deepEqual(r.votos.map((x) => [x.id, x.sentido, x.grupo]), [["ana", "a_favor", "Morena"], ["beto", "en_contra", "PAN"], ["caro", "a_favor", "Morena"]]);
  assert.deepEqual(r.sin_nombre, [{ grupo: "PAN", sentido: "en_contra", votos: 1 }]);
  assert.deepEqual((await api("votacion?id=sil-1-1&sentido=en_contra")).votos.map((x) => x.nombre), ["Beto Ruiz"]);
  assert.deepEqual((await api("votacion?id=sil-1-1&grupo=morena")).votos.length, 2);
  assert.match(await (await pedir("/api/votacion?id=sil-1-1", md)).text(), /### A favor: 2\n\n- Morena \(2\): Ana Pérez; Caro Gil[\s\S]*### En contra: 1/);
  assert.match(await (await pedir("/api/votacion?id=sil-2-1", md)).text(), /no publica el voto de cada legislador/);
  assert.equal((await pedir("/api/votacion?id=nada")).status, 404);
});

test("votos_legislador: sus votaciones con su voto, por id o por nombre", async () => {
  const r = await api("votos_legislador?legislador=beto%20ruiz");
  assert.deepEqual(r.votaciones.map((v) => [v.id, v.voto]), [["sil-1-1", "en_contra"], ["sil-1-2", "en_contra"]]);
  assert.equal(r.cuentas.en_contra, 2);
  assert.deepEqual((await api("votos_legislador?legislador=ana&sentido=ausente")).votaciones.map((v) => v.id), ["sil-1-2"]);
  assert.deepEqual((await api("votos_legislador?legislador=ana&documento=cpeum")).votaciones.map((v) => v.id), ["sil-1-1"]);
  const varios = await pedir("/api/votos_legislador?legislador=a");
  assert.equal(varios.status, 400);
  assert.match((await varios.json()).error, /coincide con 2 personas/);
});

test("asuntos: por autor, ley, texto, desenlace y fechas, sin leer todas las fichas", async () => {
  const r = await api("asuntos");
  assert.deepEqual([r.total, r.asuntos.map((a) => a.id), r.periodo], [3, ["sil-7", "sil-5", "sil-3"], { desde: "2026-02-01", hasta: "2026-10-20", en_total: 3 }]);
  assert.deepEqual((await api("asuntos?autor=beto")).asuntos.map((a) => a.id), ["sil-7", "sil-3"]);
  assert.deepEqual((await api("asuntos?autor=Beto%20Ruiz&documento=CPEUM")).asuntos.map((a) => a.id), ["sil-7"]);
  assert.deepEqual((await api("asuntos?texto=nacionalidad&desde=2026-10-01")).asuntos.map((a) => a.id), ["sil-7"]);
  assert.deepEqual((await api("asuntos?partido=PAN&resultado=pendiente")).asuntos.map((a) => a.id), ["sil-3"]);
  assert.deepEqual((await api("asuntos?hasta=2026-09-30&limite=1&pagina=2")).asuntos.map((a) => a.id), ["sil-3"]);
  // El nombre de un autor ya no es texto de la búsqueda.
  assert.equal((await api("buscar?texto=alma")).congreso.length, 0);
});

test("cambios_recientes: todos los tipos y desde cuándo hay registro", async () => {
  const r = await api("cambios_recientes?documento=cpeum&tipo=todos");
  assert.deepEqual(r.cambios.map((c) => c.tipo), ["reforma", "alta"]);
  assert.deepEqual(r.registro, { desde: "2026-06-09", version_del_alta: "2026-06-02", reformas: 1, articulos_con_mas_reformas: [{ articulo: "004", reformas: 1 }] });
  assert.match(await (await pedir("/api/cambios_recientes?documento=cpeum", md)).text(), /se registra desde su alta, el 2026-06-09[\s\S]*1 reforma registrada desde entonces/);
});

const rpc = async (cuerpo) => {
  const r = await pedir("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(cuerpo) });
  return { status: r.status, json: r.status === 202 ? null : await r.json() };
};
const llamar = async (name, args) => (await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } })).json.result;

test("mcp: initialize, notificaciones, lista de herramientas y lotes", async () => {
  const { json } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba", version: "1" } } });
  assert.equal(json.result.protocolVersion, "2025-06-18");
  assert.match(json.result.instructions, /orden «division»/);
  assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const lista = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json.result.tools;
  assert.deepEqual(lista.map((h) => h.name), HERRAMIENTAS.map((h) => h.name));
  assert.ok(lista.every((h) => h.annotations.readOnlyHint && h.inputSchema.type === "object" && h.inputSchema.properties.formato));
  assert.equal((await rpc({ jsonrpc: "2.0", id: 3, method: "otra/cosa" })).json.error.code, -32601);
  const lote = await rpc([{ jsonrpc: "2.0", id: 4, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]);
  assert.deepEqual(lote.json, [{ jsonrpc: "2.0", id: 4, result: {} }]);
});

test("mcp: las herramientas devuelven Markdown y los errores con isError", async () => {
  const leer = await llamar("leer_articulo", { documento: "CPEUM", articulos: ["4o", "99"] });
  assert.ok(!leer.isError);
  assert.match(leer.content[0].text, /La mujer y el hombre son iguales[\s\S]*no tiene un artículo «99»/);
  assert.match((await llamar("buscar_documentos", { entidad: "Jalisco" })).content[0].text, /^1 documento\.[\s\S]*jalisco\/constitucion/);
  assert.match((await llamar("buscar", { texto: "matrimonio igualitario" })).content[0].text, /## Iniciativas: 1[\s\S]*Alma Vega \(Morena\)/);
  assert.match((await llamar("votaciones", { orden: "division" })).content[0].text, /y otra votación de este asunto/);
  assert.match((await llamar("cambios_recientes", { documento: "cpeum" })).content[0].text, /modifica 004/);
  assert.equal(JSON.parse((await llamar("votacion", { id: "sil-1-1", sentido: "en_contra", formato: "json" })).content[0].text).votos[0].id, "beto");
  const error = await llamar("indice_documento", { documento: "nada" });
  assert.equal(error.isError, true);
  assert.match(error.content[0].text, /buscar_documentos/);
  assert.equal((await llamar("leer_articulo", { documento: "cpeum" })).isError, true);
});

test("api: índice, OpenAPI de las mismas herramientas y Markdown por Accept", async () => {
  const i = await api("");
  assert.deepEqual(i.herramientas.map((h) => h.nombre), HERRAMIENTAS.map((h) => h.name));
  const o = await (await pedir("/openapi.json")).json();
  assert.equal(o.openapi, "3.1.0");
  assert.deepEqual(Object.keys(o.paths), HERRAMIENTAS.map((h) => `/api/${h.name}`));
  assert.ok(o.paths["/api/buscar"].get.parameters.find((p) => p.name === "texto").required);
  const post = await pedir("/api/leer_articulo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documento: "cpeum", articulos: ["1"] }) });
  assert.equal((await post.json()).articulos[0].clave, "001");
  assert.equal((await pedir("/api/nada")).status, 404);
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
  assert.match(await (await pedir("/bitacora/cpeum/aaaaaaaaaaaa", md)).text(), /^# Reforma/);
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

test("sin OAuth: el descubrimiento responde 404, no redirige", async () => {
  for (const ruta of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/register"]) {
    const r = await pedir(ruta);
    assert.equal(r.status, 404, ruta);
  }
});
