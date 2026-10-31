import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles, esArea, puede, puedeVerCliente } from '../lib/contexto.js';
import { AREA } from '../lib/catalogo.js';
import { aDia, hoy, json } from '../lib/fechas.js';
import { abonosUsd } from '../lib/abonos.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';
import { normalizarCuit } from '../lib/cuit.js';
import { aFila, armarContacto, contactoSchema, datosDeNacimiento, validarContacto } from '../lib/contactos.js';

const CAMPOS_EDITABLES = ['razon_social', 'nombre_comercial', 'cuit', 'condicion_iva', 'rubro', 'rubro_id', 'subrubro_id', 'tamano', 'estado', 'origen', 'notas', 'sitio_web', 'telefono', 'email_general',
  'domicilio_fiscal', 'localidad_fiscal', 'provincia', 'cantidad_empleados', 'motivo_baja', 'fecha_baja'];
const texto = (n) => z.string().trim().max(n).optional().nullable();

const clienteSchema = z.object({
  razon_social: z.string().trim().min(2).max(160),
  nombre_comercial: z.string().trim().max(160).optional(),
  cuit: z.string().trim().max(13).optional().nullable().or(z.literal('').transform(() => null)),
  condicion_iva: z.enum(['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final']).optional(),
  rubro: z.string().trim().max(80).optional(),
  rubro_id: z.number().int().positive().optional().nullable(),
  subrubro_id: z.number().int().positive().optional().nullable(),
  tamano: z.string().trim().max(40).optional(),
  sitio_web: texto(160), telefono: texto(40), email_general: z.string().trim().toLowerCase().email().max(160).optional().nullable().or(z.literal('').transform(() => null)),
  domicilio_fiscal: texto(200), localidad_fiscal: texto(100), provincia: texto(60), cantidad_empleados: z.number().int().min(0).max(1000000).optional().nullable(),
  motivo_baja: texto(255), fecha_baja: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  estado: z.enum(['prospecto', 'activo', 'inactivo']).optional(),
  origen: z.string().trim().max(60).optional(),
  notas: z.string().max(4000).optional(),
});

const altaSchema = clienteSchema.extend({
  sede: z.object({ nombre: z.string().trim().min(1).max(120).default('Sede principal'), domicilio: texto(200), localidad: texto(100), zona: z.enum(['caba', 'resto']).default('caba'), indicaciones: texto(1000) }).optional(),
  contactos: z.array(contactoSchema).max(20).default([]),
  responsable_id: z.number().int().positive().optional().nullable(),
});

const listaSchema = z.object({
  estado: z.enum(['prospecto', 'activo', 'inactivo']).optional(),
  rubro_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(80).optional(),
  responsable: z.coerce.number().int().positive().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});

