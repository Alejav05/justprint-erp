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

test('reemplazo por falla: el cliente sigue con su cuota, la flota absorbe la pérdida y la diferencia, y el contrato no cambia', async () => {
  const { entrar } = await import('./ayuda.js'); const { llamar } = await entrar(ctx.app, 'direccion@demo.local'); const db = ctx.db;
  const hoyS = new Date().toISOString().slice(0, 7);
  const cli = (await db('clientes').insert({ razon_social: 'Cliente R', estado: 'activo' }))[0];
  const con = (await db('contratos').insert({ cliente_id: cli, nombre: 'CR', estado: 'vigente', moneda: 'USD', fecha_inicio: '2026-01-01' }))[0];
  const mod = (await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'R', tipo: 'monocromo' }))[0];
  const a = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'REP-A', estado: 'instalado', moneda: 'USD', costo_adquisicion: 360, costo_usd: 360, vida_util_meses: 36, fecha_adquisicion: '2026-01-01' }))[0];
  const b = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'REP-B', estado: 'deposito', moneda: 'USD', costo_adquisicion: 720, costo_usd: 720, vida_util_meses: 36 }))[0];
  await db('asignaciones_equipo').insert({ equipo_id: a, contrato_id: con, desde: '2026-01-01', contador_inicial_negro: 0, contador_inicial_color: 0 });
  const r = await llamar('POST', `/api/equipos/${a}/reemplazar`, { nuevo_equipo_id: b, motivo: 'perdida', contador_negro: 100, nuevo_contador_negro: 0 });
  assert.equal(r.statusCode, 200); assert.equal(r.json().continua.cuota, 10);
  assert.equal((await db('equipos').where({ id: a }).first()).estado, 'baja'); assert.equal((await db('equipos').where({ id: b }).first()).estado, 'instalado');
  const asig = await db('asignaciones_equipo').where({ equipo_id: b }).first(); assert.equal(asig.contrato_id, con); assert.equal(Number(asig.cuota_continuada_usd), 10); assert.equal(asig.reemplaza_equipo_id, a);
  const mesB = await db('costos').where({ equipo_id: b, origen: 'amortizacion' }).where('fecha', `${hoyS}-01`);
  const cliente = mesB.filter((k) => k.cliente_id === cli).reduce((t, k) => t + Number(k.importe_usd), 0); const flota = mesB.filter((k) => k.cliente_id === null).reduce((t, k) => t + Number(k.importe_usd), 0);
  assert.ok(Math.abs(cliente - 10 * (mesB.length ? 1 : 0)) <= 10 + 0.01 && cliente <= 10.01, 'el cliente no paga más que su cuota original');
  assert.ok(Math.abs(cliente + flota - 20) < 0.02, 'cliente + flota = cuota del equipo nuevo (20)');
  const perdida = await db('costos').where({ equipo_id: a, tipo: 'perdida' }).first(); assert.equal(perdida.cliente_id, null); assert.ok(Number(perdida.importe_usd) > 0);
  // el reemplazo no es una inversión del cliente
  const neg = (await llamar('GET', `/api/clientes/${cli}/negocio`)).json(); assert.equal(neg.recupero.invertido, 360);
  // un equipo ocupado no sirve de reemplazo
  assert.equal((await llamar('POST', `/api/equipos/${b}/reemplazar`, { nuevo_equipo_id: a, motivo: 'garantia', contador_negro: 5, nuevo_contador_negro: 0 })).statusCode, 409);
});

test('el costo del equipo cargado de una vez se da de baja al pasar a amortización y la flota avisa de los nuevos', async () => {
  const { up } = await import('../migrations/20261113_029_costo_equipo_duplicado.js'); const { entrar } = await import('./ayuda.js'); const db = ctx.db;
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  const cli = (await db('clientes').insert({ razon_social: 'Cliente E', estado: 'activo' }))[0];
  const mod = (await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'E', tipo: 'monocromo' }))[0];
  const e = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'DUP-1', estado: 'deposito', moneda: 'USD', costo_adquisicion: 900, costo_usd: 900 }))[0];
  const k = (await db('costos').insert({ fecha: '2026-09-22', concepto: 'Equipo nuevo Brother', tipo: 'amortizacion', importe: 900, moneda: 'USD', importe_usd: 900, cliente_id: cli, equipo_id: e, origen: 'importacion' }))[0];
  const ins = (await db('costos').insert({ fecha: '2026-09-22', concepto: 'Toner', tipo: 'insumo', importe: 50, moneda: 'USD', importe_usd: 50, cliente_id: cli, equipo_id: e, origen: 'importacion' }))[0];
  assert.ok((await llamar('GET', '/api/flota/revision')).json().duplicados.some((x) => x.equipo.includes('DUP-1')));
  await up(db);
  assert.ok((await db('costos').where({ id: k }).first()).deleted_at, 'el costo de una vez se da de baja'); assert.equal((await db('costos').where({ id: ins }).first()).deleted_at, null, 'los insumos no se tocan');
  assert.equal((await llamar('GET', '/api/flota/revision')).json().duplicados.some((x) => x.equipo.includes('DUP-1')), false);
});

