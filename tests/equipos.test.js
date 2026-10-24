import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar as entrarSinCache } from './ayuda.js';
import { sincronizarCotizacion } from '../src/lib/cotizacion.js';

let ctx; let cli;
const sesiones = new Map();
const entrar = async (app, email) => { if (!sesiones.has(email)) sesiones.set(email, await entrarSinCache(app, email)); return sesiones.get(email); };
before(async () => {
  ctx = await montar();
  const db = ctx.db;
  const prueba = (await db('clientes').where({ razon_social: 'Cliente Prueba SRL' }).first()).id;
  cli = { prueba, contrato: (await db('contratos').where({ cliente_id: prueba }).first()).id, sede: (await db('sedes').where({ cliente_id: prueba }).first()).id,
    juju: (await db('clientes').where({ razon_social: 'The Juju' }).first()).id, modeloColor: (await db('modelos_equipo').first()).id };
});
after(async () => { await ctx.cerrar(); });

test('un equipo nuevo entra al depósito con su código QR; la serie no se repite', async () => {
  const head = await entrar(ctx.app, 'head.tecnico@demo.local');
  const r = await head.llamar('POST', '/api/equipos', { modelo_id: cli.modeloColor, numero_serie: 'ZX-100-ab' });
  assert.equal(r.statusCode, 201);
  const e = await ctx.db('equipos').where({ id: r.json().id }).first();
  assert.equal(e.estado, 'deposito'); assert.equal(e.codigo_qr, 'JP-ZX100AB');
  assert.equal((await head.llamar('POST', '/api/equipos', { modelo_id: cli.modeloColor, numero_serie: 'ZX-100-ab' })).statusCode, 409);
  assert.equal((await (await entrar(ctx.app, 'sofia@demo.local')).llamar('POST', '/api/equipos', { modelo_id: cli.modeloColor, numero_serie: 'NO-1' })).statusCode, 403);
});

test('instalar, leer contadores y retirar deja todo el historial; los contadores nunca retroceden', async () => {
  const head = await entrar(ctx.app, 'head.tecnico@demo.local');
  const id = (await ctx.db('equipos').where({ numero_serie: 'ZX-100-ab' }).first()).id;
  const inst = await head.llamar('POST', `/api/equipos/${id}/mover`, { accion: 'instalar', contrato_id: cli.contrato, sede_id: cli.sede, contador_negro: 100, contador_color: 50 });
  assert.equal(inst.statusCode, 200, inst.body);
  assert.equal((await head.llamar('POST', `/api/equipos/${id}/mover`, { accion: 'instalar', contrato_id: cli.contrato, contador_negro: 100, contador_color: 50 })).statusCode, 409, 'ya está instalado');
  assert.equal((await head.llamar('POST', `/api/equipos/${id}/lecturas`, { contador_negro: 90, contador_color: 60 })).statusCode, 409);
  assert.equal((await head.llamar('POST', `/api/equipos/${id}/lecturas`, { contador_negro: 150 })).json().error, 'contador_color_requerido');
  assert.equal((await head.llamar('POST', `/api/equipos/${id}/lecturas`, { contador_negro: 180, contador_color: 70 })).statusCode, 201);
  assert.equal((await head.llamar('POST', `/api/equipos/${id}/mover`, { accion: 'baja', motivo: 'Prueba' })).statusCode, 409, 'primero hay que retirarlo');
  const ret = await head.llamar('POST', `/api/equipos/${id}/mover`, { accion: 'retirar', destino: 'reparacion', contador_negro: 200, contador_color: 80 });
  assert.equal(ret.statusCode, 200, ret.body);
  const ficha = (await head.llamar('GET', `/api/equipos/${id}`)).json();
  assert.equal(ficha.estado, 'reparacion'); assert.equal(ficha.ubicacion, 'Taller');
  assert.equal(ficha.asignaciones.length, 1); assert.equal(ficha.asignaciones[0].contador_final_negro, 200);
  assert.equal(ficha.lecturas.length, 3); assert.deepEqual(ficha.periodo && [ficha.periodo.negro, ficha.periodo.color], [20, 10]);
  assert.equal(ficha.movimientos.length, 2);
  assert.equal((await head.llamar('POST', `/api/equipos/${id}/mover`, { accion: 'baja', motivo: 'Irrecuperable' })).statusCode, 200);
  assert.equal((await head.llamar('POST', `/api/equipos/${id}/mover`, { accion: 'instalar', contrato_id: cli.contrato, contador_negro: 300, contador_color: 90 })).statusCode, 409, 'de baja no vuelve');
});

