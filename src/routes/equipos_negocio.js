// Lo que une a los equipos con el negocio del cliente: el costo del equipo y la pestaña "Equipos" del cliente con su evolutivo de contadores.
import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles } from '../lib/contexto.js';
import { consumoPeriodo, periodoDeLectura } from '../lib/contadores.js';
import { costoUsdDe, inicioDe, recalcularEquipo, vidaUtilDe } from '../lib/amortizacion.js';
import { aUsd } from '../lib/costos.js';
import { aDia, hoy } from '../lib/fechas.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const error = (reply, code, e, extra = {}) => reply.code(code).send({ error: e, ...extra });
const mesDe = (iso) => String(iso).slice(0, 7);
const siguiente = (p) => { const [a, m] = p.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; };
const anteriorN = (p, n) => { const [a, m] = p.split('-').map(Number); const t = a * 12 + (m - 1) - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

export default async function rutasEquiposNegocio(app, { db }) {
  const auth = requerirSesion(db);
  const verEquipos = [auth, requerirPermiso('equipos.ver')];
  const cargaCosto = [auth, requerirPermiso('equipos.ver'), requerirPermiso('costos.cargar')];

  /** Costo de adquisición del equipo (dato interno: solo lo ve quien tiene permiso de costos). Al guardarlo se fija el costo en USD y la vida útil, y se recalcula la amortización. */
  app.patch('/api/equipos/:id/costo', { preHandler: cargaCosto }, async (req, reply) => {
    const d = z.object({ costo_adquisicion: z.number().min(0).max(1e9).nullable(), moneda: z.enum(['USD', 'ARS']).default('USD'), fecha_adquisicion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(req.body);
    const e = await db('equipos').where({ id: Number(req.params.id) }).whereNull('deleted_at').first(); if (!e) return error(reply, 404, 'no_encontrado');
    const fecha = d.fecha_adquisicion !== undefined ? d.fecha_adquisicion : aDia(e.fecha_adquisicion);
    let costoUsd = null;
    if (d.costo_adquisicion != null && d.costo_adquisicion > 0) {
      const conv = await aUsd(db, d.costo_adquisicion, d.moneda, fecha ?? hoy()); if (!conv) return error(reply, 400, 'sin_cotizacion');
      costoUsd = conv.usd;
    }
    const cambios = { costo_adquisicion: d.costo_adquisicion, moneda: d.moneda, costo_usd: costoUsd, vida_util_meses: e.vida_util_meses ?? vidaUtilDe({}), ...(d.fecha_adquisicion !== undefined ? { fecha_adquisicion: d.fecha_adquisicion } : {}) };
    await db.transaction(async (trx) => {
      await trx('equipos').where({ id: e.id }).update({ ...cambios, updated_by: req.ctx.id, updated_at: trx.fn.now() });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'equipos', e.id, { costo_adquisicion: e.costo_adquisicion, moneda: e.moneda }, cambios);
    });
    await recalcularEquipo(db, e.id);
    return { ok: true, costo_usd: costoUsd };
  });

  /** Costo del equipo, su amortización mes a mes (quién la cargó) y lo que falta amortizar. */
  app.get('/api/equipos/:id/costo', { preHandler: [auth, requerirPermiso('equipos.ver'), requerirPermiso('costos.ver')] }, async (req, reply) => {
    const e = await db('equipos').where({ id: Number(req.params.id) }).whereNull('deleted_at').first(); if (!e) return error(reply, 404, 'no_encontrado');
    const asig = await db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').join('clientes as cl', 'cl.id', 'c.cliente_id')
      .where('a.equipo_id', e.id).whereNull('a.hasta').select('a.desde', 'c.id as contrato_id', 'c.nombre as contrato', 'cl.id as cliente_id', 'cl.razon_social', 'cl.nombre_comercial').first();
    const costo = await costoUsdDe(db, e);
    const filas = await db('costos as k').leftJoin('clientes as cl', 'cl.id', 'k.cliente_id').where({ 'k.equipo_id': e.id, 'k.origen': 'amortizacion' }).whereNull('k.deleted_at').orderBy('k.fecha')
      .select('k.fecha', 'k.tipo', 'k.importe_usd', 'k.cliente_id', 'cl.razon_social', 'cl.nombre_comercial');
    const amort = filas.filter((f) => f.tipo === 'amortizacion'); const perdida = filas.find((f) => f.tipo === 'perdida');
    const cargado = amort.reduce((t, f) => t + Number(f.importe_usd), 0);
    const vida = vidaUtilDe(e); const asigs = await db('asignaciones_equipo').where({ equipo_id: e.id }).select('desde', 'hasta');
    const inicio = inicioDe(e, asigs);
    const porCliente = new Map();
    for (const f of amort) { const k = f.cliente_id ?? 0; const x = porCliente.get(k) ?? { cliente_id: f.cliente_id, cliente: f.cliente_id ? (f.nombre_comercial || f.razon_social) : 'Flota (depósito o taller)', usd: 0 }; x.usd += Number(f.importe_usd); porCliente.set(k, x); }
    const mesesCargados = new Set(amort.map((f) => String(aDia(f.fecha)).slice(0, 7))).size;
    return {
      costo_adquisicion: e.costo_adquisicion == null ? null : Number(e.costo_adquisicion), moneda: e.moneda, fecha_adquisicion: aDia(e.fecha_adquisicion), costo_usd: costo, vida_util_meses: vida, inicio: costo ? inicio : null,
      meses_amortizados: Math.min(vida, mesesCargados), amortizado: Math.round(cargado * 100) / 100, valor_en_libros: costo == null ? null : (e.estado === 'baja' ? 0 : Math.round((costo - cargado) * 100) / 100),
      perdida_baja: perdida ? Number(perdida.importe_usd) : null,
      cliente_actual: asig ? { id: asig.cliente_id, nombre: asig.nombre_comercial || asig.razon_social, contrato: asig.contrato, desde: aDia(asig.desde) } : null,
      reparto: [...porCliente.values()].map((x) => ({ ...x, usd: Math.round(x.usd * 100) / 100 })),
      meses: amort.map((f) => ({ mes: String(aDia(f.fecha)).slice(0, 7), usd: Number(f.importe_usd), cliente_id: f.cliente_id })),
    };
  });

  /**
   * Equipos de un cliente (hoy y los que pasaron) con el consumo mensual de cada uno, para agrupar por local, por contrato o en total.
   * El consumo de cada mes sale igual que en la liquidación: última lectura del mes menos la anterior dentro de la misma asignación.
   */
  app.get('/api/clientes/:id/equipos', { preHandler: verEquipos }, async (req, reply) => {
    const id = Number(req.params.id); const v = await clientesVisibles(db, req.ctx);
    if (v !== null && !v.includes(id)) return error(reply, 404, 'no_encontrado');
    if (!(await db('clientes').where({ id }).whereNull('deleted_at').first())) return error(reply, 404, 'no_encontrado');
    const filas = await db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').join('equipos as e', 'e.id', 'a.equipo_id').join('modelos_equipo as m', 'm.id', 'e.modelo_id').leftJoin('sedes as s', 's.id', 'a.sede_id')
      .where('c.cliente_id', id).whereNull('c.deleted_at').orderBy('a.desde', 'desc')
      .select('a.id as asignacion_id', 'a.equipo_id', 'a.desde', 'a.hasta', 'a.contador_inicial_negro', 'a.contador_inicial_color', 'e.numero_serie', 'e.estado', 'm.marca', 'm.modelo', 'm.tipo',
        'c.id as contrato_id', 'c.nombre as contrato', 's.id as sede_id', 's.nombre as sede', 's.localidad');
    const ids = [...new Set(filas.map((f) => f.equipo_id))];
    const lects = ids.length ? await db('lecturas_contador').whereIn('equipo_id', ids).orderBy('fecha').orderBy('id') : [];
    const por = new Map(); for (const l of lects) { if (!por.has(l.equipo_id)) por.set(l.equipo_id, []); por.get(l.equipo_id).push({ ...l, fecha: aDia(l.fecha), per: periodoDeLectura(l) }); }
    const mesHoy = hoy().slice(0, 7); const piso = anteriorN(mesHoy, 23); // hasta 24 meses
    const equipos = filas.map((f) => {
      const ls = por.get(f.equipo_id) ?? []; const asig = { desde: aDia(f.desde), contador_inicial_negro: f.contador_inicial_negro, contador_inicial_color: f.contador_inicial_color, tipo: f.tipo };
      const fin = f.hasta ? mesDe(aDia(f.hasta)) : mesHoy; let p = mesDe(aDia(f.desde)); if (p < piso) p = piso;
      const serie = [];
      for (; p <= fin; p = siguiente(p)) { const k = consumoPeriodo(ls, p, asig); serie.push({ periodo: p, negro: k ? k.negro : null, color: k ? k.color : null }); }
      const ult = ls.filter((l) => l.fecha >= asig.desde && (!f.hasta || l.fecha <= aDia(f.hasta))).at(-1);
      return { asignacion_id: f.asignacion_id, equipo_id: f.equipo_id, numero_serie: f.numero_serie, marca: f.marca, modelo: f.modelo, tipo: f.tipo, estado: f.estado, vigente: !f.hasta, desde: asig.desde, hasta: aDia(f.hasta),
        contrato_id: f.contrato_id, contrato: f.contrato, sede_id: f.sede_id, sede: f.sede ?? 'Sin local', localidad: f.localidad ?? null, ultima_lectura: ult ? { fecha: ult.fecha, negro: ult.contador_negro, color: ult.contador_color } : null, serie };
    });
    return { equipos };
  });
}
