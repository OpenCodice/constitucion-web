// Página /estado: el estado del sistema para quien lo mantiene. Qué hay en
// cada repo de datos, las corridas de vigilancia, los cambios por día y los
// PR abiertos. La lista de leyes para el público está en /leyes.

import {
  ORG,
  REPOS,
  TOTAL_INDICE_FEDERAL,
  esc,
  numero,
  fechaLarga,
  momento,
  momentoCorto,
  textoCorto,
  diaMexico,
  sumarDias,
  dia,
  masReciente,
  enlaceRepo,
  plural,
  lista,
  tabla,
  fallo,
  documento,
} from "./lib/comun.mjs";
import { CORRIDAS, SEMANAS, inicioActividad } from "./lib/datos.mjs";

const ESTADO_CORRIDA = {
  queued: "En cola",
  in_progress: "En curso",
  waiting: "En espera",
  pending: "Pendiente",
  requested: "Solicitada",
};
const CONCLUSION = {
  success: "Correcta",
  failure: "Falló",
  cancelled: "Cancelada",
  skipped: "Omitida",
  timed_out: "Excedió el tiempo",
  action_required: "Requiere acción",
  neutral: "Neutral",
  startup_failure: "No arrancó",
  stale: "Vencida",
};
const EVENTO = { schedule: "programada", workflow_dispatch: "manual", push: "push", pull_request: "PR" };

function estadoCorrida(c) {
  if (c.status !== "completed") return ESTADO_CORRIDA[c.status] ?? c.status;
  return CONCLUSION[c.conclusion] ?? c.conclusion ?? "Terminada";
}

// ------------------------------------------------------------------ página

function seccionResumen({ cpeum, estatales, fiscal, federales, commits }) {
  const ultimo = (repo) => {
    const r = commits[repo];
    return r.ok && r.datos ? `<a href="${esc(r.datos.url)}">${momentoCorto(r.datos.fecha)}</a>` : "—";
  };
  const filas = [];
  const avisos = [];

  if (cpeum.ok) {
    filas.push([
      enlaceRepo(REPOS.cpeum, "Constitución federal"),
      "1",
      numero(cpeum.datos.articulos),
      dia(cpeum.datos.version),
      ultimo(REPOS.cpeum),
    ]);
  } else avisos.push(fallo(`${ORG}/${REPOS.cpeum}`, cpeum));

  if (estatales.ok) {
    const pub = estatales.datos.filter((e) => e.articulos != null);
    filas.push([
      enlaceRepo(REPOS.estatales, "Constituciones estatales"),
      `${pub.length} de 32`,
      numero(pub.reduce((s, e) => s + e.articulos, 0)),
      dia(masReciente(pub.map((e) => e.version))),
      ultimo(REPOS.estatales),
    ]);
  } else avisos.push(fallo(`${ORG}/${REPOS.estatales}`, estatales));

  if (fiscal.ok) {
    filas.push([
      enlaceRepo(REPOS.fiscal, "Legislación fiscal"),
      numero(fiscal.datos.length),
      numero(fiscal.datos.reduce((s, d) => s + (d.num_articulos ?? 0), 0)),
      dia(masReciente(fiscal.datos.map((d) => d.version))),
      ultimo(REPOS.fiscal),
    ]);
  } else avisos.push(fallo(`${ORG}/${REPOS.fiscal}`, fiscal));

  if (federales.ok) {
    const inc = federales.datos.filter((d) => d.estado === "incluida");
    filas.push([
      enlaceRepo(REPOS.federales, "Leyes federales"),
      `${numero(inc.length)} de ${numero(Math.max(TOTAL_INDICE_FEDERAL, federales.datos.length))}`,
      numero(inc.reduce((s, d) => s + (d.unidades ?? 0), 0)),
      dia(masReciente(inc.map((d) => d.version))),
      ultimo(REPOS.federales),
    ]);
  } else avisos.push(fallo(`${ORG}/${REPOS.federales}`, federales));

  return `<h2 id="resumen">Qué hay publicado</h2>
${tabla({
  id: "t-resumen",
  titulo: "Corpus publicados",
  columnas: [
    { titulo: "Corpus" },
    { titulo: "Documentos", num: true },
    { titulo: "Artículos", num: true },
    { titulo: "Reforma más reciente" },
    { titulo: "Último commit" },
  ],
  filas,
})}
${avisos.join("\n")}
<p class="tenue">
  La lista de cada documento, con sus reformas, está en <a href="/leyes">Qué leyes hay</a>.
  “Reforma más reciente” es la fecha de publicación oficial más reciente entre los documentos
  del corpus. En la legislación fiscal la cifra de artículos cuenta unidades: también reglas,
  fichas y criterios.
</p>`;
}

