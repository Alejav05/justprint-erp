import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar as entrarSinCache } from './ayuda.js';
import { hoy } from '../src/lib/fechas.js';
import { semaforo, sumarDias } from '../src/lib/cobranzas.js';

let ctx; let K; const ses = new Map();
const entrar = async (email) => { if (!ses.has(email)) ses.set(email, await entrarSinCache(ctx.app, email)); return ses.get(email); };
const hace = (d) => sumarDias(hoy(), -d);

before(async () => {
  ctx = await montar(); const db = ctx.db;
  const entidad = (await db('entidades_facturantes').insert({ razon_social: 'Europa Haus S.A.S.', cuit: '30-71646173-0' }))[0];
  const nico = (await db('usuarios').where({ email: 'nicolas@demo.local' }).first()).id;
  const cliente = async (n, conComercial = true) => {
    const id = (await db('clientes').insert({ razon_social: n, estado: 'activo' }))[0];
    if (conComercial) await db('cartera_asignaciones').insert({ cliente_id: id, usuario_id: nico, desde: '2026-01-01', motivo: 'test' });
    return id;
  };
  const factura = async (cid, ctId, emision, extra = {}) => (await db('facturas').insert({ cliente_id: cid, contrato_id: ctId, entidad_facturante_id: entidad, periodo: '2026-09', moneda: 'USD',
    neto: 100, iva: 21, total: 121, neto_usd: 100, estado: 'emitida', fecha_emision: emision, ...extra }))[0];
  const c1 = await cliente('Cliente Uno'); const ct1 = (await db('contratos').insert({ cliente_id: c1, nombre: 'Plazo 10', estado: 'vigente', plazo_pago_dias: 10 }))[0];
  const c2 = await cliente('Cliente Dos', false); const ct2 = (await db('contratos').insert({ cliente_id: c2, nombre: 'Sin plazo', estado: 'vigente' }))[0];
  K = { entidad, nico, c1, ct1, c2, ct2,
    verde: await factura(c1, ct1, hace(5)),            // vence en 5 días
    amarilla: await factura(c1, ct1, hace(20)),        // vencida hace 10 (plazo 10)
    roja: await factura(c1, ct1, hace(40)),            // vencida hace 30
    defecto: await factura(c2, ct2, hace(10)) };       // plazo por defecto 15: vence en 5
});
after(async () => { await ctx.cerrar(); });

test('semáforo: verde dentro del plazo, amarillo en la gracia, rojo después', () => {
  const h = '2026-10-30'; const f = (e, p) => ({ fecha_emision: e, plazo_pago_dias: p });
  assert.equal(semaforo(f('2026-10-20', 10), h).color, 'verde');        // vence hoy
  assert.equal(semaforo(f('2026-10-19', 10), h).color, 'amarillo');     // 1 día vencida
  assert.equal(semaforo(f('2026-10-05', 10), h).color, 'amarillo');     // 15 días vencida: último de la gracia
  assert.equal(semaforo(f('2026-10-04', 10), h).color, 'rojo');         // 16 días
  assert.equal(semaforo({ fecha_emision: '2026-10-20', plazo_pago_dias: 10, vencimiento: '2026-11-15' }, h).color, 'verde', 'el vencimiento fijado a mano manda');
});

test('el plazo sale del contrato; sin plazo se usa el de fábrica (15)', async () => {
  const s = await entrar('julia@demo.local'); const r = (await s.llamar('GET', '/api/cobranzas/semaforo')).json();
  const por = (id) => r.items.find((i) => i.id === id);
  assert.equal(por(K.verde).color, 'verde'); assert.equal(por(K.verde).plazo, 10); assert.equal(por(K.verde).dias_vencida, -5);
  assert.equal(por(K.amarilla).color, 'amarillo'); assert.equal(por(K.amarilla).dias_vencida, 10);
  assert.equal(por(K.roja).color, 'rojo');
  assert.equal(por(K.defecto).plazo, 15); assert.equal(por(K.defecto).color, 'verde');
  assert.deepEqual(r.items.slice(0, 3).map((i) => i.color), ['rojo', 'amarillo', 'verde'], 'ordenadas por urgencia');
  assert.equal(r.resumen.rojo.n, 1); assert.equal(r.resumen.amarillo.usd, 100); assert.equal(r.resumen.total_usd, 400);
});

