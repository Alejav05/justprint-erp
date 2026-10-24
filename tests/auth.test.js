import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar, CLAVE_DEMO } from './ayuda.js';

let ctx;
before(async () => { ctx = await montar(); });
after(async () => { await ctx.cerrar(); });

test('login correcto abre sesión y /api/me devuelve permisos y áreas', async () => {
  const { llamar } = await entrar(ctx.app, 'nicolas@demo.local');
  const r = await llamar('GET', '/api/me');
  assert.equal(r.statusCode, 200);
  const me = r.json();
  assert.equal(me.rol, 'comercial');
  assert.ok(me.permisos.includes('importes.ver'));
  assert.ok(!me.permisos.includes('usuarios.administrar'));
  assert.deepEqual(me.areas.map((a) => [a.area, a.alcance]), [['Comercial', 'propio']]);
});

test('sin sesión no se accede', async () => {
  const r = await ctx.app.inject({ method: 'GET', url: '/api/clientes' });
  assert.equal(r.statusCode, 401);
});

test('el cookie de sesión es httpOnly y lax', async () => {
  const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'sofia@demo.local', password: CLAVE_DEMO } });
  const c = r.cookies.find((x) => x.name === 'jp_sid');
  assert.equal(c.httpOnly, true);
  assert.equal(c.sameSite, 'Lax');
});

test('contraseña incorrecta y mail inexistente dan el mismo error', async () => {
  const mal = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'sofia@demo.local', password: 'incorrecta123' } });
  const nada = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nadie@demo.local', password: 'incorrecta123' } });
  assert.equal(mal.statusCode, 401);
  assert.equal(nada.statusCode, 401);
  assert.deepEqual(mal.json(), nada.json());
});

test('tras 5 fallos la cuenta se bloquea, incluso con la contraseña correcta', async () => {
  for (let i = 0; i < 5; i++) {
    await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'julia@demo.local', password: 'incorrecta123' } });
  }
  const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'julia@demo.local', password: CLAVE_DEMO } });
  assert.equal(r.statusCode, 401);
});

test('logout invalida la sesión', async () => {
  const { llamar } = await entrar(ctx.app, 'paula@demo.local').catch(() => entrar(ctx.app, 'head.atencion@demo.local'));
  assert.equal((await llamar('POST', '/api/auth/logout')).statusCode, 200);
  assert.equal((await llamar('GET', '/api/me')).statusCode, 401);
});

test('una escritura con Origin de otro sitio se rechaza', async () => {
  const r = await ctx.app.inject({
    method: 'POST', url: '/api/auth/login', headers: { origin: 'https://sitio-malo.example', host: 'erp.justprint.com.ar' },
    payload: { email: 'sofia@demo.local', password: CLAVE_DEMO },
  });
  assert.equal(r.statusCode, 403);
});

test('los intentos quedan en auditoría, sin guardar contraseñas', async () => {
  const filas = await ctx.db('audit_log').whereIn('accion', ['login', 'login_fallido']);
  assert.ok(filas.length >= 3);
  assert.ok(!JSON.stringify(filas).includes(CLAVE_DEMO));
});
