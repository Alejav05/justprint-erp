import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar as entrarSinCache } from './ayuda.js';
import { hoy } from '../src/lib/fechas.js';

let ctx; let K; const ses = new Map();
const entrar = async (e) => { if (!ses.has(e)) ses.set(e, await entrarSinCache(ctx.app, e)); return ses.get(e); };
const precios = { monto_mensual: 150, franquicia_negro: 1000, franquicia_color: 100, excedente_negro: 0.05, excedente_color: 0.2, facturable: true };

before(async () => {
  ctx = await montar(); const db = ctx.db;
  const ent = (await db('entidades_facturantes').insert({ razon_social: 'Europa Haus S.A.S.', cuit: '30-71646173-0' }))[0];
  const nico = (await db('usuarios').where({ email: 'nicolas@demo.local' }).first()).id;
  const cli = (await db('clientes').insert({ razon_social: 'Cliente Contratos SA', estado: 'activo' }))[0];
  await db('cartera_asignaciones').insert({ cliente_id: cli, usuario_id: nico, desde: '2026-01-01', motivo: 'test' });
  const sede = (await db('sedes').insert({ cliente_id: cli, nombre: 'Casa central', zona: 'caba' }))[0];
  const otro = (await db('clientes').insert({ razon_social: 'Otro SA', estado: 'activo' }))[0];
  const sedeAjena = (await db('sedes').insert({ cliente_id: otro, nombre: 'Ajena', zona: 'caba' }))[0];
  await db('cotizaciones_usd').insert({ fecha: hoy(), valor: 1500, fuente: 'BNA' });
  const entActiva = (await db('entidades_facturantes').where({ activa: true }).orderBy('id').first()).id;
  K = { ent: entActiva, cli, sede, otro, sedeAjena };
});
after(async () => { await ctx.cerrar(); });

const nuevo = (o = {}) => ({ cliente_id: K.cli, nombre: 'Alquiler oficina', moneda: 'USD', fecha_inicio: '2026-09-01', duracion_meses: 24, precios, ...o });

test('crear un contrato deja la primera condición de precios y toma la entidad facturante activa', async () => {
  const dir = await entrar('direccion@demo.local');
  const r = await dir.llamar('POST', '/api/contratos', nuevo({ sede_id: K.sede, plazo_pago_dias: 20 })); assert.equal(r.statusCode, 201);
  const d = (await dir.llamar('GET', `/api/contratos/${r.json().id}`)).json();
  assert.equal(d.contrato.estado, 'vigente'); assert.equal(d.contrato.entidad_facturante_id, K.ent); assert.equal(d.contrato.fin, '2028-09-01');
  assert.equal(d.condiciones.length, 1); assert.equal(d.condiciones[0].motivo, 'alta'); assert.equal(d.condiciones[0].monto_usd_referencia, 150);
  const lista = Object.fromEntries(d.checklist.map((x) => [x.texto, x.ok]));
  assert.equal(lista['Tiene condiciones de precio'], true); assert.equal(lista['Tiene equipos instalados'], false); assert.equal(lista['Tiene plazo de pago propio'], true);
});

test('en pesos guarda la referencia en dólares con la última cotización; sin facturar queda marcado', async () => {
  const dir = await entrar('direccion@demo.local');
  const id = (await dir.llamar('POST', '/api/contratos', nuevo({ nombre: 'En pesos', moneda: 'ARS', precios: { ...precios, monto_mensual: 300000 } }))).json().id;
  assert.equal((await dir.llamar('GET', `/api/contratos/${id}`)).json().condiciones[0].monto_usd_referencia, 200);
  const id2 = (await dir.llamar('POST', '/api/contratos', nuevo({ nombre: 'Bonificado', precios: { ...precios, monto_mensual: 0, facturable: false } }))).json().id;
  assert.equal((await dir.llamar('GET', `/api/contratos/${id2}`)).json().condiciones[0].motivo, 'sin_facturar');
});

test('validaciones: sede de otro cliente, abono en cero, cliente fuera de alcance, permisos', async () => {
  const dir = await entrar('direccion@demo.local');
  assert.equal((await dir.llamar('POST', '/api/contratos', nuevo({ sede_id: K.sedeAjena }))).json().error, 'sede_invalida');
  assert.equal((await dir.llamar('POST', '/api/contratos', nuevo({ precios: { ...precios, monto_mensual: 0 } }))).json().error, 'abono_en_cero');
  assert.equal((await dir.llamar('POST', '/api/contratos', nuevo({ fecha_inicio: '01/09/2026' }))).statusCode, 400);
  assert.equal((await (await entrar('julia@demo.local')).llamar('POST', '/api/contratos', nuevo())).statusCode, 403);
  const head = await entrar('head.comercial@demo.local');
  assert.equal((await head.llamar('POST', '/api/contratos', nuevo({ cliente_id: 999999 }))).statusCode, 404);
});

test('nuevas condiciones: cierra la anterior el día previo y no deja fechas anteriores', async () => {
  const dir = await entrar('direccion@demo.local');
  const id = (await dir.llamar('POST', '/api/contratos', nuevo({ nombre: 'Renegociable' }))).json().id;
  assert.equal((await dir.llamar('POST', `/api/contratos/${id}/condiciones`, { ...precios, monto_mensual: 180, vigente_desde: '2026-10-01' })).statusCode, 201);
  const c = (await dir.llamar('GET', `/api/contratos/${id}`)).json().condiciones;
  assert.equal(c.length, 2); assert.equal(c[1].vigente_hasta, '2026-09-30'); assert.equal(c[0].vigente_hasta, null); assert.equal(c[0].monto_mensual, 180);
  assert.equal((await dir.llamar('POST', `/api/contratos/${id}/condiciones`, { ...precios, vigente_desde: '2026-10-01' })).json().error, 'ya_hay_condicion_posterior');
});

