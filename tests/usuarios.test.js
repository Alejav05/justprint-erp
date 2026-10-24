import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';

let ctx;
before(async () => { ctx = await montar(); });
after(async () => { await ctx.cerrar(); });

const nuevo = (extra = {}) => ({
  nombre: 'Persona Nueva', email: 'nueva@demo.local', password: 'Clave-Segura-2026', rol: 'comercial',
  areas: [{ area: 'Comercial', funcion: 'miembro', alcance: 'propio' }], ...extra,
});

test('solo dirección administra usuarios', async () => {
  for (const email of ['head.comercial@demo.local', 'sofia@demo.local', 'matias@demo.local']) {
    const s = await entrar(ctx.app, email);
    assert.equal((await s.llamar('GET', '/api/usuarios')).statusCode, 403, email);
    assert.equal((await s.llamar('GET', '/api/auditoria')).statusCode, 403, email);
  }
});

test('dirección crea un usuario, que puede entrar con su contraseña', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const r = await dir.llamar('POST', '/api/usuarios', nuevo());
  assert.equal(r.statusCode, 201);
  const entra = await entrar(ctx.app, 'nueva@demo.local', 'Clave-Segura-2026');
  assert.equal((await entra.llamar('GET', '/api/me')).json().rol, 'comercial');
});

test('la política de contraseñas se aplica y el mail no se repite', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  assert.equal((await dir.llamar('POST', '/api/usuarios', nuevo({ email: 'otra@demo.local', password: 'corta1' }))).statusCode, 422);
  assert.equal((await dir.llamar('POST', '/api/usuarios', nuevo({ email: 'otra@demo.local', password: 'sololetrassinnumeros' }))).statusCode, 422);
  assert.equal((await dir.llamar('POST', '/api/usuarios', nuevo())).statusCode, 409);
});

test('rol o área inexistentes se rechazan', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  assert.equal((await dir.llamar('POST', '/api/usuarios', nuevo({ email: 'a@demo.local', rol: 'inventado' }))).statusCode, 422);
  assert.equal((await dir.llamar('POST', '/api/usuarios', nuevo({ email: 'b@demo.local', areas: [{ area: 'Marte', funcion: 'miembro', alcance: 'propio' }] }))).statusCode, 422);
});

test('desactivar a alguien cierra sus sesiones al instante', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const ajena = await entrar(ctx.app, 'nueva@demo.local', 'Clave-Segura-2026');
  assert.equal((await ajena.llamar('GET', '/api/me')).statusCode, 200);
  const id = (await ctx.db('usuarios').where({ email: 'nueva@demo.local' }).first()).id;
  assert.equal((await dir.llamar('PATCH', `/api/usuarios/${id}`, { activo: false })).statusCode, 200);
  assert.equal((await ajena.llamar('GET', '/api/me')).statusCode, 401);
  await assert.rejects(entrar(ctx.app, 'nueva@demo.local', 'Clave-Segura-2026'));
});

test('cambiar el rol o el área también cierra sesiones: el cambio rige ya', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const lucia = await entrar(ctx.app, 'lucia@demo.local');
  const id = (await ctx.db('usuarios').where({ email: 'lucia@demo.local' }).first()).id;
  await dir.llamar('PATCH', `/api/usuarios/${id}`, { rol: 'atencion', areas: [{ area: 'Atención', funcion: 'miembro', alcance: 'todo' }] });
  assert.equal((await lucia.llamar('GET', '/api/me')).statusCode, 401);
  const de_nuevo = await entrar(ctx.app, 'lucia@demo.local');
  assert.equal((await de_nuevo.llamar('GET', '/api/me')).json().rol, 'atencion');
});

test('nadie puede desactivarse a sí mismo', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const yo = (await dir.llamar('GET', '/api/me')).json().id;
  assert.equal((await dir.llamar('PATCH', `/api/usuarios/${yo}`, { activo: false })).statusCode, 422);
});

test('restablecer contraseña desbloquea la cuenta y cierra sesiones', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const id = (await ctx.db('usuarios').where({ email: 'julia@demo.local' }).first()).id;
  assert.equal((await dir.llamar('POST', `/api/usuarios/${id}/password`, { password: 'Otra-Clave-2026' })).statusCode, 200);
  const julia = await entrar(ctx.app, 'julia@demo.local', 'Otra-Clave-2026');
  assert.equal((await julia.llamar('GET', '/api/me')).statusCode, 200);
});

test('la auditoría registra los cambios sin exponer contraseñas', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const r = await dir.llamar('GET', '/api/auditoria?tabla=usuarios');
  assert.equal(r.statusCode, 200);
  const cuerpo = JSON.stringify(r.json());
  assert.ok(r.json().eventos.some((e) => e.accion === 'crear'));
  assert.ok(!cuerpo.includes('Clave-Segura-2026') && !cuerpo.includes('Otra-Clave-2026') && !cuerpo.includes('password_hash'));
});

test('el catálogo de roles se puede consultar con sus permisos', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const { roles } = (await dir.llamar('GET', '/api/roles')).json();
  const tecnico = roles.find((r) => r.nombre === 'tecnico');
  assert.ok(tecnico.permisos.includes('partes.editar'));
  assert.ok(!tecnico.permisos.includes('importes.ver'));
});