// Lo que no cabe en la tabla de resumen: estados que faltan y el avance de
// las leyes federales. Las listas completas están en /leyes.
function seccionCorpus({ estatales, federales }) {
  const partes = [];
  if (estatales.ok) {
    const pub = estatales.datos.filter((e) => e.articulos != null);
    const faltan = estatales.datos.length - pub.length;
    partes.push(`<p>
  <strong>Constituciones estatales:</strong> ${lista(pub.map((e) => esc(e.nombre))) || "ninguna"}, en
  <code>{estado}/constitucion/</code> de ${enlaceRepo(REPOS.estatales)}.
  ${faltan > 0 ? `Faltan ${plural(faltan, "entidad", "entidades")}, sin fecha comprometida.` : ""}
</p>`);
  }
  if (federales.ok) {
    const docs = federales.datos;
    const inc = docs.filter((d) => d.estado === "incluida");
    const exc = docs.filter((d) => d.estado === "excluida");
    const total = Math.max(TOTAL_INDICE_FEDERAL, docs.length);
    const faltan = total - docs.length;
    const reparadas = inc.filter((d) => d.alta?.via === "reparada").length;
    const pendientes = inc.filter((d) => d.revision_pendiente).length;
    partes.push(`<p>
  <strong>Leyes federales:</strong> de ${numero(total)} documentos (el índice de la Cámara de
  Diputados más los reglamentos fiscales), ${numero(inc.length)} están en
  ${enlaceRepo(REPOS.federales)}${reparadas ? ` (${plural(reparadas, "entró", "entraron")} tras una reparación del extractor)` : ""},
  ${numero(exc.length)} quedaron excluidas y ${faltan > 0 ? `${numero(faltan)} faltan por procesar` : "ninguna falta por procesar"}.
  ${pendientes ? `${plural(pendientes, "publicada tiene", "publicadas tienen")} <code>revision_pendiente</code>.` : ""}
</p>`);
  }
  if (!partes.length) return "";
  return `${partes.join("\n")}
<p>Las listas completas, con el motivo de cada exclusión, están en <a href="/leyes">Qué leyes hay</a>.</p>`;
}

// Tipo de barra por resultado. La falla es la única en color y además más alta,
// para que no dependa solo del color.
function claseCorrida(c) {
  if (c.status !== "completed") return "b-curso";
  if (["failure", "timed_out", "startup_failure"].includes(c.conclusion)) return "b-falla";
  if (c.conclusion === "success") return "b-ok";
  return "b-omitida";
}

const LEYENDA_BARRAS = `<p class="leyenda" aria-hidden="true">
  <span><span class="barra b-ok"></span> Correcta</span>
  <span><span class="barra b-falla"></span> Falló</span>
  <span><span class="barra b-omitida"></span> Cancelada u omitida</span>
  <span><span class="barra b-curso"></span> En curso</span>
</p>`;

function filaVigilancia(w, varias) {
  // La API las da de la más reciente a la más antigua.
  const corridas = w.corridas.slice(0, CORRIDAS).reverse();
  const nombre = `${enlaceRepo(w.repo, w.repo)}${varias ? ` <a class="tenue" href="${esc(w.url)}">${esc(w.archivo)}</a>` : ""}`;
  if (!corridas.length) {
    return `<div class="vigilancia"><p class="vig-nombre">${nombre}</p><p class="vig-resumen">Sin corridas.</p></div>`;
  }
  const cuenta = (clase) => corridas.filter((c) => claseCorrida(c) === clase).length;
  const ok = cuenta("b-ok");
  const ultima = corridas.at(-1);
  const inicio = CORRIDAS - corridas.length + 1;
  const barras = corridas
    .map((c, i) => {
      const fecha = c.run_started_at ?? c.created_at;
      const texto = `${textoCorto(fecha)}: ${estadoCorrida(c)}, ${EVENTO[c.event] ?? c.event}`;
      const pos = i === 0 && inicio > 1 ? ` style="grid-column-start: ${inicio}"` : "";
      return `<li${pos}><a class="barra ${claseCorrida(c)}" href="${esc(c.html_url)}" title="${esc(texto)}" aria-label="${esc(texto)}"></a></li>`;
    })
    .join("");
  const detalle = [
    [cuenta("b-falla"), "fallida", "fallidas"],
    [cuenta("b-omitida"), "cancelada u omitida", "canceladas u omitidas"],
    [cuenta("b-curso"), "en curso", "en curso"],
  ]
    .filter(([n]) => n)
    .map(([n, uno, varios]) => plural(n, uno, varios));
  return `<div class="vigilancia">
<p class="vig-nombre">${nombre}</p>
<ol class="barras" aria-label="Últimas ${corridas.length} corridas de ${esc(w.archivo)}, de la más antigua a la más reciente">${barras}</ol>
<p class="vig-resumen">${numero(ok)} de ${numero(corridas.length)} correctas${
    detalle.length ? `<span class="oculto"> (${detalle.join(", ")})</span>` : ""
  } · última: <a href="${esc(ultima.html_url)}">${esc(estadoCorrida(ultima).toLowerCase())}</a>, ${momentoCorto(
    ultima.run_started_at ?? ultima.created_at,
  )}</p>
</div>`;
}