test('al emitir, la factura copia el plazo del contrato y calcula el vencimiento desde la fecha de emisión', async () => {
  const s = await entrar('julia@demo.local'); const dir = await entrar('direccion@demo.local'); const db = ctx.db;
  const id = (await db('facturas').insert({ cliente_id: K.c1, contrato_id: K.ct1, entidad_facturante_id: K.entidad, periodo: '2026-10', moneda: 'USD', neto: 10, iva: 2, total: 12, neto_usd: 10, estado: 'borrador', plazo_pago_dias: 10 }))[0];
  await db('factura_items').insert({ factura_id: id, tipo: 'abono', descripcion: 'Abono', cantidad: 1, precio_unitario: 10, alicuota_iva: 21, subtotal: 10 });
  const r = await s.llamar('POST', `/api/facturas/${id}/emitir`, { fecha_emision: hace(3) });
  assert.equal(r.statusCode, 200);
  const f = await db('facturas').where({ id }).first();
  assert.equal(f.plazo_pago_dias, 10); assert.equal(String(f.vencimiento).slice(0, 10), sumarDias(hace(3), 10));
  // cambiar el plazo del contrato después no mueve las facturas ya emitidas
  assert.equal((await s.llamar('PATCH', `/api/contratos/${K.ct1}`, { plazo_pago_dias: 30 })).statusCode, 403, 'facturación no cambia contratos');
  assert.equal((await dir.llamar('PATCH', `/api/contratos/${K.ct1}`, { plazo_pago_dias: 30 })).statusCode, 200);
  assert.equal((await db('facturas').where({ id }).first()).plazo_pago_dias, 10);
});

test('corregir la fecha de emisión recalcula el vencimiento', async () => {
  const s = await entrar('julia@demo.local');
  const r = await s.llamar('PATCH', `/api/facturas/${K.verde}/emision`, { fecha_emision: hace(30) });
  assert.equal(r.statusCode, 200); assert.equal(r.json().vencimiento, sumarDias(hace(30), 30), 'sin copia propia toma el plazo vigente del contrato (ahora 30)');
  assert.equal((await s.llamar('PATCH', `/api/facturas/${K.verde}/emision`, { fecha_emision: sumarDias(hoy(), 2) })).statusCode, 400);
  await s.llamar('PATCH', `/api/facturas/${K.verde}/emision`, { fecha_emision: hace(5) });
  await ctx.db('contratos').where({ id: K.ct1 }).update({ plazo_pago_dias: 10 });
  await ctx.db('facturas').where({ id: K.verde }).update({ plazo_pago_dias: 10, vencimiento: sumarDias(hace(5), 10) });
});

test('gestión: queda en el historial, fija el seguimiento y exige fecha en una promesa', async () => {
  const s = await entrar('julia@demo.local');
  assert.equal((await s.llamar('POST', `/api/cobranzas/facturas/${K.amarilla}/gestiones`, { tipo: 'promesa' })).statusCode, 400);
  const prox = sumarDias(hoy(), 3);
  assert.equal((await s.llamar('POST', `/api/cobranzas/facturas/${K.amarilla}/gestiones`, { tipo: 'promesa', resultado: 'Paga el viernes', proxima_gestion: prox })).statusCode, 201);
  assert.equal((await s.llamar('POST', `/api/cobranzas/facturas/${K.amarilla}/gestiones`, { tipo: 'llamada', proxima_gestion: sumarDias(hoy(), -1) })).statusCode, 400);
  const d = (await s.llamar('GET', `/api/cobranzas/facturas/${K.amarilla}`)).json();
  assert.equal(d.estado_gestion, 'promesa'); assert.equal(d.proxima_gestion, prox); assert.equal(d.gestiones.length, 1); assert.equal(d.gestiones[0].usuario.startsWith('Julia'), true);
});

test('escalar: pasa al comercial de la cuenta, le avisa, y solo él la ve; no se puede sin comercial', async () => {
  const julia = await entrar('julia@demo.local'); const nico = await entrar('nicolas@demo.local'); const valen = await entrar('valentina@demo.local');
  assert.equal((await julia.llamar('POST', `/api/cobranzas/facturas/${K.defecto}/escalar`, {})).json().error, 'sin_comercial');
  assert.equal((await nico.llamar('POST', `/api/cobranzas/facturas/${K.roja}/escalar`, {})).statusCode, 403, 'el comercial no escala');
  assert.equal((await julia.llamar('POST', `/api/cobranzas/facturas/${K.roja}/escalar`, { notas: 'No contestan hace 3 semanas' })).statusCode, 200);
  assert.equal((await julia.llamar('POST', `/api/cobranzas/facturas/${K.roja}/escalar`, {})).json().error, 'ya_escalada');
  const n = await ctx.db('notificaciones').where({ usuario_id: K.nico, ref_tipo: 'factura', ref_id: K.roja });
  assert.equal(n.length, 1);
  const lista = (await nico.llamar('GET', '/api/cobranzas/semaforo')).json();
  assert.equal(lista.solo_escaladas, true); assert.deepEqual(lista.items.map((i) => i.id), [K.roja], 'el comercial ve solo lo que le escalaron');
  assert.equal((await valen.llamar('GET', '/api/cobranzas/semaforo')).json().items.length, 0);
  assert.equal((await nico.llamar('POST', `/api/cobranzas/facturas/${K.roja}/gestiones`, { tipo: 'llamada', resultado: 'Hablé con el dueño' })).statusCode, 201);
  assert.equal((await nico.llamar('POST', `/api/cobranzas/facturas/${K.verde}/gestiones`, { tipo: 'nota' })).statusCode, 404, 'lo no escalado no es suyo');
});

