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
