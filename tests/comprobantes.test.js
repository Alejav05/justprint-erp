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

test('asignar emisor a una factura emitida la convierte en comprobante y entra en Cobranzas', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const ent = (await ctx.db('entidades_facturantes').where({ activa: true }).first()).id;
  const base = { periodo: '2026-10', moneda: 'USD', neto: 316, iva: 66.36, total: 382.36 };
  let [id] = await ctx.db('facturas').insert({ ...base, cliente_id: cli, numero: 'X-1', fecha_emision: '2026-10-31', vencimiento: '2026-11-30', estado: 'emitida' });
  id = id.id ?? id;
  assert.equal((await dir.llamar('GET', `/api/facturas/${id}`)).json().clase, 'interno');
  assert.equal((await dir.llamar('PATCH', `/api/facturas/${id}/emisor`, { entidad_facturante_id: 999999 })).statusCode, 400);
  assert.equal((await dir.llamar('PATCH', `/api/facturas/${fBorrador}/emisor`, { entidad_facturante_id: ent })).statusCode, 409);
  assert.equal((await dir.llamar('PATCH', `/api/facturas/${id}/emisor`, { entidad_facturante_id: ent })).statusCode, 200);
  assert.equal((await dir.llamar('GET', `/api/facturas/${id}`)).json().clase, 'fiscal');
});

test('al subir el PDF con aviso, sale un mail con el adjunto a los contactos de facturación y queda registrado', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const enviados = [];
  reemplazarCanal('mail', { configurado: () => true, enviar: async (m) => { enviados.push(m); } });
  await ctx.db('contactos').insert([
    { cliente_id: cli, nombre: 'Marta Gómez', roles: JSON.stringify(['facturacion']), telefonos: '[]', emails: JSON.stringify([{ tipo: 'laboral', direccion: 'otro@cli.com' }, { tipo: 'facturacion', direccion: 'Pagos@Cli.com' }]), estado: 'activo' },
    { cliente_id: cli, nombre: 'Luis', roles: JSON.stringify(['facturacion']), telefonos: '[]', emails: JSON.stringify([{ tipo: 'laboral', direccion: 'pagos@cli.com' }]), estado: 'activo' },
    { cliente_id: cli, nombre: 'Sin rol', roles: JSON.stringify(['decisor']), telefonos: '[]', emails: JSON.stringify([{ tipo: 'laboral', direccion: 'jefe@cli.com' }]), estado: 'activo' },
  ]);
  const s = await entrar(ctx.app, 'direccion@demo.local');
  let [fx] = await ctx.db('facturas').insert({ cliente_id: cli, periodo: '2026-09', moneda: 'USD', neto: 85, iva: 17.85, total: 102.85, numero: 'AV-1', vencimiento: '2026-10-15', estado: 'emitida' }); fx = fx.id ?? fx;
  const subirA = (id, avisar) => ctx.app.inject({ method: 'POST', url: `/api/facturas/${id}/comprobante`, payload: PDF('aviso'), headers: { 'content-type': 'application/pdf', 'x-avisar': avisar, 'x-nombre-archivo': 'f.pdf' }, cookies: { jp_sid: s.cookie.value } });
  const sin = await subirA(fx, '0');
  assert.equal(sin.json().aviso, null); assert.equal(enviados.length, 0);
  const r = await subirA(fx, '1');
  assert.equal(r.json().aviso.estado, 'enviado');
  assert.deepEqual(r.json().aviso.destinatarios, ['pagos@cli.com']); // sin duplicados, solo rol facturación
  assert.equal(enviados.length, 1); assert.equal(enviados[0].cuenta, 'facturacion'); assert.equal(enviados[0].attachments[0].contentType, 'application/pdf');
  assert.match(enviados[0].text, /^Hola Marta!/); assert.match(enviados[0].subject, /septiembre de 2026/);
  const det = (await dir.llamar('GET', `/api/facturas/${fx}`)).json();
  assert.equal(det.avisos[0].estado, 'enviado'); assert.deepEqual(det.destinatarios_aviso, ['pagos@cli.com']);
  assert.equal((await dir.llamar('POST', `/api/facturas/${fx}/avisar`)).json().estado, 'enviado'); assert.equal(enviados.length, 2);
  assert.equal((await dir.llamar('POST', `/api/facturas/${fBorrador}/avisar`)).statusCode, 409);
  // sin mail configurado no rompe la carga
  reemplazarCanal('mail', { configurado: () => false, enviar: async () => {} });
  assert.equal((await subirA(fx, '1')).json().aviso.estado, 'sin_mail');
});
