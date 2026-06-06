// Spec OpenAPI 3.1 de la API de búsqueda, para ChatGPT Actions / function-calling.
// `origin` se inyecta en runtime para que `servers.url` siempre sea correcto.
export function openapiSpec(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Constitución Mexicana — búsqueda de pasajes",
      version: "1.0.0",
      description:
        "Busca pasajes citables de la Constitución Política de los Estados Unidos " +
        "Mexicanos (texto vigente). Devuelve pasajes con su cita legal y vigencia; " +
        "no genera respuestas. Úsalos para responder y citar con precisión.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/buscar": {
        post: {
          operationId: "buscarPasajes",
          summary: "Busca pasajes relevantes de la Constitución mexicana",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BuscarRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Pasajes relevantes, ordenados por relevancia.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BuscarResponse" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        BuscarRequest: {
          type: "object",
          required: ["pregunta"],
          properties: {
            pregunta: {
              type: "string",
              description: "Pregunta o tema en lenguaje natural, en español.",
            },
            k: {
              type: "integer",
              minimum: 1,
              maximum: 12,
              default: 6,
              description: "Número de pasajes a devolver.",
            },
            as_of: {
              type: "string",
              format: "date",
              description:
                "Fecha ISO (YYYY-MM-DD) para consulta histórica. Omitir = texto vigente hoy.",
            },
          },
        },
        BuscarResponse: {
          type: "object",
          properties: {
            pregunta: { type: "string" },
            pasajes: {
              type: "array",
              items: { $ref: "#/components/schemas/Pasaje" },
            },
          },
        },
        Pasaje: {
          type: "object",
          properties: {
            id: { type: "string", description: "Identificador del pasaje (p. ej. 005.p1)." },
            cita: { type: "string", description: "Cita legal formal. Úsala textual." },
            ruta: { type: "string", description: "Ubicación legible del pasaje." },
            texto: { type: "string", description: "Texto del pasaje (fuente de la cita)." },
            vigente_desde: { type: ["string", "null"], format: "date" },
            vigente_hasta: { type: ["string", "null"], format: "date" },
            archivo: { type: "string", description: "Ruta del artículo en el repo de datos." },
            score: { type: "number", description: "Relevancia (mayor = más relevante)." },
          },
        },
      },
    },
  };
}
