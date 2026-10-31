import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles } from '../lib/contexto.js';
import { aDia, hoy } from '../lib/fechas.js';
import { IVA, liquidar, redondear } from '../lib/liquidacion.js';
import { ultimaCotizacion } from '../lib/cotizacion.js';
import { PLAZO_DEFECTO_DIAS, sumarDias } from '../lib/cobranzas.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const error = (reply, code, e, extra = {}) => reply.code(code).send({ error: e, ...extra });
const periodoSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const itemSchema = z.object({
  tipo: z.enum(['abono', 'excedente', 'equipo', 'insumo', 'servicio', 'otro']).default('otro'),
  descripcion: z.string().trim().min(2).max(200),
  cantidad: z.number().positive().max(100000).default(1),
  precio_unitario: z.number().min(0).max(1e9),
  bonificacion: z.boolean().default(false), // descuento: se guarda en negativo y queda marcado
  insumo_id: z.number().int().positive().optional(), equipo_id: z.number().int().positive().optional(),
  ticket_id: z.number().int().positive().optional(), remito_id: z.number().int().positive().optional(),
});

const clase = (f) => (f.estado === 'borrador' ? 'borrador' : f.entidad_facturante_id ? 'fiscal' : 'interno');

export default async function rutasFacturacion(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('importes.ver')];
  const emitir = [auth, requerirPermiso('facturas.emitir')];
  const cobrar = [auth, requerirPermiso('cobros.registrar')];

  const visibles = (ctx) => clientesVisibles(db, ctx);
  const aplicadoPor = async (ids) => {
    const m = new Map(); if (!ids.length) return m;
    for (const a of await db('cobro_aplicaciones').whereIn('factura_id', ids).groupBy('factura_id').select('factura_id').sum({ s: 'importe' })) m.set(a.factura_id, Number(a.s));
    return m;
  };
  const entidadPorDefecto = async () => (await db('entidades_facturantes').where({ activa: true }).whereNull('deleted_at').orderBy('id').first())?.id ?? null;

  /** Recalcula neto, IVA, total y valor USD de un borrador a partir de sus ítems. */
  async function recalcular(trx, f) {
    const items = await trx('factura_items').where({ factura_id: f.id });
    const neto = redondear(items.reduce((s, i) => s + Number(i.subtotal), 0));
    const iva = redondear(items.reduce((s, i) => s + Number(i.subtotal) * Number(i.alicuota_iva) / 100, 0));
    const netoUsd = f.moneda === 'USD' ? neto : (Number(f.tipo_cambio) > 0 ? redondear(neto / Number(f.tipo_cambio)) : null);
    await trx('facturas').where({ id: f.id }).update({ neto, iva, total: redondear(neto + iva), neto_usd: netoUsd, updated_at: trx.fn.now() });
  }

  async function crearBorrador(trx, ctx, { cliente_id, contrato_id = null, periodo, moneda, tipo_cambio, interno, items, entidad }) {
    const alic = interno ? 0 : IVA;
    const plazo = contrato_id ? (await trx('contratos').where({ id: contrato_id }).first())?.plazo_pago_dias ?? null : null; // el plazo se acuerda en el contrato
    const [id] = await trx('facturas').insert({
      cliente_id, contrato_id, plazo_pago_dias: plazo, entidad_facturante_id: interno ? null : entidad, periodo, moneda, tipo_cambio: tipo_cambio ?? null,
      neto: 0, iva: 0, total: 0, estado: 'borrador', created_by: ctx.id,
    });
    for (const it of items) {
      await trx('factura_items').insert({ factura_id: id, tipo: it.tipo, descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario,
        alicuota_iva: alic, bonificacion: Boolean(it.bonificacion), subtotal: redondear(it.cantidad * it.precio_unitario) * (it.bonificacion ? -1 : 1), insumo_id: it.insumo_id ?? null, equipo_id: it.equipo_id ?? null, ticket_id: it.ticket_id ?? null, remito_id: it.remito_id ?? null });
    }
    await recalcular(trx, { id, moneda, tipo_cambio });
    return id;
  }

  // ---------- liquidación del mes ----------
  app.get('/api/facturacion/liquidacion', { preHandler: emitir }, async (req, reply) => {
    const periodo = periodoSchema.parse(req.query.periodo);
    const v = await visibles(req.ctx);
    const r = await liquidar(db, periodo, { clienteIds: v, sinContadores: req.query.sin_contadores === 'true' });
    return r;
  });

  app.post('/api/facturacion/generar', { preHandler: emitir }, async (req, reply) => {
    const d = z.object({ periodo: periodoSchema, contrato_ids: z.array(z.number().int().positive()).min(1).max(200), sin_contadores: z.boolean().default(false) }).parse(req.body);
    const cot = await ultimaCotizacion(db);
    if (!cot) return error(reply, 409, 'sin_cotizacion');
    const v = await visibles(req.ctx);
    const r = await liquidar(db, d.periodo, { contratoIds: d.contrato_ids, clienteIds: v, sinContadores: d.sin_contadores });
    const entidadDef = await entidadPorDefecto();
    const creadas = []; const saltadas = [];
    await db.transaction(async (trx) => {
      for (const f of r.filas) {
        if (f.factura_id) { saltadas.push({ contrato_id: f.contrato_id, motivo: 'ya_facturado' }); continue; }
        if (f.estado === 'incompleto') { saltadas.push({ contrato_id: f.contrato_id, motivo: 'faltan_lecturas', faltan: f.faltan }); continue; }
        if (f.estado === 'sin_condiciones') { saltadas.push({ contrato_id: f.contrato_id, motivo: 'sin_condiciones' }); continue; }
        const contrato = await trx('contratos').where({ id: f.contrato_id }).first();
        const id = await crearBorrador(trx, req.ctx, { cliente_id: f.cliente_id, contrato_id: f.contrato_id, periodo: d.periodo, moneda: f.moneda, tipo_cambio: cot.valor,
          interno: f.interno, items: f.items, entidad: contrato.entidad_facturante_id ?? entidadDef });
        await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'facturas', id, null, { periodo: d.periodo, contrato_id: f.contrato_id });
        creadas.push(id);
      }
    });
    return reply.code(201).send({ creadas, saltadas });
  });

  // ---------- facturas ----------
  app.get('/api/facturas', { preHandler: ver }, async (req) => {
    const f = z.object({ estado: z.enum(['borrador', 'emitida', 'cobrada_parcial', 'cobrada', 'anulada', 'por_cobrar']).optional(), periodo: periodoSchema.optional(), cliente: z.coerce.number().int().positive().optional(),
      q: z.string().trim().max(80).optional(), pagina: z.coerce.number().int().min(1).default(1) }).parse(req.query);
    const v = await visibles(req.ctx);
    const q = db('facturas').join('clientes as cl', 'cl.id', 'facturas.cliente_id').whereNull('facturas.deleted_at');
    if (v) q.whereIn('facturas.cliente_id', v.length ? v : [0]);
    if (f.estado === 'por_cobrar') q.whereIn('facturas.estado', ['emitida', 'cobrada_parcial']); else if (f.estado) q.where('facturas.estado', f.estado);
    if (f.periodo) q.where('facturas.periodo', f.periodo);
    if (f.cliente) q.where('facturas.cliente_id', f.cliente);
    if (f.q) q.where((w) => w.where('cl.razon_social', 'like', `%${f.q}%`).orWhere('cl.nombre_comercial', 'like', `%${f.q}%`).orWhere('facturas.numero', 'like', `%${f.q}%`));
    const [{ total }] = await q.clone().count({ total: 'facturas.id' });
    const filas = await q.clone().orderBy('facturas.periodo', 'desc').orderBy('facturas.id', 'desc').limit(25).offset((f.pagina - 1) * 25)
      .select('facturas.*', 'cl.razon_social', 'cl.nombre_comercial');
    const ap = await aplicadoPor(filas.map((x) => x.id));
    return { total: Number(total), pagina: f.pagina, items: filas.map((x) => ({
      id: x.id, cliente_id: x.cliente_id, cliente: x.nombre_comercial || x.razon_social, periodo: x.periodo, estado: x.estado, clase: clase(x), numero: x.numero, moneda: x.moneda,
      neto: Number(x.neto), iva: Number(x.iva), total: Number(x.total), neto_usd: x.neto_usd == null ? null : Number(x.neto_usd), cobrado: redondear(ap.get(x.id) ?? 0),
      saldo: redondear(Number(x.total) - (ap.get(x.id) ?? 0)), fecha_emision: aDia(x.fecha_emision), emision_estimada: Boolean(x.fecha_emision_estimada) })) };
  });

  async function cargarFactura(ctx, id) {
    const f = await db('facturas').where({ id }).whereNull('deleted_at').first();
    const v = f ? await visibles(ctx) : null;
    if (!f || (v !== null && !v.includes(f.cliente_id))) return null;
    return f;
  }

  app.get('/api/facturas/:id', { preHandler: ver }, async (req, reply) => {
    const f = await cargarFactura(req.ctx, Number(req.params.id));
    if (!f) return error(reply, 404, 'no_encontrado');
    const [cliente, items, cobros, entidad, contrato] = await Promise.all([
      db('clientes').where({ id: f.cliente_id }).select('id', 'razon_social', 'nombre_comercial', 'cuit').first(),
      db('factura_items').where({ factura_id: f.id }).orderBy('id'),
      db('cobro_aplicaciones as a').join('cobros as c', 'c.id', 'a.cobro_id').where('a.factura_id', f.id).orderBy('c.fecha_cobro').select('c.id', 'c.fecha_cobro', 'c.medio', 'c.referencia', 'a.importe'),
      f.entidad_facturante_id ? db('entidades_facturantes').where({ id: f.entidad_facturante_id }).select('razon_social', 'cuit').first() : null,
      f.contrato_id ? db('contratos').where({ id: f.contrato_id }).select('nombre').first() : null,
    ]);
    const cobrado = redondear(cobros.reduce((s, c) => s + Number(c.importe), 0));
    return { ...f, fecha_emision: aDia(f.fecha_emision), vencimiento: aDia(f.vencimiento), clase: clase(f), cliente, entidad, contrato: contrato?.nombre ?? null,
      neto: Number(f.neto), iva: Number(f.iva), total: Number(f.total), neto_usd: f.neto_usd == null ? null : Number(f.neto_usd), tipo_cambio: f.tipo_cambio == null ? null : Number(f.tipo_cambio),
      items: items.map((i) => ({ ...i, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario), subtotal: Number(i.subtotal), alicuota_iva: Number(i.alicuota_iva) })),
      cobros: cobros.map((c) => ({ ...c, fecha_cobro: aDia(c.fecha_cobro), importe: Number(c.importe) })), cobrado, saldo: redondear(Number(f.total) - cobrado) };
  });

  /** Venta directa o cargo suelto: una factura en borrador con los ítems que se quieran (abono, equipo, insumo, soporte...). */
  app.post('/api/facturas', { preHandler: emitir }, async (req, reply) => {
    const d = z.object({ cliente_id: z.number().int().positive(), contrato_id: z.number().int().positive().optional(), periodo: periodoSchema.optional(), moneda: z.enum(['USD', 'ARS']).default('USD'),
      interno: z.boolean().default(false), items: z.array(itemSchema).min(1).max(50) }).parse(req.body);
    const v = await visibles(req.ctx);
    if (v !== null && !v.includes(d.cliente_id)) return error(reply, 404, 'no_encontrado');
    if (!(await db('clientes').where({ id: d.cliente_id }).whereNull('deleted_at').first())) return error(reply, 404, 'no_encontrado');
    if (d.contrato_id && !(await db('contratos').where({ id: d.contrato_id, cliente_id: d.cliente_id }).first())) return error(reply, 400, 'contrato_invalido');
    const cot = await ultimaCotizacion(db);
    if (!cot) return error(reply, 409, 'sin_cotizacion');
    const entidad = await entidadPorDefecto();
    const id = await db.transaction(async (trx) => {
      const nuevo = await crearBorrador(trx, req.ctx, { cliente_id: d.cliente_id, contrato_id: d.contrato_id ?? null, periodo: d.periodo ?? hoy().slice(0, 7), moneda: d.moneda, tipo_cambio: cot.valor, interno: d.interno, items: d.items, entidad });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'facturas', nuevo, null, { cliente_id: d.cliente_id, venta_directa: true });
      return nuevo;
    });
    return reply.code(201).send({ id });
  });

  async function borradorEditable(req, reply) {
    const f = await cargarFactura(req.ctx, Number(req.params.id));
    if (!f) { error(reply, 404, 'no_encontrado'); return null; }
    if (f.estado !== 'borrador') { error(reply, 409, 'no_es_borrador'); return null; }
    return f;
  }

  app.post('/api/facturas/:id/items', { preHandler: emitir }, async (req, reply) => {
    const it = itemSchema.parse(req.body); const f = await borradorEditable(req, reply); if (!f) return;
    await db.transaction(async (trx) => {
      await trx('factura_items').insert({ factura_id: f.id, tipo: it.tipo, descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, alicuota_iva: f.entidad_facturante_id ? IVA : 0,
        bonificacion: Boolean(it.bonificacion), subtotal: redondear(it.cantidad * it.precio_unitario) * (it.bonificacion ? -1 : 1), insumo_id: it.insumo_id ?? null, equipo_id: it.equipo_id ?? null, ticket_id: it.ticket_id ?? null, remito_id: it.remito_id ?? null });
      await recalcular(trx, f);
    });
    return reply.code(201).send({ ok: true });
  });

  app.delete('/api/facturas/:id/items/:itemId', { preHandler: emitir }, async (req, reply) => {
    const f = await borradorEditable(req, reply); if (!f) return;
    const n = await db('factura_items').where({ id: Number(req.params.itemId), factura_id: f.id }).count({ n: '*' }).first();
    if (!Number(n.n)) return error(reply, 404, 'no_encontrado');
    if (Number((await db('factura_items').where({ factura_id: f.id }).count({ n: '*' }).first()).n) <= 1) return error(reply, 409, 'ultimo_item');
    await db.transaction(async (trx) => { await trx('factura_items').where({ id: Number(req.params.itemId) }).del(); await recalcular(trx, f); });
    return { ok: true };
  });

  app.delete('/api/facturas/:id', { preHandler: emitir }, async (req, reply) => {
    const f = await borradorEditable(req, reply); if (!f) return;
    await db.transaction(async (trx) => {
      await trx('factura_items').where({ factura_id: f.id }).del();
      await trx('facturas').where({ id: f.id }).del();
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'eliminar', 'facturas', f.id, { periodo: f.periodo, contrato_id: f.contrato_id }, null);
    });
    return { ok: true };
  });

  /** Emitir: pasa de borrador a emitida con su número y fecha. (Con ARCA conectado, el CAE lo pone el proveedor.) */
  app.post('/api/facturas/:id/emitir', { preHandler: emitir }, async (req, reply) => {
    const d = z.object({ fecha_emision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), numero: z.string().trim().max(20).optional(), tipo_comprobante: z.string().trim().max(5).optional(),
      vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body ?? {});
    const f = await borradorEditable(req, reply); if (!f) return;
    if (!f.entidad_facturante_id && f.estado === 'borrador' && !(await db('factura_items').where({ factura_id: f.id }).first())) return error(reply, 409, 'sin_items');
    const fecha = d.fecha_emision ?? hoy();
    if (fecha > hoy()) return error(reply, 400, 'fecha_futura');
    // Desde la emisión corre el plazo del contrato (o el que se fijó a mano). Es una referencia: no hay conexión con ARCA.
    const plazo = f.plazo_pago_dias ?? (f.contrato_id ? (await db('contratos').where({ id: f.contrato_id }).first())?.plazo_pago_dias : null) ?? PLAZO_DEFECTO_DIAS;
    const vencimiento = d.vencimiento ?? sumarDias(fecha, plazo);
    await db.transaction(async (trx) => {
      await trx('facturas').where({ id: f.id }).update({ estado: 'emitida', fecha_emision: fecha, fecha_emision_estimada: false, numero: d.numero ?? null, tipo_comprobante: d.tipo_comprobante ?? null,
        plazo_pago_dias: plazo, vencimiento, updated_by: req.ctx.id, updated_at: trx.fn.now() });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'facturas', f.id, { estado: 'borrador' }, { estado: 'emitida', fecha_emision: fecha, numero: d.numero });
    });
    return { ok: true };
  });

  app.post('/api/facturas/:id/anular', { preHandler: emitir }, async (req, reply) => {
    const d = z.object({ motivo: z.string().trim().min(3).max(255) }).parse(req.body);
    const f = await cargarFactura(req.ctx, Number(req.params.id));
    if (!f) return error(reply, 404, 'no_encontrado');
    if (f.estado === 'anulada' || f.estado === 'borrador') return error(reply, 409, 'no_se_puede_anular');
    if ((await aplicadoPor([f.id])).get(f.id)) return error(reply, 409, 'tiene_cobros');
    await db.transaction(async (trx) => {
      await trx('facturas').where({ id: f.id }).update({ estado: 'anulada', updated_by: req.ctx.id, updated_at: trx.fn.now() });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'facturas', f.id, { estado: f.estado }, { estado: 'anulada', motivo: d.motivo });
    });
    return { ok: true };
  });

  // ---------- cobros ----------
  /** Un cobro se aplica a una o más facturas del mismo cliente y moneda. Lo que sobra queda como saldo a favor sin aplicar. */
  app.post('/api/cobros', { preHandler: cobrar }, async (req, reply) => {
    const d = z.object({ cliente_id: z.number().int().positive(), fecha_cobro: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(hoy()), medio: z.enum(['transferencia', 'efectivo', 'cheque', 'mercadopago', 'otro']).default('transferencia'),
      importe: z.number().positive().max(1e10), moneda: z.enum(['USD', 'ARS']), referencia: z.string().trim().max(120).optional(),
      aplicaciones: z.array(z.object({ factura_id: z.number().int().positive(), importe: z.number().positive() })).min(1).max(50) }).parse(req.body);
    const v = await visibles(req.ctx);
    if (v !== null && !v.includes(d.cliente_id)) return error(reply, 404, 'no_encontrado');
    if (d.fecha_cobro > hoy()) return error(reply, 400, 'fecha_futura');
    const sumaAp = redondear(d.aplicaciones.reduce((s, a) => s + a.importe, 0));
    if (sumaAp > redondear(d.importe)) return error(reply, 400, 'aplicado_supera_cobro');
    try {
      const id = await db.transaction(async (trx) => {
        const [cobro] = await trx('cobros').insert({ cliente_id: d.cliente_id, fecha_cobro: d.fecha_cobro, medio: d.medio, importe: d.importe, moneda: d.moneda, referencia: d.referencia ?? null, created_by: req.ctx.id });
        for (const a of d.aplicaciones) {
          const f = await trx('facturas').where({ id: a.factura_id, cliente_id: d.cliente_id }).whereNull('deleted_at').first();
          if (!f) throw Object.assign(new Error('x'), { codigo: 'factura_invalida' });
          if (!['emitida', 'cobrada_parcial'].includes(f.estado)) throw Object.assign(new Error('x'), { codigo: 'factura_no_cobrable' });
          if (f.moneda !== d.moneda) throw Object.assign(new Error('x'), { codigo: 'moneda_distinta' });
          const ya = Number((await trx('cobro_aplicaciones').where({ factura_id: f.id }).sum({ s: 'importe' }).first()).s ?? 0);
          const saldo = redondear(Number(f.total) - ya);
          if (redondear(a.importe) > saldo) throw Object.assign(new Error('x'), { codigo: 'supera_saldo', saldo });
          await trx('cobro_aplicaciones').insert({ cobro_id: cobro, factura_id: f.id, importe: a.importe });
          await trx('facturas').where({ id: f.id }).update({ estado: redondear(saldo - a.importe) === 0 ? 'cobrada' : 'cobrada_parcial', updated_at: trx.fn.now() });
        }
        await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'cobros', cobro, null, { cliente_id: d.cliente_id, importe: d.importe, moneda: d.moneda });
        return cobro;
      });
      return reply.code(201).send({ id, sin_aplicar: redondear(d.importe - sumaAp) });
    } catch (e) {
      if (e.codigo) return error(reply, 409, e.codigo, e.saldo != null ? { saldo: e.saldo } : {});
      throw e;
    }
  });

  // ---------- cobranzas ----------
  /** Lo emitido y no cobrado, por cliente, con antigüedad desde la emisión. En USD neto de referencia; lo interno va aparte. */
  app.get('/api/cobranzas', { preHandler: ver }, async (req) => {
    const v = await visibles(req.ctx);
    const q = db('facturas').join('clientes as cl', 'cl.id', 'facturas.cliente_id').whereNull('facturas.deleted_at').whereIn('facturas.estado', ['emitida', 'cobrada_parcial']);
    if (v) q.whereIn('facturas.cliente_id', v.length ? v : [0]);
    const filas = await q.select('facturas.*', 'cl.razon_social', 'cl.nombre_comercial');
    const ap = await aplicadoPor(filas.map((f) => f.id));
    const h = hoy();
    const dias = (f) => Math.max(0, Math.round((Date.parse(h) - Date.parse(aDia(f.fecha_emision) ?? h)) / 86400000));
    const por = new Map(); const internas = { facturas: 0, usd: 0 };
    for (const f of filas) {
      const total = Number(f.total); const saldo = total - (ap.get(f.id) ?? 0);
      const usd = total > 0 ? (saldo / total) * Number(f.neto_usd ?? 0) : 0;
      if (!f.entidad_facturante_id) { internas.facturas += 1; internas.usd += usd; continue; }
      const c = por.get(f.cliente_id) ?? { cliente_id: f.cliente_id, cliente: f.nombre_comercial || f.razon_social, facturas: 0, saldo_usd: 0, max_dias: 0, tramos: { '0-30': 0, '31-60': 0, '61-90': 0, '+90': 0 }, detalle: [] };
      const d = dias(f); const tramo = d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '+90';
      c.facturas += 1; c.saldo_usd += usd; c.max_dias = Math.max(c.max_dias, d); c.tramos[tramo] += usd;
      c.detalle.push({ id: f.id, periodo: f.periodo, numero: f.numero, moneda: f.moneda, saldo: redondear(saldo), saldo_usd: redondear(usd), dias: d, estimada: Boolean(f.fecha_emision_estimada) });
      por.set(f.cliente_id, c);
    }
    const clientes = [...por.values()].map((c) => ({ ...c, saldo_usd: redondear(c.saldo_usd), tramos: Object.fromEntries(Object.entries(c.tramos).map(([k, x]) => [k, redondear(x)])) })).sort((a, b) => b.saldo_usd - a.saldo_usd);
    return { moneda: 'USD', neto: true, total_usd: redondear(clientes.reduce((s, c) => s + c.saldo_usd, 0)), facturas: clientes.reduce((s, c) => s + c.facturas, 0),
      tramos: Object.fromEntries(['0-30', '31-60', '61-90', '+90'].map((t) => [t, redondear(clientes.reduce((s, c) => s + c.tramos[t], 0))])), clientes,
      sin_comprobante: { facturas: internas.facturas, usd: redondear(internas.usd) } };
  });
}
