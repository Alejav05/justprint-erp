import { hoy } from './fechas.js';

/**
 * Abono mensual vigente en USD de referencia (neto, sin IVA), por cliente.
 * Contratos en dólares: su condición vigente. Contratos en pesos: el neto en USD de su última factura o registro,
 * porque el monto en pesos se ajusta por IPC y el dólar es la referencia para medir la evolución.
 * Lo no facturable (se presta el servicio pero no se factura) se suma aparte.
 */
export async function abonosUsd(db, { clienteIds = null } = {}) {
  const h = hoy();
  const q = db('contratos as c').where('c.estado', 'vigente').whereNull('c.deleted_at').select('c.id', 'c.cliente_id', 'c.moneda');
  if (clienteIds) q.whereIn('c.cliente_id', clienteIds);
  const contratos = await q;
  const salida = { porCliente: {}, total: 0, noFacturable: 0, contratos: contratos.length };
  if (!contratos.length) return salida;

  const ids = contratos.map((c) => c.id);
  const conds = await db('contrato_condiciones').whereIn('contrato_id', ids).where('vigente_desde', '<=', h)
    .where((w) => w.whereNull('vigente_hasta').orWhere('vigente_hasta', '>=', h)).orderBy('vigente_desde', 'desc');
  const enPesos = contratos.filter((c) => c.moneda === 'ARS').map((c) => c.id);
  const ultimas = new Map();
  if (enPesos.length) {
    const fs = await db('facturas').whereIn('contrato_id', enPesos).whereNotIn('estado', ['borrador', 'anulada']).whereNotNull('neto_usd')
      .whereNull('deleted_at').orderBy('periodo', 'desc').select('contrato_id', 'neto_usd');
    for (const f of fs) if (!ultimas.has(f.contrato_id)) ultimas.set(f.contrato_id, Number(f.neto_usd));
  }
  for (const c of contratos) {
    const cond = conds.find((x) => x.contrato_id === c.id);
    const usd = c.moneda === 'USD' ? Number(cond?.monto_usd_referencia ?? cond?.monto_mensual ?? 0) : (ultimas.get(c.id) ?? 0);
    const fila = (salida.porCliente[c.cliente_id] ??= { abono: 0, noFacturable: 0 });
    if (cond && !cond.facturable) { fila.noFacturable += usd; salida.noFacturable += usd; } else { fila.abono += usd; salida.total += usd; }
  }
  return salida;
}
