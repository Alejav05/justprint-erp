// Qué direcciones recorrer: las redes del config.json o, si no hay, las de las placas de red de esta PC.
import os from 'node:os';

const aNum = (ip) => ip.split('.').reduce((n, x) => n * 256 + Number(x), 0);
const aIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
export const esIpv4 = (s) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every((x) => Number(x) <= 255);

/** Máscara más amplia que se recorre entera. Una red /16 tiene 65.534 direcciones: se recorre solo el /24 de la PC. */
export const PREFIJO_MINIMO = 22;

/** Direcciones de host de un CIDR (sin red ni broadcast). */
export function expandirCidr(cidr) {
  const [ip, p] = cidr.trim().split('/'); const prefijo = Number(p ?? 32);
  if (!esIpv4(ip) || !(prefijo >= 0 && prefijo <= 32)) throw new Error(`Red inválida: ${cidr}`);
  if (prefijo < 16) throw new Error(`Red demasiado grande para recorrer: ${cidr}`);
  if (prefijo >= 31) return [ip];
  const mascara = (0xffffffff << (32 - prefijo)) >>> 0; const red = (aNum(ip) & mascara) >>> 0; const n = 2 ** (32 - prefijo);
  const r = []; for (let i = 1; i < n - 1; i += 1) r.push(aIp(red + i));
  return r;
}

const prefijoDeMascara = (m) => m.split('.').reduce((s, x) => s + Number(x).toString(2).replace(/0/g, '').length, 0);

/** Redes IPv4 de las placas de esta PC (sin loopback ni autoconfiguradas 169.254). */
export function redesLocales(interfaces = os.networkInterfaces()) {
  const r = new Set();
  for (const lista of Object.values(interfaces)) for (const i of lista ?? []) {
    if (i.family !== 'IPv4' && i.family !== 4) continue;
    if (i.internal || i.address.startsWith('169.254.')) continue;
    let p = prefijoDeMascara(i.netmask);
    if (p < PREFIJO_MINIMO) p = 24;
    const mascara = (0xffffffff << (32 - p)) >>> 0;
    r.add(`${aIp((aNum(i.address) & mascara) >>> 0)}/${p}`);
  }
  return [...r];
}

/** Lista final de IPs a consultar: IPs fijas primero, después las de las redes, sin repetir. */
export function direccionesARecorrer({ redes = [], ips = [] } = {}) {
  const lista = redes.length ? redes : redesLocales();
  return [...new Set([...ips.filter(esIpv4), ...lista.flatMap(expandirCidr)])];
}

/** Corre `fn` sobre cada elemento con a lo sumo `n` en paralelo. */
export async function enParalelo(items, n, fn) {
  const r = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; r[k] = await fn(items[k], k); } }));
  return r;
}
