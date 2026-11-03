import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';
import { reemplazarCanal } from '../src/lib/canales.js';

let ctx; let cli; let otro; const enviados = [];
before(async () => {
  ctx = await montar();
  const k = await ctx.db('contratos').where({ estado: 'vigente' }).first();
  cli = k.cliente_id;
  otro = (await ctx.db('clientes').whereNot({ id: cli }).first()).id;
  reemplazarCanal('mail', { configurado: () => true, enviar: async (m) => { enviados.push(m); } });
});
after(async () => { await ctx.cerrar(); });

const tokenDe = (m) => m.text.match(/#\/entrar\/([\w-]+)/)[1];
const portal = (cookie) => ({
  get: (url) => ctx.app.inject({ method: 'GET', url, cookies: cookie ? { jp_portal: cookie } : {} }),
  post: (url, payload) => ctx.app.inject({ method: 'POST', url, payload, cookies: cookie ? { jp_portal: cookie } : {} }),
});
const cookieDe = (r) => r.cookies.find((c) => c.name === 'jp_portal')?.value;

test('invitar, entrar por el enlace, elegir contraseña y volver a entrar con mail y contraseña', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const r = await dir.llamar('POST', `/api/clientes/${cli}/portal`, { nombre: 'Marcela Ferrari', email: 'Marcela@Cliente.com' });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().enviado, true); assert.equal(r.json().url, undefined);
  const mail = enviados.at(-1); assert.equal(mail.to, 'marcela@cliente.com'); assert.match(mail.text, /\/portal\/#\/entrar\//);
  // repetir el mail: no se duplica
  assert.equal((await dir.llamar('POST', `/api/clientes/${cli}/portal`, { nombre: 'Otra', email: 'marcela@cliente.com' })).json().error, 'email_en_uso');

  const token = tokenDe(mail);
  assert.equal((await portal().get('/portal/api/inicio')).statusCode, 401);
  const e = await portal().post('/portal/api/entrar', { token });
  assert.equal(e.statusCode, 200); assert.equal(e.json().necesita_clave, true);
  const ck = cookieDe(e); assert.ok(ck);
  // el enlace sirve una sola vez
  assert.equal((await portal().post('/portal/api/entrar', { token })).statusCode, 410);
  // sin contraseña todavía no entra con mail y contraseña
  assert.equal((await portal().post('/portal/api/login', { email: 'marcela@cliente.com', password: 'Cualquiera123' })).statusCode, 401);

  const inicio = await portal(ck).get('/portal/api/inicio');
  assert.equal(inicio.statusCode, 200, inicio.body);
  const d = inicio.json();
  assert.equal(d.usuario.vista, false); assert.ok(d.cliente.nombre); assert.ok(d.contratos.length >= 1); assert.ok(Array.isArray(d.equipos));
  assert.ok(!JSON.stringify(d).includes('costo')); // nada de costos
  assert.equal(d.periodos.length, 12);

  assert.equal((await portal(ck).post('/portal/api/clave', { clave: 'corta' })).statusCode, 400);
  assert.equal((await portal(ck).post('/portal/api/clave', { clave: 'Clave-Segura-2026' })).statusCode, 200);
  const l = await portal().post('/portal/api/login', { email: 'MARCELA@cliente.com', password: 'Clave-Segura-2026' });
  assert.equal(l.statusCode, 200); assert.equal((await portal(cookieDe(l)).get('/portal/api/inicio')).statusCode, 200);
  assert.equal((await portal().post('/portal/api/login', { email: 'marcela@cliente.com', password: 'mala-clave-1234' })).statusCode, 401);
  assert.equal((await ctx.db('portal_accesos').where({ email: 'marcela@cliente.com' }).first()).estado, 'activo');
});

test('pedir enlace: responde siempre lo mismo y solo manda mail a quien tiene acceso', async () => {
  await ctx.db('portal_enlaces').update({ created_at: '2026-01-01 00:00:00' }); // la invitación de recién no cuenta para el límite de un pedido por minuto
  const antes = enviados.length;
  const a = await portal().post('/portal/api/enlace', { email: 'nadie@nada.com' }); assert.equal(a.statusCode, 200); assert.deepEqual(a.json(), { ok: true });
  assert.equal(enviados.length, antes);
  const b = await portal().post('/portal/api/enlace', { email: 'marcela@cliente.com' }); assert.deepEqual(b.json(), { ok: true });
  assert.equal(enviados.length, antes + 1);
  // un segundo pedido enseguida no manda otro (no se usa para inundar la casilla)
  await portal().post('/portal/api/enlace', { email: 'marcela@cliente.com' }); assert.equal(enviados.length, antes + 1);
  const l = await portal().post('/portal/api/entrar', { token: tokenDe(enviados.at(-1)) }); assert.equal(l.json().necesita_clave, false);
});

