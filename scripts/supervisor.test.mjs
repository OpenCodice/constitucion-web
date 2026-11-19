// La sección «Supervisor» de /estado, con un estado sintético del supervisor.

import test from "node:test";
import assert from "node:assert/strict";
import { htmlSupervisor, lineas, modelo, ultimaCorrida } from "../public/supervisor.js";

const AHORA = "2026-11-19T03:00:00Z";

const latido = {
  cuando: "2026-11-19T02:15:27Z",
  modo: "actuar",
  huellas_abiertas: 3,
  invariantes: { I1: "rota:1", I10: "sin-observar", I2: "rota:2", I3: "ok", I7: "apagada", I14: "ok" },
  motivos: { I10: "sin el token del Worker" },
  sin_observar: [],
};

const huellas = [
  // Una cita que se acaba de lanzar: abierta, pero no es una falla.
  { huella: "aaa", invariante: "I1", estado: "abierta", errores: 0, intentos_agente: 0, lanzamientos: 1, primera: "2026-11-19T02:00:00Z", repo: "congreso-extractor", workflow: "actualizar-congreso.yml" },
  { huella: "bbb", invariante: "I2", estado: "abierta", clase: "desconocida", errores: 0, primera: "2026-11-18T10:00:00Z", repo: "fiscal-extractor", workflow: "vigilar-fiscal.yml" },
  { huella: "bbb", invariante: "I2", estado: "resuelta", clase: "desconocida", errores: 0, primera: "2026-11-18T10:00:00Z", repo: "fiscal-extractor", workflow: "vigilar-fiscal.yml" },
  { huella: "ccc", invariante: "I2", estado: "agotada", clase: "determinista", issue: 2, errores: 0, intentos_agente: 1, primera: "2026-11-18T16:01:17Z", repo: "fiscal-extractor", workflow: "expandir-estatales.yml", job: "ronda", paso: "Elegir <el> estado", firma: "cd: /tmp/extractor: No such file <script>alert(1)</script>" },
  { huella: "ddd", invariante: "I2", estado: "resuelta", clase: "determinista", issue: 1, primera: "2026-11-18T13:00:00Z", repo: "congreso-extractor", workflow: "actualizar-congreso.yml", paso: "Leer" },
  { huella: "eee", invariante: "I2", estado: "datos", clase: "datos", primera: "2026-11-18T13:00:00Z", repo: "fiscal-extractor", workflow: "vigilar-federal.yml" },
];

const acciones = [
  { accion: "lanzar", cuando: "2026-11-18T14:00:00Z", huella: "aaa", resultado: "ok" },
  { accion: "arreglo-publicado", cuando: "2026-11-18T15:06:39Z", huella: "ddd", resultado: "ok", detalle: { repo: "congreso-extractor", workflow: "actualizar-congreso.yml", commit: "b805a240f8dc2435afb5c67f1641f4f39fe9fd6d" } },
  { accion: "arreglo-publicado", cuando: "2026-11-18T12:00:00Z", huella: "fff", resultado: "ok", detalle: { repo: "fiscal-extractor", workflow: "vigilar-fiscal.yml", commit: "0123abc" } },
  { accion: "revertido", cuando: "2026-11-18T13:00:00Z", huella: "fff", resultado: "ok" },
  { accion: "arreglo-publicado", cuando: "2026-11-18T11:00:00Z", huella: "ggg", resultado: "ok", detalle: { repo: "x/../y", commit: "javascript:alert(1)" } },
];

const corrida = { inicio: "2026-11-19T02:45:18Z", conclusion: "success", url: "https://github.com/OpenCodice/supervisor/actions/runs/1" };

test("lineas salta lo que no es un registro completo", () => {
  assert.deepEqual(lineas('{"a":1}\n\n{"b":2}\n{"c":'), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(lineas(null), []);
});

test("ultimaCorrida toma la última terminada y solo enlaza a GitHub", () => {
  const c = ultimaCorrida({
    workflow_runs: [
      { status: "in_progress", created_at: "2026-11-19T03:00:00Z" },
      { status: "completed", conclusion: "success", run_started_at: "2026-11-19T02:45:18Z", html_url: "https://example.com/x" },
    ],
  });
  assert.deepEqual(c, { inicio: "2026-11-19T02:45:18Z", conclusion: "success", url: null });
  assert.equal(ultimaCorrida(null), null);
});

test("solo cuentan como fallas las huellas abiertas con un error, no lo recién lanzado", () => {
  const m = modelo({ latido, huellas, acciones, corrida }, AHORA);
  assert.deepEqual(m.fallas.map((h) => h.huella), ["ccc"]);
  assert.equal(m.enCurso, 1);
  assert.deepEqual(m.latido.invariantes.map((i) => i.clave), ["I1", "I2", "I3", "I7", "I10", "I14"]);
  assert.deepEqual(m.arreglos.map((a) => a.resultado), ["Resolvió la falla", "Revertido: no resolvió la falla", "—"]);
  assert.equal(m.atraso, null);
});

test("un latido de hace horas es normal; sin vueltas en una hora, no", () => {
  const viejo = { ...latido, cuando: "2026-11-18T05:00:00Z" };
  assert.equal(modelo({ latido: viejo, huellas, acciones, corrida }, AHORA).atraso, null);
  assert.equal(modelo({ latido: viejo, huellas, acciones, corrida: null }, AHORA).atraso, null);
  const sinVueltas = { ...corrida, inicio: "2026-11-19T01:30:00Z" };
  assert.equal(modelo({ latido, huellas, acciones, corrida: sinVueltas }, AHORA).atraso, sinVueltas.inicio);
  // Sin la corrida, el latido solo delata al supervisor pasado su día.
  const caducado = { ...latido, cuando: "2026-11-18T01:00:00Z" };
  assert.equal(modelo({ latido: caducado, huellas, acciones, corrida: null }, AHORA).atraso, caducado.cuando);
});

test("la sección enlaza la constancia y el commit, y escapa lo que lee", () => {
  const html = htmlSupervisor({ latido, huellas, acciones, corrida }, AHORA);
  assert.match(html, /insignia s-falla">1 falla abierta</);
  assert.match(html, /href="https:\/\/github\.com\/OpenCodice\/supervisor\/issues\/2"/);
  assert.match(html, /congreso-extractor\/commit\/b805a240f8dc2435afb5c67f1641f4f39fe9fd6d"><code>b805a24</);
  assert.match(html, /Sin observar<\/span> <span class="tenue">\(sin el token del Worker\)/);
  assert.match(html, /1 lanzamiento espera su resultado/);
  assert.doesNotMatch(html, /<script>|javascript:|x\/\.\.\/y/);
  assert.match(html, /Paso «Elegir &lt;el&gt; estado»/);
});

test("sin fallas el veredicto es verde, y lo que no se leyó se dice", () => {
  const sano = { ...latido, invariantes: { I1: "ok", I2: "ok" }, motivos: {} };
  assert.match(htmlSupervisor({ latido: sano, huellas: [], acciones: [], corrida }, AHORA), /s-ok">Sin fallas abiertas</);
  const nada = htmlSupervisor({ latido: null, huellas: null, acciones: null, corrida: null }, AHORA);
  assert.match(nada, /s-atraso">Estado sin leer</);
  assert.match(nada, /No se pudo leer el estado del supervisor/);
  assert.match(nada, /No se pudieron leer las fallas/);
});
