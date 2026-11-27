// Monitoreo de equipos: lo que el agente manda cada día (insumos, errores, contadores de seguimiento) y lo que se
// deduce de eso: conexión, días de toner que quedan, páginas del mes y qué hay que atender. No toca la facturación.
import { aDia, hoy as hoyBA, json } from './fechas.js';
import { equiposDelCliente, esLecturaDeMovimiento, normalizarSerie, periodoDeCorte } from './agentes.js';
import { periodoDeLectura } from './contadores.js';

export const UMBRAL_TONER = 15;
export const DIAS_SIN_CONEXION = 2;
const ABIERTOS = ['abierto', 'asignado', 'en_curso', 'esperando_cliente'];

export const ERRORES = {
  sin_toner: 'Sin toner', poco_toner: 'Poco toner', atasco: 'Papel atascado', tapa_abierta: 'Tapa abierta', sin_papel: 'Sin papel', poco_papel: 'Poco papel',
  bandeja_vacia: 'Bandeja vacía', falta_bandeja: 'Falta una bandeja', falta_bandeja_salida: 'Falta la bandeja de salida', service: 'Pide service',
  fuera_de_linea: 'Fuera de línea', falta_insumo: 'Falta un insumo', bandeja_salida_casi_llena: 'Bandeja de salida casi llena', bandeja_salida_llena: 'Bandeja de salida llena',
  mantenimiento_vencido: 'Mantenimiento vencido',
};
/** Errores que necesitan a JustPrint (los demás, como falta de papel, los resuelve el cliente). */
export const ERRORES_A_ATENDER = ['sin_toner', 'service', 'falta_insumo', 'mantenimiento_vencido', 'atasco', 'tapa_abierta'];
/** Insumos que se reponen y se miden contra el umbral. */
const REPONIBLES = ['toner', 'tinta', 'tambor', 'fusor', 'revelador'];

const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const sumarDias = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const contadorTotal = (x) => x.contador_total ?? (x.contador_negro != null ? x.contador_negro + (x.contador_color ?? 0) : null);

const limpiarInsumos = (lista) => (Array.isArray(lista) ? lista : []).slice(0, 30).map((i) => ({
  nombre: String(i?.nombre ?? '').slice(0, 80) || 'Insumo', tipo: String(i?.tipo ?? 'otro').slice(0, 20), color: i?.color ? String(i.color).slice(0, 20) : null,
  nivel: Number.isFinite(i?.nivel) ? Math.max(0, Math.min(100, Math.round(i.nivel))) : null, queda_algo: Boolean(i?.queda_algo),
}));