function seccionProgreso({ vigilancia, prs }) {
  const filasV = [];
  const avisos = [];
  for (const [repo, r] of Object.entries(vigilancia)) {
    if (!r.ok) {
      avisos.push(fallo(`la vigilancia de ${ORG}/${repo}`, r));
      continue;
    }
    for (const w of r.datos) filasV.push(filaVigilancia(w, r.datos.length > 1));
  }

  const filasP = [];
  for (const [repo, r] of Object.entries(prs)) {
    if (!r.ok) {
      avisos.push(fallo(`los PR de ${ORG}/${repo}`, r));
      continue;
    }
    for (const p of r.datos) {
      const etiquetas = p.labels.map((l) => esc(l.name)).join(", ");
      filasP.push([
        `<a href="${esc(p.html_url)}">#${p.number}</a>`,
        esc(repo),
        esc(p.title) + (p.draft ? ' <span class="tenue">(borrador)</span>' : ""),
        etiquetas || "—",
        momentoCorto(p.created_at),
      ]);
    }
  }

  return `<h2 id="progreso">En progreso</h2>
<p>
  Cada lunes a las 09:00 UTC un workflow de vigilancia por repositorio descarga los PDF
  oficiales y vuelve a extraer el texto. Si algo cambió, abre un pull request: se fusiona
  solo cuando la extracción quedó verificada y, si no, queda como borrador para revisión.
</p>
<h3>Últimas corridas de cada vigilancia</h3>
${filasV.length ? `${LEYENDA_BARRAS}\n${filasV.join("\n")}` : '<p class="tenue">No se encontraron workflows de vigilancia.</p>'}
${tabla({
  id: "t-prs",
  titulo: "Pull requests abiertos",
  columnas: [
    { titulo: "PR" },
    { titulo: "Repositorio" },
    { titulo: "Título" },
    { titulo: "Etiquetas" },
    { titulo: "Abierto" },
  ],
  filas: filasP,
  vacio: "No hay pull requests abiertos en los repositorios de datos.",
})}
${avisos.join("\n")}`;
}

