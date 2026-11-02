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
  const [insumo] = await db('insumos').insert({ codigo: 'TN-T1', descripcion: 'Tóner negro TN-T1', costo_referencia: 30, moneda: 'USD' });
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
  assert.match(t.numero, /^[A-Z]{3}-CL-\d{2}-TK\d{4}$/);
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
  assert.match(out.remito, /^0001-\d{8}$/);
  const t = await ctx.db('tickets').where({ id }).first();
  assert.ok(t.resuelto_en && t.cerrado_en && t.horas_resolucion != null);
  assert.equal(t.sla_cumplido === 1 || t.sla_cumplido === true, true);
  assert.equal((await ctx.db('lecturas_contador').where({ equipo_id: ids.equipo, origen: 'tecnico' }).first()).contador_negro, 1200);
  const stock = await ctx.db('movimientos_insumo').where({ insumo_id: ids.insumo }).select('tipo', 'cantidad');
  assert.deepEqual(stock.map((m) => m.tipo), ['entrada', 'salida']);
  const remito = await ctx.db('remitos').where({ id: out.remito_id }).first();
  assert.equal(remito.estado, 'firmado'); assert.equal(remito.tipo, 'servicio');
  const costo = await ctx.db('costos').where({ remito_id: out.remito_id }).first();
  assert.equal(Number(costo.importe_usd), 30, 'el repuesto usado se carga como costo del cliente'); assert.equal(costo.origen, 'remito'); assert.equal(costo.ticket_id, id);
  const conf = await ctx.db('conformidades').where({ documento_tipo: 'remito', documento_id: out.remito_id }).first();
  assert.equal(conf.firmante_nombre, 'Marcela Duarte'); assert.ok(await ctx.db('conformidad_firmas').where({ conformidad_id: conf.id }).first(), 'la firma queda en la base');
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

test('los tickets se numeran por cliente: CÓDIGO-CL-ID-TK0001, y el código se puede cambiar sin tocar los ya creados', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const [a] = await ctx.db('clientes').insert({ razon_social: 'Compañía Aconcagua S.A.', estado: 'activo' });
  const [b] = await ctx.db('clientes').insert({ razon_social: 'Estudio Rivarola', estado: 'activo' });
  const crear = async (cliente_id) => { const r = await dir.llamar('POST', '/api/tickets', { cliente_id, asunto: 'Prueba de numeración', descripcion: 'x' }); assert.equal(r.statusCode, 201, r.body); return (await ctx.db('tickets').where({ id: r.json().id }).first()).numero; };
  const n1 = await crear(a); const n2 = await crear(a); const m1 = await crear(b);
  assert.equal(n1, `ACO-CL-${String(a).padStart(2, '0')}-TK0001`); assert.equal(n2, `ACO-CL-${String(a).padStart(2, '0')}-TK0002`);
  assert.equal(m1, `EST-CL-${String(b).padStart(2, '0')}-TK0001`, 'cada cliente arranca en 1');
  assert.equal((await dir.llamar('PATCH', `/api/clientes/${a}`, { codigo_corto: 'cia' })).statusCode, 200);
  assert.equal((await ctx.db('clientes').where({ id: a }).first()).codigo_corto, 'CIA');
  assert.equal((await dir.llamar('PATCH', `/api/clientes/${a}`, { codigo_corto: 'C1' })).statusCode, 400);
  assert.equal(await crear(a), `CIA-CL-${String(a).padStart(2, '0')}-TK0003`, 'el contador sigue; el código nuevo vale para los tickets nuevos');
  assert.equal((await ctx.db('tickets').where({ numero: n1 }).first()).numero, n1, 'los viejos no cambian');
});

test('el código corto no se repite: tres "Farmacias…" reciben códigos distintos y no se puede pisar uno existente', async () => {
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const ids = [];
  for (const n of ['Farmacias Mitre', 'Farmacias del Sur', 'Farmacias Norte']) ids.push((await ctx.db('clientes').insert({ razon_social: n, estado: 'activo' }))[0]);
  const codigos = [];
  for (const id of ids) {
    const r = await dir.llamar('POST', '/api/tickets', { cliente_id: id, asunto: 'Prueba', descripcion: 'x' }); assert.equal(r.statusCode, 201, r.body);
    codigos.push((await ctx.db('clientes').where({ id }).first()).codigo_corto);
  }
  assert.equal(new Set(codigos).size, 3, codigos.join(','));
  assert.equal(codigos[0], 'FAR');
  assert.equal((await dir.llamar('PATCH', `/api/clientes/${ids[1]}`, { codigo_corto: codigos[0] })).statusCode, 409);
});

test('el SLA corre solo en soporte técnico: instalación, retiro e insumos no se miden', async () => {
  const s = await entrar(ctx.app, 'sofia@demo.local');
  const sop = (await crear(s, { tipo: 'soporte' })).json().id;
  const ins = (await crear(s, { tipo: 'instalacion', asunto: 'Instalación programada' })).json().id;
  const ret = (await crear(s, { tipo: 'retiro', asunto: 'Retiro de equipo' })).json().id;
  const filas = await ctx.db('tickets').whereIn('id', [sop, ins, ret]).select('id', 'sla_horas', 'sla_medible', 'vence_sla');
  const por = Object.fromEntries(filas.map((f) => [f.id, f]));
  assert.ok(por[sop].sla_horas > 0 && por[sop].vence_sla && Boolean(por[sop].sla_medible));
  for (const id of [ins, ret]) { assert.equal(por[id].sla_horas, null); assert.equal(por[id].vence_sla, null); assert.ok(!por[id].sla_medible); }
  const lista = (await s.llamar('GET', '/api/tickets?limite=100')).json().items;
  assert.equal(lista.find((t) => t.id === ins).sla, null, 'la instalación no muestra SLA');
  assert.ok(lista.find((t) => t.id === sop).sla, 'el soporte sí');
  const venc = (await s.llamar('GET', '/api/tickets?vencidos=true&limite=100')).json().items;
  assert.ok(!venc.some((t) => t.id === ins));
});
