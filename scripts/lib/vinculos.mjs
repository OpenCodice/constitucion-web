// Punto de extensión de la bitácora: lo que se sepa del proceso legislativo
// detrás de un cambio (el decreto del DOF, la iniciativa, las votaciones).
// Esos datos vivirán en otro repo y se enlazan por (Documento, Publicacion),
// que es lo que comparte un commit de reforma con su decreto, o por el sha del
// commit. Mientras no estén publicados no hay nada que enlazar y la página de
// cada cambio omite la sección.
//
// Cada vínculo: { titulo, url, detalle? }.

export async function leerVinculos() {
  return { porPublicacion: new Map(), porSha: new Map() };
}

export function vinculosDe(fuente, cambio) {
  const vistos = new Set();
  const res = [];
  const claves = cambio.publicaciones.map((p) => `${cambio.documento}|${p}`);
  for (const v of [...claves.flatMap((k) => fuente.porPublicacion.get(k) ?? []), ...(fuente.porSha.get(cambio.sha) ?? [])]) {
    if (!vistos.has(v.url)) {
      vistos.add(v.url);
      res.push(v);
    }
  }
  return res;
}
