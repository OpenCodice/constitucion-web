// Lee congreso-mexicano (legisladores, votaciones, expedientes, asuntos,
// decretos y la cronología de reformas de cada ley) para la sección de proceso legislativo de la bitácora y las
// páginas de /congreso.
//
// El repo pesa por las copias de las páginas oficiales (`fuentes/`), que aquí
// no hacen falta salvo las fotos de los legisladores: se clona sin blobs y con
// sparse-checkout de todo menos `fuentes/`, más sus imágenes. Con
// REPOS_DATOS=<carpeta> se lee el clon que ya exista ahí.

import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ORG, enParalelo } from "./comun.mjs";

const ejecutar = promisify(execFile);
const REPO = "congreso-mexicano";
const DATOS = fileURLToPath(new URL("../../.datos/", import.meta.url));
// Carpetas de asuntos y su nombre en el modelo.
export const ASUNTOS = { iniciativas: "iniciativas", proposiciones: "proposiciones", "dictamenes-negativos": "dictamenesNegativos" };

const existe = (ruta) =>
  access(ruta).then(
    () => true,
    () => false,
  );

const git = (dir, args) => ejecutar("git", ["-C", dir, ...args], { maxBuffer: 1 << 26 });
// Se excluyen los archivos de `fuentes/` y no la carpeta: git no vuelve a
// incluir nada dentro de una carpeta excluida.
const SPARSE = ["sparse-checkout", "set", "--no-cone", "/*", "!/fuentes/*/*", "/fuentes/*/*.jpg", "/fuentes/*/*.png"];

async function carpeta() {
  if (process.env.REPOS_DATOS) {
    const dir = join(process.env.REPOS_DATOS, REPO);
    if (!(await existe(dir))) throw new Error(`no existe ${dir}`);
    return dir;
  }
  const dir = join(DATOS, REPO);
  if (await existe(join(dir, ".git"))) {
    await git(dir, ["fetch", "--quiet", "--filter=blob:none", "origin", "main"]);
    await git(dir, ["reset", "--quiet", "--hard", "origin/main"]);
    await git(dir, SPARSE);
  } else {
    await mkdir(DATOS, { recursive: true });
    await ejecutar("git", ["clone", "--quiet", "--filter=blob:none", "--sparse", "--single-branch", "--branch", "main",
      `https://github.com/${ORG}/${REPO}`, dir], { maxBuffer: 1 << 26 });
    await git(dir, SPARSE);
  }
  return dir;
}

async function leerCarpeta(raiz, sub) {
  const base = join(raiz, sub);
  if (!(await existe(base))) return [];
  const nombres = (await readdir(base, { recursive: true })).filter((n) => n.endsWith(".json")).sort();
  // Con concurrencia limitada: miles de archivos abiertos a la vez agotan los
  // descriptores y hacen fallar los `git` que corren al mismo tiempo (EBADF).
  return enParalelo(nombres, 64, async (n) => JSON.parse(await readFile(join(base, n), "utf8")));
}

// Rutas de /congreso (archivos `public/congreso/…/{id}.html`, servidos sin `.html`).
// La bitácora y las páginas del Congreso enlazan con estas mismas funciones.
export const BASE_CONGRESO = "/congreso";
export const urlVotacion = (id) => `${BASE_CONGRESO}/votaciones/${id}`;
export const urlLegislador = (personId) => `${BASE_CONGRESO}/legisladores/${personId}`;
export const urlExpediente = (id) => `${BASE_CONGRESO}/expedientes/${id}`;
// Fuera del sitio: la ficha del SIL y el repo de datos.
export const urlSilExpediente = (e) =>
  `http://sil.gobernacion.gob.mx/Librerias/pp_ReporteSeguimiento.php?Seguimiento=${e.seguimiento}`;
// Las fotos se sirven por su huella: una foto nueva es otro archivo.
export const urlFoto = (foto) => `${BASE_CONGRESO}/fotos/${foto.sha256}.${foto.archivo.split(".").pop()}`;
export const urlDato = (ruta) => `https://github.com/${ORG}/${REPO}/blob/main/${ruta}`;

const agregar = (mapa, clave, valor) => {
  if (clave == null) return;
  if (!mapa.has(clave)) mapa.set(clave, []);
  mapa.get(clave).push(valor);
};

