// Costos: conversión a USD y el costo que genera un remito de insumos.
import { hoy } from './fechas.js';

const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Pasa un importe a USD de referencia. En pesos usa la cotización BNA de la fecha (o la última anterior). Devuelve null si no hay cotización. */
export async function aUsd(db, importe, moneda, fecha = hoy()) {
  if (moneda === 'USD') return { usd: redondear(importe), cotizacion: null };
  const c = await db('cotizaciones_usd').where('fecha', '<=', fecha).orderBy('fecha', 'desc').first() ?? await db('cotizaciones_usd').orderBy('fecha', 'desc').first();
  if (!c || !Number(c.valor)) return null;
  return { usd: redondear(importe / Number(c.valor)), cotizacion: Number(c.valor) };
}

/**
 * Cuando sale un remito con insumos para un cliente, su costo pasa al negocio de ese cliente: cantidad × costo de referencia
 * de cada insumo. Los insumos sin costo cargado no suman (y se informan) para no inventar números.
 * Corre dentro de la transacción del remito. Devuelve { usd, sin_costo } o null si no hay nada que costear.
 */
export async function costoDeRemito(trx, remitoId, usuarioId) {
  const r = await trx('remitos').where({ id: remitoId }).first();
  if (!r) return null;
  const items = await trx('remito_items as i').join('insumos as s', 's.id', 'i.insumo_id').where('i.remito_id', remitoId)
    .select('i.cantidad', 'i.equipo_id', 's.codigo', 's.descripcion', 's.costo_referencia', 's.moneda');
  if (!items.length) return null;
  let total = 0; let cotUsada = null; const partes = []; const sinCosto = [];
  for (const it of items) {
    if (it.costo_referencia == null || Number(it.costo_referencia) <= 0) { sinCosto.push(it.codigo); continue; }
    const conv = await aUsd(trx, Number(it.costo_referencia) * it.cantidad, it.moneda, String(r.fecha).slice(0, 10));
    if (!conv) { sinCosto.push(it.codigo); continue; }
    total += conv.usd; cotUsada = conv.cotizacion ?? cotUsada; partes.push(`${it.cantidad} × ${it.descripcion}`);
  }
  if (total <= 0) return { usd: 0, sin_costo: sinCosto };
  const equipoId = items.find((x) => x.equipo_id)?.equipo_id ?? r.equipo_id ?? null;
  let contratoId = null;
  if (equipoId) contratoId = (await trx('asignaciones_equipo').where({ equipo_id: equipoId }).whereNull('hasta').first())?.contrato_id ?? null;
  const [id] = await trx('costos').insert({
    fecha: String(r.fecha).slice(0, 10), concepto: `Remito ${r.numero}: ${partes.join(', ')}`.slice(0, 200), tipo: 'insumo', importe: redondear(total), moneda: 'USD', cotizacion: cotUsada,
    importe_usd: redondear(total), cliente_id: r.cliente_id, equipo_id: equipoId, contrato_id: contratoId, ticket_id: r.ticket_id ?? null, remito_id: remitoId, origen: 'remito', created_by: usuarioId, updated_by: usuarioId,
  });
  return { id, usd: redondear(total), sin_costo: sinCosto };
}
