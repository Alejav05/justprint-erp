import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar as entrarSinCache } from './ayuda.js';
import { hoy } from '../src/lib/fechas.js';
import { factorProrateo } from '../src/lib/liquidacion.js';

let ctx; let K;
const sesiones = new Map();
const entrar = async (app, email) => { if (!sesiones.has(email)) sesiones.set(email, await entrarSinCache(app, email)); return sesiones.get(email); };
const P = '2026-10';

before(async () => {
  ctx = await montar(); const db = ctx.db;
  await db('cotizaciones_usd').insert({ fecha: hoy(), valor: 1500, fuente: 'BNA' });
  const entidad = (await db('entidades_facturantes').insert({ razon_social: 'Europa Haus S.A.S.', cuit: '30-71646173-0' }))[0];
  const color = (await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'C-1', tipo: 'color' }))[0];
  const mono = (await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'M-1', tipo: 'monocromo' }))[0];
  const cliente = async (n) => (await db('clientes').insert({ razon_social: n, estado: 'activo' }))[0];
  const contrato = async (cid, nombre, o = {}) => {
    const id = (await db('contratos').insert({ cliente_id: cid, nombre, estado: 'vigente', moneda: o.moneda ?? 'USD', fecha_inicio: o.inicio ?? '2026-01-01', entidad_facturante_id: entidad }))[0];
    await db('contrato_condiciones').insert({ contrato_id: id, vigente_desde: o.inicio ?? '2026-01-01', monto_mensual: o.monto, franquicia_negro: 1000, franquicia_color: 100, excedente_negro: o.exN ?? 0.05, excedente_color: o.exC ?? 0.2, facturable: o.facturable ?? true });
    return id;
  };
  const equipo = async (serie, modelo, cid, inicio = '2026-01-01') => {
    const id = (await db('equipos').insert({ modelo_id: modelo, numero_serie: serie, estado: 'instalado' }))[0];
    await db('asignaciones_equipo').insert({ equipo_id: id, contrato_id: cid, desde: inicio, contador_inicial_negro: 0, contador_inicial_color: 0 }); return id;
  };
  const lec = (e, fecha, n, c) => db('lecturas_contador').insert({ equipo_id: e, fecha, contador_negro: n, contador_color: c, origen: 'tecnico' });

  const cA = await cliente('Liquidación A SA'); const ctA = await contrato(cA, 'Color', { monto: 100 }); const eA = await equipo('LQ-A', color, ctA);
  await lec(eA, '2026-09-30', 5000, 500); await lec(eA, '2026-10-30', 6500, 650);
  const cB = await cliente('Liquidación B SA'); const ctB = await contrato(cB, 'Mitad de mes', { monto: 310, inicio: '2026-10-11' }); const eB = await equipo('LQ-B', mono, ctB, '2026-10-11');
  await lec(eB, '2026-10-30', 900, 0);
  const cC = await cliente('Liquidación C SA'); const ctC = await contrato(cC, 'Sin lectura', { monto: 100 }); const eC = await equipo('LQ-C', mono, ctC); await lec(eC, '2026-09-15', 100, 0);
  const cD = await cliente('Liquidación D SA'); const ctD = await contrato(cD, 'En pesos', { monto: 150000, moneda: 'ARS', exN: 5, exC: 20 }); const eD = await equipo('LQ-D', mono, ctD); await lec(eD, '2026-10-20', 800, 0);
  const cE = await cliente('Liquidación E SA'); const ctE = await contrato(cE, 'Sin factura real', { monto: 200, facturable: false }); const eE = await equipo('LQ-E', mono, ctE); await lec(eE, '2026-10-20', 500, 0);
  K = { entidad, cA, ctA, ctB, ctC, ctD, ctE };
});
after(async () => { await ctx.cerrar(); });

const liq = async (s) => (await s.llamar('GET', `/api/facturacion/liquidacion?periodo=${P}`)).json();
const fila = (r, id) => r.filas.find((f) => f.contrato_id === id);

test('el prorrateo cuenta los días desde el inicio del contrato', () => {
  assert.equal(factorProrateo('2026-01-01', '2026-10'), 1);
  assert.equal(factorProrateo('2026-11-02', '2026-10'), 0);
  assert.equal(Math.round(factorProrateo('2026-10-11', '2026-10') * 31), 21);
  assert.equal(factorProrateo('2026-02-15', '2026-02'), 14 / 28);
});

test('liquidación: abono + excedente por diferencia de lecturas, con franquicia', async () => {
  const s = await entrar(ctx.app, 'julia@demo.local'); const r = await liq(s);
  const a = fila(r, K.ctA);
  assert.equal(a.estado, 'completo'); assert.equal(a.consumo_negro, 1500); assert.equal(a.consumo_color, 150);
  assert.equal(a.excedente_negro, 500); assert.equal(a.excedente_color, 50);
  assert.equal(a.neto, 135, '100 de abono + 500×0,05 + 50×0,20'); assert.equal(a.neto_usd, 135);
  assert.deepEqual(a.items.map((i) => i.tipo), ['abono', 'excedente', 'excedente']);
});

