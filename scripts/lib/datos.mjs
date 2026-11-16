// Lectura de los repos de datos. Todo pasa por `intentar`, así que una fuente
// que no responde llega a las páginas como { ok: false, error } y no detiene
// el despliegue.

import {
  ORG,
  REPOS,
  ESTADOS,
  ErrorFuente,
  api,
  crudo,
  graphql,
  intentar,
  enParalelo,
  diaMexico,
  sumarDias,
} from "./comun.mjs";

// El registro de estados vive con el código que los extrae.
const EXTRACTOR_ESTATAL = "constitucion-extractor";

// Semanas que abarca /estado: las barras semanales de cada vigilancia y los
// cambios publicados.
export const SEMANAS = 52;

// Páginas de 100 corridas por vigilancia. Una semana normal tiene una corrida;
// los días de desarrollo, decenas.
const PAGINAS_CORRIDAS = 3;

// Archivos de metadata que se leen a la vez de raw.githubusercontent.com.
const LECTURAS_A_LA_VEZ = 16;

// Fechas de reforma distintas de un documento. reformas.json es un mapa
// fecha → artículos; null si no se pudo leer, para no confundirlo con "cero".
async function leerReformas(repo, ruta) {
  try {
    const r = await crudo(repo, ruta);
    return r ? Object.keys(r).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort() : null;
  } catch {
    return null;
  }
}

async function leerCpeum() {
  const [meta, reformas] = await Promise.all([
    crudo(REPOS.cpeum, "metadata/articulos.json"),
    leerReformas(REPOS.cpeum, "metadata/reformas.json"),
  ]);
  if (!meta) throw new ErrorFuente("no se encontró metadata/articulos.json");
  return { articulos: meta.articulos.length, version: meta.version, reformas };
}

async function leerEstatales() {
  const raiz = await api(`/repos/${ORG}/${REPOS.estatales}/contents/`);
  if (!raiz) throw new ErrorFuente("no se encontró el repositorio");
  const carpetas = raiz.filter((e) => e.type === "dir" && !e.name.startsWith(".")).map((e) => e.name);
  const publicados = {};
  await Promise.all(
    carpetas.map(async (c) => {
      const base = `${c}/constitucion/metadata`;
      const [meta, reformas] = await Promise.all([
        crudo(REPOS.estatales, `${base}/articulos.json`),
        leerReformas(REPOS.estatales, `${base}/reformas.json`),
      ]);
      if (meta) {
        publicados[c] = {
          articulos: meta.articulos.length,
          version: meta.version,
          // 'Periódico Oficial del Estado de Jalisco — Congreso del Estado…'
          periodico: (meta.fuente ?? "").split(" — ")[0] || null,
          reformas,
        };
      }
    }),
  );
  // Situación de cada entidad según el registro del extractor (vigilada, en
  // preparación o fuera con su motivo). Si no responde, las páginas solo
  // distinguen publicadas y no publicadas.
  let registro = {};
  try {
    const r = await crudo(EXTRACTOR_ESTATAL, "estados.json");
    if (Array.isArray(r)) registro = Object.fromEntries(r.map((e) => [e.estado, e]));
  } catch {
    registro = {};
  }
  const conocidos = new Set(ESTADOS.map(([c]) => c));
  const filas = ESTADOS.map(([clave, nombre]) => ({
    clave,
    nombre,
    situacion: registro[clave]?.situacion ?? null,
    motivo: registro[clave]?.motivo ?? null,
    ...publicados[clave],
  }));
  for (const c of Object.keys(publicados)) {
    if (!conocidos.has(c)) filas.push({ clave: c, nombre: c, ...publicados[c] });
  }
  filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return filas;
}

async function leerFiscal() {
  const meta = await crudo(REPOS.fiscal, "metadata/documentos.json");
  if (!meta) throw new ErrorFuente("no se encontró metadata/documentos.json");
  return enParalelo(meta.documentos, LECTURAS_A_LA_VEZ, async (d) => ({
    ...d,
    reformas: await leerReformas(REPOS.fiscal, `metadata/${d.clave}/reformas.json`),
  }));
}

async function leerFederales() {
  const fuentes = await crudo(REPOS.federales, "fuentes.json");
  if (!fuentes) throw new ErrorFuente("no se encontró fuentes.json");
  return enParalelo(fuentes.documentos, LECTURAS_A_LA_VEZ, async (d) => ({
    ...d,
    reformas:
      d.estado === "incluida" ? await leerReformas(REPOS.federales, `metadata/${d.clave}/reformas.json`) : null,
  }));
}

async function leerVigilancia(repo, desde) {
  const { workflows } = await api(`/repos/${ORG}/${repo}/actions/workflows?per_page=100`);
  const vigilar = workflows.filter((w) => /\/vigilar[^/]*\.ya?ml$/.test(w.path) && w.state === "active");
  return Promise.all(
    vigilar.map(async (w) => {
      const corridas = [];
      for (let pagina = 1; pagina <= PAGINAS_CORRIDAS; pagina++) {
        const { workflow_runs } = await api(
          `/repos/${ORG}/${repo}/actions/workflows/${w.id}/runs?created=>=${desde.slice(0, 10)}&per_page=100&page=${pagina}`,
        );
        corridas.push(...workflow_runs);
        if (workflow_runs.length < 100) break;
      }
      return { repo, nombre: w.name, archivo: w.path.split("/").pop(), url: w.html_url, corridas };
    }),
  );
}

