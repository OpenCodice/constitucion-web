// Clases de la bitácora con un historial sintético: ajustes iniciales,
// correcciones sin artículos y commits `Tipo: metadatos`.
//   node --test scripts/

import { test } from "node:test";
import assert from "node:assert/strict";
import { REPOS } from "./lib/comun.mjs";
import { modelo, paginasBitacora } from "./bitacora.mjs";
import { modeloCongreso } from "./lib/congreso.mjs";

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

// El histórico de la LGS: su primera versión, una reforma anterior al alta,
// la versión con que se dio de alta y una posterior, más una ley sin alta.
function conHistorico() {
  const version = (n, publicacion, extra = {}) => ({
    ...commit(100 + n, `${publicacion}T12:00:00Z`, "version", {
      publicaciones: [publicacion],
      origen: "portada",
      fuente: "https://web.archive.org/web/2020id_/http://www.diputados.gob.mx/LeyesBiblio/pdf/142.pdf",
      retirados: [],
      ...extra,
    }),
    repo: "historico",
    orden: n,
  });
  const commits = [
    version(4, "2026-06-01", { modificados: ["004"], textos: texto("004") }),
    version(3, "2026-01-15", { modificados: ["004"], textos: texto("004") }),
    version(2, "2021-06-01", { modificados: ["004"], retirados: ["009"], textos: texto("004") }),
    version(1, "2006-06-06", { padre: null, articulosArchivo: [{ estado: "A", ruta: "lgs/004.md" }] }),
    version(5, "2010-01-01", { documento: "otra", padre: null }),
  ];
  return { ...historial(), historico: { ok: true, datos: { repo: "historico", commits } } };
}

test("histórico: solo las versiones anteriores al alta, por su fecha de publicación", () => {
  const m = modelo(conHistorico());
  assert.deepEqual(
    m.versiones.map((v) => `${v.documento} ${v.id}`),
    ["lgs v2021-06-01", "lgs v2006-06-06"],
    "la versión del alta y las posteriores ya están en sus cambios; una ley sin alta no entra",
  );
  assert.equal(m.cambios.length, modelo(historial()).cambios.length, "no cuentan como cambios registrados");
  assert.equal(modelo(historial()).versiones.length, 0);

  const archivos = paginasBitacora(m, "2026-12-21T00:00:00Z", null);
  const historia = archivos.get("bitacora/lgs/index.html");
  assert.ok(historia.includes('id="versiones"') && historia.includes("/bitacora/lgs/v2021-06-01"));
  const pagina = archivos.get("bitacora/lgs/v2021-06-01.html");
  assert.ok(pagina.includes("Versión del 1 de junio de 2021") && pagina.includes('id="texto"'));
  assert.ok(pagina.includes("retira art. 009"));
  assert.ok(pagina.includes(`/bitacora/lgs/${SHA(2).slice(0, 12)}`), "tras la versión más reciente sigue el alta");
  assert.ok(archivos.get("bitacora/lgs/v2006-06-06.html").includes("Primera versión reconstruida, con 1 artículo"));
  assert.ok(archivos.get("bitacora/lgs/v2021-06-01.md").includes('tipo: "version"'));
  assert.ok(!archivos.has("bitacora/lgs/v2026-01-15.html"));

  const json = JSON.parse(archivos.get("bitacora/cambios.json"));
  assert.deepEqual(json.versiones.map((v) => v.publicacion), ["2021-06-01", "2006-06-06"]);
  assert.ok(!json.cambios.some((c) => c.tipo === "version"));
});

test("cronología: cada decreto de la lista de la Cámara, con la página de su fecha si la hay", () => {
  const m = modelo(conHistorico());
  const publicacion = (fecha, archivos) => ({ fecha, archivos: archivos.map(([formato, n]) => ({ formato, url: `https://www.diputados.gob.mx/LeyesBiblio/ref/lgs/${n}` })) });
  const decreto = (numero, fecha, archivos, mas = {}) => ({ numero, fecha, titulo: `DECRETO número ${numero}.`, publicaciones: [publicacion(fecha, archivos)], ...mas });
  const cronologia = [
      {
        documento: "lgs",
        url: "https://www.diputados.gob.mx/LeyesBiblio/ref/lgs.htm",
        original: { titulo: "LEY General de Salud.", fecha: "1984-02-07", publicaciones: [publicacion("1984-02-07", [["imagen", "orig_ima.pdf"]])] },
        decretos: [
          decreto(1, "1987-05-27", [["imagen", "ref01_ima.pdf"]], { escaneado: true }),
          decreto(2, "2021-06-01", [["pdf", "ref02.pdf"], ["word", "ref02.doc"]], { escaneado: false }),
        ],
        otras: [{ fecha: "2010-03-03", titulo: "SENTENCIA de la acción 1/2009.", clase: "Sentencia de la SCJN", publicaciones: [publicacion("2010-03-03", [["pdf", "sent01.pdf"]])] }],
        notas_sin_decreto: ["1999-09-09"],
      },
  ];
  const vacio = { organizaciones: [], personas: [], mandatos: [], expedientes: [], votaciones: [], decretos: [] };
  const archivos = paginasBitacora(m, "2026-12-21T00:00:00Z", { ok: true, ...modeloCongreso({ ...vacio, cronologia }) });
  const historia = archivos.get("bitacora/lgs/index.html");
  const seccion = historia.slice(historia.indexOf('id="cronologia"'));
  assert.ok(seccion.includes("Los 2 decretos que lo han reformado desde su publicación el 7 de febrero de 1984"));
  assert.ok(seccion.includes('<a href="/bitacora/lgs/v2021-06-01">1 de junio de 2021</a>'), "la fecha con versión la enlaza");
  assert.ok(seccion.includes("<span class=\"f\">27 de mayo de 1987</span>"), "sin versión, solo el decreto");
  assert.ok(seccion.includes("ref01_ima.pdf\">imagen del Diario</a>") && seccion.includes("Uno existe solo como imagen"));
  assert.ok(seccion.includes("Sentencia de la SCJN") && seccion.includes("1 publicación más"));
  assert.ok(seccion.includes("9 sept 1999") || seccion.includes("9 sep 1999"), "las notas que la lista no trae se dicen");
  assert.ok(seccion.indexOf("DECRETO número 2.") < seccion.indexOf("SENTENCIA") && seccion.indexOf("SENTENCIA") < seccion.indexOf("DECRETO número 1."));
  assert.ok(!historia.includes('id="anteriores"'), "reemplaza a las fechas sueltas de las notas");
  const md = archivos.get("bitacora/lgs/index.md");
  assert.ok(md.includes("## Todas sus reformas") && md.includes("- 1987-05-27 · decreto 1: DECRETO número 1."));

  const sin = paginasBitacora(modelo(conHistorico()), "2026-12-21T00:00:00Z", null).get("bitacora/lgs/index.html");
  assert.ok(!sin.includes('id="cronologia"'));
});
