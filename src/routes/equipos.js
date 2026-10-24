import QRCode from 'qrcode';
import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles, esArea, puede } from '../lib/contexto.js';
import { AREA } from '../lib/catalogo.js';
import { hoy } from '../lib/fechas.js';
import { validarLectura } from '../lib/contadores.js';
import { config } from '../config.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const error = (reply, code, e, extra = {}) => reply.code(code).send({ error: e, ...extra });

const listaSchema = z.object({
  estado: z.enum(['deposito', 'instalado', 'reparacion', 'baja']).optional(),
  q: z.string().trim().max(80).optional(),
  cliente: z.coerce.number().int().positive().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
});

const nuevoSchema = z.object({
  modelo_id: z.number().int().positive(),
  numero_serie: z.string().trim().min(3).max(80),
  fecha_adquisicion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  observaciones: z.string().max(2000).optional(),
});

const moverSchema = z.discriminatedUnion('accion', [
  z.object({
    accion: z.literal('instalar'), contrato_id: z.number().int().positive(), sede_id: z.number().int().positive().optional(),
    contador_negro: z.number().int().min(0), contador_color: z.number().int().min(0).optional(), motivo: z.string().max(255).optional(),
  }),
  z.object({
    accion: z.literal('retirar'), destino: z.enum(['deposito', 'reparacion']),
    contador_negro: z.number().int().min(0), contador_color: z.number().int().min(0).optional(), motivo: z.string().max(255).optional(),
  }),
  z.object({ accion: z.literal('baja'), motivo: z.string().trim().min(3).max(255) }),
]);

