import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horasHabiles, sumarHorasHabiles } from '../src/lib/sla.js';

// Hora de Buenos Aires -> instante UTC (UTC-3).
const BA = (s) => Date.parse(`${s}-03:00`);
const aBA = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const J = { desde: 9, hasta: 18 };

test('las horas hábiles cuentan solo la jornada y saltean fines de semana', () => {
  assert.equal(horasHabiles(BA('2026-10-20T10:00'), BA('2026-10-20T15:30'), new Set(), J), 5.5);
  assert.equal(horasHabiles(BA('2026-10-23T17:00'), BA('2026-10-26T10:00'), new Set(), J), 2, 'viernes 17-18 y lunes 9-10');
  assert.equal(horasHabiles(BA('2026-10-24T10:00'), BA('2026-10-25T18:00'), new Set(), J), 0, 'sábado y domingo');
  assert.equal(horasHabiles(BA('2026-10-20T20:00'), BA('2026-10-21T08:00'), new Set(), J), 0, 'fuera de horario');
});

test('los feriados no cuentan', () => {
  const feriados = new Set(['2026-10-12']);
  assert.equal(horasHabiles(BA('2026-10-09T17:00'), BA('2026-10-13T10:00'), feriados, J), 2, 'viernes 17-18 y martes 9-10; el lunes 12 es feriado');
});

test('el vencimiento del SLA se calcula sobre la jornada', () => {
  // Viernes 17:00 + 24 hs hábiles: 1 (vie) + 9 (lun) + 9 (mar) + 5 (mié 9-14).
  assert.equal(aBA(sumarHorasHabiles(BA('2026-10-23T17:00'), 24, new Set(), J)), '2026-10-28 14:00');
  assert.equal(aBA(sumarHorasHabiles(BA('2026-10-24T11:00'), 2, new Set(), J)), '2026-10-26 11:00', 'abierto un sábado: corre desde el lunes');
  assert.equal(aBA(sumarHorasHabiles(BA('2026-10-20T10:00'), 3, new Set(), J)), '2026-10-20 13:00');
});

test('sumar y restar son inversos', () => {
  const inicio = BA('2026-10-21T15:20');
  const fin = sumarHorasHabiles(inicio, 30, new Set(['2026-11-02']), J);
  assert.ok(Math.abs(horasHabiles(inicio, fin, new Set(['2026-11-02']), J) - 30) < 1e-9);
});

test('con jornada de 24 horas, una hora hábil es una hora corrida de un día hábil', () => {
  const T = { desde: 0, hasta: 24 };
  assert.equal(aBA(sumarHorasHabiles(BA('2026-10-23T12:00'), 24, new Set(), T)), '2026-10-26 12:00', 'viernes 12 + 24 h hábiles = lunes 12');
});

import { sincronizarFeriados } from '../src/lib/feriados.js';
import { montar } from './ayuda.js';

test('los feriados se sincronizan desde la API: nuevos entran, los puentes no frenan el SLA, y lo editado a mano se respeta', async () => {
  const c = await montar();
  const falsa = (lista, ok = true) => async () => ({ ok, status: ok ? 200 : 503, json: async () => lista });
  await c.db('feriados').where({ fecha: '2026-03-23' }).update({ no_habil: true }); // el usuario decidió contar este puente como no hábil
  const lista = [
    { fecha: '2026-03-23', tipo: 'puente', nombre: 'Puente turístico no laborable' },
    { fecha: '2026-11-20', tipo: 'trasladable', nombre: 'Día de la Soberanía Nacional' },
    { fecha: '2026-12-07', tipo: 'puente', nombre: 'Puente' },
    { fecha: 'basura', tipo: 'inamovible', nombre: 'x' },
  ];
  const r = await sincronizarFeriados(c.db, 2026, { buscar: falsa(lista) });
  assert.equal(r.recibidos, 4);
  assert.equal((await c.db('feriados').where({ fecha: '2026-11-20' }).first()).no_habil, 1);
  assert.equal((await c.db('feriados').where({ fecha: '2026-03-23' }).first()).no_habil, 1, 'respeta la decisión manual');
  assert.equal((await c.db('feriados').where({ fecha: '2026-12-07' }).first()).no_habil, 0, 'puente: hábil por defecto');
  assert.equal(await c.db('feriados').where({ fecha: 'basura' }).first(), undefined);
  await assert.rejects(sincronizarFeriados(c.db, 2026, { buscar: falsa([], false) }), /503/);
  await c.cerrar();
});
