import knexLib from 'knex';
import knexfile from '../knexfile.js';
import { crearApp } from '../src/app.js';
import { seed as base } from '../seeds/01_base.js';
import { seed as demo, CLAVE_DEMO } from '../seeds/02_demo.js';

export { CLAVE_DEMO };

/** App con base SQLite en memoria, migrada y con datos de demostración. */
export async function montar() {
  process.env.NODE_ENV = 'test';
  let db; let borrar = null;
  if (process.env.TEST_DB === 'mysql') {
    // Una base nueva por archivo de prueba, para correr la misma batería contra MySQL/MariaDB (TEST_DB=mysql npm test).
    const base = { ...knexfile.production.connection, host: process.env.DB_HOST || '127.0.0.1', user: process.env.DB_USER || 'jp', password: process.env.DB_PASSWORD || 'jp' };
    const nombre = `jp_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = knexLib({ ...knexfile.production, connection: { ...base, database: undefined } });
    await admin.raw(`create database \`${nombre}\` character set utf8mb4`);
    db = knexLib({ ...knexfile.production, connection: { ...base, database: nombre } });
    borrar = async () => { await admin.raw(`drop database \`${nombre}\``); await admin.destroy(); };
  } else db = knexLib(knexfile.test);
  await db.migrate.latest();
  await base(db);
  await demo(db);
  const app = await crearApp({ db });
  return { db, app, cerrar: async () => { await app.close(); await db.destroy(); if (borrar) await borrar(); } };
}

/** Inicia sesión y devuelve una función para llamar a la API con esa cookie. */
export async function entrar(app, email, password = CLAVE_DEMO) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login falló para ${email}: ${r.statusCode} ${r.body}`);
  const cookie = r.cookies.find((c) => c.name === 'jp_sid');
  const llamar = (method, url, payload) => app.inject({ method, url, payload, cookies: { jp_sid: cookie.value } });
  return { llamar, cookie };
}
