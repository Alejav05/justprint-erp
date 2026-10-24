import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';
import { hoy } from '../src/lib/fechas.js';
import { acumuladoCompuesto, aplicarAjuste, mesesHasta } from '../src/lib/ipc.js';

let ctx; let id; let cliente;
before(async () => {
  ctx = await montar(); const db = ctx.db;
  await db('cotizaciones_usd').insert({ fecha: hoy(), valor: 1500, fuente: 'BNA' });
  cliente = (await db('clientes').insert({ razon_social: 'Grupo Ajuste SA', estado: 'activo' }))[0];
  id = (await db('contratos').insert({ cliente_id: cliente, nombre: 'General', estado: 'vigente', moneda: 'ARS', fecha_inicio: '2024-10-01' }))[0];
  await db('contrato_condiciones').insert({ contrato_id: id, vigente_desde: '2026-07-01', monto_mensual: 536333.58, franquicia_negro: 1000, franquicia_color: 300, excedente_negro: 30.2769, excedente_color: 373.7034, facturable: false });
});
after(async () => { await ctx.cerrar(); });

test('el IPC se acumula en forma compuesta y los meses se cuentan hacia atrás', () => {
  assert.deepEqual(mesesHasta('2026-02'), ['2025-12', '2026-01', '2026-02']);
  assert.ok(Math.abs(acumuladoCompuesto([1.9, 2.1, 1.7]) - 5.8) < 0.01);
  const n = aplicarAjuste({ monto_mensual: 1000, excedente_negro: 10, excedente_color: 100 }, 10);
  assert.deepEqual(n, { monto_mensual: 1100, excedente_negro: 11, excedente_color: 110 });
});

test('proponer: sin los tres IPC cargados avisa cuáles faltan', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  const r = await llamar('GET', `/api/contratos/${id}/ajuste?hasta=2026-09`);
  assert.equal(r.statusCode, 200); const j = r.json();
  assert.equal(j.ok, false); assert.deepEqual(j.faltan, ['2026-07', '2026-08', '2026-09']);
  assert.equal((await llamar('POST', `/api/contratos/${id}/ajuste`, { hasta: '2026-09' })).statusCode, 400);
});

test('cargar IPC, proponer y aplicar: nueva condición vigente desde el mes, la anterior se cierra', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  for (const [p, v] of [['2026-07', 1.9], ['2026-08', 2.1], ['2026-09', 1.7]]) assert.equal((await llamar('PUT', `/api/ipc/${p}`, { variacion: v })).statusCode, 200);
  assert.equal((await llamar('GET', '/api/ipc')).json().items.length, 3);
  const prop = (await llamar('GET', `/api/contratos/${id}/ajuste?hasta=2026-09`)).json();
  assert.equal(prop.ok, true); assert.equal(prop.vigente_desde, '2026-09-01');
  assert.ok(Math.abs(prop.pct - 5.8) < 0.01);
  assert.equal(prop.nuevo.monto_mensual, Math.round(536333.58 * (1 + acumuladoCompuesto([1.9, 2.1, 1.7]) / 100) * 100) / 100);
  const ap = await llamar('POST', `/api/contratos/${id}/ajuste`, { hasta: '2026-09' });
  assert.equal(ap.statusCode, 201);
  const conds = await ctx.db('contrato_condiciones').where({ contrato_id: id }).orderBy('vigente_desde');
  assert.equal(conds.length, 2); assert.equal(conds[0].vigente_hasta, '2026-08-31'); assert.equal(conds[1].motivo, 'ajuste_ipc');
  assert.equal(conds[1].facturable, 0); assert.equal(conds[1].franquicia_color, 300); assert.ok(conds[1].monto_usd_referencia > 0);
  assert.equal((await llamar('POST', `/api/contratos/${id}/ajuste`, { hasta: '2026-09' })).statusCode, 409);
});

test('la liquidación usa la condición nueva desde el mes del ajuste y la vieja antes', async () => {
  const db = ctx.db; const { liquidar } = await import('../src/lib/liquidacion.js');
  const r8 = (await liquidar(db, '2026-08', { contratoIds: [id], sinContadores: true })).filas[0];
  const r9 = (await liquidar(db, '2026-09', { contratoIds: [id], sinContadores: true })).filas[0];
  assert.equal(r8.abono, 536333.58); assert.ok(r9.abono > 567000);
});

test('una bonificación se guarda en negativo, marcada, y baja el neto', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  const c = await llamar('POST', '/api/facturas', { cliente_id: cliente, moneda: 'ARS', interno: true, items: [{ tipo: 'abono', descripcion: 'Abono', cantidad: 1, precio_unitario: 300000 }] });
  const fid = c.json().id;
  assert.equal((await llamar('POST', `/api/facturas/${fid}/items`, { tipo: 'otro', descripcion: 'Días bonificados (5 días)', cantidad: 1, precio_unitario: 50000, bonificacion: true })).statusCode, 201);
  const f = (await llamar('GET', `/api/facturas/${fid}`)).json();
  assert.equal(f.neto, 250000);
  assert.equal(f.items.at(-1).subtotal, -50000); assert.ok(f.items.at(-1).bonificacion);
});

test('facturación (sin permiso de editar contratos) no carga IPC ni ajusta', async () => {
  const { llamar } = await entrar(ctx.app, 'julia@demo.local');
  assert.equal((await llamar('PUT', '/api/ipc/2026-10', { variacion: 1 })).statusCode, 403);
  assert.equal((await llamar('POST', `/api/contratos/${id}/ajuste`, { hasta: '2026-12' })).statusCode, 403);
  assert.equal((await llamar('GET', '/api/ipc')).statusCode, 200);
});
