import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { ETAPAS_LEAD, ROLES_CONTACTO } from '../lib/catalogo.js';
import { aDia, hoy } from '../lib/fechas.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const ETAPAS = ETAPAS_LEAD.map(([k]) => k);
const CERRADAS = ['ganado', 'perdido'];
const txt = (n) => z.string().trim().max(n).optional().nullable();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const leadSchema = z.object({
  empresa: z.string().trim().min(2).max(160),
  contacto_nombre: txt(120), contacto_apellido: txt(120), cargo: txt(80),
  email: z.string().trim().toLowerCase().email().max(160).optional().nullable().or(z.literal('').transform(() => null)),
  telefono: txt(40),
  rubro_id: z.number().int().positive().optional().nullable(), subrubro_id: z.number().int().positive().optional().nullable(),
  origen: txt(60), responsable_id: z.number().int().positive().optional().nullable(),
  valor_estimado_usd: z.number().min(0).max(100000000).optional().nullable(), equipos_estimados: z.number().int().min(0).max(100000).optional().nullable(),
  proxima_accion: txt(200), proxima_accion_fecha: fecha.optional().nullable(), notas: z.string().trim().max(4000).optional().nullable(),
});

export default async function rutasLeads(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('leads.ver')];
  const editar = [auth, requerirPermiso('leads.editar')];
  const todos = (ctx) => ctx.permisos.has('leads.todos');
  const error = (reply, code, e, extra = {}) => reply.code(code).send({ error: e, ...extra });

  /** Un comercial ve solo sus leads; quien tiene `leads.todos` ve los de todo el equipo. */
  const alcance = (ctx) => (q) => { if (!todos(ctx)) q.where('leads.responsable_id', ctx.id); };
  const cargar = (ctx, id) => db('leads').where({ id }).whereNull('deleted_at').modify(alcance(ctx)).first();

  async function revisarRubros(rid, sid) {
    if (sid && !rid) return 'subrubro_sin_rubro';
    if (rid && !(await db('rubros').where({ id: rid, activo: true }).whereNull('parent_id').first())) return 'rubro_invalido';
    if (sid && !(await db('rubros').where({ id: sid, parent_id: rid, activo: true }).first())) return 'subrubro_invalido';
    return null;
  }
  async function responsableOk(ctx, id) {
    if (!id || id === ctx.id) return true;
    if (!todos(ctx)) return false;
    return !!(await db('usuarios').where({ id, activo: true }).whereNull('deleted_at').first());
  }
  const salida = (l, hoyISO) => ({
    ...l, valor_estimado_usd: l.valor_estimado_usd == null ? null : Number(l.valor_estimado_usd), etapa_desde: aDia(l.etapa_desde), proxima_accion_fecha: aDia(l.proxima_accion_fecha),
    dias_en_etapa: l.etapa_desde ? Math.max(0, Math.round((Date.parse(`${hoyISO}T12:00:00Z`) - Date.parse(`${aDia(l.etapa_desde)}T12:00:00Z`)) / 86400000)) : 0,
    accion_vencida: !!l.proxima_accion_fecha && aDia(l.proxima_accion_fecha) < hoyISO && !CERRADAS.includes(l.etapa),
  });

  /** Personas del área Comercial: para elegir responsable de una cuenta o de un lead. */
  app.get('/api/equipo-comercial', { preHandler: auth }, async (req, reply) => {
    if (!['leads.ver', 'clientes.editar', 'cartera.asignar'].some((p) => req.ctx.permisos.has(p))) return reply.code(403).send({ error: 'sin_permiso' });
    const items = await db('usuarios').join('usuario_area', 'usuario_area.usuario_id', 'usuarios.id').join('areas', 'areas.id', 'usuario_area.area_id')
      .where({ 'areas.nombre': 'Comercial', 'usuarios.activo': true }).whereNull('usuarios.deleted_at').distinct('usuarios.id', 'usuarios.nombre').orderBy('usuarios.nombre');
    return { items, puede_elegir: req.ctx.permisos.has('cartera.asignar') || req.ctx.permisos.has('leads.todos') };
  });

  app.get('/api/leads', { preHandler: ver }, async (req) => {
    const f = z.object({ q: z.string().trim().max(80).optional(), responsable: z.coerce.number().int().positive().optional(), cerrados: z.enum(['0', '1']).default('0') }).parse(req.query);
    const h = hoy(); const hace30 = new Date(Date.parse(`${h}T12:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
    const filas = await db('leads').leftJoin('usuarios as u', 'u.id', 'leads.responsable_id').leftJoin('rubros as r', 'r.id', 'leads.rubro_id').whereNull('leads.deleted_at').modify(alcance(req.ctx))
      .modify((q) => {
        if (f.q) q.where((w) => w.where('leads.empresa', 'like', `%${f.q}%`).orWhere('leads.contacto_nombre', 'like', `%${f.q}%`).orWhere('leads.contacto_apellido', 'like', `%${f.q}%`));
        if (f.responsable && todos(req.ctx)) q.where('leads.responsable_id', f.responsable);
        // Los cerrados solo se muestran los últimos 30 días, para que el tablero no se llene.
        q.where((w) => w.whereNotIn('leads.etapa', CERRADAS).orWhere('leads.etapa_desde', '>=', hace30));
      })
      .select('leads.*', 'u.nombre as responsable', 'r.nombre as rubro').orderBy(['leads.orden', 'leads.id']);
    return { etapas: ETAPAS_LEAD.map(([clave, titulo]) => ({ clave, titulo })), items: filas.map((l) => salida(l, h)), ve_todos: todos(req.ctx) };
  });

  app.get('/api/leads/:id', { preHandler: ver }, async (req, reply) => {
    const l = await cargar(req.ctx, Number(req.params.id)); if (!l) return error(reply, 404, 'no_encontrado');
    const actividades = await db('lead_actividades as a').leftJoin('usuarios as u', 'u.id', 'a.usuario_id').where('a.lead_id', l.id).orderBy([{ column: 'a.fecha', order: 'desc' }, { column: 'a.id', order: 'desc' }]).select('a.id', 'a.tipo', 'a.texto', 'a.fecha', 'u.nombre as usuario');
    const rn = await db('rubros').whereIn('id', [l.rubro_id, l.subrubro_id].filter(Boolean)).select('id', 'nombre');
    const resp = l.responsable_id ? await db('usuarios').where({ id: l.responsable_id }).first() : null;
    return { lead: { ...salida(l, hoy()), rubro: rn.find((r) => r.id === l.rubro_id)?.nombre ?? null, subrubro: rn.find((r) => r.id === l.subrubro_id)?.nombre ?? null, responsable: resp?.nombre ?? null }, actividades };
  });

  app.post('/api/leads', { preHandler: editar }, async (req, reply) => {
    const d = leadSchema.parse(req.body);
    const mal = await revisarRubros(d.rubro_id, d.subrubro_id); if (mal) return error(reply, 400, mal);
    const resp = d.responsable_id ?? req.ctx.id; if (!(await responsableOk(req.ctx, resp))) return error(reply, 400, 'responsable_invalido');
    const id = await db.transaction(async (trx) => {
      const [{ m }] = await trx('leads').where({ etapa: 'nuevo' }).max({ m: 'orden' });
      const [nid] = await trx('leads').insert({ ...d, responsable_id: resp, etapa: 'nuevo', etapa_desde: hoy(), orden: (m ?? 0) + 1, created_by: req.ctx.id, updated_by: req.ctx.id });
      await trx('lead_actividades').insert({ lead_id: nid, usuario_id: req.ctx.id, tipo: 'etapa', texto: 'Lead creado' });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'leads', nid, null, d);
      return nid;
    });
    return reply.code(201).send({ id });
  });

  app.patch('/api/leads/:id', { preHandler: editar }, async (req, reply) => {
    const antes = await cargar(req.ctx, Number(req.params.id)); if (!antes) return error(reply, 404, 'no_encontrado');
    if (antes.cliente_id) return error(reply, 409, 'ya_convertido');
    const d = leadSchema.partial().parse(req.body); if (!Object.keys(d).length) return error(reply, 400, 'sin_cambios');
    const rid = 'rubro_id' in d ? d.rubro_id : antes.rubro_id; const sid = 'rubro_id' in d && !('subrubro_id' in d) ? null : ('subrubro_id' in d ? d.subrubro_id : antes.subrubro_id);
    if ('rubro_id' in d || 'subrubro_id' in d) { const mal = await revisarRubros(rid, sid); if (mal) return error(reply, 400, mal); d.rubro_id = rid ?? null; d.subrubro_id = sid ?? null; }
    if (d.responsable_id && !(await responsableOk(req.ctx, d.responsable_id))) return error(reply, 400, 'responsable_invalido');
    await db.transaction(async (trx) => {
      await trx('leads').where({ id: antes.id }).update({ ...d, updated_at: trx.fn.now(), updated_by: req.ctx.id });
      if (d.responsable_id && d.responsable_id !== antes.responsable_id) {
        const u = await trx('usuarios').where({ id: d.responsable_id }).first();
        await trx('lead_actividades').insert({ lead_id: antes.id, usuario_id: req.ctx.id, tipo: 'nota', texto: `Pasó a ${u?.nombre ?? 'otra persona'}` });
      }
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'leads', antes.id, antes, d);
    });
    return { ok: true };
  });

  /** Mover de etapa. Perdido pide motivo. Ganado se logra convirtiendo en cliente, no a mano. */
  app.post('/api/leads/:id/mover', { preHandler: editar }, async (req, reply) => {
    const d = z.object({ etapa: z.enum(ETAPAS), motivo: z.string().trim().max(255).optional(), orden: z.number().int().min(0).optional() }).parse(req.body);
    const l = await cargar(req.ctx, Number(req.params.id)); if (!l) return error(reply, 404, 'no_encontrado');
    if (l.cliente_id) return error(reply, 409, 'ya_convertido');
    if (d.etapa === 'ganado') return error(reply, 409, 'ganado_se_convierte');
    if (d.etapa === 'perdido' && !d.motivo) return error(reply, 400, 'motivo_requerido');
    const cambia = d.etapa !== l.etapa;
    await db.transaction(async (trx) => {
      const [{ m }] = await trx('leads').where({ etapa: d.etapa }).max({ m: 'orden' });
      await trx('leads').where({ id: l.id }).update({
        etapa: d.etapa, orden: d.orden ?? (m ?? 0) + 1, ...(cambia ? { etapa_desde: hoy() } : {}),
        motivo_perdida: d.etapa === 'perdido' ? d.motivo : null, cerrado_en: d.etapa === 'perdido' ? trx.fn.now() : null, updated_at: trx.fn.now(), updated_by: req.ctx.id,
      });
      if (cambia) {
        const nombre = (k) => ETAPAS_LEAD.find(([c]) => c === k)[1];
        await trx('lead_actividades').insert({ lead_id: l.id, usuario_id: req.ctx.id, tipo: 'etapa', texto: `${nombre(l.etapa)} → ${nombre(d.etapa)}${d.motivo ? `: ${d.motivo}` : ''}` });
        await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'leads', l.id, { etapa: l.etapa }, { etapa: d.etapa });
      }
    });
    return { ok: true };
  });

  app.post('/api/leads/:id/actividades', { preHandler: editar }, async (req, reply) => {
    const d = z.object({ tipo: z.enum(['llamada', 'mail', 'whatsapp', 'visita', 'reunion', 'nota']), texto: z.string().trim().min(1).max(2000),
      proxima_accion: txt(200), proxima_accion_fecha: fecha.optional().nullable() }).parse(req.body);
    const l = await cargar(req.ctx, Number(req.params.id)); if (!l) return error(reply, 404, 'no_encontrado');
    await db.transaction(async (trx) => {
      await trx('lead_actividades').insert({ lead_id: l.id, usuario_id: req.ctx.id, tipo: d.tipo, texto: d.texto });
      // Cada gestión puede dejar fijada la próxima acción; si no se indica, la anterior se mantiene.
      const cambios = { updated_at: trx.fn.now() };
      if (d.proxima_accion !== undefined || d.proxima_accion_fecha !== undefined) { cambios.proxima_accion = d.proxima_accion ?? null; cambios.proxima_accion_fecha = d.proxima_accion_fecha ?? null; }
      await trx('leads').where({ id: l.id }).update(cambios);
    });
    return reply.code(201).send({ ok: true });
  });

  /** Ganado: crea el cliente (prospecto hasta que tenga un contrato vigente), su sede, el contacto y deja al comercial como responsable. */
  app.post('/api/leads/:id/convertir', { preHandler: [...editar, requerirPermiso('clientes.editar')] }, async (req, reply) => {
    const d = z.object({ razon_social: z.string().trim().min(2).max(160).optional(), cuit: z.string().trim().max(13).optional().nullable(),
      roles: z.array(z.enum(ROLES_CONTACTO)).max(9).default(['decisor']) }).parse(req.body ?? {});
    const l = await cargar(req.ctx, Number(req.params.id)); if (!l) return error(reply, 404, 'no_encontrado');
    if (l.cliente_id) return error(reply, 409, 'ya_convertido');
    if (l.etapa === 'perdido') return error(reply, 409, 'lead_perdido');
    const { normalizarCuit } = await import('../lib/cuit.js');
    let cuit = null; if (d.cuit) { cuit = normalizarCuit(d.cuit); if (!cuit) return error(reply, 400, 'cuit_invalido'); if (await db('clientes').where({ cuit }).whereNull('deleted_at').first()) return error(reply, 409, 'cuit_duplicado'); }
    const rub = l.rubro_id ? await db('rubros').where({ id: l.rubro_id }).first() : null;
    const cid = await db.transaction(async (trx) => {
      const [id] = await trx('clientes').insert({ razon_social: d.razon_social ?? l.empresa, nombre_comercial: l.empresa, cuit, rubro: rub?.nombre ?? null, rubro_id: l.rubro_id, subrubro_id: l.subrubro_id,
        estado: 'prospecto', origen: l.origen ?? 'Hunting', fecha_alta: hoy(), notas: l.notas, lead_id: l.id, created_by: req.ctx.id, updated_by: req.ctx.id });
      await trx('sedes').insert({ cliente_id: id, nombre: 'Sede principal', es_principal: true, created_by: req.ctx.id, updated_by: req.ctx.id });
      if (l.contacto_nombre && (l.email || l.telefono)) {
        await trx('contactos').insert({ cliente_id: id, nombre: l.contacto_nombre, apellido: l.contacto_apellido, cargo: l.cargo, roles: JSON.stringify(d.roles),
          telefonos: JSON.stringify(l.telefono ? [{ tipo: 'celular', numero: l.telefono }] : []), emails: JSON.stringify(l.email ? [{ tipo: 'laboral', direccion: l.email }] : []),
          origen: 'hunting', estado: 'activo', created_by: req.ctx.id, updated_by: req.ctx.id });
      }
      if (l.responsable_id) await trx('cartera_asignaciones').insert({ cliente_id: id, usuario_id: l.responsable_id, desde: hoy(), asignado_por: req.ctx.id, motivo: 'Ganado en Hunting' });
      const [{ m }] = await trx('leads').where({ etapa: 'ganado' }).max({ m: 'orden' });
      await trx('leads').where({ id: l.id }).update({ etapa: 'ganado', etapa_desde: hoy(), cliente_id: id, cerrado_en: trx.fn.now(), orden: (m ?? 0) + 1, updated_at: trx.fn.now(), updated_by: req.ctx.id });
      await trx('lead_actividades').insert({ lead_id: l.id, usuario_id: req.ctx.id, tipo: 'etapa', texto: 'Ganado: se creó el cliente' });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'clientes', id, null, { desde_lead: l.id });
      return id;
    });
    return reply.code(201).send({ cliente_id: cid });
  });
}
