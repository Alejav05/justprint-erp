// Dónde está cada dato en cada marca. Los OID estándar (Printer-MIB, RFC 3805) los responden todas;
// el negro y el color por separado están en la MIB propia de cada fabricante.
//
// IMPORTANTE: los OID de marca salen de las MIB públicas y de referencias de la comunidad. Hay que confirmarlos
// contra un equipo real de cada marca con `agente-contadores diagnostico <ip>` antes de usarlos para facturar.
// Si un modelo responde en otro lugar, se agrega acá o en `perfiles` del config.json (sin recompilar).

export const ESTANDAR = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  modelo: '1.3.6.1.2.1.25.3.2.1.3.1', // hrDeviceDescr
  serie: '1.3.6.1.2.1.43.5.1.1.17.1', // prtGeneralSerialNumber
  total: '1.3.6.1.2.1.43.10.2.1.4.1.1', // prtMarkerLifeCount: páginas totales del motor
};

/**
 * Cada campo es una lista de alternativas: se usa la primera que responde. Un campo puede ser una suma
 * (`{ suma: [...] }`), por ejemplo copias + impresiones.
 */
export const PERFILES = {
  hp: {
    nombre: 'HP',
    enterprise: 11,
    // HP-LASERJET-COMMON-MIB / FUTURESMART-MIB: total-mono-page-count y total-color-page-count.
    negro: ['1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.6.0'],
    color: ['1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.7.0'],
    total: [],
  },
  lexmark: {
    nombre: 'Lexmark',
    enterprise: 641,
    // LEXMARK-PVT-MIB: pgTotal, pgMono, pgColor.
    negro: ['1.3.6.1.4.1.641.2.1.5.2.0'],
    color: ['1.3.6.1.4.1.641.2.1.5.3.0'],
    total: ['1.3.6.1.4.1.641.2.1.5.1.0'],
  },
  konica: {
    nombre: 'Konica Minolta',
    enterprise: 18334,
    // Contadores de bizhub: copias + impresiones, negro y color. Hay dos variantes según la generación del equipo.
    negro: [
      { suma: ['1.3.6.1.4.1.18334.1.1.1.5.7.2.2.1.5.1.1', '1.3.6.1.4.1.18334.1.1.1.5.7.2.2.1.5.1.2'] },
      { suma: ['1.3.6.1.4.1.18334.1.1.1.5.7.2.1.5.1.1', '1.3.6.1.4.1.18334.1.1.1.5.7.2.1.5.1.2'] },
    ],
    color: [
      { suma: ['1.3.6.1.4.1.18334.1.1.1.5.7.2.2.1.5.2.1', '1.3.6.1.4.1.18334.1.1.1.5.7.2.2.1.5.2.2'] },
      { suma: ['1.3.6.1.4.1.18334.1.1.1.5.7.2.1.5.2.1', '1.3.6.1.4.1.18334.1.1.1.5.7.2.1.5.2.2'] },
    ],
    total: ['1.3.6.1.4.1.18334.1.1.1.5.7.2.1.1.0'],
  },
  brother: {
    nombre: 'Brother',
    enterprise: 2435,
    // Brother guarda los contadores en un bloque binario (brInfoCounter): registros código + 01 04 + 4 bytes.
    // Según la ingeniería inversa publicada: 0x00 = páginas totales, 0x01 = blanco y negro, 0x02 = color.
    // Los monocromo traen solo 0x00. Confirmar con `diagnostico` en cada modelo nuevo.
    bloque: { oids: ['1.3.6.1.4.1.2435.2.3.9.4.2.1.5.5.10.0', '1.3.6.1.4.1.2435.2.3.9.4.2.1.5.5.10'], negro: 0x01, color: 0x02, total: 0x00 },
    negro: [],
    color: [],
    total: [],
  },
};

/** Subárboles que recorre `diagnostico` para encontrar contadores en un modelo nuevo. */
export const ARBOLES_DIAGNOSTICO = {
  estandar: ['1.3.6.1.2.1.43.10.2.1.4', '1.3.6.1.2.1.43.5.1.1.17', '1.3.6.1.2.1.25.3.2.1.3'],
  hp: ['1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2'],
  lexmark: ['1.3.6.1.4.1.641.2.1.5', '1.3.6.1.4.1.641.6.4.2.1.1'],
  konica: ['1.3.6.1.4.1.18334.1.1.1.5.7.2'],
  brother: ['1.3.6.1.4.1.2435.2.3.9.4.2.1.5.5.10', '1.3.6.1.4.1.2435.2.3.9.4.2.1.5.5.52'],
};

/** Marca por el sysObjectID (1.3.6.1.4.1.<enterprise>…) o, si no, por el texto de sysDescr. */
export function detectarMarca(sysObjectID, sysDescr, perfiles = PERFILES) {
  const m = /^1\.3\.6\.1\.4\.1\.(\d+)/.exec(String(sysObjectID ?? '').replace(/^\./, ''));
  if (m) for (const [k, p] of Object.entries(perfiles)) if (p.enterprise === Number(m[1])) return k;
  const d = String(sysDescr ?? '').toLowerCase();
  if (/hewlett|\bhp\b|laserjet/.test(d)) return 'hp';
  if (/lexmark/.test(d)) return 'lexmark';
  if (/konica|minolta|bizhub|develop|ineo/.test(d)) return 'konica';
  if (/brother/.test(d)) return 'brother';
  return null;
}

/** Une los perfiles de fábrica con los del config.json (los del config ganan campo por campo). */
export function combinarPerfiles(extra = {}) {
  const r = structuredClone(PERFILES);
  for (const [k, p] of Object.entries(extra ?? {})) r[k] = { ...(r[k] ?? {}), ...p };
  return r;
}

/**
 * Lee el bloque de contadores de Brother. Se sacan el cierre FF FF FF FF y los separadores FF FF FF que Brother
 * intercala dentro de los valores, y se recorren los registros: código, 01, largo (4), valor big-endian.
 * Devuelve { código: valor }.
 */
export function leerBloqueBrother(buf) {
  if (!Buffer.isBuffer(buf)) return {};
  let b = buf;
  while (b.length >= 4 && b.subarray(-4).equals(Buffer.from([0xff, 0xff, 0xff, 0xff]))) b = b.subarray(0, -4);
  const limpio = []; for (let i = 0; i < b.length; i += 1) { if (b[i] === 0xff && b[i + 1] === 0xff && b[i + 2] === 0xff) { i += 2; continue; } limpio.push(b[i]); }
  const r = {}; let i = 0;
  while (i + 2 < limpio.length) {
    const cod = limpio[i];
    let largo; let desde;
    if (limpio[i + 1] === 0x01 && [1, 2, 4].includes(limpio[i + 2])) { largo = limpio[i + 2]; desde = i + 3; } else if ([1, 2, 4].includes(limpio[i + 1])) { largo = limpio[i + 1]; desde = i + 2; } else break;
    if (desde + largo > limpio.length) break;
    let v = 0; for (let k = 0; k < largo; k += 1) v = v * 256 + limpio[desde + k];
    r[cod] = v; i = desde + largo;
  }
  return r;
}
