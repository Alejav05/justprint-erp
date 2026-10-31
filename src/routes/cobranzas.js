import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles, puede } from '../lib/contexto.js';
import { aDia, hoy } from '../lib/fechas.js';
import { GRACIA_DIAS, PLAZO_DEFECTO_DIAS, plazoDe, semaforo, sumarDias } from '../lib/cobranzas.js';
import { redondear } from '../lib/liquidacion.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const error = (reply, code, e, extra = {}) => reply.code(code).send({ error: e, ...extra });
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const json = (v) => { if (v == null) return []; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return []; } };
const ESTADOS_ABIERTOS = ['emitida', 'cobrada_parcial'];

export default async function rutasCobranzas(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('importes.ver')];

  const gestiona = (ctx) => puede(ctx, 'cobranzas.gestionar');
  const soloEscaladas = (ctx) => !gestiona(ctx); // sin el permiso de cobranzas, solo se ven las que le pasaron al comercial

  const saldos = async (ids) => {
    const m = new Map(); if (!ids.length) return m;
    for (const a of await db('cobro_aplicaciones').whereIn('factura_id', ids).groupBy('factura_id').select('factura_id').sum({ s: 'importe' })) m.set(a.factura_id, Number(a.s));
    return m;
  };
  const comerciales = async () => { const m = new Map(); for (const f of await db('cartera_asignaciones').join('usuarios', 'usuarios.id', 'cartera_asignaciones.usuario_id').whereNull('cartera_asignaciones.hasta').select('cartera_asignaciones.cliente_id', 'usuarios.id', 'usuarios.nombre')) m.set(f.cliente_id, { id: f.id, nombre: f.nombre }); return m; };

  /** Facturas abiertas con su semáforo, ya filtradas por lo que cada persona puede ver. */
  async function abiertas(ctx, { cliente_id } = {}) {
    const v = await clientesVisibles(db, ctx);
    const q = db('facturas').join('clientes as cl', 'cl.id', 'facturas.cliente_id').leftJoin('contratos as ct', 'ct.id', 'facturas.contrato_id')
      .whereNull('facturas.deleted_at').whereIn('facturas.estado', ESTADOS_ABIERTOS)
      .select('facturas.*', 'cl.razon_social', 'cl.nombre_comercial', 'ct.nombre as contrato_nombre', 'ct.plazo_pago_dias as contrato_plazo');
    if (v) q.whereIn('facturas.cliente_id', v.length ? v : [0]);
    if (cliente_id) q.where('facturas.cliente_id', cliente_id);
    if (soloEscaladas(ctx)) q.where('facturas.estado_gestion', 'escalada');
    const filas = await q;
    const ap = await saldos(filas.map((f) => f.id)); const com = await comerciales(); const h = hoy();
    const ultimas = new Map();
    if (filas.length) for (const g of await db('gestiones_cobranza').whereIn('factura_id', filas.map((f) => f.id)).whereNot('tipo', 'escalada').orderBy('id')) ultimas.set(g.factura_id, g);
    return filas.filter((f) => f.entidad_facturante_id).map((f) => {
      const total = Number(f.total); const saldo = redondear(total - (ap.get(f.id) ?? 0));
      const usd = total > 0 ? redondear((saldo / total) * Number(f.neto_usd ?? 0)) : 0;
      const s = semaforo(f, h, { plazo_pago_dias: f.contrato_plazo });
      const u = ultimas.get(f.id);
      return { id: f.id, cliente_id: f.cliente_id, cliente: f.nombre_comercial || f.razon_social, periodo: f.periodo, numero: f.numero, moneda: f.moneda, total, saldo, saldo_usd: usd,
        emision: aDia(f.fecha_emision), estimada: Boolean(f.fecha_emision_estimada), plazo: plazoDe(f, { plazo_pago_dias: f.contrato_plazo }), vence: s.vence, dias_vencida: s.dias_vencida, color: s.color,
        estado_gestion: f.estado_gestion, proxima_gestion: aDia(f.proxima_gestion), escalada_en: aDia(f.escalada_en), contrato: f.contrato_nombre,
        comercial: com.get(f.cliente_id) ?? null, escalada_a: f.escalada_a, ultima: u ? { fecha: aDia(u.fecha), tipo: u.tipo, resultado: u.resultado } : null };
    });
  }

  /** Tablero de cobranzas: lo pendiente de cobro con su semáforo. Los plazos son los del contrato de cada cliente. */
  app.get('/api/cobranzas/semaforo', { preHandler: ver }, async (req) => {
    const items = await abiertas(req.ctx);
    const orden = { rojo: 0, amarillo: 1, verde: 2 };
    items.sort((a, b) => orden[a.color] - orden[b.color] || b.dias_vencida - a.dias_vencida || b.saldo_usd - a.saldo_usd);
    const resumen = { total_usd: 0, facturas: items.length, escaladas: items.filter((i) => i.estado_gestion === 'escalada').length, hoy: items.filter((i) => i.proxima_gestion && i.proxima_gestion <= hoy()).length };
    for (const c of ['verde', 'amarillo', 'rojo']) { const l = items.filter((i) => i.color === c); resumen[c] = { n: l.length, usd: redondear(l.reduce((s, i) => s + i.saldo_usd, 0)) }; }
    resumen.total_usd = redondear(resumen.verde.usd + resumen.amarillo.usd + resumen.rojo.usd);
    const internas = await db('facturas').whereNull('deleted_at').whereIn('estado', ESTADOS_ABIERTOS).whereNull('entidad_facturante_id').count({ n: '*' }).first();
    return { gracia: GRACIA_DIAS, plazo_defecto: PLAZO_DEFECTO_DIAS, solo_escaladas: soloEscaladas(req.ctx), resumen, items, sin_comprobante: Number(internas.n) };
  });

  async function cargar(req, reply) {
    const id = Number(req.params.id);
    const f = (await abiertas(req.ctx)).find((x) => x.id === id);
    if (f) return f;
    // Cobrada o fuera de alcance: para el detalle se informa el motivo.
    error(reply, 404, 'no_encontrado'); return null;
  }

  app.get('/api/cobranzas/facturas/:id', { preHandler: ver }, async (req, reply) => {
    const f = await cargar(req, reply); if (!f) return;
    const gestiones = await db('gestiones_cobranza as g').join('usuarios as u', 'u.id', 'g.usuario_id').where('g.factura_id', f.id).orderBy('g.id', 'desc')
      .select('g.id', 'g.fecha', 'g.tipo', 'g.resultado', 'g.notas', 'g.proxima_gestion', 'u.nombre as usuario');
    const contactos = (await db('contactos').where({ cliente_id: f.cliente_id }).whereNull('deleted_at').orderBy('id').limit(8)).map((c) => ({
      id: c.id, nombre: c.nombre, cargo: c.cargo, roles: json(c.roles), telefonos: json(c.telefonos), emails: json(c.emails), canal: c.canal_preferido, horario: c.horario_preferido }));
    const aplicado = await db('cobro_aplicaciones as a').join('cobros as c', 'c.id', 'a.cobro_id').where('a.factura_id', f.id).select('c.fecha_cobro', 'c.medio', 'a.importe');
    return { ...f, gestiones: gestiones.map((g) => ({ ...g, fecha: aDia(g.fecha), proxima_gestion: aDia(g.proxima_gestion) })), contactos, cobros: aplicado.map((c) => ({ ...c, fecha_cobro: aDia(c.fecha_cobro), importe: Number(c.importe) })) };
  });

  const gestionSchema = z.object({
    tipo: z.enum(['llamada', 'mail', 'whatsapp', 'visita', 'promesa', 'nota']),
    resultado: z.string().trim().max(80).optional(), notas: z.string().trim().max(2000).optional(),
    proxima_gestion: fechaSchema.nullable().optional(), fecha: fechaSchema.optional(),
  });

  /** Cobranzas registra cada reclamo. El comercial puede registrar el suyo solo en las facturas que le escalaron. */
  app.post('/api/cobranzas/facturas/:id/gestiones', { preHandler: ver }, async (req, reply) => {
    const d = gestionSchema.parse(req.body);
    const f = await cargar(req, reply); if (!f) return;
    if (!gestiona(req.ctx) && !(puede(req.ctx, 'cobranzas.escaladas') && f.estado_gestion === 'escalada')) return error(reply, 403, 'sin_permiso');
    const fecha = d.fecha ?? hoy(); if (fecha > hoy()) return error(reply, 400, 'fecha_futura');
    if (d.proxima_gestion && d.proxima_gestion < hoy()) return error(reply, 400, 'proxima_en_el_pasado');
    if (d.tipo === 'promesa' && !d.proxima_gestion) return error(reply, 400, 'promesa_sin_fecha');
    const nuevo = f.estado_gestion === 'escalada' ? 'escalada' : d.tipo === 'promesa' ? 'promesa' : 'en_gestion';
    await db.transaction(async (trx) => {
      const [id] = await trx('gestiones_cobranza').insert({ factura_id: f.id, cliente_id: f.cliente_id, usuario_id: req.ctx.id, fecha, tipo: d.tipo, resultado: d.resultado ?? null, notas: d.notas ?? null, proxima_gestion: d.proxima_gestion ?? null });
      await trx('facturas').where({ id: f.id }).update({ estado_gestion: nuevo, proxima_gestion: d.proxima_gestion ?? null, updated_at: trx.fn.now() });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'gestiones_cobranza', id, null, { factura_id: f.id, tipo: d.tipo });
    });
    return reply.code(201).send({ ok: true });
  });

  /** Sin respuesta del cliente, la factura pasa al comercial a cargo de la cuenta (o al que se elija). */
  app.post('/api/cobranzas/facturas/:id/escalar', { preHandler: [auth, requerirPermiso('cobranzas.gestionar')] }, async (req, reply) => {
    const d = z.object({ comercial_id: z.number().int().positive().optional(), notas: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    const f = await cargar(req, reply); if (!f) return;
    if (f.estado_gestion === 'escalada') return error(reply, 409, 'ya_escalada');
    const destino = d.comercial_id ?? f.comercial?.id; if (!destino) return error(reply, 409, 'sin_comercial');
    const u = await db('usuarios').where({ id: destino, activo: true }).whereNull('deleted_at').first(); if (!u) return error(reply, 404, 'comercial_no_encontrado');
    await db.transaction(async (trx) => {
      const [id] = await trx('gestiones_cobranza').insert({ factura_id: f.id, cliente_id: f.cliente_id, usuario_id: req.ctx.id, fecha: hoy(), tipo: 'escalada', resultado: `Pasada a ${u.nombre}`, notas: d.notas ?? null });
      await trx('facturas').where({ id: f.id }).update({ estado_gestion: 'escalada', escalada_a: destino, escalada_en: hoy(), proxima_gestion: null, updated_at: trx.fn.now() });
      await trx('notificaciones').insert({ usuario_id: destino, titulo: `Cobranzas te pasó una factura: ${f.cliente}`, cuerpo: `${f.cliente} no respondió a cobranzas. Factura de ${f.periodo}${f.numero ? ` (${f.numero})` : ''}, ${f.dias_vencida > 0 ? `vencida hace ${f.dias_vencida} días` : 'dentro de plazo'}. Contactá al cliente.`,
        mensaje: `Cobranzas te pasó una factura de ${f.cliente}`.slice(0, 255), destino: `#/cobranzas`, ref_tipo: 'factura', ref_id: f.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'gestiones_cobranza', id, null, { factura_id: f.id, tipo: 'escalada', a: destino });
    });
    return { ok: true };
  });

  /** El comercial devolvió el caso (o cobranzas lo toma de vuelta). */
  app.post('/api/cobranzas/facturas/:id/retomar', { preHandler: ver }, async (req, reply) => {
    const d = z.object({ notas: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    const f = await cargar(req, reply); if (!f) return;
    if (f.estado_gestion !== 'escalada') return error(reply, 409, 'no_escalada');
    if (!gestiona(req.ctx) && f.escalada_a !== req.ctx.id) return error(reply, 403, 'sin_permiso');
    await db.transaction(async (trx) => {
      await trx('gestiones_cobranza').insert({ factura_id: f.id, cliente_id: f.cliente_id, usuario_id: req.ctx.id, fecha: hoy(), tipo: 'retomada', resultado: 'Vuelve a cobranzas', notas: d.notas ?? null });
      await trx('facturas').where({ id: f.id }).update({ estado_gestion: 'en_gestion', escalada_a: null, escalada_en: null, updated_at: trx.fn.now() });
    });
    return { ok: true };
  });

  /** Corrige la fecha de emisión (p. ej. la real de ARCA) y recalcula el vencimiento con el plazo de la factura. */
  app.patch('/api/facturas/:id/emision', { preHandler: [auth, requerirPermiso('facturas.emitir')] }, async (req, reply) => {
    const d = z.object({ fecha_emision: fechaSchema }).parse(req.body);
    if (d.fecha_emision > hoy()) return error(reply, 400, 'fecha_futura');
    const v = await clientesVisibles(db, req.ctx);
    const f = await db('facturas').where({ id: Number(req.params.id) }).whereNull('deleted_at').first();
    if (!f || (v !== null && !v.includes(f.cliente_id))) return error(reply, 404, 'no_encontrado');
    if (f.estado === 'borrador' || f.estado === 'anulada') return error(reply, 409, 'no_emitida');
    const plazo = f.plazo_pago_dias ?? (f.contrato_id ? (await db('contratos').where({ id: f.contrato_id }).first())?.plazo_pago_dias : null) ?? PLAZO_DEFECTO_DIAS;
    const venc = sumarDias(d.fecha_emision, plazo);
    await db.transaction(async (trx) => {
      await trx('facturas').where({ id: f.id }).update({ fecha_emision: d.fecha_emision, fecha_emision_estimada: false, plazo_pago_dias: plazo, vencimiento: venc, updated_by: req.ctx.id, updated_at: trx.fn.now() });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'facturas', f.id, { fecha_emision: aDia(f.fecha_emision) }, { fecha_emision: d.fecha_emision });
    });
    return { ok: true, vencimiento: venc };
  });

  /** El plazo de pago se acuerda en el contrato; afecta a las facturas que se armen de acá en más. */
  app.patch('/api/contratos/:id', { preHandler: [auth, requerirPermiso('contratos.editar')] }, async (req, reply) => {
    const d = z.object({ plazo_pago_dias: z.number().int().min(0).max(365).nullable() }).parse(req.body);
    const v = await clientesVisibles(db, req.ctx);
    const c = await db('contratos').where({ id: Number(req.params.id) }).whereNull('deleted_at').first();
    if (!c || (v !== null && !v.includes(c.cliente_id))) return error(reply, 404, 'no_encontrado');
    await db.transaction(async (trx) => {
      await trx('contratos').where({ id: c.id }).update({ plazo_pago_dias: d.plazo_pago_dias, updated_by: req.ctx.id, updated_at: trx.fn.now() });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'contratos', c.id, { plazo_pago_dias: c.plazo_pago_dias }, { plazo_pago_dias: d.plazo_pago_dias });
    });
    return { ok: true };
  });

  /**
   * El negocio de un cliente, en dos carriles: rentabilidad (ingresos = facturas, egresos = costos; no depende de si se cobró)
   * y, aparte, lo que falta cobrar. `punto_equilibrio` es el primer mes en que lo facturado acumulado supera a los costos acumulados.
   */
  app.get('/api/clientes/:id/negocio', { preHandler: [auth, requerirPermiso('importes.ver'), requerirPermiso('costos.ver')] }, async (req, reply) => {
    const id = Number(req.params.id); const v = await clientesVisibles(db, req.ctx);
    if (v !== null && !v.includes(id)) return error(reply, 404, 'no_encontrado');
    const cl = await db('clientes').where({ id }).whereNull('deleted_at').first(); if (!cl) return error(reply, 404, 'no_encontrado');
    const mes = (iso) => String(iso).slice(0, 7);
    const fact = await db('facturas').where({ cliente_id: id }).whereNull('deleted_at').whereIn('estado', ['emitida', 'cobrada_parcial', 'cobrada']);
    const costos = await db('costos').where({ cliente_id: id }).whereNull('deleted_at');
    const m = new Map(); const celda = (k) => { if (!m.has(k)) m.set(k, { mes: k, ingresos: 0, egresos: 0, sin_comprobante: 0 }); return m.get(k); };
    let sinFecha = 0;
    for (const f of fact) {
      const usd = Number(f.neto_usd ?? 0); const emi = aDia(f.fecha_emision); if (!emi) sinFecha += 1;
      const c = celda(emi ? mes(emi) : f.periodo); if (f.entidad_facturante_id) c.ingresos += usd; else c.sin_comprobante += usd;
    }
    for (const k of costos) celda(mes(aDia(k.fecha))).egresos += Number(k.importe_usd ?? 0);
    const claves = [...m.keys()].sort(); const serie = []; let punto_equilibrio = null;
    if (claves.length) {
      let [y, mm] = claves[0].split('-').map(Number); const fin = hoy().slice(0, 7); let ai = 0; let ae = 0; let eq = null;
      for (;;) {
        const k = `${y}-${String(mm).padStart(2, '0')}`; const c = m.get(k) ?? { mes: k, ingresos: 0, egresos: 0, sin_comprobante: 0 };
        ai += c.ingresos; ae += c.egresos; if (eq === null && ae > 0 && ai > ae) eq = k;
        serie.push({ mes: k, ingresos: redondear(c.ingresos), egresos: redondear(c.egresos), resultado: redondear(c.ingresos - c.egresos), acum_ingresos: redondear(ai), acum_egresos: redondear(ae), acum_resultado: redondear(ai - ae), sin_comprobante: redondear(c.sin_comprobante) });
        if (k >= fin && k >= claves.at(-1)) break; mm += 1; if (mm > 12) { mm = 1; y += 1; }
      }
      punto_equilibrio = eq;
    }
    const pend = await abiertas(req.ctx, { cliente_id: id });
    const tot = serie.at(-1) ?? { acum_ingresos: 0, acum_egresos: 0, acum_resultado: 0 };
    const sinEgresos = costos.length === 0;
    return { moneda: 'USD', neto: true, serie, punto_equilibrio,
      totales: { ingresos: tot.acum_ingresos, egresos: tot.acum_egresos, resultado: tot.acum_resultado, margen: tot.acum_ingresos > 0 ? Math.round((tot.acum_resultado / tot.acum_ingresos) * 1000) / 10 : null },
      sin_costos: sinEgresos, facturas_sin_fecha: sinFecha,
      por_cobrar: { usd: redondear(pend.reduce((s, i) => s + i.saldo_usd, 0)), facturas: pend.length, rojas: pend.filter((i) => i.color === 'rojo').length, amarillas: pend.filter((i) => i.color === 'amarillo').length, detalle: pend } };
  });
}
