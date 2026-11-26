// Configuración y estado del agente en disco. En Windows: C:\ProgramData\JustPrint\Contadores.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CARPETA = process.env.JP_AGENTE_DIR
  || (process.platform === 'win32' ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'JustPrint', 'Contadores') : path.join(os.homedir(), '.justprint-contadores'));

const archivo = (n) => path.join(CARPETA, n);
export const RUTAS = { config: archivo('config.json'), estado: archivo('estado.json'), pendientes: archivo('pendientes.json'), log: archivo('agente.log') };

export const POR_DEFECTO = {
  erp_url: '', token: '',
  redes: [], // vacío = las redes de esta PC. Ej.: ["192.168.1.0/24"]
  ips: [], // IPs fijas de impresoras, por si están en otra red
  snmp: { comunidad: 'public', version: '2c', timeout: 1500, reintentos: 1, puerto: 161 },
  paralelo: 64,
  dias_antes_del_fin: 2, // empieza a tomar 2 días antes del último del mes (en un mes de 30 días: desde el 28)
  perfiles: {}, // OID propios por marca (pisan a los de fábrica)
};

const leerJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const escribirJson = (f, v) => { fs.mkdirSync(CARPETA, { recursive: true }); const tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, f); };

export function leerConfig() {
  const c = leerJson(RUTAS.config, {});
  return { ...POR_DEFECTO, ...c, snmp: { ...POR_DEFECTO.snmp, ...(c.snmp ?? {}) } };
}
export const guardarConfig = (c) => escribirJson(RUTAS.config, c);
export const leerEstado = () => leerJson(RUTAS.estado, {});
export const guardarEstado = (e) => escribirJson(RUTAS.estado, e);
export const leerPendientes = () => leerJson(RUTAS.pendientes, []);
export const guardarPendientes = (p) => escribirJson(RUTAS.pendientes, p);

/** Log con fecha, rotado a 1 MB. También va a la consola. */
export function log(...partes) {
  const linea = `${new Date().toISOString()} ${partes.join(' ')}`;
  console.log(linea);
  try {
    fs.mkdirSync(CARPETA, { recursive: true });
    if (fs.existsSync(RUTAS.log) && fs.statSync(RUTAS.log).size > 1024 * 1024) fs.renameSync(RUTAS.log, `${RUTAS.log}.1`);
    fs.appendFileSync(RUTAS.log, `${linea}\n`);
  } catch { /* sin permisos de escritura: queda solo en consola */ }
}
