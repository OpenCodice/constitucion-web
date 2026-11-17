// Hemiciclos: geometría, quién va en cada asiento y composición de las cámaras.
//   node --test scripts/

import { test } from "node:test";
import assert from "node:assert/strict";
import { modeloCongreso } from "./lib/congreso.mjs";
import { asientos, asientosVotacion, claveGrupo, composicion, svgHemiciclo, svgMini } from "./lib/hemiciclo.mjs";
import { paginasCongreso } from "./congreso.mjs";

test("geometría: n asientos sin encimarse, de izquierda a derecha", () => {
  for (const n of [1, 2, 7, 128, 499, 500]) {
    const xs = asientos(n);
    assert.equal(xs.length, n, `n=${n}`);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i - 1].angulo >= xs[i].angulo);
    for (const p of xs) assert.ok(p.y >= -1e-9 && Math.hypot(p.x, p.y) <= 1 + 1e-9);
    // Ningún par de asientos se toca.
    if (n <= 500) {
      for (let i = 0; i < xs.length; i++)
        for (let j = i + 1; j < xs.length; j++) assert.ok(Math.hypot(xs[i].x - xs[j].x, xs[i].y - xs[j].y) > 2 * xs[i].r, `n=${n}: ${i} y ${j}`);
    }
  }
  assert.deepEqual(asientos(0), []);
});

test("grupos: por partido ligado o por el nombre de la fuente", () => {
  assert.equal(claveGrupo("partido-morena", "MORENA"), "morena");
  assert.equal(claveGrupo(null, "PAN"), "pan");
  assert.equal(claveGrupo(null, "Morena"), "morena");
  assert.equal(claveGrupo(null, "Ind."), "sg");
  assert.equal(claveGrupo(null, "Sin Partido"), "sg");
  assert.equal(claveGrupo("partido-desconocido", null), "sg");
});

const persona = (id, given, family) => ({ id, name: `${given} ${family}`, given_name: given, family_name: family });

function modelo({ votes, votos_faltantes, mandatos = [] }) {
  return modeloCongreso({
    organizaciones: [],
    personas: [persona("a", "Ana", "Arce"), persona("b", "Beto", "Bravo"), persona("c", "Carla", "Cruz"), persona("d", "Dora", "Díaz"), persona("e", "Eva", "Ezeta"), persona("f", "Fede", "Flores")],
    mandatos,
    expedientes: [],
    votaciones: [{ id: "sil-1-1", start_date: "2026-09-29", organization_id: "senado", camara: "senado", legislative_period_id: "lxvi", votos_publicados: true, votes, votos_faltantes, counts: [] }],
    decretos: [],
  });
}
const voto = (voter_id, option, partido) => ({ voter_id, option, group_id: partido ? `partido-${partido}` : null, grupo_fuente: partido ? partido.toUpperCase() : "Ind." });

