# constitucion-web — guía para agentes

Landing estático de [constitucion.app](https://constitucion.app). Presenta el proyecto y enlaza a los
repos de datos en [github.com/OpenCodice](https://github.com/OpenCodice).

- `public/index.html` y `public/estilo.css` — todo el sitio. Sin build, sin
  framework, sin JavaScript en la página.
- `worker/index.js` — responde `410` en las rutas del servicio de búsqueda que
  se retiró (`/api/*`, `/mcp`, `/openapi.json`, `/pdf/*`) y redirige al inicio
  cualquier otra ruta que no sea un archivo de `public/` (los assets, como
  `/leyes` y `/estado`, se sirven antes de llegar al Worker).
- `scripts/paginas.mjs` — genera en cada despliegue (`deploy.yml` despliega
  también cada tres horas) las dos páginas que dependen de los repos de datos;
  el HTML no se versiona. Lee la API de GitHub (REST y GraphQL) y
  `raw.githubusercontent.com`, sin dependencias; una fuente caída se anota en
  la página sin detener el despliegue. En local: `npm run paginas` (con
  `GITHUB_TOKEN=$(gh auth token)` para no topar el límite anónimo).
  - `scripts/leyes.mjs` → `/leyes` («Qué leyes hay»), para el público y sin
    detalles técnicos: por documento, su última reforma, cuántas reformas anota,
    una fila de cuadros por año y si tiene una actualización en revisión (un PR
    abierto que lo toca o `revision_pendiente`). Su color es verde y ámbar; en
    `/estado` el único color es el rojo de las fallas.
  - `scripts/estado.mjs` → `/estado` («Estado del sistema»), técnica: resumen
    por repo, barras de las últimas corridas de cada `vigilar*.yml`, cuadrícula
    de cambios por día y PR abiertos.
  - `scripts/lib/` — lectura de datos y formato compartidos.
- `wrangler.jsonc` — Worker con assets. Las migraciones `v1` y `v2` son el alta
  y la baja de un Durable Object anterior; no se pueden quitar de la lista.

Cada push a `main` despliega a producción (`.github/workflows/deploy.yml`).
Para verlo en local: `npm install && npm run dev`.

## Criterios

- **Estilo:** texto plano sobre la página, sobrio y legible, sin animaciones.
  Tipografía del sistema, blanco y negro, modo oscuro por `prefers-color-scheme`.
  `estilo.css` es el mismo archivo en `constitucion-web` y `fiscal-web`: un
  cambio de estilo va en los dos.
- **Contenido:** las cifras (artículos, documentos, unidades) salen de los repos
  de datos; actualízalas cuando cambie el corpus y no prometas lo que aún no
  existe.
- **Sin LLM ni servicios en tiempo de lectura.** Aquí hubo un chat con búsqueda
  semántica y se retiró a propósito. La siguiente pieza es una bitácora de
  cambios generada del historial de git, también estática.
