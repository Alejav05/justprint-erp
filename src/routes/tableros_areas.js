import { abonosUsd } from '../lib/abonos.js';
import { clientesVisibles } from '../lib/contexto.js';
import { aDia, hoy } from '../lib/fechas.js';
import { kpiSla, estadoSla } from '../lib/servicio.js';
import { aSql, cargarFeriados } from '../lib/sla.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';
import { stockDe } from './insumos.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ABIERTOS = ['abierto', 'asignado', 'en_curso', 'esperando_cliente'];
const sumarMeses = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

export default async function rutasTablerosAreas(app, { db }) {
  const auth = requerirSesion(db);

  /** Tablero de Atención: qué hay que asignar, qué está por vencer y qué espera al cliente. */
  app.get('/api/tableros/atencion', { preHandler: [auth, requerirPermiso('tickets.crear')] }, async (req) => {
    const ahora = Date.now(); const visibles = await clientesVisibles(db, req.ctx);
    const feriados = await cargarFeriados(db);
    const q = db('tickets').join('clientes', 'clientes.id', 'tickets.cliente_id').leftJoin('usuarios as tec', 'tec.id', 'tickets.asignado_a')
      .whereNull('tickets.deleted_at').whereIn('tickets.estado', ABIERTOS)
      .select('tickets.id', 'tickets.numero', 'tickets.asunto', 'tickets.estado', 'tickets.prioridad', 'tickets.abierto_en', 'tickets.asignado_a', 'tickets.sla_horas', 'tickets.sla_medible',
        'tickets.resuelto_en', 'tickets.sla_cumplido', 'clientes.razon_social', 'clientes.nombre_comercial', 'tec.nombre as tecnico');
    if (visibles) q.whereIn('tickets.cliente_id', visibles.length ? visibles : [0]);
    const filas = (await q).map((t) => ({ id: t.id, numero: t.numero, asunto: t.asunto, estado: t.estado, prioridad: t.prioridad, abierto_en: t.abierto_en, tecnico: t.tecnico,
      cliente: t.nombre_comercial || t.razon_social, sla: estadoSla(t, feriados, ahora) }));
    const porAntiguedad = (a, b) => String(a.abierto_en).localeCompare(String(b.abierto_en));
    const riesgo = (t) => t.sla && !t.sla.vencido && t.sla.restantes <= t.sla.sla_horas * 0.25;
    const ini = Date.parse(`${hoy()}T00:00:00-03:00`);
    const nuevosHoy = filas.filter((t) => Date.parse(`${String(t.abierto_en).replace(' ', 'T')}Z`) >= ini).length;
    const stock = await stockDe(db); const cat = await db('insumos').whereNull('deleted_at').select('id', 'stock_minimo');
    return {
      abiertos: filas.length, nuevos_hoy: nuevosHoy,
      sin_asignar: filas.filter((t) => !t.tecnico).sort(porAntiguedad).slice(0, 8), sin_asignar_total: filas.filter((t) => !t.tecnico).length,
      vencidos: filas.filter((t) => t.sla?.vencido).length,
      por_vencer: filas.filter((t) => t.sla?.vencido || riesgo(t)).sort((a, b) => a.sla.restantes - b.sla.restantes).slice(0, 8),
      esperando_cliente: filas.filter((t) => t.estado === 'esperando_cliente').sort(porAntiguedad).slice(0, 8), esperando_cliente_total: filas.filter((t) => t.estado === 'esperando_cliente').length,
      insumos: { agotados: cat.filter((i) => (stock.get(i.id) ?? 0) <= 0).length, bajos: cat.filter((i) => (stock.get(i.id) ?? 0) > 0 && (stock.get(i.id) ?? 0) < i.stock_minimo).length },
      sla: await kpiSla(db, { ahora }),
    };
  });

  /** Tablero Comercial: la cartera propia (o del equipo), lo que vale, lo que hay que cobrar y lo que vence. */
  app.get('/api/tableros/comercial', { preHandler: [auth, requerirPermiso('crm.gestionar')] }, async (req) => {
    const visibles = await clientesVisibles(db, req.ctx);
    const ids = visibles ?? (await db('clientes').whereNull('deleted_at').select('id')).map((c) => c.id);
    const solo = ids.length ? ids : [0];
    const clientes = await db('clientes').whereNull('deleted_at').whereIn('id', solo).select('id', 'razon_social', 'nombre_comercial', 'estado', 'created_at');
    const nombre = (c) => c.nombre_comercial || c.razon_social; const mapa = new Map(clientes.map((c) => [c.id, nombre(c)]));
    const porEstado = (e) => clientes.filter((c) => c.estado === e).length;
    const abonos = await abonosUsd(db, { clienteIds: solo });

    // Por cobrar de la cartera, con antigüedad.
    const fs = await db('facturas').whereIn('cliente_id', solo).whereNull('deleted_at').whereIn('estado', ['emitida', 'cobrada_parcial']).whereNotNull('entidad_facturante_id')
      .select('id', 'cliente_id', 'total', 'neto_usd', 'fecha_emision');
    const ap = new Map((await db('cobro_aplicaciones').whereIn('factura_id', fs.map((f) => f.id)).groupBy('factura_id').select('factura_id').sum({ s: 'importe' })).map((a) => [a.factura_id, Number(a.s)]));
    const h = hoy(); const deuda = new Map(); let totalDeuda = 0;
    for (const f of fs) {
      const usd = Number(f.total) > 0 ? ((Number(f.total) - (ap.get(f.id) ?? 0)) / Number(f.total)) * Number(f.neto_usd ?? 0) : 0;
      const dias = Math.max(0, Math.round((Date.parse(h) - Date.parse(aDia(f.fecha_emision) ?? h)) / 86400000));
      const c = deuda.get(f.cliente_id) ?? { cliente_id: f.cliente_id, cliente: mapa.get(f.cliente_id), usd: 0, max_dias: 0 };
      c.usd += usd; c.max_dias = Math.max(c.max_dias, dias); deuda.set(f.cliente_id, c); totalDeuda += usd;
    }

    // Contratos que terminan pronto (inicio + duración).
    const contratos = await db('contratos').whereIn('cliente_id', solo).whereNull('deleted_at').where('estado', 'vigente').whereNotNull('fecha_inicio').whereNotNull('duracion_meses')
      .select('id', 'cliente_id', 'nombre', 'fecha_inicio', 'duracion_meses');
    const limite = sumarMeses(h, 3);
    const porVencer = contratos.map((c) => ({ id: c.id, cliente_id: c.cliente_id, cliente: mapa.get(c.cliente_id), contrato: c.nombre, vence: sumarMeses(aDia(c.fecha_inicio), c.duracion_meses) }))
      .filter((c) => c.vence <= limite).sort((a, b) => a.vence.localeCompare(b.vence)).slice(0, 8);

    // Clientes con tickets abiertos (para no llamarlos a ciegas).
    const tk = await db('tickets').whereIn('cliente_id', solo).whereNull('deleted_at').whereIn('estado', ABIERTOS).groupBy('cliente_id').select('cliente_id').count({ n: '*' });
    const conTickets = tk.map((t) => ({ cliente_id: t.cliente_id, cliente: mapa.get(t.cliente_id), tickets: Number(t.n) })).sort((a, b) => b.tickets - a.tickets).slice(0, 8);

    const prospectos = clientes.filter((c) => c.estado === 'prospecto').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 6).map((c) => ({ cliente_id: c.id, cliente: nombre(c), alta: aDia(c.created_at) }));
    const sinResponsable = req.ctx.permisos.has('cartera.asignar')
      ? Number((await db('clientes').whereNull('deleted_at').whereNotIn('id', db('cartera_asignaciones').whereNull('hasta').select('cliente_id')).count({ n: '*' }).first()).n) : null;
    let equipo = null;
    if (req.ctx.permisos.has('cartera.asignar')) {
      const filas = await db('cartera_asignaciones as ca').join('usuarios as u', 'u.id', 'ca.usuario_id').whereNull('ca.hasta').groupBy('u.id', 'u.nombre').select('u.id', 'u.nombre').count({ clientes: '*' });
      const abonosTodos = await abonosUsd(db);
      const resp = await db('cartera_asignaciones').whereNull('hasta').select('usuario_id', 'cliente_id');
      equipo = filas.map((f) => ({ id: f.id, nombre: f.nombre, clientes: Number(f.clientes), abono_usd: r2(resp.filter((x) => x.usuario_id === f.id).reduce((s, x) => s + (abonosTodos.porCliente[x.cliente_id]?.abono ?? 0), 0)) })).sort((a, b) => b.abono_usd - a.abono_usd);
    }
    return {
      moneda: 'USD', neto: true,
      clientes: { total: clientes.length, activo: porEstado('activo'), prospecto: porEstado('prospecto'), inactivo: porEstado('inactivo') },
      abono_mensual: r2(abonos.total), contratos_vigentes: abonos.contratos,
      por_cobrar: { usd: r2(totalDeuda), clientes: [...deuda.values()].map((c) => ({ ...c, usd: r2(c.usd) })).filter((c) => c.usd > 0).sort((a, b) => b.usd - a.usd).slice(0, 6) },
      por_vencer: porVencer, con_tickets: conTickets, prospectos, sin_responsable: sinResponsable, equipo,
    };
  });
}
