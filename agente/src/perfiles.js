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
    // Brother guarda negro y color dentro de un bloque binario (brInfoCounter) que varía por modelo.
    // Para los monocromo alcanza el total estándar; para los color hay que confirmar el OID con `diagnostico`.
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
