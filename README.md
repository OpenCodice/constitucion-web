# Sitio de OpenCodice (constitucion.app)

Página estática de presentación del proyecto. No tiene build: lo que hay en
`public/` se sirve tal cual desde Cloudflare Workers.

- `public/index.html` y `public/estilo.css`: el sitio.
- `scripts/paginas.mjs`: genera `public/leyes.html` (`/leyes`, la lista de leyes
  para el público) y `public/estado.html` (`/estado`, el estado técnico) desde
  los repos de datos; corre en cada despliegue, que también ocurre al terminar cada vigilancia (aviso `datos-actualizados`).
- `worker/`: lo que no es un archivo. Las herramientas de consulta (buscar en
  las leyes y el Congreso, leer artículos, qué cambió en una reforma,
  votaciones, legisladores) como servidor MCP en `/mcp` y API REST en `/api`
  (`/openapi.json`); `/ley/{documento}/{artículo}` para leer y citar; y la
  versión en Markdown del inicio, `/leyes` y la bitácora. Lee solo los
  archivos del despliegue.

```bash
npm install
npm run dev      # vista local
npm run deploy   # también se despliega solo con cada push a main
```

Los datos viven en [github.com/OpenCodice](https://github.com/OpenCodice).