test('baja y alta: la baja corta las sesiones al instante y bloquea el ingreso', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const a = await ctx.db('portal_accesos').where({ email: 'marcela@cliente.com' }).first();
  const l = await portal().post('/portal/api/login', { email: a.email, password: 'Clave-Segura-2026' }); const ck = cookieDe(l);
  assert.equal((await dir.llamar('POST', `/api/portal/accesos/${a.id}/baja`)).statusCode, 200);
  assert.equal((await portal(ck).get('/portal/api/inicio')).statusCode, 401);
  assert.equal((await portal().post('/portal/api/login', { email: a.email, password: 'Clave-Segura-2026' })).statusCode, 401);
  const antes = enviados.length; await portal().post('/portal/api/enlace', { email: a.email }); assert.equal(enviados.length, antes);
  assert.equal((await dir.llamar('POST', `/api/portal/accesos/${a.id}/ver-como`)).statusCode, 409);
  assert.equal((await dir.llamar('POST', `/api/portal/accesos/${a.id}/alta`)).json().estado, 'activo');
  assert.equal((await portal().post('/portal/api/login', { email: a.email, password: 'Clave-Segura-2026' })).statusCode, 200);
});

test('ver como cliente: entra en solo lectura y el enlace vale una vez', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const a = await ctx.db('portal_accesos').where({ email: 'marcela@cliente.com' }).first();
  const { url } = (await dir.llamar('POST', `/api/portal/accesos/${a.id}/ver-como`)).json();
  const token = url.match(/#\/entrar\/([\w-]+)/)[1];
  const e = await portal().post('/portal/api/entrar', { token }); assert.equal(e.json().vista, true); assert.equal(e.json().necesita_clave, false);
  const ck = cookieDe(e);
  assert.equal((await portal(ck).get('/portal/api/inicio')).json().usuario.vista, true);
  assert.equal((await portal(ck).post('/portal/api/clave', { clave: 'Otra-Clave-12345' })).statusCode, 403);
  assert.equal((await portal(ck).post('/portal/api/encuesta', { remito_id: 1, puntaje: 5 })).statusCode, 403);
  assert.equal((await portal().post('/portal/api/entrar', { token })).statusCode, 410);
  assert.ok(await ctx.db('audit_log').where({ tabla: 'portal_accesos' }).where('despues', 'like', '%portal_ver_como%').first());
});

test('el cliente califica solo sus conformidades, una vez', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const mk = (cliente_id, numero) => ctx.db('remitos').insert({ numero, cliente_id, tipo: 'servicio', fecha: '2026-10-28', estado: 'firmado', token: numero.padEnd(32, 'a') }).then((x) => x[0].id ?? x[0]);
  const mio = await mk(cli, 'TK9001'); const ajeno = await mk(otro, 'TK9002');
  const l = await portal().post('/portal/api/login', { email: 'marcela@cliente.com', password: 'Clave-Segura-2026' }); const ck = cookieDe(l);
  const d = (await portal(ck).get('/portal/api/inicio')).json();
  assert.ok(d.conformidades.some((c) => c.id === mio && c.puntaje == null)); assert.ok(!d.conformidades.some((c) => c.id === ajeno));
  assert.equal((await portal(ck).post('/portal/api/encuesta', { remito_id: ajeno, puntaje: 5 })).statusCode, 404);
  assert.equal((await portal(ck).post('/portal/api/encuesta', { remito_id: mio, puntaje: 4, aspectos: ['trato'], comentario: 'Muy bien' })).statusCode, 200);
  assert.equal((await portal(ck).post('/portal/api/encuesta', { remito_id: mio, puntaje: 1 })).statusCode, 409);
  assert.equal((await ctx.db('encuestas').where({ remito_id: mio }).first()).origen, 'portal');
  assert.equal((await portal(ck).get('/portal/api/inicio')).json().conformidades.find((c) => c.id === mio).puntaje, 4);
  void dir;
});

test('permisos: solo quien tiene portal.gestionar administra accesos, y solo de clientes de su alcance', async () => {
  const tec = await entrar(ctx.app, 'matias@demo.local');
  assert.equal((await tec.llamar('GET', `/api/clientes/${cli}/portal`)).statusCode, 403);
  assert.equal((await tec.llamar('POST', `/api/clientes/${cli}/portal`, { nombre: 'X Y', email: 'x@y.com' })).statusCode, 403);
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const lista = (await dir.llamar('GET', `/api/clientes/${cli}/portal`)).json();
  assert.equal(lista.accesos.length, 1); assert.equal(lista.mail_configurado, true);
  assert.equal(JSON.stringify(lista).includes('password'), false);
});

