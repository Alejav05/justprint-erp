import { AREA } from './catalogo.js';

/** Carga quién es el usuario, qué puede hacer (permisos) y sobre qué datos (áreas y alcance). */
export async function cargarContexto(db, usuarioId) {
  const u = await db('usuarios').where({ id: usuarioId, activo: true }).whereNull('deleted_at').first();
  if (!u) return null;
  const rol = await db('roles').where({ id: u.rol_id }).first();
  const permisos = await db('rol_permiso')
    .join('permisos', 'permisos.id', 'rol_permiso.permiso_id')
    .where('rol_permiso.rol_id', u.rol_id)
    .select('permisos.clave');
  const areas = await db('usuario_area')
    .join('areas', 'areas.id', 'usuario_area.area_id')
    .where('usuario_area.usuario_id', u.id)
    .select('areas.id as area_id', 'areas.nombre as area', 'usuario_area.funcion', 'usuario_area.alcance');
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: rol.nombre,
    permisos: new Set(permisos.map((p) => p.clave)),
    areas,
  };
}

export const puede = (ctx, clave) => ctx.permisos.has(clave);
export const esArea = (ctx, nombre) => ctx.areas.some((a) => a.area === nombre);

async function miembrosDeArea(db, areaId) {
  const filas = await db('usuario_area').join('usuarios', 'usuarios.id', 'usuario_area.usuario_id')
    .where({ 'usuario_area.area_id': areaId, 'usuarios.activo': true }).whereNull('usuarios.deleted_at')
    .select('usuarios.id');
  return filas.map((f) => f.id);
}

/**
 * IDs de usuarios cuyas personas puede ver `ctx` (para reportes de equipo y para elegir a quién asignar).
 * null = todos.
 */
export async function usuariosVisibles(db, ctx) {
  if (ctx.areas.some((a) => a.alcance === 'todo')) return null;
  const ids = new Set([ctx.id]);
  for (const a of ctx.areas) {
    if (a.alcance === 'equipo') (await miembrosDeArea(db, a.area_id)).forEach((id) => ids.add(id));
  }
  return [...ids];
}

/**
 * IDs de clientes que `ctx` puede ver. null = todos.
 * - Alcance "todo": todos los clientes.
 * - Comercial: los de su cartera vigente (propio) o la de su equipo (equipo).
 *   El líder comercial ve además las cuentas sin responsable, para poder asignarlas.
 * - Técnica: los clientes de los tickets que atiende él (propio) o su equipo (equipo).
 * - Accesos explícitos (usuario_cliente) se suman siempre.
 */
export async function clientesVisibles(db, ctx) {
  if (ctx.areas.some((a) => a.alcance === 'todo')) return null;
  const ids = new Set();

  for (const a of ctx.areas) {
    const usuarios = a.alcance === 'equipo' ? await miembrosDeArea(db, a.area_id) : [ctx.id];

    if (a.area === AREA.COMERCIAL) {
      const filas = await db('cartera_asignaciones').whereNull('hasta').whereIn('usuario_id', usuarios).select('cliente_id');
      filas.forEach((f) => ids.add(f.cliente_id));
      if (a.funcion === 'lider') {
        const sinResponsable = await db('clientes').whereNull('deleted_at')
          .whereNotIn('id', db('cartera_asignaciones').whereNull('hasta').select('cliente_id')).select('id');
        sinResponsable.forEach((f) => ids.add(f.id));
      }
    }

    if (a.area === AREA.TECNICA) {
      const filas = await db('tickets').whereNull('deleted_at').whereIn('asignado_a', usuarios).distinct('cliente_id');
      filas.forEach((f) => ids.add(f.cliente_id));
    }
  }

  const extra = await db('usuario_cliente').where({ usuario_id: ctx.id }).select('cliente_id');
  extra.forEach((f) => ids.add(f.cliente_id));
  return [...ids];
}

export async function puedeVerCliente(db, ctx, clienteId) {
  const ids = await clientesVisibles(db, ctx);
  return ids === null || ids.includes(clienteId);
}
