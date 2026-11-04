import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar } from './ayuda.js';
import { cronograma, cuotaMes, acumuladoHasta, recalcularEquipo, recalcularTodos } from '../src/lib/amortizacion.js';

const suma = (filas) => Math.round(filas.reduce((t, f) => t + f.importe, 0) * 100) / 100;
const equipoBase = (extra = {}) => ({ id: 1, estado: 'instalado', fecha_adquisicion: null, vida_util_meses: 36, created_at: '2026-01-01', ...extra });

test('las cuotas suman exactamente el costo, sin centavos perdidos', () => {
  for (const costo of [650, 1200, 999.99, 0.5, 333.33]) {
    let t = 0; for (let i = 0; i < 36; i += 1) t += cuotaMes(costo, 36, i);
    assert.equal(Math.round(t * 100) / 100, costo);
    assert.equal(acumuladoHasta(costo, 36, 35), costo); assert.equal(acumuladoHasta(costo, 36, -1), 0);
  }
  assert.equal(cuotaMes(650, 36, 36), 0); // pasada la vida útil no se carga nada
});

test('un equipo que pasa por varios negocios: cada uno carga sus meses y la flota los del depósito (caso del diseño)', () => {
  const e = equipoBase({ id: 9 });
  const asigs = [
    { desde: '2026-01-01', hasta: '2027-12-31', contrato_id: 1, cliente_id: 10 }, // 24 meses
    { desde: '2028-04-01', hasta: '2028-12-31', contrato_id: 2, cliente_id: 20 }, // 9 meses; enero a marzo 2028 en depósito
  ];
  const { filas } = cronograma(e, asigs, 650, { hasta: '2030-01-15' });
  const de = (c) => suma(filas.filter((f) => f.cliente_id === c));
  assert.equal(de(10), 433.33); assert.equal(de(20), 162.5); assert.equal(de(null), 54.17);
  assert.equal(suma(filas), 650); // nada se cuenta de más ni de menos
  assert.equal(filas.filter((f) => f.mes > '2028-12').length, 0, 'después de los 36 meses el equipo no suma costo');
});

test('un mes partido entre dos titulares se reparte por días y suma la cuota del mes', () => {
  const e = equipoBase();
  const asigs = [{ desde: '2026-01-01', hasta: '2026-01-15', contrato_id: 1, cliente_id: 10 }, { desde: '2026-01-16', hasta: null, contrato_id: 2, cliente_id: 20 }];
  const { filas } = cronograma(e, asigs, 360, { hasta: '2026-01-31' });
  assert.equal(suma(filas), 10); assert.equal(filas.length, 2);
  assert.equal(filas.find((f) => f.cliente_id === 10).importe, 4.84); assert.equal(filas.find((f) => f.cliente_id === 20).importe, 5.16);
});

test('la baja pasa a pérdida de la flota el valor que faltaba amortizar', () => {
  const e = equipoBase({ estado: 'baja', fecha_baja: '2026-09-10' });
  const asigs = [{ desde: '2026-01-01', hasta: '2026-08-31', contrato_id: 1, cliente_id: 10 }];
  const r = cronograma(e, asigs, 650, { hasta: '2026-12-01' });
  assert.equal(suma(r.filas) + r.perdida.importe, 650);
  assert.equal(r.filas.at(-1).mes, '2026-09'); // amortiza hasta el mes de la baja
  assert.equal(r.perdida.fecha, '2026-09-10');
  // un equipo ya amortizado por completo no deja pérdida
  const viejo = cronograma(equipoBase({ estado: 'baja', fecha_baja: '2030-05-01' }), asigs, 650, { hasta: '2030-06-01' });
  assert.equal(viejo.perdida, null); assert.equal(suma(viejo.filas), 650);
});

let ctx; let mes0;
before(async () => { ctx = await montar(); });
after(async () => { await ctx.cerrar(); });

