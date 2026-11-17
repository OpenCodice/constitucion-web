// La sección «Proceso legislativo» de la bitácora con un modelo sintético de
// congreso-mexicano.
//   node --test scripts/

import { test } from "node:test";
import assert from "node:assert/strict";
import { REPOS } from "./lib/comun.mjs";
import { modelo, paginasBitacora } from "./bitacora.mjs";
import { modeloCongreso, urlVotacion, urlLegislador, urlExpediente } from "./lib/congreso.mjs";
import { vinculosDe } from "./lib/vinculos.mjs";

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

const texto = { "004": { ruta: "lgs/004.md", antes: "# Artículo 4o\n\nantes", despues: "# Artículo 4o\n\ndespués" } };

function historial() {
  const commits = [
    commit(4, "2026-11-21T10:00:00-06:00", "reforma", { publicaciones: ["2026-11-20"], modificados: ["004"], textos: texto }),
    commit(3, "2026-11-11T10:00:00-06:00", "reforma", { publicaciones: ["2026-11-10"], modificados: ["004"], textos: texto }),
    commit(2, "2026-11-01T10:00:00-06:00", "alta", { publicaciones: ["2026-01-15"] }),
  ].map((c, orden) => ({ ...c, repo: REPOS.federales, orden }));
  return { [REPOS.federales]: { ok: true, datos: { repo: REPOS.federales, commits, nombres: {}, reformas: {} } } };
}

const votacion = (id, org, fecha, extra = {}) => ({
  id,
  organization_id: org,
  start_date: fecha,
  expediente_id: null,
  motion: { text: "Aprobado en lo general. A Favor: 300 En contra: 100 Abstenciones 2" },
  result: "pass",
  counts: [
    { option: "yes", value: 300 },
    { option: "no", value: 100 },
    { option: "abstain", value: 2 },
    { option: "absent", value: 98 },
  ],
  votes: [],
  votos_publicados: true,
  ...extra,
});

