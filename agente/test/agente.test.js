import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JP_AGENTE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-agente-'));
const { simularImpresora } = await import('./simulador.js');
const { leerEquipo } = await import('../src/snmp.js');
const { detectarMarca } = await import('../src/perfiles.js');
const { expandirCidr, redesLocales, direccionesARecorrer } = await import('../src/red.js');
const { enVentana, tomar } = await import('../src/toma.js');
const { leerPendientes } = await import('../src/config.js');
const { xmlTarea } = await import('../src/tarea.js');

const PUERTO = 16161;
const STD = (descr, objId, modelo, serie, total) => ({ '1.3.6.1.2.1.1.1.0': descr, '1.3.6.1.2.1.1.2.0': objId, '1.3.6.1.2.1.25.3.2.1.3.1': modelo, '1.3.6.1.2.1.43.5.1.1.17.1': serie, '1.3.6.1.2.1.43.10.2.1.4.1.1': total });
export const IMPRESORAS = {
  '127.0.0.2': { ...STD('HP ETHERNET', '1.3.6.1.4.1.11.2.3.9.1', 'HP Color LaserJet M479fdw', 'CNBRP12345', 15000), '1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.6.0': 12000, '1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.7.0': 3000 },
  '127.0.0.3': { ...STD('Lexmark CX725', '1.3.6.1.4.1.641.1.1', 'Lexmark CX725', '7531LX00ABC', 9000), '1.3.6.1.4.1.641.2.1.5.1.0': 9000, '1.3.6.1.4.1.641.2.1.5.2.0': 7000, '1.3.6.1.4.1.641.2.1.5.3.0': 2000 },
  // Konica Minolta de la variante "7.2.1.5": negro = copias + impresiones, color igual.
  '127.0.0.4': { ...STD('KONICA MINOLTA bizhub C300i', '1.3.6.1.4.1.18334.1.2.1', 'KONICA MINOLTA bizhub C300i', 'A9K1021000123', 50000),
    '1.3.6.1.4.1.18334.1.1.1.5.7.2.1.5.1.1': 10000, '1.3.6.1.4.1.18334.1.1.1.5.7.2.1.5.1.2': 25000, '1.3.6.1.4.1.18334.1.1.1.5.7.2.1.5.2.1': 5000, '1.3.6.1.4.1.18334.1.1.1.5.7.2.1.5.2.2': 10000 },
  '127.0.0.5': STD('Brother NC-8300h', '1.3.6.1.4.1.2435.2.3.9.1', 'Brother HL-L5100DN series', 'E78901A2N345678', 4321),
  // Un equipo que no es impresora: responde SNMP pero no la Printer-MIB.
  '127.0.0.6': { '1.3.6.1.2.1.1.1.0': 'Switch', '1.3.6.1.2.1.1.2.0': '1.3.6.1.4.1.9.1.1' },
};

let sims = [];
before(async () => { sims = await Promise.all(Object.entries(IMPRESORAS).map(([address, valores]) => simularImpresora({ address, port: PUERTO, valores }))); });
after(() => { sims.forEach((s) => s.cerrar()); });

const op = { puerto: PUERTO, timeout: 400, reintentos: 0 };

test('lee negro y color según la marca', async () => {
  const hp = await leerEquipo('127.0.0.2', op);
  assert.deepEqual([hp.marca, hp.serie, hp.negro, hp.color, hp.total], ['HP', 'CNBRP12345', 12000, 3000, 15000]);
  const lx = await leerEquipo('127.0.0.3', op);
  assert.deepEqual([lx.marca, lx.negro, lx.color, lx.total], ['Lexmark', 7000, 2000, 9000]);
  const km = await leerEquipo('127.0.0.4', op);
  assert.deepEqual([km.marca, km.negro, km.color, km.total], ['Konica Minolta', 35000, 15000, 50000], 'prueba la segunda variante de OID y suma copias + impresiones');
  const br = await leerEquipo('127.0.0.5', op);
  assert.deepEqual([br.marca, br.negro, br.color, br.total], ['Brother', null, null, 4321], 'Brother: total estándar');
});

test('lo que no es una impresora, o no responde, se ignora', async () => {
  assert.equal(await leerEquipo('127.0.0.6', op), null);
  assert.equal(await leerEquipo('127.0.0.9', op), null);
});

test('la marca se detecta por sysObjectID o por la descripción', () => {
  assert.equal(detectarMarca('1.3.6.1.4.1.18334.1', ''), 'konica');
  assert.equal(detectarMarca('.1.3.6.1.4.1.2435.2', ''), 'brother');
  assert.equal(detectarMarca('1.3.6.1.4.1.99999', 'Develop ineo+ 250i'), 'konica');
  assert.equal(detectarMarca(null, 'algo raro'), null);
});

