import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles, esArea, puede, usuariosVisibles } from '../lib/contexto.js';
import { AREA, SLA_HORAS } from '../lib/catalogo.js';
import { hoy, json } from '../lib/fechas.js';
import { siguienteNumero } from '../lib/numeradores.js';
import { aSql, cargarFeriados, deSql, horasHabiles, sumarHorasHabiles } from '../lib/sla.js';
import { estadoSla, kpiSla } from '../lib/servicio.js';
import { config } from '../config.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const ABIERTOS = ['abierto', 'asignado', 'en_curso', 'esperando_cliente'];
const TRANSICIONES = {
  asignado: ['en_curso', 'esperando_cliente'],
  en_curso: ['esperando_cliente'],
  esperando_cliente: ['en_curso'],
  resuelto: ['en_curso'], // reabrir
  abierto: [], cerrado: [],
};

const crearSchema = z.object({
  cliente_id: z.number().int().positive(),
  sede_id: z.number().int().positive().optional(),
  equipo_id: z.number().int().positive().optional(),
  asunto: z.string().trim().min(3).max(200),
  descripcion: z.string().trim().max(4000).optional(),
  tipo: z.enum(['soporte', 'insumos', 'instalacion', 'retiro', 'otro']).default('soporte'),
  prioridad: z.enum(['baja', 'normal', 'alta', 'urgente']).default('normal'),
  origen: z.enum(['telefono', 'mail', 'whatsapp', 'portal', 'qr', 'interno']).default('telefono'),
  asignado_a: z.number().int().positive().optional(),
});

const listaSchema = z.object({
  estado: z.enum(['abierto', 'asignado', 'en_curso', 'esperando_cliente', 'resuelto', 'cerrado', 'activos']).optional(),
  asignado: z.union([z.literal('yo'), z.literal('sin'), z.coerce.number().int().positive()]).optional(),
  cliente: z.coerce.number().int().positive().optional(),
  vencidos: z.coerce.boolean().optional(),
  q: z.string().trim().max(80).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});

const cierreSchema = z.object({
  trabajo_realizado: z.string().trim().min(3).max(4000),
  diagnostico: z.string().trim().max(4000).optional(),
  inicio: z.string().datetime().optional(),
  contador_negro: z.number().int().min(0).optional(),
  contador_color: z.number().int().min(0).optional(),
  repuestos: z.array(z.object({ insumo_id: z.number().int().positive(), cantidad: z.number().int().min(1).max(999) })).max(30).default([]),
  conformidad: z.object({
    nombre: z.string().trim().min(2).max(120),
    cargo: z.string().trim().max(80).optional(),
    firma: z.string().max(400000).optional(), // data URL PNG
  }).nullable().default(null),
});

const ahoraSql = () => aSql(Date.now());
const error = (reply, code, error_, extra = {}) => reply.code(code).send({ error: error_, ...extra });

/** Condición de alcance sobre tickets para `ctx`: técnicos ven los suyos (o los de su equipo); el resto, por cliente. */
async function aplicarAlcance(db, ctx, q) {
  if (ctx.areas.some((a) => a.alcance === 'todo')) return;
  const usuarios = esArea(ctx, AREA.TECNICA) ? await usuariosVisibles(db, ctx) : [];
  const clientes = (await clientesVisibles(db, ctx)) ?? [];
  q.where((w) => {
    w.whereIn('tickets.asignado_a', usuarios.length ? usuarios : [0]);
    if (esArea(ctx, AREA.TECNICA) && puede(ctx, 'tickets.asignar')) w.orWhereNull('tickets.asignado_a'); // la cabeza técnica ve lo que falta asignar
    if (!esArea(ctx, AREA.TECNICA)) w.orWhereIn('tickets.cliente_id', clientes.length ? clientes : [0]);
  });
}

async function cargarVisible(db, ctx, id) {
  const q = db('tickets').where('tickets.id', id).whereNull('tickets.deleted_at');
  await aplicarAlcance(db, ctx, q);
  return q.select('tickets.*').first();
}

const evento = (trx, ticket_id, usuario_id, datos) => trx('ticket_eventos').insert({ ticket_id, usuario_id, ...datos });

