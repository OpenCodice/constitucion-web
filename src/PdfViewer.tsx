import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Este módulo (con pdf.js, ~pesado) se carga BAJO DEMANDA vía import() dinámico
// desde app.tsx, para no inflar el bundle inicial. Renderiza el CUERPO del panel
// lateral (sin backdrop): llena el contenedor que le da el padre.
//
// - Render en alta densidad (devicePixelRatio) → nítido en pantallas retina.
// - Zoom re-rasteriza (no escala la imagen) → nítido a cualquier nivel.
// - Renderiza TODAS las páginas que abarca el pasaje (un pasaje puede cruzar el
//   salto de página), con el resaltado en cada una.
// - Para leer/seleccionar/buscar texto, el botón "Abrir PDF" abre el visor
//   nativo del navegador en la página del pasaje.

export interface Rect {
  page: number;
  x0: number;
  top: number;
  x1: number;
  bottom: number;
}
export interface Coordenadas {
  pagina: number;
  page_w: number;
  page_h: number;
  rects: Rect[];
}

interface Props {
  cita: string;
  coordenadas: Coordenadas;
  pdfUrl: string; // PDF oficial de la jurisdicción (federal o estatal)
  onClose: () => void;
}

interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function PdfViewer({ cita, coordenadas, pdfUrl, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasMap = useRef(new Map<number, HTMLCanvasElement>());
  const textMap = useRef(new Map<number, HTMLDivElement>());
  const docCache = useRef<{ url: string; doc: any } | null>(null);
  const lastKey = useRef<string>("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rectsByPage, setRectsByPage] = useState<Record<number, CssRect[]>>({});

  // Páginas que abarca el pasaje (puede cruzar el salto de página), en orden.
  const pages = useMemo(() => {
    const s = new Set<number>(coordenadas.rects.map((r) => r.page));
    s.add(coordenadas.pagina);
    return [...s].sort((a, b) => a - b);
  }, [coordenadas]);

  // Reiniciar el zoom al cambiar de cita/página.
  useEffect(() => {
    setZoom(1);
  }, [pdfUrl, coordenadas.pagina, cita]);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    const key = `${pdfUrl}#${coordenadas.pagina}`;
    const isNewPage = key !== lastKey.current;
    if (isNewPage) setLoading(true);

    (async () => {
      try {
        let doc = docCache.current?.url === pdfUrl ? docCache.current.doc : null;
        if (!doc) {
          doc = await pdfjsLib.getDocument({ url: pdfUrl }).promise;
          docCache.current = { url: pdfUrl, doc };
        }
        const container = scrollRef.current;
        const fitW = Math.max(280, (container?.clientWidth ?? 820) - 32);
        const dpr = Math.min(window.devicePixelRatio || 1, 3); // tope de memoria

        const rmap: Record<number, CssRect[]> = {};
        for (const n of pages) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const cssScale = (fitW / base.width) * zoom; // puntos PDF → px CSS
          const viewport = page.getViewport({ scale: cssScale });
          const renderViewport = page.getViewport({ scale: cssScale * dpr });

          const canvas = canvasMap.current.get(n);
          if (!canvas) continue;
          const ctx = canvas.getContext("2d")!;
          canvas.width = Math.floor(renderViewport.width);
          canvas.height = Math.floor(renderViewport.height);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          await page.render({ canvas, canvasContext: ctx, viewport: renderViewport }).promise;
          if (cancelled) return;

          // Capa de texto seleccionable sobre el canvas (best-effort: si pdf.js
          // falla, queda el canvas + resaltado, y el botón "Abrir PDF" como opción).
          const textDiv = textMap.current.get(n);
          if (textDiv) {
            textDiv.replaceChildren();
            textDiv.style.width = `${Math.floor(viewport.width)}px`;
            textDiv.style.height = `${Math.floor(viewport.height)}px`;
            // pdf.js v6 escala los spans con --total-scale-factor (no --scale-factor).
            textDiv.style.setProperty("--total-scale-factor", String(cssScale));
            textDiv.style.setProperty("--scale-factor", String(cssScale));
            try {
              const TextLayerCtor = (pdfjsLib as any).TextLayer;
              if (TextLayerCtor) {
                const tc = await page.getTextContent();
                if (cancelled) return;
                await new TextLayerCtor({ textContentSource: tc, container: textDiv, viewport }).render();
              }
            } catch {
              /* sin selección en esta página, pero el PDF sigue visible */
            }
          }

          rmap[n] = coordenadas.rects
            .filter((r) => r.page === n)
            .map((r) => ({
              left: r.x0 * cssScale,
              top: r.top * cssScale,
              width: (r.x1 - r.x0) * cssScale,
              height: (r.bottom - r.top) * cssScale,
            }));
        }
        if (cancelled) return;
        setRectsByPage(rmap);
        setLoading(false);

        // Auto-scroll al primer resaltado solo al abrir (no en cada zoom).
        if (isNewPage && container) {
          const firstPage = pages.find((n) => rmap[n]?.length);
          if (firstPage != null) {
            const block = container.querySelector<HTMLElement>(`[data-page="${firstPage}"]`);
            const r0 = rmap[firstPage][0];
            if (block) {
              const offset =
                block.getBoundingClientRect().top -
                container.getBoundingClientRect().top +
                container.scrollTop;
              container.scrollTop = Math.max(0, offset + r0.top - 120);
            }
          }
        }
        lastKey.current = key;
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, coordenadas.pagina, cita, zoom, pages]);

  const pageLabel =
    pages.length > 1
      ? `páginas ${pages[0]}–${pages[pages.length - 1]}`
      : `página ${coordenadas.pagina}`;

  return (
    <div class="flex h-full flex-col bg-white">
      {/* CSS de la capa de texto de pdf.js v6 (réplica de las reglas oficiales).
          Clave: el tamaño/escala de cada span se calcula con --total-scale-factor
          (lo seteamos por render) y las variables por-span --font-height / --scale-x
          que pone pdf.js. Sin estas reglas los spans quedan a escala incorrecta y
          el texto seleccionable no coincide con el visible. */}
      <style>{`
        .pdf-textLayer { position: absolute; top: 0; left: 0; overflow: clip; opacity: 1;
          line-height: 1; text-align: initial; text-size-adjust: none;
          forced-color-adjust: none; transform-origin: 0 0; z-index: 1;
          --min-font-size: 1;
          --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
          --min-font-size-inv: calc(1 / var(--min-font-size)); }
        .pdf-textLayer :is(span, br) { color: transparent; position: absolute;
          white-space: pre; cursor: text; transform-origin: 0 0;
          -webkit-user-select: text; user-select: text; }
        .pdf-textLayer > :not(.markedContent),
        .pdf-textLayer .markedContent span:not(.markedContent) {
          --font-height: 0; --scale-x: 1; --rotate: 0deg;
          font-size: calc(var(--text-scale-factor) * var(--font-height));
          transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
        .pdf-textLayer .markedContent { display: contents; }
        .pdf-textLayer ::selection { background: rgba(37,99,235,0.35); }
      `}</style>

      <div class="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-stone-800">{cita}</div>
          <div class="text-xs text-stone-400">PDF oficial · {pageLabel}</div>
        </div>
        <div class="flex shrink-0 items-center gap-0.5">
          {/* Zoom: re-rasteriza (nítido), no escala la imagen. */}
          <button
            onClick={() => setZoom((z) => clampZoom(z / ZOOM_STEP))}
            disabled={zoom <= ZOOM_MIN + 1e-6}
            class="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30"
            aria-label="Alejar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14" /></svg>
          </button>
          <button
            onClick={() => setZoom(1)}
            class="min-w-[2.75rem] rounded-lg px-1 py-1 text-center text-xs font-medium tabular-nums text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
            aria-label="Restablecer zoom"
            title="Restablecer zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => setZoom((z) => clampZoom(z * ZOOM_STEP))}
            disabled={zoom >= ZOOM_MAX - 1e-6}
            class="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30"
            aria-label="Acercar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          {/* Abrir en el visor nativo del navegador (selección, copiar, buscar). */}
          <a
            href={`${pdfUrl}#page=${coordenadas.pagina}`}
            target="_blank"
            rel="noreferrer"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
            aria-label="Abrir PDF en pestaña nueva"
            title="Abrir PDF (seleccionar y buscar texto)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
          </a>
          <button
            onClick={onClose}
            class="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
            aria-label="Cerrar visor de PDF"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>

      <div ref={scrollRef} class="scroll-thin grow overflow-auto bg-stone-100 p-4">
        {loading && <div class="py-24 text-center text-sm text-stone-400">Cargando PDF…</div>}
        {error && (
          <div class="py-24 text-center text-sm text-red-600">No se pudo cargar el PDF.</div>
        )}
        <div class="mx-auto w-max space-y-3" style={{ display: error ? "none" : "block" }}>
          {pages.map((n) => (
            <div key={n} data-page={n} class="relative mx-auto w-max">
              <canvas
                ref={(el) => {
                  if (el) canvasMap.current.set(n, el as HTMLCanvasElement);
                }}
                class="block rounded-sm bg-white shadow-md"
              />
              <div
                class="pdf-textLayer"
                ref={(el) => {
                  if (el) textMap.current.set(n, el as HTMLDivElement);
                }}
              />
              {(rectsByPage[n] ?? []).map((r, i) => (
                <div
                  key={i}
                  class="pointer-events-none absolute rounded-[2px]"
                  style={{
                    left: `${r.left}px`,
                    top: `${r.top}px`,
                    width: `${r.width}px`,
                    height: `${r.height}px`,
                    background: "rgba(250, 204, 21, 0.4)",
                    mixBlendMode: "multiply",
                    zIndex: 2,
                  }}
                />
              ))}
              {pages.length > 1 && (
                <div class="pt-1 text-center text-[11px] text-stone-400">página {n}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
