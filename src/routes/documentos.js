// Documentos firmados de los contratos (contrato, anexos, adendas), en PDF.
// Quién ve y sube: el mismo alcance que el cliente (comercial: su cartera; head: todas; dirección: todo).
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { aDia, hoy } from '../lib/fechas.js';
import { puedeVerCliente } from '../lib/contexto.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const MAX_BYTES = 10 * 1024 * 1024;
export const TIPOS_DOC = { contrato: 'Contrato firmado', anexo: 'Anexo', adenda: 'Adenda o renovación', otro: 'Otro' };
const error = (reply, code, e) => reply.code(code).send({ error: e });

const consulta = z.object({
  tipo: z.enum(['contrato', 'anexo', 'adenda', 'otro']).default('contrato'), titulo: z.string().trim().max(160).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), notas: z.string().trim().max(1000).optional(),
});

export default async function rutasDocumentos(app, { db }) {
  const auth = requerirSesion(db);
  // El PDF llega como cuerpo binario; el parser vale solo para este plugin.
  app.addContentTypeParser(['application/pdf', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: MAX_BYTES + 1024 }, (req, body, done) => done(null, body));

  const fila = (d) => ({
    id: d.id, contrato_id: d.contrato_id, contrato: d.contrato ?? null, tipo: d.tipo, tipo_nombre: TIPOS_DOC[d.tipo] ?? d.tipo, titulo: d.titulo, fecha_documento: aDia(d.fecha_documento), notas: d.notas ?? null,
    nombre_original: d.nombre_original, bytes: d.bytes, subido_por: d.subido ?? null, subido_el: aDia(d.created_at),
  });
  const consultaDocs = (extra) => db('contrato_documentos as d').join('contratos as c', 'c.id', 'd.contrato_id').leftJoin('usuarios as u', 'u.id', 'd.subido_por').whereNull('d.deleted_at').modify(extra)
    .orderBy([{ column: 'd.fecha_documento', order: 'desc' }, { column: 'd.id', order: 'desc' }])
    .select('d.id', 'd.contrato_id', 'd.tipo', 'd.titulo', 'd.fecha_documento', 'd.notas', 'd.nombre_original', 'd.bytes', 'd.created_at', 'c.nombre as contrato', 'u.nombre as subido');

  async function contratoVisible(req, reply, id) {
    const c = await db('contratos').where({ id }).whereNull('deleted_at').first();
    if (!c || !(await puedeVerCliente(db, req.ctx, c.cliente_id))) { error(reply, 404, 'no_encontrado'); return null; }
    return c;
  }

  app.get('/api/contratos/:id/documentos', { preHandler: [auth, requerirPermiso('contratos.ver')] }, async (req, reply) => {
    const c = await contratoVisible(req, reply, Number(req.params.id)); if (!c) return;
    return { documentos: (await consultaDocs((q) => q.where('d.contrato_id', c.id))).map(fila) };
  });

  app.get('/api/clientes/:id/documentos', { preHandler: [auth, requerirPermiso('contratos.ver')] }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id)) || !(await db('clientes').where({ id }).whereNull('deleted_at').first())) return error(reply, 404, 'no_encontrado');
    const contratos = await db('contratos').where({ cliente_id: id }).whereNull('deleted_at').orderBy('id').select('id', 'nombre', 'estado');
    return { contratos, documentos: (await consultaDocs((q) => q.where('d.cliente_id', id))).map(fila) };
  });

  app.post('/api/contratos/:id/documentos', { preHandler: [auth, requerirPermiso('contratos.documentos')], bodyLimit: MAX_BYTES + 1024 }, async (req, reply) => {
    const c = await contratoVisible(req, reply, Number(req.params.id)); if (!c) return;
    const q = consulta.parse(req.query ?? {});
    const pdf = req.body;
    if (!Buffer.isBuffer(pdf) || pdf.length < 8) return error(reply, 400, 'archivo_invalido');
    if (pdf.length > MAX_BYTES) return error(reply, 413, 'archivo_muy_grande');
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return error(reply, 400, 'no_es_pdf');
    if (q.fecha && q.fecha > hoy()) return error(reply, 400, 'fecha_futura');
    let nombre = null;
    try { nombre = req.headers['x-nombre-archivo'] ? decodeURIComponent(String(req.headers['x-nombre-archivo'])).slice(0, 255) : null; } catch { nombre = null; }
    const sha = createHash('sha256').update(pdf).digest('hex');
    const repetido = await db('contrato_documentos').where({ contrato_id: c.id, sha256: sha }).whereNull('deleted_at').first();
    if (repetido) return reply.code(409).send({ error: 'documento_repetido', titulo: repetido.titulo });
    const titulo = q.titulo || (nombre ? nombre.replace(/\.pdf$/i, '') : TIPOS_DOC[q.tipo]);
    const id = await db.transaction(async (trx) => {
      const [nuevo] = await trx('contrato_documentos').insert({ contrato_id: c.id, cliente_id: c.cliente_id, tipo: q.tipo, titulo, fecha_documento: q.fecha ?? null, notas: q.notas ?? null, nombre_original: nombre, bytes: pdf.length, sha256: sha, subido_por: req.ctx.id });
      await trx('contrato_documentos_contenido').insert({ documento_id: nuevo, contenido: pdf });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'contrato_documentos', nuevo, null, { contrato_id: c.id, tipo: q.tipo, titulo, bytes: pdf.length });
      return nuevo;
    });
    return reply.code(201).send({ id });
  });

  async function documento(req, reply) {
    const d = await db('contrato_documentos').where({ id: Number(req.params.id) }).whereNull('deleted_at').first();
    if (!d || !(await puedeVerCliente(db, req.ctx, d.cliente_id))) { error(reply, 404, 'no_encontrado'); return null; }
    return d;
  }

  app.get('/api/documentos/:id/archivo', { preHandler: [auth, requerirPermiso('contratos.ver')] }, async (req, reply) => {
    const d = await documento(req, reply); if (!d) return;
    const c = await db('contrato_documentos_contenido').where({ documento_id: d.id }).first();
    if (!c) return error(reply, 404, 'no_encontrado');
    const nombre = `${d.titulo.replace(/[^\w\s.-]/g, '').trim().replace(/\s+/g, '_') || 'documento'}.pdf`;
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `${req.query.descargar === '1' ? 'attachment' : 'inline'}; filename="${nombre}"`)
      .header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').send(Buffer.from(c.contenido));
  });

  /** Se oculta, no se borra: el PDF queda en la base y se puede recuperar. Solo quien edita contratos. */
  app.delete('/api/documentos/:id', { preHandler: [auth, requerirPermiso('contratos.editar')] }, async (req, reply) => {
    const d = await documento(req, reply); if (!d) return;
    await db('contrato_documentos').where({ id: d.id }).update({ deleted_at: db.fn.now(), eliminado_por: req.ctx.id });
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'eliminar', 'contrato_documentos', d.id, { contrato_id: d.contrato_id, tipo: d.tipo, titulo: d.titulo }, null);
    return { ok: true };
  });
}
