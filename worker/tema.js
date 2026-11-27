// La vista por tema: para unas palabras, en una sola respuesta, los artículos
// vigentes, los asuntos del Congreso con su desenlace, sus votaciones y quién
// los presentó.
//
// Nada se interpreta ni se elige a mano: una unidad es del tema si tiene todas
// las palabras (la misma búsqueda literal de `busqueda.js`), y se agrupa con
// lo que los datos ya dicen de ella: los asuntos por la ley que su título
// reforma o expide, las votaciones por su asunto y cámara, y los autores por
// su registro de legislador.

import { ErrorDatos, SITIO, catalogo, json } from "./datos.js";
import { asuntoDe, buscar, lineaAsunto, posicionesCon } from "./busqueda.js";
import { TIPOS_ASUNTO, agruparPorAsunto, leerVotaciones, lineaVotacion } from "./congreso.js";

const MAX_LEYES = 12;
const MAX_QUIENES = 10;
const MAX_DECRETOS = 50;

const contar = (xs) => {
  const c = {};
  for (const x of xs) c[x] = (c[x] ?? 0) + 1;
  return c;
};
const enOrden = (c) => Object.entries(c).sort((a, b) => b[1] - a[1]);

// Los asuntos de un tipo que tienen todas las palabras: cuántos, su desenlace,
// qué leyes nombran y quién los presentó, sin leer más fichas que las de ejemplo.
async function asuntosDelTema(env, tipo, texto, limite) {
  const f = await json(env, `congreso/_/${tipo}/f.json`);
  if (!f) return null;
  const { posiciones, col } = await posicionesCon(env, `congreso/${tipo}`, texto);
  const del = new Set(posiciones);
  const cuantos = (xs) => xs.reduce((n, i) => n + (del.has(i) ? 1 : 0), 0);
  const cruce = (indice) =>
    Object.fromEntries(
      Object.entries(indice)
        .map(([k, xs]) => [k, cuantos(xs)])
        .filter(([, n]) => n),
    );
  const fechas = posiciones.map((i) => f.fechas[i]).filter(Boolean).sort();
  return {
    tipo,
    nombre: TIPOS_ASUNTO[tipo],
    total: posiciones.length,
    desde: fechas[0] ?? null,
    hasta: fechas.at(-1) ?? null,
    por_resultado: contar(posiciones.map((i) => f.resultados[f.resultado[i]] ?? "sin dato")),
    por_partido: contar(posiciones.map((i) => f.partidos[f.partido[i]] ?? "sin dato")),
    por_ley: cruce(f.leyes),
    por_autor: cruce(f.autores),
    ejemplos: (await Promise.all(posiciones.slice(0, limite).map((i) => asuntoDe(env, col, i)))).filter(Boolean),
  };
}