test('sin mail configurado, la invitación devuelve el enlace para mandarlo a mano', async () => {
  reemplazarCanal('mail', { configurado: () => false, enviar: async () => { throw new Error('no'); } });
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const r = await dir.llamar('POST', `/api/clientes/${cli}/portal`, { nombre: 'Sin Mail', email: 'sinmail@cliente.com' });
  assert.equal(r.statusCode, 201); assert.equal(r.json().enviado, false); assert.match(r.json().url, /\/portal\/#\/entrar\/[\w-]+$/);
  assert.equal((await portal().post('/portal/api/entrar', { token: r.json().url.split('/').pop() })).statusCode, 200);
});

test('eliminar un acceso: solo si no está activo; borra enlaces y sesiones', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const act = await ctx.db('portal_accesos').where({ estado: 'activo' }).first();
  assert.equal((await dir.llamar('DELETE', `/api/portal/accesos/${act.id}`)).json().error, 'dar_de_baja_primero');
  const sm = await ctx.db('portal_accesos').where({ email: 'sinmail@cliente.com' }).first();
  assert.equal((await dir.llamar('DELETE', `/api/portal/accesos/${sm.id}`)).statusCode, 200);
  assert.equal(await ctx.db('portal_accesos').where({ id: sm.id }).first(), undefined);
  assert.equal((await ctx.db('portal_enlaces').where({ acceso_id: sm.id })).length, 0);
  await dir.llamar('POST', `/api/portal/accesos/${act.id}/baja`);
  assert.equal((await dir.llamar('DELETE', `/api/portal/accesos/${act.id}`)).statusCode, 200);
  assert.equal((await (await entrar(ctx.app, 'matias@demo.local')).llamar('DELETE', `/api/portal/accesos/${act.id}`)).statusCode, 403);
});

test('el portal muestra 12 meses, el neto de la factura, la ubicación de los equipos y baja un Excel solo del propio cliente', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  await ctx.db('facturas').insert({ cliente_id: cli, periodo: '2026-09', tipo_comprobante: 'A', numero: '0001-00000042', fecha_emision: '2026-10-01', vencimiento: '2026-10-15', moneda: 'USD', neto: 85, iva: 17.85, total: 102.85, estado: 'emitida' });
  await ctx.db('facturas').insert({ cliente_id: otro, periodo: '2026-09', tipo_comprobante: 'A', numero: '0001-00000099', fecha_emision: '2026-10-01', vencimiento: '2026-10-15', moneda: 'USD', neto: 1, iva: 0.21, total: 1.21, estado: 'emitida' });
  const r = await dir.llamar('POST', `/api/clientes/${cli}/portal`, { nombre: 'Excel Cliente', email: 'excel@cliente.com' });
  const en = await portal().post('/portal/api/entrar', { token: (r.json().url ?? enviados.at(-1).text).match(/#\/entrar\/([\w-]+)/)[1] });
  assert.equal(r.statusCode, 201, r.body); assert.equal(en.statusCode, 200, en.body); const ck = cookieDe(en);
  const ini = await portal(ck).get('/portal/api/inicio'); assert.equal(ini.statusCode, 200, ini.body); const d = ini.json();
  assert.equal(d.periodos.length, 12); assert.equal(d.consumo.length, 12);
  assert.ok(d.equipos.every((e) => 'domicilio' in e));
  const f = d.facturas.find((x) => x.numero === '0001-00000042'); assert.equal(f.neto, 85); assert.equal(f.iva, 17.85);
  assert.ok(!d.facturas.some((x) => x.numero === '0001-00000099'), 'no aparece la factura de otro cliente');
  assert.equal((await portal().get('/portal/api/excel')).statusCode, 401);
  const x = await portal(ck).get('/portal/api/excel');
  assert.equal(x.statusCode, 200); assert.match(x.headers['content-type'], /spreadsheetml/); assert.match(x.headers['content-disposition'], /\.xlsx/);
  const { default: ExcelJS } = await import('exceljs'); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.rawPayload);
  const nombres = wb.worksheets.map((w) => w.name);
  for (const n of ['Resumen', 'Contratos', 'Equipos', 'Consumo mensual', 'Contadores por equipo', 'Tickets', 'Facturas']) assert.ok(nombres.includes(n), n);
  const celdas = []; wb.eachSheet((w) => w.eachRow((row) => row.eachCell((c) => celdas.push(String(c.value)))));
  assert.ok(!celdas.includes('0001-00000099'), 'el Excel no trae datos de otro cliente');
  assert.ok(!nombres.some((n) => /costo|margen/i.test(n)), 'sin costos ni márgenes');
});