/** Guarda lo que mandó el agente. Solo los equipos de JustPrint del cliente; uno por equipo y día. */
export async function guardarEstados(db, agente, items, fecha = hoyBA()) {
  const eqs = await equiposDelCliente(db, agente.cliente_id, fecha.slice(0, 7));
  const porSerie = new Map(eqs.map((e) => [normalizarSerie(e.numero_serie), e]));
  let guardados = 0; const vistos = new Set();
  for (const it of items) {
    const eq = porSerie.get(normalizarSerie(it.serie));
    if (!eq || vistos.has(eq.equipo_id)) continue;
    vistos.add(eq.equipo_id);
    const fila = {
      agente_id: agente.id, ip: it.ip ?? null, estado: it.estado ?? null, mensaje: it.mensaje ? String(it.mensaje).slice(0, 120) : null,
      errores: JSON.stringify((it.errores ?? []).filter((x) => ERRORES[x])), insumos: JSON.stringify(limpiarInsumos(it.insumos)),
      contador_negro: it.negro ?? null, contador_color: it.color ?? null, contador_total: it.total ?? null, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
    const ya = await db('estado_equipos').where({ equipo_id: eq.equipo_id, fecha }).first();
    if (ya) await db('estado_equipos').where({ id: ya.id }).update(fila);
    else await db('estado_equipos').insert({ ...fila, equipo_id: eq.equipo_id, fecha });
    guardados += 1;
  }
  return { guardados };
}

/**
 * Días que le quedan a un insumo según cómo bajó en los últimos 30 días. Se toma el tramo desde el último cambio
 * (si el nivel subió, se repuso: el cálculo arranca de ahí). null si no hay suficiente historia o no baja.
 */
export function diasRestantes(historia, nombre, nivel, fecha) {
  if (nivel == null) return null;
  const puntos = historia.map((h) => ({ fecha: h.fecha, nivel: h.insumos.find((i) => i.nombre === nombre)?.nivel })).filter((p) => p.nivel != null && p.fecha <= fecha && dias(p.fecha, fecha) <= 30);
  let desde = null;
  for (let i = puntos.length - 1; i >= 0; i -= 1) { if (puntos[i].nivel < (desde?.nivel ?? nivel)) break; desde = puntos[i]; }
  if (!desde) return null;
  const d = dias(desde.fecha, fecha); const baja = desde.nivel - nivel;
  if (d < 3 || baja <= 0) return null;
  return Math.round(nivel / (baja / d));
}

/** Umbral de toner bajo: el que se configuró en la alerta, o el de fábrica. */
export async function umbralToner(db) {
  const r = await db('reglas_alerta').where({ tipo: 'monitoreo_toner_bajo' }).first().catch(() => null);
  return r?.umbral != null ? Number(r.umbral) : UMBRAL_TONER;
}

/**
 * Estado de todos los equipos monitoreados (clientes con agente activo), agrupados por cliente.
 * `clientes`: ids visibles (null = todos).
 */
export async function panelMonitoreo(db, { clientes = null, hoy = hoyBA() } = {}) {
  const umbral = await umbralToner(db);
  const q = db('agentes_contadores as a').join('clientes as c', 'c.id', 'a.cliente_id').whereNull('a.deleted_at').where('a.activo', true)
    .select('a.id', 'a.nombre', 'a.cliente_id', 'a.ultima_conexion', 'a.version', 'a.equipo_host', 'c.razon_social', 'c.nombre_comercial');
  if (clientes) q.whereIn('a.cliente_id', clientes.length ? clientes : [0]);
  const agentes = await q;
  const porCliente = new Map();
  for (const a of agentes) {
    if (!porCliente.has(a.cliente_id)) porCliente.set(a.cliente_id, { cliente_id: a.cliente_id, cliente: a.nombre_comercial || a.razon_social, agentes: [], equipos: [] });
    const conexion = aDia(a.ultima_conexion);
    porCliente.get(a.cliente_id).agentes.push({ id: a.id, nombre: a.nombre, ultima_conexion: a.ultima_conexion, pc: a.equipo_host, version: a.version,
      caido: !conexion || dias(conexion, hoy) > DIAS_SIN_CONEXION, dias_sin_conexion: conexion ? dias(conexion, hoy) : null });
  }
  const mes = hoy.slice(0, 7); const cierre = periodoDeCorte(hoy) ?? mes;
  const avisos = await db('monitoreo_avisos').whereIn('cliente_id', [...porCliente.keys()].length ? [...porCliente.keys()] : [0]).select('cliente_id', 'equipo_id');
  for (const g of porCliente.values()) {
    const propios = avisos.filter((a) => a.cliente_id === g.cliente_id);
    g.avisos_cliente = propios.some((a) => a.equipo_id == null);
    g.avisos_equipos = new Set(propios.filter((a) => a.equipo_id != null).map((a) => a.equipo_id));
  }
  for (const g of porCliente.values()) {
    const eqs = await equiposDelCliente(db, g.cliente_id, mes);
    const ids = eqs.map((e) => e.equipo_id);
    if (!ids.length) continue;
    const estados = (await db('estado_equipos').whereIn('equipo_id', ids).where('fecha', '>=', sumarDias(hoy, -35)).orderBy('fecha'))
      .map((x) => ({ ...x, fecha: aDia(x.fecha), insumos: json(x.insumos, []), errores: json(x.errores, []) }));
    const ultimaDelCliente = estados.reduce((m, x) => (x.fecha > m ? x.fecha : m), '');
    const lecturas = (await db('lecturas_contador').whereIn('equipo_id', ids).orderBy('fecha').orderBy('id')).map((l) => ({ ...l, fecha: aDia(l.fecha), per: periodoDeLectura(l) }));
    const tickets = await db('tickets').whereIn('equipo_id', ids).whereNull('deleted_at').whereIn('estado', ABIERTOS).select('id', 'numero', 'tipo', 'equipo_id', 'asunto');
    for (const e of eqs) {
      const hist = estados.filter((x) => x.equipo_id === e.equipo_id);
      const u = hist.at(-1) ?? null;
      const conexion = !u ? 'sin_datos' : u.fecha >= ultimaDelCliente ? 'en_linea' : 'sin_conexion';
      const insumos = (u?.insumos ?? []).map((i) => ({ ...i, dias: diasRestantes(hist, i.nombre, i.nivel, u.fecha), bajo: REPONIBLES.includes(i.tipo) && i.nivel != null && i.nivel < umbral }));
      const ls = lecturas.filter((l) => l.equipo_id === e.equipo_id);
      // Páginas desde la última toma de cierre de un mes anterior (o desde la instalación).
      const base = ls.filter((l) => l.per < mes && !esLecturaDeMovimiento(l)).at(-1) ?? ls.filter((l) => l.fecha <= hoy).at(-1)
        ?? { fecha: aDia(e.desde), contador_negro: e.contador_inicial_negro, contador_color: e.contador_inicial_color, per: null };
      let paginas = null;
      if (u && base) {
        const ahora = contadorTotal(u); const antes = (base.contador_negro ?? 0) + (base.contador_color ?? 0);
        if (ahora != null && ahora >= antes) {
          const color = e.tipo === 'color' && u.contador_color != null && base.contador_color != null ? Math.max(0, u.contador_color - base.contador_color) : null;
          const d = Math.max(1, dias(base.fecha, u.fecha));
          paginas = { total: ahora - antes, color, desde: base.fecha, desde_periodo: base.per, por_dia: Math.round((ahora - antes) / d) };
        }
      }
      const cargada = ls.some((l) => l.per === cierre && !esLecturaDeMovimiento(l));
      const errores = u?.errores ?? [];
      const alertas = [];
      if (conexion === 'sin_conexion') alertas.push({ tipo: 'sin_conexion', dias: dias(u.fecha, hoy), desde: u.fecha });
      for (const x of errores.filter((k) => ERRORES_A_ATENDER.includes(k))) alertas.push({ tipo: 'error', error: x, texto: ERRORES[x] });
      for (const i of insumos.filter((x) => x.bajo)) alertas.push({ tipo: 'insumo_bajo', insumo: i.nombre, insumo_tipo: i.tipo, color: i.color, nivel: i.nivel, dias: i.dias });
      g.equipos.push({
        equipo_id: e.equipo_id, serie: e.numero_serie, marca: e.marca, modelo: e.modelo, tipo: e.tipo,
        conexion, visto: u?.fecha ?? null, visto_a: u?.updated_at ?? null, ip: u?.ip ?? null, estado: u?.estado ?? null, mensaje: u?.mensaje ?? null,
        errores: errores.map((k) => ({ clave: k, texto: ERRORES[k] ?? k })), insumos,
        contador: u ? { negro: u.contador_negro, color: u.contador_color, total: contadorTotal(u), fecha: u.fecha } : null, paginas,
        avisos: g.avisos_cliente || g.avisos_equipos.has(e.equipo_id), avisos_propio: g.avisos_equipos.has(e.equipo_id),
        cierre: { periodo: cierre, cargada }, ticket: tickets.find((t) => t.equipo_id === e.equipo_id) ?? null, alertas,
      });
    }
  }
  for (const g of porCliente.values()) { g.avisos = g.avisos_cliente ? 'cliente' : g.avisos_equipos.size ? 'equipos' : 'no'; delete g.avisos_equipos; }
  const lista = [...porCliente.values()].sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'));
  const eqs = lista.flatMap((c) => c.equipos);
  return {
    hoy, umbral, cierre,
    resumen: {
      clientes: lista.length, equipos: eqs.length, sin_datos: eqs.filter((e) => e.conexion === 'sin_datos').length,
      sin_conexion: eqs.filter((e) => e.conexion === 'sin_conexion').length, con_error: eqs.filter((e) => e.alertas.some((a) => a.tipo === 'error')).length,
      insumo_bajo: eqs.filter((e) => e.alertas.some((a) => a.tipo === 'insumo_bajo')).length, agentes_caidos: lista.flatMap((c) => c.agentes).filter((a) => a.caido).length,
      paginas_mes: eqs.reduce((s, e) => s + (e.paginas?.total ?? 0), 0),
    },
    clientes: lista,
  };
}

/** Prende o apaga los avisos de un cliente entero (sin equipo) o de un equipo del cliente. */
export async function fijarAvisos(db, { clienteId, equipoId = null, activo, usuarioId = null }) {
  const q = db('monitoreo_avisos').where({ cliente_id: clienteId });
  if (equipoId == null) q.whereNull('equipo_id'); else q.where({ equipo_id: equipoId });
  await q.clone().del();
  if (activo) await db('monitoreo_avisos').insert({ cliente_id: clienteId, equipo_id: equipoId, created_by: usuarioId });
}
