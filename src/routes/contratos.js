import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles } from '../lib/contexto.js';
import { ultimaCotizacion } from '../lib/cotizacion.js';
import { aDia, hoy } from '../lib/fechas.js';
import { diaAnterior } from '../lib/ipc.js';
import { redondear } from '../lib/liquidacion.js';
import { plazoDefecto } from '../lib/cobranzas.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const error = (reply, code, e, extra = {}) => reply.code(code).send({ error: e, ...extra });
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const precios = z.object({
  monto_mensual: z.number().min(0).max(1e9), franquicia_negro: z.number().int().min(0).max(10_000_000).default(0), franquicia_color: z.number().int().min(0).max(10_000_000).default(0),
  excedente_negro: z.number().min(0).max(1e6).default(0), excedente_color: z.number().min(0).max(1e6).default(0), facturable: z.boolean().default(true),
});
const datos = z.object({
  nombre: z.string().trim().min(2).max(160), sede_id: z.number().int().positive().nullable().optional(), fecha_inicio: fecha, duracion_meses: z.number().int().min(1).max(240).nullable().optional(),
  entidad_facturante_id: z.number().int().positive().nullable().optional(), plazo_pago_dias: z.number().int().min(0).max(365).nullable().optional(), notas: z.string().trim().max(2000).nullable().optional(),
});
const sumarMeses = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

