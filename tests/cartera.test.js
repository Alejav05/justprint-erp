import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';

let ctx;
before(async () => { ctx = await montar(); });
after(async () => { await ctx.cerrar(); });

const idCliente = async (razon) => (await ctx.db('clientes').where({ razon_social: razon }).first()).id;
const idUsuario = async (email) => (await ctx.db('usuarios').where({ email }).first()).id;
const nombres = (r) => r.json().clientes.map((c) => c.razon_social).sort();

test('el head comercial reasigna una cuenta: cierra la anterior, abre la nueva y deja historia', async () => {
  const head = await entrar(ctx.app, 'head.comercial@demo.local');
  const cliente = await idCliente('The Juju');
  const r = await head.llamar('POST', '/api/cartera/asignar', {
    cliente_id: cliente, usuario_id: await idUsuario('valentina@demo.local'), motivo: 'Balanceo de carteras',
  });
  assert.equal(r.statusCode, 201);

  const vigentes = await ctx.db('cartera_asignaciones').where({ cliente_id: cliente }).whereNull('hasta');
  assert.equal(vigentes.length, 1, 'una sola asignación vigente por cuenta');
  assert.equal(vigentes[0].usuario_id, await idUsuario('valentina@demo.local'));

  const hist = (await head.llamar('GET', `/api/cartera/${cliente}/historial`)).json().historial;
  assert.equal(hist.length, 2);
  assert.equal(hist[0].usuario, 'Valentina (Comercial)');
  assert.equal(hist[0].motivo, 'Balanceo de carteras');
  assert.equal(hist[1].usuario, 'Nicolás (Comercial)');
  assert.ok(hist[1].hasta, 'la anterior quedó cerrada con fecha');
});

test('tras reasignar, cada comercial ve su nueva cartera', async () => {
  const nicolas = await entrar(ctx.app, 'nicolas@demo.local');
  assert.deepEqual(nombres(await nicolas.llamar('GET', '/api/clientes')), ['Cliente Prueba SRL']);
  const valentina = await entrar(ctx.app, 'valentina@demo.local');
  assert.deepEqual(nombres(await valentina.llamar('GET', '/api/clientes')), ['Farmacia Central', 'Grupo 8.66', 'The Juju']);
});

test('reasignar a quien ya es responsable devuelve conflicto y no duplica', async () => {
  const head = await entrar(ctx.app, 'head.comercial@demo.local');
  const cliente = await idCliente('The Juju');
  const r = await head.llamar('POST', '/api/cartera/asignar', { cliente_id: cliente, usuario_id: await idUsuario('valentina@demo.local') });
  assert.equal(r.statusCode, 409);
  assert.equal((await ctx.db('cartera_asignaciones').where({ cliente_id: cliente })).length, 2);
});

test('el head puede asignar una cuenta que no tenía responsable', async () => {
  const head = await entrar(ctx.app, 'head.comercial@demo.local');
  const cliente = await idCliente('Estudio Contable Ríos');
  const r = await head.llamar('POST', '/api/cartera/asignar', { cliente_id: cliente, usuario_id: await idUsuario('nicolas@demo.local') });
  assert.equal(r.statusCode, 201);
  const nicolas = await entrar(ctx.app, 'nicolas@demo.local');
  assert.ok(nombres(await nicolas.llamar('GET', '/api/clientes')).includes('Estudio Contable Ríos'));
});

test('un comercial no puede reasignar cuentas', async () => {
  const nicolas = await entrar(ctx.app, 'nicolas@demo.local');
  const r = await nicolas.llamar('POST', '/api/cartera/asignar', {
    cliente_id: await idCliente('Cliente Prueba SRL'), usuario_id: await idUsuario('valentina@demo.local'),
  });
  assert.equal(r.statusCode, 403);
});

test('no se puede asignar a alguien que no es comercial', async () => {
  const head = await entrar(ctx.app, 'head.comercial@demo.local');
  const r = await head.llamar('POST', '/api/cartera/asignar', {
    cliente_id: await idCliente('Grupo 8.66'), usuario_id: await idUsuario('matias@demo.local'),
  });
  assert.equal(r.statusCode, 422);
});

test('dirección también puede reasignar; el historial solo lo ve quien gestiona cartera o CRM', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const cliente = await idCliente('Grupo 8.66');
  const r = await dir.llamar('POST', '/api/cartera/asignar', { cliente_id: cliente, usuario_id: await idUsuario('nicolas@demo.local') });
  assert.equal(r.statusCode, 201);
  const sofia = await entrar(ctx.app, 'sofia@demo.local');
  assert.equal((await sofia.llamar('GET', `/api/cartera/${cliente}/historial`)).statusCode, 403);
});

test('cada reasignación queda en auditoría con quién y cuándo', async () => {
  const filas = await ctx.db('audit_log').where({ tabla: 'cartera_asignaciones' });
  assert.ok(filas.length >= 3);
  assert.ok(filas.every((f) => f.usuario_id && f.created_at));
});
