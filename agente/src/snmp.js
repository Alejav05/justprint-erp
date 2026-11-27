// Lectura SNMP de una impresora: datos estándar + contadores según la marca.
import snmp from 'net-snmp';
import { ESTANDAR, PERFILES, detectarMarca, leerBloqueBrother } from './perfiles.js';

const VERSIONES = { 1: snmp.Version1, '2c': snmp.Version2c };

function abrir(ip, op) {
  return snmp.createSession(ip, op.comunidad ?? 'public', {
    port: op.puerto ?? 161, retries: op.reintentos ?? 1, timeout: op.timeout ?? 1500, version: VERSIONES[op.version ?? '2c'] ?? snmp.Version2c,
  });
}

const valor = (vb, crudo = false) => {
  if (snmp.isVarbindError(vb)) return undefined;
  if (crudo) return vb.value;
  const v = vb.value;
  if (Buffer.isBuffer(v)) return v.toString('latin1').replace(/\0+$/g, '').trim();
  if (typeof v === 'bigint') return Number(v);
  return v;
};

/** GET de varios OID. Devuelve { oid: valor } solo con los que respondieron. Si el equipo no responde, rechaza. */
export function obtener(ip, oids, op = {}, crudo = false) {
  if (!oids.length) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    const s = abrir(ip, op);
    s.on('error', () => {});
    s.get(oids, (err, vbs) => {
      if (!err) { s.close(); const r = {}; vbs.forEach((vb, i) => { const v = valor(vb, crudo); if (v !== undefined && v !== null) r[oids[i]] = v; }); resolve(r); return; }
      // SNMPv1 o equipos que cortan todo el pedido si falta un OID: se reintenta de a uno.
      if (err instanceof snmp.RequestFailedError && oids.length > 1) {
        s.close();
        Promise.all(oids.map((o) => obtener(ip, [o], op, crudo).catch(() => ({})))).then((partes) => resolve(Object.assign({}, ...partes)));
        return;
      }
      s.close();
      if (err instanceof snmp.RequestFailedError) { resolve({}); return; }
      reject(err);
    });
  });
}

/** Recorre un subárbol (para `diagnostico`). */
export function recorrer(ip, raiz, op = {}, limite = 0) {
  return new Promise((resolve) => {
    const s = abrir(ip, op); const r = {};
    s.on('error', () => {});
    // Con `limite` (ms) se corta ahí y devuelve lo que juntó, aunque el equipo no termine de responder.
    const corte = limite ? setTimeout(() => { try { s.close(); } catch { /* ya cerrada */ } resolve(r); }, limite) : null;
    // Los bloques binarios (como los contadores de Brother) se muestran en hexadecimal para poder leerlos.
    const mostrar = (vb) => (Buffer.isBuffer(vb.value) && vb.value.some((b) => (b < 32 && b !== 0 && b !== 10 && b !== 13) || b > 126) ? `hex:${vb.value.toString('hex')}` : valor(vb));
    s.subtree(raiz, 20, (vbs) => { for (const vb of vbs) { if (snmp.isVarbindError(vb)) continue; const v = mostrar(vb); if (v !== undefined) r[vb.oid] = v; } }, () => { if (corte) clearTimeout(corte); try { s.close(); } catch { /* ya cerrada */ } resolve(r); });
  });
}

const numero = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null);

/** Resuelve un campo del perfil: la primera alternativa cuyos OID respondieron todos con un número. */
function resolver(alternativas, r) {
  for (const a of alternativas ?? []) {
    const oids = typeof a === 'string' ? [a] : a.suma;
    const vals = oids.map((o) => numero(r[o]));
    if (vals.every((x) => x !== null)) return { valor: vals.reduce((s, x) => s + x, 0), oids };
  }
  return null;
}

/** Tablas de la Printer-MIB que dicen con qué colores imprime el equipo. */
export const OID_COLORANTES = '1.3.6.1.2.1.43.12.1.1.4'; // prtMarkerColorantValue: "black", "cyan", "magenta", "yellow"
export const OID_INSUMOS = '1.3.6.1.2.1.43.11.1.1.6'; // prtMarkerSuppliesDescription: "Black Toner", "Cyan Toner"…
const COLORES = /cyan|magenta|yellow|amarillo|cian|\bcolor/i;

