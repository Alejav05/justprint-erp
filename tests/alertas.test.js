import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';
import { reemplazarCanal } from '../src/lib/canales.js';
import { ejecutarAlertas } from '../src/lib/alertas.js';
import { aSql } from '../src/lib/sla.js';

let ctx; let ticket; const mails = []; const wsps = [];
before(async () => {
  ctx = await montar(); const db = ctx.db;
  reemplazarCanal('mail', { configurado: () => true, enviar: async (m) => { mails.push(m); } });
  reemplazarCanal('whatsapp', { configurado: () => false, enviar: async () => {} });
  const yo = (await db('usuarios').where({ email: 'matias@demo.local' }).first()).id;
  ticket = (await db('tickets').where({ asignado_a: yo }).whereIn('estado', ['abierto', 'asignado', 'en_curso']).first());
  await db('tickets').where({ id: ticket.id }).update({ abierto_en: aSql(Date.now() - 10 * 86400000), sla_horas: 24, sla_medible: true, resuelto_en: null });
});
after(async () => { await ctx.cerrar(); });

test('un ticket vencido avisa a quien corresponde, con los datos del momento', async () => {
  const db = ctx.db; const ahora = Date.now();
  const r = await ejecutarAlertas(db, { ahora });
  assert.ok(r.eventos >= 1);
  const ev = await db('alertas_eventos').where({ regla: 'sla_vencido', entidad: `ticket:${ticket.id}` }).first();
  assert.ok(ev, 'se registró el evento'); assert.ok(ev.cuerpo.includes(ticket.numero)); assert.ok(/h hábiles/.test(ev.cuerpo)); assert.ok(!ev.cuerpo.includes('{'));
  const matias = await db('usuarios').where({ email: 'matias@demo.local' }).first(); const head = await db('usuarios').where({ email: 'head.tecnico@demo.local' }).first();
  assert.ok(await db('notificaciones').where({ usuario_id: matias.id, evento_id: ev.id }).first(), 'el técnico asignado recibe');
  assert.ok(await db('notificaciones').where({ usuario_id: head.id, evento_id: ev.id }).first(), 'el head técnico recibe');
  assert.ok(mails.some((m) => m.to === 'matias@demo.local' && m.text.includes(ticket.numero)));
});

test('el mismo caso no se repite antes de la frecuencia y vuelve a avisar después', async () => {
  const db = ctx.db; const antes = (await db('alertas_eventos').where({ regla: 'sla_vencido', entidad: `ticket:${ticket.id}` })).length;
  await ejecutarAlertas(db, { ahora: Date.now() + 3600e3 });
  assert.equal((await db('alertas_eventos').where({ regla: 'sla_vencido', entidad: `ticket:${ticket.id}` })).length, antes);
  await ejecutarAlertas(db, { ahora: Date.now() + 26 * 3600e3 });
  assert.equal((await db('alertas_eventos').where({ regla: 'sla_vencido', entidad: `ticket:${ticket.id}` })).length, antes + 1);
});

test('el administrador cambia canales y destinatarios; un canal sin configurar no rompe nada', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  const lista = (await llamar('GET', '/api/alertas/reglas')).json();
  assert.equal(lista.canales.mail, true); assert.equal(lista.canales.whatsapp, false); assert.equal(lista.reglas.length, 9);
  const r = lista.reglas.find((x) => x.clave === 'sla_vencido');
  const put = await llamar('PUT', '/api/alertas/reglas/sla_vencido', { activa: true, umbral: null, canales: ['sistema', 'whatsapp'], destinatarios: { roles: [], responsables: ['tecnico'], usuarios: [] }, frecuencia_horas: 1, plantilla_asunto: 'URGENTE {numero}', plantilla_cuerpo: '{cliente}: {excedidas} h de atraso' });
  assert.equal(put.statusCode, 200);
  const db = ctx.db;
  const res = await ejecutarAlertas(db, { ahora: Date.now() + 40 * 3600e3 });
  assert.ok(!mails.some((m) => m.subject.startsWith('URGENTE')), 'esa regla ya no sale por mail');
  assert.ok(res.errores >= 1, 'WhatsApp sin configurar queda registrado como error');
  const env = await db('alertas_envios').where({ canal: 'whatsapp' }).orderBy('id', 'desc').first();
  assert.equal(env.estado, 'error'); assert.equal(env.detalle, 'canal_no_configurado');
  assert.ok((await db('alertas_eventos').where({ titulo: `URGENTE ${ticket.numero}` }).first()), 'usa la plantilla editada');
  assert.equal(r.umbral, null);
  // WhatsApp configurado: sale con el teléfono del usuario
  reemplazarCanal('whatsapp', { configurado: () => true, enviar: async (m) => { wsps.push(m); } });
  await db('usuarios').where({ email: 'matias@demo.local' }).update({ telefono: '+54 9 11 5555-1234' });
  await ejecutarAlertas(db, { ahora: Date.now() + 70 * 3600e3 });
  assert.ok(wsps.some((m) => m.to === '+54 9 11 5555-1234' && m.text.includes(ticket.numero)));
});

test('configuración: variables inventadas y falta de permiso se rechazan', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  const base = { activa: true, umbral: 25, canales: ['sistema'], destinatarios: { roles: [], responsables: [], usuarios: [] }, frecuencia_horas: 12, plantilla_asunto: 'x', plantilla_cuerpo: 'y' };
  const mal = await llamar('PUT', '/api/alertas/reglas/sla_por_vencer', { ...base, plantilla_cuerpo: 'Hola {inventada}' });
  assert.equal(mal.statusCode, 422); assert.deepEqual(mal.json().variables, ['inventada']);
  assert.equal((await llamar('PUT', '/api/alertas/reglas/sla_por_vencer', { ...base, umbral: null })).statusCode, 422);
  const julia = await entrar(ctx.app, 'julia@demo.local');
  assert.equal((await julia.llamar('GET', '/api/alertas/reglas')).statusCode, 403);
  assert.equal((await julia.llamar('POST', '/api/alertas/ejecutar')).statusCode, 403);
});

test('campana: cada uno ve lo suyo y puede marcar como leído', async () => {
  const { llamar } = await entrar(ctx.app, 'matias@demo.local');
  const n = (await llamar('GET', '/api/notificaciones')).json();
  assert.ok(n.sin_leer >= 1); assert.ok(n.items.every((i) => i.titulo));
  assert.equal((await llamar('GET', '/api/notificaciones/contador')).json().sin_leer, n.sin_leer);
  await llamar('POST', '/api/notificaciones/leer', { ids: [n.items[0].id] });
  assert.equal((await llamar('GET', '/api/notificaciones/contador')).json().sin_leer, n.sin_leer - 1);
  await llamar('POST', '/api/notificaciones/leer', {});
  assert.equal((await llamar('GET', '/api/notificaciones/contador')).json().sin_leer, 0);
  const otra = await entrar(ctx.app, 'lucia@demo.local');
  assert.ok((await otra.llamar('GET', '/api/notificaciones')).json().items.every((i) => !n.items.some((x) => x.id === i.id)));
});

test('prueba de canal y historial', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  assert.equal((await llamar('POST', '/api/alertas/prueba', { canal: 'mail' })).statusCode, 200);
  assert.ok(mails.some((m) => m.subject === 'Prueba de alertas JustPrint'));
  const h = (await llamar('GET', '/api/alertas/historial')).json();
  assert.ok(h.total >= 1); assert.ok(h.items[0].envios.length >= 1);
});