// GitHub lista a lo más 3,000 archivos por PR, en páginas de 100.
const PAGINAS_ARCHIVOS_PR = 30;

async function leerArchivosPr(repo, numero) {
  const archivos = [];
  for (let pagina = 1; pagina <= PAGINAS_ARCHIVOS_PR; pagina++) {
    const lote = await api(`/repos/${ORG}/${repo}/pulls/${numero}/files?per_page=100&page=${pagina}`);
    archivos.push(...(lote ?? []).map((a) => a.filename));
    if (!lote || lote.length < 100) break;
  }
  return archivos;
}

// PR abiertos con los archivos que tocan, para saber qué documentos tienen
// una actualización en revisión. Si no se pueden leer los archivos de un PR,
// `archivos` queda en null.
async function leerPrs(repo) {
  const prs = await api(`/repos/${ORG}/${repo}/pulls?state=open&per_page=100`);
  return Promise.all(
    (prs ?? []).map(async (p) => {
      const archivos = await leerArchivosPr(repo, p.number).catch(() => null);
      return { repo, ...p, archivos };
    }),
  );
}

async function leerUltimoCommit(repo) {
  const commits = await api(`/repos/${ORG}/${repo}/commits?per_page=1`);
  const c = commits?.[0];
  return c ? { fecha: c.commit.committer.date, titulo: c.commit.message.split("\n")[0], url: c.html_url } : null;
}

// Commits de main desde `desde`, con cuántos archivos cambió cada uno. GraphQL
// da esa cuenta en la misma consulta (REST pediría una petición por commit);
// pide token, así que sin él se cae a REST y solo se cuentan commits.
const HISTORIA = `query($owner: String!, $name: String!, $since: GitTimestamp!, $after: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { target { ... on Commit {
      history(first: 100, since: $since, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { committedDate changedFilesIfAvailable messageHeadline url }
      }
    } } }
  }
}`;
const PAGINAS_MAX = 5;

async function leerActividad(repo, desde) {
  if (process.env.GITHUB_TOKEN) {
    try {
      const commits = [];
      let after = null;
      for (let i = 0; i < PAGINAS_MAX; i++) {
        const d = await graphql(HISTORIA, { owner: ORG, name: repo, since: desde, after });
        const h = d.repository.defaultBranchRef.target.history;
        commits.push(
          ...h.nodes.map((n) => ({
            fecha: n.committedDate,
            archivos: n.changedFilesIfAvailable,
            titulo: n.messageHeadline,
            url: n.url,
          })),
        );
        if (!h.pageInfo.hasNextPage) break;
        after = h.pageInfo.endCursor;
      }
      return { conArchivos: true, commits };
    } catch {
      // Sigue con REST.
    }
  }
  const commits = [];
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const lote = await api(`/repos/${ORG}/${repo}/commits?since=${desde}&per_page=100&page=${pagina}`);
    commits.push(
      ...(lote ?? []).map((c) => ({
        fecha: c.commit.committer.date,
        archivos: null,
        titulo: c.commit.message.split("\n")[0],
        url: c.html_url,
      })),
    );
    if (!lote || lote.length < 100) break;
  }
  return { conArchivos: false, commits };
}

// Primer lunes de la cuadrícula de cambios y el día de hoy, en hora de la
// Ciudad de México.
export function inicioActividad(generada) {
  const hoy = diaMexico(generada);
  const semana = (new Date(`${hoy}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { hoy, inicio: sumarDias(hoy, -semana - (SEMANAS - 1) * 7) };
}

async function porRepo(fn) {
  const nombres = Object.values(REPOS);
  const resultados = await Promise.all(nombres.map((r) => intentar(() => fn(r))));
  return Object.fromEntries(nombres.map((r, i) => [r, resultados[i]]));
}

export async function leerTodo(generada) {
  // Un día de margen: el día se cuenta en hora de la Ciudad de México y la API filtra en UTC.
  const desde = `${sumarDias(inicioActividad(generada).inicio, -1)}T00:00:00Z`;
  const [cpeum, estatales, fiscal, federales, vigilancia, prs, commits, actividad] = await Promise.all([
    intentar(leerCpeum),
    intentar(leerEstatales),
    intentar(leerFiscal),
    intentar(leerFederales),
    porRepo((r) => leerVigilancia(r, desde)),
    porRepo(leerPrs),
    porRepo(leerUltimoCommit),
    porRepo((r) => leerActividad(r, desde)),
  ]);
  return { cpeum, estatales, fiscal, federales, vigilancia, prs, commits, actividad };
}

export function contarFallas(datos) {
  const { cpeum, estatales, fiscal, federales, vigilancia, prs, commits, actividad } = datos;
  return [
    cpeum,
    estatales,
    fiscal,
    federales,
    ...[vigilancia, prs, commits, actividad].flatMap((r) => Object.values(r)),
  ].filter((r) => !r.ok).length;
}
