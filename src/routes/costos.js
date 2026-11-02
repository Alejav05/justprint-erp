// Costos: el detalle de lo que costó prestar el servicio, por período y por cliente. Solo lo ve quien tiene `costos.ver`.
import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { aUsd } from '../lib/costos.js';
import { aDia, hoy } from '../lib/fechas.js';
import { clientesVisibles, puedeVerCliente } from '../lib/contexto.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const TIPOS_COSTO = { mano_de_obra: 'Mano de obra', insumo: 'Insumos', logistica: 'Logística', amortizacion: 'Amortización' };
const nombreTipo = (t) => TIPOS_COSTO[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : 'Sin clasificar');
const mesDe = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p ?? '') ? p : null;
const finDeMes = (p) => { const [a, m] = p.split('-').map(Number); return `${p}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`; };

const costoSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), concepto: z.string().trim().min(2).max(200), tipo: z.string().trim().max(40).optional().nullable(),
  importe: z.number().positive().max(1e10), moneda: z.enum(['USD', 'ARS']), cliente_id: z.number().int().positive().optional().nullable(),
  equipo_id: z.number().int().positive().optional().nullable(), contrato_id: z.number().int().positive().optional().nullable(), ticket_id: z.number().int().positive().optional().nullable(),
  proveedor: z.string().trim().max(160).optional().nullable(),
});

