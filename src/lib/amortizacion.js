// Amortización de equipos. El costo del equipo se reparte en partes iguales durante su vida útil (36 meses por defecto) y cada mes se carga
// a quien tiene el equipo ese mes; los días en depósito o taller van a la flota (costos sin cliente). Pasada la vida útil no se carga nada más.
// Todo lo que sale de acá es derivado: se borra y se recalcula completo cada vez (idempotente), así nunca queda a medias.
import { valor } from './ajustes_sistema.js';
import { aUsd } from './costos.js';
import { aDia, hoy } from './fechas.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const mesDe = (iso) => String(iso).slice(0, 7);
const sig = (p) => { const [a, m] = p.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; };
const indiceMes = (p) => { const [a, m] = p.split('-').map(Number); return a * 12 + (m - 1); };
const diasDelMes = (p) => { const [a, m] = p.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };
export const sumarMeses = (p, n) => { const t = indiceMes(p) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const dosDig = (n) => String(n).padStart(2, '0');

export const vidaUtilDe = (e) => Number(e.vida_util_meses) > 0 ? Number(e.vida_util_meses) : Number(valor('equipos.vida_util_meses')) || 36;

/** Lo que se carga en el mes número `i` (0 = el primero): acumulado redondeado, para que la suma de todos dé exactamente el costo. */
export const cuotaMes = (costo, vida, i) => (i < 0 || i >= vida ? 0 : r2(r2((costo * (i + 1)) / vida) - r2((costo * i) / vida)));
/** Acumulado amortizado hasta el mes `i` inclusive. */
export const acumuladoHasta = (costo, vida, i) => (i < 0 ? 0 : i >= vida - 1 ? r2(costo) : r2((costo * (i + 1)) / vida));

/** Cuándo empieza a amortizar: la compra o la primera instalación, lo que ocurra primero (si no hay ninguna, el alta del equipo). */
export function inicioDe(e, asigs) {
  const primera = asigs.length ? asigs.map((a) => aDia(a.desde)).sort()[0] : null;
  const compra = aDia(e.fecha_adquisicion);
  return [compra, primera].filter(Boolean).sort()[0] ?? aDia(e.created_at) ?? hoy();
}

/** Costo en USD del equipo. Si se cargó en pesos y todavía no está convertido, se convierte y se guarda. Devuelve null si no tiene costo (o no hay cotización). */
export async function costoUsdDe(db, e) {
  if (e.costo_usd != null) return Number(e.costo_usd);
  if (e.costo_adquisicion == null || Number(e.costo_adquisicion) <= 0) return null;
  const conv = await aUsd(db, Number(e.costo_adquisicion), e.moneda, aDia(e.fecha_adquisicion) ?? hoy());
  if (!conv) return null;
  await db('equipos').where({ id: e.id }).update({ costo_usd: conv.usd });
  return conv.usd;
}

/** Quién tiene el equipo el día `s`: un { cliente_id, contrato_id } o null (flota). La asignación vale desde `desde` hasta `hasta`, ambos días inclusive; si dos se pisan, gana la más nueva. */
const quienTiene = (asigs, s) => {
  const a = asigs.filter((x) => aDia(x.desde) <= s && (!x.hasta || s <= aDia(x.hasta))).sort((x, y) => (aDia(y.desde) < aDia(x.desde) ? -1 : 1))[0];
  return a ? { cliente_id: a.cliente_id, contrato_id: a.contrato_id, cont: a.cuota_continuada_usd != null && a.continua_hasta ? { cuota: Number(a.cuota_continuada_usd), hasta: a.continua_hasta } : null } : null;
};

/**
 * Cronograma del equipo, sin escribir nada: una fila por mes y titular { mes, n, de, cliente_id, contrato_id, importe }, y la pérdida por baja si corresponde.
 */
export function cronograma(e, asigs, costo, { hasta = hoy() } = {}) {
  const vida = vidaUtilDe(e); const inicio = inicioDe(e, asigs); const mes0 = mesDe(inicio);
  const baja = e.estado === 'baja' ? (aDia(e.fecha_baja) ?? aDia(e.updated_at) ?? hasta) : null;
  const fin = [mesDe(hasta), baja ? mesDe(baja) : null].filter(Boolean).sort()[0];
  const filas = []; let cargado = 0;
  for (let p = mes0; p <= fin; p = sig(p)) {
    const i = indiceMes(p) - indiceMes(mes0); if (i >= vida) break;
    const total = cuotaMes(costo, vida, i); if (total <= 0) continue;
    // Los días del primer mes anteriores al inicio no existen para el equipo: la cuota se reparte solo entre los días desde el inicio.
    const N = diasDelMes(p); const dias = new Map(); let validos = 0;
    for (let d = 1; d <= N; d += 1) {
      const fechaDia = `${p}-${dosDig(d)}`; if (fechaDia < inicio) continue; validos += 1;
      const t = quienTiene(asigs, fechaDia); const sigue = !!(t?.cont && p <= t.cont.hasta); const k = t ? `${t.cliente_id}:${t.contrato_id}:${sigue ? 1 : 0}` : 'flota';
      if (!dias.has(k)) dias.set(k, { t, n: 0, sigue }); dias.get(k).n += 1;
    }
    const partes = [...dias.values()]; const mayor = partes.reduce((m, x) => (x.n > m.n ? x : m), partes[0]);
    let resto = total;
    for (const x of partes) if (x !== mayor) { x.importe = r2((total * x.n) / validos); resto = r2(resto - x.importe); }
    mayor.importe = resto;
    // Reemplazo por falla: el cliente sigue pagando la cuota del plan original y la flota absorbe la diferencia (puede ser a favor).
    let flota = partes.find((x) => !x.t);
    for (const x of partes.filter((y) => y.sigue)) {
      const suyo = r2((x.t.cont.cuota * x.n) / validos); const dif = r2(x.importe - suyo); x.importe = suyo;
      if (dif !== 0) { if (!flota) { flota = { t: null, n: 0, importe: 0 }; partes.push(flota); } flota.importe = r2(flota.importe + dif); }
    }
    for (const x of partes) if (x.importe !== 0) filas.push({ mes: p, n: i + 1, de: vida, cliente_id: x.t?.cliente_id ?? null, contrato_id: x.t?.contrato_id ?? null, importe: x.importe });
    cargado = r2(cargado + total);
  }
  let perdida = null;
  if (baja) { const falta = r2(costo - cargado); if (falta > 0.005) perdida = { fecha: baja, importe: falta }; }
  return { filas, perdida, vida, inicio };
}

const concepto = (e, txt) => `${txt} ${e.marca} ${e.modelo} · ${e.numero_serie}`.slice(0, 200);

/** Recalcula todo lo que el equipo carga a clientes y a la flota. Seguro de repetir. */
export async function recalcularEquipo(db, equipoId, { hasta = hoy() } = {}) {
  const e = await db('equipos as e').join('modelos_equipo as m', 'm.id', 'e.modelo_id').where('e.id', equipoId).select('e.*', 'm.marca', 'm.modelo').first();
  if (!e) return { filas: 0 };
  const costo = e.deleted_at ? null : await costoUsdDe(db, e);
  return db.transaction(async (trx) => {
    await trx('costos').where({ equipo_id: e.id, origen: 'amortizacion' }).del();
    if (!costo || costo <= 0) return { filas: 0, sin_costo: true };
    const asigs = await trx('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').where('a.equipo_id', e.id).select('a.desde', 'a.hasta', 'a.contrato_id', 'a.cuota_continuada_usd', 'a.continua_hasta', 'c.cliente_id');
    const { filas, perdida } = cronograma(e, asigs, costo, { hasta });
    for (const f of filas) {
      await trx('costos').insert({ fecha: `${f.mes}-01`, concepto: concepto(e, `Amortización ${f.n}/${f.de}`), tipo: 'amortizacion', importe: f.importe, moneda: 'USD', cotizacion: null, importe_usd: f.importe,
        cliente_id: f.cliente_id, contrato_id: f.contrato_id, equipo_id: e.id, origen: 'amortizacion' });
    }
    if (perdida) await trx('costos').insert({ fecha: perdida.fecha, concepto: concepto(e, 'Pérdida por baja'), tipo: 'perdida', importe: perdida.importe, moneda: 'USD', cotizacion: null, importe_usd: perdida.importe,
      cliente_id: null, contrato_id: null, equipo_id: e.id, origen: 'amortizacion' });
    return { filas: filas.length + (perdida ? 1 : 0) };
  });
}

/** Recalcula todos los equipos (al arrancar, todos los días y cuando cambia algo general). Un equipo con error no frena a los demás. */
export async function recalcularTodos(db, { hasta = hoy(), log = () => {} } = {}) {
  const ids = await db('equipos').select('id'); let ok = 0;
  for (const { id } of ids) { try { await recalcularEquipo(db, id, { hasta }); ok += 1; } catch (err) { log(`amortización del equipo ${id}: ${err.message}`); } }
  return { equipos: ok };
}

/** Valor en libros al final del mes `p` (lo que falta amortizar). */
export function valorEnLibros(e, asigs, costo, p) {
  const vida = vidaUtilDe(e); const i = indiceMes(p) - indiceMes(mesDe(inicioDe(e, asigs)));
  return r2(costo - acumuladoHasta(costo, vida, i));
}

/**
 * Lo que el cliente sigue pagando cuando su equipo se reemplaza: la cuota del plan del equipo que se va, hasta el último mes de ese plan.
 * Si el equipo ya venía de un reemplazo vigente, hereda esa continuidad. Devuelve null si no hay nada que continuar (sin costo o plan terminado).
 */
export async function continuidadDe(db, e, abierta, ahora = hoy()) {
  const mesAhora = mesDe(ahora);
  if (abierta?.cuota_continuada_usd != null && abierta.continua_hasta && abierta.continua_hasta >= mesAhora) return { cuota: Number(abierta.cuota_continuada_usd), hasta: abierta.continua_hasta };
  const costo = await costoUsdDe(db, e); if (!costo) return null;
  const asigs = await db('asignaciones_equipo').where({ equipo_id: e.id }).select('desde');
  const hasta = sumarMeses(mesDe(inicioDe(e, asigs)), vidaUtilDe(e) - 1);
  if (hasta < mesAhora) return null;
  return { cuota: r2(costo / vidaUtilDe(e)), hasta };
}
