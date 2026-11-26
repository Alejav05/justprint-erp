import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';

let ctx; let equipo; let token;
before(async () => {
  ctx = await montar();
  const a = await ctx.db('asignaciones_equipo as a').join('equipos as e', 'e.id', 'a.equipo_id').join('contratos as c', 'c.id', 'a.contrato_id').where('e.numero_serie', 'PRUEBA-003').select('a.equipo_id', 'c.cliente_id').first();
  equipo = a.equipo_id;
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  token = (await dir.llamar('POST', '/api/contadores/agentes', { cliente_id: a.cliente_id, nombre: 'Sede' })).json().token;
  // Historia: unas 1.000 páginas por mes.
  for (const [per, fecha, n] of [['2026-07', '2026-07-30', 1000], ['2026-08', '2026-08-30', 2000], ['2026-09', '2026-09-29', 3000]]) {
    await ctx.db('lecturas_contador').insert({ equipo_id: equipo, fecha, periodo: per, contador_negro: n, contador_color: 0, origen: 'tecnico' });
  }
});
after(async () => { mock.timers.reset(); await ctx.cerrar(); });

const enviar = (negro) => ctx.app.inject({ method: 'POST', url: '/api/agente/v1/lecturas', payload: { lecturas: [{ serie: 'PRUEBA-003', negro, color: 0 }] }, headers: { authorization: `Bearer ${token}` } }).then((r) => r.json().resultados[0]);

test('un consumo muy por encima del habitual o en cero queda a revisar; uno normal entra solo', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-30T15:00:00Z') });
  assert.deepEqual(await enviar(3000).then((r) => [r.estado, r.motivo]), ['a_revisar', 'consumo_cero']);
  assert.deepEqual(await enviar(9000).then((r) => [r.estado, r.motivo]), ['a_revisar', 'consumo_alto']);
  assert.deepEqual(await enviar(4100).then((r) => [r.estado, r.motivo]), ['aprobada', null]);
});
