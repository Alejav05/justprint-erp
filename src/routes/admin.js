import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { DEFINICIONES, MODULOS, aplicar, modulosOcultos, valor, validar } from '../lib/ajustes_sistema.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const error = (reply, code, e) => reply.code(code).send({ error: e });

export default async function rutasAdmin(app, { db }) {
  const admin = [requerirSesion(db), requerirPermiso('sistema.configurar')];

  /** Lo único que se puede ver sin ingresar: el eslogan y la razón social de la pantalla de ingreso. */
  app.get('/api/publico', async () => ({ slogan: valor('marca.slogan'), empresa: valor('marca.empresa') }));

  app.get('/api/admin/config', { preHandler: admin }, async () => ({
    modulos: MODULOS.map(([clave, nombre]) => ({ clave, nombre })),
    items: DEFINICIONES.map((d) => ({ ...d, valor: valor(d.clave) })),
  }));

  app.put('/api/admin/config/:clave', { preHandler: admin }, async (req, reply) => {
    const { valor: v } = z.object({ valor: z.any() }).parse(req.body);
    const r = validar(req.params.clave, v); if (r.error) return error(reply, 400, r.error);
    const antes = valor(req.params.clave);
    await db.transaction(async (trx) => {
      const hay = await trx('configuracion').where({ clave: req.params.clave }).first();
      if (hay) await trx('configuracion').where({ clave: req.params.clave }).update({ valor: JSON.stringify(r.valor), updated_by: req.ctx.id, updated_at: trx.fn.now() });
      else await trx('configuracion').insert({ clave: req.params.clave, valor: JSON.stringify(r.valor), updated_by: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'configuracion', 0, { [req.params.clave]: antes }, { [req.params.clave]: r.valor });
    });
    aplicar(req.params.clave, r.valor);
    return { ok: true, valor: r.valor };
  });

  /** Matriz de permisos: qué puede hacer cada rol. Dirección es fija y siempre tiene todo. */
  app.get('/api/admin/permisos', { preHandler: admin }, async () => {
    const permisos = await db('permisos').orderBy('modulo').orderBy('id').select('clave', 'modulo', 'descripcion');
    const roles = await db('roles').select('id', 'nombre', 'descripcion');
    const rp = await db('rol_permiso').join('permisos', 'permisos.id', 'rol_permiso.permiso_id').select('rol_id', 'clave');
    return { permisos, roles: roles.map((r) => ({ ...r, fijo: r.nombre === 'direccion', permisos: rp.filter((x) => x.rol_id === r.id).map((x) => x.clave).sort() })) };
  });

  app.put('/api/admin/roles/:id/permisos', { preHandler: admin }, async (req, reply) => {
    const d = z.object({ permisos: z.array(z.string()).max(200) }).parse(req.body);
    const rol = await db('roles').where({ id: Number(req.params.id) }).first(); if (!rol) return error(reply, 404, 'no_encontrado');
    if (rol.nombre === 'direccion') return error(reply, 409, 'rol_fijo');
    const filas = await db('permisos').whereIn('clave', d.permisos).select('id', 'clave');
    if (filas.length !== new Set(d.permisos).size) return error(reply, 400, 'permiso_desconocido');
    const antes = (await db('rol_permiso').join('permisos', 'permisos.id', 'rol_permiso.permiso_id').where('rol_id', rol.id).select('clave')).map((x) => x.clave).sort();
    await db.transaction(async (trx) => {
      await trx('rol_permiso').where({ rol_id: rol.id }).delete();
      for (const f of filas) await trx('rol_permiso').insert({ rol_id: rol.id, permiso_id: f.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'roles', rol.id, { permisos: antes }, { permisos: filas.map((f) => f.clave).sort() });
    });
    return { ok: true };
  });
}
export { modulosOcultos };
