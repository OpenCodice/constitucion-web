// Página /estado: el status del sistema. La salud de las vigilancias, lo que
// han publicado, qué hay en cada repo de datos y el historial semanal de cada
// vigilancia. La lista de leyes para el público está en /leyes.

import {
  ORG,
  REPOS,
  TOTAL_INDICE_FEDERAL,
  esc,
  numero,
  momento,
  momentoCorto,
  fechaLarga,
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
  anclaTip,
} from "./lib/comun.mjs";
import { SEMANAS, inicioActividad } from "./lib/datos.mjs";
import { DIAS_ATRASO, FALLAS, ESTILO_SALUD, fechaCorrida, salud, insignia, cambios } from "./lib/resumen.mjs";
import { clasesPorSha } from "./bitacora.mjs";
import { htmlSupervisor } from "../public/supervisor.js";

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
    const leyes = estatales.datos.flatMap((e) => e.leyes ?? []).filter((d) => d.estado === "incluida");
    if (leyes.length) {
      filas.push([
        enlaceRepo(REPOS.estatales, "Leyes estatales"),
        numero(leyes.length),
        numero(leyes.reduce((s, d) => s + (d.unidades ?? 0), 0)),
        dia(masReciente(leyes.map((d) => d.version))),
        ultimo(REPOS.estatales),
      ]);
    }
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
// Las demás leyes de cada estado: su registro es fuentes.json de leyes-estatales.
function leyesEstatales(estados) {
  const leyes = estados.flatMap((e) => e.leyes ?? []);
  if (!leyes.length) return "";
  const pub = leyes.filter((d) => d.estado === "incluida");
  const conLeyes = estados.filter((e) => e.leyes?.length).map((e) => esc(e.nombre));
  return ` Además, ${plural(pub.length, "ley estatal publicada", "leyes estatales publicadas")} en
  <code>{estado}/{ley}/</code> (${conLeyes.join(", ")}) y ${plural(leyes.length - pub.length, "fuera", "fuera")}
  con su motivo, según <code>fuentes.json</code> del repo; las vigila <code>vigilar-leyes-estatales.yml</code>
  de fiscal-extractor.`;
}

