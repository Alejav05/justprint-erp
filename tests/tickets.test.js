import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar as entrarSinCache } from './ayuda.js';
import { aSql } from '../src/lib/sla.js';

let ctx; let ids;
const sesiones = new Map(); // el login tiene límite de intentos: una sesión por usuario
const entrar = async (app, email) => { if (!sesiones.has(email)) sesiones.set(email, await entrarSinCache(app, email)); return sesiones.get(email); };
before(async () => {
  ctx = await montar();
  const db = ctx.db;
  const prueba = (await db('clientes').where({ razon_social: 'Cliente Prueba SRL' }).first()).id;
  const equipo = (await db('equipos').where({ numero_serie: 'PRUEBA-003' }).first()).id;
  const [insumo] = await db('insumos').insert({ codigo: 'TN-T1', descripcion: 'Tóner negro TN-T1' });
  await db('movimientos_insumo').insert({ insumo_id: insumo, tipo: 'entrada', cantidad: 3 });
  const [mono] = await db('modelos_equipo').insert({ marca: 'Brother', modelo: 'MONO-1', tipo: 'monocromo' });
  const [eqMono] = await db('equipos').insert({ modelo_id: mono, numero_serie: 'MONO-001', estado: 'instalado' });
  const contrato = (await db('contratos').where({ cliente_id: prueba }).first()).id;
  await db('asignaciones_equipo').insert({ equipo_id: eqMono, contrato_id: contrato, desde: '2026-01-01' });
  ids = { prueba, equipo, insumo, eqMono, matias: (await db('usuarios').where({ email: 'matias@demo.local' }).first()).id, lucia: (await db('usuarios').where({ email: 'lucia@demo.local' }).first()).id };
});
after(async () => { await ctx.cerrar(); });

const crear = async (s, extra = {}) => (await s.llamar('POST', '/api/tickets', { cliente_id: ids.prueba, asunto: 'Prueba de ticket', ...extra }));

test('un ticket nuevo recibe número, SLA de 24 horas hábiles por la zona CABA y queda en el historial', async () => {
  const s = await entrar(ctx.app, 'sofia@demo.local');
  const r = await crear(s);
  assert.equal(r.statusCode, 201);
  const t = (await s.llamar('GET', `/api/tickets/${r.json().id}`)).json();
  assert.match(t.numero, /^T-\d{4}$/);
  assert.equal(t.sla_horas, 24);
  assert.ok(t.vence_sla > t.abierto_en);
  assert.equal(t.estado, 'abierto');
  assert.deepEqual(t.eventos.map((e) => e.tipo), ['creado']);
  assert.equal(t.sla.vencido, false);
});

test('en el resto del país el SLA es de 48 horas', async () => {
  const s = await entrar(ctx.app, 'sofia@demo.local');
  const [sede] = await ctx.db('sedes').insert({ cliente_id: ids.prueba, nombre: 'Sucursal Córdoba', zona: 'resto' });
  const id = (await crear(s, { sede_id: sede })).json().id;
  assert.equal((await ctx.db('tickets').where({ id }).first()).sla_horas, 48);
});

test('el alcance: el técnico ve solo lo suyo, Atención todo, Comercial lo de su cartera', async () => {
  const lista = async (email) => (await (await entrar(ctx.app, email)).llamar('GET', '/api/tickets?limite=100')).json().items.map((t) => t.numero);
  const matias = await lista('matias@demo.local');
  assert.ok(matias.includes('T-0412') && !matias.includes('T-0409') && !matias.includes('T-0411'));
  assert.ok((await lista('sofia@demo.local')).length >= 3);
  const nicolas = await lista('nicolas@demo.local');
  assert.ok(nicolas.includes('T-0412') && nicolas.includes('T-0409') && !nicolas.includes('T-0411'), 'Nicolás tiene Prueba y Juju, no Farmacia');
  const s = await entrar(ctx.app, 'matias@demo.local');
  const ajeno = await ctx.db('tickets').where({ numero: 'T-0409' }).first();
  assert.equal((await s.llamar('GET', `/api/tickets/${ajeno.id}`)).statusCode, 404);
  assert.equal((await s.llamar('POST', '/api/tickets', { cliente_id: ids.prueba, asunto: 'No debería' })).statusCode, 403);
});

test('asignar: solo quien tiene permiso, y solo a técnicos', async () => {
  const s = await entrar(ctx.app, 'sofia@demo.local');
  const id = (await crear(s)).json().id;
  assert.equal((await s.llamar('POST', `/api/tickets/${id}/asignar`, { tecnico_id: ids.matias })).statusCode, 403, 'Atención no asigna');
  const head = await entrar(ctx.app, 'head.tecnico@demo.local');
  assert.equal((await head.llamar('POST', `/api/tickets/${id}/asignar`, { tecnico_id: (await ctx.db('usuarios').where({ email: 'julia@demo.local' }).first()).id })).statusCode, 400, 'Julia no es técnica');
  const ok = await head.llamar('POST', `/api/tickets/${id}/asignar`, { tecnico_id: ids.matias, visita_en: '2026-10-27T13:00:00Z' });
  assert.equal(ok.statusCode, 200);
  const t = await ctx.db('tickets').where({ id }).first();
  assert.equal(t.estado, 'asignado'); assert.equal(t.asignado_a, ids.matias); assert.ok(t.visita_en);
});

