# Sitio de OpenCodice (constitucion.app)

Página estática de presentación del proyecto. No tiene build: lo que hay en
`public/` se sirve tal cual desde Cloudflare Workers.

- `public/index.html` y `public/estilo.css`: el sitio.
- `scripts/paginas.mjs`: genera `public/leyes.html` (`/leyes`, la lista de leyes
  para el público) y `public/estado.html` (`/estado`, el estado técnico) desde
  los repos de datos; corre en cada despliegue, que también ocurre al terminar cada vigilancia (aviso `datos-actualizados`).
- `worker/`: lo que no es un archivo. `/ley/…`, el texto vigente de cada
  documento por artículo (`ley.js`), `/mcp`, un servidor MCP de solo lectura
  (`mcp.js`), y la versión en Markdown del inicio, `/leyes` y la bitácora para
  quien pide `Accept: text/markdown`. Lee solo los archivos del despliegue.
  Las rutas del servicio de búsqueda anterior (`/api/*`, `/pdf/*`) responden `410`.

```bash
npm install
npm run dev      # vista local
npm run deploy   # también se despliega solo con cada push a main
```

Los datos viven en [github.com/OpenCodice](https://github.com/OpenCodice).