export async function tema(env, { texto, limite } = {}) {
  const n = Math.min(Math.max(1, Number(limite) || 5), 20);
  // La búsqueda valida el texto y da los artículos vigentes y la cobertura.
  const b = await buscar(env, { texto, tipos: ["ley"], limite: n });
  const [cat, r, legis, decretos, ...porTipo] = await Promise.all([
    catalogo(env),
    leerVotaciones(env),
    json(env, "congreso/legisladores.json"),
    posicionesCon(env, "congreso/decreto", texto).catch(() => null),
    ...Object.keys(TIPOS_ASUNTO).map((tipo) => asuntosDelTema(env, tipo, texto, n)),
  ]);
  if (!cat) throw new ErrorDatos("El catálogo no está disponible en este despliegue.");
  const asuntos = porTipo.filter(Boolean);

  const pv = (await posicionesCon(env, "congreso/votacion", texto).catch(() => null))?.posiciones ?? [];
  const votadas = pv.map((i) => r.votaciones[i]).filter(Boolean).sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));
  const porAsunto = agruparPorAsunto(votadas);

  const fichasDecreto = decretos
    ? (await Promise.all(decretos.posiciones.slice(0, MAX_DECRETOS).map((i) => asuntoDe(env, decretos.col, i)))).filter(Boolean)
    : [];

  // Una fila por ley: lo que el tema toca de ella en cada colección.
  const leyes = new Map();
  const fila = (documento) => {
    if (!leyes.has(documento)) {
      const d = cat.documentos.find((x) => x.documento === documento);
      leyes.set(documento, { documento, nombre: d?.nombre ?? documento, url: `${SITIO}/ley/${documento}`, articulos: 0, iniciativas: 0, proposiciones: 0, dictamenes: 0, votaciones: 0, decretos: 0 });
    }
    return leyes.get(documento);
  };
  const CAMPO = { iniciativa: "iniciativas", proposicion: "proposiciones", dictamen: "dictamenes" };
  for (const l of b.leyes) fila(l.documento).articulos = l.coincidencias;
  for (const a of asuntos) for (const [doc, k] of Object.entries(a.por_ley)) fila(doc)[CAMPO[a.tipo]] += k;
  for (const v of votadas) for (const l of v.leyes) fila(l.documento).votaciones++;
  for (const d of fichasDecreto) for (const doc of d.leyes ?? []) fila(doc).decretos++;
  const delCongreso = (x) => x.iniciativas + x.proposiciones + x.dictamenes + x.votaciones + x.decretos;
  const porLey = [...leyes.values()].sort((a, b) => delCongreso(b) - delCongreso(a) || b.articulos - a.articulos);

  const personas = new Map((legis?.legisladores ?? []).map((p) => [p.id, p]));
  const quienes = new Map();
  for (const a of asuntos) {
    for (const [id, k] of Object.entries(a.por_autor)) {
      if (!quienes.has(id)) {
        const p = personas.get(id);
        quienes.set(id, { id, nombre: p?.nombre ?? id, grupo: p?.grupo ?? null, camara: p?.camara ?? null, iniciativas: 0, proposiciones: 0, dictamenes: 0 });
      }
      quienes.get(id)[CAMPO[a.tipo]] += k;
    }
  }
  const presentados = (q) => q.iniciativas + q.proposiciones + q.dictamenes;
  const quienesOrden = [...quienes.values()].sort((a, b) => presentados(b) - presentados(a) || a.nombre.localeCompare(b.nombre, "es"));

  return {
    consulta: texto,
    palabras: b.palabras,
    ignoradas: b.ignoradas,
    sin_resultados_para: b.sin_resultados_para,
    metodo:
      "Una unidad es del tema si tiene todas las palabras (sin acentos ni mayúsculas; no hay sinónimos): los artículos por su texto, y los asuntos, decretos y votaciones por su título. Los asuntos se atribuyen a la ley que su título reforma o expide por su nombre; las votaciones se agrupan por asunto y cámara; los autores son los que tienen registro de legislador.",
    vigente: {
      documentos: b.documentos_con_coincidencias,
      articulos: b.articulos_con_coincidencias,
      leyes: b.leyes.slice(0, MAX_LEYES),
    },
    asuntos: asuntos.map(({ por_ley, por_autor, ...a }) => a),
    votaciones: { total: votadas.length, asuntos: porAsunto.length, lista: porAsunto.slice(0, n) },
    decretos: { total: decretos?.posiciones.length ?? 0, lista: fichasDecreto.slice(0, n) },
    por_ley: porLey.slice(0, MAX_LEYES),
    leyes_tocadas: porLey.length,
    quienes: quienesOrden.slice(0, MAX_QUIENES),
    legisladores_autores: quienesOrden.length,
    cobertura: b.cobertura,
  };
}

const lista = (c, nombres = {}) =>
  enOrden(c)
    .map(([k, n]) => `${n} ${nombres[k] ?? k}`)
    .join(", ");

