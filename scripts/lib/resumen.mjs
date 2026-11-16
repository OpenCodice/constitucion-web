// Lo que el inicio y /estado dicen igual: la salud de las vigilancias y los
// cambios que publicó el sistema.

import { esc } from "./comun.mjs";

// Días sin una corrida correcta a partir de los cuales una vigilancia semanal
// se considera atrasada: una semana más un día de margen.
export const DIAS_ATRASO = 8;
export const FALLAS = ["failure", "timed_out", "startup_failure"];

export const fechaCorrida = (c) => c.run_started_at ?? c.created_at;

// Salud de una vigilancia según su última corrida terminada; las canceladas u
// omitidas no cuentan porque no dicen nada del resultado.
function saludVigilancia(w, generada) {
  const terminadas = w.corridas.filter(
    (c) => c.status === "completed" && (c.conclusion === "success" || FALLAS.includes(c.conclusion)),
  );
  const ultima = terminadas[0];
  const correcta = terminadas.find((c) => c.conclusion === "success");
  const atrasada = !correcta || Date.parse(generada) - Date.parse(fechaCorrida(correcta)) > DIAS_ATRASO * 86_400_000;
  return {
    repo: w.repo,
    ultima,
    enCurso: w.corridas.some((c) => c.status !== "completed"),
    estado: ultima && FALLAS.includes(ultima.conclusion) ? "falla" : atrasada ? "atrasada" : "ok",
  };
}

// Próximo lunes a las 09:00 UTC, la hora de la primera vigilancia de la semana.
function proximaRevision(generada) {
  const d = new Date(generada);
  const lunes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ((8 - d.getUTCDay()) % 7), 9));
  if (lunes <= d) lunes.setUTCDate(lunes.getUTCDate() + 7);
  return lunes.toISOString();
}

// Veredicto de todas las vigilancias. `clase` elige el color del badge y
// `veredicto` dice cuántas están en cada caso.
export function salud(vigilancia, generada) {
  const lecturas = Object.values(vigilancia);
  const vigilancias = lecturas
    .filter((r) => r.ok)
    .flatMap((r) => r.datos)
    .map((w) => saludVigilancia(w, generada));
  const con = (estado) => vigilancias.filter((v) => v.estado === estado);
  const fallas = con("falla");
  const atrasadas = con("atrasada");
  const sinLeer = lecturas.some((r) => !r.ok) || !vigilancias.length;
  const total = vigilancias.length;

  let clase, veredicto;
  if (fallas.length) {
    clase = "s-falla";
    veredicto = `${fallas.length}/${total} vigilancias con falla`;
  } else if (atrasadas.length) {
    clase = "s-atraso";
    veredicto = `${atrasadas.length}/${total} vigilancias atrasadas`;
  } else if (sinLeer) {
    clase = "s-atraso";
    veredicto = "Vigilancias sin leer";
  } else {
    clase = "s-ok";
    veredicto = `${total}/${total} vigilancias correctas`;
  }
  const fechas = vigilancias
    .map((v) => v.ultima && fechaCorrida(v.ultima))
    .filter(Boolean)
    .sort();
  return {
    clase,
    veredicto,
    fallas,
    atrasadas,
    sinLeer,
    enCurso: vigilancias.filter((v) => v.enCurso),
    ultimaRevision: fechas.at(-1) ?? null,
    proximaRevision: proximaRevision(generada),
  };
}

export const insignia = ({ clase, veredicto }) => `<span class="insignia ${clase}">${esc(veredicto)}</span>`;

// Tipo de cambio según el título del commit, que el pipeline escribe con un
// formato fijo («Reforma …», «Corrección de extracción …», «Alta de …»). Los
// demás commits son mantenimiento de los propios repositorios.
const TIPOS = [
  [/^Reforma\b/, "reforma", "Reforma"],
  [/^Alta\b/, "alta", "Alta"],
  [/^Corrección de extracción\b/, "correccion", "Corrección de extracción"],
  [/^Actualización automática\b/, "reforma", "Actualización"],
];

function tipoCommit(titulo) {
  const t = TIPOS.find(([re]) => re.test(titulo ?? ""));
  return t ? { clave: t[1], nombre: t[2] } : null;
}

// Cambios publicados en los repos de datos, del más reciente al más antiguo.
export function cambios(actividad) {
  return Object.entries(actividad)
    .filter(([, r]) => r.ok)
    .flatMap(([repo, r]) => r.datos.commits.map((c) => ({ ...c, repo, tipo: tipoCommit(c.titulo) })))
    .filter((c) => c.tipo)
    .sort((x, y) => y.fecha.localeCompare(x.fecha));
}

// Colores de estado y el badge. Las corridas correctas usan el verde de los
// checks de GitHub, que es lo que el status resume; el rojo marca solo lo que
// pide atención.
export const ESTILO_SALUD = `
:root { --verde: #2da44e; --rojo: #b42318; --ambar: #b7791f; }
@media (prefers-color-scheme: dark) { :root { --verde: #3fb950; --rojo: #e0605a; --ambar: #e3a33b; } }
.s-ok { --estado: var(--verde); } .s-falla { --estado: var(--rojo); } .s-atraso { --estado: var(--ambar); }
.insignia {
  display: inline-flex; align-items: center; gap: 0.4em; padding: 0.1em 0.55em; border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--estado) 35%, transparent);
  background: color-mix(in srgb, var(--estado) 8%, transparent);
  font-size: 0.7em; font-weight: 500; line-height: 1.6; white-space: nowrap;
}
.insignia::before { content: ""; width: 0.5em; height: 0.5em; border-radius: 50%; background: var(--estado); }
`;
