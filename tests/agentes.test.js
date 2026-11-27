import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';
import { periodoDeCorte, contadoresPara } from '../src/lib/agentes.js';

let ctx; let equipo; let cliente; let token;
const fijarHoy = (iso) => { mock.timers.reset(); mock.timers.enable({ apis: ['Date'], now: new Date(iso) }); };
const agente = (method, url, payload, t = token) => ctx.app.inject({ method, url, payload, headers: { authorization: `Bearer ${t}`, 'x-agente-version': '1.0.0', 'x-agente-host': 'PC-RECEPCION' } });
const enviar = (lecturas, extra = {}) => agente('POST', '/api/agente/v1/lecturas', { lecturas, ...extra });

before(async () => {
  ctx = await montar();
  const a = await ctx.db('asignaciones_equipo as a').join('equipos as e', 'e.id', 'a.equipo_id').join('contratos as c', 'c.id', 'a.contrato_id').where('e.numero_serie', 'PRUEBA-003').select('a.equipo_id', 'c.cliente_id').first();
  equipo = a.equipo_id; cliente = a.cliente_id;
});
after(async () => { mock.timers.reset(); await ctx.cerrar(); });

test('el período de corte: fin de mes factura ese mes, la primera semana factura el anterior, a mitad de mes no es cierre', () => {
  assert.equal(periodoDeCorte('2026-10-28'), '2026-10');
  assert.equal(periodoDeCorte('2026-11-03'), '2026-10');
  assert.equal(periodoDeCorte('2026-01-05'), '2025-12');
  assert.equal(periodoDeCorte('2026-11-15'), null);
});

test('los contadores se completan con el total cuando el equipo informa solo uno de los dos', () => {
  assert.deepEqual(contadoresPara('monocromo', { total: 500 }), { negro: 500, color: 0 });
  assert.deepEqual(contadoresPara('color', { negro: 700, total: 1000 }), { negro: 700, color: 300 });
  assert.equal(contadoresPara('color', { total: 1000 }), null);
});

test('solo quien administra agentes los da de alta, y el token se entrega una vez', async () => {
  const tec = await entrar(ctx.app, 'matias@demo.local');
  assert.equal((await tec.llamar('POST', '/api/contadores/agentes', { cliente_id: cliente, nombre: 'Oficina central' })).statusCode, 403);
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const r = await dir.llamar('POST', '/api/contadores/agentes', { cliente_id: cliente, nombre: 'Oficina central' });
  assert.equal(r.statusCode, 201, r.body);
  token = r.json().token;
  assert.match(token, /^jpa_/);
  const lista = (await dir.llamar('GET', '/api/contadores/agentes')).json();
  assert.equal(lista.length, 1); assert.equal(lista[0].token_hash, undefined, 'el hash del token no sale de la base');
});

test('el agente se identifica con su token y recibe los equipos que se esperan del cliente', async () => {
  fijarHoy('2026-10-29T15:00:00Z');
  assert.equal((await agente('GET', '/api/agente/v1/config', null, 'jpa_cualquiera')).statusCode, 401);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/agente/v1/config' })).statusCode, 401);
  const r = await agente('GET', '/api/agente/v1/config');
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().corte.periodo, '2026-10');
  assert.deepEqual(r.json().equipos.map((e) => e.serie), ['PRUEBA-003']);
  const a = await ctx.db('agentes_contadores').first();
  assert.equal(a.version, '1.0.0'); assert.equal(a.equipo_host, 'PC-RECEPCION'); assert.ok(a.ultima_conexion);
});

test('una toma de prueba se registra pero no carga contadores', async () => {
  fijarHoy('2026-10-29T15:00:00Z');
  const r = await enviar([{ serie: 'PRUEBA-003', negro: 1000, color: 200 }], { prueba: true });
  assert.equal(r.json().resultados[0].estado, 'prueba');
  assert.equal((await ctx.db('lecturas_contador').where({ equipo_id: equipo })).length, 0);
});

