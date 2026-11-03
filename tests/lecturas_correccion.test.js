import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';

let ctx; let equipo; let l1; let l2;
before(async () => {
  ctx = await montar();
  const a = await ctx.db('asignaciones_equipo').whereNull('hasta').first(); equipo = a.equipo_id;
  await ctx.db('asignaciones_equipo').where({ id: a.id }).update({ desde: '2026-08-24', contador_inicial_negro: 0, contador_inicial_color: 0 });
  await ctx.db('lecturas_contador').where({ equipo_id: equipo }).delete();
  // Cómo quedó importado: la toma de fin de agosto con fecha del día de la importación, y la de septiembre tomada el 30/10 sin período.
  [l1] = await ctx.db('lecturas_contador').insert({ equipo_id: equipo, fecha: '2026-10-01', contador_negro: 138, contador_color: 266, origen: 'importacion' });
  [l2] = await ctx.db('lecturas_contador').insert({ equipo_id: equipo, fecha: '2026-10-30', contador_negro: 826, contador_color: 1117, origen: 'tecnico' });
  l1 = l1.id ?? l1; l2 = l2.id ?? l2;
});
after(async () => { await ctx.cerrar(); });
const consumo = async (cli, per) => (await cli.llamar('GET', `/api/contadores?periodo=${per}`)).json().clientes.flatMap((c) => c.contratos).flatMap((c) => c.equipos).find((e) => e.equipo_id === equipo);

test('corregir la fecha y el período de las lecturas deja a septiembre con la diferencia entre las dos tomas', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  // Antes: septiembre sin lectura y octubre con todo el contador.
  assert.equal((await consumo(dir, '2026-09')).consumo, null);
  assert.deepEqual((await consumo(dir, '2026-10')).consumo, { negro: 826, color: 1117, meses: 1 });

  assert.equal((await dir.llamar('PATCH', `/api/lecturas/${l1}`, { fecha: '2026-08-31' })).statusCode, 200);
  const r = await dir.llamar('PATCH', `/api/lecturas/${l2}`, { periodo: '2026-09' });
  assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().periodo, '2026-09');

  assert.deepEqual((await consumo(dir, '2026-08')).consumo, { negro: 138, color: 266, meses: 1 });
  assert.deepEqual((await consumo(dir, '2026-09')).consumo, { negro: 688, color: 851, meses: 1 });
  assert.equal((await consumo(dir, '2026-10')).consumo, null);
  const aud = await ctx.db('audit_log').where({ tabla: 'lecturas_contador', registro_id: String(l2) }).first();
  assert.ok(aud, 'queda auditado');
});

test('la corrección rechaza fechas futuras, períodos repetidos y lecturas fuera de orden', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  assert.equal((await dir.llamar('PATCH', `/api/lecturas/${l1}`, { fecha: '2999-01-01' })).json().error, 'fecha_futura');
  assert.equal((await dir.llamar('PATCH', `/api/lecturas/${l1}`, { fecha: '2026-09-15', periodo: '2026-09' })).json().error, 'periodo_ocupado');
  assert.equal((await dir.llamar('PATCH', `/api/lecturas/${l1}`, { fecha: '2026-10-31' })).json().error, 'contador_menor_al_anterior');
  assert.equal((await dir.llamar('PATCH', `/api/lecturas/${l2}`, { periodo: '2027-01' })).statusCode, 400);
  const sin = await entrar(ctx.app, 'julia@demo.local');
  assert.equal((await sin.llamar('PATCH', `/api/lecturas/${l1}`, { fecha: '2026-08-30' })).statusCode, 403);
});
