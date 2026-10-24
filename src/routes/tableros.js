import { aSql } from '../lib/sla.js';
import { hoy } from '../lib/fechas.js';
import { abonosUsd } from '../lib/abonos.js';
import { kpiSla, estadoSla } from '../lib/servicio.js';
import { cargarFeriados, deSql, horasHabiles } from '../lib/sla.js';
import { usuariosVisibles } from '../lib/contexto.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Últimos `n` períodos AAAA-MM terminando en el de `hasta`. */
function ultimosPeriodos(hasta, n) {
  let [a, m] = hasta.slice(0, 7).split('-').map(Number);
  const lista = [];
  for (let i = 0; i < n; i += 1) {
    lista.unshift(`${a}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; a -= 1; }
  }
  return lista;
}

export default async function rutasTableros(app, { db }) {
  const pre = [requerirSesion(db), requerirPermiso('tableros.direccion')];

  /**
   * Tablero de Dirección. Todo en USD de referencia (neto, sin IVA). Facturado y cobrado van separados, y lo que se
   * cobra sin comprobante fiscal se muestra aparte: no cuenta como facturado.
   */
  app.get('/api/tableros/direccion', { preHandler: pre }, async () => {
    const h = hoy();
    const periodos = ultimosPeriodos(h, 12);

    const porEstado = await db('clientes').whereNull('deleted_at').groupBy('estado').select('estado').count({ n: '*' });
    const clientes = Object.fromEntries(porEstado.map((f) => [f.estado, Number(f.n)]));

    const facturas = await db('facturas').whereNull('deleted_at').where('estado', '!=', 'anulada')
      .select('id', 'cliente_id', 'contrato_id', 'periodo', 'estado', 'total', 'neto_usd', 'entidad_facturante_id');
    const aplicado = new Map();
    for (const a of await db('cobro_aplicaciones').select('factura_id').sum({ s: 'importe' }).groupBy('factura_id')) {
      aplicado.set(a.factura_id, Number(a.s));
    }
    const clase = (f) => (f.estado === 'borrador' ? 'borrador' : f.entidad_facturante_id ? 'fiscal' : 'interno');
    const usdCobrado = (f) => (Number(f.total) > 0 ? (Math.min(aplicado.get(f.id) ?? 0, Number(f.total)) / Number(f.total)) * Number(f.neto_usd ?? 0) : 0);

    const serie = Object.fromEntries(periodos.map((p) => [p, { periodo: p, facturado: 0, cobrado: 0, sin_comprobante: 0 }]));
    let porCobrar = 0; let porCobrarN = 0; let borradores = 0; let borradoresN = 0;
    const porCliente = new Map();
    for (const f of facturas) {
      const c = clase(f);
      const usd = Number(f.neto_usd ?? 0);
      if (c === 'borrador') { borradores += usd; borradoresN += 1; continue; }
      if (serie[f.periodo]) {
        if (c === 'fiscal') { serie[f.periodo].facturado += usd; serie[f.periodo].cobrado += usdCobrado(f); } else serie[f.periodo].sin_comprobante += usd;
      }
      if (c === 'fiscal' && f.estado !== 'cobrada') { porCobrar += usd - usdCobrado(f); porCobrarN += 1; }
      if (periodos.includes(f.periodo)) porCliente.set(f.cliente_id, (porCliente.get(f.cliente_id) ?? 0) + usd);
    }
    const nombres = Object.fromEntries((await db('clientes').select('id', 'razon_social', 'nombre_comercial')).map((c) => [c.id, c.nombre_comercial || c.razon_social]));
    const topClientes = [...porCliente.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, usd]) => ({ cliente_id: id, cliente: nombres[id], usd: redondear(usd) }));

    const abonos = await abonosUsd(db);

    const tickets = await db('tickets').whereNull('tickets.deleted_at').whereNotIn('tickets.estado', ['resuelto', 'cerrado'])
      .join('clientes', 'clientes.id', 'tickets.cliente_id')
      .select('tickets.numero', 'tickets.asunto', 'tickets.estado', 'tickets.prioridad', 'tickets.abierto_en', 'clientes.razon_social as cliente')
      .orderBy('tickets.abierto_en', 'asc');
    const cerrados30 = await db('tickets').whereNull('deleted_at').whereIn('estado', ['resuelto', 'cerrado'])
      .where('cerrado_en', '>=', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ')).count({ n: '*' }).first();

    const equiposPorEstado = Object.fromEntries((await db('equipos').whereNull('deleted_at').groupBy('estado').select('estado').count({ n: '*' })).map((f) => [f.estado, Number(f.n)]));
    const stock = await db('movimientos_insumo').groupBy('insumo_id').select('insumo_id')
      .sum({ s: db.raw("case tipo when 'salida' then -cantidad else cantidad end") });
    const agotados = stock.filter((x) => Number(x.s) <= 0).length;

    const alertas = [];
    if (borradoresN) alertas.push({ nivel: 'aviso', texto: `${borradoresN} factura${borradoresN > 1 ? 's' : ''} en borrador sin emitir (USD ${redondear(borradores)})`, destino: '#/facturacion' });
    if (porCobrarN) alertas.push({ nivel: 'aviso', texto: `${porCobrarN} factura${porCobrarN > 1 ? 's' : ''} emitida${porCobrarN > 1 ? 's' : ''} por cobrar (USD ${redondear(porCobrar)})`, destino: '#/facturacion' });
    if (tickets.length) alertas.push({ nivel: tickets.some((t) => t.prioridad === 'urgente') ? 'malo' : 'info', texto: `${tickets.length} ticket${tickets.length > 1 ? 's' : ''} abierto${tickets.length > 1 ? 's' : ''}`, destino: '#/tickets' });
    if (agotados) alertas.push({ nivel: 'aviso', texto: `${agotados} insumo${agotados > 1 ? 's' : ''} sin stock`, destino: '#/insumos' });

    return {
      moneda: 'USD', neto: true, periodo_actual: h.slice(0, 7),
      clientes: { activo: clientes.activo ?? 0, prospecto: clientes.prospecto ?? 0, inactivo: clientes.inactivo ?? 0 },
      contratos_vigentes: abonos.contratos,
      abono_mensual: redondear(abonos.total), abono_no_facturable: redondear(abonos.noFacturable),
      por_cobrar: { usd: redondear(porCobrar), facturas: porCobrarN },
      borradores: { usd: redondear(borradores), facturas: borradoresN },
      serie: periodos.map((p) => ({ ...serie[p], facturado: redondear(serie[p].facturado), cobrado: redondear(serie[p].cobrado), sin_comprobante: redondear(serie[p].sin_comprobante) })),
      top_clientes: topClientes,
      tickets: { abiertos: tickets.length, cerrados_30_dias: Number(cerrados30.n), lista: tickets.slice(0, 5) },
      sla: await kpiSla(db),
      equipos: { instalado: equiposPorEstado.instalado ?? 0, deposito: equiposPorEstado.deposito ?? 0, reparacion: equiposPorEstado.reparacion ?? 0 },
      alertas,
    };
  });

  /**
   * Tablero de Servicio. Dirección y la cabeza técnica ven al equipo; el técnico solo se ve a sí mismo.
   * Los tiempos son horas hábiles y los tickets migrados (sin tiempos reales) no cuentan.
   */
  app.get('/api/tableros/servicio', { preHandler: [requerirSesion(db), requerirPermiso('tableros.servicio')] }, async (req) => {
    const visibles = await usuariosVisibles(db, req.ctx);
    const feriados = await cargarFeriados(db);
    const ahora = Date.now();
    const q = db('tickets').whereNull('tickets.deleted_at');
    if (visibles) q.whereIn('tickets.asignado_a', visibles);
    const todos = await q.select('tickets.*');
    const abiertos = todos.filter((t) => ['abierto', 'asignado', 'en_curso', 'esperando_cliente'].includes(t.estado));
    const conSla = abiertos.map((t) => ({ t, sla: estadoSla(t, feriados, ahora) }));
    const vencidos = conSla.filter((x) => x.sla?.vencido).length;
    const sinAsignar = (visibles ? [] : abiertos.filter((t) => !t.asignado_a)).length;
    const edad = abiertos.map((t) => horasHabiles(deSql(t.abierto_en), ahora, feriados));
    const equipo = await db('usuarios').join('usuario_area', 'usuario_area.usuario_id', 'usuarios.id').join('areas', 'areas.id', 'usuario_area.area_id')
      .where({ 'areas.nombre': 'Técnica', 'usuarios.activo': true }).whereNull('usuarios.deleted_at').select('usuarios.id', 'usuarios.nombre');
    const tecnicos = [];
    for (const u of equipo.filter((x) => !visibles || visibles.includes(x.id))) {
      const k = await kpiSla(db, { tecnicos: [u.id], ahora });
      const propios = abiertos.filter((t) => t.asignado_a === u.id);
      tecnicos.push({
        id: u.id, nombre: u.nombre, abiertos: propios.length,
        vencidos: propios.filter((t) => estadoSla(t, feriados, ahora)?.vencido).length,
        resueltos_mes: k.actual.n, horas_medias: k.actual.horas_medias, pct_sla: k.actual.pct_sla, muestra_chica: k.actual.muestra_chica,
      });
    }
    const hace30 = aSql(ahora - 30 * 86400000);
    const reincidentes = await db('tickets').join('equipos', 'equipos.id', 'tickets.equipo_id').join('modelos_equipo', 'modelos_equipo.id', 'equipos.modelo_id')
      .whereNull('tickets.deleted_at').where('tickets.abierto_en', '>=', hace30).groupBy('equipos.id', 'equipos.numero_serie', 'modelos_equipo.modelo')
      .havingRaw('count(*) >= 2').select('equipos.id', 'equipos.numero_serie', 'modelos_equipo.modelo').count({ tickets: '*' });
    return {
      unidad: 'horas hábiles',
      sla: await kpiSla(db, { tecnicos: visibles, ahora }),
      abiertos: abiertos.length, vencidos, sin_asignar: sinAsignar,
      antiguedad_media_horas: edad.length ? Math.round((edad.reduce((a, b) => a + b, 0) / edad.length) * 10) / 10 : null,
      por_prioridad: Object.fromEntries(['urgente', 'alta', 'normal', 'baja'].map((p) => [p, abiertos.filter((t) => t.prioridad === p).length])),
      tecnicos: req.ctx.permisos.has('tickets.asignar') || !visibles || visibles.length > 1 ? tecnicos : tecnicos.filter((x) => x.id === req.ctx.id),
      reincidencia: reincidentes.map((r) => ({ ...r, tickets: Number(r.tickets) })),
    };
  });
}