test('retomar: vuelve a cobranzas y deja de ser del comercial', async () => {
  const julia = await entrar('julia@demo.local'); const nico = await entrar('nicolas@demo.local');
  assert.equal((await nico.llamar('POST', `/api/cobranzas/facturas/${K.roja}/retomar`, {})).statusCode, 200);
  const d = (await julia.llamar('GET', `/api/cobranzas/facturas/${K.roja}`)).json();
  assert.equal(d.estado_gestion, 'en_gestion'); assert.equal(d.escalada_a, null);
  assert.deepEqual(d.gestiones.map((g) => g.tipo), ['retomada', 'llamada', 'escalada']);
  assert.equal((await nico.llamar('GET', '/api/cobranzas/semaforo')).json().items.length, 0);
});

test('cobrar saca la factura del semáforo', async () => {
  const julia = await entrar('julia@demo.local');
  assert.equal((await julia.llamar('POST', '/api/cobros', { cliente_id: K.c2, importe: 121, moneda: 'USD', aplicaciones: [{ factura_id: K.defecto, importe: 121 }] })).statusCode, 201);
  const r = (await julia.llamar('GET', '/api/cobranzas/semaforo')).json();
  assert.ok(!r.items.some((i) => i.id === K.defecto));
});

test('negocio del cliente: ingresos y costos por mes, punto de equilibrio y lo por cobrar aparte', async () => {
  const db = ctx.db; const s = await entrar('direccion@demo.local');
  const c = (await db('clientes').insert({ razon_social: 'Rentable SA', estado: 'activo' }))[0];
  const fac = (emision, usd, extra = {}) => db('facturas').insert({ cliente_id: c, entidad_facturante_id: K.entidad, periodo: emision.slice(0, 7), moneda: 'USD', neto: usd, iva: 0, total: usd, neto_usd: usd, estado: 'cobrada', fecha_emision: emision, ...extra });
  await fac('2026-06-10', 100); await fac('2026-07-10', 100); await fac('2026-08-10', 100); await fac('2026-09-10', 100, { estado: 'emitida' });
  const costo = (fecha, usd) => db('costos').insert({ cliente_id: c, fecha, concepto: 'Equipo', importe: usd, moneda: 'USD', importe_usd: usd });
  await costo('2026-06-01', 250); await costo('2026-08-15', 50);
  const r = (await s.llamar('GET', `/api/clientes/${c}/negocio`)).json();
  assert.deepEqual(r.serie.slice(0, 4).map((x) => x.mes), ['2026-06', '2026-07', '2026-08', '2026-09']);
  assert.equal(r.serie[0].acum_resultado, -150); assert.equal(r.punto_equilibrio, '2026-09', 'acum. ingresos 400 >= egresos 300 recién en septiembre');
  assert.equal(r.totales.ingresos, 400); assert.equal(r.totales.egresos, 300); assert.equal(r.totales.resultado, 100); assert.equal(r.totales.margen, 25);
  assert.equal(r.por_cobrar.usd, 100, 'la de septiembre sigue sin cobrarse pero cuenta como ingreso'); assert.equal(r.por_cobrar.facturas, 1);
  assert.equal((await (await entrar('nicolas@demo.local')).llamar('GET', `/api/clientes/${c}/negocio`)).statusCode, 403, 'el comercial no ve costos');
});

test('alertas: factura vencida usa el semáforo y avisa al comercial solo si se escaló', async () => {
  const { ejecutarAlertas } = await import('../src/lib/alertas.js');
  const r = await ejecutarAlertas(ctx.db);
  const ev = await ctx.db('alertas_eventos').select('regla', 'entidad');
  assert.ok(ev.some((e) => e.regla === 'factura_vencida' && e.entidad === `factura:${K.amarilla}`));
  assert.ok(!ev.some((e) => e.regla === 'factura_vencida' && e.entidad === `factura:${K.verde}`), 'una verde no avisa');
  assert.ok(r.eventos > 0);
});