test('liquidación: contrato que arrancó en el mes factura proporcional y con franquicia proporcional; el consumo parte del contador inicial', async () => {
  const b = fila(await liq(await entrar(ctx.app, 'julia@demo.local')), K.ctB);
  assert.equal(b.abono, 210); assert.equal(b.franquicia_negro, 677); assert.equal(b.consumo_negro, 900); assert.equal(b.excedente_negro, 223);
  assert.equal(b.neto, 221.15, '210 + 223×0,05');
});

test('liquidación: sin lectura del mes queda incompleto; en pesos se convierte a USD con la cotización; lo no facturable se marca', async () => {
  const r = await liq(await entrar(ctx.app, 'julia@demo.local'));
  const c = fila(r, K.ctC); assert.equal(c.estado, 'incompleto'); assert.deepEqual(c.faltan, ['LQ-C']);
  const d = fila(r, K.ctD); assert.equal(d.neto, 150000); assert.equal(d.neto_usd, 100, '150.000 / 1.500');
  assert.equal(fila(r, K.ctE).interno, true);
});

test('generar borradores: IVA 21%, lo incompleto se saltea, no se duplica, y lo interno no lleva IVA ni entidad', async () => {
  const s = await entrar(ctx.app, 'julia@demo.local');
  const ids = [K.ctA, K.ctB, K.ctC, K.ctD, K.ctE];
  const g = await s.llamar('POST', '/api/facturacion/generar', { periodo: P, contrato_ids: ids });
  assert.equal(g.statusCode, 201, g.body);
  const out = g.json(); assert.equal(out.creadas.length, 4); assert.deepEqual(out.saltadas.map((x) => x.motivo), ['faltan_lecturas']);
  const lista = (await s.llamar('GET', '/api/facturas?periodo=2026-10')).json().items;
  const a = lista.find((f) => f.cliente === 'Liquidación A SA');
  assert.equal(a.neto, 135); assert.equal(a.iva, 28.35); assert.equal(a.total, 163.35); assert.equal(a.estado, 'borrador'); assert.equal(a.clase, 'borrador');
  const d = lista.find((f) => f.cliente === 'Liquidación D SA'); assert.equal(d.moneda, 'ARS'); assert.equal(d.neto_usd, 100); assert.equal(d.total, 181500);
  const e = await ctx.db('facturas').where({ contrato_id: K.ctE }).first(); assert.equal(Number(e.iva), 0); assert.equal(e.entidad_facturante_id, null);
  const otra = (await s.llamar('POST', '/api/facturacion/generar', { periodo: P, contrato_ids: ids })).json();
  assert.equal(otra.creadas.length, 0); assert.equal(otra.saltadas.filter((x) => x.motivo === 'ya_facturado').length, 4);
});

test('emitir, cobrar parcial y totalmente; el cobro no puede superar el saldo ni mezclar monedas; con cobros no se anula', async () => {
  const s = await entrar(ctx.app, 'julia@demo.local');
  const fid = (await ctx.db('facturas').where({ contrato_id: K.ctA, periodo: P }).first()).id;
  assert.equal((await s.llamar('POST', '/api/cobros', { cliente_id: K.cA, importe: 10, moneda: 'USD', aplicaciones: [{ factura_id: fid, importe: 10 }] })).statusCode, 409, 'no se cobra un borrador');
  assert.equal((await s.llamar('POST', `/api/facturas/${fid}/emitir`, { numero: '00001-00000123', fecha_emision: '2099-01-01' })).statusCode, 400, 'sin fecha futura');
  assert.equal((await s.llamar('POST', `/api/facturas/${fid}/emitir`, { numero: '00001-00000123' })).statusCode, 200);
  assert.equal((await s.llamar('POST', `/api/facturas/${fid}/emitir`, {})).statusCode, 409, 'ya emitida');
  assert.equal((await s.llamar('POST', '/api/cobros', { cliente_id: K.cA, importe: 100, moneda: 'ARS', aplicaciones: [{ factura_id: fid, importe: 100 }] })).json().error, 'moneda_distinta');
  assert.equal((await s.llamar('POST', '/api/cobros', { cliente_id: K.cA, importe: 200, moneda: 'USD', aplicaciones: [{ factura_id: fid, importe: 200 }] })).json().error, 'supera_saldo');
  const c1 = await s.llamar('POST', '/api/cobros', { cliente_id: K.cA, importe: 100, moneda: 'USD', medio: 'transferencia', aplicaciones: [{ factura_id: fid, importe: 100 }] });
  assert.equal(c1.statusCode, 201, c1.body);
  assert.equal((await ctx.db('facturas').where({ id: fid }).first()).estado, 'cobrada_parcial');
  assert.equal((await s.llamar('POST', `/api/facturas/${fid}/anular`, { motivo: 'Error' })).json().error, 'tiene_cobros');
  const c2 = await s.llamar('POST', '/api/cobros', { cliente_id: K.cA, importe: 70, moneda: 'USD', aplicaciones: [{ factura_id: fid, importe: 63.35 }] });
  assert.equal(c2.json().sin_aplicar, 6.65);
  const det = (await s.llamar('GET', `/api/facturas/${fid}`)).json();
  assert.equal(det.estado, 'cobrada'); assert.equal(det.saldo, 0); assert.equal(det.cobros.length, 2); assert.equal(det.items.length, 3);
});

