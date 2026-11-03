// Gestión de los accesos al portal desde el ERP: invitar, reenviar el enlace, dar de baja o de alta y mirar el portal como lo ve el cliente.
import { z } from 'zod';
import { canales } from '../lib/canales.js';
import { puedeVerCliente } from '../lib/contexto.js';
import { json } from '../lib/fechas.js';
import { auditarPortal, crearEnlace, enviarEnlace, urlEnlace } from '../lib/portal.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const INVITACION_MIN = 7 * 24 * 60;
const fila = (a) => ({ id: a.id, nombre: a.nombre, email: a.email, estado: a.estado, tiene_clave: !!a.password_hash, ultimo_ingreso: a.ultimo_ingreso, contacto_id: a.contacto_id });

export default async function rutasPortalAdmin(app, { db }) {
  const pre = [requerirSesion(db), requerirPermiso('portal.gestionar')];
  const ctx = (req) => ({ usuarioId: req.ctx.id, ip: req.ip });

  async function acceso(req, reply) {
    const a = await db('portal_accesos').where({ id: Number(req.params.id) }).first();
    if (!a || !(await puedeVerCliente(db, req.ctx, a.cliente_id))) { reply.code(404).send({ error: 'no_encontrado' }); return null; }
    return a;
  }

  app.get('/api/clientes/:id/portal', { preHandler: pre }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id))) return reply.code(404).send({ error: 'no_encontrado' });
    const accesos = await db('portal_accesos').where({ cliente_id: id }).orderBy('id');
    const contactos = (await db('contactos').where({ cliente_id: id, estado: 'activo' }).whereNull('deleted_at').orderBy('nombre').select('id', 'nombre', 'cargo', 'emails'))
      .map((c) => ({ id: c.id, nombre: c.nombre, cargo: c.cargo, emails: json(c.emails, []).map((e) => e.direccion) })).filter((c) => c.emails.length);
    return { accesos: accesos.map(fila), contactos, mail_configurado: canales.mail.configurado() };
  });

  const invitar = z.object({ nombre: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(160), contacto_id: z.coerce.number().int().optional() });
  app.post('/api/clientes/:id/portal', { preHandler: pre }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id)) || !(await db('clientes').where({ id }).whereNull('deleted_at').first())) return reply.code(404).send({ error: 'no_encontrado' });
    const d = invitar.parse(req.body);
    if (await db('portal_accesos').where({ email: d.email }).first()) return reply.code(409).send({ error: 'email_en_uso' });
    if (d.contacto_id && !(await db('contactos').where({ id: d.contacto_id, cliente_id: id }).first())) return reply.code(400).send({ error: 'contacto_invalido' });
    const [aid] = await db('portal_accesos').insert({ cliente_id: id, contacto_id: d.contacto_id ?? null, nombre: d.nombre, email: d.email, estado: 'invitado', created_by: req.ctx.id });
    const a = await db('portal_accesos').where({ id: aid.id ?? aid }).first();
    const url = urlEnlace(req, await crearEnlace(db, a.id, { minutos: INVITACION_MIN, creadoPor: req.ctx.id }));
    const enviado = await enviarEnlace(a, url, { invitacion: true });
    await auditarPortal(db, ctx(req), 'portal_invitar', a.id, { cliente_id: id, email: d.email, enviado });
    return reply.code(201).send({ ok: true, acceso: fila(a), enviado, url });
  });

  /** Nuevo enlace (si el cliente lo perdió o venció). */
  app.post('/api/portal/accesos/:id/enlace', { preHandler: pre }, async (req, reply) => {
    const a = await acceso(req, reply); if (!a) return;
    if (a.estado === 'baja') return reply.code(409).send({ error: 'acceso_dado_de_baja' });
    const url = urlEnlace(req, await crearEnlace(db, a.id, { minutos: INVITACION_MIN, creadoPor: req.ctx.id }));
    const enviado = await enviarEnlace(a, url, { invitacion: !a.password_hash });
    await auditarPortal(db, ctx(req), 'portal_reenviar', a.id, { enviado });
    return { ok: true, enviado, url };
  });

  app.post('/api/portal/accesos/:id/baja', { preHandler: pre }, async (req, reply) => {
    const a = await acceso(req, reply); if (!a) return;
    await db('portal_accesos').where({ id: a.id }).update({ estado: 'baja', updated_at: db.fn.now() });
    await db('portal_sesiones').where({ acceso_id: a.id }).delete(); // lo saca ya mismo
    await auditarPortal(db, ctx(req), 'portal_baja', a.id, { antes: a.estado });
    return { ok: true };
  });

  app.post('/api/portal/accesos/:id/alta', { preHandler: pre }, async (req, reply) => {
    const a = await acceso(req, reply); if (!a) return;
    const estado = a.password_hash ? 'activo' : 'invitado';
    await db('portal_accesos').where({ id: a.id }).update({ estado, updated_at: db.fn.now() });
    await auditarPortal(db, ctx(req), 'portal_alta', a.id, { estado });
    return { ok: true, estado };
  });

  /** Borra un acceso que no se usa (invitación equivocada o prueba). Uno activo primero se da de baja. */
  app.delete('/api/portal/accesos/:id', { preHandler: pre }, async (req, reply) => {
    const a = await acceso(req, reply); if (!a) return;
    if (a.estado === 'activo') return reply.code(409).send({ error: 'dar_de_baja_primero' });
    await db.transaction(async (trx) => {
      await trx('portal_sesiones').where({ acceso_id: a.id }).delete();
      await trx('portal_enlaces').where({ acceso_id: a.id }).delete();
      await trx('portal_accesos').where({ id: a.id }).delete();
    });
    await auditarPortal(db, ctx(req), 'portal_eliminar', a.id, { email: a.email, estado: a.estado });
    return { ok: true };
  });

  /** Enlace de un uso (3 minutos) para abrir el portal tal como lo ve esa persona, en solo lectura. */
  app.post('/api/portal/accesos/:id/ver-como', { preHandler: pre }, async (req, reply) => {
    const a = await acceso(req, reply); if (!a) return;
    if (a.estado === 'baja') return reply.code(409).send({ error: 'acceso_dado_de_baja' });
    const url = urlEnlace(req, await crearEnlace(db, a.id, { tipo: 'vista', minutos: 3, creadoPor: req.ctx.id }));
    await auditarPortal(db, ctx(req), 'portal_ver_como', a.id);
    return { url };
  });
}
