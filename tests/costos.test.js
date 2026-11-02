import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { montar, entrar } from './ayuda.js';

let ctx; let a; let b;
before(async () => {
  ctx = await montar();
  [a] = await ctx.db('clientes').insert({ razon_social: 'Cliente A', estado: 'activo' });
  [b] = await ctx.db('clientes').insert({ razon_social: 'Cliente B', estado: 'activo' });
  const c = (cliente_id, fecha, concepto, tipo, usd, extra = {}) => ctx.db('costos').insert({ cliente_id, fecha, concepto, tipo, importe: usd, moneda: 'USD', importe_usd: usd, ...extra });
  await c(a, '2026-09-10', 'Toner negro', 'insumo', 100); await c(a, '2026-10-05', 'Visita técnica', 'mano_de_obra', 60); await c(b, '2026-10-20', 'Flete', 'logistica', 40);
  await c(null, '2026-10-25', 'Alquiler depósito', 'otro', 300);
});
after(async () => { await ctx.cerrar(); });

test('el detalle de costos se filtra por período y cliente y trae los totales por período, cliente y tipo', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const todo = (await dir.llamar('GET', '/api/costos?desde=2026-09&hasta=2026-10')).json();
  assert.equal(todo.cantidad, 4); assert.equal(todo.total_usd, 500);
  assert.deepEqual(todo.por_periodo.map((x) => [x.clave, x.usd]), [['2026-10', 400], ['2026-09', 100]]);
  assert.equal(todo.por_cliente[0].nombre, 'Generales (sin cliente)');
  assert.ok(todo.por_tipo.some((t) => t.nombre === 'Mano de obra' && t.usd === 60));
  const soloA = (await dir.llamar('GET', `/api/costos?cliente_id=${a}`)).json();
  assert.equal(soloA.cantidad, 2); assert.equal(soloA.total_usd, 160);
  assert.equal((await dir.llamar('GET', '/api/costos?desde=2026-10&hasta=2026-10&tipo=insumo')).json().cantidad, 0);
  assert.equal((await dir.llamar('GET', '/api/costos?q=flete')).json().cantidad, 1);
});

test('solo quien tiene permiso de costos los ve, y el Excel sale con el total', async () => {
  const tec = await entrar(ctx.app, 'matias@demo.local');
  assert.equal((await tec.llamar('GET', '/api/costos')).statusCode, 403);
  assert.equal((await tec.llamar('GET', '/api/costos/excel')).statusCode, 403);
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const r = await dir.llamar('GET', '/api/costos/excel?desde=2026-09&hasta=2026-10');
  assert.equal(r.statusCode, 200); assert.match(r.headers['content-type'], /spreadsheetml/);
  const libro = new ExcelJS.Workbook(); await libro.xlsx.load(r.rawPayload);
  const ws = libro.getWorksheet('Costos'); assert.equal(ws.rowCount, 6, 'encabezado + 4 costos + total');
  assert.equal(ws.getRow(6).getCell(11).value, 500);
});
