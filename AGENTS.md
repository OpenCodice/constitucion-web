# constitucion-web — guía para agentes

Landing estático de [constitucion.app](https://constitucion.app). Presenta el proyecto y enlaza a los
repos de datos en [github.com/OpenCodice](https://github.com/OpenCodice).

- `public/` — el sitio: `estilo.css`, `llms.txt` (guía para agentes de IA) y
  las páginas que genera `scripts/paginas.mjs`. Sin framework ni JavaScript en
  la página.
- `worker/index.js` — responde `410` en las rutas del servicio de búsqueda que
  se retiró (`/api/*`, `/mcp`, `/openapi.json`, `/pdf/*`) y redirige al inicio
  cualquier otra ruta que no sea un archivo de `public/` (los assets, como
  `/leyes`, `/estado` y `/bitacora/…`, se sirven antes de llegar al Worker).
- `scripts/paginas.mjs` — genera en cada despliegue (`deploy.yml` despliega
  también cada tres horas) las páginas, que dependen de los repos de datos; el
  HTML no se versiona. Lee la API de GitHub (REST y GraphQL),
  `raw.githubusercontent.com` y, para la bitácora, el historial de git de los
  repos de datos, sin dependencias; una fuente caída se anota en la página sin
  detener el despliegue. En local: `npm run paginas` (con
  `GITHUB_TOKEN=$(gh auth token)` para no topar el límite anónimo, y
  `REPOS_DATOS=..` para leer los clones del espacio de trabajo en vez de
  clonar en `.datos/`). Tarda unos 15 s.
  - `scripts/inicio.mjs` → `/`: qué es, cifras de cada corpus, últimas
    reformas, cómo leer el historial, status de la vigilancia, cómo citar,
    cómo lo usa un agente y lo que sigue.
  - `scripts/leyes.mjs` → `/leyes` («Qué leyes hay»), para el público y sin
    detalles técnicos: por documento, su última reforma, cuántas reformas anota,
    una fila de cuadros por año y si tiene una actualización en revisión (un PR
    abierto que lo toca o `revision_pendiente`). Su color es verde y ámbar; en
    `/estado`, verde para las corridas correctas y rojo para las fallas.
  - `scripts/estado.mjs` → `/estado` («Status del sistema»), técnica: arriba
    el veredicto de salud (según la última corrida de cada `vigilar-*.yml`, que
    viven en los extractores: `VIGILANCIAS` en `scripts/lib/datos.mjs`) con
    la última y la próxima revisión; luego las reformas y correcciones
    publicadas (por el título del commit), el resumen por repo y, al final,
    una barra por semana de cada vigilancia y los PR abiertos.
  - `scripts/bitacora.mjs` → `/bitacora/` («Bitácora de reformas»): las
    reformas por fecha de publicación; `/bitacora/correcciones` y
    `/bitacora/altas` (por fecha de registro); `/bitacora/documentos`; la
    historia de cada documento en `/bitacora/{Documento}/` (con las fechas de
    reforma anteriores a su alta, de `reformas.json`) y cada cambio en
    `/bitacora/{Documento}/{sha a 12}`: ficha (tipo, publicación, medio,
    fuente y sha256, extractor, commit), artículos y la diferencia de su texto
    antes/después. También `/bitacora/cambios.json` y el Atom
    `/bitacora/reformas.xml`. Todo sale de los **trailers** de cada commit,
    nunca del título; los commits `Tipo: indice` no aparecen. Una reforma o
    alta de la misma ley en fiscal-mexicano y leyes-federales (misma clave) se
    agrupa por (Documento, Tipo, Publicacion): el índice muestra la primera
    registrada y cada página enlaza a la otra. Las altas y retiros no tienen
    diff (serían la ley entera); cada página muestra a lo más 150 artículos y
    unos 120 KB de diff por artículo, y el resto se enlaza al commit.
    - `scripts/lib/historial.mjs` clona cada repo de datos `--bare` en
      `.datos/` (o usa `REPOS_DATOS`), lee `git log` con
      `%(trailers:only,unfold)` y `--name-status`, y el texto de los artículos
      con un solo `git cat-file --batch` por repo.
    - `scripts/lib/diferencias.mjs` hace el diff por párrafos y, dentro de los
      párrafos parecidos, por palabras (`<del>`/`<ins>`), sin dependencias.
    - `scripts/lib/vinculos.mjs` es el punto de extensión para enlazar cada
      cambio con su proceso legislativo (decreto, iniciativa, votaciones) por
      (Documento, Publicacion) o por sha. Hoy no lee nada y la sección se
      omite; cuando esos datos se publiquen, `leerVinculos` los carga.
    - `/leyes` enlaza «Sus cambios» de cada documento y el inicio toma de aquí
      sus últimas reformas (por fecha de publicación).
  - La situación de cada constitución estatal (vigilada, en preparación o
    fuera, con su motivo) sale de `estados.json` de `constitucion-extractor`:
    `/leyes` muestra el motivo de las que faltan y `/estado`, una tabla de las 32.
  - `scripts/lib/` — lectura de datos y formato compartidos; `resumen.mjs` es
    la salud de las vigilancias y los cambios publicados, que el inicio y
    `/estado` cuentan igual.
- `wrangler.jsonc` — Worker con assets. Las migraciones `v1` y `v2` son el alta
  y la baja de un Durable Object anterior; no se pueden quitar de la lista.

Cada push a `main` despliega a producción (`.github/workflows/deploy.yml`).
Para verlo en local: `npm install && npm run paginas && npm run dev`.

## Criterios

- **Estilo:** texto plano sobre la página, sobrio y legible, sin animaciones.
  Tipografía del sistema, blanco y negro, modo oscuro por `prefers-color-scheme`.
  `estilo.css` es el mismo archivo en `constitucion-web` y `fiscal-web`: un
  cambio de estilo va en los dos.
- **Contenido:** las cifras (artículos, documentos, unidades) salen de los repos
  de datos; actualízalas cuando cambie el corpus y no prometas lo que aún no
  existe.
- **Sin LLM ni servicios en tiempo de lectura.** Aquí hubo un chat con búsqueda
  semántica y se retiró a propósito. La bitácora también es estática: se
  genera del historial de git en cada despliegue.
