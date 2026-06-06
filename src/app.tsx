import { useState } from "preact/hooks";
import type { Coordenadas, PdfViewer as PdfViewerType } from "./PdfViewer";

// Repo de datos en GitHub: cada cita enlaza a su artículo (texto oficial).
const DATA_REPO = "https://github.com/danielcardeenas/constitucion-mexicana/blob/main";

interface Cita {
  id: string;
  cita: string;
  ruta: string;
  texto: string;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  archivo: string;
  pdf: string;
  coordenadas: Coordenadas | null;
}

const EJEMPLOS = [
  "¿Necesito título para ejercer mi profesión?",
  "¿Está permitido el matrimonio igualitario?",
  "¿Qué derechos tengo si me detienen?",
  "¿Puedo tener doble nacionalidad?",
];

function vigenciaLabel(c: Cita): string {
  const desde = c.vigente_desde ?? "?";
  return c.vigente_hasta == null ? `vigente desde ${desde}` : `vigente ${desde}–${c.vigente_hasta}`;
}

export function App() {
  const [pregunta, setPregunta] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [citas, setCitas] = useState<Cita[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  // Visor PDF: se carga bajo demanda (pdf.js es pesado).
  const [PdfViewer, setPdfViewer] = useState<typeof PdfViewerType | null>(null);
  const [pdfProps, setPdfProps] = useState<{ cita: string; coordenadas: Coordenadas } | null>(null);

  async function abrirPdf(c: Cita) {
    if (!c.coordenadas) return;
    if (!PdfViewer) {
      const mod = await import("./PdfViewer");
      setPdfViewer(() => mod.PdfViewer);
    }
    setPdfProps({ cita: c.cita, coordenadas: c.coordenadas });
  }

  async function preguntar(q: string) {
    const texto = q.trim();
    if (!texto || loading) return;
    setPregunta(texto);
    setLoading(true);
    setStreaming(false);
    setRespuesta("");
    setCitas([]);
    setError("");

    try {
      const res = await fetch("/api/preguntar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pregunta: texto }),
      });
      if (!res.body) throw new Error("El servidor no devolvió respuesta.");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      setStreaming(true);

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.t === "token") setRespuesta((r) => r + msg.v);
          else if (msg.t === "citas") setCitas(msg.v);
          else if (msg.t === "error") setError(msg.v);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setStreaming(false);
    }
  }

  return (
    <div class="min-h-screen bg-stone-50 text-stone-800">
      {/* Encabezado */}
      <header class="border-b border-stone-200 bg-white">
        <div class="mx-auto max-w-3xl px-4 py-6">
          <h1 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span class="inline-block h-5 w-5 rounded-sm bg-gradient-to-b from-emerald-600 via-white to-red-600 ring-1 ring-stone-300" />
            Constitución mexicana
          </h1>
          <p class="mt-1 text-sm text-stone-500">
            Preguntas y respuestas con <strong>citas verificables</strong> al texto vigente.
          </p>
        </div>
      </header>

      <main class="mx-auto max-w-3xl px-4 py-8">
        {/* Buscador */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            preguntar(pregunta);
          }}
        >
          <div class="flex gap-2">
            <input
              type="text"
              value={pregunta}
              onInput={(e) => setPregunta((e.target as HTMLInputElement).value)}
              placeholder="Escribe tu pregunta…"
              class="flex-1 rounded-lg border border-stone-300 bg-white px-4 py-3 text-base shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            />
            <button
              type="submit"
              disabled={loading || !pregunta.trim()}
              class="rounded-lg bg-emerald-700 px-5 py-3 font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "…" : "Preguntar"}
            </button>
          </div>
        </form>

        {/* Ejemplos */}
        {!respuesta && !loading && (
          <div class="mt-4 flex flex-wrap gap-2">
            {EJEMPLOS.map((ej) => (
              <button
                key={ej}
                onClick={() => preguntar(ej)}
                class="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-600 transition hover:border-emerald-400 hover:text-emerald-700"
              >
                {ej}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div class="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Respuesta */}
        {(respuesta || (loading && streaming)) && (
          <section class="mt-8">
            <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              Respuesta
            </h2>
            <div
              class={
                "whitespace-pre-wrap rounded-xl border border-stone-200 bg-white p-5 text-[15px] leading-relaxed shadow-sm" +
                (streaming ? " streaming" : "")
              }
            >
              {respuesta}
            </div>
          </section>
        )}

        {/* Citas */}
        {citas.length > 0 && (
          <section class="mt-6">
            <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              Fuentes ({citas.length})
            </h2>
            <ul class="space-y-3">
              {citas.map((c) => (
                <li
                  key={c.id}
                  class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
                >
                  <div class="flex items-baseline justify-between gap-3">
                    <span class="font-semibold text-emerald-800">{c.cita}</span>
                    <span class="shrink-0 text-xs text-stone-400">{vigenciaLabel(c)}</span>
                  </div>
                  <p class="mt-2 text-sm leading-relaxed text-stone-600">{c.texto}</p>
                  <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400">
                    <a
                      href={`${DATA_REPO}/${c.archivo}`}
                      target="_blank"
                      rel="noreferrer"
                      class="underline-offset-2 hover:text-emerald-700 hover:underline"
                    >
                      {c.archivo} ↗
                    </a>
                    {c.coordenadas && (
                      <button
                        onClick={() => abrirPdf(c)}
                        class="font-medium text-emerald-700 underline-offset-2 hover:underline"
                      >
                        Ver en el PDF (subrayado)
                      </button>
                    )}
                    {c.pdf && (
                      <a
                        href={c.pdf}
                        target="_blank"
                        rel="noreferrer"
                        class="underline-offset-2 hover:text-emerald-700 hover:underline"
                      >
                        PDF oficial (DOF) ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer class="mt-12 border-t border-stone-200 pt-6 text-xs text-stone-400">
          Reproducción para consulta. El texto oficial es el publicado en el Diario Oficial de
          la Federación. Las respuestas se generan por IA a partir de los pasajes citados.
        </footer>
      </main>

      {PdfViewer && pdfProps && (
        <PdfViewer
          cita={pdfProps.cita}
          coordenadas={pdfProps.coordenadas}
          onClose={() => setPdfProps(null)}
        />
      )}
    </div>
  );
}
