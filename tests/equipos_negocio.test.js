import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';
import { hoy } from '../src/lib/fechas.js';

let ctx; let cliente; let contrato; let sede; let equipo; let modelo;
const mes = (n) => { const [a, m] = hoy().slice(0, 7).split('-').map(Number); const t = a * 12 + (m - 1) - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
before(async () => {
  ctx = await montar(); const db = ctx.db;
  await db('cotizaciones_usd').insert({ fecha: hoy(), valor: 1500, fuente: 'BNA' });
  cliente = (await db('clientes').insert({ razon_social: 'Estudio Prueba', estado: 'activo' }))[0];
  sede = (await db('sedes').insert({ cliente_id: cliente, nombre: 'Principal', localidad: 'CABA', es_principal: true }))[0];
  contrato = (await db('contratos').insert({ cliente_id: cliente, nombre: 'Alquiler', estado: 'vigente', moneda: 'USD', fecha_inicio: `${mes(3)}-01` }))[0];
  modelo = (await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'HL-TEST', tipo: 'monocromo' }))[0];
  equipo = (await db('equipos').insert({ modelo_id: modelo, numero_serie: 'TEST-0001', estado: 'instalado', moneda: 'USD' }))[0];
  await db('asignaciones_equipo').insert({ equipo_id: equipo, contrato_id: contrato, sede_id: sede, desde: `${mes(3)}-01`, contador_inicial_negro: 0, contador_inicial_color: 0 });
  for (const [n, c] of [[2, 1000], [1, 2500], [0, 2700]]) await db('lecturas_contador').insert({ equipo_id: equipo, fecha: `${mes(n)}-20`, periodo: mes(n), contador_negro: c, contador_color: 0, origen: 'tecnico' });
});
after(async () => { await ctx.cerrar(); });

test('el costo del equipo se carga, se imputa una sola vez al negocio del cliente y es interno', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  assert.equal((await llamar('POST', `/api/equipos/${equipo}/imputar-costo`)).statusCode, 409); // todavía sin costo
  assert.equal((await llamar('PATCH', `/api/equipos/${equipo}/costo`, { costo_adquisicion: 600, moneda: 'USD' })).statusCode, 200);
  assert.equal((await llamar('GET', `/api/equipos/${equipo}`)).json().costo_adquisicion, undefined, 'la ficha del equipo no trae el costo');
  assert.equal((await llamar('GET', `/api/equipos/${equipo}/costo`)).json().costo_adquisicion, 600);
  const r = await llamar('POST', `/api/equipos/${equipo}/imputar-costo`); assert.equal(r.statusCode, 201); assert.equal(r.json().usd, 600);
  const k = await ctx.db('costos').where({ equipo_id: equipo, origen: 'equipo' }).first();
  assert.equal(k.cliente_id, cliente); assert.equal(k.contrato_id, contrato); assert.equal(k.tipo, 'equipo'); assert.equal(Number(k.importe_usd), 600);
  assert.equal((await llamar('POST', `/api/equipos/${equipo}/imputar-costo`)).json().error, 'ya_imputado');
  const neg = (await llamar('GET', `/api/clientes/${cliente}/negocio`)).json(); assert.equal(neg.totales.egresos, 600);
});

test('en pesos el costo se convierte con la cotización; sin permiso de costos no se ve ni se carga', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local'); const db = ctx.db;
  const e2 = (await db('equipos').insert({ modelo_id: modelo, numero_serie: 'TEST-0002', estado: 'instalado' }))[0];
  await db('asignaciones_equipo').insert({ equipo_id: e2, contrato_id: contrato, sede_id: sede, desde: `${mes(1)}-01`, contador_inicial_negro: 0, contador_inicial_color: 0 });
  await llamar('PATCH', `/api/equipos/${e2}/costo`, { costo_adquisicion: 300000, moneda: 'ARS' });
  assert.equal((await llamar('POST', `/api/equipos/${e2}/imputar-costo`)).json().usd, 200);
  const tec = await entrar(ctx.app, 'matias@demo.local');
  assert.equal((await tec.llamar('GET', `/api/equipos/${equipo}/costo`)).statusCode, 403);
  assert.equal((await tec.llamar('PATCH', `/api/equipos/${equipo}/costo`, { costo_adquisicion: 1, moneda: 'USD' })).statusCode, 403);
});

test('equipos del cliente: consumo mensual por equipo, con el contador inicial como base', async () => {
  const { llamar } = await entrar(ctx.app, 'direccion@demo.local');
  const r = (await llamar('GET', `/api/clientes/${cliente}/equipos`)).json();
  const e = r.equipos.find((x) => x.equipo_id === equipo); assert.ok(e); assert.equal(e.sede, 'Principal'); assert.equal(e.vigente, true);
  const por = Object.fromEntries(e.serie.map((s) => [s.periodo, s.negro]));
  assert.equal(por[mes(2)], 1000); assert.equal(por[mes(1)], 1500); assert.equal(por[mes(0)], 200); assert.equal(por[mes(3)], null);
  assert.equal(e.ultima_lectura.negro, 2700);
  assert.equal((await llamar('GET', '/api/clientes/999999/equipos')).statusCode, 404);
});
