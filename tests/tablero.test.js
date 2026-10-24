import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';
import { hoy } from '../src/lib/fechas.js';

let ctx;
before(async () => { ctx = await montar(); });
after(async () => { await ctx.cerrar(); });

test('solo Dirección ve el tablero de Dirección', async () => {
  for (const email of ['head.comercial@demo.local', 'nicolas@demo.local', 'sofia@demo.local', 'julia@demo.local']) {
    const s = await entrar(ctx.app, email);
    assert.equal((await s.llamar('GET', '/api/tableros/direccion')).statusCode, 403, email);
  }
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  assert.equal((await dir.llamar('GET', '/api/tableros/direccion')).statusCode, 200);
});

test('facturado, cobrado, por cobrar y sin comprobante se calculan por separado, en USD neto', async () => {
  const cliente = (await ctx.db('clientes').where({ razon_social: 'Cliente Prueba SRL' }).first()).id;
  const entidad = (await ctx.db('entidades_facturantes').insert({ razon_social: 'Europa Haus S.A.S.', cuit: '30-71646173-0' }))[0];
  const periodo = hoy().slice(0, 7);
  const F = async (extra) => (await ctx.db('facturas').insert({ cliente_id: cliente, periodo, moneda: 'USD', neto: 100, iva: 21, total: 121, neto_usd: 100, ...extra }))[0];
  const cobrada = await F({ estado: 'cobrada', entidad_facturante_id: entidad });
  const parcial = await F({ estado: 'cobrada_parcial', entidad_facturante_id: entidad });
  await F({ estado: 'emitida', entidad_facturante_id: entidad });
  await F({ estado: 'borrador' });
  await F({ estado: 'cobrada', entidad_facturante_id: null, iva: 0, total: 100 }); // cobro sin comprobante
  const [cobro] = await ctx.db('cobros').insert({ cliente_id: cliente, fecha_cobro: hoy(), importe: 121 + 60.5, moneda: 'USD' });
  await ctx.db('cobro_aplicaciones').insert([{ cobro_id: cobro, factura_id: cobrada, importe: 121 }, { cobro_id: cobro, factura_id: parcial, importe: 60.5 }]);

  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const t = (await dir.llamar('GET', '/api/tableros/direccion')).json();
  const mes = t.serie.at(-1);
  assert.equal(mes.periodo, periodo);
  assert.equal(mes.facturado, 300, 'cobrada + parcial + emitida; el borrador y el interno no cuentan');
  assert.equal(mes.cobrado, 150, 'una completa y la mitad de la parcial');
  assert.equal(mes.sin_comprobante, 100);
  assert.equal(t.por_cobrar.usd, 150);
  assert.equal(t.por_cobrar.facturas, 2);
  assert.equal(t.borradores.facturas, 1);
  assert.equal(t.serie.length, 12);
  assert.ok(t.alertas.some((a) => /por cobrar/.test(a.texto)));
  assert.ok(t.tickets.abiertos >= 1);
});

test('la app sirve la pantalla y los archivos estáticos con las cabeceras de seguridad', async () => {
  const r = await ctx.app.inject({ method: 'GET', url: '/' });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /html/);
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/app.js' })).statusCode, 200);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/no-existe' })).statusCode, 404);
});

test('el abono de un contrato en pesos se muestra en dólares de referencia, nunca como si los pesos fueran USD', async () => {
  const [cid] = await ctx.db('clientes').insert({ razon_social: 'Cliente en Pesos SA', estado: 'activo' });
  const [contrato] = await ctx.db('contratos').insert({ cliente_id: cid, nombre: 'General', estado: 'vigente', moneda: 'ARS', fecha_inicio: '2025-01-01' });
  await ctx.db('contrato_condiciones').insert({ contrato_id: contrato, vigente_desde: '2025-01-01', monto_mensual: 566904.59 });
  await ctx.db('facturas').insert({ cliente_id: cid, contrato_id: contrato, periodo: '2026-09', moneda: 'ARS', neto: 884879.59, iva: 0, total: 884879.59, neto_usd: 575, estado: 'cobrada' });
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const fila = (await dir.llamar('GET', '/api/clientes?q=Pesos')).json().clientes[0];
  assert.equal(fila.abono_mensual_usd, 575);
  await ctx.db('contrato_condiciones').where({ contrato_id: contrato }).update({ facturable: false });
  const fila2 = (await dir.llamar('GET', '/api/clientes?q=Pesos')).json().clientes[0];
  assert.equal(fila2.abono_mensual_usd, 0);
  assert.equal(fila2.abono_no_facturable_usd, 575);
});
