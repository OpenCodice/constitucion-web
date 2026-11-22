// Páginas de /congreso con un modelo sintético de congreso-mexicano: una
// votación con votos sin atribuir, inconsistencias y discrepancia con otra
// fuente; un legislador con iniciativas; un expediente con decreto.
//   node --test scripts/

import { test } from "node:test";
import assert from "node:assert/strict";
import { modeloCongreso } from "./lib/congreso.mjs";
import { paginasCongreso } from "./congreso.mjs";

const fuente = [{ url: "http://sil.gobernacion.gob.mx/x", consultado: "2026-11-16T15:00:00Z", sha256: "a".repeat(64) }];

function registros() {
  const persona = (id, given, family) => ({ id, name: `${given} ${family}`, given_name: given, family_name: family });
  const mandato = (ref, person_id, partido) => ({
    id: `sil-${ref}`,
    person_id,
    organization_id: "senado",
    legislative_period_id: "lxvi",
    on_behalf_of_id: `partido-${partido.toLowerCase()}`,
    partido_fuente: partido,
    calidad: "propietario",
    principio: "mayoria-relativa",
    area: { entidad: "jalisco" },
    estatus: "Activo(a)",
    licencias: [{ tipo: "Licencia", inicio: "2025-01-10", fin: null, en_funciones: "Suplente", estatus: "Activo" }],
    comisiones: [{ comision: "Puntos Constitucionales", puesto: "Integrante", inicio: "2024-10-01", fin: "2027-08-31", estatus: "Activo" }],
    start_date: "2024-09-01",
    sources: fuente,
  });
  const base = {
    organization_id: "senado",
    legislative_period_id: "lxvi",
    camara: "senado",
    start_date: "2026-09-29",
    expediente_id: "sil-100",
    asunto: "200",
    sources: fuente,
  };
  const sil = {
    ...base,
    id: "sil-200-1",
    orden: 1,
    fecha_fuente: "fecha del dictamen a discusión en el SIL",
    motion: { denominacion: "Que reforma el artículo 82 de la Constitución.", text: "Aprobado. A Favor: 3 En contra: 1" },
    result: "pass",
    counts: [
      { option: "yes", value: 3 },
      { option: "no", value: 1 },
      { option: "abstain", value: 0 },
    ],
    group_results: [
      { grupo: "Morena", yes: 2, no: 0, abstain: 0, total: 2 },
      { grupo: "PAN", yes: 1, no: 1, abstain: 0, total: 2 },
    ],
    votos_publicados: true,
    votes: [
      { voter_id: "ana-lopez", mandato_id: "sil-1", option: "yes", group_id: "partido-morena", grupo_fuente: "Morena" },
      { voter_id: "beto-ruiz", mandato_id: "sil-2", option: "no", group_id: "partido-pan", grupo_fuente: "PAN" },
      { voter_id: "carla-diaz", mandato_id: "sil-3", option: "yes", group_id: "partido-morena", grupo_fuente: "Morena" },
    ],
    votos_faltantes: [{ grupo: "PAN", option: "yes", value: 1, nombres_fuente: ["Sen. B. Ruíz"] }],
    inconsistencias: ["2 filas (Beto Ruiz, B. Ruíz) se ligan a la misma persona beto-ruiz; no se atribuyen"],
    diferencia_grupos: { PAN: 0 },
  };
  const senado = {
    ...base,
    id: "senado-77",
    fecha_fuente: "fecha de la sesión en el sitio del Senado",
    motion: { denominacion: "Dictamen que reforma el artículo 82", text: "Votación en lo general" },
    result: null,
    counts: [
      { option: "yes", value: 3 },
      { option: "no", value: 1 },
      { option: "abstain", value: 0 },
      { option: "absent", value: 0 },
    ],
    votos_publicados: true,
    votacion_sil: "sil-200-1",
    votes: [
      { voter_id: "ana-lopez", mandato_id: "sil-1", option: "no", group_id: "partido-morena", grupo_fuente: "Morena", enlace: "apellidos invertidos" },
      { voter_id: "beto-ruiz", mandato_id: "sil-2", option: "no", group_id: "partido-pan", grupo_fuente: "PAN" },
    ],
    discrepancias: [{ votacion: "sil-200-1", votantes_distintos: ["ana-lopez"] }],
    retirada_de_la_fuente: { detectada: "2026-11-15", nota: "la fuente dejó de publicarlo" },
  };
  const soloConteos = { ...sil, id: "sil-200-2", orden: 2, votos_publicados: false, votes: [], votos_faltantes: undefined, inconsistencias: undefined };
  const iniciativa = (id, resultado, presentadores) => ({
    id,
    clave: id.slice(4),
    seguimiento: "100",
    legislative_period_id: "lxvi",
    tipo: "Iniciativa",
    denominacion: `Iniciativa ${id}`,
    fecha_presentacion: "2026-09-01",
    estatus: { resultado, estado: resultado === "pendiente" ? "Pendiente en comisión(es) de origen" : "Aprobado", fecha: "2026-09-01" },
    comisiones: [{ camara: "Senado", comision: "Puntos Constitucionales" }],
    presentadores,
    expediente_id: "sil-100",
    sources: fuente,
  });
  const autora = { tipo: "legislador", person_id: "ana-lopez", mandato_id: "sil-1", nombre_fuente: "Sen. Ana López" };
  return {
    organizaciones: [
      { id: "senado", name: "Cámara de Senadores" },
      { id: "partido-morena", name: "Morena" },
      { id: "partido-pan", name: "Partido Acción Nacional" },
    ],
    personas: [persona("ana-lopez", "Ana", "López"), persona("beto-ruiz", "Beto", "Ruiz"), persona("carla-diaz", "Carla", "Díaz")],
    mandatos: [mandato(1, "ana-lopez", "Morena"), mandato(2, "beto-ruiz", "PAN"), mandato(3, "carla-diaz", "Morena")],
    expedientes: [
      {
        id: "sil-100",
        seguimiento: "100",
        denominacion: "Que reforma el artículo 82 de la Constitución.",
        camara_origen: "Cámara de Senadores",
        camara_revisora: "Cámara de Diputados",
        ultimo_estatus: "Publicado en DOF",
        publicado_dof: "2026-10-07",
        cronologia: [{ fecha: "2026-09-29", estatus: "Aprobado en pleno" }],
        asuntos: [{ clave: "200", tipo: "Dictamen a discusión", denominacion: "Dictamen", fecha: "2026-09-29", pdf: null }],
        votaciones: ["sil-200-1", "sil-200-2"],
        votaciones_economicas: [{ asunto: "200", camara: "senado", fecha: "2026-09-29", texto: "Se desechó la reserva del artículo 82.", result: "fail" }],
        tramites: {},
        sources: fuente,
      },
    ],
    votaciones: [sil, senado, soloConteos],
    decretos: [
      {
        id: "dof-5800617",
        fecha: "2026-10-07",
        titulo: "Decreto por el que se reforma el artículo 82",
        url: "https://dof.gob.mx/nota_detalle.php?codigo=5800617&fecha=07/10/2026",
        documentos: [{ documento: "cpeum", publicacion: "2026-10-07", commits: [{ repo: "OpenCodice/constitucion-mexicana", sha: "260df839623ec5e69930f77244999d6931319f2a" }] }],
        expedientes: [{ id: "sil-100", criterio: "único decreto y único expediente" }],
        legislaturas_estatales: { aprobaron: ["jalisco", "cdmx"], votos_aprobatorios: 2, nota: "el SIL solo lista los congresos con voto aprobatorio" },
        sources: fuente,
      },
    ],
    iniciativas: [
      iniciativa("sil-301", "pendiente", [autora]),
      iniciativa("sil-302", "aprobado", [autora, { tipo: "legislador", person_id: "beto-ruiz", mandato_id: "sil-2" }]),
      iniciativa("sil-303", "pendiente", [{ tipo: "grupo_parlamentario", nombre_fuente: "PAN", organization_id: "partido-pan" }]),
    ],
    proposiciones: [],
    dictamenesNegativos: [],
  };
}

