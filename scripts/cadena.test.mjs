// La cadena de una reforma (scripts/lib/cadena.mjs) y la vida de los artículos
// (scripts/lib/vida.mjs) con un modelo sintético de congreso-mexicano y del
// historial: cadena completa, sin votos nominales, sin congresos locales, ley
// federal y decreto sin expediente (sin candidatos, con candidatos y resuelto
// por un agente).
//   node --test scripts/

import { test } from "node:test";
import assert from "node:assert/strict";
import { REPOS } from "./lib/comun.mjs";
import { modelo, paginasBitacora } from "./bitacora.mjs";
import { modeloCongreso, urlLegislador } from "./lib/congreso.mjs";
import { vinculosDe } from "./lib/vinculos.mjs";
import { cadenaDe, votacionPrincipal, htmlCadena, htmlCongresos, dias } from "./lib/cadena.mjs";
import { vidaDocumento, htmlLineaVida, nivel } from "./lib/vida.mjs";

const SHA = (n) => String(n).padEnd(40, "a");
const GENERADA = "2027-01-01T00:00:00Z";

function commit(n, documento, fecha, tipo, extra = {}) {
  return {
    sha: SHA(n),
    padre: SHA(n - 1),
    fecha,
    titulo: `${tipo} ${n}`,
    documento,
    tipo,
    publicaciones: [],
    origen: null,
    medio: "DOF",
    adicionados: [],
    modificados: [],
    derogados: [],
    corregidos: [],
    fuente: null,
    sha256: null,
    extractor: null,
    separacion: null,
    archivos: [],
    textos: {},
    articulosArchivo: [],
    archivosMetadata: [],
    ...extra,
  };
}

const reforma = (n, documento, publicacion, registro, arts = ["082"]) =>
  commit(n, documento, `${registro}T10:00:00-06:00`, "reforma", { publicaciones: [publicacion], modificados: arts });

function historial() {
  const cpeum = [
    reforma(16, "cpeum", "2026-12-20", "2026-12-21"),
    reforma(15, "cpeum", "2026-12-15", "2026-12-16"),
    reforma(14, "cpeum", "2026-12-10", "2026-12-11"),
    reforma(13, "cpeum", "2026-12-01", "2026-12-02"),
    reforma(12, "cpeum", "2026-11-20", "2026-11-21"),
    reforma(11, "cpeum", "2026-11-01", "2026-11-02"),
    reforma(10, "cpeum", "2026-10-07", "2026-11-15", ["082", "116"]),
    commit(9, "cpeum", "2026-06-09T10:00:00-06:00", "alta", { publicaciones: ["2026-06-02"] }),
  ].map((c, orden) => ({ ...c, repo: REPOS.cpeum, orden }));
  const federales = [reforma(21, "lgs", "2026-06-09", "2026-06-22", ["004"]), commit(20, "lgs", "2026-01-01T10:00:00-06:00", "alta", { publicaciones: ["2025-12-01"] })].map(
    (c, orden) => ({ ...c, repo: REPOS.federales, orden }),
  );
  const reformas = {
    cpeum: [
      { fecha: "1917-02-05", claves: ["082", "116"] },
      { fecha: "1990-04-06", claves: ["082"] },
      { fecha: "2005-03-01", claves: ["082", "116"] },
      { fecha: "2026-10-07", claves: ["082", "116"] },
    ],
  };
  const articulos = {
    cpeum: [
      { clave: "001", etiqueta: "Artículo 1o.", numero: 1 },
      { clave: "082", etiqueta: "Artículo 82.", numero: 82 },
      { clave: "116", etiqueta: "Artículo 116.", numero: 116 },
    ],
  };
  return {
    [REPOS.cpeum]: { ok: true, datos: { repo: REPOS.cpeum, commits: cpeum, nombres: {}, reformas, articulos } },
    [REPOS.federales]: { ok: true, datos: { repo: REPOS.federales, commits: federales, nombres: {}, reformas: {}, articulos: {} } },
  };
}

const conteos = (yes, no, abstain, absent) =>
  [["yes", yes], ["no", no], ["abstain", abstain], ["absent", absent]].filter(([, v]) => v != null).map(([option, value]) => ({ option, value }));

const votacion = (id, org, fecha, texto, cuentas, extra = {}) => ({
  id,
  organization_id: org,
  start_date: fecha,
  expediente_id: null,
  motion: { text: `${texto} A Favor: 1 En contra: 1` },
  result: "pass",
  counts: conteos(...cuentas),
  votes: [],
  votos_publicados: false,
  ...extra,
});

