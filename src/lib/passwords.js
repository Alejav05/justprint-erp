import bcrypt from 'bcryptjs';

const COSTO = 12;
// Hash fijo para gastar el mismo tiempo cuando el usuario no existe.
const HASH_FALSO = bcrypt.hashSync('no-existe-este-usuario', COSTO);

export const hashear = (clave) => bcrypt.hash(clave, COSTO);

export async function verificar(clave, hash) {
  return bcrypt.compare(clave, hash || HASH_FALSO);
}

/** Devuelve un mensaje de error o null si la contraseña cumple la política. */
export function validarPolitica(clave) {
  if (typeof clave !== 'string' || clave.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (!/[A-Za-z]/.test(clave) || !/[0-9]/.test(clave)) return 'La contraseña debe combinar letras y números.';
  return null;
}
