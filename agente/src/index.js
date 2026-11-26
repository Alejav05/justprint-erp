#!/usr/bin/env node
// Agente de toma de contadores de JustPrint. Ver README.md para la instalación en un cliente.
import readline from 'node:readline/promises';
import { CARPETA, RUTAS, guardarConfig, leerConfig, leerPendientes, log } from './config.js';
import { crearErp, ErrorErp } from './erp.js';
import { ARBOLES_DIAGNOSTICO, combinarPerfiles } from './perfiles.js';
import { esIpv4, expandirCidr } from './red.js';
import { leerEquipo, recorrer } from './snmp.js';
import { desinstalarTarea, instalarTarea, NOMBRE_TAREA } from './tarea.js';
import { relevar, tomar } from './toma.js';
import { VERSION } from './version.js';

const AYUDA = `Agente de toma de contadores JustPrint v${VERSION}

Uso: agente-contadores <comando> [opciones]

  configurar   Guarda la dirección del ERP, el token y (opcional) las redes a recorrer.
               --url https://erp.justprint.com.ar --token jpa_... [--redes 192.168.1.0/24,10.0.0.0/24] [--ips 10.1.1.20] [--comunidad public]
               Sin opciones, las pregunta.
  probar       Verifica la conexión con el ERP, busca las impresoras y manda una toma de PRUEBA (no factura).
  buscar       Solo busca las impresoras de la red y muestra lo que leyó (no manda nada).
  tomar        Toma los contadores y los manda al ERP. --forzar la hace aunque no sea fin de mes.
  tarea        Lo que corre la tarea programada: toma solo si es fin de mes y faltan equipos.
  diagnostico <ip>  Recorre los OID de contadores de un equipo, para confirmar dónde informa negro y color.
  instalar     Crea la tarea programada de Windows ("${NOMBRE_TAREA}").
  desinstalar  Borra la tarea programada.
  estado       Muestra la configuración (sin el token) y lo pendiente de envío.

Archivos: ${CARPETA}`;

function opciones(args) {
  const o = {}; const resto = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) { const k = args[i].slice(2); const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[(i += 1)] : true; o[k] = v; } else resto.push(args[i]);
  }
  return { o, resto };
}
const lista = (v) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

function tabla(equipos) {
  if (!equipos.length) { console.log('No se encontró ninguna impresora.'); return; }
  console.table(equipos.map((e) => ({ IP: e.ip, Marca: e.marca ?? '?', Modelo: e.modelo ?? '', Serie: e.serie ?? '', Negro: e.negro ?? '', Color: e.color ?? '', Total: e.total ?? '' })));
}

async function configurar(o) {
  const c = leerConfig();
  const preguntar = !o.url && !o.token;
  if (preguntar) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const p = async (t, def) => (await rl.question(`${t}${def ? ` [${def}]` : ''}: `)).trim() || def;
    o.url = await p('Dirección del ERP', c.erp_url || 'https://');
    o.token = await p('Token del agente (lo genera el ERP en Contadores › Toma automática)', c.token ? '(sin cambios)' : '');
    if (o.token === '(sin cambios)') delete o.token;
    o.redes = await p('Redes a recorrer, separadas por coma (vacío = las de esta PC)', c.redes.join(',')) ?? '';
    rl.close();
  }
  if (o.url) c.erp_url = String(o.url).replace(/\/+$/, '');
  if (o.token) c.token = String(o.token).trim();
  if (o.redes !== undefined) { c.redes = lista(o.redes); c.redes.forEach(expandirCidr); }
  if (o.ips !== undefined) { c.ips = lista(o.ips); const mal = c.ips.filter((x) => !esIpv4(x)); if (mal.length) throw new Error(`IP inválida: ${mal.join(', ')}`); }
  if (o.comunidad) c.snmp.comunidad = String(o.comunidad);
  guardarConfig(c);
  console.log(`Configuración guardada en ${RUTAS.config}`);
  try {
    const r = await crearErp(c).config();
    console.log(`Conectado: agente "${r.agente.nombre}" de ${r.cliente}. Equipos esperados: ${r.equipos.length}.`);
  } catch (e) { console.log(`Atención: ${e.message}`); }
}

async function diagnostico(ip, cfg) {
  if (!ip || !esIpv4(ip)) throw new Error('Indicá la IP del equipo: agente-contadores diagnostico 192.168.1.50');
  const op = { ...cfg.snmp, perfiles: combinarPerfiles(cfg.perfiles) };
  const e = await leerEquipo(ip, op);
  if (!e) { console.log(`${ip} no respondió como impresora por SNMP (comunidad "${op.comunidad}").`); return; }
  console.log('Lectura con el perfil actual:'); tabla([e]); console.log(e.extra);
  for (const [grupo, raices] of Object.entries(ARBOLES_DIAGNOSTICO)) {
    for (const raiz of raices) {
      const r = await recorrer(ip, raiz, op);
      const filas = Object.entries(r); if (!filas.length) continue;
      console.log(`\n[${grupo}] ${raiz}`);
      for (const [oid, v] of filas.slice(0, 80)) console.log(`  ${oid} = ${typeof v === 'string' ? JSON.stringify(v.slice(0, 80)) : v}`);
    }
  }
  console.log('\nCompará estos números con la hoja de contadores que imprime el equipo para saber cuál es negro y cuál color.');
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const { o, resto } = opciones(args);
  const cfg = leerConfig();
  switch (cmd) {
    case 'configurar': return configurar(o);
    case 'buscar': { const eq = await relevar(cfg); tabla(eq); return; }
    case 'probar': {
      const r = await crearErp(cfg).config();
      console.log(`ERP OK: agente "${r.agente.nombre}" de ${r.cliente}. Esperamos ${r.equipos.length} equipos: ${r.equipos.map((e) => e.serie).join(', ')}`);
      const t = await tomar(cfg, { prueba: true }); tabla(t.equipos);
      if (t.faltan.length) console.log(`Faltan: ${t.faltan.map((e) => `${e.serie} (${e.marca} ${e.modelo})`).join(', ')}`);
      return;
    }
    case 'tomar': { const t = await tomar(cfg, { forzar: Boolean(o.forzar) }); if (t.equipos) tabla(t.equipos); return; }
    case 'tarea': await tomar(cfg); return;
    case 'diagnostico': return diagnostico(resto[0], cfg);
    case 'instalar': instalarTarea(); console.log(`Tarea "${NOMBRE_TAREA}" creada: corre a diario y toma solo a fin de mes.`); return;
    case 'desinstalar': desinstalarTarea(); console.log('Tarea borrada.'); return;
    case 'estado': console.log({ ...cfg, token: cfg.token ? `…${cfg.token.slice(-6)}` : '(sin token)' }, `\nPendientes de envío: ${leerPendientes().length}`); return;
    case '--version': case 'version': console.log(VERSION); return;
    default: console.log(AYUDA);
  }
}

main().catch((e) => {
  log(`Error: ${e instanceof ErrorErp ? e.message : e.stack ?? e.message}`);
  process.exitCode = 1;
});