test('esperar al cliente no detiene el reloj: el SLA corre desde la apertura hasta la resolución', async () => {
  const head = await entrar(ctx.app, 'head.tecnico@demo.local');
  const s = await entrar(ctx.app, 'sofia@demo.local');
  const id = (await crear(s)).json().id;
  await head.llamar('POST', `/api/tickets/${id}/asignar`, { tecnico_id: ids.matias });
  const mat = await entrar(ctx.app, 'matias@demo.local');
  const antes = (await ctx.db('tickets').where({ id }).first()).vence_sla;
  assert.equal((await mat.llamar('POST', `/api/tickets/${id}/estado`, { estado: 'esperando_cliente' })).statusCode, 200);
  assert.equal((await mat.llamar('POST', `/api/tickets/${id}/estado`, { estado: 'en_curso' })).statusCode, 200);
  const t = await ctx.db('tickets').where({ id }).first();
  assert.equal(t.vence_sla, antes);
  assert.ok(t.primera_respuesta_en);
  assert.equal((await mat.llamar('POST', `/api/tickets/${id}/estado`, { estado: 'resuelto' })).statusCode, 400, 'resolver solo se hace cerrando con el parte');
});

async function ticketDeMatias(equipo_id) {
  const head = await entrar(ctx.app, 'head.tecnico@demo.local');
  const s = await entrar(ctx.app, 'sofia@demo.local');
  const id = (await crear(s, equipo_id ? { equipo_id } : {})).json().id;
  await head.llamar('POST', `/api/tickets/${id}/asignar`, { tecnico_id: ids.matias });
  return id;
}
const FIRMA = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')}`;

test('el cierre genera parte, remito de servicio, lectura de contadores, baja de stock y conformidad; el ticket queda cerrado', async () => {
  const id = await ticketDeMatias(ids.equipo);
  const mat = await entrar(ctx.app, 'matias@demo.local');
  const r = await mat.llamar('POST', `/api/tickets/${id}/cierre`, {
    trabajo_realizado: 'Se reemplazó tóner y se limpió el rodillo', contador_negro: 1200, contador_color: 300,
    repuestos: [{ insumo_id: ids.insumo, cantidad: 1 }],
    conformidad: { nombre: 'Marcela Duarte', cargo: 'Administración', firma: FIRMA },
  });
  assert.equal(r.statusCode, 201, r.body);
  const out = r.json();
  assert.equal(out.estado, 'cerrado');
  assert.match(out.remito, /^\d{5}$/);
  const t = await ctx.db('tickets').where({ id }).first();
  assert.ok(t.resuelto_en && t.cerrado_en && t.horas_resolucion != null);
  assert.equal(t.sla_cumplido === 1 || t.sla_cumplido === true, true);
  assert.equal((await ctx.db('lecturas_contador').where({ equipo_id: ids.equipo, origen: 'tecnico' }).first()).contador_negro, 1200);
  const stock = await ctx.db('movimientos_insumo').where({ insumo_id: ids.insumo }).select('tipo', 'cantidad');
  assert.deepEqual(stock.map((m) => m.tipo), ['entrada', 'salida']);
  const remito = await ctx.db('remitos').where({ id: out.remito_id }).first();
  assert.equal(remito.estado, 'firmado'); assert.equal(remito.tipo, 'servicio');
  const conf = await ctx.db('conformidades').where({ documento_tipo: 'remito', documento_id: out.remito_id }).first();
  assert.equal(conf.firmante_nombre, 'Marcela Duarte'); assert.ok(conf.firma_archivo_id);
  assert.equal((await mat.llamar('POST', `/api/tickets/${id}/cierre`, { trabajo_realizado: 'otra vez' })).statusCode, 409, 'no se cierra dos veces');
});

test('sin conformidad el ticket queda resuelto, a la espera de la firma', async () => {
  const id = await ticketDeMatias(null);
  const mat = await entrar(ctx.app, 'matias@demo.local');
  const rr = await mat.llamar('POST', `/api/tickets/${id}/cierre`, { trabajo_realizado: 'Cliente no estaba para firmar' }); const out = rr.json();
  assert.equal(out.estado, 'resuelto');
  assert.equal((await ctx.db('remitos').where({ id: out.remito_id }).first()).estado, 'emitido');
});

