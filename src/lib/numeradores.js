/**
 * Próximo número de una serie (remitos, tickets). Tiene que llamarse dentro de una transacción:
 * el UPDATE bloquea la fila hasta el commit, así dos usuarios a la vez nunca obtienen el mismo número.
 */
export async function siguienteNumero(trx, clave) {
  const n = await trx('numeradores').where({ clave }).increment('ultimo', 1);
  if (!n) throw new Error(`Numerador inexistente: ${clave}`);
  const fila = await trx('numeradores').where({ clave }).first();
  return `${fila.prefijo}${String(fila.ultimo).padStart(fila.ancho, '0')}`;
}