function seccionCorpus({ estatales, federales }) {
  const partes = [];
  if (estatales.ok) {
    const pub = estatales.datos.filter((e) => e.articulos != null);
    const cuenta = (s) => estatales.datos.filter((e) => e.articulos == null && e.situacion === s).length;
    const fuera = cuenta("fuera");
    const preparando = estatales.datos.length - pub.length - fuera;
    // Publicada en el repo de datos pero aún sin vigilancia automática: el
    // registro del extractor no la marca como lista.
    const SITUACION = {
      vigilada: "Vigilada cada semana",
      en_preparacion: "En preparación",
      fuera: "Fuera",
    };
    const filas = estatales.datos.map((e) => [
      esc(e.nombre),
      e.articulos != null
        ? e.situacion === "vigilada" || e.situacion == null
          ? "Publicada"
          : "Publicada, sin vigilancia"
        : esc(SITUACION[e.situacion] ?? "Sin publicar"),
      e.articulos != null ? numero(e.articulos) : "—",
      e.articulos != null ? dia(e.version) : "—",
      e.motivo && e.articulos == null ? esc(e.motivo) : "",
    ]);
    partes.push(`<p>
  <strong>Constituciones estatales:</strong> ${numero(pub.length)} de 32 publicadas en
  <code>{estado}/constitucion/</code> de ${enlaceRepo(REPOS.estatales)};
  ${numero(preparando)} en preparación y ${numero(fuera)} fuera por ahora. La situación de cada
  una sale de <code>estados.json</code> del extractor.${leyesEstatales(estatales.datos)}
</p>
${tabla({
  id: "t-estados",
  titulo: "Constituciones estatales",
  columnas: [
    { titulo: "Entidad" },
    { titulo: "Situación" },
    { titulo: "Artículos", num: true },
    { titulo: "Texto vigente" },
    { titulo: "Motivo" },
  ],
  filas,
})}`);
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


// Resultado de una semana de vigilancia según sus corridas. Las canceladas u
// omitidas no cuentan. Una semana con fallas que terminó en una corrida
// correcta se distingue de una que quedó en falla: ahí el sistema se
// recuperó. Todas las barras miden lo mismo; el resultado también está en el
// tooltip y en el aria-label, no solo en el color.
function semanaVigilancia(corridas) {
  const validas = corridas.filter((c) => c.status === "completed" && (c.conclusion === "success" || FALLAS.includes(c.conclusion)));
  const fallidas = validas.filter((c) => c.conclusion !== "success").length;
  const ultima = validas.at(-1);
  if (!ultima) {
    return corridas.some((c) => c.status !== "completed")
      ? { clase: "b-curso", nombre: "en curso", ultima: corridas.at(-1) }
      : { clase: "b-vacia", nombre: "sin corrida", ultima: null };
  }
  const base = { ultima, total: validas.length, fallidas };
  if (ultima.conclusion !== "success") return { ...base, clase: "b-falla", nombre: "terminó en falla" };
  if (fallidas) return { ...base, clase: "b-recupero", nombre: "tuvo fallas y terminó correcta" };
  return { ...base, clase: "b-ok", nombre: "correcta" };
}

const LEYENDA_BARRAS = `<p class="leyenda" aria-hidden="true">
  <span><span class="barra b-ok"></span> Correcta</span>
  <span><span class="barra b-recupero"></span> Falló y se recuperó</span>
  <span><span class="barra b-falla"></span> Terminó en falla</span>
  <span><span class="barra b-vacia"></span> Sin corrida</span>
  <span><span class="barra b-curso"></span> En curso</span>
</p>`;

function filaVigilancia(w, generada) {
  const nombre = `${enlaceRepo(w.repo, w.repo)} <a class="tenue" href="${esc(w.url)}">${esc(w.archivo)}</a>`;
  const { inicio } = inicioActividad(generada);
  // La API las da de la más reciente a la más antigua.
  const corridas = [...w.corridas].reverse();
  const semanas = Array.from({ length: SEMANAS }, (_, i) => {
    const lunes = sumarDias(inicio, i * 7);
    const siguiente = sumarDias(lunes, 7);
    const deLaSemana = corridas.filter((c) => {
      const d = diaMexico(fechaCorrida(c));
      return d >= lunes && d < siguiente;
    });
    const semana = semanaVigilancia(deLaSemana);
    // La semana en curso sin corridas todavía no ha fallado: le falta su lunes.
    if (i === SEMANAS - 1 && semana.clase === "b-vacia") semana.nombre = "pendiente";
    return { lunes, ...semana };
  });
  // Antes de la primera corrida la vigilancia no existía: ahí no se dibuja nada.
  const primera = semanas.findIndex((s) => s.clase !== "b-vacia");
  const barras = semanas
    .map((s, i) => {
      if (primera === -1 || i < primera) return "<li></li>";
      const cuenta = s.total
        ? ` (${plural(s.total, "corrida", "corridas")}${s.fallidas ? `, ${plural(s.fallidas, "fallida", "fallidas")}` : ""})`
        : "";
      const texto = `Semana del ${fechaLarga(s.lunes)}: ${s.nombre}${cuenta}`;
      const clase = `barra ${s.clase}${anclaTip(i, SEMANAS)}`;
      return s.ultima
        ? `<li><a class="${clase}" href="${esc(s.ultima.html_url)}" data-tip="${esc(texto)}" aria-label="${esc(texto)}"></a></li>`
        : `<li><span class="${clase}" data-tip="${esc(texto)}" role="img" aria-label="${esc(texto)}"></span></li>`;
    })
    .join("");
  const conCorrida = semanas.filter((s) => s.clase !== "b-vacia" && s.clase !== "b-curso");
  const correctas = conCorrida.filter((s) => s.clase === "b-ok" || s.clase === "b-recupero").length;
  const ultima = corridas.filter((c) => c.status === "completed").at(-1);
  return `<div class="vigilancia">
<p class="vig-nombre">${nombre}</p>
<ol class="barras" aria-label="Últimas ${SEMANAS} semanas de ${esc(w.archivo)}, de la más antigua a la más reciente">${barras}</ol>
<p class="vig-resumen">${numero(correctas)} de ${plural(conCorrida.length, "semana correcta", "semanas correctas")}${
    ultima
      ? ` · última corrida: <a href="${esc(ultima.html_url)}">${esc(estadoCorrida(ultima).toLowerCase())}</a>, ${momentoCorto(fechaCorrida(ultima))}`
      : ""
  }</p>
</div>`;
}

function seccionProgreso({ vigilancia, prs }, generada) {
  const filasV = [];
  const avisos = [];
  for (const [repo, r] of Object.entries(vigilancia)) {
    if (!r.ok) {
      avisos.push(fallo(`la vigilancia de ${ORG}/${repo}`, r));
      continue;
    }
    for (const w of r.datos) filasV.push(filaVigilancia(w, generada));
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

  return `<h2 id="progreso">Vigilancia</h2>
<p>
  Cada lunes el <a href="#supervisor">supervisor</a> lanza la vigilancia de cada repositorio de datos: un
  workflow de su extractor que descarga los PDF oficiales y vuelve a extraer el texto. Si algo cambió, un agente compara cada artículo contra el PDF y corrige el extractor
  si hace falta; luego pasan pruebas que el agente no controla. Solo si todo queda verificado
  se abre un pull request que se fusiona solo. Si no, no se publica nada y la siguiente
  vigilancia lo reintenta.
</p>
<h3>Últimas ${SEMANAS} semanas de cada vigilancia</h3>
<p class="leyenda">Cada barra es una semana, de la más antigua a la más reciente.</p>
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

// La sección queda escrita con lo que había al generar la página, y
// /supervisor.js (el mismo módulo que la escribe aquí) la vuelve a leer del
// repositorio del supervisor al abrirla: el sitio solo se despliega cuando
// cambian los datos, y el supervisor da una vuelta cada 15 minutos.
function seccionSupervisor(supervisor, generada) {
  const dato = (r) => (r?.ok ? r.datos : null);
  const corrida = dato(supervisor?.corrida);
  const fuentes = {
    latido: dato(supervisor?.latido),
    huellas: dato(supervisor?.huellas),
    acciones: dato(supervisor?.acciones),
    corrida,
  };
  return `<h2 id="supervisor">Supervisor</h2>
<p>
  Ninguna corrida lanza a otra: lo hace el ${enlaceRepo("supervisor", "supervisor")}, un programa
  sin modelo de lenguaje que cada 15 minutos compara lo que pasó (corridas, pull requests,
  commits) con lo que debería ser cierto, sus <em>invariantes</em>, y lanza lo que falte. Una
  invariante rota es algo que encontró pendiente y ya atiende; casi siempre dura una vuelta.
  Una falla que se repite la toma un agente que repara la infraestructura, y lo que no se
  logra arreglar queda como constancia en un issue de su repositorio.
</p>
<div id="supervisor-vivo" data-corrida="${esc(JSON.stringify(corrida))}">
${htmlSupervisor(fuentes, generada)}
</div>
<p class="tenue" id="supervisor-nota">Leído al generar esta página, el ${momento(generada)}.</p>`;
}

const PUBLICADOS_MAX = 12;

function seccionPublicado(actividad, bitacora) {
  const titulo = '<h2 id="publicado">Lo que ha publicado el sistema</h2>';
  const avisos = Object.entries(actividad)
    .filter(([, r]) => !r.ok)
    .map(([repo, r]) => fallo(`los commits de ${ORG}/${repo}`, r));
  const publicados = cambios(actividad, bitacora && clasesPorSha(bitacora));
  const cuenta = (clave) => publicados.filter((c) => c.tipo.clave === clave).length;
  const cifras = [
    [cuenta("reforma"), "reforma incorporada", "reformas incorporadas"],
    [cuenta("correccion"), "corrección de extracción", "correcciones de extracción"],
    [cuenta("alta"), "alta de documento", "altas de documentos"],
    [cuenta("retiro"), "retiro de documento", "retiros de documentos"],
    [cuenta("ajuste"), "ajuste inicial", "ajustes iniciales"],
    [cuenta("metadatos"), "cambio de metadatos", "cambios de metadatos"],
  ];
  const enLista = ["reforma", "correccion"];
  // Hay un commit por documento y las altas y retiros (con sus ajustes
  // iniciales) llegan por cientos al incorporar un corpus: taparían la lista,
  // así que basta con su cifra. Los cambios de metadatos no tocan el texto.
  const filas = publicados.filter((c) => enLista.includes(c.tipo.clave)).slice(0, PUBLICADOS_MAX).map((c) => [
    momentoCorto(c.fecha),
    `<span class="tipo t-${c.tipo.clave}">${esc(c.tipo.nombre)}</span>`,
    `<a href="${esc(c.url)}">${esc(c.titulo)}</a>`,
  ]);
  return `${titulo}
<p>
  Cada cambio al texto llega como un commit con su tipo en el título: una <em>reforma</em> cuando
  cambió la ley, una <em>corrección de extracción</em> cuando la ley es la misma y mejoró la
  lectura del PDF, un <em>alta</em> cuando entra un documento nuevo y un <em>retiro</em> cuando
  sale uno cuya extracción ya no reproduce el PDF. Ninguno se edita a mano. Las correcciones de
  los primeros días de un documento son <em>ajustes iniciales</em> de su alta, y los cambios que
  solo tocan la metadata (no el texto) se cuentan aparte.
</p>
<ul class="cifras">
${cifras.map(([n, uno, varios]) => `  <li><span class="cifra">${numero(n)}</span> ${esc(n === 1 ? uno : varios)}</li>`).join("\n")}
</ul>
<p class="tenue">En las últimas ${SEMANAS} semanas.</p>
${tabla({
  id: "t-publicado",
  titulo: "Últimas reformas y correcciones",
  columnas: [{ titulo: "Fecha" }, { titulo: "Tipo" }, { titulo: "Cambio" }],
  filas,
  vacio: "No hubo reformas ni correcciones en este periodo.",
})}
${avisos.join("\n")}`;
}

function seccionSalud(datos, generada) {
  const s = salud(datos.vigilancia, generada);
  const nombres = (vs) => lista(vs.map((v) => `<code>${esc(v.repo)}</code>`));
  // El badge dice cuántas vigilancias están en cada caso; el subtexto, cuáles.
  const detalle = [];
  if (s.fallas.length) {
    detalle.push(`Falló la última corrida de ${nombres(s.fallas)}; se reintenta sola y mientras tanto se conserva el texto vigente.`);
  } else if (s.atrasadas.length) {
    detalle.push(`Sin corrida correcta en más de ${DIAS_ATRASO} días: ${nombres(s.atrasadas)}.`);
  } else if (s.sinLeer) {
    detalle.push("No se pudo leer el estado de todas las vigilancias; abajo se indica cuál.");
  }
  if (s.nuevas.length) detalle.push(`Aún sin su primera corrida: ${nombres(s.nuevas)}.`);
  if (s.enCurso.length) detalle.push(`En curso: ${nombres(s.enCurso)}.`);
  detalle.push(
    `${s.ultimaRevision ? `Última revisión: ${momento(s.ultimaRevision)}` : "Sin revisiones todavía"} · próxima: ${momento(s.proximaRevision)}.`,
  );
  return `<p class="salud">${insignia(s)}</p>
<p class="salud-sub">${detalle.join(" ")}</p>`;
}

const ESTILO = `
${ESTILO_SALUD}
:root { --barra: #7a7a7a; }
@media (prefers-color-scheme: dark) { :root { --barra: #8c8c8c; } }


.vigilancia { display: grid; grid-template-columns: 12rem 1fr; gap: 0.3rem 1rem; align-items: end; margin: 0 0 1rem; font-size: 0.85em; }
.vig-nombre, .vig-resumen { margin: 0; }
.vig-resumen { grid-column: 2; color: var(--tenue); font-size: 0.9em; }
.barras { display: grid; grid-template-columns: repeat(${SEMANAS}, 1fr); gap: 2px; height: 1.4rem; margin: 0; padding: 0; list-style: none; }
.barras li { display: flex; align-items: flex-end; margin: 0; min-width: 0; }
.barra { display: block; width: 100%; height: 100%; border-radius: 1px; background: var(--barra); }
.barra.b-ok { background: var(--verde); }
.barra.b-falla { background: var(--rojo); }
.barra.b-recupero { background: var(--ambar); }
.barra.b-vacia { background: transparent; box-shadow: inset 0 0 0 1px var(--linea); }
.barra.b-curso { background: repeating-linear-gradient(135deg, var(--barra) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--barra); }
.barras .barra:hover, a.barra:focus-visible { outline: 2px solid var(--texto); outline-offset: 1px; }
.leyenda .barra { display: inline-block; width: 0.55rem; height: 0.75rem; }
@media (max-width: 36rem) {
  .vigilancia { grid-template-columns: 1fr; }
  .vig-resumen { grid-column: 1; }
  .barras { gap: 1px; }
  /* El tipo se parte en dos renglones para dejar ancho al título del cambio. */
  [aria-labelledby="t-publicado"] .tipo { white-space: normal; }
  [aria-labelledby="t-publicado"] td:last-child { min-width: 9rem; }
}

.salud { margin: 0 0 0.5rem; }
.salud-sub { margin-bottom: 2rem; color: var(--tenue); font-size: 0.85em; }

.cifras { display: flex; flex-wrap: wrap; gap: 0.5em 2rem; margin: 0 0 0.4em; padding: 0; list-style: none; color: var(--tenue); font-size: 0.85em; }
.cifras li { margin: 0; }
.cifra { display: block; color: var(--texto); font-size: 1.8em; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.tipo { white-space: nowrap; }
#supervisor-vivo .salud-sub { margin-bottom: 1.2rem; }
.inv { white-space: nowrap; }
.inv::before { content: ""; display: inline-block; width: 0.55em; height: 0.55em; margin-right: 0.4em; border-radius: 50%; background: var(--tenue); }
.i-ok::before { background: var(--verde); }
.i-rota::before { background: var(--rojo); }
.i-ciega::before { background: var(--ambar); }
.i-apagada::before { background: transparent; box-shadow: inset 0 0 0 1px var(--tenue); }
.falla-detalle { color: var(--tenue); overflow-wrap: anywhere; }
[aria-labelledby="t-fallas"] td:nth-child(2), [aria-labelledby="t-arreglos"] td:nth-child(2) { min-width: 12rem; }
.tipo::before { content: ""; display: inline-block; width: 0.55em; height: 0.55em; margin-right: 0.4em; border-radius: 50%; background: var(--tenue); }
.t-reforma::before { background: var(--verde); }
`;

export function paginaEstado(datos, generada) {
  const cuerpo = `${seccionSalud(datos, generada)}

      <p>
        Un sistema autónomo mantiene al día la ley en los repositorios: cada lunes descarga los
        PDF oficiales, extrae el texto, lo verifica contra el PDF y solo publica lo que queda
        verificado. Esta página muestra cómo va; se actualiza cada tres horas (la última, el
        ${momento(generada)}) y las horas son de la Ciudad de México.
      </p>

${seccionPublicado(datos.actividad, datos.bitacora)}

${seccionResumen(datos)}

${seccionCorpus(datos)}

${seccionProgreso(datos, generada)}

${seccionSupervisor(datos.supervisor, generada)}`;
  return documento({
    ruta: "/estado",
    url: "/estado",
    titulo: "Status del sistema — OpenCodice",
    h1: "Status del sistema",
    descripcion:
      "Estado técnico de OpenCodice: repositorios de datos, corridas de vigilancia, cambios por día y pull requests abiertos.",
    estilo: ESTILO,
    cabeza: '<script type="module" src="/supervisor.js"></script>',
    cuerpo,
    pie: `<p>
          <a href="/">Inicio</a> · <a href="/leyes">Qué leyes hay</a> · El código y los datos están en
          <a href="https://github.com/${ORG}">github.com/${ORG}</a>.
        </p>`,
  });
}
