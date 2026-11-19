// Sección «Supervisor» de /estado: qué dice de sí mismo el reconciliador
// OpenCodice/supervisor (su carpeta estado/ y su última corrida).
//
// Este módulo lo usan los dos lados: scripts/estado.mjs lo importa para dejar
// la sección escrita en el HTML, y la página lo carga para volver a leer las
// mismas fuentes al abrirse, porque el sitio solo se despliega cuando cambian
// los datos y el supervisor da una vuelta cada 15 minutos. Por eso no importa
// nada de scripts/lib/ y repite unas cuantas funciones de formato.

const REPO = "OpenCodice/supervisor";
const CRUDO = `https://raw.githubusercontent.com/${REPO}/main/estado`;

export const FUENTES = {
  latido: `${CRUDO}/latido.json`,
  huellas: `${CRUDO}/huellas.jsonl`,
  acciones: `${CRUDO}/acciones.jsonl`,
  corridas: `https://api.github.com/repos/${REPO}/actions/workflows/supervisor.yml/runs?per_page=5`,
};

// Lo que vigila cada invariante, en llano. Uno que el supervisor agregue
// después aparece con su clave y sin descripción hasta que se anote aquí.
const INVARIANTES = {
  I1: "Cada tarea programada corre a su hora",
  I2: "Toda corrida que falla se reintenta o se repara",
  I3: "Ninguna corrida se pierde mientras espera en la cola",
  I4: "Ninguna corrida se queda atorada",
  I5: "Ningún pull request automático se queda abierto",
  I6: "El trabajo que una corrida dejó pendiente continúa",
  I7: "Un extractor nuevo se prueba contra todo su corpus",
  I8: "Este sitio está al día con los repositorios de datos",
  I9: "Los relojes que lanzan al supervisor siguen vivos",
  I10: "Los Workers de Cloudflare avanzan",
  I11: "Ningún workflow lleva tres corridas seguidas en falla",
  I12: "Lo que una corrida pide que corra después, corre",
  I13: "Las credenciales siguen vigentes",
};

const MODOS = {
  actuar: "actúa (lanza y repara)",
  informe: "solo informa (no lanza nada)",
};

const SITUACIONES = {
  abierta: "Sin resolver",
  "en-reparacion": "La está reparando el agente",
  "arreglo-publicado": "Arreglo publicado, en prueba",
  revertido: "Arreglo revertido",
  agotada: "Sin arreglo automático",
  "relanzar-pendiente": "Por relanzar",
};

const CONCLUSIONES = {
  success: "correcta",
  failure: "falló",
  cancelled: "cancelada",
  timed_out: "excedió el tiempo",
  startup_failure: "no arrancó",
};

// El supervisor da una vuelta cada 15 minutos: una hora sin ninguna son cuatro
// seguidas perdidas.
const MIN_SIN_VUELTA = 60;
// latido.json no se reescribe en cada vuelta: solo cuando cambia algo de lo
// que dice o, sin cambios, una vez al día. Hasta un día de antigüedad es lo
// normal; se da una hora de margen.
const HORAS_SIN_LATIDO = 25;

const ARREGLOS_MAX = 5;
const FIRMA_MAX = 160;

// ---------------------------------------------------------------- formato

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const valida = (iso) => typeof iso === "string" && !Number.isNaN(Date.parse(iso));

const enMexico = (iso, opciones) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hourCycle: "h23", ...opciones }).format(new Date(iso));

const etiquetaTiempo = (iso, texto) => `<time datetime="${esc(new Date(iso).toISOString())}">${esc(texto)}</time>`;

const momento = (iso) =>
  valida(iso) ? etiquetaTiempo(iso, enMexico(iso, { dateStyle: "long", timeStyle: "short" })) : "—";

