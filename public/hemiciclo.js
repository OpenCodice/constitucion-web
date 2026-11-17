// Hemiciclos de /congreso y la bitácora (los genera scripts/lib/hemiciclo.mjs).
// Sin este archivo ya funcionan: cada asiento es un enlace con su <title>.
// Aquí se agrega el tooltip, el filtro por la leyenda, la búsqueda por nombre
// y moverse con las flechas. Sin dependencias ni llamadas de red.
(() => {
  "use strict";

  const SENTIDOS = { yes: "A favor", no: "En contra", abstain: "Abstención", "not voting": "Presente sin votar", absent: "Ausente" };
  // Clase del asiento (v0…v4, de scripts/lib/hemiciclo.mjs) → sentido.
  const CLASE_SENTIDO = ["yes", "no", "abstain", "not voting", "absent"];
  const normal = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  function iniciar(fig) {
    const svg = fig.querySelector(".hemiciclo-svg");
    if (!svg) return;
    const asientos = [...svg.querySelectorAll(":scope > a, :scope > .sn")];
    if (!asientos.length) return;
    const [cx, cy] = (svg.dataset.centro || "0 0").split(" ").map(Number);

    // El <title> da el tooltip nativo, que aquí se reemplaza por el propio; su
    // texto queda como nombre accesible.
    const info = asientos.map((a) => {
      const t = a.querySelector("title");
      const texto = t ? t.textContent : "";
      if (t) t.remove();
      a.setAttribute("aria-label", texto);
      if (!a.hasAttribute("href")) a.setAttribute("role", "img");
      a.setAttribute("tabindex", "-1");
      const c = a.querySelector("circle");
      const x = Number(c.getAttribute("cx")) - cx;
      const y = cy - Number(c.getAttribute("cy"));
      const v = /\bv(\d)\b/.exec(c.getAttribute("class"));
      return {
        a,
        texto,
        v: v ? CLASE_SENTIDO[v[1]] : null,
        nombre: normal(texto.split(" · ")[0]),
        radio: Math.hypot(x, y),
        angulo: Math.atan2(y, x),
        sn: a.classList.contains("sn"),
        d: c.classList.contains("d"),
      };
    });
    asientos[0].setAttribute("tabindex", "0");
    // Filas por radio, para subir y bajar con las flechas.
    const radios = [...new Set(info.map((i) => Math.round(i.radio)))].sort((p, q) => p - q);
    info.forEach((i) => (i.fila = radios.indexOf(Math.round(i.radio))));

    // ---------------------------------------------------------------- tooltip
    const tip = document.createElement("div");
    tip.className = "h-tip";
    tip.hidden = true;
    tip.setAttribute("aria-hidden", "true");
    fig.appendChild(tip);
    let activo = null;

    function llenar(i) {
      tip.textContent = "";
      const partes = i.texto.split(" · ");
      const v = i.v;
      partes.forEach((p, k) => {
        let el;
        if (k === 0 && !i.sn) {
          el = document.createElement("b");
          el.textContent = p;
        } else if (v && p === SENTIDOS[v]) {
          el = document.createElement("span");
          el.className = "t-v";
          const punto = document.createElement("i");
          punto.style.background = `var(--v${CLASE_SENTIDO.indexOf(v)})`;
          if (v === "absent") punto.style.border = "1px solid var(--fondo)";
          el.append(punto, p);
        } else if (p.startsWith("votó distinto")) {
          el = document.createElement("span");
          el.className = "t-d";
          el.textContent = p.charAt(0).toUpperCase() + p.slice(1);
        } else {
          el = document.createElement("span");
          el.style.display = "block";
          el.textContent = p;
        }
        tip.appendChild(el);
      });
      if (i.toque && i.a.hasAttribute("href")) {
        const ir = document.createElement("span");
        ir.className = "t-ir";
        ir.textContent = "Toca otra vez para abrir su página";
        tip.appendChild(ir);
      }
    }

    function mostrar(i) {
      if (activo && activo !== i) activo.a.classList.remove("activo");
      activo = i;
      i.a.classList.add("activo");
      llenar(i);
      tip.hidden = false;
      const f = fig.getBoundingClientRect();
      const r = i.a.querySelector("circle").getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let x = r.left + r.width / 2 - f.left - w / 2;
      x = Math.max(0, Math.min(x, f.width - w));
      let y = r.top - f.top - h - 8;
      if (r.top - h - 8 < 0) y = r.bottom - f.top + 8;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    }

    function ocultar() {
      tip.hidden = true;
      if (activo) {
        activo.a.classList.remove("activo");
        activo.toque = false;
      }
      activo = null;
    }

    const deEvento = (e) => {
      const k = e.target.closest ? asientos.indexOf(e.target.closest("a, .sn")) : -1;
      return k < 0 ? null : info[k];
    };

    let ultimoToque = false;
    svg.addEventListener("pointerdown", (e) => (ultimoToque = e.pointerType === "touch" || e.pointerType === "pen"));
    svg.addEventListener("pointerover", (e) => {
      if (e.pointerType !== "mouse") return;
      const i = deEvento(e);
      if (i) mostrar(i);
    });
    svg.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && !svg.contains(document.activeElement)) ocultar();
    });
    // En pantallas táctiles el primer toque muestra quién es; el segundo, su página.
    svg.addEventListener("click", (e) => {
      const i = deEvento(e);
      if (!i || !ultimoToque) return;
      if (activo !== i || !i.toque) {
        e.preventDefault();
        i.toque = true;
        mostrar(i);
      }
    });
    document.addEventListener("pointerdown", (e) => {
      if (activo && !svg.contains(e.target)) ocultar();
    });

    // ---------------------------------------------------------------- teclado
    const visibles = () => info.filter((i) => !fig.classList.contains("filtrado") || i.a.classList.contains("sel"));
    function enfocar(i) {
      if (!i) return;
      asientos.forEach((a) => a.setAttribute("tabindex", "-1"));
      i.a.setAttribute("tabindex", "0");
      i.a.focus();
    }
    svg.addEventListener("focusin", (e) => {
      const i = deEvento(e);
      if (i) {
        asientos.forEach((a) => a.setAttribute("tabindex", a === i.a ? "0" : "-1"));
        mostrar(i);
      }
    });
    svg.addEventListener("focusout", (e) => {
      if (!svg.contains(e.relatedTarget)) ocultar();
    });
    svg.addEventListener("keydown", (e) => {
      const i = deEvento(e);
      if (!i) return;
      const vs = visibles();
      const k = vs.indexOf(i);
      let destino = null;
      if (e.key === "ArrowRight") destino = vs[k + 1];
      else if (e.key === "ArrowLeft") destino = vs[k - 1];
      else if (e.key === "Home") destino = vs[0];
      else if (e.key === "End") destino = vs[vs.length - 1];
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const fila = i.fila + (e.key === "ArrowUp" ? 1 : -1);
        let mejor = null;
        for (const o of vs) if (o.fila === fila && (!mejor || Math.abs(o.angulo - i.angulo) < Math.abs(mejor.angulo - i.angulo))) mejor = o;
        destino = mejor;
      } else if (e.key === "Escape") {
        ocultar();
        return;
      } else if (e.key === " " && !i.a.hasAttribute("href")) {
        e.preventDefault();
        return;
      } else return;
      e.preventDefault();
      enfocar(destino);
    });

    // ---------------------------------------------------------------- filtros
    const filtros = { v: new Set(), g: new Set(), d: new Set(), s: new Set() };
    let busqueda = "";
    const items = [...fig.querySelectorAll(".leyenda-h li[data-filtro]")];

    const barra = document.createElement("div");
    barra.className = "h-buscar";
    const etiqueta = document.createElement("label");
    const campo = document.createElement("input");
    campo.type = "search";
    campo.placeholder = "Buscar un nombre";
    campo.autocomplete = "off";
    campo.setAttribute("aria-label", "Buscar un legislador en el hemiciclo");
    etiqueta.style.display = "contents";
    etiqueta.append(campo);
    const salida = document.createElement("output");
    salida.setAttribute("aria-live", "polite");
    const limpiar = document.createElement("button");
    limpiar.type = "button";
    limpiar.textContent = "Mostrar todos";
    limpiar.hidden = true;
    barra.append(etiqueta, salida, limpiar);
    if (info.some((i) => !i.sn)) fig.insertBefore(barra, svg);

    function aplicar() {
      const hay = busqueda || Object.values(filtros).some((s) => s.size);
      fig.classList.toggle("filtrado", Boolean(hay));
      let n = 0;
      for (const i of info) {
        const ds = i.a.dataset;
        const ok =
          (!filtros.v.size || filtros.v.has(i.v)) &&
          (!filtros.g.size || filtros.g.has(ds.g)) &&
          (!filtros.d.size || i.d) &&
          (!filtros.s.size || i.sn) &&
          (!busqueda || (!i.sn && i.nombre.includes(busqueda)));
        i.a.classList.toggle("sel", Boolean(hay && ok));
        if (hay && ok) n++;
      }
      limpiar.hidden = !hay;
      salida.textContent = hay ? (n === 1 ? "1 asiento" : `${n.toLocaleString("es-MX")} asientos`) : "";
      // Con el foco en un asiento que se atenuó, el foco pasa al primero visible.
      const vs = visibles();
      if (vs.length) {
        asientos.forEach((a) => a.setAttribute("tabindex", "-1"));
        vs[0].a.setAttribute("tabindex", "0");
      }
    }

    for (const li of items) {
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.setAttribute("aria-pressed", "false");
      const alternar = () => {
        const [dim, valor] = li.dataset.filtro.split(":");
        const s = filtros[dim];
        if (s.has(valor)) s.delete(valor);
        else s.add(valor);
        li.setAttribute("aria-pressed", String(s.has(valor)));
        aplicar();
      };
      li.addEventListener("click", alternar);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          alternar();
        }
      });
    }
    campo.addEventListener("input", () => {
      busqueda = normal(campo.value);
      aplicar();
    });
    campo.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const primero = visibles().find((i) => !i.sn);
        if (busqueda && primero) enfocar(primero);
      }
    });
    limpiar.addEventListener("click", () => {
      Object.values(filtros).forEach((s) => s.clear());
      items.forEach((li) => li.setAttribute("aria-pressed", "false"));
      campo.value = "";
      busqueda = "";
      aplicar();
      campo.focus();
    });
  }

  document.querySelectorAll("figure.hemiciclo").forEach(iniciar);
})();