// Construye el modelo y sus índices a partir de los registros ya leídos
// (separado de la lectura para poder probarlo sin git).
// Una votación de otra fuente (Gaceta, Senado) que apunta a una del SIL es
// la misma votación: se cuenta una vez, con los votos con nombre de la que
// los tenga.
export function votacionesUnicas(m) {
  const unicas = [];
  for (const v of m.votaciones.values()) {
    if (v.votacion_sil && m.votaciones.has(v.votacion_sil)) continue;
    const pares = m.otrasFuentes.get(v.id) ?? [];
    const conVotos = [v, ...pares].find((x) => x.votos_publicados && x.votes?.length) ?? null;
    unicas.push({ v, conVotos });
  }
  return unicas;
}

export function modeloCongreso(r) {
  const porId = (xs) => new Map(xs.map((x) => [x.id, x]));
  const m = {
    organizaciones: porId(r.organizaciones),
    personas: porId(r.personas),
    mandatos: porId(r.mandatos),
    expedientes: porId(r.expedientes),
    votaciones: porId(r.votaciones),
    decretos: r.decretos.filter((d) => d.id),
    // La lista de decretos de cada ley desde su publicación original.
    cronologias: new Map((r.cronologia ?? []).map((c) => [c.documento, c])),
    asuntos: Object.fromEntries(Object.values(ASUNTOS).map((k) => [k, r[k] ?? []])),
  };
  // (Documento|Publicacion) y sha del commit de leyes → decretos.
  m.decretosPorPublicacion = new Map();
  m.decretosPorSha = new Map();
  m.decretoPorExpediente = new Map();
  for (const d of m.decretos) {
    for (const x of d.documentos ?? []) {
      agregar(m.decretosPorPublicacion, `${x.documento}|${x.publicacion}`, d);
      for (const c of [...(x.commits ?? []), ...(x.commits_candidatos ?? [])]) agregar(m.decretosPorSha, c.sha, d);
    }
    for (const e of d.expedientes ?? []) m.decretoPorExpediente.set(e.id, d);
  }
  // Votaciones por expediente; de cada fuente de cámara, la del SIL a la que apunta.
  m.votacionesPorExpediente = new Map();
  m.otrasFuentes = new Map();
  for (const v of m.votaciones.values()) {
    agregar(m.votacionesPorExpediente, v.expediente_id, v);
    agregar(m.otrasFuentes, v.votacion_sil, v);
  }
  for (const vs of m.votacionesPorExpediente.values()) vs.sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? "") || a.id.localeCompare(b.id));
  // Votos de cada persona.
  m.votosPorPersona = new Map();
  for (const { v, conVotos } of votacionesUnicas(m)) for (const x of conVotos?.votes ?? []) agregar(m.votosPorPersona, x.voter_id, { votacion: v, fuente: conVotos, voto: x });
  for (const vs of m.votosPorPersona.values()) vs.sort((a, b) => (b.votacion.start_date ?? "").localeCompare(a.votacion.start_date ?? ""));
  // Mandatos de cada persona.
  m.mandatosPorPersona = new Map();
  for (const x of m.mandatos.values()) agregar(m.mandatosPorPersona, x.person_id, x);
  // La foto de cada persona (`image`) es la copia que cita uno de sus mandatos.
  m.fotos = new Map();
  for (const p of m.personas.values()) {
    if (!p.image) continue;
    const f = (m.mandatosPorPersona.get(p.id) ?? [])
      .flatMap((x) => x.sources ?? [])
      .find((s) => s.url === p.image && /\.(jpg|png)$/.test(s.archivo ?? ""));
    if (f) m.fotos.set(p.id, { archivo: f.archivo, sha256: f.sha256, url: f.url });
  }
  // Asuntos por autor y por expediente.
  m.asuntosPorPersona = new Map();
  m.asuntosPorSeguimiento = new Map();
  for (const [tipo, xs] of Object.entries(m.asuntos)) {
    for (const a of xs) {
      for (const p of a.presentadores ?? []) if (p.person_id) agregar(m.asuntosPorPersona, p.person_id, { tipo, asunto: a });
      agregar(m.asuntosPorSeguimiento, a.seguimiento, { tipo, asunto: a });
    }
  }
  return m;
}

export async function leerCongreso() {
  try {
    const raiz = await carpeta();
    const subs = ["organizaciones", "personas", "mandatos", "expedientes", "votaciones", "decretos", "cronologia", ...Object.keys(ASUNTOS)];
    const leidos = await Promise.all(subs.map((s) => leerCarpeta(raiz, s)));
    const r = Object.fromEntries(subs.map((s, i) => [ASUNTOS[s] ?? s, leidos[i]]));
    const m = modeloCongreso(r);
    // Una página nunca enlaza una foto que el despliegue no lleve.
    for (const [id, f] of m.fotos) if (!(await existe(join(raiz, f.archivo)))) m.fotos.delete(id);
    return { ok: true, raiz, ...m };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
