// Clases de la bitácora con un historial sintético: ajustes iniciales,
// correcciones sin artículos y commits `Tipo: metadatos`.
//   node --test scripts/

import { test } from "node:test";
import assert from "node:assert/strict";
import { REPOS } from "./lib/comun.mjs";
import { modelo, paginasBitacora } from "./bitacora.mjs";

const SHA = (n) => String(n).padEnd(40, "0");

function commit(n, fecha, tipo, extra = {}) {
  return {
    sha: SHA(n),
    padre: SHA(n - 1),
    fecha,
    titulo: `${tipo} ${n}`,
    documento: "lgs",
    tipo,
    publicaciones: [],
    origen: null,
    medio: "DOF",
    adicionados: [],
    modificados: [],
    derogados: [],
    corregidos: [],
    fuente: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LGS.pdf",
    sha256: "0".repeat(64),
    extractor: "OpenCodice/fiscal-extractor@0000000",
    separacion: null,
    archivos: [],
    textos: {},
    articulosArchivo: [],
    archivosMetadata: [],
    ...extra,
  };
}

const metadata = (...nombres) => nombres.map((n) => ({ estado: "M", ruta: `metadata/lgs/${n}` }));
const texto = (clave) => ({ [clave]: { ruta: `lgs/${clave}.md`, antes: "# Artículo 4o\n\nantes", despues: "# Artículo 4o\n\ndespués" } });

// Del más reciente al más antiguo, como `git log`.
function historial() {
  const lgs = [
    commit(9, "2026-12-20T10:00:00-06:00", "metadatos", { archivosMetadata: metadata("articulos.json", "pasajes.jsonl") }),
    commit(8, "2026-12-01T10:00:00-06:00", "correccion", { corregidos: ["004"], textos: texto("004") }),
    commit(7, "2026-11-20T10:00:00-06:00", "correccion", { archivosMetadata: metadata("reformas.json") }),
    commit(6, "2026-11-12T10:00:00-06:00", "correccion", { corregidos: ["004"], textos: texto("004") }),
    commit(5, "2026-11-11T10:00:00-06:00", "reforma", { publicaciones: ["2026-11-10"], modificados: ["004"], textos: texto("004") }),
    commit(4, "2026-11-10T10:00:00-06:00", "metadatos", { archivosMetadata: metadata("articulos.json") }),
    commit(3, "2026-11-10T09:00:00-06:00", "correccion", { corregidos: ["004"], textos: texto("004") }),
    commit(2, "2026-11-10T08:00:00-06:00", "alta", { publicaciones: ["2026-01-15"] }),
  ];
  const sinAlta = [commit(1, "2026-11-10T07:00:00-06:00", "correccion", { documento: "lfpccs", corregidos: ["001"], textos: texto("001") })];
  const commits = [...lgs, ...sinAlta].map((c, orden) => ({ ...c, repo: REPOS.federales, orden }));
  return {
    [REPOS.federales]: { ok: true, datos: { repo: REPOS.federales, commits, nombres: {}, reformas: {} } },
  };
}

const clase = (m, n) => m.cambios.find((c) => c.sha === SHA(n)).clase;

test("clases: ajustes iniciales, metadatos y correcciones", () => {
  const m = modelo(historial());
  assert.equal(clase(m, 3), "ajuste");
  assert.equal(clase(m, 4), "ajuste", "un commit Tipo: metadatos en la ventana también es ajuste");
  assert.equal(clase(m, 6), "correccion", "después de la primera reforma ya no es ajuste");
  assert.equal(clase(m, 7), "metadatos", "corrección sin artículos corregidos");
  assert.equal(clase(m, 8), "correccion", "fuera de la ventana de 7 días");
  assert.equal(clase(m, 9), "metadatos");
  assert.equal(clase(m, 1), "correccion", "sin commit de alta no hay plegado");
  const alta = m.cambios.find((c) => c.sha === SHA(2));
  assert.deepEqual(
    alta.ajustes.map((c) => c.sha),
    [SHA(3), SHA(4)],
  );
});

test("páginas: listas separadas y cambios.json", async () => {
  const m = modelo(historial());
  const archivos = paginasBitacora(m, "2026-12-21T00:00:00Z", null);
  const correcciones = archivos.get("bitacora/correcciones.html");
  const metadatos = archivos.get("bitacora/metadatos.html");
  const enlace = (n) => `/bitacora/lgs/${SHA(n).slice(0, 12)}`;
  for (const n of [6, 8]) assert.ok(correcciones.includes(enlace(n)));
  for (const n of [3, 4, 7, 9]) assert.ok(!correcciones.includes(enlace(n)));
  for (const n of [7, 9]) assert.ok(metadatos.includes(enlace(n)));
  assert.ok(metadatos.includes("articulos.json, pasajes.jsonl") || metadatos.includes("articulos.json y pasajes.jsonl"));

  const pagAlta = archivos.get(`bitacora/lgs/${SHA(2).slice(0, 12)}.html`);
  assert.ok(pagAlta.includes('id="ajustes"'));
  for (const n of [3, 4]) assert.ok(pagAlta.includes(enlace(n)));

  const historia = archivos.get("bitacora/lgs/index.html");
  assert.ok(historia.includes("2 ajustes iniciales"));

  const pagMetadatos = archivos.get(`bitacora/lgs/${SHA(9).slice(0, 12)}.html`);
  assert.ok(pagMetadatos.includes("metadata/lgs/pasajes.jsonl"));
  assert.ok(!pagMetadatos.includes('id="texto"'), "sin diferencia de artículos");

  const json = JSON.parse(archivos.get("bitacora/cambios.json")).cambios;
  const de = (n) => json.find((c) => c.sha === SHA(n));
  assert.equal(de(3).ajuste_inicial, true);
  assert.equal(de(3).alta, SHA(2));
  assert.equal(de(9).menor, true);
  assert.deepEqual(de(9).archivos_metadata, ["metadata/lgs/articulos.json", "metadata/lgs/pasajes.jsonl"]);
  assert.equal(de(8).menor, false);
  assert.equal(de(8).alta, null);
});
