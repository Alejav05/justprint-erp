import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';

let ctx;
before(async () => { ctx = await montar(); });
after(async () => { await ctx.cerrar(); });

test('atención: ve lo que hay que asignar y por vencer; el técnico no entra', async () => {
  const { llamar } = await entrar(ctx.app, 'sofia@demo.local');
  const r = await llamar('GET', '/api/tableros/atencion'); assert.equal(r.statusCode, 200);
  const t = r.json();
  assert.ok(t.abiertos >= 1); assert.equal(typeof t.sin_asignar_total, 'number'); assert.ok(t.sla.actual); assert.ok('agotados' in t.insumos);
  assert.ok(t.sin_asignar.every((k) => k.cliente && k.numero));
  assert.equal((await (await entrar(ctx.app, 'matias@demo.local')).llamar('GET', '/api/tableros/atencion')).statusCode, 403);
});

test('comercial: solo su cartera; el head ve al equipo y lo que no tiene responsable', async () => {
  const db = ctx.db;
  const nico = (await db('usuarios').where({ email: 'nicolas@demo.local' }).first()).id;
  const propios = (await db('cartera_asignaciones').whereNull('hasta').where({ usuario_id: nico })).length;
  const { llamar } = await entrar(ctx.app, 'nicolas@demo.local');
  const t = (await llamar('GET', '/api/tableros/comercial')).json();
  assert.equal(t.clientes.total, propios); assert.equal(t.equipo, null); assert.equal(t.sin_responsable, null);
  const head = (await (await entrar(ctx.app, 'head.comercial@demo.local')).llamar('GET', '/api/tableros/comercial')).json();
  assert.ok(Array.isArray(head.equipo)); assert.equal(typeof head.sin_responsable, 'number'); assert.ok(head.clientes.total >= t.clientes.total);
  assert.equal((await (await entrar(ctx.app, 'julia@demo.local')).llamar('GET', '/api/tableros/comercial')).statusCode, 403);
});