export default async function rutasContratos(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('contratos.ver')];
  const editar = [auth, requerirPermiso('contratos.editar')];
  const verImportes = (ctx) => ctx.permisos.has('importes.ver');

  async function cargar(ctx, id) {
    const c = await db('contratos').where({ id }).whereNull('deleted_at').first(); if (!c) return null;
    const v = await clientesVisibles(db, ctx); if (v !== null && !v.includes(c.cliente_id)) return null; return c;
  }
  const condVigente = (id) => db('contrato_condiciones').where({ contrato_id: id }).whereNull('vigente_hasta').orderBy('vigente_desde', 'desc').first();
  const num = (c) => (c ? { ...c, vigente_desde: aDia(c.vigente_desde), vigente_hasta: aDia(c.vigente_hasta), monto_mensual: Number(c.monto_mensual), excedente_negro: Number(c.excedente_negro), excedente_color: Number(c.excedente_color),
    monto_usd_referencia: c.monto_usd_referencia == null ? null : Number(c.monto_usd_referencia), ajuste_pct: c.ajuste_pct == null ? null : Number(c.ajuste_pct), facturable: Boolean(c.facturable) } : null);

  /** Referencia en dólares del abono, con la última cotización si el contrato es en pesos. */
  async function usdRef(moneda, monto) {
    if (moneda === 'USD') return { usd: monto, cot: null };
    const cot = await ultimaCotizacion(db); return cot ? { usd: redondear(monto / Number(cot.valor)), cot: Number(cot.valor) } : { usd: null, cot: null };
  }
  const validarRefs = async (ctx, d, clienteId) => {
    if (d.sede_id && !(await db('sedes').where({ id: d.sede_id, cliente_id: clienteId }).first())) return 'sede_invalida';
    if (d.entidad_facturante_id && !(await db('entidades_facturantes').where({ id: d.entidad_facturante_id, activa: true }).first())) return 'entidad_invalida';
    return null;
  };

  app.get('/api/entidades-facturantes', { preHandler: ver }, async () => ({ items: await db('entidades_facturantes').where({ activa: true }).whereNull('deleted_at').orderBy('id').select('id', 'razon_social') }));

  app.get('/api/contratos', { preHandler: ver }, async (req) => {
    const f = z.object({ estado: z.enum(['borrador', 'vigente', 'vencido', 'rescindido']).optional(), q: z.string().trim().max(80).optional(), vencen: z.coerce.number().int().min(1).max(365).optional(), cliente_id: z.coerce.number().int().optional() }).parse(req.query);
    const v = await clientesVisibles(db, req.ctx);
    const q = db('contratos as c').join('clientes as cl', 'cl.id', 'c.cliente_id').whereNull('c.deleted_at').select('c.*', 'cl.razon_social', 'cl.nombre_comercial').orderBy('cl.razon_social').orderBy('c.nombre');
    if (v) q.whereIn('c.cliente_id', v.length ? v : [0]);
    if (f.estado) q.where('c.estado', f.estado); if (f.cliente_id) q.where('c.cliente_id', f.cliente_id);
    if (f.q) q.where((w) => w.where('cl.razon_social', 'like', `%${f.q}%`).orWhere('cl.nombre_comercial', 'like', `%${f.q}%`).orWhere('c.nombre', 'like', `%${f.q}%`));
    const filas = await q; const ids = filas.map((c) => c.id);
    const conds = ids.length ? await db('contrato_condiciones').whereIn('contrato_id', ids).whereNull('vigente_hasta') : [];
    const eq = ids.length ? await db('asignaciones_equipo').whereIn('contrato_id', ids).whereNull('hasta').groupBy('contrato_id').select('contrato_id').count({ n: '*' }) : [];
    const h = hoy();
    let items = filas.map((c) => {
      const cond = conds.find((x) => x.contrato_id === c.id); const ini = aDia(c.fecha_inicio);
      const fin = ini && c.duracion_meses ? sumarMeses(ini, c.duracion_meses) : null;
      return { id: c.id, cliente_id: c.cliente_id, cliente: c.nombre_comercial || c.razon_social, nombre: c.nombre, estado: c.estado, moneda: c.moneda, fecha_inicio: ini, fin, plazo_pago_dias: c.plazo_pago_dias,
        equipos: Number(eq.find((x) => x.contrato_id === c.id)?.n ?? 0), monto_mensual: verImportes(req.ctx) && cond ? Number(cond.monto_mensual) : null, facturable: cond ? Boolean(cond.facturable) : null,
        dias_para_fin: fin ? Math.round((Date.parse(fin) - Date.parse(h)) / 86400000) : null };
    });
    if (f.vencen) items = items.filter((c) => c.estado === 'vigente' && c.dias_para_fin != null && c.dias_para_fin <= f.vencen);
    return { items };
  });

  app.get('/api/contratos/:id', { preHandler: ver }, async (req, reply) => {
    const c = await cargar(req.ctx, Number(req.params.id)); if (!c) return error(reply, 404, 'no_encontrado');
    const [cliente, entidad, sede, condiciones, equipos, nFact, contactos] = await Promise.all([
      db('clientes').where({ id: c.cliente_id }).select('id', 'razon_social', 'nombre_comercial', 'cuit').first(),
      c.entidad_facturante_id ? db('entidades_facturantes').where({ id: c.entidad_facturante_id }).select('id', 'razon_social').first() : null,
      c.sede_id ? db('sedes').where({ id: c.sede_id }).select('id', 'nombre').first() : null,
      verImportes(req.ctx) ? db('contrato_condiciones').where({ contrato_id: c.id }).orderBy('vigente_desde', 'desc') : [],
      db('asignaciones_equipo as a').join('equipos as e', 'e.id', 'a.equipo_id').join('modelos_equipo as m', 'm.id', 'e.modelo_id').leftJoin('sedes as s', 's.id', 'a.sede_id').where('a.contrato_id', c.id).whereNull('a.hasta')
        .select('e.id', 'e.numero_serie', 'm.marca', 'm.modelo', 'm.tipo', 's.nombre as sede', 'a.desde'),
      db('facturas').where({ contrato_id: c.id }).whereNull('deleted_at').whereNot('estado', 'anulada').count({ n: '*' }).first(),
      db('contactos').where({ cliente_id: c.cliente_id }).whereNull('deleted_at').select('roles'),
    ]);
    const vigente = condiciones.find((x) => !x.vigente_hasta);
    const ini = aDia(c.fecha_inicio); const fin = ini && c.duracion_meses ? sumarMeses(ini, c.duracion_meses) : null;
    const admin = contactos.some((k) => { try { return (typeof k.roles === 'string' ? JSON.parse(k.roles) : k.roles ?? []).includes('administracion'); } catch { return false; } });
    // Lo que hace falta para que este contrato se pueda liquidar y facturar sin sorpresas.
    const checklist = [
      { ok: c.estado === 'vigente', texto: 'El contrato está vigente', ayuda: 'Solo los vigentes entran en la liquidación del mes.' },
      ...(verImportes(req.ctx) ? [{ ok: Boolean(vigente), texto: 'Tiene condiciones de precio', ayuda: 'Abono, franquicias y excedentes.' }] : []),
      { ok: equipos.length > 0, texto: 'Tiene equipos instalados', ayuda: 'Los contadores de sus equipos son la base del excedente.' },
      { ok: Boolean(c.entidad_facturante_id), texto: 'Tiene entidad facturante', ayuda: 'Quién emite la factura.' },
      { ok: c.plazo_pago_dias != null, texto: 'Tiene plazo de pago propio', ayuda: `Si no, se usan ${plazoDefecto()} días.` },
      { ok: admin, texto: 'El cliente tiene un contacto de administración', ayuda: 'A quién se le reclama el cobro.' },
    ];
    return { contrato: { ...c, fecha_inicio: ini, fin, dias_para_fin: fin ? Math.round((Date.parse(fin) - Date.parse(hoy())) / 86400000) : null }, cliente, entidad, sede, condiciones: condiciones.map(num), equipos, facturas: Number(nFact.n), checklist };
  });

  app.post('/api/contratos', { preHandler: [...editar, requerirPermiso('importes.ver')] }, async (req, reply) => {
    const d = datos.extend({ cliente_id: z.number().int().positive(), moneda: z.enum(['USD', 'ARS']), estado: z.enum(['borrador', 'vigente']).default('vigente'), precios }).parse(req.body);
    const v = await clientesVisibles(db, req.ctx);
    if (!(await db('clientes').where({ id: d.cliente_id }).whereNull('deleted_at').first()) || (v !== null && !v.includes(d.cliente_id))) return error(reply, 404, 'cliente_no_encontrado');
    const mal = await validarRefs(req.ctx, d, d.cliente_id); if (mal) return error(reply, 400, mal);
    if (d.estado === 'vigente' && d.precios.monto_mensual === 0 && d.precios.facturable) return error(reply, 400, 'abono_en_cero');
    const entidad = d.entidad_facturante_id ?? (await db('entidades_facturantes').where({ activa: true }).whereNull('deleted_at').orderBy('id').first())?.id ?? null;
    const ref = await usdRef(d.moneda, d.precios.monto_mensual);
    const id = await db.transaction(async (trx) => {
      const [cid] = await trx('contratos').insert({ cliente_id: d.cliente_id, sede_id: d.sede_id ?? null, nombre: d.nombre, estado: d.estado, fecha_inicio: d.fecha_inicio, duracion_meses: d.duracion_meses ?? null, moneda: d.moneda,
        entidad_facturante_id: entidad, plazo_pago_dias: d.plazo_pago_dias ?? null, notas: d.notas ?? null, created_by: req.ctx.id });
      await trx('contrato_condiciones').insert({ contrato_id: cid, vigente_desde: d.fecha_inicio, ...d.precios, motivo: d.precios.facturable ? 'alta' : 'sin_facturar', monto_usd_referencia: ref.usd, cotizacion_referencia: ref.cot, creado_por: req.ctx.id });
      if (d.estado === 'vigente') await trx('clientes').where({ id: d.cliente_id }).whereNot({ estado: 'activo' }).update({ estado: 'activo', fecha_baja: null, motivo_baja: null });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'contratos', cid, null, { cliente_id: d.cliente_id, nombre: d.nombre, moneda: d.moneda, monto_mensual: d.precios.monto_mensual });
      return cid;
    });
    return reply.code(201).send({ id });
  });

  app.patch('/api/contratos/:id', { preHandler: editar }, async (req, reply) => {
    const d = datos.partial().extend({ moneda: z.enum(['USD', 'ARS']).optional() }).parse(req.body);
    const c = await cargar(req.ctx, Number(req.params.id)); if (!c) return error(reply, 404, 'no_encontrado');
    const mal = await validarRefs(req.ctx, d, c.cliente_id); if (mal) return error(reply, 400, mal);
    if (d.moneda && d.moneda !== c.moneda && (await db('facturas').where({ contrato_id: c.id }).whereNull('deleted_at').first())) return error(reply, 409, 'moneda_con_facturas');
    if (d.moneda && d.moneda !== c.moneda && (await db('contrato_condiciones').where({ contrato_id: c.id }).count({ n: '*' }).first()).n > 1) return error(reply, 409, 'moneda_con_historial');
    const cambios = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
    if (!Object.keys(cambios).length) return { ok: true };
    await db.transaction(async (trx) => {
      await trx('contratos').where({ id: c.id }).update({ ...cambios, updated_by: req.ctx.id, updated_at: trx.fn.now() });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'contratos', c.id, Object.fromEntries(Object.keys(cambios).map((k) => [k, c[k]])), cambios);
    });
    return { ok: true };
  });

  /** Cambio de precios acordado (renegociación u otro): cierra la condición actual el día anterior y abre una nueva. La historia no se pisa. */
  app.post('/api/contratos/:id/condiciones', { preHandler: [...editar, requerirPermiso('importes.ver')] }, async (req, reply) => {
    const d = precios.extend({ vigente_desde: fecha, motivo: z.enum(['renegociacion', 'otro']).default('renegociacion'), notas: z.string().trim().max(255).optional() }).parse(req.body);
    const c = await cargar(req.ctx, Number(req.params.id)); if (!c) return error(reply, 404, 'no_encontrado');
    if (c.estado === 'rescindido' || c.estado === 'vencido') return error(reply, 409, 'contrato_cerrado');
    const actual = await condVigente(c.id);
    if (actual && d.vigente_desde <= aDia(actual.vigente_desde)) return error(reply, 409, 'ya_hay_condicion_posterior', { desde: aDia(actual.vigente_desde) });
    const ref = await usdRef(c.moneda, d.monto_mensual); const { vigente_desde, motivo, notas, ...p } = d;
    await db.transaction(async (trx) => {
      if (actual) await trx('contrato_condiciones').where({ id: actual.id }).update({ vigente_hasta: diaAnterior(vigente_desde) });
      const [nid] = await trx('contrato_condiciones').insert({ contrato_id: c.id, vigente_desde, ...p, motivo: p.facturable ? motivo : 'sin_facturar', notas: notas ?? null, monto_usd_referencia: ref.usd, cotizacion_referencia: ref.cot, creado_por: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'contrato_condiciones', nid, actual ? { monto_mensual: Number(actual.monto_mensual) } : null, { monto_mensual: p.monto_mensual, desde: vigente_desde, motivo });
    });
    return reply.code(201).send({ ok: true });
  });

  /** Activar un borrador, o cerrar el contrato (vencido / rescindido). No se cierra con equipos instalados: primero se retiran. */
  app.post('/api/contratos/:id/estado', { preHandler: editar }, async (req, reply) => {
    const d = z.object({ estado: z.enum(['vigente', 'vencido', 'rescindido']), fecha: fecha.optional(), motivo: z.string().trim().max(255).optional() }).parse(req.body);
    const c = await cargar(req.ctx, Number(req.params.id)); if (!c) return error(reply, 404, 'no_encontrado');
    if (c.estado === d.estado) return error(reply, 409, 'ya_esta_en_ese_estado');
    if (d.estado === 'vigente') {
      if (c.estado !== 'borrador') return error(reply, 409, 'solo_borrador_se_activa');
      if (!(await condVigente(c.id))) return error(reply, 409, 'sin_condiciones');
    } else {
      if (c.estado === 'rescindido' || c.estado === 'vencido') return error(reply, 409, 'contrato_cerrado');
      const n = Number((await db('asignaciones_equipo').where({ contrato_id: c.id }).whereNull('hasta').count({ n: '*' }).first()).n);
      if (n) return error(reply, 409, 'equipos_instalados', { equipos: n });
      if (d.estado === 'rescindido' && !d.motivo) return error(reply, 400, 'motivo_requerido');
    }
    const fin = d.fecha ?? hoy();
    await db.transaction(async (trx) => {
      await trx('contratos').where({ id: c.id }).update({ estado: d.estado, notas: d.motivo ? `${c.notas ? `${c.notas}\n` : ''}${d.estado === 'rescindido' ? 'Rescisión' : 'Cierre'} ${fin}: ${d.motivo}` : c.notas, updated_by: req.ctx.id, updated_at: trx.fn.now() });
      if (d.estado === 'vigente') await trx('clientes').where({ id: c.cliente_id }).whereNot({ estado: 'activo' }).update({ estado: 'activo', fecha_baja: null, motivo_baja: null });
      if (d.estado !== 'vigente') await trx('contrato_condiciones').where({ contrato_id: c.id }).whereNull('vigente_hasta').update({ vigente_hasta: fin });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'contratos', c.id, { estado: c.estado }, { estado: d.estado, fecha: fin, motivo: d.motivo });
    });
    return { ok: true };
  });
}
