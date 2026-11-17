# constitucion-web — guía para agentes

Landing estático de [constitucion.app](https://constitucion.app). Presenta el proyecto y enlaza a los
repos de datos en [github.com/OpenCodice](https://github.com/OpenCodice).

- `public/` — el sitio: `estilo.css`, `llms.txt` (guía para agentes de IA),
  `hemiciclo.js` (lo único de JavaScript; ver «Hemiciclos») y las páginas que
  genera `scripts/paginas.mjs`. Sin framework.
- `worker/index.js` — responde `410` en las rutas del servicio de búsqueda que
  se retiró (`/api/*`, `/mcp`, `/openapi.json`, `/pdf/*`) y redirige al inicio
  cualquier otra ruta que no sea un archivo de `public/` (los assets, como
  `/leyes`, `/estado` y `/bitacora/…`, se sirven antes de llegar al Worker).
- `scripts/paginas.mjs` — genera en cada despliegue (`deploy.yml` despliega
  también al terminar cada vigilancia) las páginas, que dependen de los repos de datos; el
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
    publicadas (por la clase de la bitácora o el título del commit; los
    ajustes iniciales y metadatos aparte), el resumen por repo y, al final,
    una barra por semana de cada vigilancia y los PR abiertos.
  - `scripts/bitacora.mjs` → `/bitacora/` («Bitácora de reformas»): las
    reformas por fecha de publicación; `/bitacora/correcciones`,
    `/bitacora/altas` y `/bitacora/metadatos` (por fecha de registro); `/bitacora/documentos`; la
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
    - Cambios menores: `Tipo: metadatos` (solo cambió la metadata del
      documento) y las `correccion` antiguas sin `Articulos-Corregidos` («…:
      solo metadata») se listan aparte en `/bitacora/metadatos` (fuera de las
      pestañas), con su ficha y los archivos de metadata que tocó, sin diff.
    - Ajustes iniciales: una `correccion` o `metadatos` es ajuste inicial de un
      alta si es del mismo repo, posterior al alta (la más reciente antes de
      él) a lo más 7 días por fecha de commit (`DIAS_AJUSTE`) y anterior a
      cualquier reforma del documento después de esa alta; el orden es el del
      log, no la fecha. Sin commit de alta no hay plegado. Se muestran bajo su
      alta (en `/bitacora/altas`, la página del alta y la historia del
      documento), no en `/bitacora/correcciones` ni en las cuentas de
      correcciones. En el historial del 2026-11-17: de 200 correcciones, 149
      son ajustes, 19 metadatos y 32 correcciones reales.
    - Cada cambio tiene una `clase` (`reforma`, `correccion`, `alta`,
      `retiro`, `metadatos`, `ajuste`) que decide dónde se lista y cómo se
      cuenta; `cambios.json` la publica junto con `menor`, `ajuste_inicial`,
      `alta` (sha del alta) y `archivos_metadata`. `/estado` cuenta por la
      clase de la bitácora (por sha) y, para lo que no esté en ella, por el
      título (`Metadatos de …`, `…: solo metadata`).
    - `npm test` prueba las clases y páginas con un historial sintético
      (`scripts/bitacora.test.mjs`).
    - `scripts/lib/historial.mjs` clona cada repo de datos `--bare` en
      `.datos/` (o usa `REPOS_DATOS`), lee `git log` con
      `%(trailers:only,unfold)` y `--name-status`, y el texto de los artículos
      con un solo `git cat-file --batch` por repo.
    - `scripts/lib/diferencias.mjs` hace el diff por párrafos y, dentro de los
      párrafos parecidos, por palabras (`<del>`/`<ins>`), sin dependencias.
    - `scripts/lib/vinculos.mjs` enlaza cada cambio con su proceso
      legislativo, de congreso-mexicano (`leerCongreso` de
      `scripts/lib/congreso.mjs`, que `paginas.mjs` lee después del
      historial): los decretos del DOF que le tocan por (Documento,
      Publicacion), solo en reformas, o por el sha que registra el decreto, y
      de cada uno su expediente del SIL (o sus candidatos sin elegir, o el
      aviso de que lo resolvió un agente, con su evidencia), las iniciativas
      con su autor, las votaciones nominales por cámara (con la de otra fuente
      que apunte a ella, sus discrepancias e inconsistencias), cuántas
      votaciones económicas hubo y los congresos locales que aprobaron una
      reforma constitucional. `seccionVinculos` de `bitacora.mjs` lo pinta
      como «Proceso legislativo», enlazando a /congreso; si congreso-mexicano
      no se puede leer, la sección se omite. Se prueba en
      `scripts/vinculos.test.mjs` con un modelo sintético.
    - `/leyes` enlaza «Sus cambios» de cada documento y el inicio toma de aquí
      sus últimas reformas (por fecha de publicación).
  - `scripts/congreso.mjs` → `/congreso/` («Congreso: quién vota qué»), del
    mismo modelo de congreso-mexicano que usa la bitácora (`leerVinculos`
    devuelve el de `leerCongreso`, sin leerlo dos veces): qué es y de dónde
    salen los datos, cifras (legisladores, votaciones, iniciativas y
    proposiciones por desenlace) y cuántas votaciones no cuadran;
    `/congreso/votaciones/` (todas, por mes) y `/congreso/votaciones/{id}`
    (ficha, conteos de la fuente frente a los votos con nombre y los no
    atribuidos, resumen por grupo, el voto de cada legislador por sentido y
    grupo, y a la vista `votos_faltantes` con `nombres_fuente`,
    `inconsistencias`, `diferencia_conteos`/`_grupos`, `discrepancias` y la
    misma votación en otra fuente, y `retirada_de_la_fuente`);
    `/congreso/legisladores/` (por cámara y grupo),
    `/congreso/legisladores/{persona}` (su lugar en el hemiciclo de su cámara
    si está en funciones, mandatos con licencias y comisiones, sus votos y lo
    que presentó, con estatus y desenlace);
    `/congreso/camaras` (la composición de cada cámara, ver «Hemiciclos»); y
    `/congreso/expedientes/` y `/congreso/expedientes/{id}` (cronología,
    votaciones nominales y económicas, asuntos con autor, decreto del DOF y
    su documento en la bitácora). No hay una página por asunto (son decenas
    de miles): se listan en la de su autor y su expediente, con enlace al SIL
    y al JSON. Las rutas salen de `scripts/lib/congreso.mjs`; se prueba en
    `scripts/congreso.test.mjs` con un modelo sintético. Si congreso-mexicano
    no se puede leer, solo sale `/congreso/` con el aviso.
  - La situación de cada constitución estatal (vigilada, en preparación o
    fuera, con su motivo) sale de `estados.json` de `constitucion-extractor`:
    `/leyes` muestra el motivo de las que faltan y `/estado`, una tabla de las 32.
  - Las demás leyes de cada estado (`{estado}/{ley}/` en leyes-estatales,
    Documento `<estado>/<ley>`) salen de `fuentes.json` de leyes-estatales:
    `/leyes` las lista por estado (con el motivo de las que quedaron fuera),
    la bitácora las agrupa en «Leyes de los estados» y `/estado` cuenta las
    dos vigilancias de leyes-estatales (`vigilar-estatales.yml` de
    constitucion-extractor y `vigilar-leyes-estatales.yml` de fiscal-extractor).
  - `scripts/lib/` — lectura de datos y formato compartidos; `resumen.mjs` es
    la salud de las vigilancias y los cambios publicados, que el inicio y
    `/estado` cuentan igual.
- **Hemiciclos** (`scripts/lib/hemiciclo.mjs`, probado en
  `scripts/hemiciclo.test.mjs`): un asiento por legislador en un SVG generado
  aquí. Filas concéntricas en un semicírculo (las mínimas en que caben, los
  asientos de cada fila en proporción a su radio), ordenados por ángulo de
  izquierda a derecha y asignados en orden, así que cada grupo parlamentario
  ocupa un sector contiguo, siempre en el mismo orden (`PARTIDOS`: PT, Morena,
  PVEM, PRD, PES, MC, PRI, PAN y sin grupo al final), con una banda de su color
  y su sigla. Es esquemático: no son los lugares del salón.
  - En `/congreso/votaciones/{id}` (si hay votos con nombre), cada asiento con
    el color de su sentido; los `votos_faltantes` son asientos sin nombre en su
    grupo y sentido (nunca se atribuyen). Con borde, quien votó distinto a la
    mayoría de su grupo: el sentido más votado entre a favor, en contra y
    abstención (con los no atribuidos); sin mayoría única o sin grupo, no se
    marca a nadie. Debajo, la lista de quienes votaron distinto.
  - En `/congreso/camaras`, la composición por grupo (`composicion`): cada
    mandato de la legislatura más reciente cuyo estatus en el SIL es «Activo»
    (el propietario o el suplente que entró en su lugar). El total se compara
    con 500 y 128 y, si no cuadra, la página lo dice. El 2026-11-17 dio
    500 (44 suplentes) y 128 (27 suplentes), sin fórmulas contadas dos veces.
  - Miniaturas sin enlaces por asiento (`svgMini`: un trazo por color, cada
    asiento un punto de trazo redondo, unos 6 KB): las dos cámaras en
    `/congreso/`, el lugar de cada legislador en su página y cada votación con
    votos en «Proceso legislativo» de la bitácora, enlazada a su página.
  - Colores: una sola tabla en `hemiciclo.mjs` (`PARTIDOS`, `SENTIDOS`), con
    su origen y la versión para modo oscuro; el CSS (`ESTILO_HEMICICLO`) va solo
    en las páginas que tienen un hemiciclo.
  - `public/hemiciclo.js`, cargado con `defer` solo en las páginas con un
    hemiciclo interactivo (votaciones y cámaras): tooltip propio, filtro por
    sentido, grupo y marca al tocar la leyenda, búsqueda por nombre, flechas
    para moverse entre asientos (un solo tab), y en pantallas táctiles el
    primer toque muestra quién es y el segundo abre su página. Sin él, cada
    asiento es un enlace con su `<title>` y la lista de nombres sigue abajo.
    Vive en la raíz de `public/` porque `public/congreso/` se borra en cada
    generación.
- `wrangler.jsonc` — Worker con assets. Las migraciones `v1` y `v2` son el alta
  y la baja de un Durable Object anterior; no se pueden quitar de la lista.

Cada push a `main` despliega a producción (`.github/workflows/deploy.yml`).
Para verlo en local: `npm install && npm run paginas && npm run dev`.

## Criterios

- **Estilo:** texto plano sobre la página, sobrio y legible, sin animaciones.
  Tipografía del sistema, blanco y negro (el color, solo en los datos: los
  hemiciclos y las gráficas), modo oscuro por `prefers-color-scheme`.
  `estilo.css` es el mismo archivo en `constitucion-web` y `fiscal-web`: un
  cambio de estilo va en los dos.
- **Contenido:** las cifras (artículos, documentos, unidades) salen de los repos
  de datos; actualízalas cuando cambie el corpus y no prometas lo que aún no
  existe.
- **JavaScript:** se permite con mejora progresiva (la página funciona sin
  él), sin dependencias ni compilación, sin servicios en tiempo de lectura.
- **Sin LLM ni servicios en tiempo de lectura.** Aquí hubo un chat con búsqueda
  semántica y se retiró a propósito. La bitácora también es estática: se
  genera del historial de git en cada despliegue.