test('una lectura limpia de fin de mes entra sola como automática del período; un equipo ajeno queda como no registrado', async () => {
  fijarHoy('2026-10-29T15:00:00Z');
  const r = await enviar([{ serie: 'prueba 003', ip: '192.168.1.50', negro: 1000, color: 200 }, { serie: 'XYZ999', ip: '192.168.1.60', total: 50 }]);
  assert.equal(r.statusCode, 200, r.body);
  const [ok, ajeno] = r.json().resultados;
  assert.equal(ok.estado, 'aprobada'); assert.equal(ok.periodo, '2026-10');
  assert.equal(ajeno.estado, 'no_registrado');
  const ls = await ctx.db('lecturas_contador').where({ equipo_id: equipo });
  assert.equal(ls.length, 1); assert.equal(ls[0].origen, 'automatica'); assert.equal(ls[0].periodo, '2026-10'); assert.equal(ls[0].contador_negro, 1000);

  const tec = await entrar(ctx.app, 'matias@demo.local');
  const vista = (await tec.llamar('GET', '/api/contadores?periodo=2026-10')).json();
  const e = vista.clientes.flatMap((c) => c.contratos).flatMap((c) => c.equipos).find((x) => x.equipo_id === equipo);
  assert.equal(e.actual.origen, 'automatica');
});

test('una toma posterior del mismo período reemplaza a la automática, pero si baja queda a revisar', async () => {
  fijarHoy('2026-11-02T15:00:00Z');
  const r = await enviar([{ serie: 'PRUEBA-003', negro: 1100, color: 250 }]);
  assert.equal(r.json().resultados[0].estado, 'aprobada'); assert.equal(r.json().resultados[0].periodo, '2026-10');
  const ls = await ctx.db('lecturas_contador').where({ equipo_id: equipo });
  assert.equal(ls.length, 1, 'corrige la misma lectura'); assert.equal(ls[0].contador_negro, 1100);
  const baja = await enviar([{ serie: 'PRUEBA-003', negro: 900, color: 250 }]);
  assert.deepEqual([baja.json().resultados[0].estado, baja.json().resultados[0].motivo], ['a_revisar', 'contador_menor_al_anterior']);
});

test('si ya hay una lectura cargada a mano, la del agente no la pisa', async () => {
  fijarHoy('2026-09-29T15:00:00Z');
  // Septiembre cargado a mano por un técnico antes de que llegue el agente.
  await ctx.db('lecturas_contador').insert({ equipo_id: equipo, fecha: '2026-09-28', contador_negro: 500, contador_color: 100, origen: 'tecnico', periodo: '2026-09' });
  const r = await enviar([{ serie: 'PRUEBA-003', negro: 510, color: 100 }]);
  assert.deepEqual([r.json().resultados[0].estado, r.json().resultados[0].motivo], ['rechazada', 'ya_tiene_lectura_manual']);
});

test('una toma de mitad de mes queda a revisar; se aprueba o se rechaza a mano', async () => {
  fijarHoy('2026-11-15T15:00:00Z');
  const r = await enviar([{ serie: 'PRUEBA-003', negro: 1300, color: 300 }]);
  assert.deepEqual([r.json().resultados[0].estado, r.json().resultados[0].motivo], ['a_revisar', 'fuera_de_fecha_de_corte']);
  const tec = await entrar(ctx.app, 'matias@demo.local');
  const pend = (await tec.llamar('GET', '/api/contadores/recibidas')).json();
  assert.equal(pend.length, 2);
  const mitad = pend.find((x) => x.motivo === 'fuera_de_fecha_de_corte'); const baja = pend.find((x) => x.motivo === 'contador_menor_al_anterior');
  assert.equal(mitad.ultima_del_equipo.negro, 1100);

  const ap = await tec.llamar('POST', `/api/contadores/recibidas/${mitad.id}/aprobar`, {});
  assert.equal(ap.statusCode, 200, ap.body);
  const l = await ctx.db('lecturas_contador').where({ id: ap.json().lectura_id }).first();
  assert.equal(l.periodo, '2026-11'); assert.equal(l.origen, 'automatica'); assert.equal(l.contador_negro, 1300);
  assert.equal((await tec.llamar('POST', `/api/contadores/recibidas/${mitad.id}/aprobar`, {})).statusCode, 409, 'no se aprueba dos veces');

  assert.equal((await tec.llamar('POST', `/api/contadores/recibidas/${baja.id}/aprobar`, {})).statusCode, 409, 'una lectura que retrocede no se puede aprobar tal cual');
  const sinPermiso = await entrar(ctx.app, 'julia@demo.local');
  assert.equal((await sinPermiso.llamar('POST', `/api/contadores/recibidas/${baja.id}/rechazar`, {})).statusCode, 403, 'Facturación ve pero no revisa');
  assert.equal((await tec.llamar('POST', `/api/contadores/recibidas/${baja.id}/rechazar`, {})).statusCode, 200);
  assert.equal((await tec.llamar('GET', '/api/contadores/recibidas')).json().length, 0);
});

