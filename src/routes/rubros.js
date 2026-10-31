import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

export default async function rutasRubros(app, { db }) {
  const auth = requerirSesion(db);
  const admin = [auth, requerirPermiso('sistema.configurar')];

  /** Árbol de rubros con sus subrubros. Los inactivos solo se ven con ?todos=1 (para configurar). */
  app.get('/api/rubros', { preHandler: auth }, async (req) => {
    const todos = req.query.todos === '1' && req.ctx.permisos.has('sistema.configurar');
    const filas = await db('rubros').modify((q) => { if (!todos) q.where({ activo: true }); }).orderBy(['orden', 'nombre']).select('id', 'parent_id', 'nombre', 'activo', 'orden');
    const rubros = filas.filter((r) => !r.parent_id).map((r) => ({ ...r, activo: !!r.activo, subrubros: filas.filter((s) => s.parent_id === r.id).map((s) => ({ ...s, activo: !!s.activo })) }));
    return { rubros };
  });

  const cuerpo = z.object({ nombre: z.string().trim().min(2).max(80), parent_id: z.number().int().positive().nullable().optional() });
  app.post('/api/rubros', { preHandler: admin }, async (req, reply) => {
    const d = cuerpo.parse(req.body);
    if (d.parent_id) { const p = await db('rubros').where({ id: d.parent_id }).first(); if (!p || p.parent_id) return reply.code(400).send({ error: 'rubro_invalido' }); }
    if (await db('rubros').where({ nombre: d.nombre, parent_id: d.parent_id ?? null }).first()) return reply.code(409).send({ error: 'rubro_duplicado' });
    const [{ m }] = await db('rubros').where({ parent_id: d.parent_id ?? null }).max({ m: 'orden' });
    const [id] = await db('rubros').insert({ nombre: d.nombre, parent_id: d.parent_id ?? null, orden: (m ?? -1) + 1 });
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'rubros', id, null, d);
    return reply.code(201).send({ id });
  });

  app.patch('/api/rubros/:id', { preHandler: admin }, async (req, reply) => {
    const d = z.object({ nombre: z.string().trim().min(2).max(80).optional(), activo: z.boolean().optional() }).parse(req.body);
    const r = await db('rubros').where({ id: Number(req.params.id) }).first(); if (!r) return reply.code(404).send({ error: 'no_encontrado' });
    if (!Object.keys(d).length) return reply.code(400).send({ error: 'sin_cambios' });
    await db.transaction(async (trx) => {
      await trx('rubros').where({ id: r.id }).update(d);
      if (d.activo === false && !r.parent_id) await trx('rubros').where({ parent_id: r.id }).update({ activo: false });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'rubros', r.id, r, { ...r, ...d });
    });
    return { ok: true };
  });
}
