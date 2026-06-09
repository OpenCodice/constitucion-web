// Spec OpenAPI 3.1 de la API de búsqueda, para ChatGPT Actions / function-calling.
// `origin` se inyecta en runtime para que `servers.url` siempre sea correcto.
export function openapiSpec(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Constitución Mexicana — búsqueda de pasajes",
      version: "1.0.0",
      description:
        "Busca pasajes citables de la Constitución mexicana: la federal (CPEUM) y " +
        "las constituciones de los estados (texto vigente). Por defecto usa la " +
        "federal y suma el estado que mencione la pregunta. Devuelve pasajes con su " +
        "jurisdicción, cita legal y vigencia; no genera respuestas. Úsalos para " +
        "responder y citar con precisión.",
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
            ambito: {
              type: "array",
              items: { type: "string" },
              description:
                "Jurisdicciones a consultar (p. ej. [\"jalisco\"]). Omitir = se infiere " +
                "de la pregunta; la federal siempre se incluye.",
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
            id: { type: "string", description: "Identificador del pasaje (p. ej. 005.p1, jal:042.p3)." },
            ambito: { type: "string", description: "Jurisdicción: federal, jalisco, cdmx, …" },
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