export default async function rutasTickets(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('tickets.ver')];

  app.get('/api/tickets', { preHandler: ver }, async (req) => {
    const f = listaSchema.parse(req.query);
    const base = db('tickets').join('clientes', 'clientes.id', 'tickets.cliente_id')
      .leftJoin('usuarios as tec', 'tec.id', 'tickets.asignado_a').whereNull('tickets.deleted_at');
    await aplicarAlcance(db, req.ctx, base);
    if (f.estado === 'activos') base.whereIn('tickets.estado', ABIERTOS); else if (f.estado) base.where('tickets.estado', f.estado);
    if (f.asignado === 'yo') base.where('tickets.asignado_a', req.ctx.id);
    else if (f.asignado === 'sin') base.whereNull('tickets.asignado_a');
    else if (f.asignado) base.where('tickets.asignado_a', f.asignado);
    if (f.cliente) base.where('tickets.cliente_id', f.cliente);
    if (f.vencidos) base.whereIn('tickets.estado', ABIERTOS).whereNotNull('tickets.vence_sla').where('tickets.vence_sla', '<', ahoraSql());
    if (f.q) base.where((w) => w.where('tickets.asunto', 'like', `%${f.q}%`).orWhere('tickets.numero', 'like', `%${f.q}%`).orWhere('clientes.razon_social', 'like', `%${f.q}%`));
    const [{ total }] = await base.clone().count({ total: 'tickets.id' });
    const filas = await base.clone().orderByRaw("case when tickets.estado in ('resuelto','cerrado') then 1 else 0 end")
      .orderBy('tickets.abierto_en', 'desc').limit(f.limite).offset((f.pagina - 1) * f.limite)
      .select('tickets.id', 'tickets.numero', 'tickets.asunto', 'tickets.estado', 'tickets.prioridad', 'tickets.tipo', 'tickets.abierto_en',
        'tickets.vence_sla', 'tickets.visita_en', 'tickets.cliente_id', 'tickets.asignado_a', 'tickets.sla_horas', 'tickets.sla_medible',
        'tickets.resuelto_en', 'tickets.sla_cumplido',
        'clientes.razon_social as cliente', 'clientes.nombre_comercial', 'tec.nombre as tecnico');
    const feriados = await cargarFeriados(db);
    return {
      total: Number(total), pagina: f.pagina,
      items: filas.map((t) => ({ ...t, sla: ABIERTOS.includes(t.estado) ? estadoSla(t, feriados) : null })),
    };
  });

  /** "Mi día" del técnico: visitas de hoy, lo pendiente ordenado por urgencia y sus propios números. */
  app.get('/api/mi-dia', { preHandler: [auth, requerirPermiso('tickets.atender')] }, async (req) => {
    const ahora = Date.now(); const dia = hoy();
    const ini = Date.parse(`${dia}T00:00:00-03:00`); const fin = ini + 86400000;
    const filas = await db('tickets').join('clientes', 'clientes.id', 'tickets.cliente_id').leftJoin('sedes', 'sedes.id', 'tickets.sede_id')
      .leftJoin('equipos', 'equipos.id', 'tickets.equipo_id').leftJoin('modelos_equipo', 'modelos_equipo.id', 'equipos.modelo_id')
      .whereNull('tickets.deleted_at').where('tickets.asignado_a', req.ctx.id).whereIn('tickets.estado', ABIERTOS)
      .select('tickets.id', 'tickets.numero', 'tickets.asunto', 'tickets.estado', 'tickets.prioridad', 'tickets.tipo', 'tickets.abierto_en', 'tickets.visita_en', 'tickets.sla_horas', 'tickets.sla_medible',
        'tickets.resuelto_en', 'tickets.sla_cumplido', 'clientes.razon_social', 'clientes.nombre_comercial', 'sedes.nombre as sede', 'sedes.domicilio',
        'equipos.numero_serie as serie', 'modelos_equipo.marca', 'modelos_equipo.modelo');
    const feriados = await cargarFeriados(db);
    const PESO = { urgente: 0, alta: 1, normal: 2, baja: 3 };
    const items = filas.map((t) => ({ id: t.id, numero: t.numero, asunto: t.asunto, estado: t.estado, prioridad: t.prioridad, tipo: t.tipo, cliente: t.nombre_comercial || t.razon_social,
      sede: t.sede, domicilio: t.domicilio, equipo: t.serie ? `${t.marca} ${t.modelo} · ${t.serie}` : null, visita_en: t.visita_en ? t.visita_en : null, sla: estadoSla(t, feriados, ahora) }));
    const ms = (t) => (t.visita_en ? deSql(t.visita_en) : null);
    const deHoy = items.filter((t) => ms(t) !== null && ms(t) >= ini && ms(t) < fin).sort((a, b) => ms(a) - ms(b));
    const atrasadas = items.filter((t) => ms(t) !== null && ms(t) < ini);
    const resto = items.filter((t) => !deHoy.includes(t));
    const urgencia = (a, b) => (Number(Boolean(b.sla?.vencido)) - Number(Boolean(a.sla?.vencido))) || ((a.sla?.restantes ?? 1e9) - (b.sla?.restantes ?? 1e9)) || (PESO[a.prioridad] - PESO[b.prioridad]);
    const cerradosHoy = await db('tickets').where({ asignado_a: req.ctx.id }).whereNull('deleted_at').where('resuelto_en', '>=', aSql(ini)).where('resuelto_en', '<', aSql(fin)).count({ n: '*' }).first();
    return {
      fecha: dia, visitas_hoy: deHoy, atrasadas: atrasadas.sort(urgencia), pendientes: resto.filter((t) => !atrasadas.includes(t)).sort(urgencia),
      vencidos: items.filter((t) => t.sla?.vencido).length, cerrados_hoy: Number(cerradosHoy.n), kpi: await kpiSla(db, { tecnicos: [req.ctx.id], ahora }),
    };
  });

  app.post('/api/tickets', { preHandler: [auth, requerirPermiso('tickets.crear')] }, async (req, reply) => {
    const d = crearSchema.parse(req.body);
    const visibles = await clientesVisibles(db, req.ctx);
    if (visibles !== null && !visibles.includes(d.cliente_id)) return error(reply, 404, 'no_encontrado');
    const cliente = await db('clientes').where({ id: d.cliente_id }).whereNull('deleted_at').first();
    if (!cliente) return error(reply, 404, 'no_encontrado');
    const sede = d.sede_id
      ? await db('sedes').where({ id: d.sede_id, cliente_id: d.cliente_id }).first()
      : await db('sedes').where({ cliente_id: d.cliente_id }).orderBy('es_principal', 'desc').first();
    if (d.sede_id && !sede) return error(reply, 400, 'sede_invalida');
    if (d.equipo_id) {
      const eq = await db('asignaciones_equipo').join('contratos', 'contratos.id', 'asignaciones_equipo.contrato_id')
        .where({ 'asignaciones_equipo.equipo_id': d.equipo_id, 'contratos.cliente_id': d.cliente_id }).first();
      if (!eq) return error(reply, 400, 'equipo_invalido');
    }
    if (d.asignado_a) {
      if (!puede(req.ctx, 'tickets.asignar')) return error(reply, 403, 'sin_permiso');
      if (!(await db('usuarios').where({ id: d.asignado_a, activo: true }).first())) return error(reply, 400, 'tecnico_invalido');
    }

    const ahora = Date.now();
    const sla_horas = SLA_HORAS[sede?.zona ?? 'caba'];
    const feriados = await cargarFeriados(db);
    const id = await db.transaction(async (trx) => {
      const numero = await siguienteNumero(trx, 'ticket');
      const [nuevo] = await trx('tickets').insert({
        numero, cliente_id: d.cliente_id, sede_id: sede?.id ?? null, equipo_id: d.equipo_id ?? null, asunto: d.asunto,
        descripcion: d.descripcion ?? null, tipo: d.tipo, prioridad: d.prioridad, origen: d.origen,
        estado: d.asignado_a ? 'asignado' : 'abierto', asignado_a: d.asignado_a ?? null, creado_por: req.ctx.id, created_by: req.ctx.id,
        abierto_en: aSql(ahora), sla_horas, vence_sla: aSql(sumarHorasHabiles(ahora, sla_horas, feriados)),
      });
      await evento(trx, nuevo, req.ctx.id, { tipo: 'creado', estado_nuevo: d.asignado_a ? 'asignado' : 'abierto' });
      if (d.asignado_a) await evento(trx, nuevo, req.ctx.id, { tipo: 'asignado', asignado_a: d.asignado_a });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'tickets', nuevo, null, { numero, cliente_id: d.cliente_id });
      return nuevo;
    });
    return reply.code(201).send({ id });
  });

  app.get('/api/tickets/:id', { preHandler: ver }, async (req, reply) => {
    const t = await cargarVisible(db, req.ctx, Number(req.params.id));
    if (!t) return error(reply, 404, 'no_encontrado');
    const [cliente, sede, equipo, tecnico, eventos, partes, remitos] = await Promise.all([
      db('clientes').where({ id: t.cliente_id }).select('id', 'razon_social', 'nombre_comercial').first(),
      t.sede_id ? db('sedes').where({ id: t.sede_id }).select('nombre', 'domicilio', 'localidad', 'zona', 'indicaciones').first() : null,
      t.equipo_id ? db('equipos').join('modelos_equipo', 'modelos_equipo.id', 'equipos.modelo_id').where('equipos.id', t.equipo_id)
        .select('equipos.id', 'equipos.numero_serie', 'modelos_equipo.marca', 'modelos_equipo.modelo', 'modelos_equipo.tipo').first() : null,
      t.asignado_a ? db('usuarios').where({ id: t.asignado_a }).select('id', 'nombre').first() : null,
      db('ticket_eventos').leftJoin('usuarios', 'usuarios.id', 'ticket_eventos.usuario_id').where('ticket_eventos.ticket_id', t.id)
        .orderBy('ticket_eventos.id').select('ticket_eventos.*', 'usuarios.nombre as usuario'),
      db('partes_tecnicos').join('usuarios', 'usuarios.id', 'partes_tecnicos.tecnico_id').where('ticket_id', t.id)
        .select('partes_tecnicos.*', 'usuarios.nombre as tecnico'),
      db('remitos').where({ ticket_id: t.id }).select('id', 'numero', 'estado', 'fecha'),
    ]);
    for (const r of remitos) {
      r.conformidad = await db('conformidades').where({ documento_tipo: 'remito', documento_id: r.id }).select('firmante_nombre', 'firmante_cargo', 'firmado_en', 'aceptado').first() ?? null;
    }
    return {
      ...t, cliente, sede, equipo, tecnico, eventos,
      partes: partes.map((p) => ({ ...p, repuestos: json(p.repuestos, []) })), remitos,
      sla: estadoSla(t, await cargarFeriados(db)),
      puede_atender: puede(req.ctx, 'tickets.atender') && (t.asignado_a === req.ctx.id || puede(req.ctx, 'tickets.asignar')),
    };
  });

  app.post('/api/tickets/:id/asignar', { preHandler: [auth, requerirPermiso('tickets.asignar')] }, async (req, reply) => {
    const d = z.object({ tecnico_id: z.number().int().positive(), visita_en: z.string().datetime().optional() }).parse(req.body);
    const t = await cargarVisible(db, req.ctx, Number(req.params.id));
    if (!t) return error(reply, 404, 'no_encontrado');
    if (!ABIERTOS.includes(t.estado)) return error(reply, 409, 'ticket_cerrado');
    const tec = await db('usuarios').join('usuario_area', 'usuario_area.usuario_id', 'usuarios.id').join('areas', 'areas.id', 'usuario_area.area_id')
      .where({ 'usuarios.id': d.tecnico_id, 'usuarios.activo': true, 'areas.nombre': AREA.TECNICA }).first();
    if (!tec) return error(reply, 400, 'tecnico_invalido');
    const permitidos = await usuariosVisibles(db, req.ctx);
    if (permitidos !== null && !permitidos.includes(d.tecnico_id)) return error(reply, 403, 'sin_permiso');
    await db.transaction(async (trx) => {
      await trx('tickets').where({ id: t.id }).update({
        asignado_a: d.tecnico_id, estado: t.estado === 'abierto' ? 'asignado' : t.estado, updated_by: req.ctx.id, updated_at: ahoraSql(),
        visita_en: d.visita_en ? aSql(Date.parse(d.visita_en)) : t.visita_en,
      });
      await evento(trx, t.id, req.ctx.id, { tipo: 'asignado', asignado_a: d.tecnico_id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'tickets', t.id, { asignado_a: t.asignado_a }, { asignado_a: d.tecnico_id });
    });
    return { ok: true };
  });

  app.post('/api/tickets/:id/estado', { preHandler: [auth, requerirPermiso('tickets.atender')] }, async (req, reply) => {
    const d = z.object({ estado: z.enum(['en_curso', 'esperando_cliente']), comentario: z.string().trim().max(1000).optional() }).parse(req.body);
    const t = await cargarVisible(db, req.ctx, Number(req.params.id));
    if (!t) return error(reply, 404, 'no_encontrado');
    if (t.asignado_a !== req.ctx.id && !puede(req.ctx, 'tickets.asignar')) return error(reply, 403, 'sin_permiso');
    if (!(TRANSICIONES[t.estado] ?? []).includes(d.estado)) return error(reply, 409, 'transicion_invalida');
    const ahora = Date.now();
    const cambios = { estado: d.estado, updated_by: req.ctx.id, updated_at: aSql(ahora) };
    if (t.estado === 'resuelto') Object.assign(cambios, { resuelto_en: null, horas_resolucion: null, sla_cumplido: null, cerrado_en: null });
    if (d.estado === 'en_curso' && !t.primera_respuesta_en) cambios.primera_respuesta_en = aSql(ahora);
    await db.transaction(async (trx) => {
      await trx('tickets').where({ id: t.id }).update(cambios);
      await evento(trx, t.id, req.ctx.id, { tipo: 'estado', estado_anterior: t.estado, estado_nuevo: d.estado, comentario: d.comentario ?? null });
      if (cambios.primera_respuesta_en) await evento(trx, t.id, req.ctx.id, { tipo: 'primera_respuesta' });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'tickets', t.id, { estado: t.estado }, { estado: d.estado });
    });
    return { ok: true };
  });

  app.post('/api/tickets/:id/comentarios', { preHandler: [auth, requerirPermiso('tickets.ver')] }, async (req, reply) => {
    const d = z.object({ comentario: z.string().trim().min(1).max(2000) }).parse(req.body);
    const t = await cargarVisible(db, req.ctx, Number(req.params.id));
    if (!t) return error(reply, 404, 'no_encontrado');
    // Primera respuesta: el primer comentario de alguien de Servicio (no del solicitante) mientras el ticket sigue abierto.
    const primera = !t.primera_respuesta_en && ABIERTOS.includes(t.estado) && (puede(req.ctx, 'tickets.atender') || puede(req.ctx, 'tickets.asignar'));
    await db.transaction(async (trx) => {
      await evento(trx, t.id, req.ctx.id, { tipo: 'comentario', comentario: d.comentario });
      if (primera) {
        await trx('tickets').where({ id: t.id }).update({ primera_respuesta_en: ahoraSql() });
        await evento(trx, t.id, req.ctx.id, { tipo: 'primera_respuesta' });
      }
    });
    return reply.code(201).send({ ok: true });
  });

  /**
   * Cierre del técnico en una sola operación: parte, contadores, repuestos (remito de servicio + stock) y conformidad.
   * Todo o nada: si algo falla (contador menor al anterior, stock insuficiente) no se guarda nada.
   */
  app.post('/api/tickets/:id/cierre', { preHandler: [auth, requerirPermiso('tickets.atender', 'partes.editar')] }, async (req, reply) => {
    const d = cierreSchema.parse(req.body);
    const t = await cargarVisible(db, req.ctx, Number(req.params.id));
    if (!t) return error(reply, 404, 'no_encontrado');
    if (t.asignado_a !== req.ctx.id && !puede(req.ctx, 'tickets.asignar')) return error(reply, 403, 'sin_permiso');
    if (!ABIERTOS.includes(t.estado)) return error(reply, 409, 'ticket_cerrado');

    let firmaBuf = null;
    if (d.conformidad?.firma) {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(d.conformidad.firma);
      firmaBuf = m ? Buffer.from(m[1], 'base64') : null;
      if (!firmaBuf || firmaBuf.length > 250000 || firmaBuf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return error(reply, 400, 'firma_invalida');
    }

    const equipo = t.equipo_id ? await db('equipos').join('modelos_equipo', 'modelos_equipo.id', 'equipos.modelo_id').where('equipos.id', t.equipo_id).select('equipos.id', 'modelos_equipo.tipo').first() : null;
    if (equipo && (d.contador_negro != null || d.contador_color != null)) {
      const ultima = await db('lecturas_contador').where({ equipo_id: equipo.id }).orderBy('fecha', 'desc').orderBy('id', 'desc').first();
      if (d.contador_negro == null) return error(reply, 400, 'contador_negro_requerido');
      if (equipo.tipo === 'monocromo' && d.contador_color) return error(reply, 400, 'equipo_monocromo');
      if (equipo.tipo === 'color' && d.contador_color == null) return error(reply, 400, 'contador_color_requerido');
      if (ultima && (d.contador_negro < ultima.contador_negro || (d.contador_color ?? 0) < ultima.contador_color)) {
        return error(reply, 409, 'contador_menor_al_anterior', { anterior: { negro: ultima.contador_negro, color: ultima.contador_color } });
      }
    }

    const ahora = Date.now();
    const feriados = await cargarFeriados(db);
    let resultado;
    try {
      resultado = await db.transaction(async (trx) => {
        const [parte] = await trx('partes_tecnicos').insert({
          ticket_id: t.id, tecnico_id: req.ctx.id, inicio: d.inicio ? aSql(Date.parse(d.inicio)) : ahoraSql(), fin: aSql(ahora),
          diagnostico: d.diagnostico ?? null, trabajo_realizado: d.trabajo_realizado,
          contador_negro: d.contador_negro ?? null, contador_color: d.contador_color ?? null,
          repuestos: JSON.stringify(d.repuestos), created_by: req.ctx.id,
        });

        if (equipo && d.contador_negro != null) {
          await trx('lecturas_contador').insert({ equipo_id: equipo.id, fecha: hoy(), contador_negro: d.contador_negro, contador_color: d.contador_color ?? 0, origen: 'tecnico', usuario_id: req.ctx.id });
        }

        const [remito] = await trx('remitos').insert({
          numero: await siguienteNumero(trx, 'remito'), cliente_id: t.cliente_id, sede_id: t.sede_id, tipo: 'servicio', fecha: hoy(),
          estado: d.conformidad ? 'firmado' : 'emitido', ticket_id: t.id, parte_id: parte, observaciones: d.trabajo_realizado, created_by: req.ctx.id,
        });
        if (!d.repuestos.length) {
          await trx('remito_items').insert({ remito_id: remito, equipo_id: equipo?.id ?? null, descripcion: `Servicio técnico: ${d.trabajo_realizado}`.slice(0, 200), cantidad: 1 });
        }
        for (const rep of d.repuestos) {
          const ins = await trx('insumos').where({ id: rep.insumo_id }).whereNull('deleted_at').first();
          if (!ins) throw Object.assign(new Error('insumo'), { codigo: 'insumo_invalido' });
          const stock = await trx('movimientos_insumo').where({ insumo_id: ins.id }).sum({ s: trx.raw("case tipo when 'salida' then -cantidad else cantidad end") }).first();
          if (Number(stock.s ?? 0) < rep.cantidad) throw Object.assign(new Error('stock'), { codigo: 'sin_stock', insumo: ins.codigo });
          await trx('remito_items').insert({ remito_id: remito, insumo_id: ins.id, equipo_id: equipo?.id ?? null, descripcion: ins.descripcion, cantidad: rep.cantidad });
          await trx('movimientos_insumo').insert({ insumo_id: ins.id, tipo: 'salida', cantidad: rep.cantidad, remito_id: remito, parte_id: parte, usuario_id: req.ctx.id, motivo: `Ticket ${t.numero}` });
        }

        if (d.conformidad) {
          let archivo = null;
          if (firmaBuf) {
            const nombre = `${crypto.randomUUID()}.png`;
            const dir = path.join(config.archivosDir, 'firmas');
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path.join(dir, nombre), firmaBuf);
            [archivo] = await trx('archivos').insert({ entidad_tipo: 'remito', entidad_id: remito, ruta: `firmas/${nombre}`, nombre_original: 'firma.png', mime: 'image/png', bytes: firmaBuf.length, subido_por: req.ctx.id });
          }
          await trx('conformidades').insert({
            documento_tipo: 'remito', documento_id: remito, firmante_nombre: d.conformidad.nombre, firmante_cargo: d.conformidad.cargo ?? null,
            firma_archivo_id: archivo, aceptado: true, dispositivo: String(req.headers['user-agent'] || '').slice(0, 255), ip: req.ip,
          });
        }

        // SLA: horas hábiles entre que se abrió y que se resolvió.
        const horas = Math.round(horasHabiles(deSql(t.abierto_en), ahora, feriados) * 100) / 100;
        const estado = d.conformidad ? 'cerrado' : 'resuelto';
        await trx('tickets').where({ id: t.id }).update({
          estado, resuelto_en: aSql(ahora), cerrado_en: d.conformidad ? aSql(ahora) : null,
          horas_resolucion: t.sla_medible ? horas : null, sla_cumplido: t.sla_medible && t.sla_horas ? horas <= t.sla_horas : null,
          primera_respuesta_en: t.primera_respuesta_en ?? aSql(ahora), updated_by: req.ctx.id, updated_at: aSql(ahora),
        });
        await evento(trx, t.id, req.ctx.id, { tipo: 'estado', estado_anterior: t.estado, estado_nuevo: estado, comentario: d.conformidad ? `Cerrado con conformidad de ${d.conformidad.nombre}` : 'Resuelto, falta conformidad del cliente' });
        await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'tickets', t.id, { estado: t.estado }, { estado, parte, remito });
        const num = await trx('remitos').where({ id: remito }).first();
        return { estado, parte_id: parte, remito_id: remito, remito: num.numero, horas_resolucion: t.sla_medible ? horas : null, sla_cumplido: t.sla_medible && t.sla_horas ? horas <= t.sla_horas : null };
      });
    } catch (e) {
      if (e.codigo === 'insumo_invalido') return error(reply, 400, 'insumo_invalido');
      if (e.codigo === 'sin_stock') return error(reply, 409, 'sin_stock', { insumo: e.insumo });
      throw e;
    }
    return reply.code(201).send(resultado);
  });

  // Listas para los formularios.
  app.get('/api/tickets-ayuda/tecnicos', { preHandler: [auth, requerirPermiso('tickets.asignar')] }, async (req) => {
    const permitidos = await usuariosVisibles(db, req.ctx);
    const q = db('usuarios').join('usuario_area', 'usuario_area.usuario_id', 'usuarios.id').join('areas', 'areas.id', 'usuario_area.area_id')
      .where({ 'areas.nombre': AREA.TECNICA, 'usuarios.activo': true }).whereNull('usuarios.deleted_at').select('usuarios.id', 'usuarios.nombre').orderBy('usuarios.nombre');
    if (permitidos !== null) q.whereIn('usuarios.id', permitidos);
    return q;
  });

  app.get('/api/tickets-ayuda/cliente/:id', { preHandler: [auth, requerirPermiso('tickets.ver')] }, async (req, reply) => {
    const id = Number(req.params.id);
    const visibles = await clientesVisibles(db, req.ctx);
    if (visibles !== null && !visibles.includes(id)) return error(reply, 404, 'no_encontrado');
    const sedes = await db('sedes').where({ cliente_id: id }).select('id', 'nombre', 'zona', 'es_principal');
    const equipos = await db('asignaciones_equipo').join('contratos', 'contratos.id', 'asignaciones_equipo.contrato_id')
      .join('equipos', 'equipos.id', 'asignaciones_equipo.equipo_id').join('modelos_equipo', 'modelos_equipo.id', 'equipos.modelo_id')
      .where('contratos.cliente_id', id).whereNull('asignaciones_equipo.hasta')
      .select('equipos.id', 'equipos.numero_serie', 'modelos_equipo.marca', 'modelos_equipo.modelo', 'modelos_equipo.tipo');
    return { sedes, equipos };
  });

  app.get('/api/tickets-ayuda/insumos', { preHandler: [auth, requerirPermiso('insumos.ver')] }, async () => {
    const insumos = await db('insumos').whereNull('deleted_at').select('id', 'codigo', 'descripcion').orderBy('descripcion');
    const stock = await db('movimientos_insumo').groupBy('insumo_id').select('insumo_id').sum({ s: db.raw("case tipo when 'salida' then -cantidad else cantidad end") });
    const m = new Map(stock.map((x) => [x.insumo_id, Number(x.s)]));
    return insumos.map((i) => ({ ...i, stock: m.get(i.id) ?? 0 }));
  });
}