export default async function rutasCostos(app, { db }) {
  const pre = [requerirSesion(db), requerirPermiso('costos.ver')];
  const carga = [requerirSesion(db), requerirPermiso('costos.cargar')];

  /** Filas de costos según filtros, ya limitadas a lo que `ctx` puede ver. Los costos sin cliente (generales) los ve solo quien ve todo. */
  async function consultar(ctx, q) {
    const v = await clientesVisibles(db, ctx);
    const desde = mesDe(q.desde); const hasta = mesDe(q.hasta);
    const qb = db('costos as k').leftJoin('clientes as c', 'c.id', 'k.cliente_id').leftJoin('equipos as e', 'e.id', 'k.equipo_id').leftJoin('contratos as ct', 'ct.id', 'k.contrato_id')
      .leftJoin('tickets as t', 't.id', 'k.ticket_id').leftJoin('proveedores as p', 'p.id', 'k.proveedor_id').leftJoin('insumos as i', 'i.id', 'k.insumo_id')
      .whereNull('k.deleted_at').orderBy('k.fecha', 'desc').orderBy('k.id', 'desc')
      .select('k.id', 'k.fecha', 'k.concepto', 'k.tipo', 'k.importe', 'k.moneda', 'k.cotizacion', 'k.importe_usd', 'k.cliente_id', 'c.razon_social', 'c.nombre_comercial',
        'k.origen', 'k.remito_id', 'k.equipo_id', 'k.contrato_id', 'k.ticket_id', 'k.proveedor_id', 'e.numero_serie', 'ct.nombre as contrato', 't.numero as ticket', 'p.nombre as proveedor', 'i.descripcion as insumo');
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
      origen: f.origen, automatico: f.origen === 'remito', equipo_id: f.equipo_id, contrato_id: f.contrato_id, ticket_id: f.ticket_id,
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

  /** Valida que lo que se vincula exista y pertenezca al cliente; resuelve el proveedor por nombre (lo crea si es nuevo). */
  async function preparar(ctx, d) {
    if (d.cliente_id) { if (!(await puedeVerCliente(db, ctx, d.cliente_id)) || !(await db('clientes').where({ id: d.cliente_id }).whereNull('deleted_at').first())) return { error: 'cliente_invalido' }; }
    else if ((await clientesVisibles(db, ctx)) !== null) return { error: 'cliente_requerido' }; // un costo general solo lo carga quien ve todo
    if (d.fecha > hoy()) return { error: 'fecha_futura' };
    if (d.equipo_id && !(await db('equipos').where({ id: d.equipo_id }).whereNull('deleted_at').first())) return { error: 'equipo_invalido' };
    if (d.contrato_id && !(await db('contratos').where({ id: d.contrato_id, cliente_id: d.cliente_id ?? -1 }).whereNull('deleted_at').first())) return { error: 'contrato_invalido' };
    if (d.ticket_id && !(await db('tickets').where({ id: d.ticket_id, cliente_id: d.cliente_id ?? -1 }).whereNull('deleted_at').first())) return { error: 'ticket_invalido' };
    const conv = await aUsd(db, d.importe, d.moneda, d.fecha);
    if (!conv) return { error: 'sin_cotizacion' };
    let proveedorId = null;
    if (d.proveedor) { const p = await db('proveedores').whereRaw('lower(nombre) = ?', [d.proveedor.toLowerCase()]).whereNull('deleted_at').first(); proveedorId = p ? p.id : (await db('proveedores').insert({ nombre: d.proveedor, created_by: ctx.id }))[0]; }
    return { fila: { fecha: d.fecha, concepto: d.concepto, tipo: d.tipo || null, importe: d.importe, moneda: d.moneda, cotizacion: conv.cotizacion, importe_usd: conv.usd, cliente_id: d.cliente_id ?? null,
      equipo_id: d.equipo_id ?? null, contrato_id: d.contrato_id ?? null, ticket_id: d.ticket_id ?? null, proveedor_id: proveedorId } };
  }
  const estadoError = (e) => (e === 'cliente_invalido' ? 404 : 400);

  app.post('/api/costos', { preHandler: carga }, async (req, reply) => {
    const d = costoSchema.parse(req.body);
    const r = await preparar(req.ctx, d);
    if (r.error) return reply.code(estadoError(r.error)).send({ error: r.error });
    const [id] = await db('costos').insert({ ...r.fila, origen: 'manual', created_by: req.ctx.id, updated_by: req.ctx.id });
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'costos', id, null, { cliente_id: r.fila.cliente_id, importe_usd: r.fila.importe_usd, concepto: r.fila.concepto });
    return reply.code(201).send({ id });
  });

  /** Un costo generado por un remito no se toca: sale del remito. Si el remito estuvo mal, se corrige el costo de referencia del insumo. */
  async function editable(ctx, id, reply) {
    const k = await db('costos').where({ id }).whereNull('deleted_at').first();
    if (!k || (k.cliente_id ? !(await puedeVerCliente(db, ctx, k.cliente_id)) : (await clientesVisibles(db, ctx)) !== null)) { reply.code(404).send({ error: 'no_encontrado' }); return null; }
    if (k.origen === 'remito') { reply.code(409).send({ error: 'costo_automatico' }); return null; }
    return k;
  }

  app.patch('/api/costos/:id', { preHandler: carga }, async (req, reply) => {
    const antes = await editable(req.ctx, Number(req.params.id), reply); if (!antes) return;
    const d = costoSchema.parse(req.body);
    const r = await preparar(req.ctx, d);
    if (r.error) return reply.code(estadoError(r.error)).send({ error: r.error });
    await db('costos').where({ id: antes.id }).update({ ...r.fila, updated_by: req.ctx.id, updated_at: db.fn.now() });
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'costos', antes.id, { concepto: antes.concepto, importe: antes.importe, moneda: antes.moneda, importe_usd: antes.importe_usd }, { concepto: r.fila.concepto, importe: r.fila.importe, moneda: r.fila.moneda, importe_usd: r.fila.importe_usd });
    return { ok: true };
  });

  app.delete('/api/costos/:id', { preHandler: carga }, async (req, reply) => {
    const antes = await editable(req.ctx, Number(req.params.id), reply); if (!antes) return;
    await db('costos').where({ id: antes.id }).update({ deleted_at: db.fn.now(), updated_by: req.ctx.id });
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'eliminar', 'costos', antes.id, { concepto: antes.concepto, importe_usd: antes.importe_usd, cliente_id: antes.cliente_id }, null);
    return { ok: true };
  });

  /** Para armar el formulario: equipos, contratos y tickets recientes del cliente, y proveedores conocidos. */
  app.get('/api/costos/referencias', { preHandler: carga }, async (req, reply) => {
    const cid = Number(req.query.cliente_id) || null;
    if (cid && !(await puedeVerCliente(db, req.ctx, cid))) return reply.code(404).send({ error: 'no_encontrado' });
    const proveedores = (await db('proveedores').whereNull('deleted_at').orderBy('nombre').select('nombre')).map((x) => x.nombre);
    if (!cid) return { proveedores, equipos: [], contratos: [], tickets: [] };
    const equipos = await db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').join('equipos as e', 'e.id', 'a.equipo_id').where('c.cliente_id', cid).groupBy('e.id', 'e.numero_serie').select('e.id', 'e.numero_serie as serie');
    const contratos = await db('contratos').where({ cliente_id: cid }).whereNull('deleted_at').select('id', 'nombre');
    const tickets = await db('tickets').where({ cliente_id: cid }).whereNull('deleted_at').orderBy('abierto_en', 'desc').limit(30).select('id', 'numero', 'asunto');
    return { proveedores, equipos, contratos, tickets };
  });
}