// Intensidad de cada día según archivos cambiados; los cortes son potencias de
// diez porque una alta de leyes cambia miles de archivos y una reforma, unos
// cuantos. Sin la cuenta de archivos se usan commits.
const NIVELES_ARCHIVOS = [[1, "1 a 9"], [10, "10 a 99"], [100, "100 a 999"], [1000, "1,000 o más"]];
const NIVELES_COMMITS = [[1, "1"], [2, "2"], [3, "3 o 4"], [5, "5 o más"]];
const DIAS_SEMANA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function seccionActividad(actividad, generada) {
  const titulo = '<h2 id="actividad">Cambios en los datos</h2>';
  const leidos = Object.entries(actividad).filter(([, r]) => r.ok);
  const avisos = Object.entries(actividad)
    .filter(([, r]) => !r.ok)
    .map(([repo, r]) => fallo(`los commits de ${ORG}/${repo}`, r));
  if (!leidos.length) return `${titulo}\n${avisos.join("\n")}`;

  const conArchivos = leidos.every(([, r]) => r.datos.conArchivos);
  const { hoy, inicio } = inicioActividad(generada);
  const porDia = {};
  for (const [, r] of leidos) {
    for (const c of r.datos.commits) {
      const d = diaMexico(c.fecha);
      if (d < inicio || d > hoy) continue;
      const v = (porDia[d] ??= { commits: 0, archivos: 0, incompleto: false });
      v.commits++;
      if (c.archivos == null) v.incompleto = true;
      else v.archivos += c.archivos;
    }
  }
  const niveles = conArchivos ? NIVELES_ARCHIVOS : NIVELES_COMMITS;
  const nivel = (v) => {
    if (!v?.commits) return 0;
    const x = conArchivos ? v.archivos : v.commits;
    return Math.max(1, niveles.filter(([corte]) => x >= corte).length);
  };
  const describir = (d, v) => {
    const cuando = `${d} (${DIAS_SEMANA[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]})`;
    if (!v) return `${cuando}: sin cambios`;
    const archivos = conArchivos ? `, ${numero(v.archivos)}${v.incompleto ? " o más" : ""} ${v.archivos === 1 ? "archivo" : "archivos"}` : "";
    return `${cuando}: ${plural(v.commits, "commit", "commits")}${archivos}`;
  };

  // Etiqueta de mes en la primera semana de cada mes; se omite la de un mes
  // que apenas asoma al inicio, para que no se encime con la siguiente.
  const meses = [];
  for (let semana = 0; semana < SEMANAS; semana++) {
    const mes = Number(sumarDias(inicio, semana * 7).slice(5, 7)) - 1;
    if (meses.at(-1)?.mes !== mes) meses.push({ semana, mes });
  }
  if (meses.length > 1 && meses[1].semana < 3) meses.shift();
  const celdas = meses.map(
    ({ semana, mes }) => `<span class="mes" style="grid-column: ${semana + 2}">${MESES[mes]}</span>`,
  );
  for (let semana = 0; semana < SEMANAS; semana++) {
    const lunes = sumarDias(inicio, semana * 7);
    for (let dia = 0; dia < 7; dia++) {
      const d = sumarDias(lunes, dia);
      if (d > hoy) break;
      const v = porDia[d];
      celdas.push(
        `<span class="c n${nivel(v)}" style="grid-area: ${dia + 2} / ${semana + 2}" title="${esc(describir(d, v))}"></span>`,
      );
    }
  }
  for (const dia of [0, 2, 4]) {
    celdas.push(`<span class="dia-sem" style="grid-row: ${dia + 2}">${DIAS_SEMANA[dia]}</span>`);
  }

  const dias = Object.entries(porDia);
  const commits = dias.reduce((s, [, v]) => s + v.commits, 0);
  const archivos = dias.reduce((s, [, v]) => s + v.archivos, 0);
  const pico = dias.sort(([, a], [, b]) => (conArchivos ? b.archivos - a.archivos : b.commits - a.commits))[0];
  const resumen =
    `Del ${fechaLarga(inicio)} al ${fechaLarga(hoy)}: ${plural(commits, "commit", "commits")}` +
    (conArchivos ? ` y ${plural(archivos, "archivo cambiado", "archivos cambiados")}` : "") +
    ` en ${plural(dias.length, "día", "días")}` +
    (pico ? `. El día con más cambios fue el ${fechaLarga(pico[0])} (${describir(pico[0], pico[1]).split(": ")[1]}).` : ".");
  const unidad = conArchivos ? "archivos cambiados" : "commits";
  const muestras = [
    `<span><span class="c n0"></span> ninguno</span>`,
    ...niveles.map(([, etiqueta], i) => `<span><span class="c n${i + 1}"></span> ${esc(etiqueta)}</span>`),
  ].join(" ");

  return `${titulo}
<p>
  Cada cuadro es un día de las últimas ${SEMANAS} semanas, en los cuatro repositorios de datos
  juntos; las columnas son semanas y las filas, días. Cuenta los commits de <code>main</code>,
  también los de mantenimiento de los propios repositorios.
</p>
<figure class="actividad">
<div class="cuadricula" role="img" aria-label="${esc(`Cambios por día en los repositorios de datos. ${resumen}`)}">
${celdas.join("\n")}
</div>
<figcaption>
<p class="leyenda" aria-hidden="true"><span>${conArchivos ? "Archivos cambiados por día:" : "Commits por día:"}</span> ${muestras}</p>
<p>${esc(resumen)}</p>
${
  conArchivos
    ? `<p class="tenue">Los archivos incluyen el texto de los artículos y la metadata que se genera con él.</p>`
    : `<p class="tenue">La API no dio la cuenta de archivos de cada commit, así que la intensidad cuenta ${unidad}.</p>`
}
</figcaption>
</figure>
${avisos.join("\n")}`;
}

