import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';

let ctx; let equipo; let contrato;
before(async () => {
  ctx = await montar();
  const a = await ctx.db('asignaciones_equipo').whereNull('hasta').first();
  equipo = a.equipo_id; contrato = a.contrato_id;
});
after(async () => { await ctx.cerrar(); });
const fila = (r) => r.json().clientes.flatMap((c) => c.contratos).flatMap((c) => c.equipos).find((e) => e.equipo_id === equipo);

test('una lectura cargada desde la ficha del equipo se ofrece para el mes que cerró y se ve en todos los módulos', async () => {
  try {
    const tec = await entrar(ctx.app, 'matias@demo.local');
    const hoy = new Date().toISOString().slice(0, 10);
    // Ficha del equipo: la lectura entra sin período. Dejamos el contador inicial como piso.
    const r = await tec.llamar('POST', `/api/equipos/${equipo}/lecturas`, { contador_negro: 500, contador_color: 50 });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id;
    const per = `${hoy.slice(0, 7)}`;
    const [a, m] = per.split('-').map(Number);
    const ant = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
    const lista = await tec.llamar('GET', `/api/contadores?periodo=${ant}`);
    const e = fila(lista);
    assert.equal(e.actual, null);
    assert.equal(e.candidata.id, id); assert.equal(e.candidata.negro, 500);
    const asig = await tec.llamar('POST', '/api/contadores/asignar', { periodo: ant, lectura_ids: [id] });
    assert.equal(asig.statusCode, 200, asig.body);
    assert.deepEqual(asig.json().asignadas, [id]);
    const despues = fila(await tec.llamar('GET', `/api/contadores?periodo=${ant}`));
    assert.equal(despues.actual.negro, 500); assert.equal(despues.candidata, null);
    // Ya asignada: no se puede volver a asignar, y la ficha del equipo muestra el período.
    assert.equal((await tec.llamar('POST', '/api/contadores/asignar', { periodo: ant, lectura_ids: [id] })).statusCode, 409);
    const ficha = (await tec.llamar('GET', `/api/equipos/${equipo}`)).json();
    assert.equal(ficha.lecturas.find((l) => l.contador_negro === 500).periodo, ant);
    // El filtro por cliente devuelve solo ese cliente.
    const cliente = (await ctx.db('contratos').where({ id: contrato }).first()).cliente_id;
    const f = await tec.llamar('GET', `/api/contadores?periodo=${ant}&cliente=${cliente}`);
    assert.equal(f.json().clientes.length, 1);
    // Corregir una lectura ya cargada (error de tipeo) cambia el valor en todos lados.
    const corr = await tec.llamar('POST', '/api/contadores/lecturas', { periodo: ant, lecturas: [{ equipo_id: equipo, contador_negro: 520, contador_color: 50 }] });
    assert.equal(corr.statusCode, 200, corr.body);
    assert.equal((await ctx.db('lecturas_contador').where({ equipo_id: equipo }).andWhere('contador_negro', '>=', 500)).length, 1);
    assert.equal((await tec.llamar('GET', `/api/equipos/${equipo}`)).json().lecturas.some((l) => l.contador_negro === 520), true);
  } finally { /* la base es de este archivo */ }
});

test('si un mes se facturó solo abono, el mes siguiente con lectura suma las franquicias de ambos', async () => {
  const jul = await entrar(ctx.app, 'julia@demo.local');
  const tec = await entrar(ctx.app, 'matias@demo.local');
  const cond = await ctx.db('contrato_condiciones').where({ contrato_id: contrato }).orderBy('vigente_desde', 'desc').first();
  const hoy = new Date().toISOString().slice(0, 7);
  const [a, m] = hoy.split('-').map(Number);
  const ant = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
  // El mes en curso se carga recién ahora; el anterior ya tiene su lectura (test anterior) y se salteó el que seguiría.
  const sig2 = `${a + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`; // un mes después del actual: la lectura base es la del mes que cerró (ant) y el actual quedó salteado
  const r = await tec.llamar('POST', '/api/contadores/lecturas', { periodo: sig2, lecturas: [{ equipo_id: equipo, contador_negro: 520 + (cond.franquicia_negro * 2) + 100, contador_color: 50 }] });
  assert.equal(r.statusCode, 200, r.body);
  const liq = (await jul.llamar('GET', `/api/facturacion/liquidacion?periodo=${sig2}`)).json().filas.find((f) => f.contrato_id === contrato);
  assert.equal(liq.meses_consumo, 2, `base=${ant}, actual=${sig2}`);
  assert.equal(liq.franquicia_negro, cond.franquicia_negro * 2);
  assert.equal(liq.excedente_negro, 100);
  assert.ok(liq.items.some((i) => /franquicia de 2 meses/.test(i.descripcion)));
});
