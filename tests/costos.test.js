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

test('cargar, corregir y borrar costos a mano, con permisos y conversión de pesos', async () => {
  await ctx.db('cotizaciones_usd').insert({ fecha: '2026-10-01', valor: 1500, fuente: 'BNA' });
  const jul = await entrar(ctx.app, 'julia@demo.local');
  const ok = await jul.llamar('POST', '/api/costos', { fecha: '2026-10-12', concepto: 'Repuesto fusor', tipo: 'insumo', importe: 150000, moneda: 'ARS', cliente_id: a, proveedor: 'Repuestos SA' });
  assert.equal(ok.statusCode, 201, ok.body);
  const id = ok.json().id;
  const fila = (await jul.llamar('GET', `/api/costos?cliente_id=${a}`)).json().costos.find((x) => x.id === id);
  assert.equal(fila.moneda, 'ARS'); assert.equal(fila.importe, 150000); assert.ok(fila.importe_usd > 0 && fila.importe_usd < 150000, 'convertido a USD con la cotización'); assert.equal(fila.proveedor, 'Repuestos SA'); assert.equal(fila.origen, 'manual');
  assert.equal((await jul.llamar('PATCH', `/api/costos/${id}`, { fecha: '2026-10-12', concepto: 'Repuesto fusor (corregido)', tipo: 'insumo', importe: 90, moneda: 'USD', cliente_id: a })).statusCode, 200);
  assert.equal((await jul.llamar('GET', `/api/costos?cliente_id=${a}`)).json().costos.find((x) => x.id === id).importe_usd, 90);
  assert.equal((await jul.llamar('POST', '/api/costos', { fecha: '2999-01-01', concepto: 'Futuro', importe: 1, moneda: 'USD', cliente_id: a })).json().error, 'fecha_futura');
  assert.equal((await jul.llamar('POST', '/api/costos', { fecha: '2026-10-12', concepto: 'xx', importe: 1, moneda: 'USD', cliente_id: 99999 })).statusCode, 404);
  const tec = await entrar(ctx.app, 'matias@demo.local');
  assert.equal((await tec.llamar('POST', '/api/costos', { fecha: '2026-10-12', concepto: 'No debería', importe: 1, moneda: 'USD', cliente_id: a })).statusCode, 403);
  assert.equal((await tec.llamar('DELETE', `/api/costos/${id}`)).statusCode, 403);
  assert.equal((await jul.llamar('DELETE', `/api/costos/${id}`)).statusCode, 200);
  assert.equal((await jul.llamar('GET', `/api/costos?cliente_id=${a}`)).json().costos.some((x) => x.id === id), false);
  assert.ok(await ctx.db('audit_log').where({ tabla: 'costos', accion: 'eliminar' }).first());
});

test('un remito de insumos a un cliente suma su costo al negocio, y los insumos sin costo se avisan', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const [con] = await ctx.db('insumos').insert({ codigo: 'TN-COSTO', descripcion: 'Tóner con costo', costo_referencia: 40, moneda: 'USD' });
  const [sin] = await ctx.db('insumos').insert({ codigo: 'TN-SIN', descripcion: 'Tóner sin costo' });
  await ctx.db('movimientos_insumo').insert([{ insumo_id: con, tipo: 'entrada', cantidad: 10, motivo: 'stock' }, { insumo_id: sin, tipo: 'entrada', cantidad: 10, motivo: 'stock' }]);
  const r = await dir.llamar('POST', '/api/remitos/entrega', { cliente_id: b, items: [{ insumo_id: con, cantidad: 2 }, { insumo_id: sin, cantidad: 1 }] });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().costo_usd, 80); assert.deepEqual(r.json().insumos_sin_costo, ['TN-SIN']);
  const k = (await dir.llamar('GET', `/api/costos?cliente_id=${b}`)).json().costos.find((x) => x.automatico);
  assert.equal(k.importe_usd, 80); assert.equal(k.tipo, 'insumo'); assert.match(k.concepto, new RegExp(r.json().numero));
  assert.equal((await dir.llamar('PATCH', `/api/costos/${k.id}`, { fecha: k.fecha, concepto: 'Cambio', importe: 1, moneda: 'USD', cliente_id: b })).statusCode, 409, 'los costos de remito no se editan a mano');
  assert.equal((await dir.llamar('DELETE', `/api/costos/${k.id}`)).statusCode, 409);
  // El costo del insumo se fija con permiso de costos.
  assert.equal((await dir.llamar('PATCH', `/api/insumos/${sin}/costo`, { costo_referencia: 12.5, moneda: 'USD' })).statusCode, 200);
  const tec = await entrar(ctx.app, 'matias@demo.local');
  assert.equal((await tec.llamar('PATCH', `/api/insumos/${sin}/costo`, { costo_referencia: 1, moneda: 'USD' })).statusCode, 403);
  assert.equal((await tec.llamar('GET', `/api/insumos/${con}`)).json().costo_referencia, undefined, 'el técnico no ve costos');
});
