// Historial de git de los repos de datos, para la bitácora. Cada commit trae
// trailers deterministas (Documento, Tipo, Publicacion, artículos…) que
// escribe el extractor (scripts/trailers.py en constitucion-extractor y
// fiscal-extractor): se leen tal cual, nunca se interpreta el título.
//
// La API de GitHub no alcanza para esto (un diff por commit serían cientos de
// peticiones), así que se clona cada repo sin árbol de trabajo en .datos/ y se
// lee con git. Con REPOS_DATOS=<carpeta> se usan clones que ya existan ahí
// (en local, los del espacio de trabajo) en lugar de clonar.

import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ORG, REPOS, intentar } from "./comun.mjs";

const DATOS = fileURLToPath(new URL("../../.datos/", import.meta.url));

// `metadatos`: el commit solo cambió la metadata del documento (índices,
// segmentos, notas de reforma), no el texto de ningún artículo.
export const TIPOS_DOCUMENTO = ["reforma", "correccion", "alta", "retiro", "metadatos"];
const LISTAS = ["Articulos-Adicionados", "Articulos-Modificados", "Articulos-Derogados", "Articulos-Corregidos"];

// ------------------------------------------------------------------ git

function git(dir, args, entrada) {
  return new Promise((resolver, rechazar) => {
    const p = spawn("git", ["-C", dir, "-c", "core.quotePath=false", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const salida = [];
    const errores = [];
    p.stdout.on("data", (b) => salida.push(b));
    p.stderr.on("data", (b) => errores.push(b));
    p.on("error", rechazar);
    // Si git termina antes de leer la entrada, escribirle da EPIPE: el error
    // que importa es el de git, que llega con su código de salida.
    p.stdin.on("error", () => {});
    p.on("close", (codigo) => {
      if (codigo === 0) resolver(Buffer.concat(salida));
      else rechazar(new Error(`git ${args[0]}: ${Buffer.concat(errores).toString().trim() || `código ${codigo}`}`));
    });
    p.stdin.end(entrada ?? "");
  });
}

const existe = (ruta) =>
  access(ruta).then(
    () => true,
    () => false,
  );

// Carpeta de git del repo, al día con main. Los clones son --bare: solo hace
// falta el historial, no los decenas de miles de archivos de texto.
async function clon(repo) {
  if (process.env.REPOS_DATOS) {
    const dir = join(process.env.REPOS_DATOS, repo);
    if (!(await existe(dir))) throw new Error(`no existe ${dir}`);
    return { dir, rev: "HEAD" };
  }
  const dir = join(DATOS, `${repo}.git`);
  if (await existe(dir)) {
    await git(dir, ["fetch", "--quiet", "--prune", "origin", "+refs/heads/main:refs/heads/main"]);
  } else {
    await mkdir(DATOS, { recursive: true });
    await git(DATOS, ["clone", "--quiet", "--bare", "--single-branch", "--branch", "main", `https://github.com/${ORG}/${repo}`, dir]);
  }
  return { dir, rev: "main" };
}

// Lee muchos blobs con un solo `git cat-file --batch`. Devuelve un Map
// revisión → texto (o null si no existe, como el padre del primer commit o un
// artículo que aún no estaba).
async function leerBlobs(dir, revisiones) {
  const unicas = [...new Set(revisiones)];
  const resultado = new Map();
  if (!unicas.length) return resultado;
  const salida = await git(dir, ["cat-file", "--batch"], unicas.join("\n") + "\n");
  let i = 0;
  for (const rev of unicas) {
    const fin = salida.indexOf(10, i);
    const cabecera = salida.toString("utf8", i, fin);
    i = fin + 1;
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(cabecera);
    if (!m) {
      resultado.set(rev, null);
      continue;
    }
    const tam = Number(m[2]);
    resultado.set(rev, m[1] === "blob" ? salida.toString("utf8", i, i + tam) : null);
    i += tam + 1;
  }
  return resultado;
}

// ------------------------------------------------------------------ disposición
// Espejo de esquema_de / _dir_articulos / _dir_metadata de trailers.py.

export function esquema(documento) {
  if (documento === "cpeum") return "cpeum";
  if (documento.endsWith("/constitucion")) return "estatal";
  return "corpus";
}

export function dirArticulos(documento) {
  const e = esquema(documento);
  return e === "cpeum" ? "articulos/" : e === "estatal" ? `${documento}/articulos/` : `${documento}/`;
}

export function dirMetadata(documento) {
  const e = esquema(documento);
  return e === "cpeum" ? "metadata/" : e === "estatal" ? `${documento}/metadata/` : `metadata/${documento}/`;
}

const rutaArticulo = (documento, clave) => `${dirArticulos(documento)}${clave}.md`;

function esArticulo(ruta, documento) {
  const base = dirArticulos(documento);
  if (!ruta.startsWith(base)) return false;
  const resto = ruta.slice(base.length);
  return !resto.includes("/") && resto.endsWith(".md");
}

// ------------------------------------------------------------------ log

const lista = (v) =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function parsearLog(texto, repo) {
  const commits = [];
  for (const registro of texto.split("\x1e")) {
    if (!registro.trim()) continue;
    const [sha, padre, fecha, titulo, resto] = registro.split("\x1f");
    const trailers = {};
    const archivos = [];
    for (const linea of resto.split("\n")) {
      const archivo = /^([ACDMTUX])\t(.+)$/.exec(linea);
      if (archivo) {
        archivos.push({ estado: archivo[1], ruta: archivo[2] });
        continue;
      }
      const t = /^([A-Z][A-Za-z0-9-]*): (.+)$/.exec(linea);
      if (t) (trailers[t[1]] ??= []).push(t[2].trim());
    }
    const uno = (k) => trailers[k]?.[0] ?? null;
    commits.push({
      repo,
      // Posición en el log (0 es el más reciente): las fechas de commit
      // pueden repetirse, el orden del historial no.
      orden: commits.length,
      sha,
      padre: padre.split(" ")[0] || null,
      fecha,
      titulo,
      documento: uno("Documento"),
      tipo: uno("Tipo"),
      publicaciones: [...(trailers.Publicacion ?? [])].sort(),
      origen: uno("Publicacion-Origen"),
      medio: uno("Medio"),
      adicionados: lista(uno("Articulos-Adicionados")),
      modificados: lista(uno("Articulos-Modificados")),
      derogados: lista(uno("Articulos-Derogados")),
      corregidos: lista(uno("Articulos-Corregidos")),
      fuente: uno("Fuente"),
      sha256: uno("Fuente-Sha256"),
      extractor: uno("Extractor"),
      separacion: uno("Separacion"),
      archivos,
    });
  }
  return commits;
}

export const articulosDe = (c) => [...new Set([...c.adicionados, ...c.modificados, ...c.derogados, ...c.corregidos])];

// ------------------------------------------------------------------ nombres

const leerJson = (texto) => {
  try {
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
};

// Nombre y sigla de cada documento según los registros vigentes del repo; los
// documentos retirados ya no están en ellos y se leen de su último índice.
async function nombres(dir, rev, repo, commits) {
  const res = {};
  if (repo === REPOS.federales || repo === REPOS.fiscal) {
    const registro = repo === REPOS.federales ? "fuentes.json" : "metadata/documentos.json";
    const blobs = await leerBlobs(dir, [`${rev}:${registro}`]);
    for (const d of leerJson(blobs.get(`${rev}:${registro}`))?.documentos ?? []) {
      res[d.clave] = { nombre: d.etiqueta, sigla: d.sigla, tipoDocumento: d.tipo };
    }
    const faltan = new Map();
    for (const c of commits) {
      if (c.documento && !res[c.documento] && !faltan.has(c.documento)) {
        // El último commit del documento: si es su retiro, el índice está en el padre.
        const r = c.tipo === "retiro" ? `${c.sha}^` : c.sha;
        faltan.set(c.documento, `${r}:${dirMetadata(c.documento)}articulos.json`);
      }
    }
    const indices = await leerBlobs(dir, [...faltan.values()]);
    for (const [doc, r] of faltan) {
      const idx = leerJson(indices.get(r));
      if (idx) res[doc] = { nombre: idx.etiqueta ?? null, sigla: idx.sigla ?? null, tipoDocumento: idx.tipo ?? null };
    }
  }
  return res;
}

// ------------------------------------------------------------------ texto

// Texto antes y después de cada artículo que el commit enumera. Las altas y
// los retiros no se comparan: serían la ley entera.
async function textos(dir, commits) {
  const pedidos = [];
  for (const c of commits) {
    if (c.tipo !== "reforma" && c.tipo !== "correccion") continue;
    for (const clave of articulosDe(c)) {
      const ruta = rutaArticulo(c.documento, clave);
      pedidos.push(`${c.sha}^:${ruta}`, `${c.sha}:${ruta}`);
    }
  }
  const blobs = await leerBlobs(dir, pedidos);
  for (const c of commits) {
    c.textos = {};
    if (c.tipo !== "reforma" && c.tipo !== "correccion") continue;
    for (const clave of articulosDe(c)) {
      const ruta = rutaArticulo(c.documento, clave);
      c.textos[clave] = { ruta, antes: blobs.get(`${c.sha}^:${ruta}`) ?? null, despues: blobs.get(`${c.sha}:${ruta}`) ?? null };
    }
  }
}

// Fechas de reforma que anota el texto vigente de cada documento
// (metadata/reformas.json: fecha → artículos). Son las reformas anteriores a
// su alta, que no están como commits.
async function reformasVigentes(dir, rev, commits) {
  const docs = [...new Set(commits.map((c) => c.documento).filter(Boolean))];
  const rutas = Object.fromEntries(docs.map((d) => [d, `${rev}:${dirMetadata(d)}reformas.json`]));
  const blobs = await leerBlobs(dir, Object.values(rutas));
  const res = {};
  for (const d of docs) {
    const r = leerJson(blobs.get(rutas[d]));
    if (r && typeof r === "object") {
      res[d] = Object.entries(r)
        .filter(([f]) => /^\d{4}-\d{2}-\d{2}$/.test(f))
        .map(([fecha, arts]) => ({ fecha, articulos: Array.isArray(arts) ? arts.length : 0 }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
    }
  }
  return res;
}

async function leerRepo(repo) {
  const { dir, rev } = await clon(repo);
  const log = await git(dir, [
    "log",
    "--no-merges",
    "--no-renames",
    "--name-status",
    "--format=%x1e%H%x1f%P%x1f%cI%x1f%s%x1f%(trailers:only,unfold)",
    rev,
  ]);
  const commits = parsearLog(log.toString("utf8"), repo);
  await textos(dir, commits);
  for (const c of commits) {
    // Las altas y retiros cuentan sus artículos por los archivos del commit.
    c.articulosArchivo = c.documento ? c.archivos.filter((a) => esArticulo(a.ruta, c.documento)) : [];
    c.archivosMetadata = c.documento ? c.archivos.filter((a) => a.ruta.startsWith(dirMetadata(c.documento))) : [];
  }
  const cabeza = (await git(dir, ["rev-parse", rev])).toString().trim();
  return {
    repo,
    cabeza,
    commits,
    nombres: await nombres(dir, rev, repo, commits),
    reformas: await reformasVigentes(dir, rev, commits),
  };
}

// { [repo]: { ok, datos: { repo, cabeza, commits, nombres } } }
export async function leerHistorial() {
  const repos = Object.values(REPOS);
  const r = await Promise.all(repos.map((repo) => intentar(() => leerRepo(repo))));
  return Object.fromEntries(repos.map((repo, i) => [repo, r[i]]));
}
