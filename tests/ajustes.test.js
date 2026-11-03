import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';
import { hoy } from '../src/lib/fechas.js';
import { acumuladoCompuesto, aplicarAjuste, mesesAntes, proximoAjusteMes } from '../src/lib/ipc.js';
import { fuente, variaciones } from '../src/lib/indec.js';

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
  assert.deepEqual(mesesAntes('2026-03'), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(mesesAntes('2026-12'), ['2026-09', '2026-10', '2026-11']);
  assert.equal(proximoAjusteMes({ meses: 3, base: '2026-09' }), '2026-12'); assert.equal(proximoAjusteMes({ meses: 6, base: '2026-09', ultimoAjuste: '2027-03' }), '2027-09'); assert.equal(proximoAjusteMes({ meses: null, base: '2026-09' }), null);
  assert.ok(Math.abs(acumuladoCompuesto([1.9, 2.1, 1.7]) - 5.8) < 0.01);
  const n = aplicarAjuste({ monto_mensual: 1000, excedente_negro: 10, excedente_color: 100 }, 10);
  assert.deepEqual(n, { monto_mensual: 1100, excedente_negro: 11, excedente_color: 110 });
});

test('proponer: sin los tres IPC cargados avisa cuáles faltan', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  const r = await llamar('GET', `/api/contratos/${id}/ajuste?desde=2026-10`);
  assert.equal(r.statusCode, 200); const j = r.json();
  assert.equal(j.ok, false); assert.deepEqual(j.faltan, ['2026-07', '2026-08', '2026-09']);
  assert.equal((await llamar('POST', `/api/contratos/${id}/ajuste`, { desde: '2026-10' })).statusCode, 400);
});

test('cargar IPC, proponer y aplicar: nueva condición vigente desde el mes, la anterior se cierra', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  for (const [p, v] of [['2026-07', 1.9], ['2026-08', 2.1], ['2026-09', 1.7]]) assert.equal((await llamar('PUT', `/api/ipc/${p}`, { variacion: v })).statusCode, 200);
  assert.equal((await llamar('GET', '/api/ipc')).json().items.length, 3);
  const prop = (await llamar('GET', `/api/contratos/${id}/ajuste?desde=2026-10`)).json();
  assert.equal(prop.ok, true); assert.equal(prop.vigente_desde, '2026-10-01');
  assert.ok(Math.abs(prop.pct - 5.8) < 0.01);
  assert.equal(prop.nuevo.monto_mensual, Math.round(536333.58 * (1 + acumuladoCompuesto([1.9, 2.1, 1.7]) / 100) * 100) / 100);
  const ap = await llamar('POST', `/api/contratos/${id}/ajuste`, { desde: '2026-10' });
  assert.equal(ap.statusCode, 201);
  const conds = await ctx.db('contrato_condiciones').where({ contrato_id: id }).orderBy('vigente_desde');
  assert.equal(conds.length, 2); assert.equal(conds[0].vigente_hasta, '2026-09-30'); assert.equal(conds[1].motivo, 'ajuste_ipc');
  assert.equal(conds[1].facturable, 0); assert.equal(conds[1].franquicia_color, 300); assert.ok(conds[1].monto_usd_referencia > 0);
  assert.equal((await llamar('POST', `/api/contratos/${id}/ajuste`, { desde: '2026-10' })).statusCode, 409);
});

test('la liquidación usa la condición nueva desde el mes del ajuste y la vieja antes', async () => {
  const db = ctx.db; const { liquidar } = await import('../src/lib/liquidacion.js');
  const r8 = (await liquidar(db, '2026-09', { contratoIds: [id], sinContadores: true })).filas[0];
  const r9 = (await liquidar(db, '2026-10', { contratoIds: [id], sinContadores: true })).filas[0];
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
  assert.equal((await llamar('POST', `/api/contratos/${id}/ajuste`, { desde: '2026-12' })).statusCode, 403);
  assert.equal((await llamar('GET', '/api/ipc')).statusCode, 200);
});

test('las variaciones mensuales salen de los niveles del índice, con un decimal', () => {
  const v = variaciones([['2026-05-01', 100], ['2026-06-01', 102.04], ['2026-07-01', 103.5]]);
  assert.deepEqual(v, [{ periodo: '2026-06', variacion: 2 }, { periodo: '2026-07', variacion: 1.4 }]);
});

