import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles } from '../lib/contexto.js';
import { ultimaCotizacion } from '../lib/cotizacion.js';
import { aDia, hoy } from '../lib/fechas.js';
import { traerIpc } from '../lib/indec.js';
import { acumuladoCompuesto, aplicarAjuste, diaAnterior, mesesAntes, proximoAjusteMes, sumarPeriodo } from '../lib/ipc.js';
import { redondear } from '../lib/liquidacion.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const error = (reply, code, e, extra = {}) => reply.code(code).send({ error: e, ...extra });
const periodo = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const salidaIndice = (i) => ({ periodo: i.periodo, variacion: Number(i.variacion), fuente: i.fuente, revisado: Boolean(i.revisado) });

export default async function rutasAjustes(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('importes.ver')];
  const editar = [auth, requerirPermiso('importes.ver'), requerirPermiso('contratos.editar')];

  app.get('/api/ipc', { preHandler: ver }, async () => ({ items: (await db('indices_ipc').orderBy('periodo', 'desc').limit(48)).map(salidaIndice) }));

  /** Carga o corrige un índice a mano. Lo cargado a mano queda revisado y el importador no lo pisa. */
  app.put('/api/ipc/:periodo', { preHandler: editar }, async (req, reply) => {
    const p = periodo.safeParse(req.params.periodo); if (!p.success) return error(reply, 400, 'periodo_invalido');
    const d = z.object({ variacion: z.number().min(-20).max(100) }).parse(req.body);
    const previo = await db('indices_ipc').where({ periodo: p.data }).first();
    await db.transaction(async (trx) => {
      if (previo) await trx('indices_ipc').where({ id: previo.id }).update({ variacion: d.variacion, fuente: 'manual', revisado: true, updated_at: trx.fn.now() });
      else await trx('indices_ipc').insert({ periodo: p.data, variacion: d.variacion, fuente: 'manual', revisado: true, created_by: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, previo ? 'editar' : 'crear', 'indices_ipc', previo?.id ?? 0, previo ? { variacion: Number(previo.variacion) } : null, { periodo: p.data, variacion: d.variacion });
    });
    return { ok: true };
  });

  app.post('/api/ipc/:periodo/revisar', { preHandler: editar }, async (req, reply) => {
    const p = periodo.safeParse(req.params.periodo); if (!p.success) return error(reply, 400, 'periodo_invalido');
    const n = await db('indices_ipc').where({ periodo: p.data }).update({ revisado: true, updated_at: db.fn.now() });
    return n ? { ok: true } : error(reply, 404, 'no_encontrado');
  });

  /** Trae el IPC publicado (datos.gob.ar / INDEC). Agrega lo que falta y actualiza lo importado que nadie revisó; lo revisado o cargado a mano no se toca. */
  async function importar(usuarioId, ip) {
    const desde = sumarPeriodo(hoy().slice(0, 7), -14);
    const nuevos = await traerIpc({ desde }); let agregados = 0; let actualizados = 0;
    await db.transaction(async (trx) => {
      for (const x of nuevos) {
        const previo = await trx('indices_ipc').where({ periodo: x.periodo }).first();
        if (!previo) { await trx('indices_ipc').insert({ periodo: x.periodo, variacion: x.variacion, fuente: 'indec', revisado: false, created_by: usuarioId }); agregados += 1; } else if (previo.fuente === 'indec' && !previo.revisado && Number(previo.variacion) !== x.variacion) {
          await trx('indices_ipc').where({ id: previo.id }).update({ variacion: x.variacion, updated_at: trx.fn.now() }); actualizados += 1;
        }
      }
      if (agregados || actualizados) await auditar(trx, { usuarioId, ip }, 'crear', 'indices_ipc', 0, null, { importados: agregados, actualizados, fuente: 'datos.gob.ar' });
    });
    return { agregados, actualizados, ultimo: nuevos.at(-1)?.periodo ?? null };
  }

  app.post('/api/ipc/importar', { preHandler: editar }, async (req, reply) => {
    try { return await importar(req.ctx.id, req.ip); } catch (e) { req.log.warn({ err: e }, 'importar IPC'); return error(reply, 502, 'fuente_no_disponible'); }
  });

  /** Calcula el ajuste de un contrato para el mes de servicio `desde` (por defecto, el que toca según su acuerdo). */
  async function calcular(contrato, desdeMes) {
    const cond = await db('contrato_condiciones').where({ contrato_id: contrato.id }).whereNull('vigente_hasta').orderBy('vigente_desde', 'desc').first();
    if (!cond) return { codigo: 409, error: 'sin_condiciones' };
    const ultimo = await db('contrato_condiciones').where({ contrato_id: contrato.id, motivo: 'ajuste_ipc' }).max({ d: 'vigente_desde' }).first();
    const ultimoAjuste = ultimo?.d ? aDia(ultimo.d).slice(0, 7) : null;
    const n = contrato.ajuste_ipc_meses || 3;
    const e = desdeMes ?? proximoAjusteMes({ meses: contrato.ajuste_ipc_meses, base: contrato.ajuste_ipc_base, ultimoAjuste });
    if (!e) return { codigo: 409, error: 'sin_acuerdo' };
    const vigenteDesde = `${e}-01`;
    const meses = mesesAntes(e, n);
    const base = { contrato_id: contrato.id, contrato: contrato.nombre, moneda: contrato.moneda, cada: n, desde: e, vigente_desde: vigenteDesde, meses, actual: { monto_mensual: Number(cond.monto_mensual), excedente_negro: Number(cond.excedente_negro), excedente_color: Number(cond.excedente_color) } };
    if (aDia(cond.vigente_desde) >= vigenteDesde) return { codigo: 409, error: 'ya_ajustado', desde: aDia(cond.vigente_desde) };
    const facturado = await db('facturas').where({ contrato_id: contrato.id }).where('periodo', '>=', e).whereNull('deleted_at').whereNot('estado', 'anulada').first();
    if (facturado) return { codigo: 409, error: 'periodo_facturado', periodo: facturado.periodo };
    const filas = await db('indices_ipc').whereIn('periodo', meses);
    const faltan = meses.filter((m) => !filas.some((f) => f.periodo === m));
    if (faltan.length) return { ok: false, codigo: 400, error: 'faltan_ipc', faltan, ...base };
    const ipc = meses.map((m) => { const f = filas.find((x) => x.periodo === m); return { periodo: m, variacion: Number(f.variacion), fuente: f.fuente, revisado: Boolean(f.revisado) }; });
    const pct = acumuladoCompuesto(ipc.map((x) => x.variacion));
    return { ok: true, ...base, ipc, pct: redondear(pct, 3), nuevo: aplicarAjuste(cond, pct), cond, sin_revisar: ipc.filter((x) => !x.revisado).map((x) => x.periodo) };
  }

  async function cargarContrato(ctx, id) {
    const contrato = await db('contratos').where({ id }).whereNull('deleted_at').first();
    const v = contrato ? await clientesVisibles(db, ctx) : null;
    if (!contrato || (v !== null && !v.includes(contrato.cliente_id))) return { codigo: 404, error: 'no_encontrado' };
    if (contrato.moneda !== 'ARS') return { codigo: 409, error: 'solo_pesos' }; // el ajuste por IPC aplica solo a contratos en pesos
    return { contrato };
  }

  /** Pantalla central: cada contrato con acuerdo de ajuste, qué toca y en qué estado está. */
  app.get('/api/ajustes-ipc', { preHandler: ver }, async (req) => {
    const v = await clientesVisibles(db, req.ctx);
    let q = db('contratos as c').join('clientes', 'clientes.id', 'c.cliente_id').where({ 'c.estado': 'vigente', 'c.moneda': 'ARS' }).whereNull('c.deleted_at').whereNotNull('c.ajuste_ipc_meses')
      .select('c.*', 'clientes.razon_social', 'clientes.nombre_comercial');
    if (v !== null) q = q.whereIn('c.cliente_id', v);
    const items = [];
    for (const c of await q.orderBy('clientes.razon_social')) {
      const r = await calcular(c, null);
      const cliente = c.nombre_comercial || c.razon_social;
      const mesHoy = hoy().slice(0, 7);
      const comun = { contrato_id: c.id, cliente, contrato: c.nombre, cada: c.ajuste_ipc_meses, desde: r.desde ?? null };
      if (r.error && r.error !== 'faltan_ipc') { items.push({ ...comun, estado: r.error }); continue; }
      const estado = r.error === 'faltan_ipc' ? (r.desde > mesHoy ? 'futuro' : 'faltan_ipc') : (r.desde > mesHoy ? 'futuro' : (r.sin_revisar.length ? 'revisar' : 'listo'));
      items.push({ ...comun, estado, meses: r.meses, faltan: r.faltan ?? [], ipc: r.ipc ?? null, pct: r.pct ?? null, actual: r.actual, nuevo: r.nuevo ?? null, vigente_desde: r.vigente_desde });
    }
    const indices = (await db('indices_ipc').orderBy('periodo', 'desc').limit(18)).map(salidaIndice);
    return { items, indices };
  });

  app.get('/api/contratos/:id/ajuste', { preHandler: ver }, async (req, reply) => {
    const { desde } = z.object({ desde: periodo.optional() }).parse(req.query);
    const c = await cargarContrato(req.ctx, Number(req.params.id)); if (c.error) return error(reply, c.codigo, c.error);
    const r = await calcular(c.contrato, desde ?? null);
    if (r.error && r.error !== 'faltan_ipc') return error(reply, r.codigo, r.error, r.desde ? { desde: r.desde } : r.periodo ? { periodo: r.periodo } : {});
    const { cond, codigo, ...salida } = r;
    return salida;
  });

  app.post('/api/contratos/:id/ajuste', { preHandler: editar }, async (req, reply) => {
    const d = z.object({ desde: periodo.optional(), notas: z.string().trim().max(255).optional() }).parse(req.body);
    const c = await cargarContrato(req.ctx, Number(req.params.id)); if (c.error) return error(reply, c.codigo, c.error);
    const r = await calcular(c.contrato, d.desde ?? null);
    if (r.error === 'faltan_ipc') return error(reply, 400, 'faltan_ipc', { faltan: r.faltan });
    if (r.error) return error(reply, r.codigo, r.error);
    const cot = await ultimaCotizacion(db);
    const usdRef = cot ? redondear(r.nuevo.monto_mensual / Number(cot.valor)) : null;
    const id = await db.transaction(async (trx) => {
      await trx('contrato_condiciones').where({ id: r.cond.id }).update({ vigente_hasta: diaAnterior(r.vigente_desde) });
      const [nuevoId] = await trx('contrato_condiciones').insert({
        contrato_id: r.contrato_id, vigente_desde: r.vigente_desde, monto_mensual: r.nuevo.monto_mensual, franquicia_negro: r.cond.franquicia_negro, franquicia_color: r.cond.franquicia_color,
        excedente_negro: r.nuevo.excedente_negro, excedente_color: r.nuevo.excedente_color, motivo: 'ajuste_ipc', ajuste_pct: r.pct, monto_usd_referencia: usdRef,
        cotizacion_referencia: cot ? Number(cot.valor) : null, facturable: r.cond.facturable, notas: d.notas ?? `IPC ${r.meses[0]} a ${r.meses.at(-1)} (compuesto)`, creado_por: req.ctx.id });
      await trx('contratos').where({ id: r.contrato_id }).update({ ajuste_ipc_base: r.desde });
      await trx('indices_ipc').whereIn('periodo', r.meses).update({ revisado: true }); // confirmar el ajuste es la revisión de esos índices
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'contrato_condiciones', nuevoId, { monto_mensual: r.actual.monto_mensual }, { monto_mensual: r.nuevo.monto_mensual, ajuste_pct: r.pct, desde: r.vigente_desde });
      return nuevoId;
    });
    return reply.code(201).send({ id, pct: r.pct, nuevo: r.nuevo, vigente_desde: r.vigente_desde });
  });
}
