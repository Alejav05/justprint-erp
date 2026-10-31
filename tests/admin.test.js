import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar as entrarSinCache } from './ayuda.js';
import { restablecer } from '../src/lib/ajustes_sistema.js';
import { PERMISOS } from '../src/lib/catalogo.js';
import { semaforo } from '../src/lib/cobranzas.js';

let ctx; const ses = new Map();
const entrar = async (e) => { if (!ses.has(e)) ses.set(e, await entrarSinCache(ctx.app, e)); return ses.get(e); };
before(async () => { restablecer(); ctx = await montar(); });
after(async () => { restablecer(); await ctx.cerrar(); });

test('solo quien tiene sistema.configurar entra a Configuración', async () => {
  assert.equal((await (await entrar('julia@demo.local')).llamar('GET', '/api/admin/config')).statusCode, 403);
  const r = await (await entrar('direccion@demo.local')).llamar('GET', '/api/admin/config');
  assert.equal(r.statusCode, 200); assert.ok(r.json().items.some((i) => i.clave === 'cobranzas.gracia_dias'));
});

test('Dirección tiene todos los permisos del sistema, también los nuevos', async () => {
  const me = (await (await entrar('direccion@demo.local')).llamar('GET', '/api/me')).json();
  assert.deepEqual(me.permisos, PERMISOS.map((p) => p[0]).sort());
});

test('cambiar los días de gracia cambia el semáforo y queda en auditoría', async () => {
  const dir = await entrar('direccion@demo.local'); const f = { fecha_emision: '2026-10-01', plazo_pago_dias: 10 };
  assert.equal(semaforo(f, '2026-11-10').color, 'rojo'); // vence 11/10; 30 días vencida
  assert.equal((await dir.llamar('PUT', '/api/admin/config/cobranzas.gracia_dias', { valor: 45 })).statusCode, 200);
  assert.equal(semaforo(f, '2026-11-10').color, 'amarillo');
  assert.equal((await dir.llamar('PUT', '/api/admin/config/cobranzas.gracia_dias', { valor: -1 })).statusCode, 400);
  assert.equal((await dir.llamar('PUT', '/api/admin/config/no.existe', { valor: 1 })).statusCode, 400);
  assert.ok((await ctx.db('audit_log').where({ tabla: 'configuracion' })).length >= 1);
  await dir.llamar('PUT', '/api/admin/config/cobranzas.gracia_dias', { valor: 15 });
});

test('ocultar un módulo lo apaga para todos, Dirección incluida, y se puede volver a mostrar', async () => {
  const dir = await entrar('direccion@demo.local'); const julia = await entrar('julia@demo.local');
  assert.equal((await julia.llamar('GET', '/api/cobranzas/semaforo')).statusCode, 200);
  await dir.llamar('PUT', '/api/admin/config/modulos.ocultos', { valor: ['cobranzas'] });
  assert.equal((await julia.llamar('GET', '/api/cobranzas/semaforo')).statusCode, 404);
  assert.equal((await dir.llamar('GET', '/api/cobranzas/semaforo')).statusCode, 404);
  assert.equal((await dir.llamar('GET', '/api/me')).json().config.modulos_ocultos[0], 'cobranzas');
  assert.equal((await dir.llamar('GET', '/api/admin/config')).statusCode, 200, 'Configuración nunca se oculta');
  await dir.llamar('PUT', '/api/admin/config/modulos.ocultos', { valor: [] });
  assert.equal((await julia.llamar('GET', '/api/cobranzas/semaforo')).statusCode, 200);
});

test('permisos por rol: se editan, Dirección es fija y el cambio rige de inmediato', async () => {
  const dir = await entrar('direccion@demo.local');
  const m = (await dir.llamar('GET', '/api/admin/permisos')).json();
  const fact = m.roles.find((r) => r.nombre === 'facturacion'); const d = m.roles.find((r) => r.nombre === 'direccion');
  assert.equal(d.fijo, true); assert.equal((await dir.llamar('PUT', `/api/admin/roles/${d.id}/permisos`, { permisos: [] })).statusCode, 409);
  assert.equal((await dir.llamar('PUT', `/api/admin/roles/${fact.id}/permisos`, { permisos: ['x.y'] })).statusCode, 400);
  const sin = fact.permisos.filter((p) => p !== 'cobranzas.gestionar');
  assert.equal((await dir.llamar('PUT', `/api/admin/roles/${fact.id}/permisos`, { permisos: sin })).statusCode, 200);
  const julia = await entrarSinCache(ctx.app, 'julia@demo.local');
  assert.equal((await julia.llamar('GET', '/api/cobranzas/semaforo')).json().solo_escaladas, true, 'sin el permiso deja de gestionar');
  await dir.llamar('PUT', `/api/admin/roles/${fact.id}/permisos`, { permisos: fact.permisos });
});

test('el seed no devuelve permisos que Dirección le sacó a un rol', async () => {
  const { seed } = await import('../seeds/01_base.js'); const dir = await entrar('direccion@demo.local');
  const m = (await dir.llamar('GET', '/api/admin/permisos')).json(); const com = m.roles.find((r) => r.nombre === 'comercial');
  await dir.llamar('PUT', `/api/admin/roles/${com.id}/permisos`, { permisos: com.permisos.filter((p) => p !== 'importes.ver') });
  await seed(ctx.db);
  assert.ok(!(await dir.llamar('GET', '/api/admin/permisos')).json().roles.find((r) => r.nombre === 'comercial').permisos.includes('importes.ver'));
});

test('el ajuste por IPC solo existe para contratos en pesos', async () => {
  const dir = await entrar('direccion@demo.local'); const db = ctx.db;
  const c = (await db('clientes').insert({ razon_social: 'Dólares SA', estado: 'activo' }))[0];
  const ct = (await db('contratos').insert({ cliente_id: c, nombre: 'USD', estado: 'vigente', moneda: 'USD', fecha_inicio: '2026-01-01' }))[0];
  await db('contrato_condiciones').insert({ contrato_id: ct, vigente_desde: '2026-01-01', monto_mensual: 100, franquicia_negro: 0, franquicia_color: 0, excedente_negro: 0, excedente_color: 0 });
  const r = await dir.llamar('GET', `/api/contratos/${ct}/ajuste?hasta=2026-10`);
  assert.equal(r.statusCode, 409); assert.equal(r.json().error, 'solo_pesos');
});

test('/api/publico muestra el eslogan sin iniciar sesión', async () => {
  const r = await ctx.app.inject({ method: 'GET', url: '/api/publico' });
  assert.equal(r.json().slogan, 'En cada página, en cada proyecto');
});
