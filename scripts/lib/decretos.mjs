// Los decretos del DOF de congreso-mexicano vistos desde el registro: a qué
// documentos de la bitácora tocan, qué artículos les anotan sus notas de
// reforma y si alguno tiene commit propio. Casi todos son anteriores al alta
// de su ley; esos tienen su propia página, con la cadena hasta el DOF.

// Lo que sigue al último «en materia de» del título, si no es parte del nombre
// de una ley («…Delitos en Materia de Extorsión, Reglamentaria de…»). Sin eso,
// null: no se resume ni se deduce un tema.
export function temaDecreto(titulo) {
  const xs = [...(titulo ?? "").matchAll(/\ben materia (de|del)\s+/gi)];
  if (!xs.length) return null;
  const u = xs.at(-1);
  const resto = titulo.slice(u.index + u[0].length).replace(/\.\s*$/, "").trim();
  if (!resto || /\b(Ley|Leyes|Código|Reglamentari[ao])\b/.test(resto)) return null;
  const t = `${u[1].toLowerCase() === "del" ? "del " : ""}${resto}`;
  return t[0].toUpperCase() + t.slice(1);
}

// «Decreto por el que se reforman …» → «Reforman …»: lo que se lista cuando
// no hay tema.
export function tituloSinDecreto(titulo) {
  const t = (titulo ?? "").replace(/^Decreto\s+por\s+el\s+que\s+(se\s+)?/i, "").replace(/\.\s*$/, "");
  return t ? t[0].toUpperCase() + t.slice(1) : titulo;
}

// Dónde queda un decreto respecto del registro de una ley, por la versión con
// que entró (la Publicacion de su alta): `incluido`, si es esa misma versión;
// `anterior`, si el alta es posterior al decreto; `pendiente`, si el alta es
// anterior y aún no hay commit que lo registre.
export function estadoRegistro(publicacion, versionAlta) {
  if (!versionAlta) return null;
  if (versionAlta === publicacion) return "incluido";
  return versionAlta > publicacion ? "anterior" : "pendiente";
}

// `cambios`: los de la bitácora (con `doc`); `conCommit`: id de decreto →
// cambio de reforma que lo registra (de vinculosDe). Un decreto por entrada,
// del más reciente al más antiguo.
export function decretosDelRegistro(decretos, documentos, conCommit) {
  return decretos
    .map((d) => {
      const docs = (d.documentos ?? []).map((x) => {
        const doc = documentos.get(x.documento) ?? null;
        const alta = doc?.cambios.filter((c) => c.tipo === "alta").at(-1) ?? null;
        const version = alta?.publicaciones.at(-1) ?? null;
        const notas = doc?.reformasAnteriores?.find((r) => r.fecha === x.publicacion) ?? null;
        return {
          clave: x.documento,
          publicacion: x.publicacion,
          doc,
          alta,
          estado: estadoRegistro(x.publicacion, version),
          version,
          claves: notas?.claves ?? null,
          // Otros decretos del mismo día sobre el documento: sus notas de reforma
          // los juntan en una sola fecha.
          mismoDia: (x.decretos_mismo_dia ?? []).filter((id) => id !== d.id),
        };
      });
      // La Constitución primero: decide si la cadena lleva congresos locales.
      const primario = docs.find((x) => x.clave === "cpeum") ?? docs.find((x) => x.doc) ?? docs[0] ?? null;
      return { decreto: d, tema: temaDecreto(d.titulo), docs, primario, cambio: conCommit.get(d.id) ?? null };
    })
    .filter((e) => e.primario)
    .sort((a, b) => (b.decreto.fecha ?? "").localeCompare(a.decreto.fecha ?? "") || b.decreto.id.localeCompare(a.decreto.id));
}
