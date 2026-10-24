import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { AREA } from '../lib/catalogo.js';
import { puedeVerCliente, puede, usuariosVisibles } from '../lib/contexto.js';
import { hoy } from '../lib/fechas.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const asignarSchema = z.object({
  cliente_id: z.number().int().positive(),
  usuario_id: z.number().int().positive(),
  motivo: z.string().trim().max(255).optional(),
});

export default async function rutasCartera(app, { db }) {
  const auth = requerirSesion(db);

  app.post('/api/cartera/asignar', { preHandler: [auth, requerirPermiso('cartera.asignar')] }, async (req, reply) => {
    const { cliente_id, usuario_id, motivo } = asignarSchema.parse(req.body);

    if (!(await puedeVerCliente(db, req.ctx, cliente_id))) return reply.code(404).send({ error: 'no_encontrado' });

    // El destino tiene que ser un comercial activo, y dentro de las personas que este líder puede ver.
    const destino = await db('usuarios').join('usuario_area', 'usuario_area.usuario_id', 'usuarios.id')
      .join('areas', 'areas.id', 'usuario_area.area_id')
      .where({ 'usuarios.id': usuario_id, 'usuarios.activo': true, 'areas.nombre': AREA.COMERCIAL })
      .whereNull('usuarios.deleted_at').select('usuarios.id').first();
    if (!destino) return reply.code(422).send({ error: 'destino_invalido' });
    const visibles = await usuariosVisibles(db, req.ctx);
    if (visibles !== null && !visibles.includes(usuario_id)) return reply.code(403).send({ error: 'sin_permiso' });

    const resultado = await db.transaction(async (trx) => {
      const vigente = await trx('cartera_asignaciones').where({ cliente_id }).whereNull('hasta').first();
      if (vigente?.usuario_id === usuario_id) return { yaAsignada: true };
      if (vigente) await trx('cartera_asignaciones').where({ id: vigente.id }).update({ hasta: hoy() });
      const [id] = await trx('cartera_asignaciones').insert({
        cliente_id, usuario_id, desde: hoy(), asignado_por: req.ctx.id, motivo: motivo ?? null,
      });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'cartera_asignaciones', id,
        vigente ?? null, { cliente_id, usuario_id, motivo: motivo ?? null });
      return { id };
    });
    if (resultado.yaAsignada) return reply.code(409).send({ error: 'ya_asignada' });
    return reply.code(201).send({ ok: true, id: resultado.id });
  });

  app.get('/api/cartera/:clienteId/historial', { preHandler: [auth, requerirPermiso('clientes.ver')] }, async (req, reply) => {
    const clienteId = Number(req.params.clienteId);
    if (!Number.isInteger(clienteId) || !(await puedeVerCliente(db, req.ctx, clienteId))) return reply.code(404).send({ error: 'no_encontrado' });
    if (!puede(req.ctx, 'cartera.asignar') && !puede(req.ctx, 'crm.gestionar')) return reply.code(403).send({ error: 'sin_permiso' });
    const filas = await db('cartera_asignaciones as ca').join('usuarios as u', 'u.id', 'ca.usuario_id')
      .leftJoin('usuarios as p', 'p.id', 'ca.asignado_por').where('ca.cliente_id', clienteId)
      .select('ca.id', 'u.id as usuario_id', 'u.nombre as usuario', 'ca.desde', 'ca.hasta', 'p.nombre as asignado_por', 'ca.motivo')
      .orderBy('ca.desde', 'desc').orderBy('ca.id', 'desc');
    return { historial: filas };
  });
}