test('al retirar un equipo queda como referencia lo que le faltaba amortizar, y el negocio expone las dos miradas', async () => {
  const { entrar } = await import('./ayuda.js'); const { llamar } = await entrar(ctx.app, 'direccion@demo.local'); const db = ctx.db;
  const cli = (await db('clientes').insert({ razon_social: 'Cliente V', estado: 'activo' }))[0];
  const con = (await db('contratos').insert({ cliente_id: cli, nombre: 'CV', estado: 'vigente', moneda: 'USD', fecha_inicio: '2026-01-01' }))[0];
  const mod = (await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'V', tipo: 'monocromo' }))[0];
  const e = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'VAL-1', estado: 'deposito', moneda: 'USD', costo_adquisicion: 360, costo_usd: 360, vida_util_meses: 36, fecha_adquisicion: '2026-01-01' }))[0];
  await db('asignaciones_equipo').insert({ equipo_id: e, contrato_id: con, desde: '2026-01-01', hasta: '2026-06-30', contador_inicial_negro: 0, contador_inicial_color: 0 });
  await recalcularEquipo(db, e, { hasta: '2026-06-30' });
  const c = (await llamar('GET', `/api/equipos/${e}/costo`)).json(); assert.equal(c.retiros.length, 1); assert.equal(c.retiros[0].valor_en_libros, 300); // 360 - 6 cuotas de 10
  const n = (await llamar('GET', `/api/clientes/${cli}/negocio`)).json(); assert.equal(n.equipos[0].retirado.valor_en_libros, 300);
  assert.ok(n.serie.every((s) => 'acum_recupero' in s && 'recupero' in s));
});

test('la foto del negocio: gastos por rubro con el equipo completo y con el equipo amortizado, y el ritmo sin el mes de arranque', async () => {
  const { entrar } = await import('./ayuda.js'); const { llamar } = await entrar(ctx.app, 'direccion@demo.local'); const db = ctx.db;
  const h = new Date(); const mes = (n) => { const t = h.getFullYear() * 12 + h.getMonth() - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  await db('cotizaciones_usd').insert({ fecha: `${mes(0)}-01`, valor: 1500, fuente: 'BNA' }).catch(() => {});
  const cli = (await db('clientes').insert({ razon_social: 'Cliente F', estado: 'activo' }))[0];
  const con = (await db('contratos').insert({ cliente_id: cli, nombre: 'CF', estado: 'vigente', moneda: 'USD', fecha_inicio: `${mes(2)}-01` }))[0];
  const mod = (await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'F', tipo: 'monocromo' }))[0];
  const e = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'FOT-1', estado: 'instalado', moneda: 'USD' }))[0];
  await db('asignaciones_equipo').insert({ equipo_id: e, contrato_id: con, desde: `${mes(2)}-01`, contador_inicial_negro: 0, contador_inicial_color: 0 });
  await db('lecturas_contador').insert({ equipo_id: e, fecha: `${mes(0)}-02`, periodo: mes(0), contador_negro: 3000, contador_color: 0, origen: 'tecnico' });
  assert.equal((await llamar('PATCH', `/api/equipos/${e}/costo`, { costo_adquisicion: 720, costo_accesorios: 36, moneda: 'USD' })).json().costo_usd, 756);
  await db('costos').insert([{ fecha: `${mes(2)}-05`, concepto: 'Kit', tipo: 'insumo', importe: 600, moneda: 'USD', importe_usd: 600, cliente_id: cli, equipo_id: e, origen: 'importacion' }, { fecha: `${mes(2)}-05`, concepto: 'Instalación', tipo: 'mano_de_obra', importe: 100, moneda: 'USD', importe_usd: 100, cliente_id: cli, equipo_id: e, origen: 'importacion' }]);
  for (const n of [2, 1, 0]) await db('facturas').insert({ cliente_id: cli, contrato_id: con, periodo: mes(n), estado: 'cobrada', fecha_emision: `${mes(n)}-05`, neto_usd: 100, total: 100, moneda: 'USD' });
  const n = (await llamar('GET', `/api/clientes/${cli}/negocio`)).json();
  assert.deepEqual([n.foto.ingresos, n.foto.completa.equipo, n.foto.completa.insumos, n.foto.completa.mano_de_obra, n.foto.completa.total, n.foto.completa.rentabilidad], [300, 756, 600, 100, 1456, -1156]);
  assert.deepEqual([n.foto.amortizada.equipo, n.foto.amortizada.total, n.foto.amortizada.rentabilidad], [63, 763, -463]);
  assert.equal(n.foto.arranque_insumos, 600); assert.equal(n.recupero.acumulado, -1156);
  assert.deepEqual([n.ritmo.meses_base, n.ritmo.aporte_operativo, n.ritmo.aporte_mensual, n.ritmo.margen, n.ritmo.meses_para_recuperar, n.ritmo.mes_desde_inicio], [2, 100, 79, 79, 12, 15]);
  assert.equal(n.equipos[0].costo_operativo, 700); assert.equal(n.equipos[0].paginas, 3000); assert.equal(n.equipos[0].costo_pagina, 0.2333);
});

