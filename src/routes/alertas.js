import { z } from 'zod';
import { REGLAS, asegurarReglas, ejecutarAlertas, normalizarRegla, reglaDe } from '../lib/alertas.js';
import { auditar } from '../lib/audit.js';
import { canales, estadoCanales } from '../lib/canales.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const CANALES = ['sistema', 'mail', 'whatsapp'];

export default async function rutasAlertas(app, { db }) {
  const auth = requerirSesion(db);
  const admin = [auth, requerirPermiso('alertas.configurar')];

  app.get('/api/alertas/reglas', { preHandler: admin }, async () => {
    await asegurarReglas(db);
    const filas = (await db('reglas_alerta').orderBy('id')).map(normalizarRegla);
    const roles = (await db('roles').select('nombre', 'descripcion')).map((r) => ({ nombre: r.nombre, descripcion: r.descripcion }));
    const usuarios = (await db('usuarios').whereNull('deleted_at').where({ activo: true }).select('id', 'nombre', 'email', 'telefono').orderBy('nombre'));
    return {
      canales: estadoCanales(), roles, usuarios,
      reglas: REGLAS.map((d) => { const f = filas.find((x) => x.clave === d.clave); return f ? { clave: d.clave, nombre: d.nombre, descripcion: d.descripcion, unidad: d.unidad, variables: d.variables, ...f, de_fabrica: { umbral: d.umbral, canales: d.canales, destinatarios: d.destinatarios, frecuencia_horas: d.frecuencia_horas, plantilla_asunto: d.asunto, plantilla_cuerpo: d.cuerpo } } : null; }).filter(Boolean),
    };
  });

  app.put('/api/alertas/reglas/:clave', { preHandler: admin }, async (req, reply) => {
    const def = reglaDe(req.params.clave); if (!def) return reply.code(404).send({ error: 'no_encontrado' });
    const d = z.object({
      activa: z.boolean(), umbral: z.number().min(0).max(100000).nullable().optional(), canales: z.array(z.enum(CANALES)).max(3),
      destinatarios: z.object({ roles: z.array(z.string()).max(20), responsables: z.array(z.enum(['tecnico', 'comercial'])).max(2), usuarios: z.array(z.number().int().positive()).max(50) }),
      frecuencia_horas: z.number().int().min(1).max(24 * 60), plantilla_asunto: z.string().trim().min(1).max(200), plantilla_cuerpo: z.string().trim().min(1).max(2000),
    }).parse(req.body);
    // Solo se aceptan variables que la regla conoce: un {typo} quedaría vacío en el aviso.
    const usadas = [...`${d.plantilla_asunto} ${d.plantilla_cuerpo}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const desconocidas = usadas.filter((v) => !def.variables.includes(v));
    if (desconocidas.length) return reply.code(422).send({ error: 'variables_desconocidas', variables: [...new Set(desconocidas)] });
    if (def.umbral != null && d.umbral == null) return reply.code(422).send({ error: 'falta_umbral' });
    await asegurarReglas(db);
    const antes = await db('reglas_alerta').where({ tipo: def.clave }).first();
    await db.transaction(async (trx) => {
      await trx('reglas_alerta').where({ tipo: def.clave }).update({
        activa: d.activa, umbral: def.umbral == null ? null : d.umbral, canales: JSON.stringify(d.canales), destinatarios: JSON.stringify(d.destinatarios),
        frecuencia_horas: d.frecuencia_horas, plantilla_asunto: d.plantilla_asunto, plantilla_cuerpo: d.plantilla_cuerpo, updated_by: req.ctx.id, updated_at: trx.fn.now(),
      });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'reglas_alerta', antes.id, { activa: Boolean(antes.activa), umbral: antes.umbral, canales: antes.canales }, { activa: d.activa, umbral: d.umbral, canales: d.canales, destinatarios: d.destinatarios });
    });
    return { ok: true };
  });

  /** Corre las reglas ahora mismo, sin esperar al ciclo automático. */
  app.post('/api/alertas/ejecutar', { preHandler: admin }, async () => { await asegurarReglas(db); return ejecutarAlertas(db); });

  /** Manda un mensaje de prueba por un canal a quien lo pide, para validar la configuración (SMTP, WhatsApp). */
  app.post('/api/alertas/prueba', { preHandler: admin }, async (req, reply) => {
    const { canal } = z.object({ canal: z.enum(['mail', 'whatsapp']) }).parse(req.body);
    const u = await db('usuarios').where({ id: req.ctx.id }).first();
    if (!canales[canal].configurado()) return reply.code(409).send({ error: 'canal_no_configurado' });
    const destino = canal === 'mail' ? u.email : u.telefono;
    if (!destino) return reply.code(409).send({ error: canal === 'mail' ? 'sin_email' : 'sin_telefono' });
    try { await canales[canal].enviar({ to: destino, subject: 'Prueba de alertas JustPrint', text: 'Si te llegó este mensaje, el canal está bien configurado.' }); } catch (e) { return reply.code(502).send({ error: 'fallo_envio', detalle: String(e.message).slice(0, 200) }); }
    return { ok: true };
  });

  app.get('/api/alertas/historial', { preHandler: admin }, async (req) => {
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const eventos = await db('alertas_eventos').orderBy('id', 'desc').limit(25).offset((pagina - 1) * 25);
    const envios = eventos.length ? await db('alertas_envios').whereIn('evento_id', eventos.map((e) => e.id)).select('evento_id', 'canal', 'estado') : [];
    const [{ total }] = await db('alertas_eventos').count({ total: '*' });
    return { total: Number(total), pagina, items: eventos.map((e) => ({ id: e.id, regla: e.regla, titulo: e.titulo, cuerpo: e.cuerpo, disparada_en: e.disparada_en,
      envios: CANALES.map((c) => ({ canal: c, enviados: envios.filter((x) => x.evento_id === e.id && x.canal === c && x.estado === 'enviado').length, fallidos: envios.filter((x) => x.evento_id === e.id && x.canal === c && x.estado !== 'enviado').length })).filter((x) => x.enviados || x.fallidos) })) };
  });

  // ---- campana: las notificaciones de cada persona ----
  app.get('/api/notificaciones', { preHandler: [auth] }, async (req) => {
    const items = await db('notificaciones').where({ usuario_id: req.ctx.id }).orderBy('id', 'desc').limit(40);
    const [{ n }] = await db('notificaciones').where({ usuario_id: req.ctx.id }).where({ leida: false }).count({ n: '*' });
    return { sin_leer: Number(n), items: items.map((i) => ({ id: i.id, titulo: i.titulo, cuerpo: i.cuerpo, destino: i.destino, leida: Boolean(i.leida), creada: i.created_at })) };
  });

  app.get('/api/notificaciones/contador', { preHandler: [auth] }, async (req) => {
    const [{ n }] = await db('notificaciones').where({ usuario_id: req.ctx.id }).where({ leida: false }).count({ n: '*' });
    return { sin_leer: Number(n) };
  });

  app.post('/api/notificaciones/leer', { preHandler: [auth] }, async (req) => {
    const d = z.object({ ids: z.array(z.number().int().positive()).max(100).optional() }).parse(req.body ?? {});
    const q = db('notificaciones').where({ usuario_id: req.ctx.id, leida: false });
    if (d.ids) q.whereIn('id', d.ids);
    await q.update({ leida: true });
    return { ok: true };
  });
}