function congreso() {
  const m = modeloCongreso({
    organizaciones: [
      { id: "camara-de-diputados", name: "Cámara de Diputados" },
      { id: "senado", name: "Cámara de Senadores" },
      { id: "partido-morena", name: "Morena" },
      { id: "partido-pan", name: "PAN" },
    ],
    personas: [{ id: "ana-perez", name: "Ana Pérez" }],
    mandatos: [{ id: "sil-1", person_id: "ana-perez", partido_fuente: "Morena", on_behalf_of_id: "partido-morena" }],
    expedientes: [
      {
        id: "sil-100",
        seguimiento: "100",
        denominacion: "Que reforma el artículo 4o de la Ley General de Salud.",
        camara_origen: "Cámara de Diputados",
        camara_revisora: "Cámara de Senadores",
        asuntos: [
          { clave: "400", tipo: "Iniciativa", fecha: "2026-09-01", pdf: "http://sil.example/400.pdf", denominacion: "Que reforma el artículo 4o." },
          { clave: "401", tipo: "Iniciativa", fecha: "2026-08-01", pdf: null, denominacion: "Iniciativa sin registro propio." },
        ],
        votaciones: ["sil-200-1", "sil-300-1"],
        votaciones_economicas: [
          { asunto: "200", camara: "diputados", texto: "Se rechazó la moción suspensiva." },
          { asunto: "200", camara: "diputados", texto: "Suficientemente discutido." },
          { asunto: "300", camara: "senado", texto: "Se desecharon las reservas." },
        ],
      },
      { id: "sil-101", seguimiento: "101", denominacion: "Expediente resuelto por agente.", asuntos: [], votaciones: [] },
      { id: "sil-102", seguimiento: "102", denominacion: "Candidato posible.", asuntos: [], votaciones: [] },
    ],
    votaciones: [
      votacion("sil-200-1", "camara-de-diputados", "2026-10-01", { expediente_id: "sil-100", inconsistencias: ["los grupos no suman la fila Total"] }),
      votacion("sil-300-1", "senado", "2026-10-08", { expediente_id: "sil-100", votos_publicados: false, result: "fail" }),
      votacion("senado-77", "senado", "2026-10-08", { votacion_sil: "sil-300-1", discrepancias: [{ votacion: "sil-300-1", counts_sil: [] }] }),
    ],
    decretos: [
      {
        id: "dof-1",
        fecha: "2026-11-10",
        titulo: "Decreto por el que se reforma el artículo 4o de la Ley General de Salud.",
        url: "https://dof.gob.mx/nota_detalle.php?codigo=1",
        documentos: [{ documento: "lgs", publicacion: "2026-11-10", commits_candidatos: [{ sha: SHA(3) }], decretos_mismo_dia: ["dof-1", "dof-2"] }],
        expedientes: [{ id: "sil-100", criterio: "único decreto y único expediente" }],
        candidatos_expediente: [],
      },
      {
        id: "dof-2",
        fecha: "2026-11-10",
        titulo: "Otro decreto del mismo día sobre la LGS.",
        url: "https://dof.gob.mx/nota_detalle.php?codigo=2",
        documentos: [{ documento: "lgs", publicacion: "2026-11-10", commits_candidatos: [{ sha: SHA(3) }], decretos_mismo_dia: ["dof-1", "dof-2"] }],
        expedientes: [
          {
            id: "sil-101",
            criterio: "resuelto por agente",
            resolucion: "OpenCodice/congreso-extractor:resoluciones/decretos/2026-11-16.json",
            evidencia: [
              { fuente: "dof", texto: "se reforma el artículo 4o" },
              { fuente: "expediente", texto: "Publicado en DOF 10/11/2026" },
            ],
          },
        ],
        candidatos_expediente: [],
      },
      {
        id: "dof-3",
        fecha: "2026-01-15",
        titulo: "Decreto de la fecha de la versión del alta.",
        url: "https://dof.gob.mx/nota_detalle.php?codigo=3",
        documentos: [{ documento: "lgs", publicacion: "2026-01-15", commits: [] }],
        expedientes: [],
        candidatos_expediente: [],
      },
      {
        id: "dof-4",
        fecha: "2026-11-20",
        titulo: "Decreto sin expediente seguro.",
        url: "https://dof.gob.mx/nota_detalle.php?codigo=4",
        documentos: [{ documento: "lgs", publicacion: "2026-11-20", commits: [{ sha: SHA(4) }] }],
        expedientes: [],
        candidatos_expediente: [{ id: "sil-102", parecido: 0.13 }],
        legislaturas_estatales: { aprobaron: ["jalisco", "cdmx"], votos_aprobatorios: 2, fecha: "2026-11-19", nota: "el SIL solo lista los congresos con voto aprobatorio" },
      },
    ],
    iniciativas: [
      {
        id: "sil-400",
        clave: "400",
        seguimiento: "100",
        denominacion: "Que reforma el artículo 4o.",
        fecha_presentacion: "2026-09-01",
        partido_fuente: null,
        presentadores: [
          { tipo: "legislador", person_id: "ana-perez", mandato_id: "sil-1", nombre_fuente: "Dip. Ana Pérez" },
          { tipo: "grupo_parlamentario", organization_id: "partido-pan", nombre_fuente: "PAN" },
        ],
      },
    ],
  });
  return { ok: true, ...m };
}

const pagina = (archivos, n) => archivos.get(`bitacora/lgs/${SHA(n).slice(0, 12)}.html`);
const seccion = (html) => html.slice(html.indexOf('id="proceso"'), html.indexOf('id="articulos"'));

test("vinculosDe: por publicación solo en reformas, y por sha", () => {
  const cg = congreso();
  const m = modelo(historial());
  const de = (n) => vinculosDe(cg, m.cambios.find((c) => c.sha === SHA(n)));
  assert.deepEqual(de(3).map((p) => p.decreto.id), ["dof-1", "dof-2"]);
  assert.deepEqual(de(2), [], "la Publicacion de un alta es la versión del PDF, no un decreto");
  assert.deepEqual(de(4).map((p) => p.decreto.id), ["dof-4"]);
  assert.deepEqual(vinculosDe({ ok: false, error: "x" }, m.cambios[0]), []);
  assert.deepEqual(vinculosDe(null, m.cambios[0]), []);

  const [p] = de(3);
  assert.deepEqual(p.mismoDia, ["dof-1", "dof-2"]);
  const [x] = p.expedientes;
  assert.deepEqual(x.iniciativas.map((a) => a.id), ["sil-401", "sil-400"], "en orden de presentación, con las que no tienen registro");
  assert.equal(x.iniciativas[1].autores[0].partido, "Morena");
  assert.deepEqual(x.votaciones.map((g) => g.organizacion), ["camara-de-diputados", "senado"]);
  assert.deepEqual(x.votaciones[1].votaciones.map((v) => v.votacion.id), ["sil-300-1"], "la del Senado va con su par del SIL");
  assert.deepEqual(x.votaciones[1].votaciones[0].otras.map((v) => v.id), ["senado-77"]);
  assert.deepEqual(x.economicas.map((e) => [e.organizacion, e.n]), [["camara-de-diputados", 2], ["senado", 1]]);
});

