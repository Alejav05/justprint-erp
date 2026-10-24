import knexLib from 'knex';
import knexfile from '../knexfile.js';
import { crearApp } from '../src/app.js';
import { seed as base } from '../seeds/01_base.js';
import { seed as demo, CLAVE_DEMO } from '../seeds/02_demo.js';

export { CLAVE_DEMO };

/** App con base SQLite en memoria, migrada y con datos de demostración. */
export async function montar() {
  process.env.NODE_ENV = 'test';
  const db = knexLib(knexfile.test);
  await db.migrate.latest();
  await base(db);
  await demo(db);
  const app = await crearApp({ db });
  return { db, app, cerrar: async () => { await app.close(); await db.destroy(); } };
}

/** Inicia sesión y devuelve una función para llamar a la API con esa cookie. */
export async function entrar(app, email, password = CLAVE_DEMO) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login falló para ${email}: ${r.statusCode} ${r.body}`);
  const cookie = r.cookies.find((c) => c.name === 'jp_sid');
  const llamar = (method, url, payload) => app.inject({ method, url, payload, cookies: { jp_sid: cookie.value } });
  return { llamar, cookie };
}
