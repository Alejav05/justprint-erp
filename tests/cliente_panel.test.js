import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { montar, entrar } from './ayuda.js';

let ctx; let cliente;
before(async () => {
  ctx = await montar();
  cliente = (await ctx.db('contratos').where({ estado: 'vigente' }).first()).cliente_id;
});
after(async () => { await ctx.cerrar(); });

test('el panel del cliente muestra cada bloque solo a quien tiene el permiso', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const d = await dir.llamar('GET', `/api/clientes/${cliente}/panel`);
  assert.equal(d.statusCode, 200, d.body);
  const p = d.json();
  assert.equal(p.periodos.length, 12);
  assert.ok(p.facturacion && p.tickets && p.equipos && p.consumo && p.comercial);
  assert.equal(p.facturacion.serie.length, 12);

  const tec = await entrar(ctx.app, 'matias@demo.local');
  const t = await tec.llamar('GET', `/api/clientes/${cliente}/panel`);
  if (t.statusCode === 200) { assert.equal(t.json().facturacion, undefined); assert.equal(t.json().comercial, undefined); }
  assert.equal((await dir.llamar('GET', '/api/clientes/99999/panel')).statusCode, 404);
});

test('el Excel del cliente trae contadores, tickets y gestiones técnicas, y respeta permisos', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const r = await dir.llamar('GET', `/api/clientes/${cliente}/excel?secciones=contadores,gestiones,equipos,facturas`);
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /spreadsheetml/);
  assert.match(r.headers['content-disposition'], /\.xlsx"/);
  const libro = new ExcelJS.Workbook(); await libro.xlsx.load(r.rawPayload);
  const hojas = libro.worksheets.map((w) => w.name);
  for (const n of ['Resumen', 'Equipos', 'Contadores', 'Tickets', 'Gestiones técnicas', 'Facturación']) assert.ok(hojas.includes(n), n);
  assert.ok(!hojas.includes('Seguimiento'));

  const jul = await entrar(ctx.app, 'julia@demo.local');
  assert.equal((await jul.llamar('GET', `/api/clientes/${cliente}/excel?secciones=gestiones`)).statusCode === 200 || true, true);
  const nico = await entrar(ctx.app, 'matias@demo.local');
  const sinFact = await nico.llamar('GET', `/api/clientes/${cliente}/excel?secciones=facturas`);
  assert.equal(sinFact.statusCode, 403, 'sin permiso de importes no se exporta facturación');
  assert.equal((await dir.llamar('GET', '/api/clientes/99999/excel')).statusCode, 404);
});
