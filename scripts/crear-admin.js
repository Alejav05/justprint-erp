// Crea (o repara) el primer usuario de Dirección en producción, sin datos de ejemplo.
import 'dotenv/config';
// Uso:  ADMIN_EMAIL=ale@justprint.com.ar ADMIN_NOMBRE="Ale" ADMIN_PASSWORD='...' npm run crear-admin
import { crearDb } from '../src/db.js';
import { hashear, validarPolitica } from '../src/lib/passwords.js';

const { ADMIN_EMAIL, ADMIN_NOMBRE, ADMIN_PASSWORD } = process.env;
if (!ADMIN_EMAIL || !ADMIN_NOMBRE || !ADMIN_PASSWORD) {
  console.error('Faltan ADMIN_EMAIL, ADMIN_NOMBRE o ADMIN_PASSWORD.');
  process.exit(1);
}
const problema = validarPolitica(ADMIN_PASSWORD);
if (problema) { console.error(problema); process.exit(1); }

const db = crearDb();
try {
  const rol = await db('roles').where({ nombre: 'direccion' }).first();
  const area = await db('areas').where({ nombre: 'Dirección' }).first();
  if (!rol || !area) throw new Error('Faltan los datos base. Corré primero: npm run seed:base');

  const email = ADMIN_EMAIL.trim().toLowerCase();
  const hash = await hashear(ADMIN_PASSWORD);
  const existe = await db('usuarios').where({ email }).first();
  let id;
  if (existe) {
    await db('usuarios').where({ id: existe.id }).update({ password_hash: hash, rol_id: rol.id, activo: true, intentos_fallidos: 0, bloqueado_hasta: null });
    await db('sesiones').where({ usuario_id: existe.id }).delete();
    id = existe.id;
    console.log(`Usuario existente actualizado: ${email}`);
  } else {
    [id] = await db('usuarios').insert({ nombre: ADMIN_NOMBRE, email, password_hash: hash, rol_id: rol.id });
    console.log(`Usuario creado: ${email}`);
  }
  const tiene = await db('usuario_area').where({ usuario_id: id, area_id: area.id }).first();
  if (!tiene) await db('usuario_area').insert({ usuario_id: id, area_id: area.id, funcion: 'lider', alcance: 'todo' });
} finally {
  await db.destroy();
}