export function mdTema(r) {
  const partes = [`# Tema: «${r.consulta}»`];
  const notas = [r.metodo];
  if (r.ignoradas.length) notas.push(`Se ignoraron por comunes: ${r.ignoradas.join(", ")}.`);
  if (r.sin_resultados_para.length) notas.push(`Ninguna unidad contiene: ${r.sin_resultados_para.join(", ")}.`);
  notas.push("Para otro ángulo del mismo tema, repite con las palabras que usaría la ley o una iniciativa.");
  partes.push(notas.join(" "));

  if (r.vigente.leyes.length) {
    const lineas = r.vigente.leyes.map((l) => {
      const arts = l.articulos.map((a) => `  - [${a.etiqueta}](${a.url}): ${a.fragmento}`).join("\n");
      return `- **${l.nombre}** (\`${l.documento}\`): ${l.coincidencias === 1 ? "1 artículo" : `${l.coincidencias} artículos`}${arts ? `\n${arts}` : ""}`;
    });
    const mas = r.vigente.documentos - r.vigente.leyes.length;
    partes.push(`## Texto vigente: ${r.vigente.articulos} artículos en ${r.vigente.documentos} documentos\n\n${lineas.join("\n")}${mas > 0 ? `\n\n(y ${mas} documentos más: herramienta \`buscar\`)` : ""}`);
  } else {
    partes.push("## Texto vigente\n\nNingún artículo vigente tiene todas las palabras.");
  }

  for (const a of r.asuntos) {
    if (!a.total) continue;
    partes.push(
      `## ${a.nombre}: ${a.total} (del ${a.desde} al ${a.hasta})\n\nPor desenlace: ${lista(a.por_resultado)}. Por partido: ${lista(a.por_partido)}.\n\n${a.ejemplos.map((x) => lineaAsunto(a.tipo, x)).join("\n")}${a.total > a.ejemplos.length ? `\n\n(las ${a.ejemplos.length} más recientes; todas, con la herramienta \`asuntos\`: tipo «${a.tipo}», texto «${r.consulta}»)` : ""}`,
    );
  }

  if (r.votaciones.total) {
    partes.push(
      `## Votaciones: ${r.votaciones.total} en ${r.votaciones.asuntos === 1 ? "1 asunto" : `${r.votaciones.asuntos} asuntos`}\n\n${r.votaciones.lista.map((v) => lineaVotacion(v)).join("\n")}${r.votaciones.asuntos > r.votaciones.lista.length ? `\n\n(los ${r.votaciones.lista.length} asuntos más recientes; todos, con la herramienta \`votaciones\`: texto «${r.consulta}»)` : ""}`,
    );
  }
  if (r.decretos.total) {
    partes.push(`## Decretos del DOF: ${r.decretos.total}\n\n${r.decretos.lista.map((d) => lineaAsunto("decreto", d)).join("\n")}`);
  }

  const congreso = r.por_ley.filter((l) => l.iniciativas + l.proposiciones + l.dictamenes + l.votaciones + l.decretos);
  if (congreso.length) {
    const filas = congreso.map((l) => `| ${l.nombre} (\`${l.documento}\`) | ${l.articulos} | ${l.iniciativas} | ${l.proposiciones} | ${l.dictamenes} | ${l.votaciones} | ${l.decretos} |`);
    partes.push(`## Por ley\n\n| Ley | Artículos vigentes | Iniciativas | Proposiciones | Dictámenes negativos | Votaciones | Decretos |\n|---|---|---|---|---|---|---|\n${filas.join("\n")}`);
  }
  if (r.quienes.length) {
    const linea = (q) => {
      const que = [q.iniciativas && `${q.iniciativas} ${q.iniciativas === 1 ? "iniciativa" : "iniciativas"}`, q.proposiciones && `${q.proposiciones} ${q.proposiciones === 1 ? "proposición" : "proposiciones"}`].filter(Boolean).join(", ");
      return `- ${q.nombre}${q.grupo ? ` (${q.grupo})` : ""} · \`${q.id}\`${que ? ` · ${que}` : ""}`;
    };
    partes.push(`## Quién los presentó: ${r.legisladores_autores === 1 ? "1 legislador" : `${r.legisladores_autores} legisladores`}\n\n${r.quienes.map(linea).join("\n")}`);
  }

  const c = r.cobertura;
  const tipos = Object.entries(c.congreso).map(([t, x]) => `${t} (${x.total}${x.desde ? `, del ${x.desde} al ${x.hasta}` : ""})`);
  partes.push(
    `Cobertura: ${c.leyes.documentos} documentos con su texto vigente; leyes estatales además de la constitución solo de ${c.leyes.estados_con_leyes.join(", ") || "ningún estado"}.${tipos.length ? ` Del Congreso de la Unión: ${tipos.join("; ")}; no hay datos de los congresos de los estados ni de antes de esas fechas.` : ""} Sin resultados no significa que no haya ocurrido.`,
  );
  return `${partes.join("\n\n")}\n`;
}

// ------------------------------------------------------------------ para personas

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const num = (n) => new Intl.NumberFormat("es-MX").format(n);
const cuantos = (n, uno, varios) => `${num(n)} ${n === 1 ? uno : varios}`;
// Las URL de los datos son absolutas; en la página bastan relativas.
const local = (url) => esc(String(url ?? "").replace(SITIO, "") || "#");

const NOMBRE_RESULTADO = { pendiente: "pendientes", aprobado: "aprobadas", desechado: "desechadas", retirado: "retiradas", "sin dato": "sin dato" };

function htmlAsunto(a) {
  const quien = (a.autores ?? [])
    .slice(0, 3)
    .map((x) => (x.id ? `<a href="/congreso/legisladores/${esc(x.id)}">${esc(x.nombre)}</a>` : esc(x.nombre)) + (x.grupo ? ` (${esc(x.grupo)})` : ""))
    .join(", ");
  const enlace = a.expediente ?? a.sil;
  return `<li><span class="dato">${esc(a.fecha ?? "")}</span> ${enlace ? `<a href="${local(enlace)}">${esc(a.titulo)}</a>` : esc(a.titulo)}<small>${[quien && `${quien}${(a.autores?.length ?? 0) > 3 ? " y otros" : ""}`, esc(a.estatus ?? "")].filter(Boolean).join(" · ")}</small></li>`;
}

function htmlVotacion(v) {
  const otras = v.otras_del_asunto ? ` · ${v.otras_del_asunto === 1 ? "y otra votación" : `y ${v.otras_del_asunto} votaciones más`} del asunto en esta cámara` : "";
  return `<li><span class="dato">${esc(v.fecha ?? "")}</span> <a href="${local(v.url)}">${esc(v.asunto ?? v.resultado ?? v.id)}</a><small>${esc(v.camara ?? "")} · ${num(v.a_favor)} a favor, ${num(v.en_contra)} en contra, ${cuantos(v.abstenciones, "abstención", "abstenciones")}${otras}</small></li>`;
}

export function htmlTema(r) {
  const partes = [];
  const avisos = [];
  if (r.ignoradas.length) avisos.push(`Se ignoraron por comunes: ${esc(r.ignoradas.join(", "))}.`);
  if (r.sin_resultados_para.length) avisos.push(`Nada de lo publicado contiene: ${esc(r.sin_resultados_para.join(", "))}.`);
  if (avisos.length) partes.push(`<p class="aviso">${avisos.join(" ")}</p>`);

  const congreso = r.asuntos.reduce((s, a) => s + a.total, 0) + r.votaciones.total + r.decretos.total;
  if (!r.vigente.articulos && !congreso) {
    partes.push(`<p>Nada de lo publicado tiene todas esas palabras. La búsqueda es literal: prueba con las que usaría la ley o una iniciativa.</p>`);
  }

  if (r.vigente.articulos) {
    const leyes = r.vigente.leyes
      .map((l) => {
        const arts = l.articulos.map((a) => `<li><a href="${local(a.url)}">${esc(a.etiqueta)}</a> <span class="fragmento">${esc(a.fragmento)}</span></li>`).join("");
        return `<li><a href="${local(l.url)}">${esc(l.nombre)}</a> <span class="cuenta">${cuantos(l.coincidencias, "artículo", "artículos")}</span>${arts ? `<ul class="articulos">${arts}</ul>` : ""}</li>`;
      })
      .join("\n");
    const mas = r.vigente.documentos - r.vigente.leyes.length;
    partes.push(`<section><h2>Texto vigente</h2>
<p class="resumen">${cuantos(r.vigente.articulos, "artículo", "artículos")} en ${cuantos(r.vigente.documentos, "documento", "documentos")}.</p>
<ul class="tema-lista">${leyes}</ul>${mas > 0 ? `<p class="resumen">Y ${cuantos(mas, "documento más", "documentos más")}, con menos artículos.</p>` : ""}</section>`);
  }

  for (const a of r.asuntos) {
    if (!a.total) continue;
    const desenlace = enOrden(a.por_resultado)
      .map(([k, n]) => `${num(n)} ${NOMBRE_RESULTADO[k] ?? k}`)
      .join(", ");
    partes.push(`<section><h2>${esc(a.nombre)}</h2>
<p class="resumen">${num(a.total)}, del ${esc(a.desde)} al ${esc(a.hasta)}: ${esc(desenlace)}.</p>
<ul class="tema-lista">${a.ejemplos.map(htmlAsunto).join("\n")}</ul>${a.total > a.ejemplos.length ? `<p class="resumen">Se muestran las ${a.ejemplos.length} más recientes.</p>` : ""}</section>`);
  }

  if (r.votaciones.total) {
    partes.push(`<section><h2>Votaciones</h2>
<p class="resumen">${cuantos(r.votaciones.total, "votación nominal", "votaciones nominales")} en ${cuantos(r.votaciones.asuntos, "asunto", "asuntos")}.</p>
<ul class="tema-lista">${r.votaciones.lista.map(htmlVotacion).join("\n")}</ul></section>`);
  }
  if (r.decretos.total) {
    partes.push(`<section><h2>Decretos del DOF</h2>
<ul class="tema-lista">${r.decretos.lista.map((d) => `<li><span class="dato">${esc(d.fecha ?? "")}</span> <a href="${local(d.url)}">${esc(d.titulo)}</a></li>`).join("\n")}</ul></section>`);
  }

  const porLey = r.por_ley.filter((l) => l.iniciativas + l.proposiciones + l.dictamenes + l.votaciones + l.decretos);
  if (porLey.length) {
    const celda = (n) => `<td class="num">${n ? num(n) : "—"}</td>`;
    partes.push(`<section><h2>Por ley</h2>
<p class="resumen">Las leyes que esos asuntos reforman o expiden por su nombre.</p>
<div class="desplazable" tabindex="0"><table>
<thead><tr><th>Ley</th><th class="num">Artículos vigentes</th><th class="num">Iniciativas</th><th class="num">Proposiciones</th><th class="num">Votaciones</th><th class="num">Decretos</th></tr></thead>
<tbody>${porLey.map((l) => `<tr><th><a href="${local(l.url)}">${esc(l.nombre)}</a></th>${celda(l.articulos)}${celda(l.iniciativas)}${celda(l.proposiciones)}${celda(l.votaciones)}${celda(l.decretos)}</tr>`).join("\n")}</tbody>
</table></div></section>`);
  }

  if (r.quienes.length) {
    const linea = (q) => {
      const que = [q.iniciativas && cuantos(q.iniciativas, "iniciativa", "iniciativas"), q.proposiciones && cuantos(q.proposiciones, "proposición", "proposiciones")].filter(Boolean).join(", ");
      return `<li><a href="/congreso/legisladores/${esc(q.id)}">${esc(q.nombre)}</a>${q.grupo ? ` (${esc(q.grupo)})` : ""}<small>${que}</small></li>`;
    };
    partes.push(`<section><h2>Quién los presentó</h2>
<p class="resumen">${cuantos(r.legisladores_autores, "legislador", "legisladores")}${r.legisladores_autores > r.quienes.length ? `; los ${r.quienes.length} con más asuntos` : ""}.</p>
<ul class="tema-lista">${r.quienes.map(linea).join("\n")}</ul></section>`);
  }

  const c = r.cobertura;
  const iniciativas = c.congreso.iniciativa;
  partes.push(`<section><h2>Qué cubre</h2>
<p class="resumen">${esc(r.metodo)}</p>
<p class="resumen">Se buscó en el texto vigente de ${num(c.leyes.documentos)} documentos${iniciativas?.desde ? ` y en los asuntos del Congreso de la Unión desde el ${esc(iniciativas.desde)}` : ""}. No hay datos de los congresos de los estados ni de antes de esa fecha: que algo no aparezca no significa que no haya ocurrido.</p></section>`);
  return partes.join("\n\n");
}

const MARCA_RESULTADO = "<!-- resultado -->";
const MARCA_VALOR = 'name="q" value=""';

// /tema?q=…: la página base del despliegue con el resultado en su lugar. Sin
// consulta, la página tal cual.
export async function rutaTema(request, env, prefiereMd) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const base = await env.ASSETS.fetch(new Request(new URL("/tema", url)));
  if (!q || !base.ok) return base;
  let cuerpo;
  try {
    const r = await tema(env, { texto: q, limite: 5 });
    if (prefiereMd) return new Response(mdTema(r), { headers: { "Content-Type": "text/markdown; charset=utf-8", Vary: "Accept" } });
    cuerpo = htmlTema(r);
  } catch (e) {
    if (!(e instanceof ErrorDatos)) throw e;
    cuerpo = `<p class="aviso">${esc(e.message)}</p>`;
  }
  const html = (await base.text()).replace(MARCA_VALOR, `name="q" value="${esc(q)}"`).replace(MARCA_RESULTADO, cuerpo);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", Vary: "Accept", "X-Robots-Tag": "noindex" } });
}