const paginas = () => paginasCongreso({ ok: true, ...modeloCongreso(registros()) }, "2026-11-17T12:00:00Z");

test("genera índice, votaciones, legisladores y expedientes", () => {
  const p = paginas();
  for (const r of [
    "congreso/index.html",
    "congreso/votaciones/index.html",
    "congreso/legisladores/index.html",
    "congreso/expedientes/index.html",
    "congreso/votaciones/sil-200-1.html",
    "congreso/votaciones/senado-77.html",
    "congreso/legisladores/ana-lopez.html",
    "congreso/expedientes/sil-100.html",
  ]) {
    assert.ok(p.has(r), r);
  }
  assert.match(p.get("congreso/index.html"), /<span class="cifra">3<\/span><span><strong>Votaciones nominales/);
  assert.match(p.get("congreso/index.html"), /<span class="cifra">3<\/span><span><strong>Iniciativas\.<\/strong> 2 pendientes, 1 aprobada/);
});

test("votación con votos sin atribuir, inconsistencias y otra fuente", () => {
  const h = paginas().get("congreso/votaciones/sil-200-1.html");
  assert.match(h, /1 voto que la fuente cuenta no se atribuye/);
  assert.match(h, /«Sen\. B\. Ruíz»/);
  assert.match(h, /se ligan a la misma persona beto-ruiz/);
  assert.match(h, /href="\/congreso\/votaciones\/senado-77"/);
  assert.match(h, /href="\/congreso\/legisladores\/ana-lopez">Ana López<\/a>/);
  assert.match(h, /href="\/congreso\/expedientes\/sil-100"/);
  // Por sentido: a favor 3 (2 con nombre y 1 sin atribuir).
  assert.match(h, /A favor <span class="cuenta">3<\/span>/);
});