test('el QR resuelve al equipo y la etiqueta es un SVG; el comercial solo ve equipos de su cartera', async () => {
  const head = await entrar(ctx.app, 'head.tecnico@demo.local');
  const e = await ctx.db('equipos').where({ numero_serie: 'PRUEBA-003' }).first();
  assert.equal((await head.llamar('GET', `/api/equipos/qr/${e.codigo_qr}`)).json().id, e.id);
  assert.equal((await head.llamar('GET', '/api/equipos/qr/NO-EXISTE')).statusCode, 404);
  assert.equal((await head.llamar('GET', `/api/equipos/qr/${e.numero_serie}`)).json().id, e.id, 'también por número de serie, que es lo que trae el QR del cliente');
  const svg = await head.llamar('GET', `/api/equipos/${e.id}/qr.svg`);
  assert.match(svg.headers['content-type'], /svg/); assert.match(svg.body, /<svg/);
  const val = await entrar(ctx.app, 'valentina@demo.local');
  assert.equal((await val.llamar('GET', `/api/equipos/${e.id}`)).statusCode, 404, 'Prueba es de Nicolás');
  assert.equal((await (await entrar(ctx.app, 'nicolas@demo.local')).llamar('GET', `/api/equipos/${e.id}`)).statusCode, 200);
  const lista = (await val.llamar('GET', '/api/equipos')).json();
  assert.ok(!lista.items.some((x) => x.id === e.id));
});

test('insumos: stock por movimientos, mínimos, y la entrega por remito baja el stock todo o nada', async () => {
  const head = await entrar(ctx.app, 'head.tecnico@demo.local');
  const a = (await head.llamar('POST', '/api/insumos', { codigo: 'TN-X', descripcion: 'Tóner X', stock_minimo: 3 })).json().id;
  const b = (await head.llamar('POST', '/api/insumos', { codigo: 'TN-Y', descripcion: 'Tóner Y', stock_minimo: 1 })).json().id;
  assert.equal((await head.llamar('POST', '/api/insumos', { codigo: 'TN-X', descripcion: 'otra vez' })).statusCode, 409);
  assert.equal((await head.llamar('POST', `/api/insumos/${a}/movimientos`, { tipo: 'entrada', cantidad: 5, motivo: 'Compra' })).statusCode, 201);
  await head.llamar('POST', `/api/insumos/${b}/movimientos`, { tipo: 'entrada', cantidad: 2, motivo: 'Compra' });
  assert.equal((await head.llamar('POST', `/api/insumos/${a}/movimientos`, { tipo: 'ajuste', cantidad: -9, motivo: 'Inventario' })).statusCode, 409, 'el stock no puede quedar negativo');
  const ent = await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, items: [{ insumo_id: a, cantidad: 3 }, { insumo_id: b, cantidad: 1 }] });
  assert.equal(ent.statusCode, 201, ent.body);
  const lista = (await head.llamar('GET', '/api/insumos')).json();
  const x = lista.items.find((i) => i.id === a); const y = lista.items.find((i) => i.id === b);
  assert.equal(x.stock, 2); assert.equal(x.nivel, 'bajo'); assert.equal(y.stock, 1); assert.equal(y.nivel, 'ok');
  const antes = (await ctx.db('remitos').count({ n: '*' }).first()).n;
  const falla = await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, items: [{ insumo_id: b, cantidad: 1 }, { insumo_id: a, cantidad: 9 }] });
  assert.equal(falla.statusCode, 409);
  assert.equal((await ctx.db('remitos').count({ n: '*' }).first()).n, antes, 'no quedó ningún remito a medias');
  assert.equal((await head.llamar('GET', '/api/insumos')).json().items.find((i) => i.id === b).stock, 1, 'ni se tocó el stock');
  const r = (await head.llamar('GET', `/api/remitos/${ent.json().id}`)).json();
  assert.equal(r.items.length, 2); assert.equal(r.cliente.razon_social, 'Cliente Prueba SRL');
  assert.equal((await (await entrar(ctx.app, 'lucia@demo.local')).llamar('GET', `/api/remitos/${ent.json().id}`)).statusCode, 404);
});

test('la cotización BNA se toma de la API y se guarda una por día', async () => {
  const falsa = async () => ({ ok: true, json: async () => ({ compra: 1380, venta: 1430.5 }) });
  const r = await sincronizarCotizacion(ctx.db, { buscar: falsa });
  assert.equal(r.valor, 1430.5);
  await sincronizarCotizacion(ctx.db, { buscar: async () => ({ ok: true, json: async () => ({ venta: 1440 }) }) });
  const filas = await ctx.db('cotizaciones_usd').where({ fecha: r.fecha });
  assert.equal(filas.length, 1); assert.equal(Number(filas[0].valor), 1440); assert.equal(filas[0].fuente, 'BNA');
  await assert.rejects(sincronizarCotizacion(ctx.db, { buscar: async () => ({ ok: true, json: async () => ({ venta: 'x' }) }) }), /inválida/);
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  assert.equal((await dir.llamar('GET', '/api/cotizacion')).json().valor, 1440);
});
