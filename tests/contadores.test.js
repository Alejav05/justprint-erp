import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';

let ctx; let equipo;
before(async () => {
  ctx = await montar();
  equipo = (await ctx.db('asignaciones_equipo').whereNull('hasta').first()).equipo_id;
});
after(async () => { await ctx.cerrar(); });

const periodo = (res) => res.json().clientes.flatMap((c) => c.contratos).flatMap((c) => c.equipos).find((e) => e.equipo_id === equipo);

test('la toma mensual lista los equipos pendientes y la carga los deja como cargados con su consumo', async () => {
  const tec = await entrar(ctx.app, 'matias@demo.local');
  const antes = await tec.llamar('GET', '/api/contadores?periodo=2026-10');
  assert.equal(antes.statusCode, 200);
  assert.equal(antes.json().resumen.cargados, 0);
  assert.equal(periodo(antes).actual, null);

  const r = await tec.llamar('POST', '/api/contadores/lecturas', { periodo: '2026-10', lecturas: [{ equipo_id: equipo, contador_negro: 1200, contador_color: 300, origen: 'cliente' }] });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().guardadas, [equipo]);

  const despues = await tec.llamar('GET', '/api/contadores?periodo=2026-10');
  assert.equal(despues.json().resumen.cargados, 1);
  const e = periodo(despues);
  assert.equal(e.actual.negro, 1200); assert.equal(e.actual.origen, 'cliente');
  assert.deepEqual(e.consumo, { negro: 1200, color: 300, meses: 1 }, 'sin lecturas previas cuenta desde el contador inicial (0)');
});

test('una lectura declarada para octubre pero tomada en noviembre factura octubre y no cuenta para noviembre', async () => {
  const jul = await entrar(ctx.app, 'julia@demo.local');
  const oct = (await jul.llamar('GET', '/api/facturacion/liquidacion?periodo=2026-10')).json().filas.find((f) => f.contrato_id === 1);
  assert.equal(oct.estado, 'completo');
  assert.deepEqual(oct.contadores, { total: 1, cargados: 1 });
  assert.equal(oct.consumo_negro, 1200);
  const nov = (await jul.llamar('GET', '/api/facturacion/liquidacion?periodo=2026-11')).json().filas.find((f) => f.contrato_id === 1);
  assert.equal(nov.estado, 'incompleto');
  assert.deepEqual(nov.contadores, { total: 1, cargados: 0 });
  // Se puede facturar sin contadores: queda solo el abono y no se exige la lectura.
  const sin = (await jul.llamar('GET', '/api/facturacion/liquidacion?periodo=2026-11&sin_contadores=true')).json().filas.find((f) => f.contrato_id === 1);
  assert.equal(sin.estado, 'completo'); assert.equal(sin.items.length, 1); assert.equal(sin.solo_abono, true); assert.deepEqual(sin.contadores, { total: 1, cargados: 0 });
  const conLect = (await jul.llamar('GET', '/api/facturacion/liquidacion?periodo=2026-10&sin_contadores=true')).json().filas.find((f) => f.contrato_id === 1);
  assert.equal(conLect.solo_abono, false); assert.equal(conLect.consumo_negro, 1200, 'con lecturas cargadas sigue cobrando el consumo aunque se permita facturar sin contadores');
});

test('los contadores no retroceden, la corrección queda entre la lectura anterior y la siguiente, y el error de una fila no frena a las demás', async () => {
  const tec = await entrar(ctx.app, 'matias@demo.local');
  const sept = await tec.llamar('POST', '/api/contadores/lecturas', { periodo: '2026-09', lecturas: [{ equipo_id: equipo, contador_negro: 900, contador_color: 100 }] });
  assert.equal(sept.statusCode, 409, 'septiembre quedaría por debajo de la de octubre ya cargada o de la última del equipo');
  assert.equal(sept.json().errores[0].error, 'contador_menor_al_anterior');

  const corr = await tec.llamar('POST', '/api/contadores/lecturas', { periodo: '2026-10', lecturas: [{ equipo_id: equipo, contador_negro: 1250, contador_color: 320 }, { equipo_id: 99999, contador_negro: 5 }] });
  assert.equal(corr.statusCode, 200);
  assert.deepEqual(corr.json().guardadas, [equipo]);
  assert.equal(corr.json().errores[0].error, 'equipo_no_disponible');
  assert.equal(await ctx.db('lecturas_contador').where({ equipo_id: equipo, periodo: '2026-10' }).count({ n: '*' }).then((x) => Number(x[0].n)), 1, 'corrige la misma lectura, no agrega otra');
  assert.equal(periodo(await tec.llamar('GET', '/api/contadores?periodo=2026-10')).actual.negro, 1250);

  const sinColor = await tec.llamar('POST', '/api/contadores/lecturas', { periodo: '2026-10', lecturas: [{ equipo_id: equipo, contador_negro: 1300 }] });
  assert.equal(sinColor.json().errores[0].error, 'contador_color_requerido');
});

test('quién puede ver y quién puede cargar', async () => {
  const jul = await entrar(ctx.app, 'julia@demo.local');
  assert.equal((await jul.llamar('GET', '/api/contadores?periodo=2026-10')).statusCode, 200);
  assert.equal((await jul.llamar('POST', '/api/contadores/lecturas', { periodo: '2026-10', lecturas: [{ equipo_id: equipo, contador_negro: 2000, contador_color: 400 }] })).statusCode, 403);
  const nico = await entrar(ctx.app, 'nicolas@demo.local');
  assert.equal((await nico.llamar('POST', '/api/contadores/lecturas', { periodo: '2026-10', lecturas: [{ equipo_id: equipo, contador_negro: 2000, contador_color: 400 }] })).statusCode, 403);
  assert.equal((await entrar(ctx.app, 'direccion@demo.local').then((d) => d.llamar('GET', '/api/contadores?periodo=2026-13'))).statusCode, 400);
});