function momentoCorto(iso) {
  if (!valida(iso)) return "—";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return etiquetaTiempo(iso, `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`);
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function tabla({ id, titulo, columnas, filas }) {
  const cabeza = columnas.map((c) => `<th scope="col">${esc(c)}</th>`).join("");
  const cuerpo = filas
    .map((f) => `<tr>${f.map((celda, i) => (i === 0 ? `<th scope="row">${celda}</th>` : `<td>${celda}</td>`)).join("")}</tr>`)
    .join("\n");
  return `<div class="desplazable" role="region" aria-labelledby="${id}" tabindex="0">
<table>
<caption id="${id}">${esc(titulo)}</caption>
<thead><tr>${cabeza}</tr></thead>
<tbody>
${cuerpo}
</tbody>
</table>
</div>`;
}

// Lo que se lee del supervisor llega de la red y parte lo escribe un agente:
// de ahí solo salen enlaces armados aquí con piezas de forma conocida.
const nombreRepo = (s) => (typeof s === "string" && /^[A-Za-z0-9._-]+$/.test(s) ? s : null);
const shaCommit = (s) => (typeof s === "string" && /^[0-9a-f]{7,40}$/.test(s) ? s : null);
const urlGitHub = (s) => (typeof s === "string" && s.startsWith("https://github.com/") ? s : null);

// ----------------------------------------------------------------- modelo

// Un .jsonl al que se le está agregando puede llegar con la última línea a
// medias: esa línea se salta.
export function lineas(texto) {
  const registros = [];
  for (const linea of String(texto ?? "").split("\n")) {
    if (!linea.trim()) continue;
    try {
      const r = JSON.parse(linea);
      if (r && typeof r === "object") registros.push(r);
    } catch {
      continue;
    }
  }
  return registros;
}

// De la lista de corridas de supervisor.yml, la última que terminó.
export function ultimaCorrida(respuesta) {
  const c = (respuesta?.workflow_runs ?? []).find((x) => x.status === "completed");
  if (!c) return null;
  return { inicio: c.run_started_at ?? c.created_at, conclusion: c.conclusion, url: urlGitHub(c.html_url) };
}

const numeroDe = (clave) => Number(/\d+/.exec(clave)?.[0] ?? Infinity);

function invariantes(latido) {
  return Object.entries(latido.invariantes ?? {})
    .sort(([a], [b]) => numeroDe(a) - numeroDe(b))
    .map(([clave, valor]) => {
      const [estado, n] = String(valor).split(":");
      return { clave, que: INVARIANTES[clave] ?? "", estado, hallazgos: Number(n) || 0, motivo: latido.motivos?.[clave] ?? null };
    });
}

// Toda huella sin resolver cuenta como abierta para el supervisor, también la
// de algo que acaba de lanzar y espera su resultado (cada tarea programada
// abre una al lanzarse y la cierra en la vuelta siguiente). Falla es la que
// tiene un error clasificado, una constancia, un intento de arreglo o una
// acción que la API rechazó.
const esFalla = (h) =>
  h.estado !== "abierta" || Boolean(h.clase) || h.issue != null || (h.errores ?? 0) > 0 || (h.intentos_agente ?? 0) > 0;

export function modelo({ latido, huellas, acciones, corrida }, ahora) {
  const m = { latido: null, corrida: corrida ?? null, fallas: null, enCurso: 0, arreglos: null, atraso: null };
  const hace = (iso) => (Date.parse(ahora) - Date.parse(iso)) / 60_000;

  if (latido) {
    m.latido = {
      cuando: latido.cuando,
      modo: latido.modo,
      invariantes: invariantes(latido),
      reposSinObservar: (latido.sin_observar ?? []).map(String),
    };
  }
  if (corrida && valida(corrida.inicio)) {
    if (hace(corrida.inicio) > MIN_SIN_VUELTA) m.atraso = corrida.inicio;
  } else if (latido && valida(latido.cuando) && hace(latido.cuando) > HORAS_SIN_LATIDO * 60) {
    m.atraso = latido.cuando;
  }

  let ultimas = null;
  if (huellas) {
    // De cada huella vale su última línea.
    ultimas = new Map(huellas.filter((h) => h.huella).map((h) => [h.huella, h]));
    const abiertas = [...ultimas.values()].filter((h) => h.estado !== "resuelta" && h.estado !== "datos");
    m.fallas = abiertas.filter(esFalla).sort((a, b) => String(b.primera).localeCompare(String(a.primera)));
    m.enCurso = abiertas.length - m.fallas.length;
  }

  if (acciones) {
    const revertidos = acciones.filter((a) => a.accion === "revertido" || a.accion === "reversion-fallida");
    m.arreglos = acciones
      .filter((a) => a.accion === "arreglo-publicado" && a.resultado === "ok")
      .map((a) => {
        const reversion = revertidos.find((r) => r.huella === a.huella && String(r.cuando) > String(a.cuando));
        const huella = ultimas?.get(a.huella);
        let resultado = "—";
        if (reversion) resultado = reversion.accion === "revertido" ? "Revertido: no resolvió la falla" : "No resolvió la falla";
        else if (huella?.estado === "resuelta") resultado = "Resolvió la falla";
        else if (huella?.estado === "arreglo-publicado") resultado = "En prueba";
        return {
          cuando: a.cuando,
          repo: nombreRepo(a.detalle?.repo),
          workflow: a.detalle?.workflow ?? huella?.workflow ?? null,
          paso: huella?.paso ?? null,
          commit: shaCommit(a.detalle?.commit),
          resultado,
        };
      })
      .sort((a, b) => String(b.cuando).localeCompare(String(a.cuando)));
  }
  return m;
}

// ------------------------------------------------------------------- HTML

function veredicto(m) {
  if (m.fallas?.length) return ["s-falla", plural(m.fallas.length, "falla abierta", "fallas abiertas")];
  if (m.atraso) return ["s-atraso", "Sin vueltas recientes"];
  if (m.corrida && m.corrida.conclusion !== "success") return ["s-atraso", "La última vuelta no terminó bien"];
  if (!m.latido || !m.fallas) return ["s-atraso", "Estado sin leer"];
  if (m.latido.invariantes.some((i) => i.estado === "sin-observar")) return ["s-atraso", "Invariantes sin observar"];
  return ["s-ok", "Sin fallas abiertas"];
}

function resumen(m) {
  const partes = [];
  if (m.corrida && valida(m.corrida.inicio)) {
    const fecha = momento(m.corrida.inicio);
    const enlace = m.corrida.url ? `<a href="${esc(m.corrida.url)}">${fecha}</a>` : fecha;
    partes.push(`Última vuelta: ${enlace} (${esc(CONCLUSIONES[m.corrida.conclusion] ?? m.corrida.conclusion ?? "terminada")})`);
  }
  if (m.latido) {
    partes.push(`modo: ${esc(MODOS[m.latido.modo] ?? m.latido.modo ?? "desconocido")}`);
    partes.push(`último cambio en su estado: ${momento(m.latido.cuando)}`);
  }
  const texto = partes.join(" · ");
  const atraso = m.atraso
    ? ` No hay constancia de ninguna vuelta desde el ${momento(m.atraso)}; lo normal es una cada 15 minutos.`
    : "";
  return texto ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}.${atraso}` : atraso.trim();
}

function celdaInvariante(i) {
  if (i.estado === "ok") return '<span class="inv i-ok">Bien</span>';
  if (i.estado === "rota") {
    return `<span class="inv i-rota">Rota</span> <span class="tenue">(${plural(i.hallazgos, "hallazgo", "hallazgos")})</span>`;
  }
  if (i.estado === "apagada") return '<span class="inv i-apagada">Apagada</span>';
  if (i.estado === "sin-observar") {
    return `<span class="inv i-ciega">Sin observar</span>${i.motivo ? ` <span class="tenue">(${esc(i.motivo)})</span>` : ""}`;
  }
  return `<span class="inv">${esc(i.estado)}</span>`;
}

function tablaInvariantes(l) {
  if (!l.invariantes.length) return '<p class="tenue">El estado del supervisor no trae invariantes.</p>';
  return tabla({
    id: "t-invariantes",
    titulo: "Invariantes",
    columnas: ["Invariante", "Qué vigila", "Estado"],
    filas: l.invariantes.map((i) => [esc(i.clave), i.que ? esc(i.que) : "—", celdaInvariante(i)]),
  });
}

function filaFalla(h) {
  const repo = nombreRepo(h.repo);
  const donde = repo && h.workflow ? `${esc(repo)} <span class="tenue">${esc(h.workflow)}</span>` : esc(h.objeto ?? h.huella);
  const firma = String(h.firma ?? "");
  const detalle = [h.paso && `Paso «${esc(h.paso)}»`, firma && `<code>${esc(firma.length > FIRMA_MAX ? `${firma.slice(0, FIRMA_MAX)}…` : firma)}</code>`]
    .filter(Boolean)
    .join(": ");
  const constancia = Number.isInteger(h.issue)
    ? `<a href="https://github.com/${REPO}/issues/${h.issue}" aria-label="Issue ${h.issue} del supervisor">#${h.issue}</a>`
    : "—";
  return [
    momentoCorto(h.primera),
    `${donde}${detalle ? `<br /><span class="falla-detalle">${detalle}</span>` : ""}`,
    `${esc(h.invariante ?? "")} · ${esc(SITUACIONES[h.estado] ?? h.estado)}${
      h.intentos_agente > 0 ? `<br /><span class="falla-detalle">${plural(h.intentos_agente, "intento", "intentos")} del agente</span>` : ""
    }`,
    constancia,
  ];
}

