// Liquidación mensual: abono (prorrateado si el contrato arrancó en el período) + excedente de páginas por contrato.
// Misma regla que la planilla anterior: consumo = última lectura del período menos la lectura anterior (o el contador
// inicial de la instalación); franquicia efectiva = franquicia × factor de prorrateo, redondeada hacia abajo.
import { aDia } from './fechas.js';
import { ultimaCotizacion } from './cotizacion.js';

export const IVA = 21;
export const redondear = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };

export function limitesPeriodo(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { inicio: `${periodo}-01`, fin: `${periodo}-${String(dias).padStart(2, '0')}`, dias };
}

/** Fracción del período que corresponde facturar según la fecha de inicio del contrato. */
export function factorProrateo(fechaInicio, periodo) {
  const { inicio, fin, dias } = limitesPeriodo(periodo);
  const f = aDia(fechaInicio);
  if (!f || f <= inicio) return 1;
  if (f > fin) return 0;
  return (dias - Number(f.slice(8, 10)) + 1) / dias;
}

/**
 * Propuesta de liquidación de `periodo` para los contratos vigentes (todos, o los de `contratoIds`).
 * No guarda nada. `sinContadores`: factura solo el abono, sin mirar consumos.
 */
export async function liquidar(db, periodo, { contratoIds = null, clienteId = null, clienteIds = null, sinContadores = false } = {}) {
  const { inicio, fin } = limitesPeriodo(periodo);
  const cot = await ultimaCotizacion(db);
  const q = db('contratos as c').join('clientes as cl', 'cl.id', 'c.cliente_id').where('c.estado', 'vigente').whereNull('c.deleted_at')
    .select('c.id', 'c.cliente_id', 'c.nombre', 'c.moneda', 'c.fecha_inicio', 'c.entidad_facturante_id', 'cl.razon_social', 'cl.nombre_comercial').orderBy('cl.razon_social');
  if (contratoIds) q.whereIn('c.id', contratoIds);
  if (clienteId) q.where('c.cliente_id', clienteId);
  if (clienteIds) q.whereIn('c.cliente_id', clienteIds.length ? clienteIds : [0]);
  const contratos = await q;
  if (!contratos.length) return { periodo, cotizacion: cot, filas: [] };
  const ids = contratos.map((c) => c.id);

  const conds = await db('contrato_condiciones').whereIn('contrato_id', ids).where('vigente_desde', '<=', fin)
    .where((w) => w.whereNull('vigente_hasta').orWhere('vigente_hasta', '>=', inicio)).orderBy('vigente_desde', 'desc').orderBy('id', 'desc');
  const asigs = await db('asignaciones_equipo as a').join('equipos as e', 'e.id', 'a.equipo_id').join('modelos_equipo as m', 'm.id', 'e.modelo_id')
    .whereIn('a.contrato_id', ids).where('a.desde', '<=', fin).where((w) => w.whereNull('a.hasta').orWhere('a.hasta', '>=', inicio))
    .select('a.contrato_id', 'a.equipo_id', 'a.contador_inicial_negro', 'a.contador_inicial_color', 'a.desde', 'e.numero_serie', 'm.tipo');
  const equipoIds = [...new Set(asigs.map((a) => a.equipo_id))];
  const lecturas = equipoIds.length ? await db('lecturas_contador').whereIn('equipo_id', equipoIds).where('fecha', '<=', fin).orderBy('fecha').orderBy('id') : [];
  const porEquipo = new Map();
  for (const l of lecturas) { if (!porEquipo.has(l.equipo_id)) porEquipo.set(l.equipo_id, []); porEquipo.get(l.equipo_id).push({ ...l, fecha: aDia(l.fecha) }); }
  const yaFacturadas = await db('facturas').whereIn('contrato_id', ids).where({ periodo }).whereNull('deleted_at').where('estado', '!=', 'anulada').select('id', 'contrato_id', 'estado');

  function consumo(asig) {
    const ls = porEquipo.get(asig.equipo_id) ?? [];
    const delPeriodo = ls.filter((l) => l.fecha >= inicio && l.fecha <= fin);
    const actual = delPeriodo.at(-1);
    if (!actual) return null;
    const previas = ls.filter((l) => l.fecha < actual.fecha || (l.fecha === actual.fecha && l.id < actual.id));
    const base = previas.at(-1);
    const bn = base ? base.contador_negro : asig.contador_inicial_negro; const bc = base ? base.contador_color : asig.contador_inicial_color;
    return { negro: Math.max(0, actual.contador_negro - bn), color: asig.tipo === 'color' ? Math.max(0, actual.contador_color - bc) : 0 };
  }

  const filas = [];
  for (const c of contratos) {
    const factor = factorProrateo(c.fecha_inicio, periodo);
    if (factor === 0) continue; // todavía no había arrancado
    const cond = conds.find((x) => x.contrato_id === c.id);
    const existente = yaFacturadas.find((f) => f.contrato_id === c.id);
    const base = { contrato_id: c.id, cliente_id: c.cliente_id, cliente: c.nombre_comercial || c.razon_social, contrato: c.nombre, moneda: c.moneda, factor: redondear(factor, 4), factura_id: existente?.id ?? null, factura_estado: existente?.estado ?? null };
    if (!cond) { filas.push({ ...base, estado: 'sin_condiciones', neto: 0, neto_usd: 0, items: [], faltan: [] }); continue; }

    const franqN = Math.floor(cond.franquicia_negro * factor); const franqC = Math.floor(cond.franquicia_color * factor);
    const abono = Number(cond.monto_mensual) * factor;
    let cn = 0; let cc = 0; const faltan = [];
    if (!sinContadores) {
      for (const a of asigs.filter((x) => x.contrato_id === c.id)) {
        const k = consumo(a);
        if (!k) faltan.push(a.numero_serie); else { cn += k.negro; cc += k.color; }
      }
    }
    const excN = Math.max(0, cn - franqN); const excC = Math.max(0, cc - franqC);
    const pN = Number(cond.excedente_negro); const pC = Number(cond.excedente_color);
    const items = [{ tipo: 'abono', descripcion: factor < 1 ? `Abono mensual ${periodo} (proporcional, ${Math.round(factor * 100)}%)` : `Abono mensual ${periodo}`, cantidad: 1, precio_unitario: redondear(abono, 4), subtotal: redondear(abono) }];
    if (excN > 0) items.push({ tipo: 'excedente', descripcion: `Excedente de páginas en negro (consumo ${cn}, incluidas ${franqN})`, cantidad: excN, precio_unitario: pN, subtotal: redondear(excN * pN) });
    if (excC > 0) items.push({ tipo: 'excedente', descripcion: `Excedente de páginas color (consumo ${cc}, incluidas ${franqC})`, cantidad: excC, precio_unitario: pC, subtotal: redondear(excC * pC) });
    const neto = redondear(items.reduce((s, i) => s + i.subtotal, 0));
    const netoUsd = c.moneda === 'USD' ? neto : (cot ? redondear(neto / cot.valor) : null);
    filas.push({
      ...base, estado: faltan.length ? 'incompleto' : 'completo', faltan, interno: !cond.facturable,
      consumo_negro: cn, consumo_color: cc, franquicia_negro: franqN, franquicia_color: franqC, excedente_negro: excN, excedente_color: excC,
      abono: redondear(abono), neto, neto_usd: netoUsd, items,
    });
  }
  return { periodo, cotizacion: cot, filas };
}
