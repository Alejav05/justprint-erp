import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles } from '../lib/contexto.js';
import { ultimaCotizacion } from '../lib/cotizacion.js';
import { aDia } from '../lib/fechas.js';
import { acumuladoCompuesto, aplicarAjuste, diaAnterior, mesesHasta } from '../lib/ipc.js';
import { redondear } from '../lib/liquidacion.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const error = (reply, code, e, extra = {}) => reply.code(code).send({ error: e, ...extra });
const periodo = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export default async function rutasAjustes(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('importes.ver')];
  const editar = [auth, requerirPermiso('importes.ver'), requerirPermiso('contratos.editar')];

  app.get('/api/ipc', { preHandler: ver }, async () => ({
    items: (await db('indices_ipc').orderBy('periodo', 'desc').limit(48)).map((i) => ({ periodo: i.periodo, variacion: Number(i.variacion) })),
  }));

  app.put('/api/ipc/:periodo', { preHandler: editar }, async (req, reply) => {
    const p = periodo.safeParse(req.params.periodo); if (!p.success) return error(reply, 400, 'periodo_invalido');
    const d = z.object({ variacion: z.number().min(-20).max(100) }).parse(req.body);
    const previo = await db('indices_ipc').where({ periodo: p.data }).first();
    await db.transaction(async (trx) => {
      if (previo) await trx('indices_ipc').where({ id: previo.id }).update({ variacion: d.variacion, updated_at: trx.fn.now() });
      else await trx('indices_ipc').insert({ periodo: p.data, variacion: d.variacion, created_by: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, previo ? 'editar' : 'crear', 'indices_ipc', previo?.id ?? 0, previo ? { variacion: Number(previo.variacion) } : null, { periodo: p.data, variacion: d.variacion });
    });
    return { ok: true };
  });

  /** Arma la propuesta: IPC de los 3 meses que terminan en `hasta`, acumulado compuesto, precios nuevos. */
  async function proponer(ctx, id, hasta) {
    const contrato = await db('contratos').where({ id }).whereNull('deleted_at').first();
    const v = contrato ? await clientesVisibles(db, ctx) : null;
    if (!contrato || (v !== null && !v.includes(contrato.cliente_id))) return { codigo: 404, error: 'no_encontrado' };
    const cond = await db('contrato_condiciones').where({ contrato_id: id }).whereNull('vigente_hasta').orderBy('vigente_desde', 'desc').first();
    if (contrato.moneda !== 'ARS') return { codigo: 409, error: 'solo_pesos' }; // el ajuste por IPC aplica solo a contratos en pesos
    if (!cond) return { codigo: 409, error: 'sin_condiciones' };
    const meses = mesesHasta(hasta);
    const filas = await db('indices_ipc').whereIn('periodo', meses);
    const faltan = meses.filter((m) => !filas.some((f) => f.periodo === m));
    const vigenteDesde = `${hasta}-01`;
    if (aDia(cond.vigente_desde) >= vigenteDesde) return { codigo: 409, error: 'ya_ajustado', desde: aDia(cond.vigente_desde) };
    const base = { contrato_id: id, contrato: contrato.nombre, moneda: contrato.moneda, vigente_desde: vigenteDesde, meses, actual: { monto_mensual: Number(cond.monto_mensual), excedente_negro: Number(cond.excedente_negro), excedente_color: Number(cond.excedente_color) } };
    if (faltan.length) return { ok: false, codigo: 400, error: 'faltan_ipc', faltan, ...base };
    const ipc = meses.map((m) => ({ periodo: m, variacion: Number(filas.find((f) => f.periodo === m).variacion) }));
    const pct = acumuladoCompuesto(ipc.map((x) => x.variacion));
    const nuevo = aplicarAjuste(cond, pct);
    return { ok: true, ...base, ipc, pct: redondear(pct, 3), nuevo, cond, pctExacto: pct };
  }

  app.get('/api/contratos/:id/ajuste', { preHandler: ver }, async (req, reply) => {
    const { hasta } = z.object({ hasta: periodo }).parse(req.query);
    const r = await proponer(req.ctx, Number(req.params.id), hasta);
    if (r.codigo === 404 || r.codigo === 409) return error(reply, r.codigo, r.error, r.desde ? { desde: r.desde } : {});
    const { cond, pctExacto, codigo, ...salida } = r;
    return salida;
  });

  app.post('/api/contratos/:id/ajuste', { preHandler: editar }, async (req, reply) => {
    const d = z.object({ hasta: periodo, notas: z.string().trim().max(255).optional() }).parse(req.body);
    const r = await proponer(req.ctx, Number(req.params.id), d.hasta);
    if (r.error === 'faltan_ipc') return error(reply, 400, 'faltan_ipc', { faltan: r.faltan });
    if (r.error) return error(reply, r.codigo, r.error);
    const cot = await ultimaCotizacion(db);
    const usdRef = r.moneda === 'USD' ? r.nuevo.monto_mensual : (cot ? redondear(r.nuevo.monto_mensual / Number(cot.valor)) : null);
    const id = await db.transaction(async (trx) => {
      await trx('contrato_condiciones').where({ id: r.cond.id }).update({ vigente_hasta: diaAnterior(r.vigente_desde) });
      const [nuevoId] = await trx('contrato_condiciones').insert({
        contrato_id: r.contrato_id, vigente_desde: r.vigente_desde, monto_mensual: r.nuevo.monto_mensual, franquicia_negro: r.cond.franquicia_negro, franquicia_color: r.cond.franquicia_color,
        excedente_negro: r.nuevo.excedente_negro, excedente_color: r.nuevo.excedente_color, motivo: 'ajuste_ipc', ajuste_pct: r.pct, monto_usd_referencia: usdRef,
        cotizacion_referencia: r.moneda === 'ARS' && cot ? Number(cot.valor) : null, facturable: r.cond.facturable, notas: d.notas ?? `IPC ${r.meses[0]} a ${r.meses[2]} (compuesto)`, creado_por: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'contrato_condiciones', nuevoId, { monto_mensual: r.actual.monto_mensual }, { monto_mensual: r.nuevo.monto_mensual, ajuste_pct: r.pct, desde: r.vigente_desde });
      return nuevoId;
    });
    return reply.code(201).send({ id, pct: r.pct, nuevo: r.nuevo, vigente_desde: r.vigente_desde });
  });
}
