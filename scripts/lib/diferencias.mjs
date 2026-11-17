// Diferencia entre dos versiones del texto de un artículo, en HTML. Primero
// por párrafos y, dentro de cada párrafo que cambió, por palabras: así una
// reforma que cambia «ciudadano» por «ciudadano o ciudadana» se ve en su
// lugar y no como un párrafo entero quitado y otro puesto.
//
// Sin dependencias: LCS con prefijo y sufijo comunes recortados, que basta
// para artículos (cientos de párrafos, miles de palabras).

import { esc } from "./comun.mjs";

// Por encima de este producto de longitudes la tabla de LCS sería pesada; el
// tramo se da por reemplazado completo.
const CELDAS_MAX = 4_000_000;

// Tamaño máximo del HTML de un artículo. Hay artículos que son una tarifa
// entera (la LIGIE): su diferencia completa pesaría megas y se trunca; el resto
// queda en el commit.
const HTML_MAX = 120_000;

// Párrafos iguales que se muestran alrededor de cada cambio.
const CONTEXTO = 1;

// Por debajo de esta proporción de palabras comunes, dos párrafos no se
// comparan entre sí: se muestran como uno quitado y otro nuevo.
const PARECIDO_MIN = 0.4;

// Operaciones [tipo, elemento] con tipo "=", "-" o "+".
function diferencia(a, b, igual = (x, y) => x === y) {
  let ini = 0;
  while (ini < a.length && ini < b.length && igual(a[ini], b[ini])) ini++;
  let fa = a.length;
  let fb = b.length;
  while (fa > ini && fb > ini && igual(a[fa - 1], b[fb - 1])) {
    fa--;
    fb--;
  }
  const ops = a.slice(0, ini).map((x) => ["=", x]);
  const ma = a.slice(ini, fa);
  const mb = b.slice(ini, fb);
  const n = ma.length;
  const m = mb.length;
  if (n * m > CELDAS_MAX) {
    ops.push(...ma.map((x) => ["-", x]), ...mb.map((x) => ["+", x]));
  } else {
    // t[i][j] = LCS de ma[i:] y mb[j:], en una tabla plana.
    const t = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i * (m + 1) + j] = igual(ma[i], mb[j])
          ? t[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(t[(i + 1) * (m + 1) + j], t[i * (m + 1) + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (igual(ma[i], mb[j])) {
        ops.push(["=", ma[i]]);
        i++;
        j++;
      } else if (t[(i + 1) * (m + 1) + j] >= t[i * (m + 1) + j + 1]) ops.push(["-", ma[i++]]);
      else ops.push(["+", mb[j++]]);
    }
    while (i < n) ops.push(["-", ma[i++]]);
    while (j < m) ops.push(["+", mb[j++]]);
  }
  ops.push(...a.slice(fa).map((x) => ["=", x]));
  return ops;
}

const parrafos = (texto) =>
  (texto ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

const palabras = (p) => p.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];

// Diferencia por palabras de dos párrafos, o null si se parecen tan poco que
// marcar palabra por palabra sería ruido.
function enLinea(antes, despues) {
  const a = palabras(antes);
  const b = palabras(despues);
  const ops = diferencia(a, b);
  const comunes = ops.filter(([t, x]) => t === "=" && /\S/.test(x)).length;
  const total = Math.max(a.filter((x) => /\S/.test(x)).length, b.filter((x) => /\S/.test(x)).length, 1);
  if (comunes / total < PARECIDO_MIN) return null;
  // Agrupa en tramos y absorbe los espacios sueltos entre dos cambios, para
  // que «a b c» → «x y z» se lea como un tramo y no palabra por palabra.
  const tramos = [];
  for (const [t, x] of ops) {
    const ultimo = tramos.at(-1);
    if (ultimo && ultimo.t === t) ultimo.x += x;
    else tramos.push({ t, x });
  }
  for (let i = 1; i < tramos.length - 1; i++) {
    if (tramos[i].t === "=" && !/\S/.test(tramos[i].x) && tramos[i - 1].t !== "=" && tramos[i + 1].t !== "=") {
      tramos[i].t = "~";
    }
  }
  let html = "";
  let quitado = "";
  let puesto = "";
  const vaciar = () => {
    if (quitado) html += `<del>${esc(quitado)}</del>`;
    if (puesto) html += `<ins>${esc(puesto)}</ins>`;
    quitado = puesto = "";
  };
  for (const { t, x } of tramos) {
    if (t === "-") quitado += x;
    else if (t === "+") puesto += x;
    else if (t === "~") {
      quitado += x;
      puesto += x;
    } else {
      vaciar();
      html += esc(x);
    }
  }
  vaciar();
  return html;
}

// Por encima de este número de comparaciones entre párrafos quitados y puestos
// de un mismo tramo (un artículo reescrito entero) se emparejan por posición.
const PARES_MAX = 400;

// Alinea los párrafos quitados `q` con los puestos `p`: la subsecuencia común
// más larga donde «igual» es «se parecen». Cada elemento es { a, b, html }:
// un par (con su diferencia por palabras), un quitado solo o un puesto solo.
function alinear(q, p) {
  const n = q.length;
  const m = p.length;
  const html = (i, j) => enLinea(limpiar(q[i]), limpiar(p[j]));
  const res = [];
  if (n * m > PARES_MAX) {
    for (let k = 0; k < Math.max(n, m); k++) {
      const h = k < n && k < m ? html(k, k) : null;
      if (h != null) res.push({ a: q[k], b: p[k], html: h });
      else {
        if (k < n) res.push({ a: q[k] });
        if (k < m) res.push({ b: p[k] });
      }
    }
    return res;
  }
  const par = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => html(i, j)));
  const t = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i][j] = par[i][j] != null ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && par[i][j] != null && t[i][j] === t[i + 1][j + 1] + 1) {
      res.push({ a: q[i], b: p[j], html: par[i][j] });
      i++;
      j++;
    } else if (j >= m || (i < n && t[i + 1][j] >= t[i][j + 1])) res.push({ a: q[i++] });
    else res.push({ b: p[j++] });
  }
  return res;
}

