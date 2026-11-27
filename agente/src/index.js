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
  console.table(equipos.map((e) => ({ IP: e.ip, Marca: e.marca ?? '?', Modelo: e.modelo ?? '', Tipo: e.es_color == null ? '?' : e.es_color ? 'color' : 'mono', Serie: e.serie ?? '', Negro: e.negro ?? '', Color: e.color ?? '', Total: e.total ?? '' })));
}

export const ERP_POR_DEFECTO = 'https://erp.justprint.com.ar';
const SIN_REDES = /^(0|no|ninguna|-)?$/i;

async function configurar(o, preguntarCon = null) {
  const c = leerConfig();
  const preguntar = !o.url && !o.token;
  if (preguntar) {
    const rl = preguntarCon ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
    const q = preguntarCon ?? ((t) => rl.question(t));
    const p = async (t, def) => (await q(`${t}${def ? ` [${def}]` : ''}: `)).trim() || def;
    console.log('Enter deja el valor que está entre corchetes.');
    o.url = await p('Dirección del ERP', c.erp_url || ERP_POR_DEFECTO);
    // Si pegaron el token en la dirección, se acomoda solo.
    if (/^jpa_/.test(o.url)) { o.token = o.url; o.url = c.erp_url || ERP_POR_DEFECTO; console.log(`Eso es el token: lo guardo como token y uso ${o.url} como dirección.`); }
    else o.token = await p('Token del agente (lo genera el ERP en Contadores › Toma automática)', c.token ? '(sin cambios)' : '');
    if (o.token === '(sin cambios)') delete o.token;
    o.redes = await p('Redes a recorrer, separadas por coma (Enter = las de esta PC)', c.redes.join(',') || '') ?? '';
    rl?.close();
  }
  if (o.url) {
    const u = String(o.url).trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/]+/i.test(u)) throw new Error(`"${u}" no es una dirección. Tiene que ser como ${ERP_POR_DEFECTO}`);
    c.erp_url = u;
  }
  if (o.token) {
    const t = String(o.token).trim();
    if (!/^jpa_[A-Za-z0-9_-]{20,}$/.test(t)) throw new Error('El token no tiene el formato esperado (empieza con jpa_). Copialo de nuevo desde el ERP.');
    c.token = t;
  }
  if (o.redes !== undefined) { c.redes = SIN_REDES.test(String(o.redes).trim()) ? [] : lista(o.redes); c.redes.forEach(expandirCidr); }
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
      for (const [oid, v] of filas.slice(0, 80)) console.log(`  ${oid} = ${typeof v === 'string' ? (v.startsWith('hex:') ? v : JSON.stringify(v.slice(0, 80))) : v}`);
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
    case 'ayuda': case '--help': case '-h': console.log(AYUDA); return;
    default: return menu();
  }
}

const ESTADOS = { aprobada: 'cargada en el ERP', a_revisar: 'quedó a revisar en el ERP', rechazada: 'rechazada', no_registrado: 'no es un equipo de JustPrint de este cliente', prueba: 'prueba' };

/** Con doble clic (sin comando) se abre un menú y la ventana espera antes de cerrarse. */
async function menu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let cerrado = false; rl.on('close', () => { cerrado = true; });
  const preguntar = (t) => (cerrado ? Promise.resolve('0') : rl.question(t).then((x) => x.trim()));
  console.log(`\nJustPrint · Toma de contadores v${VERSION}\n`);
  try {
    for (;;) {
      const cfg = leerConfig();
      console.log(cfg.token ? `Conectado a ${cfg.erp_url} (token …${cfg.token.slice(-6)})` : 'Todavía no está configurado: elegí 1 primero (o 2 para solo buscar impresoras).');
      console.log('\n  1. Configurar (dirección del ERP y token)\n  2. Buscar impresoras y ver sus contadores\n  3. Probar contra el ERP (toma de prueba, no factura)\n  4. Tomar ahora y mandar al ERP (lectura real del período)\n  5. Diagnóstico de una impresora (para confirmar negro y color)\n  6. Instalar la toma automática de fin de mes\n  7. Ver ayuda de comandos\n  0. Salir\n');
      const op = await preguntar('Opción: ');
      try {
        if (op === '0' || op === '') break;
        if (op === '1') await configurar({}, preguntar);
        else if (op === '2') tabla(await relevar(cfg));
        else if (op === '3') { const r = await crearErp(cfg).config(); console.log(`ERP OK: ${r.cliente}, esperamos ${r.equipos.length} equipos.`); const t = await tomar(cfg, { prueba: true }); tabla(t.equipos); if (t.faltan.length) console.log(`Faltan: ${t.faltan.map((e) => e.serie).join(', ')}`); }
        else if (op === '4') {
          const r = await crearErp(cfg).config();
          const per = r.corte.periodo;
          if (!per) console.log(`Atención: hoy (${r.hoy}) no es fecha de corte. La lectura va a quedar "a revisar" en el ERP.`);
          if (/^s/i.test(await preguntar(`Se carga como lectura real${per ? ` de ${per}` : ''} para ${r.cliente}. ¿Seguís? (s/n): `))) {
            const t = await tomar(cfg, { forzar: true }); tabla(t.equipos);
            for (const x of t.resultados) console.log(`  ${x.serie ?? x.ip}: ${ESTADOS[x.estado] ?? x.estado}${x.motivo ? ` (${x.motivo.replace(/_/g, ' ')})` : ''}`);
          }
        }
        else if (op === '5') await diagnostico(await preguntar('IP de la impresora: '), cfg);
        else if (op === '6') { instalarTarea(); console.log('Listo: la PC va a tomar los contadores sola a fin de mes.'); }
        else if (op === '7') console.log(AYUDA);
      } catch (e) {
        console.log(`\nNo se pudo: ${e.message}${/schtasks|Acceso denegado|Access is denied/i.test(e.message) ? ' (para instalar, abrí el programa con clic derecho > Ejecutar como administrador)' : ''}`);
      }
      console.log('');
    }
  } finally { if (!cerrado) rl.close(); }
}

main().catch((e) => {
  log(`Error: ${e instanceof ErrorErp ? e.message : e.stack ?? e.message}`);
  process.exitCode = 1;
});
