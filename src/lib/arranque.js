// Preparación de la base al arrancar, para hostings sin terminal cómoda (Hostinger despliega cada
// versión en una carpeta nueva). Se activa con AUTO_MIGRAR=1. Todo es idempotente.
import { hashear, validarPolitica } from './passwords.js';

export async function prepararBase(db, log = console.log) {
  const [, aplicadas] = await db.migrate.latest();
  if (aplicadas.length) log(`Migraciones aplicadas: ${aplicadas.length}`);
  await db.seed.run({ specific: '01_base.js' });

  // Primer usuario de Dirección: solo si todavía no hay ningún usuario y se cargaron las variables.
  const { ADMIN_EMAIL, ADMIN_NOMBRE, ADMIN_PASSWORD } = process.env;
  const hayUsuarios = await db('usuarios').first();
  if (hayUsuarios || !ADMIN_EMAIL || !ADMIN_NOMBRE || !ADMIN_PASSWORD) return;
  const problema = validarPolitica(ADMIN_PASSWORD);
  if (problema) { log(`No se creó el administrador: ${problema}`); return; }
  const rol = await db('roles').where({ nombre: 'direccion' }).first();
  const area = await db('areas').where({ nombre: 'Dirección' }).first();
  const [id] = await db('usuarios').insert({
    nombre: ADMIN_NOMBRE, email: ADMIN_EMAIL.trim().toLowerCase(), password_hash: await hashear(ADMIN_PASSWORD), rol_id: rol.id,
  });
  await db('usuario_area').insert({ usuario_id: id, area_id: area.id, funcion: 'lider', alcance: 'todo' });
  log(`Administrador creado: ${ADMIN_EMAIL.trim().toLowerCase()}. Ya podés borrar ADMIN_PASSWORD de las variables de entorno.`);
}
