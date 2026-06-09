// Detección de jurisdicción (ámbito) para la auto-fusión natural.
//
// El usuario pregunta en lenguaje natural; no hay selector obligatorio. Si
// menciona un estado (por nombre o gentilicio), acotamos la búsqueda a
// `federal + ese estado`; si no menciona ninguno, respondemos con la federal
// (la base que todos comparten). El filtro evita la contaminación cruzada
// (que una pregunta de Jalisco traiga artículos de otro estado).
//
// `ambito` es el slug que vive en la metadata del pasaje y en el índice de
// Vectorize: "federal", "jalisco", "cdmx", …

export const FEDERAL = "federal";

interface Entidad {
  ambito: string;
  nombre: string;
  alias: string[]; // nombre, variantes y gentilicios (sin acentos, en minúscula)
}

// Las 32 entidades. `alias` incluye gentilicios y apodos comunes para que la
// conversación natural funcione ("¿y en Jalisco?", "la regla regiomontana").
const ENTIDADES: Entidad[] = [
  { ambito: "aguascalientes", nombre: "Aguascalientes", alias: ["aguascalientes", "hidrocalido"] },
  { ambito: "baja-california", nombre: "Baja California", alias: ["baja california", "bajacaliforniano"] },
  { ambito: "baja-california-sur", nombre: "Baja California Sur", alias: ["baja california sur", "sudcaliforniano"] },
  { ambito: "campeche", nombre: "Campeche", alias: ["campeche", "campechano"] },
  { ambito: "chiapas", nombre: "Chiapas", alias: ["chiapas", "chiapaneco"] },
  { ambito: "chihuahua", nombre: "Chihuahua", alias: ["chihuahua", "chihuahuense"] },
  { ambito: "cdmx", nombre: "Ciudad de México", alias: ["ciudad de mexico", "cdmx", "distrito federal", "capitalino", "chilango"] },
  { ambito: "coahuila", nombre: "Coahuila", alias: ["coahuila", "coahuilense"] },
  { ambito: "colima", nombre: "Colima", alias: ["colima", "colimense", "colimote"] },
  { ambito: "durango", nombre: "Durango", alias: ["durango", "duranguense"] },
  { ambito: "guanajuato", nombre: "Guanajuato", alias: ["guanajuato", "guanajuatense"] },
  { ambito: "guerrero", nombre: "Guerrero", alias: ["guerrero", "guerrerense"] },
  { ambito: "hidalgo", nombre: "Hidalgo", alias: ["hidalgo", "hidalguense"] },
  { ambito: "jalisco", nombre: "Jalisco", alias: ["jalisco", "jalisciense", "tapatio"] },
  { ambito: "estado-de-mexico", nombre: "Estado de México", alias: ["estado de mexico", "edomex", "mexiquense"] },
  { ambito: "michoacan", nombre: "Michoacán", alias: ["michoacan", "michoacano"] },
  { ambito: "morelos", nombre: "Morelos", alias: ["morelos", "morelense"] },
  { ambito: "nayarit", nombre: "Nayarit", alias: ["nayarit", "nayarita"] },
  { ambito: "nuevo-leon", nombre: "Nuevo León", alias: ["nuevo leon", "neoleones", "regiomontano"] },
  { ambito: "oaxaca", nombre: "Oaxaca", alias: ["oaxaca", "oaxaqueno"] },
  { ambito: "puebla", nombre: "Puebla", alias: ["puebla", "poblano"] },
  { ambito: "queretaro", nombre: "Querétaro", alias: ["queretaro", "queretano"] },
  { ambito: "quintana-roo", nombre: "Quintana Roo", alias: ["quintana roo", "quintanarroense"] },
  { ambito: "san-luis-potosi", nombre: "San Luis Potosí", alias: ["san luis potosi", "potosino"] },
  { ambito: "sinaloa", nombre: "Sinaloa", alias: ["sinaloa", "sinaloense"] },
  { ambito: "sonora", nombre: "Sonora", alias: ["sonora", "sonorense"] },
  { ambito: "tabasco", nombre: "Tabasco", alias: ["tabasco", "tabasqueno"] },
  { ambito: "tamaulipas", nombre: "Tamaulipas", alias: ["tamaulipas", "tamaulipeco"] },
  { ambito: "tlaxcala", nombre: "Tlaxcala", alias: ["tlaxcala", "tlaxcalteca"] },
  { ambito: "veracruz", nombre: "Veracruz", alias: ["veracruz", "veracruzano", "jarocho"] },
  { ambito: "yucatan", nombre: "Yucatán", alias: ["yucatan", "yucateco"] },
  { ambito: "zacatecas", nombre: "Zacatecas", alias: ["zacatecas", "zacatecano"] },
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const NOMBRES = new Map<string, string>([
  [FEDERAL, "Constitución federal (CPEUM)"],
  ...ENTIDADES.map((e) => [e.ambito, e.nombre] as [string, string]),
]);

/** Nombre legible de un ámbito para citas y prompt. */
export function nombreAmbito(ambito: string): string {
  return NOMBRES.get(ambito) ?? ambito;
}

/** Estados mencionados (por nombre o gentilicio) en los textos dados. */
export function detectarEstados(...textos: string[]): string[] {
  const hay = ` ${norm(textos.join(" "))} `;
  const found = new Set<string>();
  for (const e of ENTIDADES) {
    if (e.alias.some((a) => hay.includes(` ${norm(a)} `) || hay.includes(` ${norm(a)},`)))
      found.add(e.ambito);
  }
  return [...found];
}

/**
 * Scope de búsqueda para la auto-fusión: SIEMPRE federal + los estados
 * detectados. Sin estado mencionado → solo federal (base compartida).
 */
export function scopeAuto(...textos: string[]): string[] {
  return [FEDERAL, ...detectarEstados(...textos)];
}

/** Normaliza un ámbito explícito (de API/MCP); federal siempre incluido. */
export function scopeExplicito(ambito: unknown): string[] | null {
  if (ambito == null) return null;
  const lista = (Array.isArray(ambito) ? ambito : [ambito])
    .map((a) => norm(String(a)))
    .filter(Boolean);
  if (!lista.length) return null;
  return [...new Set([FEDERAL, ...lista])];
}
