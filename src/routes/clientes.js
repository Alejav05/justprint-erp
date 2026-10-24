import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles, esArea, puede, puedeVerCliente } from '../lib/contexto.js';
import { AREA } from '../lib/catalogo.js';
import { hoy, json } from '../lib/fechas.js';
import { abonosUsd } from '../lib/abonos.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const CAMPOS_EDITABLES = ['razon_social', 'nombre_comercial', 'cuit', 'condicion_iva', 'rubro', 'tamano', 'estado', 'origen', 'notas'];

const clienteSchema = z.object({
  razon_social: z.string().trim().min(2).max(160),
  nombre_comercial: z.string().trim().max(160).optional(),
  cuit: z.string().trim().max(13).optional(),
  condicion_iva: z.enum(['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final']).optional(),
  rubro: z.string().trim().max(80).optional(),
  tamano: z.string().trim().max(40).optional(),
  estado: z.enum(['prospecto', 'activo', 'inactivo']).optional(),
  origen: z.string().trim().max(60).optional(),
  notas: z.string().max(4000).optional(),
});

const listaSchema = z.object({
  estado: z.enum(['prospecto', 'activo', 'inactivo']).optional(),
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
    if (f.q) base.where((q) => q.where('clientes.razon_social', 'like', `%${f.q}%`).orWhere('clientes.nombre_comercial', 'like', `%${f.q}%`));

    const [{ total }] = await base.clone().count({ total: 'clientes.id' });
    const filas = await base.clone()
      .select('clientes.id', 'clientes.razon_social', 'clientes.nombre_comercial', 'clientes.estado', 'clientes.rubro',
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

    const salida = { cliente, sedes: await db('sedes').where({ cliente_id: id }).whereNull('deleted_at') };

    const resp = await db('cartera_asignaciones as ca').join('usuarios as u', 'u.id', 'ca.usuario_id')
      .where('ca.cliente_id', id).whereNull('ca.hasta').select('u.id', 'u.nombre', 'ca.desde').first();
    salida.responsable = resp ?? null;

    if (puede(req.ctx, 'contactos.ver')) {
      const contactos = await db('contactos').where({ cliente_id: id }).whereNull('deleted_at');
      salida.contactos = contactos.map((c) => ({
        ...c, roles: json(c.roles, []), telefonos: json(c.telefonos, []), emails: json(c.emails, []),
        etiquetas: json(c.etiquetas, []), fechas_clave: json(c.fechas_clave, []),
      }));
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

  app.post('/api/clientes', { preHandler: [auth, requerirPermiso('clientes.editar')] }, async (req, reply) => {
    const datos = clienteSchema.parse(req.body);
    const nuevo = await db.transaction(async (trx) => {
      const [id] = await trx('clientes').insert({
        ...datos, estado: datos.estado ?? 'prospecto', fecha_alta: hoy(), created_by: req.ctx.id, updated_by: req.ctx.id,
      });
      // Un comercial que da de alta una cuenta queda como responsable; un líder la deja sin asignar.
      if (esArea(req.ctx, AREA.COMERCIAL) && !puede(req.ctx, 'cartera.asignar')) {
        await trx('cartera_asignaciones').insert({
          cliente_id: id, usuario_id: req.ctx.id, desde: hoy(), asignado_por: req.ctx.id, motivo: 'Alta de la cuenta',
        });
      }
      const fila = await trx('clientes').where({ id }).first();
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'clientes', id, null, fila);
      return fila;
    });
    return reply.code(201).send(nuevo);
  });

  app.patch('/api/clientes/:id', { preHandler: [auth, requerirPermiso('clientes.editar')] }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id))) return reply.code(404).send({ error: 'no_encontrado' });
    const cambios = clienteSchema.partial().parse(req.body);
    const permitidos = Object.fromEntries(Object.entries(cambios).filter(([k]) => CAMPOS_EDITABLES.includes(k)));
    if (!Object.keys(permitidos).length) return reply.code(400).send({ error: 'sin_cambios' });

    const antes = await db('clientes').where({ id }).whereNull('deleted_at').first();
    if (!antes) return reply.code(404).send({ error: 'no_encontrado' });
    await db.transaction(async (trx) => {
      await trx('clientes').where({ id }).update({ ...permitidos, updated_at: trx.fn.now(), updated_by: req.ctx.id });
      const despues = await trx('clientes').where({ id }).first();
      await auditar(trx, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'clientes', id, antes, despues);
    });
    return db('clientes').where({ id }).first();
  });
}
