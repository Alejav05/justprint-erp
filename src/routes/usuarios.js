import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { hashear, validarPolitica } from '../lib/passwords.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const areaSchema = z.object({
  area: z.string(),
  funcion: z.enum(['miembro', 'lider']).default('miembro'),
  alcance: z.enum(['propio', 'equipo', 'todo']).default('propio'),
});

const crearSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  email: z.string().email().max(160),
  password: z.string(),
  rol: z.string(),
  areas: z.array(areaSchema).max(5).default([]),
  telefono: z.string().trim().max(30).regex(/^\+?[\d\s()-]{6,30}$/).optional(),
});

const editarSchema = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  rol: z.string().optional(),
  activo: z.boolean().optional(),
  areas: z.array(areaSchema).max(5).optional(),
  telefono: z.string().trim().max(30).regex(/^\+?[\d\s()-]{6,30}$/).nullable().optional(),
});

export default async function rutasUsuarios(app, { db }) {
  const pre = [requerirSesion(db), requerirPermiso('usuarios.administrar')];

  async function resolverRolYAreas(rol, areas) {
    const r = await db('roles').where({ nombre: rol }).first();
    if (!r) return { error: 'rol_invalido' };
    const filas = [];
    for (const a of areas ?? []) {
      const fila = await db('areas').where({ nombre: a.area }).first();
      if (!fila) return { error: 'area_invalida' };
      filas.push({ area_id: fila.id, funcion: a.funcion, alcance: a.alcance });
    }
    return { rol: r, areas: filas };
  }

  const listar = async () => {
    const usuarios = await db('usuarios').join('roles', 'roles.id', 'usuarios.rol_id').whereNull('usuarios.deleted_at')
      .select('usuarios.id', 'usuarios.nombre', 'usuarios.email', 'usuarios.activo', 'usuarios.telefono', 'usuarios.ultimo_ingreso', 'roles.nombre as rol')
      .orderBy('usuarios.nombre');
    const areas = await db('usuario_area').join('areas', 'areas.id', 'usuario_area.area_id')
      .select('usuario_area.usuario_id', 'areas.nombre as area', 'usuario_area.funcion', 'usuario_area.alcance');
    return usuarios.map((u) => ({ ...u, areas: areas.filter((a) => a.usuario_id === u.id).map(({ usuario_id, ...r }) => r) }));
  };

  app.get('/api/usuarios', { preHandler: pre }, async () => ({ usuarios: await listar() }));

  app.get('/api/roles', { preHandler: pre }, async () => {
    const roles = await db('roles').select('id', 'nombre', 'descripcion');
    const rp = await db('rol_permiso').join('permisos', 'permisos.id', 'rol_permiso.permiso_id').select('rol_id', 'clave');
    return { roles: roles.map((r) => ({ ...r, permisos: rp.filter((x) => x.rol_id === r.id).map((x) => x.clave).sort() })) };
  });

  app.post('/api/usuarios', { preHandler: pre }, async (req, reply) => {
    const d = crearSchema.parse(req.body);
    const errPolitica = validarPolitica(d.password);
    if (errPolitica) return reply.code(422).send({ error: 'contrasena_debil', detalle: errPolitica });
    const email = d.email.toLowerCase();
    if (await db('usuarios').where({ email }).first()) return reply.code(409).send({ error: 'email_en_uso' });
    const res = await resolverRolYAreas(d.rol, d.areas);
    if (res.error) return reply.code(422).send({ error: res.error });

    const id = await db.transaction(async (trx) => {
      const [nuevo] = await trx('usuarios').insert({
        nombre: d.nombre, email, password_hash: await hashear(d.password), rol_id: res.rol.id, telefono: d.telefono ?? null, created_by: req.ctx.id,
      });
      if (res.areas.length) await trx('usuario_area').insert(res.areas.map((a) => ({ ...a, usuario_id: nuevo })));
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'usuarios', nuevo, null,
        { nombre: d.nombre, email, rol: d.rol, areas: d.areas });
      return nuevo;
    });
    return reply.code(201).send({ id });
  });

  app.patch('/api/usuarios/:id', { preHandler: pre }, async (req, reply) => {
    const id = Number(req.params.id);
    const d = editarSchema.parse(req.body);
    const antes = await db('usuarios').where({ id }).whereNull('deleted_at').first();
    if (!antes) return reply.code(404).send({ error: 'no_encontrado' });
    if (id === req.ctx.id && d.activo === false) return reply.code(422).send({ error: 'no_podes_desactivarte' });

    const cambios = {};
    if (d.nombre) cambios.nombre = d.nombre;
    if (d.activo !== undefined) cambios.activo = d.activo;
    if (d.telefono !== undefined) cambios.telefono = d.telefono;
    let res = null;
    if (d.rol || d.areas) {
      res = await resolverRolYAreas(d.rol ?? (await db('roles').where({ id: antes.rol_id }).first()).nombre, d.areas);
      if (res.error) return reply.code(422).send({ error: res.error });
      if (d.rol) cambios.rol_id = res.rol.id;
    }

    await db.transaction(async (trx) => {
      if (Object.keys(cambios).length) {
        await trx('usuarios').where({ id }).update({ ...cambios, updated_at: trx.fn.now(), updated_by: req.ctx.id });
      }
      if (d.areas) {
        await trx('usuario_area').where({ usuario_id: id }).delete();
        if (res.areas.length) await trx('usuario_area').insert(res.areas.map((a) => ({ ...a, usuario_id: id })));
      }
      // Si se desactiva o cambian permisos, se cierran sus sesiones: el cambio rige ya.
      if (d.activo === false || d.rol || d.areas) await trx('sesiones').where({ usuario_id: id }).delete();
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'usuarios', id, antes, { ...cambios, areas: d.areas });
    });
    return { ok: true };
  });

  app.post('/api/usuarios/:id/password', { preHandler: pre }, async (req, reply) => {
    const id = Number(req.params.id);
    const { password } = z.object({ password: z.string() }).parse(req.body);
    const err = validarPolitica(password);
    if (err) return reply.code(422).send({ error: 'contrasena_debil', detalle: err });
    const u = await db('usuarios').where({ id }).whereNull('deleted_at').first();
    if (!u) return reply.code(404).send({ error: 'no_encontrado' });
    await db.transaction(async (trx) => {
      await trx('usuarios').where({ id }).update({
        password_hash: await hashear(password), intentos_fallidos: 0, bloqueado_hasta: null, updated_by: req.ctx.id,
      });
      await trx('sesiones').where({ usuario_id: id }).delete();
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'usuarios', id, null, { password: 'restablecida' });
    });
    return { ok: true };
  });
}