test('importar del INDEC: agrega lo que falta, no pisa lo cargado a mano ni lo ya revisado', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  const db = ctx.db; const mes = hoy().slice(0, 7);
  const [a, m] = mes.split('-').map(Number); const p = (k) => { const t = a * 12 + (m - 1) - k - 9; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`; };
  fuente.fetchFn = async () => ({ ok: true, json: async () => ({ data: [[p(4), 100], [p(3), 102], [p(2), 104.04], [p(1), 106.12]] }) });
  try {
    await llamar('PUT', `/api/ipc/${p(2).slice(0, 7)}`, { variacion: 9.9 }); // cargado a mano: no se pisa
    const r = await llamar('POST', '/api/ipc/importar'); assert.equal(r.statusCode, 200);
    assert.deepEqual([r.json().agregados, r.json().actualizados], [2, 0]);
    const lista = (await llamar('GET', '/api/ipc')).json().items;
    const x = lista.find((i) => i.periodo === p(3).slice(0, 7)); assert.equal(x.variacion, 2); assert.equal(x.fuente, 'indec'); assert.equal(x.revisado, false);
    assert.equal(lista.find((i) => i.periodo === p(2).slice(0, 7)).variacion, 9.9);
    // si el INDEC corrige un dato sin revisar, se actualiza; ya revisado, no
    fuente.fetchFn = async () => ({ ok: true, json: async () => ({ data: [[p(4), 100], [p(3), 103]] }) });
    assert.equal((await llamar('POST', '/api/ipc/importar')).json().actualizados, 1);
    await llamar('POST', `/api/ipc/${p(3).slice(0, 7)}/revisar`);
    fuente.fetchFn = async () => ({ ok: true, json: async () => ({ data: [[p(4), 100], [p(3), 110]] }) });
    assert.equal((await llamar('POST', '/api/ipc/importar')).json().actualizados, 0);
    fuente.fetchFn = async () => ({ ok: false, status: 503 });
    assert.equal((await llamar('POST', '/api/ipc/importar')).statusCode, 502);
  } finally { fuente.fetchFn = null; await db('indices_ipc').whereIn('periodo', [p(4), p(3), p(2), p(1)].map((x) => x.slice(0, 7))).delete(); }
});

test('acuerdo por contrato: el próximo ajuste sale del acuerdo (Grupo 8.66: servicio dic, con sep-oct-nov) y aparece en el panel', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local'); const db = ctx.db;
  const cl = (await db('clientes').insert({ razon_social: 'Grupo 8.66 Test', estado: 'activo' }))[0];
  const ct = (await db('contratos').insert({ cliente_id: cl, nombre: 'General', estado: 'vigente', moneda: 'ARS', fecha_inicio: '2025-01-01', ajuste_ipc_meses: 3, ajuste_ipc_base: '2026-09' }))[0];
  await db('contrato_condiciones').insert({ contrato_id: ct, vigente_desde: '2026-09-01', monto_mensual: 100000, franquicia_negro: 0, franquicia_color: 0, excedente_negro: 10, excedente_color: 100, motivo: 'ajuste_ipc' });
  const prop = (await llamar('GET', `/api/contratos/${ct}/ajuste`)).json();
  assert.equal(prop.desde, '2026-12'); assert.deepEqual(prop.meses, ['2026-09', '2026-10', '2026-11']); assert.equal(prop.vigente_desde, '2026-12-01'); assert.equal(prop.ok, false);
  for (const [p, v] of [['2026-09', 2], ['2026-10', 2], ['2026-11', 2]]) await db('indices_ipc').where({ periodo: p }).delete().then(() => db('indices_ipc').insert({ periodo: p, variacion: v, fuente: 'indec', revisado: false }));
  const panel = (await llamar('GET', '/api/ajustes-ipc')).json();
  const it = panel.items.find((x) => x.contrato_id === ct); assert.ok(it); assert.equal(it.desde, '2026-12'); assert.ok(['revisar', 'futuro'].includes(it.estado)); assert.equal(it.pct, 6.121);
  // confirmar: aplica desde diciembre y deja los tres índices como revisados
  const ap = await llamar('POST', `/api/contratos/${ct}/ajuste`, {}); assert.equal(ap.statusCode, 201); assert.equal(ap.json().vigente_desde, '2026-12-01');
  assert.equal((await db('indices_ipc').whereIn('periodo', ['2026-09', '2026-10', '2026-11']).where({ revisado: false })).length, 0);
  assert.equal((await db('contratos').where({ id: ct }).first()).ajuste_ipc_base, '2026-12');
  assert.equal((await llamar('GET', `/api/contratos/${ct}/ajuste`)).json().desde, '2027-03');
  // un período ya facturado no se puede ajustar hacia atrás
  const ct2 = (await db('contratos').insert({ cliente_id: cl, nombre: 'Otro', estado: 'vigente', moneda: 'ARS', fecha_inicio: '2025-01-01', ajuste_ipc_meses: 3, ajuste_ipc_base: '2026-06' }))[0];
  await db('contrato_condiciones').insert({ contrato_id: ct2, vigente_desde: '2026-06-01', monto_mensual: 1000, franquicia_negro: 0, franquicia_color: 0, excedente_negro: 1, excedente_color: 1 });
  await db('facturas').insert({ cliente_id: cl, contrato_id: ct2, periodo: '2026-09', estado: 'emitida', moneda: 'ARS', neto: 1000, total: 1210 }).catch(() => {});
  const f = await db('facturas').where({ contrato_id: ct2 }).first();
  if (f) assert.equal((await llamar('GET', `/api/contratos/${ct2}/ajuste`)).statusCode, 409);
});

test('contrato nuevo en pesos queda con ajuste cada 3 meses desde su inicio; se puede cambiar', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  const r = await llamar('POST', '/api/contratos', { cliente_id: cliente, nombre: 'Nuevo', fecha_inicio: '2026-11-01', moneda: 'ARS', precios: { monto_mensual: 1000, franquicia_negro: 0, franquicia_color: 0, excedente_negro: 1, excedente_color: 1, facturable: true } });
  assert.equal(r.statusCode, 201);
  let c = await ctx.db('contratos').where({ id: r.json().id }).first(); assert.equal(c.ajuste_ipc_meses, 3); assert.equal(c.ajuste_ipc_base, '2026-11');
  assert.equal((await llamar('PATCH', `/api/contratos/${c.id}`, { ajuste_ipc_meses: 6, ajuste_ipc_base: '2026-10' })).statusCode, 200);
  c = await ctx.db('contratos').where({ id: c.id }).first(); assert.equal(c.ajuste_ipc_meses, 6); assert.equal(c.ajuste_ipc_base, '2026-10');
});