export default async function rutasEquipos(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('equipos.ver')];

  /** Un equipo instalado se ve por su cliente; el técnico ve todos (en la calle tiene que poder escanear cualquiera). */
  async function filtroVisible(ctx) {
    if (ctx.areas.some((a) => a.alcance === 'todo') || esArea(ctx, AREA.TECNICA)) return null;
    return (await clientesVisibles(db, ctx)) ?? [];
  }

  const baseEquipos = () => db('equipos').join('modelos_equipo as m', 'm.id', 'equipos.modelo_id')
    .leftJoin('asignaciones_equipo as a', function () { this.on('a.equipo_id', 'equipos.id').andOnNull('a.hasta'); })
    .leftJoin('contratos as c', 'c.id', 'a.contrato_id').leftJoin('clientes as cl', 'cl.id', 'c.cliente_id')
    .leftJoin('sedes as s', 's.id', 'a.sede_id').leftJoin('ubicaciones as u', 'u.id', 'equipos.ubicacion_id')
    .whereNull('equipos.deleted_at');

  app.get('/api/equipos', { preHandler: ver }, async (req) => {
    const f = listaSchema.parse(req.query);
    const visibles = await filtroVisible(req.ctx);
    const q = baseEquipos();
    if (visibles) q.whereIn('cl.id', visibles.length ? visibles : [0]);
    if (f.estado) q.where('equipos.estado', f.estado);
    if (f.cliente) q.where('cl.id', f.cliente);
    if (f.q) q.where((w) => w.where('equipos.numero_serie', 'like', `%${f.q}%`).orWhere('m.modelo', 'like', `%${f.q}%`).orWhere('cl.razon_social', 'like', `%${f.q}%`).orWhere('cl.nombre_comercial', 'like', `%${f.q}%`));
    const [{ total }] = await q.clone().count({ total: 'equipos.id' });
    const filas = await q.clone().orderBy('equipos.numero_serie').limit(25).offset((f.pagina - 1) * 25)
      .select('equipos.id', 'equipos.numero_serie', 'equipos.estado', 'equipos.codigo_qr', 'm.marca', 'm.modelo', 'm.tipo',
        'cl.id as cliente_id', 'cl.razon_social', 'cl.nombre_comercial', 's.nombre as sede', 'u.nombre as ubicacion');
    const ids = filas.map((x) => x.id);
    const lecturas = ids.length ? await db('lecturas_contador').whereIn('equipo_id', ids).orderBy('fecha', 'desc').orderBy('id', 'desc').select('equipo_id', 'fecha', 'contador_negro', 'contador_color') : [];
    const ultima = new Map(); for (const l of lecturas) if (!ultima.has(l.equipo_id)) ultima.set(l.equipo_id, l);
    const porEstado = Object.fromEntries((await baseEquipos().modify((b) => { if (visibles) b.whereIn('cl.id', visibles.length ? visibles : [0]); }).groupBy('equipos.estado').select('equipos.estado').count({ n: '*' })).map((x) => [x.estado, Number(x.n)]));
    return { total: Number(total), pagina: f.pagina, por_estado: porEstado, items: filas.map((e) => ({ ...e, ultima_lectura: ultima.get(e.id) ?? null })) };
  });

  async function cargarEquipo(ctx, where) {
    const visibles = await filtroVisible(ctx);
    const q = baseEquipos().where(where);
    if (visibles) q.whereIn('cl.id', visibles.length ? visibles : [0]);
    return q.select('equipos.*', 'm.marca', 'm.modelo', 'm.tipo', 'cl.id as cliente_id', 'cl.razon_social', 'cl.nombre_comercial',
      'c.id as contrato_id', 'c.nombre as contrato', 's.nombre as sede', 'u.nombre as ubicacion').first();
  }

  // Busca por código interno o por número de serie (lo que trae el QR de la etiqueta: el serie va en el texto de WhatsApp).
  app.get('/api/equipos/qr/:codigo', { preHandler: ver }, async (req, reply) => {
    const codigo = String(req.params.codigo).trim();
    const e = (await cargarEquipo(req.ctx, { 'equipos.codigo_qr': codigo })) ?? (await cargarEquipo(req.ctx, { 'equipos.numero_serie': codigo }));
    if (!e) return error(reply, 404, 'no_encontrado');
    return { id: e.id };
  });

  app.get('/api/equipos/:id', { preHandler: ver }, async (req, reply) => {
    const e = await cargarEquipo(req.ctx, { 'equipos.id': Number(req.params.id) });
    if (!e) return error(reply, 404, 'no_encontrado');
    const [asignaciones, lecturas, tickets, movimientos] = await Promise.all([
      db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').join('clientes as cl', 'cl.id', 'c.cliente_id').leftJoin('sedes as s', 's.id', 'a.sede_id')
        .where('a.equipo_id', e.id).orderBy('a.desde', 'desc').select('a.desde', 'a.hasta', 'a.contador_inicial_negro', 'a.contador_inicial_color', 'a.contador_final_negro', 'a.contador_final_color', 'cl.razon_social', 'cl.nombre_comercial', 's.nombre as sede'),
      db('lecturas_contador').leftJoin('usuarios', 'usuarios.id', 'lecturas_contador.usuario_id').where({ equipo_id: e.id }).orderBy('fecha', 'desc').orderBy('lecturas_contador.id', 'desc').limit(24)
        .select('lecturas_contador.fecha', 'contador_negro', 'contador_color', 'origen', 'usuarios.nombre as usuario'),
      db('tickets').where({ equipo_id: e.id }).whereNull('deleted_at').orderBy('abierto_en', 'desc').limit(20).select('id', 'numero', 'asunto', 'estado', 'abierto_en'),
      db('movimientos_equipo').leftJoin('ubicaciones as o', 'o.id', 'movimientos_equipo.ubicacion_origen_id').leftJoin('ubicaciones as d', 'd.id', 'movimientos_equipo.ubicacion_destino_id')
        .leftJoin('usuarios', 'usuarios.id', 'movimientos_equipo.usuario_id').where({ equipo_id: e.id }).orderBy('movimientos_equipo.id', 'desc').limit(30)
        .select('movimientos_equipo.fecha', 'movimientos_equipo.motivo', 'o.nombre as origen', 'd.nombre as destino', 'usuarios.nombre as usuario'),
    ]);
    // Páginas del período = diferencia entre las dos últimas lecturas (si hay).
    const [l1, l0] = lecturas;
    const periodo = l1 && l0 ? { negro: l1.contador_negro - l0.contador_negro, color: l1.contador_color - l0.contador_color, desde: l0.fecha, hasta: l1.fecha } : null;
    const { password_hash, ...resto } = e;
    return { ...resto, asignaciones, lecturas, tickets, movimientos, periodo, puede_editar: puede(req.ctx, 'equipos.editar') };
  });

  // QR de la etiqueta autoadhesiva del equipo: abre WhatsApp de soporte con el texto y el número de serie ya cargados.
  app.get('/api/equipos/:id/qr.svg', { preHandler: ver }, async (req, reply) => {
    const e = await cargarEquipo(req.ctx, { 'equipos.id': Number(req.params.id) });
    if (!e) return error(reply, 404, 'no_encontrado');
    const mensaje = `Hola, soy usuario de un equipo JustPrint y necesito soporte técnico.\nN° de Serie: ${e.numero_serie}\nModelo: ${e.marca} ${e.modelo}`;
    const url = `https://wa.me/${config.whatsappSoporte}?text=${encodeURIComponent(mensaje)}`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    return reply.type('image/svg+xml').header('Cache-Control', 'private, max-age=3600').send(svg);
  });

  app.get('/api/modelos', { preHandler: ver }, async () => db('modelos_equipo').orderBy(['marca', 'modelo']).select('id', 'marca', 'modelo', 'tipo'));

  app.post('/api/modelos', { preHandler: [auth, requerirPermiso('equipos.editar')] }, async (req, reply) => {
    const d = z.object({ marca: z.string().trim().min(2).max(60), modelo: z.string().trim().min(1).max(80), tipo: z.enum(['monocromo', 'color']) }).parse(req.body);
    if (await db('modelos_equipo').where({ marca: d.marca, modelo: d.modelo }).first()) return error(reply, 409, 'ya_existe');
    const [id] = await db('modelos_equipo').insert(d);
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'modelos_equipo', id, null, d);
    return reply.code(201).send({ id });
  });

  app.post('/api/equipos', { preHandler: [auth, requerirPermiso('equipos.editar')] }, async (req, reply) => {
    const d = nuevoSchema.parse(req.body);
    if (!(await db('modelos_equipo').where({ id: d.modelo_id }).first())) return error(reply, 400, 'modelo_invalido');
    if (await db('equipos').where({ numero_serie: d.numero_serie }).first()) return error(reply, 409, 'serie_repetida');
    const id = await db.transaction(async (trx) => {
      const [nuevo] = await trx('equipos').insert({ ...d, codigo_qr: `JP-${d.numero_serie.toUpperCase().replace(/[^A-Z0-9]/g, '')}`, estado: 'deposito', created_by: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'equipos', nuevo, null, d);
      return nuevo;
    });
    return reply.code(201).send({ id });
  });

  /** Lectura de contadores fuera de un cierre de ticket (la toma el técnico en una visita o se carga a mano). */
  app.post('/api/equipos/:id/lecturas', { preHandler: auth }, async (req, reply) => {
    if (!puede(req.ctx, 'equipos.editar') && !puede(req.ctx, 'tickets.atender')) return error(reply, 403, 'sin_permiso');
    const d = z.object({ contador_negro: z.number().int().min(0), contador_color: z.number().int().min(0).optional(), observaciones: z.string().max(500).optional() }).parse(req.body);
    const e = await cargarEquipo(req.ctx, { 'equipos.id': Number(req.params.id) });
    if (!e) return error(reply, 404, 'no_encontrado');
    const problema = await validarLectura(db, e.id, e.tipo, d.contador_negro, d.contador_color);
    if (problema) return error(reply, problema.error === 'contador_menor_al_anterior' ? 409 : 400, problema.error, problema.anterior ? { anterior: problema.anterior } : {});
    const [id] = await db('lecturas_contador').insert({ equipo_id: e.id, fecha: hoy(), contador_negro: d.contador_negro, contador_color: d.contador_color ?? 0, origen: 'tecnico', usuario_id: req.ctx.id, observaciones: d.observaciones ?? null });
    return reply.code(201).send({ id });
  });

  /** Instalar en un cliente, retirar al depósito o al taller, o dar de baja. Cada paso queda en el historial del equipo. */
  app.post('/api/equipos/:id/mover', { preHandler: [auth, requerirPermiso('equipos.editar')] }, async (req, reply) => {
    const d = moverSchema.parse(req.body);
    const e = await cargarEquipo(req.ctx, { 'equipos.id': Number(req.params.id) });
    if (!e) return error(reply, 404, 'no_encontrado');
    if (e.estado === 'baja') return error(reply, 409, 'equipo_de_baja');
    const ubic = async (trx, tipo) => (await trx('ubicaciones').where({ tipo }).first()) ?? (await trx('ubicaciones').insert({ nombre: tipo === 'deposito' ? 'Depósito' : 'Taller', tipo }).then(([id]) => ({ id })));
    const abierta = await db('asignaciones_equipo').where({ equipo_id: e.id }).whereNull('hasta').first();

    if (d.accion === 'instalar') {
      if (abierta) return error(reply, 409, 'ya_instalado');
      const contrato = await db('contratos').where({ id: d.contrato_id }).whereNull('deleted_at').first();
      const visibles = await clientesVisibles(db, req.ctx);
      if (!contrato || (visibles !== null && !visibles.includes(contrato.cliente_id))) return error(reply, 404, 'no_encontrado');
      if (d.sede_id && !(await db('sedes').where({ id: d.sede_id, cliente_id: contrato.cliente_id }).first())) return error(reply, 400, 'sede_invalida');
      const problema = await validarLectura(db, e.id, e.tipo, d.contador_negro, d.contador_color);
      if (problema) return error(reply, problema.error === 'contador_menor_al_anterior' ? 409 : 400, problema.error, problema.anterior ? { anterior: problema.anterior } : {});
      await db.transaction(async (trx) => {
        await trx('asignaciones_equipo').insert({ equipo_id: e.id, contrato_id: contrato.id, sede_id: d.sede_id ?? null, desde: hoy(), contador_inicial_negro: d.contador_negro, contador_inicial_color: d.contador_color ?? 0 });
        await trx('lecturas_contador').insert({ equipo_id: e.id, fecha: hoy(), contador_negro: d.contador_negro, contador_color: d.contador_color ?? 0, origen: 'tecnico', usuario_id: req.ctx.id, observaciones: 'Lectura de instalación' });
        await trx('movimientos_equipo').insert({ equipo_id: e.id, ubicacion_origen_id: e.ubicacion_id, ubicacion_destino_id: null, motivo: d.motivo ?? 'Instalación en cliente', usuario_id: req.ctx.id });
        await trx('equipos').where({ id: e.id }).update({ estado: 'instalado', ubicacion_id: null, updated_by: req.ctx.id, updated_at: trx.fn.now() });
        await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'equipos', e.id, { estado: e.estado }, { estado: 'instalado', contrato_id: contrato.id });
      });
    } else if (d.accion === 'retirar') {
      if (!abierta) return error(reply, 409, 'no_esta_instalado');
      const problema = await validarLectura(db, e.id, e.tipo, d.contador_negro, d.contador_color);
      if (problema) return error(reply, problema.error === 'contador_menor_al_anterior' ? 409 : 400, problema.error, problema.anterior ? { anterior: problema.anterior } : {});
      await db.transaction(async (trx) => {
        const destino = await ubic(trx, d.destino === 'deposito' ? 'deposito' : 'taller');
        await trx('asignaciones_equipo').where({ id: abierta.id }).update({ hasta: hoy(), contador_final_negro: d.contador_negro, contador_final_color: d.contador_color ?? 0 });
        await trx('lecturas_contador').insert({ equipo_id: e.id, fecha: hoy(), contador_negro: d.contador_negro, contador_color: d.contador_color ?? 0, origen: 'tecnico', usuario_id: req.ctx.id, observaciones: 'Lectura de retiro' });
        await trx('movimientos_equipo').insert({ equipo_id: e.id, ubicacion_origen_id: null, ubicacion_destino_id: destino.id, motivo: d.motivo ?? 'Retiro del cliente', usuario_id: req.ctx.id });
        await trx('equipos').where({ id: e.id }).update({ estado: d.destino === 'deposito' ? 'deposito' : 'reparacion', ubicacion_id: destino.id, updated_by: req.ctx.id, updated_at: trx.fn.now() });
        await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'equipos', e.id, { estado: e.estado }, { estado: d.destino });
      });
    } else {
      if (abierta) return error(reply, 409, 'retirar_primero');
      await db.transaction(async (trx) => {
        await trx('equipos').where({ id: e.id }).update({ estado: 'baja', updated_by: req.ctx.id, updated_at: trx.fn.now() });
        await trx('movimientos_equipo').insert({ equipo_id: e.id, motivo: `Baja: ${d.motivo}`, usuario_id: req.ctx.id });
        await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'equipos', e.id, { estado: e.estado }, { estado: 'baja', motivo: d.motivo });
      });
    }
    return { ok: true };
  });

  // Para armar el formulario de instalación: contratos vigentes de clientes visibles.
  app.get('/api/equipos-ayuda/contratos', { preHandler: [auth, requerirPermiso('equipos.editar')] }, async (req) => {
    const visibles = await clientesVisibles(db, req.ctx);
    const q = db('contratos as c').join('clientes as cl', 'cl.id', 'c.cliente_id').whereNull('c.deleted_at').where('c.estado', 'vigente').orderBy('cl.razon_social')
      .select('c.id', 'c.nombre', 'cl.id as cliente_id', 'cl.razon_social', 'cl.nombre_comercial');
    if (visibles) q.whereIn('cl.id', visibles.length ? visibles : [0]);
    const filas = await q;
    const sedes = filas.length ? await db('sedes').whereIn('cliente_id', [...new Set(filas.map((f) => f.cliente_id))]).select('id', 'cliente_id', 'nombre') : [];
    return filas.map((f) => ({ ...f, sedes: sedes.filter((s) => s.cliente_id === f.cliente_id) }));
  });
}
