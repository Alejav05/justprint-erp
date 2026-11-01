// Toma mensual de contadores: por período, qué equipos ya tienen su lectura y cuáles faltan, y la carga en bloque.
// Las lecturas alimentan la liquidación (abono + excedente) del período que declaran.
import { z } from 'zod';
import { auditar } from '../lib/audit.js';
import { clientesVisibles } from '../lib/contexto.js';
import { aDia, hoy } from '../lib/fechas.js';
import { limitesPeriodo } from '../lib/liquidacion.js';
import { consumoPeriodo, periodoDeLectura, validarLectura } from '../lib/contadores.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const periodoSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const anterior = (p, n = 1) => { const [a, m] = p.split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 - n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const ESTADO_CLIENTE = (cargados, total) => (cargados === total ? 'completo' : cargados === 0 ? 'pendiente' : 'parcial');

export default async function rutasContadores(app, { db }) {
  const auth = requerirSesion(db);
  const ver = [auth, requerirPermiso('contadores.ver')];
  const cargar = [auth, requerirPermiso('contadores.cargar')];

  /** Equipos instalados en contratos vigentes durante `periodo`, con sus lecturas, para clientes que `ctx` puede ver. */
  async function equiposDelPeriodo(ctx, periodo, { equipoIds = null } = {}) {
    const { inicio, fin } = limitesPeriodo(periodo);
    const v = await clientesVisibles(db, ctx);
    const q = db('asignaciones_equipo as a').join('equipos as e', 'e.id', 'a.equipo_id').join('modelos_equipo as m', 'm.id', 'e.modelo_id')
      .join('contratos as c', 'c.id', 'a.contrato_id').join('clientes as cl', 'cl.id', 'c.cliente_id').leftJoin('sedes as s', 's.id', 'a.sede_id')
      .where('c.estado', 'vigente').whereNull('c.deleted_at').where('a.desde', '<=', fin).where((w) => w.whereNull('a.hasta').orWhere('a.hasta', '>=', inicio))
      .orderBy('cl.razon_social').orderBy('c.id').orderBy('e.numero_serie')
      .select('a.equipo_id', 'a.contrato_id', 'a.desde', 'a.contador_inicial_negro', 'a.contador_inicial_color', 'e.numero_serie', 'm.marca', 'm.modelo', 'm.tipo',
        'c.nombre as contrato', 'c.cliente_id', 'cl.razon_social', 'cl.nombre_comercial', 's.nombre as sede', 's.domicilio', 's.localidad');
    if (v) q.whereIn('c.cliente_id', v.length ? v : [0]);
    if (equipoIds) q.whereIn('a.equipo_id', equipoIds);
    return q;
  }

  async function lecturasPorEquipo(ids) {
    const filas = ids.length ? await db('lecturas_contador as l').leftJoin('usuarios as u', 'u.id', 'l.usuario_id').whereIn('l.equipo_id', ids)
      .orderBy('l.fecha').orderBy('l.id').select('l.*', 'u.nombre as usuario') : [];
    const m = new Map();
    for (const l of filas) { if (!m.has(l.equipo_id)) m.set(l.equipo_id, []); m.get(l.equipo_id).push({ ...l, fecha: aDia(l.fecha), per: periodoDeLectura(l) }); }
    return m;
  }

  /** Lectura cargada sin período (desde Equipos o un cierre de ticket) después de fin de mes: puede ser la toma del mes que cerró. */
  function candidataDe(ls, periodo, fin) {
    const c = ls.filter((l) => !l.periodo && l.fecha > aDia(fin) && l.per > periodo).at(0);
    return c ? { id: c.id, fecha: c.fecha, negro: c.contador_negro, color: c.contador_color, origen: c.origen, usuario: c.usuario ?? null } : null;
  }

  app.get('/api/contadores', { preHandler: ver }, async (req) => {
    const periodo = periodoSchema.parse(req.query.periodo);
    const { fin } = limitesPeriodo(periodo);
    let filas = await equiposDelPeriodo(req.ctx, periodo);
    if (req.query.cliente) filas = filas.filter((f) => f.cliente_id === Number(req.query.cliente));
    const lect = await lecturasPorEquipo([...new Set(filas.map((f) => f.equipo_id))]);
    const contratoIds = [...new Set(filas.map((f) => f.contrato_id))];
    const conds = contratoIds.length ? await db('contrato_condiciones').whereIn('contrato_id', contratoIds).where('vigente_desde', '<=', fin).orderBy('vigente_desde', 'desc').orderBy('id', 'desc') : [];

    const facturados = contratoIds.length ? new Set((await db('facturas').whereIn('contrato_id', contratoIds).where({ periodo }).whereNull('deleted_at').where('estado', '!=', 'anulada').select('contrato_id')).map((x) => x.contrato_id)) : new Set();
    const clientes = new Map();
    for (const f of filas) {
      const ls = lect.get(f.equipo_id) ?? [];
      const k = consumoPeriodo(ls, periodo, f);
      // Consumo típico: promedio de páginas de los 3 períodos anteriores que tengan lectura.
      const previos = [1, 2, 3].map((n) => consumoPeriodo(ls, anterior(periodo, n), f)).filter(Boolean).map((x) => x.negro + x.color);
      const promedio = previos.length ? Math.round(previos.reduce((s, x) => s + x, 0) / previos.length) : null;
      const paginas = k ? k.negro + k.color : null;
      const alerta = k && promedio ? (paginas === 0 ? 'cero' : paginas > promedio * 2 && paginas - promedio > 200 ? 'alto' : null) : null;

      if (!clientes.has(f.cliente_id)) clientes.set(f.cliente_id, { cliente_id: f.cliente_id, cliente: f.nombre_comercial || f.razon_social, contratos: new Map() });
      const cl = clientes.get(f.cliente_id);
      if (!cl.contratos.has(f.contrato_id)) {
        const cond = conds.find((x) => x.contrato_id === f.contrato_id);
        cl.contratos.set(f.contrato_id, { contrato_id: f.contrato_id, contrato: f.contrato, franquicia_negro: cond?.franquicia_negro ?? null, franquicia_color: cond?.franquicia_color ?? null, facturado: facturados.has(f.contrato_id), equipos: [] });
      }
      cl.contratos.get(f.contrato_id).equipos.push({
        equipo_id: f.equipo_id, serie: f.numero_serie, modelo: `${f.marca} ${f.modelo}`, tipo: f.tipo, sede: f.sede, domicilio: [f.domicilio, f.localidad].filter(Boolean).join(', ') || null,
        base: { negro: k ? k.base_negro : (ls.filter((l) => l.fecha >= aDia(f.desde)).at(-1)?.contador_negro ?? f.contador_inicial_negro), color: k ? k.base_color : (ls.filter((l) => l.fecha >= aDia(f.desde)).at(-1)?.contador_color ?? f.contador_inicial_color) },
        ultima: ls.at(-1) ? { fecha: ls.at(-1).fecha, negro: ls.at(-1).contador_negro, color: ls.at(-1).contador_color } : null,
        actual: k ? { fecha: k.actual.fecha, negro: k.actual.contador_negro, color: k.actual.contador_color, origen: k.actual.origen, usuario: k.actual.usuario ?? null, observaciones: k.actual.observaciones ?? null } : null,
        consumo: k ? { negro: k.negro, color: k.color, meses: k.meses } : null, promedio, alerta,
        candidata: !k ? candidataDe(ls, periodo, fin) : null,
      });
    }
    const lista = [...clientes.values()].map((c) => {
      const contratos = [...c.contratos.values()];
      const eq = contratos.flatMap((x) => x.equipos);
      const cargados = eq.filter((e) => e.actual).length;
      return { ...c, contratos, equipos: eq.length, cargados, estado: ESTADO_CLIENTE(cargados, eq.length) };
    });
    const equipos = lista.reduce((s, c) => s + c.equipos, 0); const cargados = lista.reduce((s, c) => s + c.cargados, 0);
    return { periodo, resumen: { equipos, cargados, pendientes: equipos - cargados, clientes: lista.length, clientes_completos: lista.filter((c) => c.estado === 'completo').length }, clientes: lista };
  });

  const lecturaSchema = z.object({
    equipo_id: z.number().int().positive(), contador_negro: z.number().int().min(0).max(99999999), contador_color: z.number().int().min(0).max(99999999).optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), origen: z.enum(['tecnico', 'cliente']).default('tecnico'), observaciones: z.string().trim().max(500).optional(),
  });

  /** Guarda lecturas del período. Cada fila se resuelve por separado: las que fallan vuelven con su motivo y no frenan a las demás. */
  app.post('/api/contadores/lecturas', { preHandler: cargar }, async (req, reply) => {
    const d = z.object({ periodo: periodoSchema, lecturas: z.array(lecturaSchema).min(1).max(200) }).parse(req.body);
    const permitidos = await equiposDelPeriodo(req.ctx, d.periodo, { equipoIds: d.lecturas.map((l) => l.equipo_id) });
    const porEquipo = new Map(permitidos.map((x) => [x.equipo_id, x]));
    const guardadas = []; const errores = [];
    for (const l of d.lecturas) {
      const eq = porEquipo.get(l.equipo_id);
      if (!eq) { errores.push({ equipo_id: l.equipo_id, error: 'equipo_no_disponible' }); continue; }
      const fecha = l.fecha ?? hoy();
      if (fecha > hoy()) { errores.push({ equipo_id: l.equipo_id, error: 'fecha_futura' }); continue; }
      const color = eq.tipo === 'monocromo' ? 0 : l.contador_color;
      const todas = (await db('lecturas_contador').where({ equipo_id: l.equipo_id }).orderBy('fecha').orderBy('id')).map((x) => ({ ...x, fecha: aDia(x.fecha) }));
      const existente = todas.filter((x) => periodoDeLectura(x) === d.periodo).at(-1);
      let problema;
      if (existente) {
        // Corrección de una lectura ya cargada para este período: debe quedar entre la anterior y la siguiente.
        const i = todas.findIndex((x) => x.id === existente.id); const prev = todas[i - 1]; const sig = todas[i + 1];
        if (eq.tipo === 'color' && color == null) problema = { error: 'contador_color_requerido' };
        else if (prev && (l.contador_negro < prev.contador_negro || (color ?? 0) < prev.contador_color)) problema = { error: 'contador_menor_al_anterior', anterior: { negro: prev.contador_negro, color: prev.contador_color } };
        else if (sig && (l.contador_negro > sig.contador_negro || (color ?? 0) > sig.contador_color)) problema = { error: 'contador_mayor_al_siguiente', siguiente: { negro: sig.contador_negro, color: sig.contador_color } };
      } else {
        problema = await validarLectura(db, l.equipo_id, eq.tipo, l.contador_negro, color);
      }
      if (problema) { errores.push({ equipo_id: l.equipo_id, ...problema }); continue; }
      const fila = { fecha, contador_negro: l.contador_negro, contador_color: color ?? 0, origen: l.origen, usuario_id: req.ctx.id, observaciones: l.observaciones ?? null, periodo: d.periodo };
      if (existente) {
        await db('lecturas_contador').where({ id: existente.id }).update(fila);
        await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'lecturas_contador', existente.id, { negro: existente.contador_negro, color: existente.contador_color }, { negro: fila.contador_negro, color: fila.contador_color, periodo: d.periodo });
      } else {
        const [id] = await db('lecturas_contador').insert({ equipo_id: l.equipo_id, ...fila });
        await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'crear', 'lecturas_contador', id, null, { equipo_id: l.equipo_id, negro: fila.contador_negro, color: fila.contador_color, periodo: d.periodo });
      }
      guardadas.push(l.equipo_id);
    }
    return reply.code(errores.length && !guardadas.length ? 409 : 200).send({ guardadas, errores });
  });

  /** Confirma que una lectura cargada sin período (en Equipos o en un ticket) es la toma de `periodo`. */
  app.post('/api/contadores/asignar', { preHandler: cargar }, async (req, reply) => {
    const d = z.object({ periodo: periodoSchema, lectura_ids: z.array(z.number().int().positive()).min(1).max(200) }).parse(req.body);
    const { fin } = limitesPeriodo(d.periodo);
    const ls = await db('lecturas_contador').whereIn('id', d.lectura_ids);
    const permitidos = new Set((await equiposDelPeriodo(req.ctx, d.periodo, { equipoIds: ls.map((x) => x.equipo_id) })).map((x) => x.equipo_id));
    const asignadas = []; const errores = [];
    for (const l of ls) {
      if (!permitidos.has(l.equipo_id)) { errores.push({ lectura_id: l.id, error: 'equipo_no_disponible' }); continue; }
      const todas = (await db('lecturas_contador').where({ equipo_id: l.equipo_id }).orderBy('fecha').orderBy('id')).map((x) => ({ ...x, fecha: aDia(x.fecha), per: periodoDeLectura(x) }));
      if (l.periodo || aDia(l.fecha) <= aDia(fin) || todas.some((x) => x.per === d.periodo)) { errores.push({ lectura_id: l.id, error: 'lectura_no_asignable' }); continue; }
      await db('lecturas_contador').where({ id: l.id }).update({ periodo: d.periodo });
      await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'editar', 'lecturas_contador', l.id, { periodo: null }, { periodo: d.periodo });
      asignadas.push(l.id);
    }
    return reply.code(errores.length && !asignadas.length ? 409 : 200).send({ asignadas, errores });
  });
}