// Un párrafo del texto legal: el encabezado del artículo (`# Artículo 82.`) y
// las notas de reforma en cursiva (`_Párrafo reformado DOF …_`) se distinguen
// del cuerpo.
function claseParrafo(p) {
  if (/^#{1,6} /.test(p)) return "enc";
  if (/^_[^_].*_$/s.test(p)) return "nota";
  return "";
}

const limpiar = (p) => p.replace(/^#{1,6} /, "").replace(/^_(.*)_$/s, "$1");

function bloque(tipo, p, html) {
  const clase = [tipo, claseParrafo(p)].filter(Boolean).join(" ");
  return `<p class="${clase}">${html ?? esc(limpiar(p))}</p>`;
}

// Diferencia de un artículo en HTML: los párrafos cambiados con
// `CONTEXTO` párrafos iguales alrededor y el resto resumido. Devuelve también
// cuántos párrafos se quitaron, pusieron o modificaron.
export function diferenciaArticulo(antes, despues) {
  const ops = diferencia(parrafos(antes), parrafos(despues));
  // Dentro de cada tramo de quitados y puestos que se suceden, empareja los
  // párrafos que se parecen (en orden) para marcarlos palabra por palabra.
  const filas = [];
  const cuenta = { quitados: 0, puestos: 0, modificados: 0 };
  for (let i = 0; i < ops.length; ) {
    if (ops[i][0] === "=") {
      filas.push({ igual: true, html: bloque("igual", ops[i][1]) });
      i++;
      continue;
    }
    const q = [];
    const p = [];
    while (i < ops.length && ops[i][0] !== "=") (ops[i][0] === "-" ? q : p).push(ops[i++][1]);
    for (const { a, b, html } of alinear(q, p)) {
      if (html != null) {
        filas.push({ html: bloque("mod", b, html) });
        cuenta.modificados++;
      } else if (a != null) {
        filas.push({ html: bloque("quitado", a, `<del>${esc(limpiar(a))}</del>`) });
        cuenta.quitados++;
      } else {
        filas.push({ html: bloque("puesto", b, `<ins>${esc(limpiar(b))}</ins>`) });
        cuenta.puestos++;
      }
    }
  }
  const visible = filas.map((f, i) =>
    !f.igual || filas.slice(Math.max(0, i - CONTEXTO), i + CONTEXTO + 1).some((g) => !g.igual),
  );
  const html = [];
  let tamaño = 0;
  let truncado = 0;
  for (let i = 0; i < filas.length; ) {
    if (tamaño > HTML_MAX) {
      truncado = filas.length - i;
      break;
    }
    if (visible[i]) {
      tamaño += filas[i].html.length;
      html.push(filas[i++].html);
      continue;
    }
    let n = 0;
    while (i < filas.length && !visible[i]) {
      n++;
      i++;
    }
    html.push(`<p class="omitidos">${n === 1 ? "1 párrafo sin cambios" : `${n} párrafos sin cambios`}</p>`);
  }
  return { html: html.join("\n"), ...cuenta, truncado, iguales: filas.every((f) => f.igual) };
}

// Encabezado del artículo (`# Artículo 82.` → `Artículo 82.`), o null.
export function encabezado(texto) {
  const m = /^#{1,6} (.+)$/m.exec(texto ?? "");
  return m ? m[1].trim() : null;
}
