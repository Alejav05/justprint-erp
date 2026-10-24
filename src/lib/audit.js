const OCULTAR = new Set(['password_hash']);

function limpiar(obj) {
  if (obj == null) return null;
  const copia = {};
  for (const [k, v] of Object.entries(obj)) if (!OCULTAR.has(k)) copia[k] = v;
  return JSON.stringify(copia);
}

/** Registra un hecho en audit_log. `ctx` puede ser null (por ejemplo, login fallido). */
export async function auditar(db, { usuarioId = null, ip = null }, accion, tabla, registroId, antes = null, despues = null) {
  await db('audit_log').insert({
    usuario_id: usuarioId,
    accion,
    tabla,
    registro_id: registroId == null ? null : String(registroId),
    antes: limpiar(antes),
    despues: limpiar(despues),
    ip,
  });
}