/**
 * ¿El equipo imprime en color? Primero por los colorantes que declara; si no los informa, por los insumos.
 * Si no hay datos, por los contadores: un contador color con páginas dice que sí. null si no se puede saber.
 */
export function esColor(colorantes = [], insumos = [], color = null) {
  const c = colorantes.map(String).filter((x) => x.trim());
  if (c.length) return c.some((x) => COLORES.test(x)) || c.length >= 3;
  const i = insumos.map(String).filter((x) => /toner|tóner|ink|tinta|cartridge|cartucho|drum|tambor/i.test(x));
  if (i.length) return i.some((x) => COLORES.test(x));
  if (color > 0) return true;
  return null;
}

const oidsDe = (alts) => (alts ?? []).flatMap((a) => (typeof a === 'string' ? [a] : a.suma));

/**
 * Lee un equipo. Devuelve null si en esa IP no hay una impresora que responda SNMP.
 * `op`: { comunidad, version, timeout, reintentos, puerto, perfiles }
 */
export async function leerEquipo(ip, op = {}) {
  const perfiles = op.perfiles ?? PERFILES;
  let base;
  try { base = await obtener(ip, Object.values(ESTANDAR), op); } catch { return null; }
  const e = Object.fromEntries(Object.entries(ESTANDAR).map(([k, o]) => [k, base[o]]));
  // Una impresora responde la Printer-MIB (número de serie o contador total). Un switch o una PC, no.
  if (e.serie === undefined && e.total === undefined) return null;
  const marca = detectarMarca(e.sysObjectID, e.sysDescr, perfiles);
  const p = marca ? perfiles[marca] : null;
  let r = {};
  if (p) {
    const oids = [...new Set([...oidsDe(p.negro), ...oidsDe(p.color), ...oidsDe(p.total), ...(p.serie ? [p.serie] : [])])];
    r = await obtener(ip, oids, op).catch(() => ({}));
  }
  let negro = p ? resolver(p.negro, r) : null; let color = p ? resolver(p.color, r) : null; let totalMarca = p ? resolver(p.total, r) : null;
  if (p?.bloque) {
    // Bloque binario (Brother): se prueba cada OID hasta que uno traiga registros.
    for (const o of p.bloque.oids) {
      const crudo = await obtener(ip, [o], op, true).catch(() => ({}));
      const reg = leerBloqueBrother(crudo[o]);
      if (!Object.keys(reg).length) continue;
      const de = (cod) => (cod != null && reg[cod] != null ? { valor: reg[cod], oids: [`${o}#0x${cod.toString(16).padStart(2, '0')}`] } : null);
      negro = negro ?? de(p.bloque.negro); color = color ?? de(p.bloque.color); totalMarca = totalMarca ?? de(p.bloque.total);
      break;
    }
  }
  const total = totalMarca?.valor ?? numero(e.total);
  // Tablas cortas; con tope de tiempo para que un equipo que no las informa no demore la toma.
  const tabla = (raiz) => recorrer(ip, raiz, op, op.timeout ?? 2000).then(Object.values, () => []);
  const colorantes = await tabla(OID_COLORANTES);
  const insumos = colorantes.length ? [] : await tabla(OID_INSUMOS);
  return {
    ip,
    marca: p?.nombre ?? null,
    modelo: e.modelo ? String(e.modelo) : null,
    serie: (p?.serie && r[p.serie]) ? String(r[p.serie]).trim() : (e.serie ? String(e.serie).trim() : null),
    negro: negro?.valor ?? null,
    color: color?.valor ?? null,
    total,
    es_color: esColor(colorantes, insumos, color?.valor ?? null),
    extra: { sysName: e.sysName ?? null, sysDescr: e.sysDescr ? String(e.sysDescr).slice(0, 200) : null, sysObjectID: e.sysObjectID ?? null, oid_negro: negro?.oids ?? null, oid_color: color?.oids ?? null },
  };
}
