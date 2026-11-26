// Agente y ERP de punta a punta: impresoras simuladas (SNMP real por UDP) → agente → API del ERP (base SQLite en memoria) → Contadores.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JP_AGENTE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-agente-int-'));
const hayErp = fs.existsSync(new URL('../../node_modules/fastify', import.meta.url));

let ctx; let url;
// El agente habla con el ERP por fetch; acá cada pedido entra directo a la app (inject), sin abrir un puerto.
const fetchErp = async (u, init) => { const r = await ctx.app.inject({ method: init.method, url: u.replace(url, ''), headers: init.headers, payload: init.body }); return new Response(r.body, { status: r.statusCode }); }; let sims = []; let cliente;
before(async () => {
  if (!hayErp) return;
  const { simularImpresora } = await import('./simulador.js');
  const { montar, entrar } = await import('../../tests/ayuda.js');
  process.chdir(new URL('../..', import.meta.url).pathname); // las migraciones del ERP se buscan desde su carpeta
  ctx = await montar();
  url = 'http://erp.local';
  const a = await ctx.db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').join('equipos as e', 'e.id', 'a.equipo_id').where('e.numero_serie', 'PRUEBA-003').select('a.*', 'c.cliente_id').first();
  cliente = a.cliente_id;
  // Un HP color del cliente, instalado en el mismo contrato.
  const [m] = await ctx.db('modelos_equipo').insert({ marca: 'HP', modelo: 'Color LaserJet M479fdw', tipo: 'color' });
  const [eq] = await ctx.db('equipos').insert({ modelo_id: m, numero_serie: 'CNBRP12345', estado: 'instalado' });
  await ctx.db('asignaciones_equipo').insert({ equipo_id: eq, contrato_id: a.contrato_id, sede_id: a.sede_id, desde: '2026-01-05' });
  const STD = (descr, objId, serie, total) => ({ '1.3.6.1.2.1.1.1.0': descr, '1.3.6.1.2.1.1.2.0': objId, '1.3.6.1.2.1.43.5.1.1.17.1': serie, '1.3.6.1.2.1.43.10.2.1.4.1.1': total });
  sims = await Promise.all([
    simularImpresora({ address: '127.0.0.12', port: 16162, valores: { ...STD('HP', '1.3.6.1.4.1.11.2.3.9.1', 'CNBRP12345', 15000), '1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.6.0': 12000, '1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.7.0': 3000 } }),
    // La Brother color del demo informa solo el total: queda a revisar.
    simularImpresora({ address: '127.0.0.13', port: 16162, valores: STD('Brother', '1.3.6.1.4.1.2435.2.3.9.1', 'PRUEBA-003', 800) }),
    // Una impresora del cliente que no es de JustPrint.
    simularImpresora({ address: '127.0.0.14', port: 16162, valores: STD('Epson', '1.3.6.1.4.1.1248.1', 'EPS0001', 50) }),
  ]);
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  process.env.TOKEN_PRUEBA = (await dir.llamar('POST', '/api/contadores/agentes', { cliente_id: cliente, nombre: 'Recepción' })).json().token;
});
after(async () => { mock.timers.reset(); sims.forEach((s) => s.cerrar()); if (ctx) await ctx.cerrar(); });

test('el agente toma las impresoras del cliente y el ERP las valida', { skip: !hayErp && 'falta npm install en el ERP' }, async () => {
  const { tomar } = await import('../src/toma.js');
  const { entrar } = await import('../../tests/ayuda.js');
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-29T15:00:00Z') });
  const cfg = { erp_url: url, token: process.env.TOKEN_PRUEBA, redes: ['127.0.0.12/32'], ips: ['127.0.0.12', '127.0.0.13', '127.0.0.14'], snmp: { puerto: 16162, timeout: 400, reintentos: 0 }, paralelo: 4, dias_antes_del_fin: 2, perfiles: {} };
  const r = await tomar(cfg, { ahora: new Date(2026, 10, 29), fetchFn: fetchErp });
  const por = Object.fromEntries(r.resultados.map((x) => [x.serie, [x.estado, x.motivo]]));
  assert.deepEqual(por, { CNBRP12345: ['aprobada', null], 'PRUEBA-003': ['a_revisar', 'faltan_contadores'], EPS0001: ['no_registrado', 'serie_desconocida'] });

  const tec = await entrar(ctx.app, 'matias@demo.local');
  const vista = (await tec.llamar('GET', '/api/contadores?periodo=2026-11')).json();
  const hp = vista.clientes.flatMap((c) => c.contratos).flatMap((c) => c.equipos).find((e) => e.serie === 'CNBRP12345');
  assert.deepEqual([hp.actual.negro, hp.actual.color, hp.actual.origen], [12000, 3000, 'automatica']);

  // Un técnico completa la Brother a mano desde la bandeja y queda cargada.
  const pend = (await tec.llamar('GET', '/api/contadores/recibidas')).json();
  assert.equal(pend.length, 1);
  const ap = await tec.llamar('POST', `/api/contadores/recibidas/${pend[0].id}/aprobar`, { contador_negro: 600, contador_color: 200 });
  assert.equal(ap.statusCode, 200, ap.body);

  // La siguiente corrida de la tarea ve que no falta nada y no vuelve a tomar.
  const otra = await tomar(cfg, { ahora: new Date(2026, 10, 30), fetchFn: fetchErp });
  assert.equal(otra.omitida, 'completa');
  const agentes = (await tec.llamar('GET', '/api/contadores/agentes')).json();
  assert.equal(agentes[0].version, '1.2.0');
});