const voto = (persona, option, grupo) => ({ voter_id: persona, mandato_id: `m-${persona}`, option, group_id: `partido-${grupo}`, grupo_fuente: grupo.toUpperCase() });

const expediente = (id, extra = {}) => ({
  id,
  seguimiento: id.replace(/^sil-/, ""),
  denominacion: `Expediente ${id}`,
  camara_origen: "Cámara de Diputados",
  camara_revisora: "Cámara de Senadores",
  asuntos: [],
  votaciones: [],
  votaciones_economicas: [],
  ...extra,
});

const decreto = (id, documento, fecha, extra = {}) => ({
  id,
  codigo: Number(id.replace(/\D/g, "")),
  fecha,
  titulo: `Decreto ${id}`,
  url: `https://dof.gob.mx/nota_detalle.php?codigo=${id.replace(/\D/g, "")}`,
  documentos: [{ documento, publicacion: fecha, commits: [] }],
  expedientes: [],
  candidatos_expediente: [],
  ...extra,
});

const LEGISLATURAS = { aprobaron: ["jalisco", "cdmx", "yucatan"], votos_aprobatorios: 3, fecha: "2026-10-06", nota: "el SIL solo lista los congresos con voto aprobatorio" };

function congreso() {
  const personas = ["ana", "beto", "carla", "dani"].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) }));
  const m = modeloCongreso({
    organizaciones: [
      { id: "camara-de-diputados", name: "Cámara de Diputados" },
      { id: "senado", name: "Cámara de Senadores" },
    ],
    personas,
    mandatos: personas.map((p) => ({ id: `m-${p.id}`, person_id: p.id, partido_fuente: "Morena" })),
    expedientes: [
      expediente("sil-500", {
        asuntos: [
          { clave: "510", tipo: "Iniciativa", fecha: "2026-09-02", denominacion: "Que reforma el 82." },
          { clave: "511", tipo: "Iniciativa", fecha: "2026-09-01", denominacion: "Que reforma el 82 y el 116." },
          { clave: "520", tipo: "Dictamen de primera lectura / Declaratoria de publicidad", fecha: "2026-09-09", pdf: "http://sil.example/520.pdf" },
          { clave: "521", tipo: "Dictamen a discusión", fecha: "2026-09-22" },
        ],
      }),
      expediente("sil-501", { votaciones_economicas: [{ asunto: "1", camara: "senado", texto: "Aprobado." }, { asunto: "1", camara: "senado", texto: "Aprobado." }] }),
      expediente("sil-502", { asuntos: [{ clave: "530", tipo: "Iniciativa", fecha: "2026-10-01" }] }),
      expediente("sil-503", {
        camara_origen: "Cámara de Senadores",
        camara_revisora: "Cámara de Diputados",
        asuntos: [{ clave: "550", tipo: "Dictamen a discusión", fecha: "2025-12-09" }],
      }),
      expediente("sil-504"),
      expediente("sil-505"),
    ],
    votaciones: [
      votacion("sil-600-1", "camara-de-diputados", "2026-09-22", "Aprobado en lo general y en lo particular de los no reservados.", [3, 1, 0, 0], {
        expediente_id: "sil-500",
        votos_publicados: true,
        votes: [voto("ana", "yes", "morena"), voto("beto", "yes", "morena"), voto("carla", "no", "morena"), voto("dani", "yes", "morena")],
      }),
      votacion("sil-600-2", "camara-de-diputados", "2026-09-22", "Aprobado en lo general y en lo particular de los reservados.", [2, 2, 0, null], { expediente_id: "sil-500" }),
      votacion("sil-700-1", "senado", "2026-09-29", "Aprobado en lo general.", [86, 42, 0, null], { expediente_id: "sil-500" }),
      // Ida y vuelta: la ley federal regresa a Diputados.
      votacion("sil-800-1", "senado", "2025-12-09", "Aprobado en lo general.", [66, 12, 15, null], { expediente_id: "sil-503" }),
      votacion("sil-801-1", "camara-de-diputados", "2026-03-25", "Aprobado en lo general con modificaciones.", [331, 100, 0, 69], { expediente_id: "sil-503" }),
      votacion("sil-802-1", "camara-de-diputados", "2026-04-29", "Aprobado en lo general y en lo particular.", [290, 114, 0, 96], { expediente_id: "sil-503" }),
    ],
    decretos: [
      decreto("dof-10", "cpeum", "2026-10-07", { expedientes: [{ id: "sil-500", criterio: "único" }], legislaturas_estatales: LEGISLATURAS }),
      decreto("dof-11", "cpeum", "2026-11-01", { expedientes: [{ id: "sil-501", criterio: "único" }], legislaturas_estatales: LEGISLATURAS }),
      decreto("dof-12", "cpeum", "2026-11-20", { expedientes: [{ id: "sil-502", criterio: "único" }] }),
      decreto("dof-13", "cpeum", "2026-12-01"),
      decreto("dof-14", "cpeum", "2026-12-10", { candidatos_expediente: [{ id: "sil-504", parecido: 0.4 }, { id: "sil-505", parecido: 0.3 }] }),
      decreto("dof-15", "cpeum", "2026-12-15", {
        expedientes: [{ id: "sil-500", criterio: "resuelto por agente", resolucion: "OpenCodice/congreso-extractor:resoluciones/x.json", evidencia: [] }],
      }),
      decreto("dof-21", "lgs", "2026-06-09", { expedientes: [{ id: "sil-503", criterio: "único" }] }),
    ],
    iniciativas: [
      {
        id: "sil-511",
        clave: "511",
        seguimiento: "500",
        denominacion: "Que reforma el 82 y el 116.",
        fecha_presentacion: "2026-09-01",
        presentadores: [{ tipo: "legislador", person_id: "ana", mandato_id: "m-ana", nombre_fuente: "Dip. Ana" }],
        comisiones: [{ camara: "Diputados", comision: "Puntos Constitucionales", turno: "Para dictamen" }],
      },
      {
        id: "sil-503-i",
        clave: "540",
        seguimiento: "503",
        denominacion: "Que reforma la LGS.",
        fecha_presentacion: "2025-06-25",
        presentadores: [{ tipo: "ejecutivo_federal", nombre_fuente: "Ejecutivo Federal" }],
        comisiones: [
          { camara: "Senado", comision: "Salud", turno: "Para dictamen" },
          { camara: "Senado", comision: "Estudios Legislativos", turno: "Para dictamen" },
          { camara: "Diputados", comision: "Salud", turno: "Para opinión" },
        ],
      },
    ],
  });
  return { ok: true, ...m };
}

