// Liquidación mensual: abono (prorrateado si el contrato arrancó en el período) + excedente de páginas por contrato.
// Consumo = última lectura del período menos la última de los períodos anteriores (o el contador inicial de la
// instalación). Una lectura pertenece al período que declara (`periodo`) o, si no declara, al mes de su fecha: así la
// toma de fin de mes, hecha la primera semana del mes siguiente, factura el mes que cierra. Franquicia efectiva = franquicia × factor de prorrateo, redondeada hacia abajo.
import { aDia } from './fechas.js';
import { ultimaCotizacion } from './cotizacion.js';
import { consumoPeriodo } from './contadores.js';

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
 * No guarda nada. `sinContadores` permite facturar los contratos a los que les faltan lecturas: esos van solo con el abono
 * (`solo_abono`); los que tienen todas sus lecturas se liquidan completos, con su excedente.
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
    .leftJoin('sedes as sd', 'sd.id', 'a.sede_id')
    .select('a.contrato_id', 'a.equipo_id', 'a.contador_inicial_negro', 'a.contador_inicial_color', 'a.desde', 'e.numero_serie', 'm.tipo', 'm.marca', 'm.modelo', 'sd.nombre as sede', 'sd.domicilio as sede_domicilio');
  const equipoIds = [...new Set(asigs.map((a) => a.equipo_id))];
  const lecturas = equipoIds.length ? await db('lecturas_contador').whereIn('equipo_id', equipoIds)
    .where((w) => w.where('fecha', '<=', fin).orWhere('periodo', '<=', periodo)).orderBy('fecha').orderBy('id') : [];
  const porEquipo = new Map();
  for (const l of lecturas) {
    const fecha = aDia(l.fecha); const per = l.periodo ?? fecha.slice(0, 7);
    if (per > periodo) continue; // tomada antes, pero declarada para un período posterior
    if (!porEquipo.has(l.equipo_id)) porEquipo.set(l.equipo_id, []);
    porEquipo.get(l.equipo_id).push({ ...l, fecha, per });
  }
  const yaFacturadas = await db('facturas').whereIn('contrato_id', ids).where({ periodo }).whereNull('deleted_at').where('estado', '!=', 'anulada').select('id', 'contrato_id', 'estado');

  const consumo = (asig) => { const k = consumoPeriodo(porEquipo.get(asig.equipo_id) ?? [], periodo, asig); return k && { negro: k.negro, color: k.color, meses: k.meses, k }; };

  const filas = [];
  for (const c of contratos) {
    const factor = factorProrateo(c.fecha_inicio, periodo);
    if (factor === 0) continue; // todavía no había arrancado
    const cond = conds.find((x) => x.contrato_id === c.id);
    const existente = yaFacturadas.find((f) => f.contrato_id === c.id);
    const base = { contrato_id: c.id, cliente_id: c.cliente_id, cliente: c.nombre_comercial || c.razon_social, contrato: c.nombre, moneda: c.moneda, factor: redondear(factor, 4), factura_id: existente?.id ?? null, factura_estado: existente?.estado ?? null };
    if (!cond) { filas.push({ ...base, estado: 'sin_condiciones', neto: 0, neto_usd: 0, items: [], faltan: [] }); continue; }

    const abono = Number(cond.monto_mensual) * factor;
    let cn = 0; let cc = 0; let meses = 1; const faltan = []; const equiposC = asigs.filter((x) => x.contrato_id === c.id);
    const detalleEquipos = [];
    for (const a of equiposC) {
      const k = consumo(a);
      const e = { serie: a.numero_serie, marca: a.marca, modelo: a.modelo, tipo: a.tipo, sede: a.sede ?? null, domicilio: a.sede_domicilio ?? null, desde: aDia(a.desde), con_lectura: Boolean(k) };
      if (!k) faltan.push(a.numero_serie);
      else {
        cn += k.negro; cc += k.color; meses = Math.max(meses, k.meses);
        Object.assign(e, { anterior: k.k.base ? { fecha: k.k.base.fecha, negro: k.k.base_negro, color: k.k.base_color } : { fecha: aDia(a.desde), negro: k.k.base_negro, color: k.k.base_color, inicial: true },
          actual: { fecha: k.k.actual.fecha, negro: k.k.actual.contador_negro, color: k.k.actual.contador_color }, consumo_negro: k.negro, consumo_color: k.color });
      }
      detalleEquipos.push(e);
    }
    const soloAbono = faltan.length > 0 && sinContadores;
    if (soloAbono) { cn = 0; cc = 0; }
    // Si algún mes anterior se facturó solo abono, el consumo que se cobra ahora abarca varios meses: se suman sus franquicias.
    const mesesFranq = soloAbono ? 1 : meses;
    const franqN = Math.floor(cond.franquicia_negro * (factor + mesesFranq - 1)); const franqC = Math.floor(cond.franquicia_color * (factor + mesesFranq - 1));
    const excN = Math.max(0, cn - franqN); const excC = Math.max(0, cc - franqC);
    const pN = Number(cond.excedente_negro); const pC = Number(cond.excedente_color);
    const items = [{ tipo: 'abono', descripcion: factor < 1 ? `Abono mensual ${periodo} (proporcional, ${Math.round(factor * 100)}%)` : `Abono mensual ${periodo}`, cantidad: 1, precio_unitario: redondear(abono, 4), subtotal: redondear(abono) }];
    if (excN > 0) items.push({ tipo: 'excedente', descripcion: `Excedente de páginas en negro (consumo ${cn}, incluidas ${franqN}${mesesFranq > 1 ? `, franquicia de ${mesesFranq} meses` : ''})`, cantidad: excN, precio_unitario: pN, subtotal: redondear(excN * pN) });
    if (excC > 0) items.push({ tipo: 'excedente', descripcion: `Excedente de páginas color (consumo ${cc}, incluidas ${franqC}${mesesFranq > 1 ? `, franquicia de ${mesesFranq} meses` : ''})`, cantidad: excC, precio_unitario: pC, subtotal: redondear(excC * pC) });
    const neto = redondear(items.reduce((s, i) => s + i.subtotal, 0));
    const netoUsd = c.moneda === 'USD' ? neto : (cot ? redondear(neto / cot.valor) : null);
    filas.push({
      ...base, estado: faltan.length && !sinContadores ? 'incompleto' : 'completo', faltan, solo_abono: soloAbono, interno: !cond.facturable,
      contadores: { total: equiposC.length, cargados: equiposC.length - faltan.length },
      meses_consumo: mesesFranq, consumo_negro: cn, consumo_color: cc, franquicia_negro: franqN, franquicia_color: franqC, excedente_negro: excN, excedente_color: excC,
      abono: redondear(abono), neto, neto_usd: netoUsd, items, equipos: detalleEquipos,
      franquicia_mensual_negro: cond.franquicia_negro, franquicia_mensual_color: cond.franquicia_color, precio_excedente_negro: pN, precio_excedente_color: pC,
    });
  }
  return { periodo, cotizacion: cot, filas };
}