test('el cierre es todo o nada: contador menor, equipo monocromo con color, firma inválida o falta de stock no guardan nada', async () => {
  const mat = await entrar(ctx.app, 'matias@demo.local');
  const contar = async () => ({ p: (await ctx.db('partes_tecnicos').count({ n: '*' }).first()).n, r: (await ctx.db('remitos').count({ n: '*' }).first()).n });
  const antes = await contar();

  let id = await ticketDeMatias(ids.equipo);
  const menor = await mat.llamar('POST', `/api/tickets/${id}/cierre`, { trabajo_realizado: 'Revisión', contador_negro: 100, contador_color: 300 });
  assert.equal(menor.statusCode, 409); assert.equal(menor.json().error, 'contador_menor_al_anterior');

  id = await ticketDeMatias(ids.eqMono);
  assert.equal((await mat.llamar('POST', `/api/tickets/${id}/cierre`, { trabajo_realizado: 'Revisión', contador_negro: 10, contador_color: 5 })).json().error, 'equipo_monocromo');

  id = await ticketDeMatias(ids.equipo);
  assert.equal((await mat.llamar('POST', `/api/tickets/${id}/cierre`, { trabajo_realizado: 'Revisión', conformidad: { nombre: 'X Y', firma: 'data:image/png;base64,AAAA' } })).json().error, 'firma_invalida');
  const sinStock = await mat.llamar('POST', `/api/tickets/${id}/cierre`, { trabajo_realizado: 'Revisión', repuestos: [{ insumo_id: ids.insumo, cantidad: 50 }] });
  assert.equal(sinStock.statusCode, 409); assert.equal(sinStock.json().error, 'sin_stock');

  assert.deepEqual(await contar(), antes, 'nada se guardó');
  assert.equal((await ctx.db('tickets').where({ id }).first()).estado, 'asignado');
});

test('un técnico no cierra tickets de otro', async () => {
  const id = await ticketDeMatias(null);
  const lucia = await entrar(ctx.app, 'lucia@demo.local');
  assert.equal((await lucia.llamar('POST', `/api/tickets/${id}/cierre`, { trabajo_realizado: 'Intento ajeno' })).statusCode, 404);
});

test('el SLA compara el mes actual contra el mes anterior y el histórico, y no cuenta lo migrado', async () => {
  const db = ctx.db;
  const ahora = Date.now();
  const inicioMes = new Date(); inicioMes.setUTCDate(1); inicioMes.setUTCHours(12, 0, 0, 0);
  const mesAnt = aSql(inicioMes.getTime() - 5 * 86400000);
  const mesViejo = aSql(inicioMes.getTime() - 70 * 86400000);
  const base = { cliente_id: ids.prueba, asunto: 'Histórico', estado: 'cerrado', asignado_a: ids.matias, sla_horas: 24, sla_medible: true };
  let n = 9000;
  const T = (resuelto, horas, cumplido, extra = {}) => db('tickets').insert({ ...base, numero: `H-${n++}`, abierto_en: '2026-01-02 12:00:00', resuelto_en: resuelto, horas_resolucion: horas, sla_cumplido: cumplido, ...extra });
  await db('tickets').where('numero', 'like', 'H-%').del();
  await db('tickets').update({ sla_medible: false }); // lo cerrado en los tests anteriores no entra en esta cuenta
  // Mes actual: 10 y 20 horas (1 de 2 en SLA). Mes anterior: 30 h. Histórico (todo lo previo al mes actual): 30 h y 10 h.
  await T(aSql(ahora), 10, true); await T(aSql(ahora), 20, true); await T(aSql(ahora), 40, false);
  await T(mesAnt, 30, false);
  await T(mesViejo, 10, true);
  await T(aSql(ahora), 500, false, { sla_medible: false }); // migrado: no cuenta
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const k = (await dir.llamar('GET', '/api/tableros/servicio')).json().sla;
  assert.equal(k.actual.n, 3); assert.equal(k.actual.horas_medias, 23.3); assert.equal(k.actual.pct_sla, 67);
  assert.equal(k.anterior.n, 1); assert.equal(k.anterior.horas_medias, 30);
  assert.equal(k.historico.n, 2); assert.equal(k.historico.horas_medias, 20); assert.equal(k.historico.pct_sla, 50);
  assert.equal(k.vs_anterior.horas_medias.delta, -6.7); assert.equal(k.vs_anterior.horas_medias.mejora, true);
  assert.equal(k.vs_historico.horas_medias.delta, 3.3); assert.equal(k.vs_historico.horas_medias.mejora, false);
  assert.equal(k.vs_anterior.pct_sla.delta, 67, 'de 0% a 67%'.length ? 67 : 0);
  assert.equal(k.historico.muestra_chica, true);
  const tablero = (await dir.llamar('GET', '/api/tableros/direccion')).json();
  assert.equal(tablero.sla.actual.n, 3, 'Dirección ve el mismo KPI en su tablero');
  await db('tickets').where('numero', 'like', 'H-%').del();
});

test('el tablero de Servicio: el técnico ve solo sus números, Atención no lo ve', async () => {
  const mat = await entrar(ctx.app, 'matias@demo.local');
  const r = (await mat.llamar('GET', '/api/tableros/servicio')).json();
  assert.deepEqual(r.tecnicos.map((x) => x.nombre), ['Matías (Técnico)']);
  assert.equal((await (await entrar(ctx.app, 'sofia@demo.local')).llamar('GET', '/api/tableros/servicio')).statusCode, 403);
  const head = (await (await entrar(ctx.app, 'head.tecnico@demo.local')).llamar('GET', '/api/tableros/servicio')).json();
  assert.ok(head.tecnicos.length >= 2);
});