test("página: sección de proceso legislativo", () => {
  const archivos = paginasBitacora(modelo(historial()), "2026-12-21T00:00:00Z", congreso());
  assert.ok(!pagina(archivos, 2).includes('id="proceso"'));

  const s = seccion(pagina(archivos, 3));
  assert.ok(s.includes("Decreto 1 de 2") && s.includes("Decreto 2 de 2"));
  assert.ok(s.includes("no se sabe qué artículos vienen de cada uno"));
  assert.ok(s.includes('href="https://dof.gob.mx/nota_detalle.php?codigo=1"'));
  assert.ok(s.includes(`href="${urlExpediente("sil-100")}"`));
  assert.ok(s.includes("Seguimiento=100"));
  assert.ok(s.includes(`<a href="${urlLegislador("ana-perez")}">Ana Pérez</a> (Morena)`));
  assert.ok(s.includes("por <a href=\"/congreso/legisladores/ana-perez\">Ana Pérez</a> (Morena) y el grupo parlamentario del PAN"));
  assert.ok(s.includes("su autor no está registrado"));
  assert.ok(s.includes(`href="${urlVotacion("sil-200-1")}">Aprobado en lo general.</a>`), "sin los conteos repetidos");
  assert.ok(s.includes(`href="${urlVotacion("senado-77")}">el sitio del Senado</a>; las dos fuentes difieren en los conteos`));
  assert.ok(s.includes("no cuadra consigo mismo"));
  assert.ok(s.includes("Rechazada"));
  assert.ok(s.includes("2 votaciones económicas en Cámara de Diputados y 1 votación económica en Cámara de Senadores"));
  assert.ok(s.includes("lo propuso un agente"));
  assert.ok(s.includes("«se reforma el artículo 4o»"));
  assert.ok(s.includes("resoluciones/decretos/2026-11-16.json"));

  const s4 = seccion(pagina(archivos, 4));
  assert.ok(!s4.includes("Decreto 1 de"));
  assert.ok(s4.includes("No se pudo saber con certeza"));
  assert.ok(s4.includes(`href="${urlExpediente("sil-102")}"`) && s4.includes("13 %"));
  assert.ok(s4.includes("Lo aprobaron 2 congresos locales") && s4.includes("Jalisco y Ciudad de México"));
  assert.ok(s4.includes("El SIL solo lista"));
});

test("página: sin datos del Congreso no hay sección", () => {
  const archivos = paginasBitacora(modelo(historial()), "2026-12-21T00:00:00Z", { ok: false, error: "no existe" });
  assert.ok(!pagina(archivos, 3).includes('id="proceso"'));
});

test("página: miniatura del hemiciclo junto a la votación con votos, enlazada a ella", () => {
  const c = congreso();
  c.votaciones.get("sil-200-1").votes = [{ voter_id: "ana-perez", mandato_id: "sil-1", option: "yes", group_id: "partido-morena", grupo_fuente: "Morena" }];
  const s = seccion(pagina(paginasBitacora(modelo(historial()), "2026-12-21T00:00:00Z", c), 3));
  assert.ok(s.includes(`<figure class="mini"><a href="${urlVotacion("sil-200-1")}"><svg class="mini-svg"`));
  assert.ok(s.includes("1 a favor"));
  assert.ok(!pagina(paginasBitacora(modelo(historial()), "2026-12-21T00:00:00Z", c), 3).includes("hemiciclo.js"));
});
