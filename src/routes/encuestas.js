// Encuesta de satisfacción: la responde solo el cliente, desde el enlace del remito (mail o WhatsApp). Nadie del equipo puede cargarla.
// El resumen y el ranking los ven Dirección, las cabezas de Atención y Técnica; el técnico se ve a sí mismo.
import { clientesVisibles, usuariosVisibles } from '../lib/contexto.js';
import { ASPECTOS, encuestaSchema, guardarEncuesta, leerEncuesta, textoAspecto } from '../lib/encuestas.js';
import { cargarRemitoCompleto, codigoVerificacion } from '../lib/remitos.js';
import { paginaPublicaRemito } from '../lib/remito_publico.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';
import { z } from 'zod';

const error = (reply, code, e) => reply.code(code).send({ error: e });
const json = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
const redondear = (n) => Math.round(n * 100) / 100;

export default async function rutasEncuestas(app, { db }) {
  const auth = requerirSesion(db);
  // El formulario de la página pública llega como application/x-www-form-urlencoded (sin JavaScript en esa página).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8192 }, (req, body, done) => {
    const p = new URLSearchParams(body); const o = {};
    for (const k of new Set(p.keys())) o[k] = k === 'aspectos' ? p.getAll(k) : p.get(k);
    done(null, o);
  });

  /** El cliente la completa desde el enlace del remito. Sin sesión: se entra con el enlace privado. */
  app.post('/r/:token/encuesta', async (req, reply) => {
    const token = String(req.params.token);
    const r = /^[a-f0-9]{32}$/.test(token) ? await db('remitos').where({ token }).whereNull('deleted_at').first() : null;
    if (!r) return reply.code(404).send('No encontrado');
    const ok = encuestaSchema.safeParse({ puntaje: req.body?.puntaje, aspectos: req.body?.aspectos ?? [], comentario: req.body?.comentario || undefined });
    if (ok.success && r.estado === 'firmado') await guardarEncuesta(db, r, ok.data, 'enlace');
    return reply.redirect(`/r/${token}#opinion`, 303);
  });

  app.get('/api/encuestas', { preHandler: [auth, requerirPermiso('encuestas.ver')] }, async (req) => {
    const f = z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), tecnico: z.coerce.number().int().optional() }).parse(req.query);
    const visibles = await usuariosVisibles(db, req.ctx);
    const filas = await db('encuestas as e').join('clientes as c', 'c.id', 'e.cliente_id').join('remitos as r', 'r.id', 'e.remito_id').leftJoin('usuarios as u', 'u.id', 'e.tecnico_id')
      .modify((q) => {
        if (visibles) q.whereIn('e.tecnico_id', visibles);
        if (f.tecnico) q.where('e.tecnico_id', f.tecnico);
        if (f.desde) q.where('e.created_at', '>=', `${f.desde} 00:00:00`);
        if (f.hasta) q.where('e.created_at', '<=', `${f.hasta} 23:59:59`);
      }).orderBy('e.id', 'desc')
      .select('e.id', 'e.remito_id', 'e.puntaje', 'e.aspectos', 'e.comentario', 'e.origen', 'e.created_at', 'e.tecnico_id', 'u.nombre as tecnico', 'c.id as cliente_id', 'c.razon_social', 'c.nombre_comercial', 'r.numero as remito');
    const items = filas.map((x) => ({ ...x, aspectos: json(x.aspectos), cliente: x.nombre_comercial || x.razon_social, razon_social: undefined, nombre_comercial: undefined }));
    const n = items.length; const suma = items.reduce((s, x) => s + x.puntaje, 0);
    const distribucion = [5, 4, 3, 2, 1].map((p) => ({ puntaje: p, cantidad: items.filter((x) => x.puntaje === p).length }));
    const porTecnico = new Map();
    for (const x of items) {
      const k = x.tecnico_id ?? 0;
      const t = porTecnico.get(k) ?? { id: x.tecnico_id, nombre: x.tecnico ?? 'Sin técnico', cantidad: 0, suma: 0, bajas: 0 };
      t.cantidad += 1; t.suma += x.puntaje; if (x.puntaje <= 2) t.bajas += 1; porTecnico.set(k, t);
    }
    const aspectos = ASPECTOS.map((a) => ({ clave: a.clave, texto: a.texto,
      destacados: items.filter((x) => x.puntaje >= 4 && x.aspectos.includes(a.clave)).length,
      a_mejorar: items.filter((x) => x.puntaje <= 3 && x.aspectos.includes(a.clave)).length }));
    // Tasa de respuesta: remitos firmados del período contra las encuestas que llegaron.
    const firmados = await db('remitos').where({ estado: 'firmado' }).whereNull('deleted_at')
      .modify((q) => { if (f.desde) q.where('fecha', '>=', f.desde); if (f.hasta) q.where('fecha', '<=', f.hasta); if (visibles) q.whereIn('created_by', visibles); }).count({ n: '*' }).first();
    return {
      cantidad: n, promedio: n ? redondear(suma / n) : null,
      satisfechos: n ? Math.round((items.filter((x) => x.puntaje >= 4).length / n) * 100) : null,
      tasa_respuesta: Number(firmados.n) ? Math.round((n / Number(firmados.n)) * 100) : null,
      distribucion, aspectos,
      ranking: [...porTecnico.values()].map((t) => ({ id: t.id, nombre: t.nombre, cantidad: t.cantidad, promedio: redondear(t.suma / t.cantidad), bajas: t.bajas }))
        .sort((a, b) => b.promedio - a.promedio || b.cantidad - a.cantidad),
      para_revisar: items.filter((x) => x.puntaje <= 2).slice(0, 10),
      ultimas: items.slice(0, 30),
    };
  });
}

export { leerEncuesta, textoAspecto };