export default async function rutasClientes(app, { db }) {
  const auth = requerirSesion(db);

  app.get('/api/clientes', { preHandler: [auth, requerirPermiso('clientes.ver')] }, async (req) => {
    const f = listaSchema.parse(req.query);
    const visibles = await clientesVisibles(db, req.ctx);

    const base = db('clientes')
      .leftJoin('cartera_asignaciones as ca', function () { this.on('ca.cliente_id', 'clientes.id').andOnNull('ca.hasta'); })
      .leftJoin('usuarios as r', 'r.id', 'ca.usuario_id')
      .whereNull('clientes.deleted_at');
    if (visibles !== null) base.whereIn('clientes.id', visibles);
    if (f.estado) base.where('clientes.estado', f.estado);
    if (f.responsable) base.where('ca.usuario_id', f.responsable);
    if (f.rubro_id) base.where((q) => q.where('clientes.rubro_id', f.rubro_id).orWhere('clientes.subrubro_id', f.rubro_id));
    if (f.q) base.where((q) => q.where('clientes.razon_social', 'like', `%${f.q}%`).orWhere('clientes.nombre_comercial', 'like', `%${f.q}%`));

    const [{ total }] = await base.clone().count({ total: 'clientes.id' });
    const filas = await base.clone()
      .select('clientes.id', 'clientes.razon_social', 'clientes.nombre_comercial', 'clientes.estado', 'clientes.rubro', 'clientes.fecha_alta',
        'r.id as responsable_id', 'r.nombre as responsable')
      .orderBy('clientes.razon_social').limit(f.limite).offset((f.pagina - 1) * f.limite);

    if (puede(req.ctx, 'importes.ver')) {
      const { porCliente } = await abonosUsd(db, { clienteIds: filas.map((x) => x.id) });
      filas.forEach((x) => { x.abono_mensual_usd = porCliente[x.id]?.abono ?? 0; x.abono_no_facturable_usd = porCliente[x.id]?.noFacturable ?? 0; });
    }
    return { total: Number(total), pagina: f.pagina, limite: f.limite, clientes: filas };
  });

  app.get('/api/clientes/:id', { preHandler: [auth, requerirPermiso('clientes.ver')] }, async (req, reply) => {
    const id = Number(req.params.id);
    // Si no lo puede ver, responde 404 igual que si no existiera: no se filtra qué cuentas hay.
    if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id))) return reply.code(404).send({ error: 'no_encontrado' });
    const cliente = await db('clientes').where({ id }).whereNull('deleted_at').first();
    if (!cliente) return reply.code(404).send({ error: 'no_encontrado' });

    const rn = cliente.rubro_id || cliente.subrubro_id ? await db('rubros').whereIn('id', [cliente.rubro_id, cliente.subrubro_id].filter(Boolean)).select('id', 'nombre') : [];
    cliente.rubro_nombre = rn.find((r) => r.id === cliente.rubro_id)?.nombre ?? cliente.rubro ?? null;
    cliente.subrubro_nombre = rn.find((r) => r.id === cliente.subrubro_id)?.nombre ?? null;
    const sedes = await db('sedes').where({ cliente_id: id }).whereNull('deleted_at').orderBy([{ column: 'es_principal', order: 'desc' }, 'id']);
    // Equipos instalados hoy y contratos vigentes de cada local: el resumen que se ve al entrar al cliente.
    const instalados = await db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').where('c.cliente_id', id).whereNull('a.hasta').select('a.sede_id', 'a.contrato_id');
    const vigentes = await db('contratos').where({ cliente_id: id, estado: 'vigente' }).whereNull('deleted_at').select('id', 'sede_id');
    const salida = { cliente, sedes: sedes.map((x) => ({ ...x, es_principal: !!x.es_principal, equipos: instalados.filter((i) => i.sede_id === x.id).length, contratos: new Set([...instalados.filter((i) => i.sede_id === x.id).map((i) => i.contrato_id), ...vigentes.filter((v) => v.sede_id === x.id).map((v) => v.id)]).size })),
      resumen: { sedes: sedes.length, contratos_vigentes: vigentes.length, equipos_instalados: instalados.length } };

    const resp = await db('cartera_asignaciones as ca').join('usuarios as u', 'u.id', 'ca.usuario_id')
      .where('ca.cliente_id', id).whereNull('ca.hasta').select('u.id', 'u.nombre', 'ca.desde').first();
    salida.responsable = resp ?? null;

    if (puede(req.ctx, 'contactos.ver')) {
      const contactos = await db('contactos').where({ cliente_id: id }).whereNull('deleted_at');
      salida.contactos = contactos.map(armarContacto);
    }

    if (puede(req.ctx, 'contratos.ver')) {
      const contratos = await db('contratos').where({ cliente_id: id }).whereNull('deleted_at');
      if (puede(req.ctx, 'importes.ver') && contratos.length) {
        const conds = await db('contrato_condiciones').whereIn('contrato_id', contratos.map((c) => c.id)).orderBy('vigente_desde', 'desc');
        contratos.forEach((c) => { c.condiciones = conds.filter((x) => x.contrato_id === c.id); });
      }
      salida.contratos = contratos;
    }
    return salida;
  });

  /** Rubro y subrubro tienen que existir, estar activos y el subrubro ser hijo del rubro. Devuelve el código de error o el nombre del rubro. */
  async function revisarRubros(trx, rubroId, subId) {
    if (!rubroId && !subId) return { nombre: null };
    if (subId && !rubroId) return { error: 'subrubro_sin_rubro' };
    const r = await trx('rubros').where({ id: rubroId, activo: true }).whereNull('parent_id').first();
    if (!r) return { error: 'rubro_invalido' };
    if (subId && !(await trx('rubros').where({ id: subId, parent_id: rubroId, activo: true }).first())) return { error: 'subrubro_invalido' };
    return { nombre: r.nombre };
  }
  const cuitOError = async (trx, cuit, exceptoId = null) => {
    if (!cuit) return { cuit: null };
    const n = normalizarCuit(cuit); if (!n) return { error: 'cuit_invalido' };
    const q = trx('clientes').where({ cuit: n }).whereNull('deleted_at'); if (exceptoId) q.whereNot({ id: exceptoId });
    const otro = await q.first(); if (otro) return { error: 'cuit_duplicado', cliente_id: otro.id };
    return { cuit: n };
  };

  app.post('/api/clientes', { preHandler: [auth, requerirPermiso('clientes.editar')] }, async (req, reply) => {
    const { sede, contactos, responsable_id: respId, ...datos } = altaSchema.parse(req.body);
    if (contactos.length && !puede(req.ctx, 'contactos.editar')) return reply.code(403).send({ error: 'sin_permiso' });
    for (const k of contactos) { const e = validarContacto(k); if (e) return reply.code(400).send({ error: e }); }
    const hecho = await db.transaction(async (trx) => {
      const rub = await revisarRubros(trx, datos.rubro_id, datos.subrubro_id); if (rub.error) return { error: rub.error };
      const cu = await cuitOError(trx, datos.cuit); if (cu.error) return cu;
      if (respId && (!puede(req.ctx, 'cartera.asignar') || !(await trx('usuarios').where({ id: respId, activo: true }).whereNull('deleted_at').first()))) return { error: 'responsable_invalido' };
      if (sede && contactos.some((k) => k.sede_id)) return { error: 'sede_en_alta' };
      const [id] = await trx('clientes').insert({
        ...datos, cuit: cu.cuit, rubro: rub.nombre ?? datos.rubro ?? null, estado: datos.estado ?? 'activo', fecha_alta: hoy(), created_by: req.ctx.id, updated_by: req.ctx.id,
      });
      let sedeId = null;
      if (sede) [sedeId] = await trx('sedes').insert({ cliente_id: id, nombre: sede.nombre, domicilio: sede.domicilio ?? null, localidad: sede.localidad ?? null, zona: sede.zona, indicaciones: sede.indicaciones ?? null, es_principal: true, created_by: req.ctx.id, updated_by: req.ctx.id });
      for (const k of contactos) {
        await trx('contactos').insert(aFila(k, { cliente_id: id, sede_id: sedeId, origen: 'alta', estado: 'activo', created_by: req.ctx.id, updated_by: req.ctx.id,
          consentimiento_fecha: k.acepta_comunicaciones ? hoy() : null, consentimiento_origen: k.acepta_comunicaciones ? 'alta' : null }));
      }
      // Quien tiene permiso para asignar elige responsable; un comercial que da de alta una cuenta queda como responsable.
      const dueno = respId ?? (esArea(req.ctx, AREA.COMERCIAL) && !puede(req.ctx, 'cartera.asignar') ? req.ctx.id : null);
      if (dueno) await trx('cartera_asignaciones').insert({ cliente_id: id, usuario_id: dueno, desde: hoy(), asignado_por: req.ctx.id, motivo: 'Alta de la cuenta' });
      const fila = await trx('clientes').where({ id }).first();
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'clientes', id, null, fila);
      return { fila };
    });
    if (hecho.error) return reply.code(hecho.error === 'cuit_duplicado' ? 409 : 400).send(hecho);
    return reply.code(201).send(hecho.fila);
  });

  /* ---------- contactos ---------- */
  const contactoDe = async (req) => {
    const c = await db('contactos').where({ id: Number(req.params.id) }).whereNull('deleted_at').first();
    return c && (await puedeVerCliente(db, req.ctx, c.cliente_id)) ? c : null;
  };
  const sedeOk = async (clienteId, sedeId) => !sedeId || !!(await db('sedes').where({ id: sedeId, cliente_id: clienteId }).whereNull('deleted_at').first());
  const permisosContacto = [auth, requerirPermiso('contactos.editar')];

  app.post('/api/clientes/:id/contactos', { preHandler: permisosContacto }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id))) return reply.code(404).send({ error: 'no_encontrado' });
    const k = contactoSchema.parse(req.body); const e = validarContacto(k); if (e) return reply.code(400).send({ error: e });
    if (!(await sedeOk(id, k.sede_id))) return reply.code(400).send({ error: 'sede_invalida' });
    const nuevo = await db.transaction(async (trx) => {
      const [cid] = await trx('contactos').insert(aFila(k, { cliente_id: id, origen: 'manual', estado: 'activo', created_by: req.ctx.id, updated_by: req.ctx.id,
        consentimiento_fecha: k.acepta_comunicaciones ? hoy() : null, consentimiento_origen: k.acepta_comunicaciones ? 'manual' : null }));
      const fila = await trx('contactos').where({ id: cid }).first();
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'contactos', cid, null, fila);
      return fila;
    });
    return reply.code(201).send(armarContacto(nuevo));
  });

  app.patch('/api/contactos/:id', { preHandler: permisosContacto }, async (req, reply) => {
    const antes = await contactoDe(req); if (!antes) return reply.code(404).send({ error: 'no_encontrado' });
    const k = contactoSchema.parse(req.body); const e = validarContacto(k); if (e) return reply.code(400).send({ error: e });
    if (!(await sedeOk(antes.cliente_id, k.sede_id))) return reply.code(400).send({ error: 'sede_invalida' });
    const cambioConsent = !!k.acepta_comunicaciones !== !!antes.acepta_comunicaciones;
    await db.transaction(async (trx) => {
      await trx('contactos').where({ id: antes.id }).update(aFila(k, { updated_at: trx.fn.now(), updated_by: req.ctx.id,
        ...(cambioConsent ? (k.acepta_comunicaciones ? { consentimiento_fecha: hoy(), consentimiento_origen: 'manual', baja_comunicaciones_fecha: null } : { baja_comunicaciones_fecha: hoy() }) : {}) }));
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'contactos', antes.id, antes, await trx('contactos').where({ id: antes.id }).first());
    });
    return armarContacto(await db('contactos').where({ id: antes.id }).first());
  });

  app.delete('/api/contactos/:id', { preHandler: permisosContacto }, async (req, reply) => {
    const antes = await contactoDe(req); if (!antes) return reply.code(404).send({ error: 'no_encontrado' });
    await db.transaction(async (trx) => {
      await trx('contactos').where({ id: antes.id }).update({ deleted_at: trx.fn.now(), updated_by: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'eliminar', 'contactos', antes.id, antes, null);
    });
    return { ok: true };
  });

  /** Próximos cumpleaños de contactos de las cuentas que la persona puede ver: base para fidelizar. */
  app.get('/api/contactos/cumples', { preHandler: [auth, requerirPermiso('contactos.ver')] }, async (req) => {
    const dias = Math.min(90, Math.max(1, Number(req.query.dias) || 30));
    const visibles = await clientesVisibles(db, req.ctx);
    const filas = await db('contactos').join('clientes', 'clientes.id', 'contactos.cliente_id').whereNull('contactos.deleted_at').whereNull('clientes.deleted_at')
      .whereNotNull('contactos.fecha_nacimiento').where('contactos.estado', 'activo').modify((q) => { if (visibles !== null) q.whereIn('clientes.id', visibles); })
      .select('contactos.id', 'contactos.nombre', 'contactos.apellido', 'contactos.cargo', 'contactos.roles', 'contactos.fecha_nacimiento', 'contactos.intereses', 'clientes.id as cliente_id', 'clientes.razon_social', 'clientes.nombre_comercial');
    const items = filas.map((c) => ({ id: c.id, nombre: [c.nombre, c.apellido].filter(Boolean).join(' '), cargo: c.cargo, roles: json(c.roles, []), cliente_id: c.cliente_id, cliente: c.nombre_comercial || c.razon_social, intereses: c.intereses, ...datosDeNacimiento(c.fecha_nacimiento) }))
      .filter((c) => c.dias_para_cumple <= dias).sort((a, b) => a.dias_para_cumple - b.dias_para_cumple);
    return { items };
  });

  /* ---------- sedes: los locales o domicilios donde hay equipos ---------- */
  const sedeSchema = z.object({
    nombre: z.string().trim().min(1).max(120), domicilio: z.string().trim().max(200).optional().nullable(), localidad: z.string().trim().max(100).optional().nullable(),
    zona: z.enum(['caba', 'resto']).default('caba'), indicaciones: z.string().trim().max(1000).optional().nullable(), es_principal: z.boolean().default(false),
  });
  const permisosSede = [auth, requerirPermiso('clientes.editar')];
  const sedeDe = async (req) => { const x = await db('sedes').where({ id: Number(req.params.id) }).whereNull('deleted_at').first(); return x && (await puedeVerCliente(db, req.ctx, x.cliente_id)) ? x : null; };

  app.post('/api/clientes/:id/sedes', { preHandler: permisosSede }, async (req, reply) => {
    const id = Number(req.params.id); if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id))) return reply.code(404).send({ error: 'no_encontrado' });
    const d = sedeSchema.parse(req.body);
    const nueva = await db.transaction(async (trx) => {
      const hay = await trx('sedes').where({ cliente_id: id }).whereNull('deleted_at').first();
      const principal = d.es_principal || !hay; if (principal) await trx('sedes').where({ cliente_id: id }).update({ es_principal: false });
      const [sid] = await trx('sedes').insert({ ...d, es_principal: principal, cliente_id: id, created_by: req.ctx.id, updated_by: req.ctx.id });
      const fila = await trx('sedes').where({ id: sid }).first(); await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'sedes', sid, null, fila); return fila;
    });
    return reply.code(201).send(nueva);
  });

  app.patch('/api/sedes/:id', { preHandler: permisosSede }, async (req, reply) => {
    const antes = await sedeDe(req); if (!antes) return reply.code(404).send({ error: 'no_encontrado' });
    const d = sedeSchema.parse(req.body);
    await db.transaction(async (trx) => {
      if (d.es_principal) await trx('sedes').where({ cliente_id: antes.cliente_id }).whereNot({ id: antes.id }).update({ es_principal: false });
      await trx('sedes').where({ id: antes.id }).update({ ...d, es_principal: d.es_principal || !!antes.es_principal, updated_at: trx.fn.now(), updated_by: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'sedes', antes.id, antes, d);
    });
    return db('sedes').where({ id: antes.id }).first();
  });

  /** Un local con equipos instalados o contratos vigentes no se borra: primero se mueven los equipos. */
  app.delete('/api/sedes/:id', { preHandler: permisosSede }, async (req, reply) => {
    const antes = await sedeDe(req); if (!antes) return reply.code(404).send({ error: 'no_encontrado' });
    if (antes.es_principal) return reply.code(409).send({ error: 'sede_principal' });
    const eq = Number((await db('asignaciones_equipo').where({ sede_id: antes.id }).whereNull('hasta').count({ n: '*' }).first()).n);
    if (eq) return reply.code(409).send({ error: 'sede_con_equipos', equipos: eq });
    if (await db('contratos').where({ sede_id: antes.id, estado: 'vigente' }).whereNull('deleted_at').first()) return reply.code(409).send({ error: 'sede_con_contratos' });
    await db.transaction(async (trx) => {
      await trx('contactos').where({ sede_id: antes.id }).update({ sede_id: null });
      await trx('sedes').where({ id: antes.id }).update({ deleted_at: trx.fn.now(), updated_by: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'eliminar', 'sedes', antes.id, antes, null);
    });
    return { ok: true };
  });

  /* ---------- seguimiento de la cuenta (farming): gestiones y próximos pasos ---------- */
  const gestionar = [auth, requerirPermiso('crm.gestionar')];
  app.get('/api/clientes/:id/seguimiento', { preHandler: gestionar }, async (req, reply) => {
    const id = Number(req.params.id); if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id))) return reply.code(404).send({ error: 'no_encontrado' });
    const interacciones = await db('interacciones as i').join('usuarios as u', 'u.id', 'i.usuario_id').leftJoin('contactos as k', 'k.id', 'i.contacto_id').where('i.cliente_id', id)
      .orderBy([{ column: 'i.fecha', order: 'desc' }, { column: 'i.id', order: 'desc' }]).limit(100).select('i.id', 'i.tipo', 'i.resumen', 'i.fecha', 'u.nombre as usuario', 'k.nombre as contacto_nombre', 'k.apellido as contacto_apellido');
    const tareas = await db('tareas_crm as t').join('usuarios as u', 'u.id', 't.asignado_a').where('t.cliente_id', id).whereNull('t.deleted_at').whereIn('t.estado', ['pendiente'])
      .orderBy('t.vence').select('t.id', 't.titulo', 't.vence', 't.estado', 'u.nombre as asignado');
    const h = hoy();
    return { interacciones: interacciones.map((i) => ({ ...i, fecha: String(i.fecha).slice(0, 10), contacto: [i.contacto_nombre, i.contacto_apellido].filter(Boolean).join(' ') || null })),
      tareas: tareas.map((t) => ({ ...t, vence: aDia(t.vence), vencida: !!t.vence && aDia(t.vence) < h })) };
  });

  app.post('/api/clientes/:id/seguimiento', { preHandler: gestionar }, async (req, reply) => {
    const id = Number(req.params.id); if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id))) return reply.code(404).send({ error: 'no_encontrado' });
    const d = z.object({ tipo: z.enum(['llamada', 'visita', 'mail', 'whatsapp', 'reunion', 'nota']), resumen: z.string().trim().min(1).max(2000), contacto_id: z.number().int().positive().optional().nullable(),
      proxima_tarea: z.string().trim().max(200).optional().nullable(), proxima_fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable() }).parse(req.body);
    if (d.contacto_id && !(await db('contactos').where({ id: d.contacto_id, cliente_id: id }).whereNull('deleted_at').first())) return reply.code(400).send({ error: 'contacto_invalido' });
    await db.transaction(async (trx) => {
      const [iid] = await trx('interacciones').insert({ cliente_id: id, contacto_id: d.contacto_id ?? null, usuario_id: req.ctx.id, tipo: d.tipo, resumen: d.resumen });
      if (d.proxima_tarea) await trx('tareas_crm').insert({ cliente_id: id, contacto_id: d.contacto_id ?? null, asignado_a: req.ctx.id, titulo: d.proxima_tarea, vence: d.proxima_fecha ?? null, created_by: req.ctx.id, updated_by: req.ctx.id });
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'interacciones', iid, null, { cliente_id: id, tipo: d.tipo });
    });
    return reply.code(201).send({ ok: true });
  });

  app.post('/api/tareas/:id/hecha', { preHandler: gestionar }, async (req, reply) => {
    const t = await db('tareas_crm').where({ id: Number(req.params.id), estado: 'pendiente' }).whereNull('deleted_at').first();
    if (!t || !t.cliente_id || !(await puedeVerCliente(db, req.ctx, t.cliente_id))) return reply.code(404).send({ error: 'no_encontrado' });
    await db('tareas_crm').where({ id: t.id }).update({ estado: 'hecha', completada_en: db.fn.now(), updated_by: req.ctx.id, updated_at: db.fn.now() });
    return { ok: true };
  });

  app.patch('/api/clientes/:id', { preHandler: [auth, requerirPermiso('clientes.editar')] }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id))) return reply.code(404).send({ error: 'no_encontrado' });
    const cambios = clienteSchema.partial().parse(req.body);
    const permitidos = Object.fromEntries(Object.entries(cambios).filter(([k]) => CAMPOS_EDITABLES.includes(k)));
    if (!Object.keys(permitidos).length) return reply.code(400).send({ error: 'sin_cambios' });

    const antes = await db('clientes').where({ id }).whereNull('deleted_at').first();
    if (!antes) return reply.code(404).send({ error: 'no_encontrado' });
    if ('cuit' in permitidos) { const cu = await cuitOError(db, permitidos.cuit, id); if (cu.error) return reply.code(cu.error === 'cuit_duplicado' ? 409 : 400).send(cu); permitidos.cuit = cu.cuit; }
    if ('rubro_id' in permitidos || 'subrubro_id' in permitidos) {
      const rid = 'rubro_id' in permitidos ? permitidos.rubro_id : antes.rubro_id; const sid = 'subrubro_id' in permitidos ? permitidos.subrubro_id : antes.subrubro_id;
      const rub = await revisarRubros(db, rid, rid ? sid : null); if (rub.error) return reply.code(400).send({ error: rub.error });
      permitidos.rubro_id = rid ?? null; permitidos.subrubro_id = rid ? sid ?? null : null; if (rub.nombre) permitidos.rubro = rub.nombre;
    }
    if (permitidos.estado === 'inactivo' && antes.estado !== 'inactivo') permitidos.fecha_baja = permitidos.fecha_baja ?? hoy();
    if (permitidos.estado && permitidos.estado !== 'inactivo') { permitidos.fecha_baja = null; permitidos.motivo_baja = null; }
    await db.transaction(async (trx) => {
      await trx('clientes').where({ id }).update({ ...permitidos, updated_at: trx.fn.now(), updated_by: req.ctx.id });
      const despues = await trx('clientes').where({ id }).first();
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'clientes', id, antes, despues);
    });
    return db('clientes').where({ id }).first();
  });
}
