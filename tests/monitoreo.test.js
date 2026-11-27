import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';
import { diasRestantes } from '../src/lib/monitoreo.js';
import { ejecutarAlertas } from '../src/lib/alertas.js';

let ctx; let cliente; let equipos; let token;
const fijarHoy = (iso) => { mock.timers.reset(); mock.timers.enable({ apis: ['Date'], now: new Date(iso) }); };
const agente = (method, url, payload) => ctx.app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}`, 'x-agente-version': '1.4.0' } });
const toner = (nivel, extra = {}) => [{ nombre: 'Black Toner', tipo: 'toner', color: 'negro', nivel }, { nombre: 'Drum Unit', tipo: 'tambor', nivel: 60 }, ...(extra.residuos ? [{ nombre: 'Waste Toner Box', tipo: 'residuos', nivel: 5 }] : [])];

before(async () => {
  ctx = await montar();
  const a = await ctx.db('asignaciones_equipo as a').join('equipos as e', 'e.id', 'a.equipo_id').join('contratos as c', 'c.id', 'a.contrato_id').where('e.numero_serie', 'PRUEBA-003').select('c.cliente_id').first();
  cliente = a.cliente_id;
  fijarHoy('2026-11-27T12:00:00Z');
  equipos = await ctx.db('asignaciones_equipo as a').join('equipos as e', 'e.id', 'a.equipo_id').join('contratos as c', 'c.id', 'a.contrato_id')
    .where('c.cliente_id', cliente).where('c.estado', 'vigente').whereNull('a.hasta').select('e.id', 'e.numero_serie');
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  token = (await dir.llamar('POST', '/api/contadores/agentes', { cliente_id: cliente, nombre: 'Recepción' })).json().token;
});
after(async () => { mock.timers.reset(); await ctx.cerrar(); });

test('los días que quedan salen de cómo bajó el insumo desde la última reposición', () => {
  const h = (fecha, nivel) => ({ fecha, insumos: [{ nombre: 'K', nivel }] });
  // Bajó de 50 a 20 en 10 días: 3 por día, quedan unos 7.
  assert.equal(diasRestantes([h('2026-11-17', 50), h('2026-11-22', 35), h('2026-11-27', 20)], 'K', 20, '2026-11-27'), 7);
  // Se repuso el 20: el cálculo arranca ahí (de 100 a 80 en 7 días).
  assert.equal(diasRestantes([h('2026-11-10', 10), h('2026-11-20', 100), h('2026-11-27', 80)], 'K', 80, '2026-11-27'), 28);
  assert.equal(diasRestantes([h('2026-11-26', 40), h('2026-11-27', 39)], 'K', 39, '2026-11-27'), null, 'con menos de 3 días no se estima');
});

test('el agente manda el estado del día: se guarda solo para los equipos de JustPrint del cliente, uno por día', async () => {
  const [e1, e2] = equipos;
  // Historia: el equipo 1 venía bajando el toner; el equipo 2 se vio por última vez hace 4 días.
  for (const [fecha, nivel] of [['2026-11-13', 40], ['2026-11-20', 26]]) await ctx.db('estado_equipos').insert({ agente_id: 1, equipo_id: e1.id, fecha, insumos: JSON.stringify(toner(nivel)), errores: '[]' });
  if (e2) await ctx.db('estado_equipos').insert({ agente_id: 1, equipo_id: e2.id, fecha: '2026-11-23', insumos: JSON.stringify(toner(70)), errores: '[]' });
  const envio = { equipos: [
    { serie: e1.numero_serie.toLowerCase(), ip: '192.168.1.50', negro: 5000, color: 800, insumos: toner(12, { residuos: true }), errores: ['atasco', 'poco_papel', 'inventado'], estado: 'advertencia', mensaje: 'Atasco bandeja 1' },
    { serie: 'AJENA-1', ip: '192.168.1.99', total: 10, insumos: [] },
  ] };
  const r = await agente('POST', '/api/agente/v1/estado', envio);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), { recibidos: 2, guardados: 1 });
  // Una segunda corrida del mismo día actualiza el registro.
  await agente('POST', '/api/agente/v1/estado', envio);
  const filas = await ctx.db('estado_equipos').where({ equipo_id: e1.id, fecha: '2026-11-27' });
  assert.equal(filas.length, 1);
  assert.deepEqual(JSON.parse(filas[0].errores), ['atasco', 'poco_papel'], 'los errores desconocidos se descartan');
});

test('el panel muestra conexión, insumos con días restantes, errores a atender y la toma de cierre pendiente', async () => {
  const [e1, e2] = equipos;
  const tec = await entrar(ctx.app, 'matias@demo.local');
  const r = await tec.llamar('GET', '/api/monitoreo');
  assert.equal(r.statusCode, 200, r.body);
  const p = r.json();
  const c = p.clientes.find((x) => x.cliente_id === cliente);
  const eq1 = c.equipos.find((e) => e.equipo_id === e1.id);
  assert.equal(eq1.conexion, 'en_linea');
  const k = eq1.insumos.find((i) => i.nombre === 'Black Toner');
  assert.equal(k.bajo, true); assert.equal(k.dias, 6, 'de 40 a 12 en 14 días: 2 por día');
  assert.equal(eq1.insumos.find((i) => i.tipo === 'residuos').bajo, false, 'la caja de residuos no es un insumo a reponer');
  assert.deepEqual(eq1.alertas.map((a) => a.tipo).sort(), ['error', 'insumo_bajo']);
  assert.equal(eq1.alertas.find((a) => a.tipo === 'error').error, 'atasco');
  assert.equal(eq1.cierre.cargada, false); assert.equal(eq1.cierre.periodo, '2026-11');
  if (e2) {
    const eq2 = c.equipos.find((e) => e.equipo_id === e2.id);
    assert.equal(eq2.conexion, 'sin_conexion'); assert.equal(eq2.alertas[0].dias, 4);
  }
  assert.ok(p.resumen.insumo_bajo >= 1);
  // Sin permiso de monitoreo, no entra.
  const com = await entrar(ctx.app, 'nicolas@demo.local');
  assert.equal((await com.llamar('GET', '/api/monitoreo')).statusCode, 403);
});

test('las alertas de monitoreo avisan el insumo bajo, el error y el equipo sin conexión', async () => {
  await ejecutarAlertas(ctx.db, { ahora: Date.now() });
  const ev = await ctx.db('alertas_eventos').whereIn('regla', ['monitoreo_toner_bajo', 'monitoreo_error', 'monitoreo_sin_conexion', 'monitoreo_agente_caido']).select('regla', 'titulo');
  const reglas = new Set(ev.map((x) => x.regla));
  assert.ok(reglas.has('monitoreo_toner_bajo')); assert.ok(reglas.has('monitoreo_error'));
  if (equipos[1]) assert.ok(reglas.has('monitoreo_sin_conexion'));
  assert.ok(!reglas.has('monitoreo_agente_caido'), 'el agente se conectó hoy');
  assert.match(ev.find((x) => x.regla === 'monitoreo_toner_bajo').titulo, /Black Toner al 12%/);
});
