// Costos: el detalle de lo que costó prestar el servicio, por período y por cliente. Solo lo ve quien tiene `costos.ver`.
import { aDia, hoy } from '../lib/fechas.js';
import { clientesVisibles } from '../lib/contexto.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const TIPOS_COSTO = { mano_de_obra: 'Mano de obra', insumo: 'Insumos', logistica: 'Logística', amortizacion: 'Amortización' };
const nombreTipo = (t) => TIPOS_COSTO[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : 'Sin clasificar');
const mesDe = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p ?? '') ? p : null;
const finDeMes = (p) => { const [a, m] = p.split('-').map(Number); return `${p}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`; };

export default async function rutasCostos(app, { db }) {
  const pre = [requerirSesion(db), requerirPermiso('costos.ver')];

  /** Filas de costos según filtros, ya limitadas a lo que `ctx` puede ver. Los costos sin cliente (generales) los ve solo quien ve todo. */
  async function consultar(ctx, q) {
    const v = await clientesVisibles(db, ctx);
    const desde = mesDe(q.desde); const hasta = mesDe(q.hasta);
    const qb = db('costos as k').leftJoin('clientes as c', 'c.id', 'k.cliente_id').leftJoin('equipos as e', 'e.id', 'k.equipo_id').leftJoin('contratos as ct', 'ct.id', 'k.contrato_id')
      .leftJoin('tickets as t', 't.id', 'k.ticket_id').leftJoin('proveedores as p', 'p.id', 'k.proveedor_id').leftJoin('insumos as i', 'i.id', 'k.insumo_id')
      .whereNull('k.deleted_at').orderBy('k.fecha', 'desc').orderBy('k.id', 'desc')
      .select('k.id', 'k.fecha', 'k.concepto', 'k.tipo', 'k.importe', 'k.moneda', 'k.cotizacion', 'k.importe_usd', 'k.cliente_id', 'c.razon_social', 'c.nombre_comercial',
        'e.numero_serie', 'ct.nombre as contrato', 't.numero as ticket', 'p.nombre as proveedor', 'i.descripcion as insumo');
    if (v) qb.whereIn('k.cliente_id', v.length ? v : [0]);
    if (desde) qb.where('k.fecha', '>=', `${desde}-01`);
    if (hasta) qb.where('k.fecha', '<=', finDeMes(hasta));
    if (q.cliente_id) qb.where('k.cliente_id', Number(q.cliente_id));
    if (q.tipo) qb.where('k.tipo', q.tipo);
    if (q.q) { const t = `%${String(q.q).trim().toLowerCase()}%`; qb.where((w) => w.whereRaw('lower(k.concepto) like ?', [t]).orWhereRaw('lower(p.nombre) like ?', [t]).orWhereRaw('lower(c.razon_social) like ?', [t]).orWhereRaw('lower(c.nombre_comercial) like ?', [t])); }
    const filas = await qb.limit(5000);
    return filas.map((f) => ({
      id: f.id, fecha: aDia(f.fecha), periodo: aDia(f.fecha).slice(0, 7), concepto: f.concepto, tipo: f.tipo ?? null, tipo_nombre: nombreTipo(f.tipo),
      importe: Number(f.importe), moneda: f.moneda, importe_usd: redondear(f.importe_usd), cliente_id: f.cliente_id, cliente: f.cliente_id ? (f.nombre_comercial || f.razon_social) : 'Generales (sin cliente)',
      equipo: f.numero_serie ?? null, contrato: f.contrato ?? null, ticket: f.ticket ?? null, proveedor: f.proveedor ?? null, insumo: f.insumo ?? null,
    }));
  }

  app.get('/api/costos', { preHandler: pre }, async (req) => {
    const filas = await consultar(req.ctx, req.query ?? {});
    const total = (a) => redondear(a.reduce((s, x) => s + x.importe_usd, 0));
    const agrupar = (clave, nombre) => { const m = new Map(); for (const f of filas) { const k = clave(f); if (!m.has(k)) m.set(k, { clave: k, nombre: nombre(f), usd: 0, cantidad: 0 }); const g = m.get(k); g.usd += f.importe_usd; g.cantidad += 1; } return [...m.values()].map((g) => ({ ...g, usd: redondear(g.usd) })); };
    return {
      moneda: 'USD', total_usd: total(filas), cantidad: filas.length, truncado: filas.length >= 5000,
      por_periodo: agrupar((f) => f.periodo, (f) => f.periodo).sort((a, b) => b.clave.localeCompare(a.clave)),
      por_cliente: agrupar((f) => f.cliente_id ?? 0, (f) => f.cliente).sort((a, b) => b.usd - a.usd),
      por_tipo: agrupar((f) => f.tipo ?? '', (f) => f.tipo_nombre).sort((a, b) => b.usd - a.usd),
      costos: filas,
    };
  });

  app.get('/api/costos/excel', { preHandler: pre }, async (req, reply) => {
    const filas = await consultar(req.ctx, req.query ?? {});
    const { default: ExcelJS } = await import('exceljs');
    const libro = new ExcelJS.Workbook(); libro.creator = 'JustPrint';
    const ws = libro.addWorksheet('Costos', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [['Fecha', 12], ['Período', 10], ['Cliente', 30], ['Concepto', 40], ['Tipo', 16], ['Proveedor', 24], ['Equipo', 16], ['Ticket', 12], ['Moneda', 9], ['Importe', 14], ['USD', 14]].map(([header, width]) => ({ header, width }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2A' } };
    for (const f of filas) ws.addRow([f.fecha, f.periodo, f.cliente, f.concepto, f.tipo_nombre, f.proveedor ?? '', f.equipo ?? '', f.ticket ?? '', f.moneda, f.importe, f.importe_usd]);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
    const t = ws.addRow(['', '', '', 'Total', '', '', '', '', '', '', filas.reduce((s, x) => s + x.importe_usd, 0)]); t.font = { bold: true };
    const buf = Buffer.from(await libro.xlsx.writeBuffer());
    return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="Costos_${hoy()}.xlsx"`).send(buf);
  });
}
