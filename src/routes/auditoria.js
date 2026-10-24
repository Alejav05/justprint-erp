import { z } from 'zod';
import { json } from '../lib/fechas.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const filtroSchema = z.object({
  tabla: z.string().max(60).optional(),
  usuario_id: z.coerce.number().int().positive().optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

export default async function rutasAuditoria(app, { db }) {
  app.get('/api/auditoria', { preHandler: [requerirSesion(db), requerirPermiso('auditoria.ver')] }, async (req) => {
    const f = filtroSchema.parse(req.query);
    const q = db('audit_log as a').leftJoin('usuarios as u', 'u.id', 'a.usuario_id');
    if (f.tabla) q.where('a.tabla', f.tabla);
    if (f.usuario_id) q.where('a.usuario_id', f.usuario_id);
    if (f.desde) q.where('a.created_at', '>=', `${f.desde} 00:00:00`);
    if (f.hasta) q.where('a.created_at', '<=', `${f.hasta} 23:59:59`);
    const filas = await q.clone()
      .select('a.id', 'a.created_at', 'a.accion', 'a.tabla', 'a.registro_id', 'a.antes', 'a.despues', 'a.ip', 'u.nombre as usuario')
      .orderBy('a.id', 'desc').limit(f.limite).offset((f.pagina - 1) * f.limite);
    return { eventos: filas.map((x) => ({ ...x, antes: json(x.antes), despues: json(x.despues) })) };
  });
}
