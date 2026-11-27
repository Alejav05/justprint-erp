// Agentes de toma de contadores. Dos caras:
// - /api/agente/v1/*: la usa el agente instalado en el cliente, con su token (Authorization: Bearer …), sin sesión.
// - /api/contadores/agentes y /api/contadores/recibidas: las usa la gente de JustPrint para dar de alta agentes y revisar lo que llegó.
import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles, puedeVerCliente } from '../lib/contexto.js';
import { aDia, hoy, json } from '../lib/fechas.js';
import { aprobarRecibida, parqueAjeno, CORTE_DESDE_DIA, CORTE_HASTA_DIA, equiposDelCliente, hashToken, nuevoToken, periodoDeCorte, procesarLectura } from '../lib/agentes.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const ahoraSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const contador = z.number().int().min(0).max(4294967295).nullable().optional();

export default async function rutasAgentes(app, { db }) {
  // ——— Lado del agente ———
  async function autenticarAgente(req, reply) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!m) return reply.code(401).send({ error: 'token_requerido' });
    const agente = await db('agentes_contadores').where({ token_hash: hashToken(m[1]) }).whereNull('deleted_at').first();
    if (!agente || !agente.activo) return reply.code(401).send({ error: 'token_invalido' });
    const cliente = await db('clientes').where({ id: agente.cliente_id }).first();
    req.agente = { ...agente, cliente: cliente?.nombre_comercial || cliente?.razon_social };
    const v = req.headers['x-agente-version']; const host = req.headers['x-agente-host'];
    await db('agentes_contadores').where({ id: agente.id }).update({
      ultima_conexion: ahoraSql(), ultima_ip: String(req.ip).slice(0, 64),
      ...(v ? { version: String(v).slice(0, 40) } : {}), ...(host ? { equipo_host: String(host).slice(0, 120) } : {}),
    });
  }

  /** Lo que el agente necesita saber: qué equipos esperamos y cuándo es el corte. */
  app.get('/api/agente/v1/config', { preHandler: autenticarAgente }, async (req) => {
    const fecha = hoy(); const periodo = periodoDeCorte(fecha) ?? fecha.slice(0, 7);
    const eqs = await equiposDelCliente(db, req.agente.cliente_id, periodo);
    const recibidas = await db('lecturas_agente').where({ agente_id: req.agente.id, periodo, estado: 'aprobada' }).select('equipo_id');
    const listos = new Set(recibidas.map((x) => x.equipo_id));
    const ya = new Set((await db('lecturas_contador').whereIn('equipo_id', eqs.map((e) => e.equipo_id)).where({ periodo }).select('equipo_id')).map((x) => x.equipo_id));
    return {
      agente: { id: req.agente.id, nombre: req.agente.nombre }, cliente: req.agente.cliente, hoy: fecha,
      corte: { desde_dia: CORTE_DESDE_DIA, hasta_dia: CORTE_HASTA_DIA, periodo: periodoDeCorte(fecha) },
      equipos: eqs.map((e) => ({ serie: e.numero_serie, marca: e.marca, modelo: e.modelo, tipo: e.tipo, tomado: listos.has(e.equipo_id) || ya.has(e.equipo_id) })),
    };
  });

  const envioSchema = z.object({
    prueba: z.boolean().default(false),
    tomada_en: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
    lecturas: z.array(z.object({
      serie: z.string().trim().max(80).nullable().optional(), ip: z.string().max(64).optional(),
      marca: z.string().max(60).optional(), modelo: z.string().max(120).optional(),
      negro: contador, color: contador, total: contador, extra: z.record(z.string(), z.unknown()).optional(),
    })).min(1).max(500),
  });

  /** Recibe una tanda de lecturas. Cada una se procesa por separado y vuelve con su estado. */
  app.post('/api/agente/v1/lecturas', { preHandler: autenticarAgente, bodyLimit: 1024 * 1024 }, async (req) => {
    const d = envioSchema.parse(req.body);
    // La fecha es la del servidor (Buenos Aires); si el agente manda una, solo se acepta si no es futura ni de más de 15 días atrás (envíos encolados).
    let fecha = hoy();
    if (d.tomada_en) {
      const t = d.tomada_en.slice(0, 10); const min = new Date(Date.now() - 15 * 864e5).toISOString().slice(0, 10);
      if (t <= fecha && t >= min) fecha = t;
    }
    const cache = new Map(); const resultados = [];
    for (const l of d.lecturas) {
      const r = await procesarLectura(db, req.agente, l, { fecha, prueba: d.prueba, ip: req.ip, cache });
      resultados.push({ serie: l.serie ?? null, ip: l.ip ?? null, estado: r.estado, motivo: r.motivo, periodo: r.periodo });
    }
    return { fecha, resultados };
  });

  // ——— Lado de JustPrint ———
  const auth = requerirSesion(db);
  const administrar = [auth, requerirPermiso('contadores.agentes')];
  const revisar = [auth, requerirPermiso('contadores.cargar')];

  app.get('/api/contadores/agentes', { preHandler: [auth, requerirPermiso('contadores.ver')] }, async (req) => {
    const v = await clientesVisibles(db, req.ctx);
    const q = db('agentes_contadores as a').join('clientes as c', 'c.id', 'a.cliente_id').whereNull('a.deleted_at').orderBy('c.razon_social').orderBy('a.id')
      .select('a.id', 'a.cliente_id', 'a.nombre', 'a.token_pista', 'a.activo', 'a.ultima_conexion', 'a.ultima_ip', 'a.version', 'a.equipo_host', 'a.created_at', 'c.razon_social', 'c.nombre_comercial');
    if (v) q.whereIn('a.cliente_id', v.length ? v : [0]);
    const agentes = await q;
    const ultimas = agentes.length ? await db('lecturas_agente').whereIn('agente_id', agentes.map((a) => a.id)).groupBy('agente_id', 'estado').select('agente_id', 'estado').count({ n: '*' }).max({ ultima: 'created_at' }) : [];
    return agentes.map((a) => {
      const mias = ultimas.filter((u) => u.agente_id === a.id);
      const por = Object.fromEntries(mias.map((u) => [u.estado, Number(u.n)]));
      return { ...a, activo: Boolean(a.activo), cliente: a.nombre_comercial || a.razon_social, lecturas: por, ultima_lectura: mias.map((u) => u.ultima).sort().at(-1) ?? null };
    });
  });

  /** Alta de un agente para un cliente. El token se muestra una sola vez. */
  app.post('/api/contadores/agentes', { preHandler: administrar }, async (req, reply) => {
    const d = z.object({ cliente_id: z.number().int().positive(), nombre: z.string().trim().min(1).max(120) }).parse(req.body);
    if (!(await puedeVerCliente(db, req.ctx, d.cliente_id))) return reply.code(404).send({ error: 'no_encontrado' });
    const token = nuevoToken();
    const [id] = await db('agentes_contadores').insert({ cliente_id: d.cliente_id, nombre: d.nombre, token_hash: hashToken(token), token_pista: token.slice(-6), created_by: req.ctx.id, updated_by: req.ctx.id });
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'agentes_contadores', id, null, { cliente_id: d.cliente_id, nombre: d.nombre });
    return reply.code(201).send({ id, token });
  });

  async function agenteVisible(req) {
    const a = await db('agentes_contadores').where({ id: Number(req.params.id) }).whereNull('deleted_at').first();
    if (!a || !(await puedeVerCliente(db, req.ctx, a.cliente_id))) return null;
    return a;
  }

  /** Token nuevo: el anterior deja de funcionar en el acto (por ejemplo, si se reinstala o se filtró). */
  app.post('/api/contadores/agentes/:id/token', { preHandler: administrar }, async (req, reply) => {
    const a = await agenteVisible(req); if (!a) return reply.code(404).send({ error: 'no_encontrado' });
    const token = nuevoToken();
    await db('agentes_contadores').where({ id: a.id }).update({ token_hash: hashToken(token), token_pista: token.slice(-6), updated_by: req.ctx.id, updated_at: ahoraSql() });
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'agentes_contadores', a.id, { token_pista: a.token_pista }, { token_pista: token.slice(-6) });
    return { token };
  });

  app.patch('/api/contadores/agentes/:id', { preHandler: administrar }, async (req, reply) => {
    const d = z.object({ activo: z.boolean().optional(), nombre: z.string().trim().min(1).max(120).optional() }).refine((x) => Object.keys(x).length).parse(req.body);
    const a = await agenteVisible(req); if (!a) return reply.code(404).send({ error: 'no_encontrado' });
    await db('agentes_contadores').where({ id: a.id }).update({ ...d, updated_by: req.ctx.id, updated_at: ahoraSql() });
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'agentes_contadores', a.id, { activo: Boolean(a.activo), nombre: a.nombre }, d);
    return { ok: true };
  });

  /** Lo que mandaron los agentes. Por defecto, lo que espera revisión. */
  app.get('/api/contadores/recibidas', { preHandler: [auth, requerirPermiso('contadores.ver')] }, async (req) => {
    const q = z.object({ estado: z.enum(['aprobada', 'a_revisar', 'rechazada', 'no_registrado', 'prueba', 'todas']).default('a_revisar'), periodo: z.string().regex(/^\d{4}-\d{2}$/).optional(), agente: z.coerce.number().int().positive().optional() }).parse(req.query);
    const v = await clientesVisibles(db, req.ctx);
    const s = db('lecturas_agente as l').join('agentes_contadores as a', 'a.id', 'l.agente_id').join('clientes as c', 'c.id', 'a.cliente_id')
      .leftJoin('equipos as e', 'e.id', 'l.equipo_id').leftJoin('modelos_equipo as m', 'm.id', 'e.modelo_id')
      .orderBy('l.created_at', 'desc').orderBy('l.id', 'desc').limit(500)
      .select('l.id', 'l.agente_id', 'l.equipo_id', 'l.numero_serie', 'l.ip', 'l.marca', 'l.modelo', 'l.contador_negro', 'l.contador_color', 'l.contador_total', 'l.fecha', 'l.periodo', 'l.estado', 'l.motivo', 'l.lectura_id', 'l.created_at',
        'a.nombre as agente', 'a.cliente_id', 'c.razon_social', 'c.nombre_comercial', 'e.numero_serie as serie_equipo', 'm.tipo', 'm.marca as marca_equipo', 'm.modelo as modelo_equipo');
    if (q.estado !== 'todas') s.where('l.estado', q.estado);
    if (q.periodo) s.where('l.periodo', q.periodo);
    if (q.agente) s.where('l.agente_id', q.agente);
    if (v) s.whereIn('a.cliente_id', v.length ? v : [0]);
    const filas = await s;
    // Para comparar: la última lectura que ya tiene cada equipo.
    const ids = [...new Set(filas.map((f) => f.equipo_id).filter(Boolean))];
    const ult = new Map();
    if (ids.length) for (const l of await db('lecturas_contador').whereIn('equipo_id', ids).orderBy('fecha').orderBy('id')) ult.set(l.equipo_id, { fecha: aDia(l.fecha), negro: l.contador_negro, color: l.contador_color, periodo: l.periodo, origen: l.origen });
    return filas.map((f) => ({ ...f, fecha: aDia(f.fecha), cliente: f.nombre_comercial || f.razon_social, ultima_del_equipo: f.equipo_id ? ult.get(f.equipo_id) ?? null : null }));
  });

  /** Impresoras de los clientes que no son de JustPrint (propias o de otro proveedor), según lo que encontraron los agentes. */
  app.get('/api/contadores/parque', { preHandler: [auth, requerirPermiso('contadores.ver')] }, async (req) => {
    const q = z.object({ cliente: z.coerce.number().int().positive().optional() }).parse(req.query);
    const v = await clientesVisibles(db, req.ctx);
    const s = db('lecturas_agente as l').join('agentes_contadores as a', 'a.id', 'l.agente_id').join('clientes as c', 'c.id', 'a.cliente_id')
      .where('l.estado', 'no_registrado').whereNull('a.deleted_at')
      .select('l.id', 'l.numero_serie', 'l.ip', 'l.marca', 'l.modelo', 'l.contador_negro', 'l.contador_color', 'l.contador_total', 'l.fecha',
        'a.nombre as agente', 'a.cliente_id', 'c.razon_social', 'c.nombre_comercial');
    if (q.cliente) s.where('a.cliente_id', q.cliente);
    if (v) s.whereIn('a.cliente_id', v.length ? v : [0]);
    const parque = parqueAjeno((await s).map((f) => ({ ...f, cliente: f.nombre_comercial || f.razon_social })));
    // Cuántos equipos nuestros tiene hoy cada cliente, para ver el parque completo.
    const ids = [...new Set(parque.map((x) => x.cliente_id))];
    const nuestros = new Map();
    if (ids.length) {
      const filas = await db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id')
        .whereIn('c.cliente_id', ids).where('c.estado', 'vigente').whereNull('c.deleted_at').whereNull('a.hasta')
        .groupBy('c.cliente_id').select('c.cliente_id').count({ n: 'a.id' });
      for (const f of filas) nuestros.set(f.cliente_id, Number(f.n));
    }
    return parque.map((x) => ({ ...x, equipos_justprint: nuestros.get(x.cliente_id) ?? 0 }));
  });

  async function recibidaVisible(req) {
    const la = await db('lecturas_agente').where({ id: Number(req.params.id) }).first();
    if (!la) return null;
    const a = await db('agentes_contadores').where({ id: la.agente_id }).first();
    return (await puedeVerCliente(db, req.ctx, a.cliente_id)) ? la : null;
  }

  app.post('/api/contadores/recibidas/:id/aprobar', { preHandler: revisar }, async (req, reply) => {
    const d = z.object({ contador_negro: z.number().int().min(0).max(99999999).optional(), contador_color: z.number().int().min(0).max(99999999).optional() }).parse(req.body ?? {});
    const la = await recibidaVisible(req); if (!la) return reply.code(404).send({ error: 'no_encontrado' });
    const r = await aprobarRecibida(db, la, { usuarioId: req.ctx.id, ip: req.ip, negro: d.contador_negro, color: d.contador_color });
    if (r.error) return reply.code(409).send(r);
    return r;
  });

  app.post('/api/contadores/recibidas/:id/rechazar', { preHandler: revisar }, async (req, reply) => {
    const la = await recibidaVisible(req); if (!la) return reply.code(404).send({ error: 'no_encontrado' });
    if (la.estado !== 'a_revisar') return reply.code(409).send({ error: 'no_esta_a_revisar' });
    await db('lecturas_agente').where({ id: la.id }).update({ estado: 'rechazada', revisado_por: req.ctx.id, revisado_en: ahoraSql() });
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'lecturas_agente', la.id, { estado: la.estado, motivo: la.motivo }, { estado: 'rechazada' });
    return { ok: true };
  });

  app.get('/api/contadores/recibidas/:id', { preHandler: [auth, requerirPermiso('contadores.ver')] }, async (req, reply) => {
    const la = await recibidaVisible(req); if (!la) return reply.code(404).send({ error: 'no_encontrado' });
    return { ...la, fecha: aDia(la.fecha), datos: json(la.datos, {}) };
  });
}
