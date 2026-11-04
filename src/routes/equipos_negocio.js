// Lo que une a los equipos con el negocio del cliente: el costo del equipo y la pestaña "Equipos" del cliente con su evolutivo de contadores.
import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles } from '../lib/contexto.js';
import { consumoPeriodo, periodoDeLectura } from '../lib/contadores.js';
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

  /** Costo de adquisición del equipo (dato interno: solo lo ve quien tiene permiso de costos). */
  app.patch('/api/equipos/:id/costo', { preHandler: cargaCosto }, async (req, reply) => {
    const d = z.object({ costo_adquisicion: z.number().min(0).max(1e9).nullable(), moneda: z.enum(['USD', 'ARS']).default('USD'), fecha_adquisicion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(req.body);
    const e = await db('equipos').where({ id: Number(req.params.id) }).whereNull('deleted_at').first(); if (!e) return error(reply, 404, 'no_encontrado');
    const cambios = { costo_adquisicion: d.costo_adquisicion, moneda: d.moneda, ...(d.fecha_adquisicion !== undefined ? { fecha_adquisicion: d.fecha_adquisicion } : {}) };
    await db.transaction(async (trx) => {
      await trx('equipos').where({ id: e.id }).update({ ...cambios, updated_by: req.ctx.id, updated_at: trx.fn.now() });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'equipos', e.id, { costo_adquisicion: e.costo_adquisicion, moneda: e.moneda }, cambios);
    });
    return { ok: true };
  });

  /** Lo ya imputado al negocio de un cliente por este equipo, y el cliente/contrato donde está hoy. */
  async function estadoCosto(equipoId) {
    const asig = await db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').join('clientes as cl', 'cl.id', 'c.cliente_id')
      .where('a.equipo_id', equipoId).whereNull('a.hasta').select('a.desde', 'c.id as contrato_id', 'c.nombre as contrato', 'cl.id as cliente_id', 'cl.razon_social', 'cl.nombre_comercial').first();
    const imputaciones = await db('costos as k').leftJoin('clientes as cl', 'cl.id', 'k.cliente_id').where({ 'k.equipo_id': equipoId, 'k.origen': 'equipo' }).whereNull('k.deleted_at')
      .orderBy('k.fecha', 'desc').select('k.id', 'k.fecha', 'k.importe_usd', 'k.cliente_id', 'cl.razon_social', 'cl.nombre_comercial');
    return { asig, imputaciones };
  }

  app.get('/api/equipos/:id/costo', { preHandler: [auth, requerirPermiso('equipos.ver'), requerirPermiso('costos.ver')] }, async (req, reply) => {
    const e = await db('equipos').where({ id: Number(req.params.id) }).whereNull('deleted_at').first(); if (!e) return error(reply, 404, 'no_encontrado');
    const { asig, imputaciones } = await estadoCosto(e.id);
    return {
      costo_adquisicion: e.costo_adquisicion == null ? null : Number(e.costo_adquisicion), moneda: e.moneda, fecha_adquisicion: aDia(e.fecha_adquisicion),
      cliente_actual: asig ? { id: asig.cliente_id, nombre: asig.nombre_comercial || asig.razon_social, contrato: asig.contrato, desde: aDia(asig.desde) } : null,
      imputaciones: imputaciones.map((i) => ({ id: i.id, fecha: aDia(i.fecha), usd: Number(i.importe_usd), cliente_id: i.cliente_id, cliente: i.nombre_comercial || i.razon_social })),
    };
  });

  /** Carga el costo del equipo al negocio del cliente donde está instalado (una vez por cliente). Queda como costo "Equipo", en la fecha de la instalación. */
  app.post('/api/equipos/:id/imputar-costo', { preHandler: cargaCosto }, async (req, reply) => {
    const e = await db('equipos as e').join('modelos_equipo as m', 'm.id', 'e.modelo_id').where('e.id', Number(req.params.id)).whereNull('e.deleted_at').select('e.*', 'm.marca', 'm.modelo').first();
    if (!e) return error(reply, 404, 'no_encontrado');
    if (e.costo_adquisicion == null || Number(e.costo_adquisicion) <= 0) return error(reply, 409, 'sin_costo');
    const { asig, imputaciones } = await estadoCosto(e.id);
    if (!asig) return error(reply, 409, 'sin_cliente');
    const v = await clientesVisibles(db, req.ctx); if (v !== null && !v.includes(asig.cliente_id)) return error(reply, 404, 'no_encontrado');
    if (imputaciones.some((i) => i.cliente_id === asig.cliente_id)) return error(reply, 409, 'ya_imputado');
    const fecha = aDia(asig.desde) > hoy() ? hoy() : aDia(asig.desde);
    const conv = await aUsd(db, Number(e.costo_adquisicion), e.moneda, fecha); if (!conv) return error(reply, 400, 'sin_cotizacion');
    const id = await db.transaction(async (trx) => {
      const [nuevo] = await trx('costos').insert({ fecha, concepto: `Equipo ${e.marca} ${e.modelo} · ${e.numero_serie}`.slice(0, 200), tipo: 'equipo', importe: Number(e.costo_adquisicion), moneda: e.moneda, cotizacion: conv.cotizacion, importe_usd: conv.usd,
        cliente_id: asig.cliente_id, equipo_id: e.id, contrato_id: asig.contrato_id, origen: 'equipo', created_by: req.ctx.id, updated_by: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'costos', nuevo, null, { cliente_id: asig.cliente_id, equipo_id: e.id, importe_usd: conv.usd, origen: 'equipo' });
      return nuevo;
    });
    return reply.code(201).send({ id, usd: conv.usd });
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