test('la lectura de instalación o de retiro del mismo período no frena al agente: su toma entra como lectura nueva', async () => {
  fijarHoy('2026-12-29T15:00:00Z');
  // El técnico cargó la lectura de instalación unos días antes del cierre (sin período, como lo hace Equipos).
  const [inst] = await ctx.db('lecturas_contador').insert({ equipo_id: equipo, fecha: '2026-12-26', contador_negro: 2000, contador_color: 300, origen: 'tecnico', observaciones: 'Lectura de instalación' });
  const r = await enviar([{ serie: 'PRUEBA-003', negro: 2100, color: 350 }]);
  assert.equal(r.json().resultados[0].estado, 'aprobada', r.body); assert.equal(r.json().resultados[0].periodo, '2026-12');
  const dic = await ctx.db('lecturas_contador').where({ equipo_id: equipo }).where('fecha', '>=', '2026-12-01').orderBy('id');
  assert.equal(dic.length, 2, 'la de instalación queda como estaba');
  assert.equal(dic[0].id, inst); assert.equal(dic[0].contador_negro, 2000);
  assert.equal(dic[1].origen, 'automatica'); assert.equal(dic[1].contador_negro, 2100);
  // Por debajo de la de instalación no puede entrar sola.
  const baja = await enviar([{ serie: 'PRUEBA-003', negro: 1990, color: 350 }]);
  assert.equal(baja.json().resultados[0].estado, 'a_revisar');
});

test('las impresoras que no son de JustPrint arman el parque del cliente, con el volumen estimado entre tomas', async () => {
  fijarHoy('2026-12-30T15:00:00Z');
  await enviar([{ serie: 'xyz-999', ip: '192.168.1.61', marca: 'HP', modelo: 'LaserJet M404', total: 3050 }, { ip: '192.168.1.70', modelo: 'Impresora sin serie', total: 10 }]);
  const tec = await entrar(ctx.app, 'matias@demo.local');
  const r = await tec.llamar('GET', '/api/contadores/parque');
  assert.equal(r.statusCode, 200, r.body);
  const hp = r.json().find((x) => x.numero_serie === 'xyz-999');
  assert.ok(hp, 'agrupa por serie aunque venga escrita distinto');
  assert.equal(hp.tomas, 2); assert.equal(hp.marca, 'HP'); assert.equal(hp.visto_primero, '2026-10-29'); assert.equal(hp.contador_total, 3050);
  assert.equal(hp.paginas_por_mes, Math.round((3000 / 62) * 30));
  const sinSerie = r.json().find((x) => x.ip === '192.168.1.70');
  assert.equal(sinSerie.paginas_por_mes, null, 'con una sola toma no se estima');
  assert.ok(!r.json().some((x) => x.numero_serie === 'PRUEBA-003'), 'los equipos de JustPrint no aparecen');
});

test('un agente desactivado o con token renovado deja de entrar', async () => {
  fijarHoy('2026-11-28T15:00:00Z');
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  const id = (await ctx.db('agentes_contadores').first()).id;
  const nuevo = (await dir.llamar('POST', `/api/contadores/agentes/${id}/token`)).json().token;
  assert.equal((await agente('GET', '/api/agente/v1/config')).statusCode, 401);
  assert.equal((await agente('GET', '/api/agente/v1/config', null, nuevo)).statusCode, 200);
  await dir.llamar('PATCH', `/api/contadores/agentes/${id}`, { activo: false });
  assert.equal((await agente('GET', '/api/agente/v1/config', null, nuevo)).statusCode, 401);
});
