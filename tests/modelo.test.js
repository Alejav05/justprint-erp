import { test } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import knexfile from '../knexfile.js';
import { siguienteNumero } from '../src/lib/numeradores.js';
import { seed as base } from '../seeds/01_base.js';

const tablas = (db) => db.raw("select name from sqlite_master where type='table' and name not like 'knex_%' and name not like 'sqlite_%'");

test('las migraciones crean las 46 tablas del modelo más la de sesiones, y se pueden revertir', async () => {
  const db = knexLib(knexfile.test);
  await db.migrate.latest();
  const nombres = (await tablas(db)).map((t) => t.name);
  assert.equal(nombres.length, 50);
  assert.ok(nombres.includes('sesiones'));
  for (const esperada of ['cartera_asignaciones', 'ticket_eventos', 'cobro_aplicaciones', 'contrato_condiciones', 'audit_log']) {
    assert.ok(nombres.includes(esperada), `falta ${esperada}`);
  }
  await db.migrate.rollback(undefined, true);
  assert.equal((await tablas(db)).length, 0);
  await db.destroy();
});

test('las semillas base se pueden correr más de una vez sin duplicar', async () => {
  const db = knexLib(knexfile.test);
  await db.migrate.latest();
  await base(db);
  const antes = await db('rol_permiso').count({ n: '*' }).first();
  await base(db);
  const despues = await db('rol_permiso').count({ n: '*' }).first();
  assert.equal(antes.n, despues.n);
  assert.equal((await db('areas').count({ n: '*' }).first()).n, 5);
  await db.destroy();
});

test('los números de remito y ticket no se repiten aunque se pidan a la vez', async () => {
  const db = knexLib(knexfile.test);
  await db.migrate.latest();
  await base(db);
  const pedir = () => db.transaction((trx) => siguienteNumero(trx, 'remito'));
  const numeros = await Promise.all(Array.from({ length: 25 }, pedir));
  assert.equal(new Set(numeros).size, 25);
  assert.equal(numeros.sort()[0], '00001');
  assert.equal(await db.transaction((trx) => siguienteNumero(trx, 'ticket')), 'T-0001');
  await db.destroy();
});
