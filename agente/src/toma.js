// La toma: recorrer la red, leer las impresoras y mandar las lecturas al ERP.
import { log, leerPendientes, guardarPendientes, leerEstado, guardarEstado } from './config.js';
import { crearErp, ErrorErp } from './erp.js';
import { combinarPerfiles } from './perfiles.js';
import { direccionesARecorrer, enParalelo } from './red.js';
import { leerEquipo } from './snmp.js';

const normalizar = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hoyLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** ¿Hoy toca tomar? Los últimos días del mes y, si algo quedó sin tomar, hasta el día 10 del siguiente. */
export function enVentana(d = new Date(), diasAntesDelFin = 2, hastaDia = 10) {
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() >= ultimo - diasAntesDelFin || d.getDate() <= hastaDia;
}

/** Recorre la red y devuelve las impresoras que respondieron. */
export async function relevar(cfg, { alAvanzar } = {}) {
  const ips = direccionesARecorrer(cfg);
  const op = { ...cfg.snmp, perfiles: combinarPerfiles(cfg.perfiles) };
  log(`Recorriendo ${ips.length} direcciones (${(cfg.redes.length ? cfg.redes : ['redes de esta PC']).join(', ')})`);
  let hechas = 0;
  const r = await enParalelo(ips, cfg.paralelo ?? 64, async (ip) => {
    const e = await leerEquipo(ip, op).catch(() => null);
    hechas += 1; if (alAvanzar) alAvanzar(hechas, ips.length);
    return e;
  });
  const equipos = r.filter(Boolean);
  // Una impresora con dos placas de red aparece dos veces: se queda una por número de serie.
  const vistos = new Set();
  return equipos.filter((e) => { const k = normalizar(e.serie) || e.ip; if (vistos.has(k)) return false; vistos.add(k); return true; });
}

async function vaciarPendientes(erp) {
  const pend = leerPendientes(); if (!pend.length) return;
  const quedan = [];
  for (const p of pend) {
    try { await erp.enviar(p.lecturas, { tomada_en: p.tomada_en }); log(`Enviada una toma pendiente del ${p.tomada_en} (${p.lecturas.length} equipos)`); } catch (e) { quedan.push(p); if (e.estado === 401) break; }
  }
  guardarPendientes(quedan);
}

/**
 * Toma completa. `forzar` ignora la ventana de fin de mes y lo ya tomado; `prueba` manda las lecturas marcadas como prueba
 * (el ERP las registra pero no las usa para facturar).
 */
export async function tomar(cfg, { forzar = false, prueba = false, fetchFn, ahora = new Date() } = {}) {
  const erp = crearErp(cfg, { fetchFn });
  let remoto = null;
  try { remoto = await erp.config(); } catch (e) { if (e.estado === 401) throw e; log(`Aviso: ${e.message} Se toma igual y se guarda para mandar después.`); }

  if (!forzar && !prueba) {
    if (!enVentana(ahora, cfg.dias_antes_del_fin)) { log('Hoy no es día de toma (últimos días del mes o primeros 10 del siguiente).'); return { omitida: 'fuera_de_ventana' }; }
    if (remoto && remoto.equipos.length && remoto.equipos.every((e) => e.tomado)) { log(`Los ${remoto.equipos.length} equipos de ${remoto.cliente} ya tienen su lectura del período ${remoto.corte.periodo}.`); return { omitida: 'completa' }; }
  }
  if (remoto) await vaciarPendientes(erp);

  const equipos = await relevar(cfg);
  log(`Encontré ${equipos.length} impresoras: ${equipos.map((e) => `${e.ip} ${e.marca ?? '?'} ${e.serie ?? 's/serie'}`).join(' · ') || 'ninguna'}`);
  const esperados = remoto?.equipos ?? [];
  const encontradas = new Set(equipos.map((e) => normalizar(e.serie)));
  const faltan = esperados.filter((e) => !e.tomado && !encontradas.has(normalizar(e.serie)));
  if (faltan.length) log(`No respondieron (¿apagados o en otra red?): ${faltan.map((e) => `${e.serie} ${e.marca} ${e.modelo}`).join(' · ')}`);
  if (!equipos.length) return { equipos, faltan, resultados: [] };

  const lecturas = equipos.map(({ ip, marca, modelo, serie, negro, color, total, extra }) => ({ ip, marca: marca ?? undefined, modelo: modelo ?? undefined, serie, negro, color, total, extra }));
  const tomada_en = hoyLocal(ahora);
  let resultados = [];
  try {
    resultados = (await erp.enviar(lecturas, { prueba, tomada_en })).resultados;
    for (const r of resultados) log(`  ${r.serie ?? r.ip}: ${r.estado}${r.motivo ? ` (${r.motivo})` : ''}`);
  } catch (e) {
    if (e.estado === 401 || prueba) throw e;
    const p = leerPendientes(); p.push({ tomada_en, lecturas }); guardarPendientes(p.slice(-20));
    log(`No se pudo enviar (${e.message}). Quedó guardada y se reintenta en la próxima corrida.`);
  }
  guardarEstado({ ...leerEstado(), ultima_toma: new Date().toISOString(), ultimas_ips: equipos.map((e) => e.ip) });
  return { equipos, faltan, resultados };
}

export { ErrorErp };