function seccionFallas(m) {
  const titulo = "<h3>Fallas abiertas</h3>";
  if (!m.fallas) return `${titulo}\n<p class="aviso">No se pudieron leer las fallas del supervisor.</p>`;
  const enCurso = m.enCurso
    ? `<p class="tenue">Además, ${plural(m.enCurso, "lanzamiento espera", "lanzamientos esperan")} su resultado; no ${m.enCurso === 1 ? "es una falla" : "son fallas"}.</p>`
    : "";
  if (!m.fallas.length) return `${titulo}\n<p class="tenue">Ninguna.</p>\n${enCurso}`;
  return `${titulo}
${tabla({
  id: "t-fallas",
  titulo: "Fallas que el supervisor no ha resuelto",
  columnas: ["Desde", "Dónde", "Situación", "Constancia"],
  filas: m.fallas.map(filaFalla),
})}
${enCurso}`;
}

function seccionArreglos(m) {
  const titulo = "<h3>Arreglos del agente de infraestructura</h3>";
  if (!m.arreglos) return `${titulo}\n<p class="aviso">No se pudieron leer las acciones del supervisor.</p>`;
  if (!m.arreglos.length) return `${titulo}\n<p class="tenue">El agente no ha publicado ningún arreglo.</p>`;
  const filas = m.arreglos.slice(0, ARREGLOS_MAX).map((a) => [
    momentoCorto(a.cuando),
    `${esc(a.repo ?? "—")}${a.workflow ? ` <span class="tenue">${esc(a.workflow)}</span>` : ""}${
      a.paso ? `<br /><span class="falla-detalle">Paso «${esc(a.paso)}»</span>` : ""
    }`,
    a.repo && a.commit
      ? `<a href="https://github.com/OpenCodice/${esc(a.repo)}/commit/${a.commit}"><code>${a.commit.slice(0, 7)}</code></a>`
      : "—",
    esc(a.resultado),
  ]);
  const resto = m.arreglos.length - filas.length;
  return `${titulo}
${tabla({
  id: "t-arreglos",
  titulo: "Últimos arreglos publicados",
  columnas: ["Fecha", "Dónde", "Commit", "Resultado"],
  filas,
})}${resto > 0 ? `\n<p class="tenue">Y ${plural(resto, "anterior", "anteriores")}.</p>` : ""}`;
}

