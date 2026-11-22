# constitucion-web — guía para agentes

Landing estático de [constitucion.app](https://constitucion.app). Presenta el proyecto y enlaza a los
repos de datos en [github.com/OpenCodice](https://github.com/OpenCodice).

- `public/` — el sitio: `estilo.css`, `llms.txt` (guía para agentes de IA:
  primero las URL de `/ley` y el MCP, luego los repos), `robots.txt` (con
  `Content-Signal`: los datos son CC0),
  `hemiciclo.js` y `supervisor.js` (lo único de JavaScript; ver «Hemiciclos» y
  `/estado`) y las páginas que genera `scripts/paginas.mjs`. Sin framework.
- `worker/` — lo que no es un archivo de `public/`: lo que sí lo es (incluidos
  los datos: `/ley/{Documento}.md` y `.json`, `/ley/catalogo.json`,
  `/congreso/*.json`, `/bitacora/cambios.json`) se sirve directo, sin
  invocar al Worker. `run_worker_first` solo tiene `/`, `/leyes` y
  `/bitacora/*`, donde se elige HTML o Markdown por el Accept. Lee solo los
  archivos del propio despliegue (`env.ASSETS`, `datos.js`, con una memoria
  pequeña por isolate), nunca otro servicio.
  - `herramientas.js`: las herramientas, definidas una vez, cada una con su
    esquema y un `run` que devuelve `datos` (JSON) y `md`: `buscar`,
    `buscar_documentos`, `indice_documento`, `leer_articulo`,
    `historia_articulo`, `detalle_cambio` (la página en Markdown de un cambio
    de la bitácora, por omisión la última reforma), `cambios_recientes`,
    `votaciones` y `legisladores`. De ahí salen el MCP, la API y el OpenAPI.
  - `mcp.js` → `/mcp`: servidor MCP (Streamable HTTP, sin sesiones ni SSE).
    Sus `instructions` le dicen al modelo cómo responder un tema (varias
    búsquedas literales), una reforma, lo controvertido y las ausencias. Un
    GET del navegador explica cómo conectarse.
  - `api.js` → `/api` (lista), `/api/{herramienta}` (GET con parámetros, las
    listas separadas por coma, o POST con JSON; responde JSON o Markdown por
    Accept) y `/openapi.json`, generado de los esquemas.
  - `ley.js` → `/ley/…` para leer y citar: `/ley` (catálogo), `/ley/{estado}`,
    `/ley/{Documento}` (índice por título y capítulo),
    `/ley/{Documento}/{artículo}` (frontmatter con ubicación, URL canónica,
    versión, enlace permanente y fuente), `…/historia`, `…@{sha}` (302 al
    archivo en ese commit, solo si es del documento) y `.json`. El artículo se
    acepta como se escriba (`claves.js`) y se sirve sin redirigir, con la URL
    canónica en el frontmatter y en `Link`; al navegador le llega como
    `text/plain`. Un artículo se lee de `ley/_/{Documento}/i.json` (claves y
    trozo de cada una) y del trozo: los assets no aceptan `Range` y leer la
    ley entera costaría CPU (hasta 2.7 MB).
  - `busqueda.js`: la búsqueda literal sobre el índice de
    `scripts/lib/busqueda.mjs`: intersección de las listas de cada palabra
    (sin acentos ni mayúsculas, `texto.js`), agrupada por colección; las
    palabras comunes se ignoran y se dice. Fragmentos solo de las primeras
    leyes, para no leer decenas de trozos.
  - `congreso.js`: filtra y ordena `congreso/votaciones.json` (orden por
    fecha, `division`, en contra o ausentes; agrupa por asunto y cámara, sin
    tocar las filas en memoria) y `congreso/legisladores.json` (en funciones
    por omisión; orden por ausencia con un mínimo de votaciones). Los grupos se
    aceptan por sigla.
  - `index.js` enruta y responde la versión en Markdown de `/` (`llms.txt`),
    `/leyes` (el catálogo) y la bitácora a quien la prefiere en `Accept`.
  - Se prueba en `scripts/agentes.test.mjs` con un despliegue sintético
    armado con las mismas funciones que escriben los archivos.
- `scripts/lib/corpus.mjs` — escribe `public/ley/` por documento vigente:
  `{Documento}.md` (el texto completo con su ficha), `{Documento}.json` (el
  índice: cada artículo con etiqueta, ubicación, URL y cambios, sin texto) y,
  para el Worker, `_/{Documento}/i.json` y `_/{Documento}/{n}.json` (los
  artículos en trozos de ~96 KB); más `catalogo.json` y `public/llms-full.txt`.
  No un archivo por artículo: son 67 mil y crecen con cada estado, y un Worker
  admite 20 mil archivos (100 mil en el plan de pago). La misma ley de
  leyes-federales y fiscal-mexicano (mismo texto) se sirve de leyes-federales.
- `scripts/lib/abiertos.mjs` — `congreso/votaciones.json` (una fila por
  votación, sin duplicar la de otra fuente que apunta a la del SIL: cuentas
  totales y por grupo, `division` = la parte de los votos emitidos que tuvo el
  lado perdedor, `en_lo_general`, decreto y leyes) y
  `congreso/legisladores.json` (mandato actual, votos con nombre por
  sentido, ausencias y su tasa, iniciativas presentadas y aprobadas, `foto`), y los
  asuntos como colecciones para la búsqueda.
- `scripts/lib/busqueda.mjs` — el índice de la búsqueda en `public/buscar/`
  (palabra → ids, en 256 archivos; `meta.json` con el rango de ids de cada
  colección y las palabras comunes, las que están en más del 4 % de las
  unidades) y las fichas de los asuntos en `congreso/_/{tipo}/{n}.json`.
- `scripts/paginas.mjs` — genera en cada despliegue (`deploy.yml` despliega
  también al terminar cada vigilancia) las páginas, que dependen de los repos de datos; el
  HTML no se versiona. Lee la API de GitHub (REST y GraphQL),
  `raw.githubusercontent.com` y, para la bitácora, el historial de git de los
  repos de datos, sin dependencias; una fuente caída se anota en la página sin
  detener el despliegue. En local: `npm run paginas` (con
  `GITHUB_TOKEN=$(gh auth token)` para no topar el límite anónimo, y
  `REPOS_DATOS=..` para leer los clones del espacio de trabajo en vez de
  clonar en `.datos/`). Tarda unos 15 s más las tarjetas que no estén en
  `.tarjetas/`.
  - `scripts/inicio.mjs` → `/`: qué es, cifras de cada corpus, últimas
    reformas, cómo leer el historial, status de la vigilancia, cómo citar
    (las URL de `/ley` del artículo 82 de la Constitución y la versión de su
    última reforma, tomada de la bitácora), «Para agentes de IA» (`#agentes`:
    el MCP, la API y las URL de `/ley`, con la cuenta de documentos y
    artículos de `datos.corpus`) y lo que sigue. El portal con el tejido de las
    leyes (`ce5645b`) se dejó de lado por ahora.
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
    una barra por semana de cada vigilancia, los PR abiertos y la sección
    «Supervisor».
    - «Supervisor» sale de `estado/` de `OpenCodice/supervisor` (`latido.json`,
      `huellas.jsonl`, `acciones.jsonl`) y de la última corrida terminada de
      su `supervisor.yml`: última vuelta y modo, cada invariante con lo que
      vigila y su estado (`ok`, `rota:N`, `apagada`, `sin-observar` con su
      motivo), las fallas abiertas con su issue y los arreglos que publicó el
      agente de infraestructura (`arreglo-publicado` de `acciones.jsonl`; su
      resultado, del estado de la huella o de un `revertido` posterior).
      `public/supervisor.js` es un módulo que usan los dos lados:
      `estado.mjs` lo importa para escribir la sección al generar y la página
      lo carga (`type="module"`) para volver a leer las mismas fuentes al
      abrirse, porque el supervisor cambia cada 15 minutos y el sitio solo se
      despliega con los datos. Si alguna de las tres lecturas de `estado/`
      falla, queda lo generado con un aviso; sin la API (límite anónimo), vale
      la corrida que traía la página. Por eso no importa nada de
      `scripts/lib/`.
    - `latido.json` no se reescribe en cada vuelta (solo si cambia, o una vez
      al día): su fecha es «último cambio en su estado», no la última vuelta.
      «Sin vueltas recientes» sale de la última corrida (más de 60 minutos)
      y, solo si no se pudo leer, de un latido de más de 25 horas.
    - Falla abierta es una huella sin resolver con clase, issue, errores,
      intentos del agente o un estado distinto de `abierta`; las demás
      abiertas son lanzamientos que esperan resultado (cada cita por horario
      abre una) y solo se cuentan. Del registro se muestran el paso y la firma
      del error, no el `motivo`, que puede traer texto de un agente; los
      enlaces se arman aquí con piezas validadas. Se prueba en
      `scripts/supervisor.test.mjs`.
  - `scripts/bitacora.mjs` → `/bitacora/` («Bitácora de reformas»): las
    reformas por fecha de publicación; `/bitacora/correcciones`,
    `/bitacora/altas` y `/bitacora/metadatos` (por fecha de registro); `/bitacora/documentos`;
    `/bitacora/decretos/` (ver `decretos.mjs` abajo); la
    historia de cada documento en `/bitacora/{Documento}/` (con sus decretos
    y las fechas de reforma anteriores a su alta, de `reformas.json`) y cada cambio en
    `/bitacora/{Documento}/{sha a 12}`: ficha (tipo, publicación, medio,
    fuente y sha256, extractor, commit), artículos y la diferencia de su texto
    antes/después. También `/bitacora/cambios.json` y el Atom
    `/bitacora/reformas.xml`. Cada página de un documento o de un cambio, y
    el índice, tiene su versión en Markdown (`index.md`, `{sha a 12}.md`:
    ficha en frontmatter y la diferencia de cada artículo como diff de
    párrafos, `diferenciaTexto`), enlazada con `rel="alternate"`; la de un
    documento vigente lleva además JSON-LD `Legislation`. El Markdown de una
    reforma lleva su proceso legislativo (`mdProceso`: decreto, expediente,
    votación principal de cada cámara con sus cuentas, votaciones económicas,
    iniciativas con autor y congresos locales). Todo sale de los **trailers** de cada commit,
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
    - `scripts/lib/cadena.mjs`: en la página de un cambio con decreto, arriba,
      «La cadena de la reforma»: iniciativa (la primera presentada del
      expediente) → comisión (el primer asunto `Dictamen…` del expediente, con
      las comisiones de los turnos «para dictamen» de la cámara de origen) →
      votación de cada cámara, la de origen primero (conteo de la fuente y
      `svgMini` si hay votos con nombre) → congresos locales (solo `cpeum`) →
      DOF → commit (`dia` del cambio), con la fecha y los días desde el paso
      anterior con fecha, y un eje a escala: tramo legislativo hasta el DOF y
      de registro, punteado, del DOF al commit. Un decreto sin commit pasa un
      cambio sin sha: su último paso queda sin fecha, con el texto que le da
      `bitacora.mjs`, y el eje termina en el DOF. En pantallas de menos de 52rem
      va vertical. Un paso sin dato se dibuja vacío con su motivo, nunca se
      rellena: sin votación nominal (dice si hubo económicas), sin
      `legislaturas_estatales`, sin dictamen o iniciativas, y los pasos del
      SIL (iniciativa, comisión, votaciones) cuando el programa no ligó un
      único expediente (`candidatos_expediente`, sin expediente, varios, o
      resuelto por un agente: su evidencia sigue en «Proceso legislativo»).
      Debajo, solo con un expediente que ligó el programa: «Quién la propuso»
      (cada iniciativa con su autor, enlazado si tiene `person_id`, partido,
      fecha y turnos), «Cómo votaron» (el hemiciclo interactivo de la
      votación principal de cada cámara, lado a lado desde 60rem, y
      `listaDisidentes`; carga `hemiciclo.js`) y, en reformas
      constitucionales con datos, «Los congresos locales» (los 32 estados en
      la cuadrícula `MAPA`: aprobó / en contra / sin registro; el SIL lista
      los que aprobaron y solo a veces, en la declaratoria, alguno que votó en
      contra (`no_aprobaron`): «en contra» sale solo de ahí y «sin registro»
      nunca se presenta como «en contra»).
      El detalle de «Proceso legislativo» queda abajo, sin repetir las
      iniciativas ni las miniaturas.
      - **Votación principal** de una cámara (`votacionPrincipal`): entre
        sus votaciones nominales del expediente, la primera (por fecha e id)
        de la última fecha en que votó «en lo general». La última fecha,
        porque si la minuta regresa (la otra cámara la modificó) cuenta la que
        aprobó el texto publicado; la primera del día, porque las siguientes
        son las de los artículos reservados. Sin ninguna «en lo general», la
        misma regla sobre todas.
    - `scripts/lib/vida.mjs`: de `reformas.json` (fecha → claves) y
      `articulos.json` del texto vigente, que `historial.mjs` lee de cada
      documento. En `/bitacora/{Documento}/`, «Sus artículos»: un cuadro por
      artículo del índice, más oscuro según cuántas reformas anota (0, 1–2,
      3–5, 6–10, 11–20, más de 20). En la página de una reforma, «La vida de
      estos artículos»: una fila por artículo que tocó (a lo más
      `FILAS_VIDA`; si sobran hasta 20 se nombran), un punto por fecha de
      reforma y en color las de su Publicacion, arriba una fila con todas las
      reformas del documento (cada punto del tamaño de cuántos artículos
      tocó) y su leyenda. Son dos SVG con los mismos datos, uno ancho y otro
      angosto (menos de 40rem), porque el ancho, reducido, deja el texto
      ilegible; el CSS muestra uno. Debajo, la misma cuadrícula del documento con borde en
      los artículos que tocó. Las fechas anteriores a 1918 son la publicación original
      de la Constitución y no se cuentan. Sin `reformas.json` no hay sección.
    - `scripts/lib/decretos.mjs`: los decretos de congreso-mexicano vistos
      desde el registro. Casi todos son anteriores al alta de su ley, así que
      no tienen commit; cada uno sin commit tiene su página en
      `/bitacora/decretos/{id}` (uno por decreto aunque toque varias leyes;
      el que tiene commit, que liga `vinculosDe`, solo enlaza a su reforma):
      título y enlace al DOF, las leyes que reforma, la cadena (hasta el DOF;
      su último paso dice, por cada ley, si el alta ya es la versión de este
      decreto, si es posterior, o si el alta es anterior y aún no hay
      commit, por `estadoRegistro` contra la Publicacion del alta), quién la
      propuso, cómo votaron, congresos locales, «Artículos que tocó» (de las
      notas de reforma de esa fecha, con aviso si ese día hubo varios decretos
      sobre la ley: las notas los juntan) con su línea de vida, y el detalle
      del proceso. El h1 es su tema (`temaDecreto`: lo que sigue al último
      «en materia de», si no es el nombre de una ley) o, sin él, el título
      si cabe en 120 caracteres o la fecha; no se resume ni se deduce nada.
      `/bitacora/decretos/` los lista por año y la página de cada documento,
      en «Sus decretos», los suyos, con los conteos de la votación principal
      de cada cámara.
    - `scripts/cadena.test.mjs` prueba los tres módulos con un modelo
      sintético: cadena completa, sin votos nominales, sin congresos locales,
      ley federal, decreto sin expediente, con candidatos y resuelto por un
      agente, la votación principal, decretos sin commit (anterior al alta,
      ya incluido en ella, sobre dos leyes y el mismo día que otro) y las
      páginas.
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
    `/congreso/legisladores/{persona}` (su foto oficial, su lugar en el
    hemiciclo de su cámara si está en funciones, mandatos con licencias y
    comisiones, sus votos y lo que presentó, con estatus y desenlace);
    `/congreso/camaras` (la composición de cada cámara, ver «Hemiciclos»); y
    `/congreso/expedientes/` y `/congreso/expedientes/{id}` (cronología,
    votaciones nominales y económicas, asuntos con autor, decreto del DOF y
    su documento en la bitácora). No hay una página por asunto (son decenas
    de miles): se listan en la de su autor y su expediente, con enlace al SIL
    y al JSON. Las rutas salen de `scripts/lib/congreso.mjs`; se prueba en
    `scripts/congreso.test.mjs` con un modelo sintético. Si congreso-mexicano
    no se puede leer, solo sale `/congreso/` con el aviso. Las fotos de los
    legisladores (la `image` de cada persona, que es la copia `.jpg` o `.png`
    en `fuentes/` que cita uno de sus mandatos) son lo único de `fuentes/` que
    se clona; `paginas.mjs` las copia a `/congreso/fotos/{sha256}.{ext}`, y
    una foto que no está en el clon no se enlaza.
  - La situación de cada constitución estatal (vigilada, en preparación o
    fuera, con su motivo) sale de `estados.json` de `constitucion-extractor`:
    `/leyes` muestra el motivo de las que faltan y `/estado`, una tabla de las 32.
  - Las demás leyes de cada estado (`{estado}/{ley}/` en leyes-estatales,
    Documento `<estado>/<ley>`) salen de `fuentes.json` de leyes-estatales:
    `/leyes` las lista por estado (con el motivo de las que quedaron fuera),
    la bitácora las agrupa en «Leyes de los estados» y `/estado` cuenta las
    dos vigilancias de leyes-estatales (`vigilar-estatales.yml` de
    constitucion-extractor y `vigilar-leyes-estatales.yml` de fiscal-extractor).
  - **Buscadores y redes:** cada página lleva su URL canónica, Open Graph y
    tarjeta de Twitter (`metaSocial` de `scripts/lib/comun.mjs`; `documento()`
    la pone sola si recibe `url`) y su imagen de 1200×630 en `/og/{hash}.png`
    (`scripts/lib/tarjeta.mjs`: un SVG que resvg pasa a PNG, con la fuente
    Inter de `@fontsource/inter`; resvg no parte el texto en líneas, así que
    el módulo lo mide con los anchos de la propia fuente, equilibra las líneas
    del título y recorta con «…» lo que no cabe). La tarjeta es la sección, el h1 y la descripción,
    salvo las páginas que pasan su propia `tarjeta` (un cambio de la
    bitácora lleva el nombre del documento). El nombre sale del hash de su
    contenido, así que las tarjetas iguales se comparten y `.tarjetas/` (que
    `deploy.yml` conserva con `actions/cache`) evita volver a dibujarlas:
    dibujarlas todas tarda unos 30 s. Si cambia el diseño, sube `VERSION`
    en `tarjeta.mjs`. `paginas.mjs` escribe además `public/sitemap.xml`;
    `public/robots.txt` es fijo. El inicio lleva JSON-LD (`WebSite` y
    `Organization`) y la bitácora enlaza su Atom con `rel="alternate"`.
  - `scripts/lib/` — lectura de datos y formato compartidos; `resumen.mjs` es
    la salud de las vigilancias y los cambios publicados, que el inicio y
    `/estado` cuentan igual.
- **Hemiciclos** (`scripts/lib/hemiciclo.mjs`, probado en
  `scripts/hemiciclo.test.mjs`): un asiento por legislador en un SVG generado
  aquí. Filas concéntricas en un semicírculo (las mínimas en que caben, los
  asientos de cada fila en proporción a su radio). Cada grupo parlamentario es
  una cuña del centro al borde (`disposicion`): en cada fila toma su
  proporción de la fila, y la suma por grupo es exacta (cada asiento está en la
  fracción (j + ½)/m de su fila; se ordenan por esa fracción y se asignan en
  orden, así que la frontera cae en la misma fracción en todas las filas).
  Siempre en el mismo orden (`PARTIDOS`: PT, Morena, PVEM, PRD, PES, MC, PRI,
  PAN y sin grupo al final), con una banda de su color sobre exactamente el
  rango angular de su cuña, separada de los asientos, y su sigla centrada en la
  cuña. Dentro de cada cuña, cada sentido del voto es una sub-cuña con el mismo
  método (a favor, en contra, abstención, presente sin votar, ausente y los
  votos sin nombre al final). Es esquemático: no son los lugares del salón.
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
    `/congreso/`, el lugar de cada legislador en su página y las votaciones
    de la cadena de una reforma en la bitácora.
  - Colores: una sola tabla en `hemiciclo.mjs` (`PARTIDOS`, `SENTIDOS`), con
    su origen y la versión para modo oscuro; el CSS (`ESTILO_HEMICICLO`) va solo
    en las páginas que tienen un hemiciclo.
  - `public/hemiciclo.js`, cargado con `defer` solo en las páginas con un
    hemiciclo interactivo (votaciones, cámaras y los cambios de la bitácora
    con «Cómo votaron»): tooltip propio, filtro por
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
  genera del historial de git en cada despliegue. `/ley`, la API y el MCP no
  lo contradicen: el Worker solo filtra, corta y formatea los archivos
  generados al desplegar (búsqueda literal, nunca semántica ni texto
  generado), y lo que devuelve es exactamente lo publicado en main.
- **Para agentes:** todo lo nuevo que sirva a una persona debe poder leerlo un
  agente: una URL estable, Markdown o JSON, y enlazado desde `llms.txt`. Una
  consulta nueva va como herramienta en `worker/herramientas.js` (queda en el
  MCP, la API y el OpenAPI a la vez), con su prueba en `agentes.test.mjs`.
- **En local:** `wrangler dev` puede fallar al vigilar los ~10 mil archivos de
  `public/` (`spawn EBADF`); las pruebas no lo necesitan.
