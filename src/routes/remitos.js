import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles, puede } from '../lib/contexto.js';
import { hoy } from '../lib/fechas.js';
import { siguienteNumero } from '../lib/numeradores.js';
import { costoDeRemito } from '../lib/costos.js';
import { canales } from '../lib/canales.js';
import { cargarRemitoCompleto, codigoVerificacion, contactosDe, guardarConformidad, nuevoToken, parseFirma, telefonoAR, urlPublica } from '../lib/remitos.js';
import { generarRemitoPdf } from '../lib/remito_pdf.js';
import { leerEncuesta } from '../lib/encuestas.js';
import { paginaPublicaRemito } from '../lib/remito_publico.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';
import { stockDe } from './insumos.js';
import { config } from '../config.js';

const MAX_BYTES = 10 * 1024 * 1024;
const error = (reply, code, e, extra = {}) => reply.code(code).send({ error: e, ...extra });
const MIME_ESCANEO = { 'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-', 'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8, 'image/png': (b) => b.subarray(0, 4).toString('hex') === '89504e47' };

const nuevoSchema = z.object({
  cliente_id: z.number().int().positive(), sede_id: z.number().int().positive().optional(), observaciones: z.string().trim().max(1000).optional(),
  items: z.array(z.object({ insumo_id: z.number().int().positive(), cantidad: z.number().int().min(1).max(999) })).max(30).default([]),
  equipos: z.array(z.number().int().positive()).max(20).default([]),
}).refine((d) => d.items.length + d.equipos.length > 0, { message: 'sin_items' });

const conformidadSchema = z.object({
  nombre: z.string().trim().min(2).max(120), cargo: z.string().trim().max(80).optional(), dni: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email().max(160).optional().or(z.literal('').transform(() => undefined)), telefono: z.string().trim().max(40).optional(),
  firma: z.string().max(400000),
});
const escaneoQuery = z.object({ nombre: z.string().trim().min(2).max(120), cargo: z.string().trim().max(80).optional(), dni: z.string().trim().max(20).optional() });
const envioSchema = z.object({ canal: z.enum(['mail', 'whatsapp']), destino: z.string().trim().min(5).max(160), manual: z.boolean().default(false) });

export default async function rutasRemitos(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('insumos.ver')];
  app.addContentTypeParser(['application/pdf', 'image/jpeg', 'image/png'], { parseAs: 'buffer', bodyLimit: MAX_BYTES + 1024 }, (req, body, done) => done(null, body));

  async function remitoVisible(req, reply, id) {
    const r = await db('remitos').where({ id }).whereNull('deleted_at').first();
    const visibles = r ? await clientesVisibles(db, req.ctx) : null;
    if (!r || (visibles !== null && !visibles.includes(r.cliente_id))) { error(reply, 404, 'no_encontrado'); return null; }
    return r;
  }
  const datosPdf = async (req, r) => {
    const c = await cargarRemitoCompleto(db, r, { conFirma: true });
    return { ...c, url: urlPublica(req, r.token), codigo: codigoVerificacion(r.token), conformidad: c.conformidad ? { ...c.conformidad, firmado_en: c.conformidad.firmado_en } : null };
  };

  // ---------- lista ----------
  app.get('/api/remitos', { preHandler: ver }, async (req) => {
    const f = z.object({ cliente: z.coerce.number().int().positive().optional(), estado: z.enum(['emitido', 'firmado', 'anulado']).optional(), q: z.string().trim().max(80).optional(),
      pagina: z.coerce.number().int().min(1).default(1), limite: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    const visibles = await clientesVisibles(db, req.ctx);
    const base = () => db('remitos as r').join('clientes as c', 'c.id', 'r.cliente_id').whereNull('r.deleted_at').modify((b) => { if (visibles !== null) b.whereIn('r.cliente_id', visibles.length ? visibles : [0]); if (f.cliente) b.where('r.cliente_id', f.cliente); });
    const q = base().modify((b) => {
      if (f.estado) b.where('r.estado', f.estado);
      if (f.q) b.where((w) => w.where('r.numero', 'like', `%${f.q}%`).orWhere('c.razon_social', 'like', `%${f.q}%`).orWhere('c.nombre_comercial', 'like', `%${f.q}%`));
    });
    const [{ total }] = await q.clone().count({ total: 'r.id' });
    const filas = await q.clone().orderBy([{ column: 'r.id', order: 'desc' }]).limit(f.limite).offset((f.pagina - 1) * f.limite)
      .select('r.id', 'r.numero', 'r.fecha', 'r.tipo', 'r.estado', 'r.ticket_id', 'c.id as cliente_id', 'c.razon_social', 'c.nombre_comercial');
    const ids = filas.map((x) => x.id);
    const [cant, conf, tk] = await Promise.all([
      ids.length ? db('remito_items').whereIn('remito_id', ids).groupBy('remito_id').select('remito_id').sum({ n: 'cantidad' }).count({ lineas: '*' }) : [],
      ids.length ? db('conformidades').where({ documento_tipo: 'remito' }).whereIn('documento_id', ids).select('documento_id', 'firmante_nombre', 'metodo', 'firmado_en') : [],
      db('tickets').whereIn('id', filas.map((x) => x.ticket_id).filter(Boolean)).select('id', 'numero'),
    ]);
    const porEstado = Object.fromEntries((await base().groupBy('r.estado').select('r.estado').count({ n: '*' })).map((x) => [x.estado, Number(x.n)]));
    return {
      total: Number(total), pagina: f.pagina, por_estado: porEstado,
      items: filas.map((r) => ({ id: r.id, numero: r.numero, fecha: String(r.fecha).slice(0, 10), tipo: r.tipo, estado: r.estado, cliente_id: r.cliente_id, cliente: r.nombre_comercial || r.razon_social,
        unidades: Number(cant.find((c) => c.remito_id === r.id)?.n ?? 0), ticket: tk.find((t) => t.id === r.ticket_id)?.numero ?? null,
        conformidad: (() => { const c = conf.find((x) => x.documento_id === r.id); return c ? { nombre: c.firmante_nombre, metodo: c.metodo, firmado_en: c.firmado_en } : null; })() })),
    };
  });

  /** Equipos que se pueden poner en un remito: los del depósito y los que ya están con ese cliente. */
  app.get('/api/remitos-ayuda/equipos', { preHandler: [auth, requerirPermiso('remitos.crear')] }, async (req, reply) => {
    const id = Number(req.query.cliente_id);
    const visibles = await clientesVisibles(db, req.ctx);
    if (!Number.isInteger(id) || (visibles !== null && !visibles.includes(id))) return error(reply, 404, 'no_encontrado');
    const filas = await db('equipos as e').join('modelos_equipo as m', 'm.id', 'e.modelo_id')
      .leftJoin('asignaciones_equipo as a', function () { this.on('a.equipo_id', 'e.id').andOnNull('a.hasta'); }).leftJoin('contratos as c', 'c.id', 'a.contrato_id')
      .whereNull('e.deleted_at').where((w) => w.where('e.estado', 'deposito').orWhere('c.cliente_id', id))
      .select('e.id', 'e.numero_serie', 'e.estado', 'm.marca', 'm.modelo', 'c.cliente_id as cliente_id').orderBy('e.numero_serie');
    return filas.map((e) => ({ id: e.id, numero_serie: e.numero_serie, descripcion: `${e.marca} ${e.modelo}`, ubicacion: e.cliente_id === id ? 'ya está con este cliente' : 'en depósito' }));
  });

  // ---------- crear ----------
  /** Entrega de equipos y/o insumos a un cliente, con baja de stock. Todo o nada. */
  app.post('/api/remitos/entrega', { preHandler: [auth, requerirPermiso('remitos.crear', 'insumos.mover')] }, async (req, reply) => {
    const parsed = nuevoSchema.safeParse(req.body);
    if (!parsed.success) return error(reply, 400, parsed.error.issues.some((i) => i.message === 'sin_items') ? 'sin_items' : 'validacion');
    const d = parsed.data;
    const visibles = await clientesVisibles(db, req.ctx);
    if (visibles !== null && !visibles.includes(d.cliente_id)) return error(reply, 404, 'no_encontrado');
    if (d.sede_id && !(await db('sedes').where({ id: d.sede_id, cliente_id: d.cliente_id }).first())) return error(reply, 400, 'sede_invalida');
    try {
      const out = await db.transaction(async (trx) => {
        const numero = await siguienteNumero(trx, 'remito');
        const [remito] = await trx('remitos').insert({ numero, token: nuevoToken(), cliente_id: d.cliente_id, sede_id: d.sede_id ?? null, tipo: d.equipos.length ? 'mixto' : 'entrega', fecha: hoy(), estado: 'emitido', observaciones: d.observaciones ?? null, created_by: req.ctx.id });
        for (const equipoId of [...new Set(d.equipos)]) {
          const e = await trx('equipos as e').join('modelos_equipo as m', 'm.id', 'e.modelo_id').where('e.id', equipoId).whereNull('e.deleted_at').select('e.id', 'e.estado', 'm.marca', 'm.modelo').first();
          const conCliente = e && await trx('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').where({ 'a.equipo_id': equipoId, 'c.cliente_id': d.cliente_id }).whereNull('a.hasta').first();
          if (!e || (e.estado !== 'deposito' && !conCliente)) throw Object.assign(new Error('x'), { codigo: 'equipo_invalido' });
          await trx('remito_items').insert({ remito_id: remito, equipo_id: equipoId, descripcion: `${e.marca} ${e.modelo}`, cantidad: 1 });
        }
        const juntos = new Map(); for (const it of d.items) juntos.set(it.insumo_id, (juntos.get(it.insumo_id) ?? 0) + it.cantidad);
        for (const [insumoId, cantidad] of juntos) {
          const ins = await trx('insumos').where({ id: insumoId }).whereNull('deleted_at').first();
          if (!ins) throw Object.assign(new Error('x'), { codigo: 'insumo_invalido' });
          if (((await stockDe(trx, [insumoId])).get(insumoId) ?? 0) < cantidad) throw Object.assign(new Error('x'), { codigo: 'sin_stock', insumo: ins.codigo });
          await trx('remito_items').insert({ remito_id: remito, insumo_id: insumoId, descripcion: ins.descripcion, cantidad });
          await trx('movimientos_insumo').insert({ insumo_id: insumoId, tipo: 'salida', cantidad, remito_id: remito, usuario_id: req.ctx.id, motivo: `Entrega remito ${numero}` });
        }
        await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'remitos', remito, null, { numero, cliente_id: d.cliente_id, equipos: d.equipos.length, insumos: d.items.length });
        const costo = d.items.length ? await costoDeRemito(trx, remito, req.ctx.id) : null;
        return { id: remito, numero, ...(puede(req.ctx, 'costos.ver') ? { costo_usd: costo?.usd ?? 0, insumos_sin_costo: costo?.sin_costo ?? [] } : {}) };
      });
      return reply.code(201).send(out);
    } catch (e) {
      if (e.codigo === 'sin_stock') return error(reply, 409, 'sin_stock', { insumo: e.insumo });
      if (e.codigo === 'insumo_invalido' || e.codigo === 'equipo_invalido') return error(reply, 400, e.codigo);
      throw e;
    }
  });

  // ---------- ver ----------
  app.get('/api/remitos/:id', { preHandler: ver }, async (req, reply) => {
    const r = await remitoVisible(req, reply, Number(req.params.id)); if (!r) return;
    const c = await cargarRemitoCompleto(db, r);
    const [envios, contactos] = await Promise.all([
      db('remito_envios as e').leftJoin('usuarios as u', 'u.id', 'e.usuario_id').where('e.remito_id', r.id).orderBy('e.id', 'desc').select('e.canal', 'e.destino', 'e.resultado', 'e.detalle', 'e.created_at', 'u.nombre as usuario'),
      contactosDe(db, r.cliente_id),
    ]);
    const { token, ...resto } = c;
    return { ...resto, encuesta: await leerEncuesta(db, r.id), conformidad: c.conformidad ? { ...c.conformidad, firma: undefined } : null, url_publica: urlPublica(req, token), codigo: codigoVerificacion(token), envios, contactos,
      canales: { mail: canales.mail.configurado(), whatsapp: canales.whatsapp.configurado() }, puede_firmar: puede(req.ctx, 'remitos.crear') && r.estado === 'emitido',
      emisor: 'JustPrint · CUIT 30-71646173-0', whatsapp_soporte: config.whatsappSoporte };
  });

  app.get('/api/remitos/:id/pdf', { preHandler: ver }, async (req, reply) => {
    const r = await remitoVisible(req, reply, Number(req.params.id)); if (!r) return;
    const pdf = await generarRemitoPdf(await datosPdf(req, r));
    return reply.type('application/pdf').header('Content-Disposition', `${req.query.descargar ? 'attachment' : 'inline'}; filename="Remito ${r.numero}.pdf"`).header('Cache-Control', 'private, no-store').send(pdf);
  });

  app.get('/api/remitos/:id/firma.png', { preHandler: ver }, async (req, reply) => {
    const r = await remitoVisible(req, reply, Number(req.params.id)); if (!r) return;
    const c = await db('conformidades').where({ documento_tipo: 'remito', documento_id: r.id }).first();
    const f = c ? await db('conformidad_firmas').where({ conformidad_id: c.id }).first() : null;
    if (!f) return error(reply, 404, 'no_encontrado');
    return reply.type('image/png').header('Cache-Control', 'private, max-age=3600').send(Buffer.from(f.png));
  });

  app.get('/api/remitos/:id/escaneo', { preHandler: ver }, async (req, reply) => {
    const r = await remitoVisible(req, reply, Number(req.params.id)); if (!r) return;
    const e = await db('remito_escaneos').where({ remito_id: r.id }).orderBy('id', 'desc').first();
    const c = e ? await db('remito_escaneos_contenido').where({ escaneo_id: e.id }).first() : null;
    if (!c) return error(reply, 404, 'no_encontrado');
    const ext = e.mime === 'application/pdf' ? 'pdf' : e.mime === 'image/png' ? 'png' : 'jpg';
    return reply.type(e.mime).header('Content-Disposition', `${req.query.descargar ? 'attachment' : 'inline'}; filename="Remito ${r.numero} firmado.${ext}"`).header('Cache-Control', 'private, no-store').send(Buffer.from(c.contenido));
  });

  // ---------- conformidad ----------
  const firmable = async (req, reply) => {
    const r = await remitoVisible(req, reply, Number(req.params.id)); if (!r) return null;
    if (r.estado === 'firmado') { error(reply, 409, 'ya_firmado'); return null; }
    if (r.estado === 'anulado') { error(reply, 409, 'remito_anulado'); return null; }
    return r;
  };
  /** Cierra el ticket si el remito era el de un servicio que quedó esperando la conformidad. */
  async function cerrarTicketSiCorresponde(trx, r, nombre, ctx) {
    if (!r.ticket_id) return;
    const t = await trx('tickets').where({ id: r.ticket_id }).first();
    if (!t || t.estado !== 'resuelto') return;
    const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await trx('tickets').where({ id: t.id }).update({ estado: 'cerrado', cerrado_en: ahora, updated_by: ctx.id, updated_at: ahora });
    await trx('ticket_eventos').insert({ ticket_id: t.id, usuario_id: ctx.id, tipo: 'estado', estado_anterior: 'resuelto', estado_nuevo: 'cerrado', comentario: `Cerrado con conformidad de ${nombre}` });
  }

  /** Firma en pantalla (el ERP abierto en el celular, con el cliente firmando con el dedo). */
  app.post('/api/remitos/:id/conformidad', { preHandler: [auth, requerirPermiso('remitos.crear')] }, async (req, reply) => {
    const d = conformidadSchema.parse(req.body);
    const firma = parseFirma(d.firma); if (!firma) return error(reply, 400, 'firma_invalida');
    const r = await firmable(req, reply); if (!r) return;
    await db.transaction(async (trx) => {
      await guardarConformidad(trx, r.id, { ...d, firma, metodo: 'digital' }, { ip: req.ip, userAgent: req.headers['user-agent'], id: req.ctx.id });
      await cerrarTicketSiCorresponde(trx, r, d.nombre, req.ctx);
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'remitos', r.id, { estado: r.estado }, { estado: 'firmado', conformidad: d.nombre });
    });
    return reply.code(201).send({ ok: true, ...(await enviarAutomatico(req, r, d)) });
  });

  /** Remito impreso, firmado a mano con lapicera y escaneado o fotografiado. */
  app.post('/api/remitos/:id/escaneo', { preHandler: [auth, requerirPermiso('remitos.crear')], bodyLimit: MAX_BYTES + 1024 }, async (req, reply) => {
    const q = escaneoQuery.parse(req.query ?? {});
    const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim();
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 8 || !MIME_ESCANEO[tipo]) return error(reply, 400, 'archivo_invalido');
    if (buf.length > MAX_BYTES) return error(reply, 413, 'archivo_muy_grande');
    if (!MIME_ESCANEO[tipo](buf)) return error(reply, 400, 'archivo_invalido');
    const r = await firmable(req, reply); if (!r) return;
    let nombre = null; try { nombre = req.headers['x-nombre-archivo'] ? decodeURIComponent(String(req.headers['x-nombre-archivo'])).slice(0, 255) : null; } catch { nombre = null; }
    await db.transaction(async (trx) => {
      const [e] = await trx('remito_escaneos').insert({ remito_id: r.id, mime: tipo, nombre_original: nombre, bytes: buf.length, subido_por: req.ctx.id });
      await trx('remito_escaneos_contenido').insert({ escaneo_id: e, contenido: buf });
      await guardarConformidad(trx, r.id, { nombre: q.nombre, cargo: q.cargo, dni: q.dni, metodo: 'papel' }, { ip: req.ip, userAgent: req.headers['user-agent'], id: req.ctx.id });
      await cerrarTicketSiCorresponde(trx, r, q.nombre, req.ctx);
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'remitos', r.id, { estado: r.estado }, { estado: 'firmado', metodo: 'papel', conformidad: q.nombre, bytes: buf.length });
    });
    return reply.code(201).send({ ok: true });
  });

  // ---------- envío al cliente ----------
  const textoEnvio = (r, url) => `Hola! Te acercamos el remito N° ${r.numero} de JustPrint con el detalle de lo entregado. Podés verlo, descargarlo y contarnos cómo fue la atención (son 10 segundos) acá: ${url}`;
  async function enviar(req, r, canal, destino) {
    const url = urlPublica(req, r.token);
    if (canal === 'mail') {
      const pdf = await generarRemitoPdf(await datosPdf(req, r));
      await canales.mail.enviar({ to: destino, subject: `Remito ${r.numero} · JustPrint`, text: `${textoEnvio(r, url)}\n\nAdjuntamos también el PDF.\n\nJustPrint · soporte@justprint.com.ar`, attachments: [{ filename: `Remito ${r.numero}.pdf`, content: pdf, contentType: 'application/pdf' }] });
    } else {
      const tel = telefonoAR(destino); if (!tel) throw Object.assign(new Error('telefono'), { codigo: 'telefono_invalido' });
      await canales.whatsapp.enviar({ to: tel, text: textoEnvio(r, url) });
    }
  }
  const registrarEnvio = (r, canal, destino, resultado, detalle, ctx) => db('remito_envios').insert({ remito_id: r.id, canal, destino, resultado, detalle: detalle ? String(detalle).slice(0, 255) : null, usuario_id: ctx?.id ?? null });

  /** Después de firmar: si el cliente dejó mail o celular y el canal está configurado, se manda solo. */
  async function enviarAutomatico(req, r, d) {
    const hecho = { mail: false, whatsapp: false };
    for (const [canal, destino] of [['mail', d.email], ['whatsapp', d.telefono]]) {
      if (!destino || !canales[canal].configurado()) continue;
      try { await enviar(req, r, canal, destino); hecho[canal] = true; await registrarEnvio(r, canal, destino, 'enviado', 'Al firmar', req.ctx); }
      catch (e) { await registrarEnvio(r, canal, destino, 'error', e.message, req.ctx); }
    }
    return { enviado: hecho };
  }

  app.post('/api/remitos/:id/enviar', { preHandler: [auth, requerirPermiso('remitos.crear')] }, async (req, reply) => {
    const d = envioSchema.parse(req.body);
    const r = await remitoVisible(req, reply, Number(req.params.id)); if (!r) return;
    if (d.manual) { await registrarEnvio(r, d.canal, d.destino, 'manual', 'Abierto desde el celular o la computadora del usuario', req.ctx); return { ok: true }; }
    if (!canales[d.canal].configurado()) return error(reply, 409, `${d.canal}_no_configurado`);
    if (d.canal === 'mail' && !z.string().email().safeParse(d.destino).success) return error(reply, 400, 'mail_invalido');
    try { await enviar(req, r, d.canal, d.destino); } catch (e) {
      await registrarEnvio(r, d.canal, d.destino, 'error', e.message, req.ctx);
      return error(reply, e.codigo === 'telefono_invalido' ? 400 : 502, e.codigo ?? 'envio_fallido');
    }
    await registrarEnvio(r, d.canal, d.destino, 'enviado', null, req.ctx);
    return { ok: true };
  });

  // ---------- página pública del remito (sin sesión: se entra con el enlace) ----------
  const porToken = async (token) => (/^[a-f0-9]{32}$/.test(token) ? db('remitos').where({ token }).whereNull('deleted_at').first() : null);
  app.get('/r/:token', async (req, reply) => {
    const r = await porToken(req.params.token);
    if (!r) return reply.code(404).type('text/html; charset=utf-8').header('X-Robots-Tag', 'noindex').send(paginaPublicaRemito(null));
    const c = await cargarRemitoCompleto(db, r);
    return reply.type('text/html; charset=utf-8').header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store').send(paginaPublicaRemito(c, { codigo: codigoVerificacion(r.token), encuesta: await leerEncuesta(db, r.id) }));
  });
  app.get('/r/:token/pdf', async (req, reply) => {
    const r = await porToken(req.params.token); if (!r) return reply.code(404).send('No encontrado');
    const pdf = await generarRemitoPdf(await datosPdf(req, r));
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="Remito ${r.numero}.pdf"`).header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store').send(pdf);
  });
  app.get('/r/:token/firma.png', async (req, reply) => {
    const r = await porToken(req.params.token); if (!r) return reply.code(404).send('No encontrado');
    const c = await db('conformidades').where({ documento_tipo: 'remito', documento_id: r.id }).first();
    const f = c ? await db('conformidad_firmas').where({ conformidad_id: c.id }).first() : null;
    if (!f) return reply.code(404).send('No encontrado');
    return reply.type('image/png').header('Cache-Control', 'no-store').send(Buffer.from(f.png));
  });
}
