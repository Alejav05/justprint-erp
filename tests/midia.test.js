import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';
import { aSql } from '../src/lib/sla.js';

let ctx;
before(async () => { ctx = await montar(); });
after(async () => { await ctx.cerrar(); });

test('mi día: solo lo propio, con las visitas de hoy primero', async () => {
  const db = ctx.db; const { llamar } = await entrar(ctx.app, 'matias@demo.local');
  const yo = (await db('usuarios').where({ email: 'matias@demo.local' }).first()).id;
  const mios = await db('tickets').where({ asignado_a: yo }).whereIn('estado', ['abierto', 'asignado', 'en_curso', 'esperando_cliente']);
  assert.ok(mios.length >= 1, 'la demo debería tener tickets de Matías');
  const r0 = (await llamar('GET', '/api/mi-dia')).json();
  assert.equal(r0.visitas_hoy.length + r0.atrasadas.length + r0.pendientes.length, mios.length);
  assert.ok([...r0.visitas_hoy, ...r0.atrasadas, ...r0.pendientes].every((t) => mios.some((m) => m.id === t.id)));
  const ahoraBA = Date.now();
  await db('tickets').where({ id: mios[0].id }).update({ visita_en: aSql(ahoraBA) });
  const r1 = (await llamar('GET', '/api/mi-dia')).json();
  assert.ok(r1.visitas_hoy.some((t) => t.id === mios[0].id) || r1.atrasadas.some((t) => t.id === mios[0].id));
  assert.ok(r1.kpi.actual);
});

test('mi día: quien no atiende tickets recibe 403', async () => {
  const { llamar } = await entrar(ctx.app, 'julia@demo.local');
  assert.equal((await llamar('GET', '/api/mi-dia')).statusCode, 403);
});