test("votación de otra fuente: discrepancia, enlace por nombre y retirada", () => {
  const h = paginasCongreso({ ok: true, ...modeloCongreso(registros()) }, "2026-11-17T12:00:00Z").get("congreso/votaciones/senado-77.html");
  assert.match(h, /Es la misma votación que <a href="\/congreso\/votaciones\/sil-200-1">la del SIL<\/a>/);
  assert.match(h, /Votaron distinto según una y otra fuente: .*Ana López.*aquí: En contra; SIL de Gobernación: A favor/);
  assert.match(h, /La fuente dejó de publicar esta votación/);
  assert.match(h, /ligado por: apellidos invertidos/);
});

test("votación leída por el agente lo dice, con su registro", () => {
  const r = registros();
  const v = r.votaciones.find((x) => x.id === "senado-77");
  v.lecturas = [{ pagina: "lista", por: "agente", registro: "OpenCodice/congreso-extractor:lecturas/senado/tabla/abc.json",
    verificacion: ["cada nombre y cada cifra están en la página"] }];
  const h = paginasCongreso({ ok: true, ...modeloCongreso(r) }, "2026-11-17T12:00:00Z").get("congreso/votaciones/senado-77.html");
  assert.match(h, /la lista nominal traía un formato que el programa todavía no lee: la leyó un agente/);
  assert.match(h, /href="https:\/\/github.com\/OpenCodice\/congreso-extractor\/blob\/main\/lecturas\/senado\/tabla\/abc.json"/);
  assert.match(h, /cada nombre y cada cifra están en la página/);
});

test("votación solo con conteos remite a la otra fuente", () => {
  const h = paginas().get("congreso/votaciones/sil-200-2.html");
  assert.match(h, /de esta da solo los conteos/);
  assert.match(h, /votación 2 de 2 del asunto/);
});

test("legislador con iniciativas y votos", () => {
  const h = paginas().get("congreso/legisladores/ana-lopez.html");
  assert.match(h, /El SIL le atribuye 2 asuntos; 1 sigue pendiente/);
  assert.match(h, /2 iniciativas: 1 pendiente, 1 aprobada, 0 desechadas y 0 retiradas/);
  assert.match(h, /con 1 autor más/);
  assert.match(h, /Votó con nombre en 2 votaciones nominales: a favor: <span class="dato">1<\/span>, en contra: <span class="dato">1<\/span>/);
  assert.match(h, /votos que la fuente no atribuye a nadie/);
  assert.match(h, /Licencias y reincorporaciones/);
  assert.match(h, /Jalisco/);
});

test("expediente con decreto, económicas e iniciativas con autor", () => {
  const h = paginas().get("congreso/expedientes/sil-100.html");
  assert.match(h, /href="https:\/\/dof\.gob\.mx\/nota_detalle\.php\?codigo=5800617/);
  assert.match(h, /href="\/bitacora\/cpeum\/">cpeum<\/a> en la bitácora/);
  assert.match(h, /Se desechó la reserva del artículo 82\./);
  assert.match(h, /Rechazada o desechada/);
  assert.match(h, /no se sabe quién votó qué/);
  assert.match(h, /Jalisco y Ciudad de México/);
  assert.match(h, /<a href="\/congreso\/legisladores\/beto-ruiz">Beto Ruiz<\/a>/);
  assert.match(h, /PAN/);
});

test("sin datos, una página que lo dice", () => {
  const p = paginasCongreso({ ok: false, error: "no existe ../congreso-mexicano" }, "2026-11-17T12:00:00Z");
  assert.deepEqual([...p.keys()], ["congreso/index.html"]);
  assert.match(p.get("congreso/index.html"), /No se pudieron leer los datos del Congreso \(no existe/);
});

test("la foto de un legislador es la copia que cita su mandato", () => {
  const r = registros();
  const url = "http://sil.gobernacion.gob.mx/Archivos/Fotos/1.jpg";
  const sha = "b".repeat(64);
  const ana = r.mandatos.find((x) => x.person_id === "ana-lopez");
  ana.sources = [...ana.sources, { url, sha256: sha, archivo: `fuentes/bb/${sha}.jpg` }];
  r.personas.find((x) => x.id === "ana-lopez").image = url;
  // Una `image` que ningún mandato copia no se muestra.
  r.personas.find((x) => x.id === "beto-ruiz").image = "http://sil.gobernacion.gob.mx/Archivos/Fotos/2.jpg";
  const m = modeloCongreso(r);
  assert.deepEqual([...m.fotos.keys()], ["ana-lopez"]);
  const p = paginasCongreso({ ok: true, ...m }, "2026-11-17T12:00:00Z");
  assert.match(p.get("congreso/legisladores/ana-lopez.html"), new RegExp(`<img src="/congreso/fotos/${sha}.jpg"[^>]*alt="Foto oficial de Ana López"`));
  assert.doesNotMatch(p.get("congreso/legisladores/beto-ruiz.html"), /class="retrato"/);
  assert.match(p.get("congreso/legisladores/index.html"), /class="miniretrato"/);
});