test('recalcular es idempotente, no toca costos manuales y limpia lo que ya no corresponde', async () => {
  const db = ctx.db;
  const cli = (await db('clientes').insert({ razon_social: 'Cliente A', estado: 'activo' }))[0];
  const con = (await db('contratos').insert({ cliente_id: cli, nombre: 'C', estado: 'vigente', moneda: 'USD', fecha_inicio: '2026-01-01' }))[0];
  const mod = (await db('modelos_equipo').insert({ marca: 'Ricoh', modelo: 'IM', tipo: 'monocromo' }))[0];
  mes0 = '2026-01-01';
  const eq = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'AMO-1', estado: 'instalado', moneda: 'USD', costo_adquisicion: 360, costo_usd: 360, vida_util_meses: 36 }))[0];
  await db('asignaciones_equipo').insert({ equipo_id: eq, contrato_id: con, desde: mes0, contador_inicial_negro: 0, contador_inicial_color: 0 });
  await db('costos').insert({ fecha: '2026-02-01', concepto: 'Mano de obra', tipo: 'mano_de_obra', importe: 5, moneda: 'USD', importe_usd: 5, cliente_id: cli, origen: 'manual' });
  await recalcularEquipo(db, eq, { hasta: '2026-06-30' });
  const a = await db('costos').where({ equipo_id: eq, origen: 'amortizacion' }).orderBy('fecha');
  assert.equal(a.length, 6); assert.ok(a.every((k) => Number(k.importe_usd) === 10 && k.cliente_id === cli));
  await recalcularEquipo(db, eq, { hasta: '2026-06-30' }); await recalcularEquipo(db, eq, { hasta: '2026-06-30' });
  assert.equal((await db('costos').where({ equipo_id: eq, origen: 'amortizacion' })).length, 6, 'repetir no duplica');
  assert.equal((await db('costos').where({ origen: 'manual', cliente_id: cli })).length, 1, 'lo manual no se toca');
  // se retira al depósito a mitad de mes: lo que sigue es de la flota
  await db('asignaciones_equipo').where({ equipo_id: eq }).update({ hasta: '2026-06-15' });
  await recalcularEquipo(db, eq, { hasta: '2026-06-30' });
  const junio = await db('costos').where({ equipo_id: eq, origen: 'amortizacion' }).where('fecha', '2026-06-01');
  assert.equal(junio.length, 2); assert.equal(Number(junio.find((k) => k.cliente_id === cli).importe_usd), 5); assert.equal(Number(junio.find((k) => k.cliente_id === null).importe_usd), 5);
  // sin costo, no queda nada
  await db('equipos').where({ id: eq }).update({ costo_adquisicion: null, costo_usd: null });
  await recalcularTodos(db, { hasta: '2026-06-30' });
  assert.equal((await db('costos').where({ equipo_id: eq, origen: 'amortizacion' })).length, 0);
});

test('flota: costo del mes, pérdidas por baja y control de datos', async () => {
  const { entrar } = await import('./ayuda.js'); const { llamar } = await entrar(ctx.app, 'direccion@demo.local'); const db = ctx.db;
  const cli = (await db('clientes').insert({ razon_social: 'Cliente B', estado: 'activo' }))[0];
  const con = (await db('contratos').insert({ cliente_id: cli, nombre: 'CB', estado: 'vigente', moneda: 'USD', fecha_inicio: '2026-03-10' }))[0];
  const mod = (await db('modelos_equipo').insert({ marca: 'HP', modelo: 'LJ', tipo: 'monocromo' }))[0];
  const e1 = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'FLO-1', estado: 'deposito', moneda: 'USD', costo_adquisicion: 360, costo_usd: 360, vida_util_meses: 36, fecha_adquisicion: '2026-03-01' }))[0];
  const e2 = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'FLO-2', estado: 'instalado', moneda: 'USD' }))[0]; // instalado, sin costo
  await db('asignaciones_equipo').insert({ equipo_id: e2, contrato_id: con, desde: '2026-03-04', contador_inicial_negro: 0, contador_inicial_color: 0 }); // 6 días antes del contrato
  await recalcularEquipo(db, e1, { hasta: '2026-04-30' });
  const f = (await llamar('GET', '/api/flota?mes=2026-04')).json();
  assert.equal(f.amortizacion, 10); assert.equal(f.perdidas, 0); assert.equal(f.equipos_deposito >= 1, true);
  // baja: la pérdida va a la flota en el mes de la baja
  await db('equipos').where({ id: e1 }).update({ estado: 'baja', fecha_baja: '2026-04-20' });
  await recalcularEquipo(db, e1, { hasta: '2026-04-30' });
  const f2 = (await llamar('GET', '/api/flota?mes=2026-04')).json();
  assert.equal(f2.perdidas, 340); assert.equal(f2.total, 350); // 360 - 2 cuotas de 10 ya cargadas
  const rev = (await llamar('GET', '/api/flota/revision')).json();
  assert.ok(rev.sin_costo.some((x) => x.equipo.includes('FLO-2')), 'avisa del equipo instalado sin costo');
  assert.ok(rev.fechas.some((x) => x.equipo.includes('FLO-2') && x.contrato_inicio === '2026-03-10'), 'avisa de la instalación anterior al contrato');
  assert.equal((await (await entrar(ctx.app, 'matias@demo.local')).llamar('GET', '/api/flota')).statusCode, 403);
});