// El interior de la sección. Una fuente que no se pudo leer llega como null.
export function htmlSupervisor(fuentes, ahora) {
  const m = modelo(fuentes, ahora);
  const [clase, texto] = veredicto(m);
  const sinRepos = m.latido?.reposSinObservar.length
    ? `<p class="aviso">El supervisor no pudo observar: ${m.latido.reposSinObservar.map((r) => `<code>${esc(r)}</code>`).join(", ")}.</p>`
    : "";
  return `<p class="salud"><span class="insignia ${clase}">${esc(texto)}</span></p>
<p class="salud-sub">${resumen(m)}</p>
${m.latido ? tablaInvariantes(m.latido) : '<p class="aviso">No se pudo leer el estado del supervisor.</p>'}
${sinRepos}
${seccionFallas(m)}
${seccionArreglos(m)}`;
}

// -------------------------------------------------------------- navegador

const TIEMPO_MAX = 15_000;

async function pedir(url, tipo) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_MAX) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return tipo === "json" ? r.json() : r.text();
}

async function refrescar() {
  const seccion = document.getElementById("supervisor-vivo");
  const nota = document.getElementById("supervisor-nota");
  if (!seccion || !nota) return;
  try {
    // La API anónima de GitHub tiene un límite por hora: sin ella se usa la
    // corrida que ya traía la página.
    const [latido, huellas, acciones, corridas] = await Promise.all([
      pedir(FUENTES.latido, "json"),
      pedir(FUENTES.huellas, "texto"),
      pedir(FUENTES.acciones, "texto"),
      pedir(FUENTES.corridas, "json").catch(() => null),
    ]);
    let corrida = ultimaCorrida(corridas);
    try {
      const previa = JSON.parse(seccion.dataset.corrida || "null");
      if (previa && (!corrida || String(previa.inicio) > String(corrida.inicio))) corrida = previa;
    } catch {
      // Sin corrida previa legible, vale la que haya dado la API.
    }
    const ahora = new Date().toISOString();
    seccion.innerHTML = htmlSupervisor({ latido, huellas: lineas(huellas), acciones: lineas(acciones), corrida }, ahora);
    nota.innerHTML = `Leído del repositorio del supervisor al abrir esta página, el ${momento(ahora)}; GitHub puede tardar unos 5 minutos en mostrar un cambio.`;
  } catch {
    nota.append(" No se pudo volver a leer al abrir la página.");
  }
}

if (typeof document !== "undefined") refrescar();
