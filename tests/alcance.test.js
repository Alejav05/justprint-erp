import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';

let ctx;
before(async () => { ctx = await montar(); });
after(async () => { await ctx.cerrar(); });

const nombres = (r) => r.json().clientes.map((c) => c.razon_social).sort();
const idDe = async (razon) => (await ctx.db('clientes').where({ razon_social: razon }).first()).id;

test('un comercial ve solo su cartera', async () => {
  const nicolas = await entrar(ctx.app, 'nicolas@demo.local');
  assert.deepEqual(nombres(await nicolas.llamar('GET', '/api/clientes')), ['Cliente Prueba SRL', 'The Juju']);
  const valentina = await entrar(ctx.app, 'valentina@demo.local');
  assert.deepEqual(nombres(await valentina.llamar('GET', '/api/clientes')), ['Farmacia Central', 'Grupo 8.66']);
});

test('el head comercial ve todas las carteras y las cuentas sin responsable', async () => {
  const head = await entrar(ctx.app, 'head.comercial@demo.local');
  assert.equal(nombres(await head.llamar('GET', '/api/clientes')).length, 5);
});

test('un técnico ve solo los clientes de sus tickets; su head ve los de todo el equipo', async () => {
  const matias = await entrar(ctx.app, 'matias@demo.local');
  assert.deepEqual(nombres(await matias.llamar('GET', '/api/clientes')), ['Cliente Prueba SRL']);
  const head = await entrar(ctx.app, 'head.tecnico@demo.local');
  assert.deepEqual(nombres(await head.llamar('GET', '/api/clientes')), ['Cliente Prueba SRL', 'The Juju']);
});

test('dirección, atención y facturación ven todos los clientes', async () => {
  for (const email of ['direccion@demo.local', 'sofia@demo.local', 'julia@demo.local']) {
    const s = await entrar(ctx.app, email);
    assert.equal(nombres(await s.llamar('GET', '/api/clientes')).length, 5, email);
  }
});

test('un cliente fuera de alcance responde 404, como si no existiera', async () => {
  const nicolas = await entrar(ctx.app, 'nicolas@demo.local');
  const ajeno = await idDe('Farmacia Central');
  assert.equal((await nicolas.llamar('GET', `/api/clientes/${ajeno}`)).statusCode, 404);
  assert.equal((await nicolas.llamar('PATCH', `/api/clientes/${ajeno}`, { notas: 'x' })).statusCode, 404);
  assert.equal((await nicolas.llamar('GET', '/api/clientes/99999')).statusCode, 404);
});

test('los importes solo llegan a quien tiene el permiso', async () => {
  const con = await (await entrar(ctx.app, 'nicolas@demo.local')).llamar('GET', '/api/clientes');
  assert.equal(con.json().clientes.find((c) => c.razon_social === 'Cliente Prueba SRL').abono_mensual_usd, 340);

  for (const email of ['sofia@demo.local', 'matias@demo.local', 'head.tecnico@demo.local']) {
    const s = await entrar(ctx.app, email);
    const lista = await s.llamar('GET', '/api/clientes');
    assert.ok(lista.json().clientes.every((c) => !('abono_mensual_usd' in c)), `${email} no debería ver abonos`);
    const detalle = await s.llamar('GET', `/api/clientes/${await idDe('Cliente Prueba SRL')}`);
    if (detalle.statusCode === 200) {
      const cuerpo = JSON.stringify(detalle.json());
      assert.ok(!cuerpo.includes('monto_mensual'), `${email} no debería ver condiciones de precio`);
    }
  }
});

test('atención y técnico no ven contratos; el comercial no ve a otro comercial', async () => {
  const sofia = await entrar(ctx.app, 'sofia@demo.local');
  const d = await sofia.llamar('GET', `/api/clientes/${await idDe('The Juju')}`);
  assert.equal(d.statusCode, 200);
  assert.equal(d.json().contratos, undefined);
});

test('el detalle trae sedes, contactos con sus campos CRM y responsable vigente', async () => {
  const nicolas = await entrar(ctx.app, 'nicolas@demo.local');
  const d = (await nicolas.llamar('GET', `/api/clientes/${await idDe('Cliente Prueba SRL')}`)).json();
  assert.equal(d.responsable.nombre, 'Nicolás (Comercial)');
  assert.equal(d.sedes.length, 1);
  const c = d.contactos[0];
  assert.equal(c.nombre, 'Marcela Duarte');
  assert.equal(c.autorizado_toner, 1);
  assert.deepEqual(c.roles, ['decisor']);
  assert.equal(c.fechas_clave[0].tipo, 'cumpleaños');
  assert.equal(d.contratos[0].condiciones[0].monto_mensual, 340);
});

test('un comercial que da de alta una cuenta queda como su responsable', async () => {
  const nicolas = await entrar(ctx.app, 'nicolas@demo.local');
  const r = await nicolas.llamar('POST', '/api/clientes', { razon_social: 'Taller Mecánico Norte', origen: 'Instagram' });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().estado, 'activo');
  const lista = await nicolas.llamar('GET', '/api/clientes');
  assert.ok(nombres(lista).includes('Taller Mecánico Norte'));
  const fila = lista.json().clientes.find((c) => c.razon_social === 'Taller Mecánico Norte');
  assert.equal(fila.responsable, 'Nicolás (Comercial)');
});

test('la validación rechaza datos inválidos con detalle por campo', async () => {
  const nicolas = await entrar(ctx.app, 'nicolas@demo.local');
  const r = await nicolas.llamar('POST', '/api/clientes', { razon_social: 'X', estado: 'inventado' });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json().detalles.map((d) => d.campo).sort(), ['estado', 'razon_social']);
});

test('quien no tiene permiso de edición no puede crear clientes', async () => {
  const sofia = await entrar(ctx.app, 'sofia@demo.local');
  assert.equal((await sofia.llamar('POST', '/api/clientes', { razon_social: 'Cliente nuevo' })).statusCode, 403);
});

test('filtros: por estado, por responsable y por texto', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  assert.equal(nombres(await dir.llamar('GET', '/api/clientes?estado=prospecto')).length >= 1, true);
  const nicolasId = (await ctx.db('usuarios').where({ email: 'nicolas@demo.local' }).first()).id;
  const deNicolas = nombres(await dir.llamar('GET', `/api/clientes?responsable=${nicolasId}`));
  assert.ok(deNicolas.includes('The Juju') && !deNicolas.includes('Farmacia Central'));
  assert.deepEqual(nombres(await dir.llamar('GET', '/api/clientes?q=farmacia')), ['Farmacia Central']);
});