function preparar() {
  const m = modelo(historial());
  const cg = congreso();
  const cambio = (n) => m.cambios.find((c) => c.sha === SHA(n));
  const cadena = (n) => {
    const c = cambio(n);
    const [p] = vinculosDe(cg, c);
    return cadenaDe(cg, p, c, { articulos: "arts. 82" });
  };
  return { m, cg, cambio, cadena };
}

const paso = (cad, clave) => cad.pasos.find((s) => s.clave === clave);
const pagina = (archivos, doc, n) => archivos.get(`bitacora/${doc}/${SHA(n).slice(0, 12)}.html`);

test("votacionPrincipal: la primera en lo general del último día en que votó la cámara", () => {
  const e = (id, fecha, texto) => ({ votacion: { id, start_date: fecha, motion: { text: texto } }, otras: [] });
  assert.equal(votacionPrincipal([]), null);
  assert.equal(
    votacionPrincipal([e("v-2", "2026-09-22", "en lo general, reservados"), e("v-1", "2026-09-22", "En lo general, no reservados")]).votacion.id,
    "v-1",
    "del mismo día, la primera por id",
  );
  assert.equal(
    votacionPrincipal([e("a-1", "2026-03-25", "en lo general"), e("b-1", "2026-04-29", "en lo general"), e("c-1", "2026-05-01", "una moción")]).votacion.id,
    "b-1",
    "si la minuta regresó, la última vez que se votó en lo general",
  );
  assert.equal(votacionPrincipal([e("x-1", "2026-01-01", "moción"), e("x-2", "2026-01-02", "otra")]).votacion.id, "x-2", "sin «en lo general», la misma regla sobre todas");
});

