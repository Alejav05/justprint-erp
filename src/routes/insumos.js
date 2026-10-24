import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles } from '../lib/contexto.js';
import { hoy, json } from '../lib/fechas.js';
import { siguienteNumero } from '../lib/numeradores.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const error = (reply, code, e, extra = {}) => reply.code(code).send({ error: e, ...extra });
const SIGNO = "case tipo when 'salida' then -cantidad else cantidad end";

export async function stockDe(db, ids = null) {
  const q = db('movimientos_insumo').groupBy('insumo_id').select('insumo_id').sum({ s: db.raw(SIGNO) });
  if (ids) q.whereIn('insumo_id', ids);
  return new Map((await q).map((x) => [x.insumo_id, Number(x.s)]));
}

export default async function rutasInsumos(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('insumos.ver')];

  app.get('/api/insumos', { preHandler: ver }, async (req) => {
    const q = String(req.query.q ?? '').trim().slice(0, 80);
    const filas = await db('insumos').whereNull('deleted_at').modify((b) => { if (q) b.where((w) => w.where('descripcion', 'like', `%${q}%`).orWhere('codigo', 'like', `%${q}%`)); }).orderBy('descripcion');
    const stock = await stockDe(db);
    const items = filas.map((i) => {
      const s = stock.get(i.id) ?? 0;
      return { id: i.id, codigo: i.codigo, descripcion: i.descripcion, tipo: i.tipo, stock: s, stock_minimo: i.stock_minimo, nivel: s <= 0 ? 'sin_stock' : s < i.stock_minimo ? 'bajo' : 'ok', modelos_compatibles: json(i.modelos_compatibles, []) };
    });
    return { items, sin_stock: items.filter((i) => i.nivel === 'sin_stock').length, bajo_minimo: items.filter((i) => i.nivel === 'bajo').length };
  });

  app.get('/api/insumos/:id', { preHandler: ver }, async (req, reply) => {
    const i = await db('insumos').where({ id: Number(req.params.id) }).whereNull('deleted_at').first();
    if (!i) return error(reply, 404, 'no_encontrado');
    const movimientos = await db('movimientos_insumo as m').leftJoin('usuarios as u', 'u.id', 'm.usuario_id').leftJoin('remitos as r', 'r.id', 'm.remito_id')
      .where('m.insumo_id', i.id).orderBy('m.id', 'desc').limit(50).select('m.fecha', 'm.tipo', 'm.cantidad', 'm.motivo', 'u.nombre as usuario', 'r.numero as remito');
    return { ...i, modelos_compatibles: json(i.modelos_compatibles, []), stock: (await stockDe(db, [i.id])).get(i.id) ?? 0, movimientos };
  });

  app.post('/api/insumos', { preHandler: [auth, requerirPermiso('insumos.mover')] }, async (req, reply) => {
    const d = z.object({ codigo: z.string().trim().min(1).max(60), descripcion: z.string().trim().min(2).max(200), tipo: z.string().trim().max(40).optional(), stock_minimo: z.number().int().min(0).default(0) }).parse(req.body);
    if (await db('insumos').where({ codigo: d.codigo }).first()) return error(reply, 409, 'codigo_repetido');
    const [id] = await db('insumos').insert({ ...d, created_by: req.ctx.id });
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'insumos', id, null, d);
    return reply.code(201).send({ id });
  });

  /** Entradas (compras, devoluciones) y ajustes por inventario. Las salidas salen por remito. */
  app.post('/api/insumos/:id/movimientos', { preHandler: [auth, requerirPermiso('insumos.mover')] }, async (req, reply) => {
    const d = z.object({ tipo: z.enum(['entrada', 'ajuste']), cantidad: z.number().int().min(-9999).max(9999).refine((n) => n !== 0), motivo: z.string().trim().min(2).max(255) }).parse(req.body);
    if (d.tipo === 'entrada' && d.cantidad < 0) return error(reply, 400, 'cantidad_invalida');
    const i = await db('insumos').where({ id: Number(req.params.id) }).whereNull('deleted_at').first();
    if (!i) return error(reply, 404, 'no_encontrado');
    try {
      await db.transaction(async (trx) => {
        const stock = (await stockDe(trx, [i.id])).get(i.id) ?? 0;
        if (stock + d.cantidad < 0) throw Object.assign(new Error('stock'), { codigo: 'stock_negativo' });
        await trx('movimientos_insumo').insert({ insumo_id: i.id, tipo: d.tipo, cantidad: d.cantidad, usuario_id: req.ctx.id, motivo: d.motivo });
        await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'insumos', i.id, { stock }, { stock: stock + d.cantidad, motivo: d.motivo });
      });
    } catch (e) {
      if (e.codigo) return error(reply, 409, e.codigo);
      throw e;
    }
    return reply.code(201).send({ ok: true });
  });

  // ---------- remitos ----------
  /** Entrega de insumos o equipos a un cliente, con baja de stock. Todo o nada. */
  app.post('/api/remitos/entrega', { preHandler: [auth, requerirPermiso('remitos.crear', 'insumos.mover')] }, async (req, reply) => {
    const d = z.object({
      cliente_id: z.number().int().positive(), sede_id: z.number().int().positive().optional(), observaciones: z.string().max(1000).optional(),
      items: z.array(z.object({ insumo_id: z.number().int().positive(), cantidad: z.number().int().min(1).max(999) })).min(1).max(30),
    }).parse(req.body);
    const visibles = await clientesVisibles(db, req.ctx);
    if (visibles !== null && !visibles.includes(d.cliente_id)) return error(reply, 404, 'no_encontrado');
    if (d.sede_id && !(await db('sedes').where({ id: d.sede_id, cliente_id: d.cliente_id }).first())) return error(reply, 400, 'sede_invalida');
    try {
      const out = await db.transaction(async (trx) => {
        const numero = await siguienteNumero(trx, 'remito');
        const [remito] = await trx('remitos').insert({ numero, cliente_id: d.cliente_id, sede_id: d.sede_id ?? null, tipo: 'entrega', fecha: hoy(), estado: 'emitido', observaciones: d.observaciones ?? null, created_by: req.ctx.id });
        const juntos = new Map(); for (const it of d.items) juntos.set(it.insumo_id, (juntos.get(it.insumo_id) ?? 0) + it.cantidad);
        for (const [insumoId, cantidad] of juntos) {
          const ins = await trx('insumos').where({ id: insumoId }).whereNull('deleted_at').first();
          if (!ins) throw Object.assign(new Error('x'), { codigo: 'insumo_invalido' });
          if (((await stockDe(trx, [insumoId])).get(insumoId) ?? 0) < cantidad) throw Object.assign(new Error('x'), { codigo: 'sin_stock', insumo: ins.codigo });
          await trx('remito_items').insert({ remito_id: remito, insumo_id: insumoId, descripcion: ins.descripcion, cantidad });
          await trx('movimientos_insumo').insert({ insumo_id: insumoId, tipo: 'salida', cantidad, remito_id: remito, usuario_id: req.ctx.id, motivo: `Entrega remito ${numero}` });
        }
        await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'remitos', remito, null, { numero, cliente_id: d.cliente_id });
        return { id: remito, numero };
      });
      return reply.code(201).send(out);
    } catch (e) {
      if (e.codigo === 'sin_stock') return error(reply, 409, 'sin_stock', { insumo: e.insumo });
      if (e.codigo === 'insumo_invalido') return error(reply, 400, 'insumo_invalido');
      throw e;
    }
  });

  app.get('/api/remitos/:id', { preHandler: [auth, requerirPermiso('insumos.ver')] }, async (req, reply) => {
    const r = await db('remitos').where({ id: Number(req.params.id) }).whereNull('deleted_at').first();
    const visibles = r ? await clientesVisibles(db, req.ctx) : null;
    if (!r || (visibles !== null && !visibles.includes(r.cliente_id))) return error(reply, 404, 'no_encontrado');
    const [cliente, sede, items, conformidad] = await Promise.all([
      db('clientes').where({ id: r.cliente_id }).select('razon_social', 'nombre_comercial', 'cuit').first(),
      r.sede_id ? db('sedes').where({ id: r.sede_id }).select('nombre', 'domicilio', 'localidad').first() : null,
      db('remito_items').where({ remito_id: r.id }).select('descripcion', 'cantidad'),
      db('conformidades').where({ documento_tipo: 'remito', documento_id: r.id }).select('firmante_nombre', 'firmante_cargo', 'firmado_en').first(),
    ]);
    const ticket = r.ticket_id ? await db('tickets').where({ id: r.ticket_id }).select('numero').first() : null;
    return { id: r.id, numero: r.numero, tipo: r.tipo, fecha: String(r.fecha).slice(0, 10), estado: r.estado, observaciones: r.observaciones, cliente, sede, items, conformidad: conformidad ?? null, ticket: ticket?.numero ?? null, emisor: 'Europa Haus S.A.S. · CUIT 30-71646173-0' };
  });
}