test('venta directa: factura con equipo, insumo y soporte juntos; se edita mientras es borrador y recalcula', async () => {
  const s = await entrar(ctx.app, 'julia@demo.local');
  const r = await s.llamar('POST', '/api/facturas', { cliente_id: K.cA, moneda: 'USD', items: [
    { tipo: 'equipo', descripcion: 'Venta de impresora HL-L8360', cantidad: 1, precio_unitario: 400 },
    { tipo: 'insumo', descripcion: 'Tóner negro', cantidad: 2, precio_unitario: 45.5 }] });
  assert.equal(r.statusCode, 201, r.body); const id = r.json().id;
  let f = (await s.llamar('GET', `/api/facturas/${id}`)).json(); assert.equal(f.neto, 491); assert.equal(f.iva, 103.11); assert.equal(f.neto_usd, 491);
  assert.equal((await s.llamar('POST', `/api/facturas/${id}/items`, { tipo: 'servicio', descripcion: 'Visita técnica', precio_unitario: 50 })).statusCode, 201);
  f = (await s.llamar('GET', `/api/facturas/${id}`)).json(); assert.equal(f.neto, 541); assert.equal(f.items.length, 3);
  assert.equal((await s.llamar('DELETE', `/api/facturas/${id}/items/${f.items[2].id}`)).statusCode, 200);
  assert.equal((await s.llamar('GET', `/api/facturas/${id}`)).json().neto, 491);
  await s.llamar('POST', `/api/facturas/${id}/emitir`, {});
  assert.equal((await s.llamar('POST', `/api/facturas/${id}/items`, { descripcion: 'Tarde', precio_unitario: 1 })).json().error, 'no_es_borrador');
  assert.equal((await s.llamar('DELETE', `/api/facturas/${id}`)).statusCode, 409, 'solo se borran borradores');
});

test('cobranzas: saldo por cliente en USD neto con antigüedad por tramos; lo interno va aparte', async () => {
  const s = await entrar(ctx.app, 'julia@demo.local');
  const fb = await ctx.db('facturas').where({ contrato_id: K.ctB, periodo: P }).first();
  const hace = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  await ctx.db('facturas').where({ id: fb.id }).update({ estado: 'emitida', fecha_emision: hace(75) });
  const fd = await ctx.db('facturas').where({ contrato_id: K.ctD, periodo: P }).first();
  await ctx.db('facturas').where({ id: fd.id }).update({ estado: 'emitida', fecha_emision: hace(10) });
  const fe = await ctx.db('facturas').where({ contrato_id: K.ctE, periodo: P }).first();
  await ctx.db('facturas').where({ id: fe.id }).update({ estado: 'emitida', fecha_emision: hace(5) });
  const c = (await s.llamar('GET', '/api/cobranzas')).json();
  const b = c.clientes.find((x) => x.cliente === 'Liquidación B SA'); const d = c.clientes.find((x) => x.cliente === 'Liquidación D SA');
  assert.equal(b.saldo_usd, 221.15); assert.equal(b.tramos['61-90'], 221.15); assert.ok(b.max_dias >= 75);
  assert.equal(d.saldo_usd, 100); assert.equal(d.tramos['0-30'], 100);
  assert.equal(c.sin_comprobante.facturas, 1); assert.equal(c.sin_comprobante.usd, 200);
  assert.ok(!c.clientes.some((x) => x.cliente === 'Liquidación E SA'));
  assert.equal(c.tramos['61-90'], 221.15);
});

test('permisos: solo Facturación y Dirección liquidan; el comercial ve importes de su cartera pero no emite; Atención no ve importes', async () => {
  const nico = await entrar(ctx.app, 'nicolas@demo.local');
  assert.equal((await nico.llamar('GET', '/api/facturacion/liquidacion?periodo=2026-10')).statusCode, 403);
  assert.equal((await nico.llamar('POST', '/api/cobros', { cliente_id: K.cA, importe: 1, moneda: 'USD', aplicaciones: [{ factura_id: 1, importe: 1 }] })).statusCode, 403);
  assert.equal((await nico.llamar('GET', '/api/facturas')).statusCode, 200);
  assert.equal((await nico.llamar('GET', '/api/facturas')).json().items.length, 0, 'ninguna es de su cartera');
  assert.equal((await (await entrar(ctx.app, 'sofia@demo.local')).llamar('GET', '/api/facturas')).statusCode, 403);
  assert.equal((await (await entrar(ctx.app, 'julia@demo.local')).llamar('GET', '/api/facturacion/liquidacion?periodo=2026-13')).statusCode, 400);
});