test('mover instalar, retirar y dar de baja recalcula la amortización solo', async () => {
  const { entrar } = await import('./ayuda.js'); const { llamar } = await entrar(ctx.app, 'direccion@demo.local'); const db = ctx.db;
  const cli = (await db('clientes').insert({ razon_social: 'Cliente C', estado: 'activo' }))[0];
  const con = (await db('contratos').insert({ cliente_id: cli, nombre: 'CC', estado: 'vigente', moneda: 'USD', fecha_inicio: '2026-01-01' }))[0];
  const mod = (await db('modelos_equipo').insert({ marca: 'Xerox', modelo: 'B310', tipo: 'monocromo' }))[0];
  const e = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'MOV-1', estado: 'deposito', moneda: 'USD' }))[0];
  assert.equal((await llamar('PATCH', `/api/equipos/${e}/costo`, { costo_adquisicion: 360, moneda: 'USD' })).statusCode, 200);
  assert.equal((await llamar('POST', `/api/equipos/${e}/mover`, { accion: 'instalar', contrato_id: con, contador_negro: 0 })).statusCode, 200);
  const k = () => db('costos').where({ equipo_id: e, origen: 'amortizacion' });
  const suma10 = async () => Math.round((await k()).reduce((t, x) => t + Number(x.importe_usd), 0) * 100) / 100;
  assert.equal(await suma10(), 10, 'la cuota del mes se reparte entera'); assert.ok((await k()).some((x) => x.cliente_id === cli), 'el cliente carga desde que lo tiene');
  assert.equal((await llamar('POST', `/api/equipos/${e}/mover`, { accion: 'retirar', destino: 'deposito', contador_negro: 0 })).statusCode, 200);
  assert.equal(await suma10(), 10); assert.ok((await k().whereNull('cliente_id')).length >= 1, 'lo que no tuvo el cliente va a la flota');
  assert.equal((await llamar('POST', `/api/equipos/${e}/mover`, { accion: 'baja', motivo: 'Sin arreglo' })).statusCode, 200);
  const p = await k().where({ tipo: 'perdida' }); assert.equal(p.length, 1); assert.equal(p[0].cliente_id, null); assert.equal(Number(p[0].importe_usd), 350);
});

test('migración: alinea con el contrato una instalación con un día de diferencia, y no toca otras', async () => {
  const { up } = await import('../migrations/20261111_027_alinear_instalaciones.js'); const db = ctx.db;
  const cli = (await db('clientes').insert({ razon_social: 'Cliente D', estado: 'activo' }))[0];
  const con = (await db('contratos').insert({ cliente_id: cli, nombre: 'CD', estado: 'vigente', moneda: 'USD', fecha_inicio: '2026-11-04' }))[0];
  const mod = (await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'X', tipo: 'monocromo' }))[0];
  const a = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'ALI-1', estado: 'instalado', moneda: 'USD' }))[0];
  const b = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'ALI-2', estado: 'instalado', moneda: 'USD' }))[0];
  for (const [e, d] of [[a, '2026-11-03'], [b, '2026-10-20']]) {
    await db('asignaciones_equipo').insert({ equipo_id: e, contrato_id: con, desde: d, contador_inicial_negro: 0, contador_inicial_color: 0 });
    await db('lecturas_contador').insert({ equipo_id: e, fecha: d, periodo: d.slice(0, 7), contador_negro: 0, contador_color: 0, origen: 'tecnico' });
  }
  await up(db);
  const f = async (e) => String((await db('asignaciones_equipo').where({ equipo_id: e }).first()).desde).slice(0, 10);
  assert.equal(await f(a), '2026-11-04'); assert.equal(await f(b), '2026-10-20', 'diferencia mayor a un día: no se toca');
  assert.equal(String((await db('lecturas_contador').where({ equipo_id: a }).first()).fecha).slice(0, 10), '2026-11-04');
});
