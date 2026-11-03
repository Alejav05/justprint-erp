import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';
import { reemplazarCanal } from '../src/lib/canales.js';

let ctx; let cli; let otro; let fEmitida; let fOtro; let fBorrador;
const PDF = (x = '') => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n% ${x}\n%%EOF`);
before(async () => {
  ctx = await montar();
  reemplazarCanal('mail', { configurado: () => false, enviar: async () => {} });
  cli = (await ctx.db('contratos').where({ estado: 'vigente' }).first()).cliente_id;
  otro = (await ctx.db('clientes').whereNot({ id: cli }).first()).id;
  const base = { periodo: '2026-09', moneda: 'USD', neto: 85, iva: 17.85, total: 102.85 };
  [fEmitida] = await ctx.db('facturas').insert({ ...base, cliente_id: cli, numero: '0001-00000042', tipo_comprobante: 'A', fecha_emision: '2026-10-01', vencimiento: '2026-10-15', estado: 'emitida' });
  [fOtro] = await ctx.db('facturas').insert({ ...base, cliente_id: otro, numero: '0001-00000099', fecha_emision: '2026-10-01', estado: 'emitida' });
  [fBorrador] = await ctx.db('facturas').insert({ ...base, cliente_id: cli, periodo: '2026-10', estado: 'borrador' });
  fEmitida = fEmitida.id ?? fEmitida; fOtro = fOtro.id ?? fOtro; fBorrador = fBorrador.id ?? fBorrador;
});
after(async () => { await ctx.cerrar(); });

const subir = async (id, pdf, usuario = 'direccion@demo.local') => {
  const s = await entrar(ctx.app, usuario);
  return ctx.app.inject({ method: 'POST', url: `/api/facturas/${id}/comprobante`, payload: pdf, headers: { 'content-type': 'application/pdf', 'x-nombre-archivo': encodeURIComponent('Factura A 0001-00000042.pdf') }, cookies: { jp_sid: s.cookie.value } });
};

test('se sube el PDF de una factura, se ve en el ERP, el cliente lo descarga en su portal y se puede reemplazar o quitar', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  assert.equal((await subir(fEmitida, PDF('uno'))).statusCode, 201);
  const det = (await dir.llamar('GET', `/api/facturas/${fEmitida}`)).json();
  assert.equal(det.comprobante.nombre, 'Factura A 0001-00000042.pdf');
  assert.ok((await dir.llamar('GET', '/api/facturas')).json().items.find((x) => x.id === fEmitida).tiene_comprobante);
  const pdf = await dir.llamar('GET', `/api/facturas/${fEmitida}/comprobante`);
  assert.equal(pdf.statusCode, 200); assert.match(pdf.headers['content-type'], /pdf/); assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');

  // portal
  const r = await dir.llamar('POST', `/api/clientes/${cli}/portal`, { nombre: 'Marcela', email: 'marcela@cliente.com' });
  const tk = r.json().url.match(/#\/entrar\/([\w-]+)/)[1];
  const e = await ctx.app.inject({ method: 'POST', url: '/portal/api/entrar', payload: { token: tk } });
  const ck = { jp_portal: e.cookies.find((c) => c.name === 'jp_portal').value };
  const inicio = (await ctx.app.inject({ method: 'GET', url: '/portal/api/inicio', cookies: ck })).json();
  assert.equal(inicio.facturas.find((x) => x.id === fEmitida).comprobante, true);
  const d = await ctx.app.inject({ method: 'GET', url: `/portal/api/facturas/${fEmitida}/comprobante`, cookies: ck });
  assert.equal(d.statusCode, 200); assert.match(d.headers['content-disposition'], /attachment; filename="Factura_0001-00000042\.pdf"/);
  // de otro cliente o borrador: no
  await subir(fOtro, PDF('otro')); await subir(fBorrador, PDF('borrador'));
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/portal/api/facturas/${fOtro}/comprobante`, cookies: ck })).statusCode, 404);
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/portal/api/facturas/${fBorrador}/comprobante`, cookies: ck })).statusCode, 404);
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/portal/api/facturas/${fEmitida}/comprobante` })).statusCode, 401);

  // reemplazo y borrado
  const re = await subir(fEmitida, PDF('dos')); assert.equal(re.json().reemplaza, true);
  assert.equal((await dir.llamar('DELETE', `/api/facturas/${fEmitida}/comprobante`)).statusCode, 200);
  assert.equal((await dir.llamar('GET', `/api/facturas/${fEmitida}/comprobante`)).statusCode, 404);
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/portal/api/facturas/${fEmitida}/comprobante`, cookies: ck })).statusCode, 404);
});

test('solo se aceptan PDF, y solo quien emite facturas puede subirlos', async () => {
  assert.equal((await subir(fEmitida, Buffer.from('no soy un pdf, soy texto largo'))).json().error, 'no_es_pdf');
  assert.equal((await subir(fEmitida, PDF('x'), 'matias@demo.local')).statusCode, 403);
  await ctx.db('facturas').where({ id: fEmitida }).update({ estado: 'anulada' });
  assert.equal((await subir(fEmitida, PDF('y'))).statusCode, 409);
});