test("votación: un asiento por voto más uno por cada voto sin atribuir, sin nombre", () => {
  const m = modelo({
    votes: [voto("a", "yes", "pan"), voto("b", "no", "morena"), voto("c", "yes", "morena"), voto("d", "absent", null)],
    votos_faltantes: [{ grupo: "PAN", option: "yes", value: 2, nombres_fuente: ["Sen. X"] }],
  });
  const xs = asientosVotacion(m, m.votaciones.get("sil-1-1"));
  assert.equal(xs.length, 6);
  const sinNombre = xs.filter((x) => !x.persona);
  assert.equal(sinNombre.length, 2);
  for (const x of sinNombre) {
    assert.equal(x.grupo, "pan");
    assert.equal(x.sentido, "yes");
    assert.equal(x.nombre, null);
  }
  // Cada grupo contiguo y en el orden fijo de los sectores (Morena antes que PAN; sin grupo al final).
  assert.deepEqual(xs.map((x) => x.grupo), ["morena", "morena", "pan", "pan", "pan", "sg"]);
  const svg = svgHemiciclo(xs, { modo: "votacion", etiqueta: "x" });
  assert.equal((svg.match(/<circle /g) ?? []).length, 6);
  assert.equal((svg.match(/<a href="\/congreso\/legisladores\//g) ?? []).length, 4);
  assert.equal((svg.match(/<g class="sn"/g) ?? []).length, 2);
  assert.match(svg, /la fuente lo cuenta y no dice quién/);
  assert.ok(!svg.includes("Sen. X"), "un voto sin atribuir no lleva nombre");
});

test("votación: se marca a quien vota distinto a la mayoría de su grupo", () => {
  const m = modelo({
    votes: [voto("a", "yes", "morena"), voto("b", "yes", "morena"), voto("c", "no", "morena"), voto("d", "absent", "morena"), voto("e", "yes", "pan"), voto("f", "no", "pan")],
  });
  const xs = asientosVotacion(m, m.votaciones.get("sil-1-1"));
  const d = xs.filter((x) => x.disidente).map((x) => x.persona);
  // En Morena la mayoría es a favor: Carla votó en contra; Dora faltó (no cuenta). El PAN empata: sin mayoría, nadie.
  assert.deepEqual(d, ["c"]);
  assert.equal(xs.find((x) => x.persona === "c").mayoria, "yes");
  assert.match(svgHemiciclo(xs, { modo: "votacion", etiqueta: "x" }), /class="v1 d"/);
});

test("composición: cuenta a quien está en funciones según el SIL, propietario o suplente", () => {
  const mandato = (id, person_id, calidad, estatus, extra = {}) => ({
    id,
    person_id,
    organization_id: "senado",
    legislative_period_id: "lxvi",
    on_behalf_of_id: "partido-pan",
    partido_fuente: "PAN",
    calidad,
    estatus,
    licencias: [],
    sources: [{ consultado: "2026-11-17T05:00:00Z" }],
    ...extra,
  });
  const m = modelo({
    votes: [],
    mandatos: [
      // Ana pidió licencia y entró su suplente Beto.
      mandato("sil-1", "a", "propietario", "Baja(a)", { formula_id: "sil-2", licencias: [{ tipo: "Licencia por tiempo indefinido", inicio: "2025-01-01", fin: null, en_funciones: "Suplente", estatus: "Baja" }] }),
      mandato("sil-2", "b", "suplente", "Activo(a)"),
      // Carla se reincorporó: cuenta ella, no su suplente.
      mandato("sil-3", "c", "propietario", "Activo(a)", { formula_id: "sil-4", licencias: [{ tipo: "Reincorporación", inicio: "2025-06-01", fin: null, en_funciones: "Propietario", estatus: "Activo" }] }),
      mandato("sil-4", "d", "suplente", "Baja(a)"),
      mandato("sil-5", "e", "propietario", "(a)"),
      mandato("sil-6", "f", "propietario", "Activo(a)", { on_behalf_of_id: null, partido_fuente: "Sin Partido" }),
      // Una legislatura anterior no cuenta.
      { ...mandato("sil-7", "a", "propietario", "Activo(a)"), legislative_period_id: "lxv" },
    ],
  });
  const c = composicion(m, "senado");
  assert.equal(c.legislatura, "lxvi");
  assert.equal(c.total, 3);
  assert.equal(c.esperado, 128);
  assert.equal(c.suplentes, 1);
  assert.equal(c.formulasDobles, 0);
  assert.deepEqual(c.asientos.map((x) => x.persona).sort(), ["b", "c", "f"]);
  assert.deepEqual(c.fuera, [["Baja", 2], ["sin estatus", 1]]);
  assert.equal(c.asientos.at(-1).grupo, "sg");
  const mini = svgMini(c.asientos, { modo: "composicion", etiqueta: "x", resaltar: 0 });
  assert.equal((mini.match(/h0/g) ?? []).length, 3);
  assert.match(mini, /class="anillo"/);
});

test("páginas: hemiciclo en la votación, composición que dice si no cuadra", () => {
  const m = modelo({
    votes: [voto("a", "yes", "pan"), voto("b", "no", "pan"), voto("c", "yes", "pan")],
    votos_faltantes: [{ grupo: "PAN", option: "yes", value: 1 }],
    mandatos: [
      { id: "sil-1", person_id: "a", organization_id: "senado", legislative_period_id: "lxvi", on_behalf_of_id: "partido-pan", calidad: "propietario", estatus: "Activo(a)", licencias: [] },
    ],
  });
  const p = paginasCongreso({ ok: true, ...m }, "2026-11-17T12:00:00Z");
  const v = p.get("congreso/votaciones/sil-1-1.html");
  assert.match(v, /<script src="\/hemiciclo.js" defer><\/script>/);
  assert.match(v, /<figure class="hemiciclo" data-modo="votacion">/);
  assert.match(v, /role="group" aria-label="Hemiciclo de la votación: 3 a favor y 1 en contra/);
  assert.match(v, /Votaron distinto a la mayoría de su grupo/);
  const c = p.get("congreso/camaras.html");
  assert.match(c, /Da 1, no los 128 que fija la Constitución/);
  assert.match(p.get("congreso/index.html"), /class="mini-svg/);
  assert.ok(!p.get("congreso/index.html").includes("hemiciclo.js"), "las miniaturas no necesitan JavaScript");
  assert.match(p.get("congreso/legisladores/a.html"), /En funciones en el Senado/);
});
