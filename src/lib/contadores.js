/** Valida una lectura de contadores contra la última del equipo. Devuelve un código de error o null. */
export async function validarLectura(db, equipoId, tipoModelo, negro, color) {
  if (negro == null) return { error: 'contador_negro_requerido' };
  if (tipoModelo === 'monocromo' && color) return { error: 'equipo_monocromo' };
  if (tipoModelo === 'color' && color == null) return { error: 'contador_color_requerido' };
  const ultima = await db('lecturas_contador').where({ equipo_id: equipoId }).orderBy('fecha', 'desc').orderBy('id', 'desc').first();
  if (ultima && (negro < ultima.contador_negro || (color ?? 0) < ultima.contador_color)) {
    return { error: 'contador_menor_al_anterior', anterior: { negro: ultima.contador_negro, color: ultima.contador_color } };
  }
  return null;
}

/** Una lectura pertenece al período que declara o, si no declara, al mes de su fecha. */
export const periodoDeLectura = (l) => l.periodo ?? String(l.fecha instanceof Date ? l.fecha.toISOString() : l.fecha).slice(0, 7);

/**
 * Consumo de `periodo` para un equipo en una asignación: última lectura del período menos la última de los períodos
 * anteriores dentro de la misma asignación (o el contador inicial de la instalación). `ls`: lecturas ya normalizadas
 * ({ fecha: 'AAAA-MM-DD', per }) en orden de fecha e id. Devuelve null si el período no tiene lectura.
 */
export function consumoPeriodo(ls, periodo, asig) {
  const actual = ls.filter((l) => l.per === periodo).at(-1);
  if (!actual) return null;
  const desde = String(asig.desde).slice(0, 10);
  const base = ls.filter((l) => l.per < periodo && l.fecha >= desde).at(-1);
  const bn = base ? base.contador_negro : asig.contador_inicial_negro; const bc = base ? base.contador_color : asig.contador_inicial_color;
  const [pa, pm] = periodo.split('-').map(Number);
  const meses = base ? Math.max(1, (pa * 12 + pm) - (Number(base.per.slice(0, 4)) * 12 + Number(base.per.slice(5, 7)))) : 1;
  return {
    actual, base: base ?? null, base_negro: bn, base_color: bc, meses,
    negro: Math.max(0, actual.contador_negro - bn), color: asig.tipo === 'color' ? Math.max(0, actual.contador_color - bc) : 0,
  };
}