test('redes: expande CIDR, toma las de las placas y no recorre redes enormes enteras', () => {
  assert.equal(expandirCidr('192.168.1.0/24').length, 254);
  assert.deepEqual(expandirCidr('10.0.0.8/30'), ['10.0.0.9', '10.0.0.10']);
  assert.throws(() => expandirCidr('10.0.0.0/8'));
  const fake = { eth0: [{ family: 'IPv4', address: '192.168.5.33', netmask: '255.255.255.0', internal: false }], lo: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    wifi: [{ family: 'IPv4', address: '10.20.30.40', netmask: '255.255.0.0', internal: false }], apipa: [{ family: 'IPv4', address: '169.254.1.1', netmask: '255.255.0.0', internal: false }] };
  assert.deepEqual(redesLocales(fake), ['192.168.5.0/24', '10.20.30.0/24']);
  assert.deepEqual(direccionesARecorrer({ redes: ['10.0.0.8/30'], ips: ['10.0.0.9', '172.16.0.5'] }), ['10.0.0.9', '172.16.0.5', '10.0.0.10']);
});

test('la ventana de toma: últimos días del mes y hasta el 10 del siguiente', () => {
  assert.equal(enVentana(new Date(2026, 10, 27)), false, '27 de noviembre (30 días): todavía no');
  assert.equal(enVentana(new Date(2026, 10, 28)), true);
  assert.equal(enVentana(new Date(2026, 1, 26)), true, 'febrero de 28 días: desde el 26');
  assert.equal(enVentana(new Date(2026, 11, 5)), true);
  assert.equal(enVentana(new Date(2026, 11, 15)), false);
});

const cfg = { erp_url: 'https://erp.test', token: 'jpa_x', redes: ['127.0.0.0/29'], ips: [], snmp: op, paralelo: 8, dias_antes_del_fin: 2, perfiles: {} };
function erpFalso({ equipos = [], falla = false } = {}) {
  const llamadas = [];
  const fetchFn = async (url, init) => {
    llamadas.push({ url, init, cuerpo: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/config')) return new Response(JSON.stringify({ agente: { id: 1, nombre: 'A' }, cliente: 'Cliente', corte: { periodo: '2026-11' }, equipos }), { status: 200 });
    if (falla) throw new TypeError('fetch failed');
    const c = JSON.parse(init.body);
    return new Response(JSON.stringify({ fecha: '2026-11-28', resultados: c.lecturas.map((l) => ({ serie: l.serie, estado: 'aprobada' })) }), { status: 200 });
  };
  return { llamadas, fetchFn };
}

test('a fin de mes toma y manda todas las impresoras con el token', async () => {
  const e = erpFalso({ equipos: [{ serie: 'CNBRP12345', tomado: false }, { serie: 'NOESTA1', marca: 'HP', modelo: 'X', tomado: false }] });
  const r = await tomar(cfg, { fetchFn: e.fetchFn, ahora: new Date(2026, 10, 29) });
  assert.equal(r.equipos.length, 4);
  assert.deepEqual(r.faltan.map((x) => x.serie), ['NOESTA1']);
  const envio = e.llamadas.find((l) => l.url.endsWith('/lecturas'));
  assert.equal(envio.init.headers.authorization, 'Bearer jpa_x');
  assert.equal(envio.cuerpo.tomada_en, '2026-11-29'); assert.equal(envio.cuerpo.prueba, false);
  assert.deepEqual(envio.cuerpo.lecturas.map((l) => l.serie).sort(), ['7531LX00ABC', 'A9K1021000123', 'CNBRP12345', 'E78901A2N345678']);
});

test('fuera de fin de mes, o con todo tomado, la tarea no hace nada', async () => {
  const e = erpFalso({ equipos: [{ serie: 'CNBRP12345', tomado: false }] });
  assert.equal((await tomar(cfg, { fetchFn: e.fetchFn, ahora: new Date(2026, 10, 15) })).omitida, 'fuera_de_ventana');
  const t = erpFalso({ equipos: [{ serie: 'CNBRP12345', tomado: true }] });
  assert.equal((await tomar(cfg, { fetchFn: t.fetchFn, ahora: new Date(2026, 10, 29) })).omitida, 'completa');
  assert.ok(!t.llamadas.some((l) => l.url.endsWith('/lecturas')));
});

test('si el envío falla, la toma queda guardada y se manda en la próxima corrida', async () => {
  const caido = erpFalso({ equipos: [{ serie: 'CNBRP12345', tomado: false }], falla: true });
  await tomar(cfg, { fetchFn: caido.fetchFn, ahora: new Date(2026, 10, 29) });
  assert.equal(leerPendientes().length, 1);
  const ok = erpFalso({ equipos: [{ serie: 'CNBRP12345', tomado: false }] });
  await tomar(cfg, { fetchFn: ok.fetchFn, ahora: new Date(2026, 10, 30) });
  const envios = ok.llamadas.filter((l) => l.url.endsWith('/lecturas'));
  assert.deepEqual(envios.map((x) => x.cuerpo.tomada_en), ['2026-11-29', '2026-11-30'], 'primero la pendiente, con su fecha original');
  assert.equal(leerPendientes().length, 0);
});

test('la tarea programada de Windows corre a diario y recupera las corridas perdidas', () => {
  const x = xmlTarea('C:\\Program Files\\JustPrint\\agente-contadores.exe', 'tarea');
  assert.match(x, /<StartWhenAvailable>true<\/StartWhenAvailable>/);
  assert.match(x, /<UserId>S-1-5-18<\/UserId>/);
  assert.match(x, /<Arguments>tarea<\/Arguments>/);
});