test("cadena completa de una reforma constitucional", () => {
  const { cadena } = preparar();
  const cad = cadena(10);
  assert.deepEqual(
    cad.pasos.map((s) => s.clave),
    ["iniciativa", "comision", "votacion-camara-de-diputados", "votacion-senado", "congresos", "dof", "commit"],
  );
  assert.ok(cad.pasos.every((s) => !s.vacio));
  const ini = paso(cad, "iniciativa");
  assert.equal(ini.fecha, "2026-09-01", "la primera presentada");
  assert.ok(ini.quien.includes(`href="${urlLegislador("ana")}"`));
  assert.equal(ini.dato, "la primera de 2 del expediente", "la del expediente sin registro propio también cuenta");
  const com = paso(cad, "comision");
  assert.equal(com.fecha, "2026-09-09");
  assert.equal(com.quien, "Puntos Constitucionales");
  assert.equal(com.dias, 8);
  const dip = paso(cad, "votacion-camara-de-diputados");
  assert.equal(dip.fecha, "2026-09-22");
  assert.ok(dip.quien.includes('<span class="si">3</span>'));
  assert.ok(dip.mini.includes('class="mini-svg'), "con votos nominales, su miniatura");
  assert.ok(dip.dato.includes("se requieren ⅔") && dip.dato.includes("1 de 2 votaciones nominales"));
  const sen = paso(cad, "votacion-senado");
  assert.equal(sen.mini, "", "sin el voto de cada quien no hay miniatura");
  assert.equal(paso(cad, "congresos").quien, "3 de 32 aprobaron");
  assert.equal(paso(cad, "dof").dias, 1);
  const commit = paso(cad, "commit");
  assert.equal(commit.fecha, "2026-11-15");
  assert.equal(commit.dias, dias("2026-10-07", "2026-11-15"));
  assert.ok(commit.registro);

  const html = htmlCadena(cad);
  assert.equal((html.match(/<li class="paso/g) ?? []).length, 7);
  assert.ok(html.includes('<li class="paso reg">'));
  assert.ok(html.includes("+8 días") && html.includes("+1 día"));
  assert.ok(html.includes("días de la iniciativa al DOF") && html.includes("días del DOF al commit"));
  assert.ok(html.includes('class="tramo reg"'), "el tramo de registro, punteado");
  assert.ok(!html.includes("motivo"));

  const mapa = htmlCongresos(cad);
  assert.equal((mapa.match(/class="edo ok"/g) ?? []).length, 3);
  assert.equal((mapa.match(/class="edo sr"/g) ?? []).length, 29);
  assert.ok(mapa.includes("El SIL solo lista los congresos que aprobaron"));
  assert.ok(mapa.includes("«Sin registro» no es «en contra»"));
  assert.ok(!/en contra<\/title>/.test(mapa));
});

test("sin votos nominales: las cámaras quedan vacías con su motivo", () => {
  const cad = preparar().cadena(11);
  const sen = paso(cad, "votacion-senado");
  assert.equal(sen.fecha, undefined);
  assert.match(sen.vacio, /2 votaciones económicas y ninguna nominal/);
  assert.match(paso(cad, "votacion-camara-de-diputados").vacio, /no registra una votación nominal/);
  assert.match(paso(cad, "iniciativa").vacio, /no lista iniciativas/);
  assert.match(paso(cad, "comision").vacio, /no registra su dictamen/);
  const html = htmlCadena(cad);
  assert.ok(html.includes('<li class="paso vacio">'));
  assert.ok(html.includes('<span class="t">Senado</span>'), "un paso vacío no enlaza");
  assert.ok(html.includes("sin fecha"));
  assert.ok(!html.includes("de la iniciativa al DOF"), "el eje empieza en el primer paso con fecha");
});

test("reforma constitucional sin congresos locales registrados", () => {
  const cad = preparar().cadena(12);
  assert.match(paso(cad, "congresos").vacio, /no registra la declaratoria/);
  assert.equal(htmlCongresos(cad), "", "sin datos no hay mapa: «sin registro» no se rellena");
});

test("ley federal: sin congresos locales y con la cámara de origen primero", () => {
  const cad = preparar().cadena(21);
  assert.equal(cad.constitucional, false);
  assert.deepEqual(
    cad.pasos.map((s) => s.clave),
    ["iniciativa", "comision", "votacion-senado", "votacion-camara-de-diputados", "dof", "commit"],
  );
  assert.equal(paso(cad, "comision").quien, "Salud y Estudios Legislativos", "los turnos para dictamen de la cámara de origen");
  const dip = paso(cad, "votacion-camara-de-diputados");
  assert.equal(dip.fecha, "2026-04-29", "la que aprobó el texto publicado");
  assert.ok(!dip.dato.includes("⅔"));
  assert.equal(paso(cad, "iniciativa").quien, "Ejecutivo Federal");
  assert.equal(htmlCongresos(cad), "");
});

test("decreto sin expediente, con candidatos o resuelto por un agente: los pasos del SIL vacíos", () => {
  const { cadena } = preparar();
  const sin = cadena(13);
  for (const k of ["iniciativa", "comision", "votacion-camara-de-diputados", "votacion-senado"]) assert.match(paso(sin, k).vacio, /no se identificó su expediente/);
  assert.equal(paso(sin, "dof").vacio, undefined);
  assert.equal(paso(sin, "commit").fecha, "2026-12-02");
  assert.match(paso(cadena(14), "iniciativa").vacio, /hay 2 posibles/);
  const agente = cadena(15);
  assert.match(paso(agente, "votacion-senado").vacio, /un agente/);
  assert.equal(agente.expediente, undefined);
  assert.deepEqual(agente.iniciativas, [], "nada del expediente se usa");
});

test("página: la cadena arriba, sus secciones y el detalle", () => {
  const archivos = paginasBitacora(modelo(historial()), GENERADA, congreso());
  const html = pagina(archivos, "cpeum", 10);
  const orden = ['id="cadena"', 'id="iniciativas"', 'id="votos"', 'id="estados"', 'id="proceso"', 'id="registro"', 'id="articulos"', 'id="vida"'].map((x) => html.indexOf(x));
  assert.ok(orden.every((i) => i > 0));
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b));
  assert.ok(html.includes('<figure class="hemiciclo" data-modo="votacion">'));
  assert.ok(html.includes('<script src="/hemiciclo.js" defer></script>'));
  assert.ok(html.includes("La fuente no publica el voto de cada legislador: 86 a favor"));
  assert.ok(html.includes("Votaron distinto a la mayoría de su grupo"), "Carla votó en contra; Morena, a favor");

  // Agente: cadena vacía donde toca y sin «Quién la propuso» ni hemiciclos.
  const ag = pagina(archivos, "cpeum", 15);
  assert.ok(ag.includes('id="cadena"') && !ag.includes('id="iniciativas"') && !ag.includes('id="votos"'));
  assert.ok(ag.slice(ag.indexOf('id="proceso"')).includes("lo propuso un agente"));

  // Sin decreto ligado, la página no cambia.
  const alta = pagina(archivos, "cpeum", 9);
  assert.ok(!alta.includes('id="cadena"') && !alta.includes('id="registro"') && !alta.includes("hemiciclo.js"));
  const lgs = pagina(archivos, "lgs", 21);
  assert.ok(lgs.includes('id="cadena"') && !lgs.includes('id="estados"'));
  assert.ok(!lgs.includes('id="vida"'), "sin reformas.json no hay línea de vida");
});

test("vida de los artículos: cuadrícula y línea de vida", () => {
  const d = vidaDocumento(historial()[REPOS.cpeum].datos.reformas.cpeum, historial()[REPOS.cpeum].datos.articulos.cpeum);
  assert.equal(d.omitidas, 1, "1917 es la publicación original");
  assert.deepEqual(d.porArticulo.get("082"), ["1990-04-06", "2005-03-01", "2026-10-07"]);
  assert.deepEqual(d.articulos.map((a) => [a.etiqueta, a.fechas.length]), [["1o", 0], ["82", 3], ["116", 2]]);
  assert.equal(vidaDocumento(null, null), null);
  assert.equal(vidaDocumento([{ fecha: "1917-02-05", claves: ["001"] }], null), null);
  assert.deepEqual([0, 1, 2, 3, 5, 6, 10, 11, 20, 21].map(nivel), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);

  const svg = htmlLineaVida(d, ["082", "116"], ["2026-10-07"]);
  assert.equal((svg.match(/class="esta"/g) ?? []).length, 2, "la reforma de la página, resaltada en cada artículo");
  assert.equal((svg.match(/class="otra"/g) ?? []).length, 3);

  const archivos = paginasBitacora(modelo(historial()), GENERADA, congreso());
  // En la página de la reforma, la cuadrícula con borde en los artículos que tocó.
  const ref = pagina(archivos, "cpeum", 10);
  const vida = ref.slice(ref.indexOf('id="vida"'));
  assert.equal((vida.match(/class="art-c [^"]* esta"/g) ?? []).length, 2);
  assert.ok(vida.includes("esta reforma"));
  assert.ok(!pagina(archivos, "lgs", 21).includes('class="cuadricula"'));
  const doc = archivos.get("bitacora/cpeum/index.html");
  assert.ok(!doc.includes('class="cuadro esta"'), "en la historia del documento no se resalta nada");
  assert.ok(doc.includes('id="articulos-reformas"') && doc.includes('class="cuadricula"'));
  assert.equal((doc.match(/class="art-c /g) ?? []).length, 3);
  assert.ok(doc.includes("Las fechas de 1917 son la publicación original"));
  assert.ok(!archivos.get("bitacora/lgs/index.html").includes('class="cuadricula"'), "sin reformas.json no hay cuadrícula");
});
