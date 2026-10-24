import crypto from 'node:crypto';
import { config } from '../config.js';
import { cargarContexto, puede } from '../lib/contexto.js';

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function crearSesion(db, usuarioId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + config.sesionHoras * 3600 * 1000);
  await db('sesiones').insert({
    id: hashToken(token),
    usuario_id: usuarioId,
    expira_en: expira.toISOString().slice(0, 19).replace('T', ' '),
    ip: req.ip,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 255),
  });
  return { token, expira };
}

/** preHandler: exige sesión válida y deja el contexto en req.ctx. */
export function requerirSesion(db) {
  return async function (req, reply) {
    const token = req.cookies?.[config.cookie];
    if (!token) return reply.code(401).send({ error: 'no_autenticado' });
    const ses = await db('sesiones').where({ id: hashToken(token) }).first();
    const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (!ses || ses.expira_en < ahora) return reply.code(401).send({ error: 'sesion_expirada' });
    const ctx = await cargarContexto(db, ses.usuario_id);
    if (!ctx) return reply.code(401).send({ error: 'no_autenticado' });
    req.ctx = ctx;
  };
}

/** preHandler: exige que el usuario tenga todos los permisos indicados. */
export function requerirPermiso(...claves) {
  return async function (req, reply) {
    if (!claves.every((c) => puede(req.ctx, c))) return reply.code(403).send({ error: 'sin_permiso' });
  };
}