const ESTILO = `
/* Colores de los visuales. El rojo es el único color de la página y solo
   marca lo que pide atención. */
:root {
  --barra: #7a7a7a;
  --rojo: #b42318;
  --n0: #ececec; --n1: #c6c6c6; --n2: #969696; --n3: #5c5c5c; --n4: #111111;
}
@media (prefers-color-scheme: dark) {
  :root {
    --barra: #8c8c8c;
    --rojo: #e0605a;
    --n0: #1d1d1d; --n1: #3c3c3c; --n2: #6a6a6a; --n3: #a6a6a6; --n4: #f2f2f2;
  }
}


.vigilancia { display: grid; grid-template-columns: 12rem 1fr; gap: 0.3rem 1rem; align-items: end; margin: 0 0 1rem; font-size: 0.85em; }
.vig-nombre, .vig-resumen { margin: 0; }
.vig-resumen { grid-column: 2; color: var(--tenue); font-size: 0.9em; }
.barras { display: grid; grid-template-columns: repeat(${CORRIDAS}, 1fr); gap: 2px; height: 2.2rem; margin: 0; padding: 0; list-style: none; }
.barras li { display: flex; align-items: flex-end; margin: 0; min-width: 0; }
.barra { display: block; width: 100%; height: 60%; border-radius: 1px; background: var(--barra); }
.barra.b-falla { height: 100%; background: var(--rojo); }
.barra.b-omitida { background: transparent; box-shadow: inset 0 0 0 1px var(--tenue); }
.barra.b-curso { background: repeating-linear-gradient(135deg, var(--barra) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--barra); }
a.barra:hover, a.barra:focus-visible { outline: 2px solid var(--texto); outline-offset: 1px; }
.leyenda .barra { display: inline-block; width: 0.55rem; height: 0.75rem; }
.leyenda .barra.b-falla { height: 1.15rem; }
@media (max-width: 36rem) {
  .vigilancia { grid-template-columns: 1fr; }
  .vig-resumen { grid-column: 1; }
  .barras { gap: 1px; }
}

.actividad { margin: 0 0 1.5em; }
.cuadricula { display: grid; grid-template-columns: 1.9rem repeat(${SEMANAS}, minmax(0, 1fr)); gap: 3px; max-width: 34rem; font-size: 0.7em; color: var(--tenue); }
.cuadricula .c { aspect-ratio: 1; border-radius: 2px; }
.mes { grid-row: 1; white-space: nowrap; line-height: 1.6; }
.dia-sem { grid-column: 1; line-height: 1; align-self: center; }
.c { display: inline-block; background: var(--n0); }
.leyenda .c { width: 0.8rem; height: 0.8rem; border-radius: 2px; }
.n1 { background: var(--n1); } .n2 { background: var(--n2); } .n3 { background: var(--n3); } .n4 { background: var(--n4); }
.actividad figcaption { margin-top: 0.8em; font-size: 0.85em; }
.actividad figcaption p { margin: 0 0 0.5em; }
@media (max-width: 36rem) { .cuadricula { gap: 2px; } }
`;

export function paginaEstado(datos, generada) {
  const cuerpo = `      <p>
        Estado técnico de OpenCodice: qué hay en cada repositorio de datos, cómo van los
        workflows de vigilancia y qué cambió en los últimos meses. Para la lista de leyes, sin
        detalles técnicos, ve <a href="/leyes">Qué leyes hay</a>.
      </p>
      <p class="generada">Generada el ${momento(generada)}. Se actualiza cada tres horas. Todas las horas son de la Ciudad de México.</p>

${seccionResumen(datos)}

${seccionCorpus(datos)}

${seccionProgreso(datos)}

${seccionActividad(datos.actividad, generada)}`;
  return documento({
    titulo: "Estado del sistema — OpenCodice",
    h1: "Estado del sistema",
    descripcion:
      "Estado técnico de OpenCodice: repositorios de datos, corridas de vigilancia, cambios por día y pull requests abiertos.",
    estilo: ESTILO,
    cuerpo,
    pie: `<p>
          <a href="/">Inicio</a> · <a href="/leyes">Qué leyes hay</a> · El código y los datos están en
          <a href="https://github.com/${ORG}">github.com/${ORG}</a>.
        </p>`,
  });
}