test('editar datos: no se cambia la moneda de un contrato con facturas', async () => {
  const dir = await entrar('direccion@demo.local'); const db = ctx.db;
  const id = (await dir.llamar('POST', '/api/contratos', nuevo({ nombre: 'Con factura' }))).json().id;
  assert.equal((await dir.llamar('PATCH', `/api/contratos/${id}`, { nombre: 'Con factura 2', plazo_pago_dias: 45, notas: 'Pidió factura B' })).statusCode, 200);
  assert.equal((await dir.llamar('GET', `/api/contratos/${id}`)).json().contrato.plazo_pago_dias, 45);
  await db('facturas').insert({ cliente_id: K.cli, contrato_id: id, periodo: '2026-09', moneda: 'USD', neto: 1, iva: 0, total: 1, estado: 'emitida', entidad_facturante_id: K.ent });
  assert.equal((await dir.llamar('PATCH', `/api/contratos/${id}`, { moneda: 'ARS' })).json().error, 'moneda_con_facturas');
});

test('estado: no se rescinde con equipos instalados, pide motivo, cierra las condiciones y un borrador se activa', async () => {
  const dir = await entrar('direccion@demo.local'); const db = ctx.db;
  const id = (await dir.llamar('POST', '/api/contratos', nuevo({ nombre: 'A rescindir' }))).json().id;
  const modelo = (await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'X', tipo: 'monocromo' }))[0];
  const eq = (await db('equipos').insert({ modelo_id: modelo, numero_serie: 'CT-1', estado: 'instalado' }))[0];
  const asg = (await db('asignaciones_equipo').insert({ equipo_id: eq, contrato_id: id, desde: '2026-09-01', contador_inicial_negro: 0, contador_inicial_color: 0 }))[0];
  const r = await dir.llamar('POST', `/api/contratos/${id}/estado`, { estado: 'rescindido', motivo: 'Se mudaron' });
  assert.equal(r.json().error, 'equipos_instalados'); assert.equal(r.json().equipos, 1);
  await db('asignaciones_equipo').where({ id: asg }).update({ hasta: hoy() });
  assert.equal((await dir.llamar('POST', `/api/contratos/${id}/estado`, { estado: 'rescindido' })).json().error, 'motivo_requerido');
  assert.equal((await dir.llamar('POST', `/api/contratos/${id}/estado`, { estado: 'rescindido', motivo: 'Se mudaron' })).statusCode, 200);
  const d = (await dir.llamar('GET', `/api/contratos/${id}`)).json();
  assert.equal(d.contrato.estado, 'rescindido'); assert.equal(d.condiciones[0].vigente_hasta, hoy()); assert.match(d.contrato.notas, /Se mudaron/);
  assert.equal((await dir.llamar('POST', `/api/contratos/${id}/estado`, { estado: 'vigente' })).json().error, 'solo_borrador_se_activa');
  const b = (await dir.llamar('POST', '/api/contratos', nuevo({ nombre: 'Borrador', estado: 'borrador' }))).json().id;
  assert.equal((await dir.llamar('POST', `/api/contratos/${b}/estado`, { estado: 'vigente' })).statusCode, 200);
});

test('un contrato rescindido o en borrador no entra a la liquidación; uno vigente sí', async () => {
  const dir = await entrar('direccion@demo.local');
  await dir.llamar('POST', '/api/contratos', nuevo({ nombre: 'Sigue en borrador', estado: 'borrador' }));
  const r = (await (await entrar('julia@demo.local')).llamar('GET', '/api/facturacion/liquidacion?periodo=2026-10')).json();
  assert.ok(!r.filas.some((f) => f.contrato === 'A rescindir' || f.contrato === 'Sigue en borrador'));
  assert.ok(r.filas.some((f) => f.contrato === 'Alquiler oficina'));
  assert.ok(dir);
});

test('listado: filtros por estado y vencimiento; el comercial solo ve su cartera y sin importes si no los tiene', async () => {
  const dir = await entrar('direccion@demo.local');
  const todos = (await dir.llamar('GET', '/api/contratos')).json().items; assert.ok(todos.length >= 6);
  assert.ok((await dir.llamar('GET', '/api/contratos?estado=borrador')).json().items.every((c) => c.estado === 'borrador'));
  assert.ok((await dir.llamar('GET', '/api/contratos?q=Cliente%20Contratos')).json().items.length >= 6);
  const nico = (await (await entrar('nicolas@demo.local')).llamar('GET', '/api/contratos')).json().items;
  const ajeno = (await dir.llamar('POST', '/api/contratos', nuevo({ cliente_id: K.otro, nombre: 'De otro' }))).json().id;
  assert.ok(nico.some((c) => c.cliente_id === K.cli)); assert.ok(!(await (await entrar('nicolas@demo.local')).llamar('GET', '/api/contratos')).json().items.some((c) => c.id === ajeno));
  assert.equal((await (await entrar('nicolas@demo.local')).llamar('GET', `/api/contratos/${ajeno}`)).statusCode, 404);
});