test('un accesorio que entró como insumo por remito pasa al costo del equipo y no se cuenta dos veces', async () => {
  const { entrar } = await import('./ayuda.js'); const { llamar } = await entrar(ctx.app, 'direccion@demo.local'); const db = ctx.db;
  const cli = (await db('clientes').insert({ razon_social: 'Cliente G', estado: 'activo' }))[0];
  const con = (await db('contratos').insert({ cliente_id: cli, nombre: 'CG', estado: 'vigente', moneda: 'USD', fecha_inicio: '2026-01-01' }))[0];
  const mod = (await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'G', tipo: 'monocromo' }))[0];
  const e = (await db('equipos').insert({ modelo_id: mod, numero_serie: 'ACC-1', estado: 'instalado', moneda: 'USD' }))[0];
  await db('asignaciones_equipo').insert({ equipo_id: e, contrato_id: con, desde: '2026-01-01', contador_inicial_negro: 0, contador_inicial_color: 0 });
  const k = (await db('costos').insert({ fecha: '2026-01-05', concepto: 'LT-340 — Bandeja', tipo: 'insumo', importe: 36, moneda: 'USD', importe_usd: 36, cliente_id: cli, equipo_id: e, origen: 'remito' }))[0];
  assert.equal((await llamar('POST', `/api/costos/${k}/pasar-a-accesorio`)).json().error, 'equipo_sin_costo'); // primero el costo del equipo
  await llamar('PATCH', `/api/equipos/${e}/costo`, { costo_adquisicion: 324, moneda: 'USD' });
  const r = await llamar('POST', `/api/costos/${k}/pasar-a-accesorio`); assert.equal(r.statusCode, 200); assert.equal(r.json().accesorios, 36);
  assert.ok((await db('costos').where({ id: k }).first()).deleted_at, 'el insumo del remito se da de baja');
  const c = (await llamar('GET', `/api/equipos/${e}/costo`)).json(); assert.equal(c.costo_usd, 360); assert.equal(c.costo_accesorios, 36);
  assert.equal((await llamar('POST', `/api/costos/${k}/pasar-a-accesorio`)).statusCode, 404, 'no se puede pasar dos veces');
});

test('la versión del servidor y la del navegador coinciden, y el código se revalida siempre', async () => {
  const { readFileSync } = await import('node:fs'); const { VERSION } = await import('../src/version.js');
  assert.equal(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').match(/VERSION_CLIENTE = '([^']+)'/)[1], VERSION);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/salud' })).json().version, VERSION);
  assert.match((await ctx.app.inject({ method: 'GET', url: '/app.js' })).headers['cache-control'], /max-age=0/); // el código se revalida siempre
});
