// Motor de alertas: cada regla mira el estado actual del negocio, y por cada caso que cumple arma el aviso con los datos de ese momento.
import { canales } from './canales.js';
import { aDia, hoy } from './fechas.js';
import { semaforo } from './cobranzas.js';
import { estadoSla } from './servicio.js';
import { aSql, cargarFeriados, deSql } from './sla.js';
import { config } from '../config.js';
import { stockDe } from '../routes/insumos.js';

const ABIERTOS = ['abierto', 'asignado', 'en_curso', 'esperando_cliente'];
const nombreCliente = (c) => c.nombre_comercial || c.razon_social;
const sumarMeses = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const plata = (n, m) => (m === 'ARS' ? '$ ' : 'USD ') + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const diasEntre = (desde, hasta) => Math.max(0, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000));

async function carteraDe(db) {
  const m = new Map(); for (const f of await db('cartera_asignaciones').whereNull('hasta').select('cliente_id', 'usuario_id')) m.set(f.cliente_id, f.usuario_id); return m;
}

async function ticketsAbiertos(db) {
  return db('tickets').join('clientes', 'clientes.id', 'tickets.cliente_id').leftJoin('usuarios as tec', 'tec.id', 'tickets.asignado_a').whereNull('tickets.deleted_at').whereIn('tickets.estado', ABIERTOS)
    .select('tickets.*', 'clientes.razon_social', 'clientes.nombre_comercial', 'tec.nombre as tecnico_nombre');
}

const varsTicket = (t, sla) => ({ numero: t.numero, cliente: nombreCliente(t), asunto: t.asunto, prioridad: t.prioridad, tecnico: t.tecnico_nombre ?? 'sin asignar', sla_horas: sla?.sla_horas ?? '', restantes: sla ? sla.restantes : '', excedidas: sla ? Math.abs(Math.min(0, sla.restantes)) : '' });

/** Catálogo de reglas. Cada una trae sus valores de fábrica; el administrador cambia umbral, canales, destinatarios y texto. */
export const REGLAS = [
  {
    clave: 'sla_por_vencer', nombre: 'Ticket por vencer su SLA', descripcion: 'Un ticket abierto está por agotar el tiempo de resolución.', unidad: '% del SLA que queda', umbral: 25,
    canales: ['sistema', 'mail'], destinatarios: { roles: ['head_tecnico'], responsables: ['tecnico'], usuarios: [] }, frecuencia_horas: 12,
    asunto: 'SLA por vencer: {numero} · {cliente}', cuerpo: 'El ticket {numero} de {cliente} ("{asunto}") tiene {restantes} h hábiles restantes de {sla_horas} h. Técnico: {tecnico}. Prioridad: {prioridad}.',
    variables: ['numero', 'cliente', 'asunto', 'prioridad', 'tecnico', 'sla_horas', 'restantes'],
    async evaluar(db, { umbral, ahora }) {
      const feriados = await cargarFeriados(db); const out = [];
      for (const t of await ticketsAbiertos(db)) {
        const sla = estadoSla(t, feriados, ahora);
        if (sla && !sla.vencido && sla.restantes <= (sla.sla_horas * umbral) / 100) out.push({ entidad: `ticket:${t.id}`, vars: varsTicket(t, sla), destino: `#/tickets/${t.id}`, responsables: { tecnico: t.asignado_a } });
      }
      return out;
    },
  },
  {
    clave: 'sla_vencido', nombre: 'Ticket con el SLA vencido', descripcion: 'Un ticket abierto ya superó el tiempo de resolución.', unidad: null, umbral: null,
    canales: ['sistema', 'mail'], destinatarios: { roles: ['head_tecnico', 'head_atencion'], responsables: ['tecnico'], usuarios: [] }, frecuencia_horas: 24,
    asunto: 'SLA vencido: {numero} · {cliente}', cuerpo: 'El ticket {numero} de {cliente} ("{asunto}") superó el SLA por {excedidas} h hábiles. Técnico: {tecnico}. Prioridad: {prioridad}.',
    variables: ['numero', 'cliente', 'asunto', 'prioridad', 'tecnico', 'sla_horas', 'excedidas'],
    async evaluar(db, { ahora }) {
      const feriados = await cargarFeriados(db); const out = [];
      for (const t of await ticketsAbiertos(db)) {
        const sla = estadoSla(t, feriados, ahora);
        if (sla?.vencido) out.push({ entidad: `ticket:${t.id}`, vars: varsTicket(t, sla), destino: `#/tickets/${t.id}`, responsables: { tecnico: t.asignado_a } });
      }
      return out;
    },
  },
  {
    clave: 'ticket_sin_asignar', nombre: 'Ticket sin asignar', descripcion: 'Un ticket lleva demasiado tiempo sin técnico.', unidad: 'horas sin asignar', umbral: 4,
    canales: ['sistema', 'mail'], destinatarios: { roles: ['head_tecnico', 'head_atencion'], responsables: [], usuarios: [] }, frecuencia_horas: 8,
    asunto: 'Ticket sin asignar: {numero} · {cliente}', cuerpo: 'El ticket {numero} de {cliente} ("{asunto}") lleva {horas} h sin técnico asignado. Prioridad: {prioridad}.',
    variables: ['numero', 'cliente', 'asunto', 'prioridad', 'horas'],
    async evaluar(db, { umbral, ahora }) {
      const out = [];
      for (const t of await ticketsAbiertos(db)) {
        if (t.asignado_a) continue;
        const horas = Math.floor((ahora - deSql(t.abierto_en)) / 3600e3);
        if (horas >= umbral) out.push({ entidad: `ticket:${t.id}`, vars: { ...varsTicket(t, null), horas }, destino: `#/tickets/${t.id}`, responsables: {} });
      }
      return out;
    },
  },
  {
    clave: 'factura_vencida', nombre: 'Factura vencida', descripcion: 'Una factura emitida pasó el plazo de pago acordado en el contrato y sigue con saldo. Se avisa desde que el semáforo pasa a amarillo.', unidad: 'días de vencida', umbral: 1,
    canales: ['sistema', 'mail'], destinatarios: { roles: ['facturacion'], responsables: [], usuarios: [] }, frecuencia_horas: 72,
    asunto: 'Factura vencida: {cliente} · {periodo}', cuerpo: '{cliente} tiene la factura de {periodo}{numero} con un saldo de {saldo}, vencida hace {dias} días (semáforo {color}).',
    variables: ['cliente', 'periodo', 'numero', 'saldo', 'dias', 'color'],
    async evaluar(db, { umbral }) {
      const h = hoy(); const out = [];
      const fs = await db('facturas').join('clientes', 'clientes.id', 'facturas.cliente_id').leftJoin('contratos as ct', 'ct.id', 'facturas.contrato_id').whereNull('facturas.deleted_at').whereIn('facturas.estado', ['emitida', 'cobrada_parcial']).whereNotNull('facturas.entidad_facturante_id')
        .select('facturas.*', 'clientes.razon_social', 'clientes.nombre_comercial', 'ct.plazo_pago_dias as contrato_plazo');
      const ap = new Map((await db('cobro_aplicaciones').whereIn('factura_id', fs.map((f) => f.id)).groupBy('factura_id').select('factura_id').sum({ s: 'importe' })).map((a) => [a.factura_id, Number(a.s)]));
      for (const f of fs) {
        const s = semaforo(f, h, { plazo_pago_dias: f.contrato_plazo }); const saldo = Number(f.total) - (ap.get(f.id) ?? 0);
        if (saldo > 0.005 && s.dias_vencida >= Math.max(1, umbral)) out.push({ entidad: `factura:${f.id}`, vars: { cliente: nombreCliente(f), periodo: f.periodo, numero: f.numero ? ` (${f.numero})` : '', saldo: plata(saldo, f.moneda), dias: s.dias_vencida, color: s.color }, destino: `#/cobranzas`, responsables: {} });
      }
      return out;
    },
  },
  {
    clave: 'gestion_pendiente', nombre: 'Gestión de cobranza para hoy', descripcion: 'Llegó la fecha de seguimiento que cobranzas se puso para una factura.', unidad: null, umbral: null,
    canales: ['sistema'], destinatarios: { roles: ['facturacion'], responsables: [], usuarios: [] }, frecuencia_horas: 24,
    asunto: 'Seguimiento de cobro: {cliente}', cuerpo: 'Hoy toca retomar el reclamo a {cliente} por la factura de {periodo}{numero}.',
    variables: ['cliente', 'periodo', 'numero'],
    async evaluar(db) {
      const h = hoy(); const out = [];
      for (const f of await db('facturas').join('clientes', 'clientes.id', 'facturas.cliente_id').whereNull('facturas.deleted_at').whereIn('facturas.estado', ['emitida', 'cobrada_parcial']).where('facturas.estado_gestion', '!=', 'escalada').whereNotNull('facturas.proxima_gestion').select('facturas.*', 'clientes.razon_social', 'clientes.nombre_comercial')) {
        if (aDia(f.proxima_gestion) <= h) out.push({ entidad: `gestion:${f.id}`, vars: { cliente: nombreCliente(f), periodo: f.periodo, numero: f.numero ? ` (${f.numero})` : '' }, destino: '#/cobranzas', responsables: {} });
      }
      return out;
    },
  },
  {
    clave: 'factura_escalada', nombre: 'Factura pasada al comercial', descripcion: 'Cobranzas no logró respuesta y le pidió al comercial que gestione el cobro. Se recuerda hasta que se cobre o vuelva a cobranzas.', unidad: null, umbral: null,
    canales: ['sistema', 'mail'], destinatarios: { roles: [], responsables: ['comercial'], usuarios: [] }, frecuencia_horas: 72,
    asunto: 'Cobro pendiente con {cliente}', cuerpo: 'Cobranzas te pasó la factura de {periodo}{numero} de {cliente}: saldo {saldo}. Contactá al cliente y dejá registrado el resultado.',
    variables: ['cliente', 'periodo', 'numero', 'saldo'],
    async evaluar(db) {
      const out = []; const fs = await db('facturas').join('clientes', 'clientes.id', 'facturas.cliente_id').whereNull('facturas.deleted_at').whereIn('facturas.estado', ['emitida', 'cobrada_parcial']).where('facturas.estado_gestion', 'escalada').select('facturas.*', 'clientes.razon_social', 'clientes.nombre_comercial');
      const ap = new Map((await db('cobro_aplicaciones').whereIn('factura_id', fs.map((f) => f.id)).groupBy('factura_id').select('factura_id').sum({ s: 'importe' })).map((a) => [a.factura_id, Number(a.s)]));
      for (const f of fs) out.push({ entidad: `escalada:${f.id}`, vars: { cliente: nombreCliente(f), periodo: f.periodo, numero: f.numero ? ` (${f.numero})` : '', saldo: plata(Number(f.total) - (ap.get(f.id) ?? 0), f.moneda) }, destino: '#/cobranzas', responsables: { comercial: f.escalada_a } });
      return out;
    },
  },
  {
    clave: 'stock_bajo', nombre: 'Insumo bajo el mínimo', descripcion: 'Un insumo está sin stock o por debajo de su mínimo.', unidad: null, umbral: null,
    canales: ['sistema'], destinatarios: { roles: ['head_atencion', 'atencion'], responsables: [], usuarios: [] }, frecuencia_horas: 72,
    asunto: 'Stock bajo: {descripcion}', cuerpo: '{descripcion} ({codigo}) tiene {stock} unidades y el mínimo es {minimo}.', variables: ['descripcion', 'codigo', 'stock', 'minimo'],
    async evaluar(db) {
      const stock = await stockDe(db); const out = [];
      for (const i of await db('insumos').whereNull('deleted_at')) {
        const s = stock.get(i.id) ?? 0;
        if (s <= 0 || s < i.stock_minimo) out.push({ entidad: `insumo:${i.id}`, vars: { descripcion: i.descripcion, codigo: i.codigo, stock: s, minimo: i.stock_minimo }, destino: `#/insumos/${i.id}`, responsables: {} });
      }
      return out;
    },
  },
  {
    clave: 'equipo_reincidente', nombre: 'Equipo con fallas repetidas', descripcion: 'Un equipo tuvo varios tickets en los últimos 30 días.', unidad: 'tickets en 30 días', umbral: 2,
    canales: ['sistema'], destinatarios: { roles: ['head_tecnico'], responsables: [], usuarios: [] }, frecuencia_horas: 168,
    asunto: 'Equipo reincidente: {modelo} {serie}', cuerpo: 'El equipo {modelo} (serie {serie}) de {cliente} tuvo {tickets} tickets en los últimos 30 días. Conviene revisarlo o reemplazarlo.', variables: ['modelo', 'serie', 'cliente', 'tickets'],
    async evaluar(db, { umbral, ahora }) {
      const filas = await db('tickets').join('equipos', 'equipos.id', 'tickets.equipo_id').join('modelos_equipo', 'modelos_equipo.id', 'equipos.modelo_id').join('clientes', 'clientes.id', 'tickets.cliente_id')
        .whereNull('tickets.deleted_at').where('tickets.abierto_en', '>=', aSql(ahora - 30 * 86400000)).groupBy('equipos.id', 'equipos.numero_serie', 'modelos_equipo.modelo', 'clientes.razon_social', 'clientes.nombre_comercial')
        .havingRaw('count(*) >= ?', [umbral]).select('equipos.id', 'equipos.numero_serie', 'modelos_equipo.modelo', 'clientes.razon_social', 'clientes.nombre_comercial').count({ n: '*' });
      return filas.map((f) => ({ entidad: `equipo:${f.id}`, vars: { modelo: f.modelo, serie: f.numero_serie, cliente: nombreCliente(f), tickets: Number(f.n) }, destino: `#/equipos/${f.id}`, responsables: {} }));
    },
  },
  {
    clave: 'contrato_por_vencer', nombre: 'Contrato por vencer', descripcion: 'Un contrato vigente termina pronto: hay que renovarlo.', unidad: 'días antes del vencimiento', umbral: 90,
    canales: ['sistema', 'mail'], destinatarios: { roles: ['head_comercial'], responsables: ['comercial'], usuarios: [] }, frecuencia_horas: 168,
    asunto: 'Contrato por vencer: {cliente}', cuerpo: 'El contrato "{contrato}" de {cliente} vence el {vence} (en {dias} días).', variables: ['cliente', 'contrato', 'vence', 'dias'],
    async evaluar(db, { umbral }) {
      const cartera = await carteraDe(db); const h = hoy(); const out = [];
      const cs = await db('contratos').join('clientes', 'clientes.id', 'contratos.cliente_id').whereNull('contratos.deleted_at').where('contratos.estado', 'vigente').whereNotNull('contratos.fecha_inicio').whereNotNull('contratos.duracion_meses')
        .select('contratos.*', 'clientes.razon_social', 'clientes.nombre_comercial');
      for (const c of cs) {
        const vence = sumarMeses(aDia(c.fecha_inicio), c.duracion_meses); const dias = Math.round((Date.parse(vence) - Date.parse(h)) / 86400000);
        if (dias <= umbral) out.push({ entidad: `contrato:${c.id}:${vence}`, vars: { cliente: nombreCliente(c), contrato: c.nombre, vence: vence.split('-').reverse().join('/'), dias }, destino: `#/clientes/${c.cliente_id}`, responsables: { comercial: cartera.get(c.cliente_id) } });
      }
      return out;
    },
  },
  {
    clave: 'lecturas_pendientes', nombre: 'Contadores sin cargar del mes', descripcion: 'Se acerca el cierre y hay equipos sin lectura del mes.', unidad: 'día del mes desde el que avisa', umbral: 25,
    canales: ['sistema', 'mail'], destinatarios: { roles: ['head_tecnico', 'facturacion'], responsables: [], usuarios: [] }, frecuencia_horas: 48,
    asunto: 'Faltan contadores: {cliente}', cuerpo: '{cliente} ("{contrato}") no tiene lectura de este mes en: {series}.', variables: ['cliente', 'contrato', 'series'],
    async evaluar(db, { umbral, ahora }) {
      const fecha = new Date(ahora - 3 * 3600e3).toISOString().slice(0, 10); if (Number(fecha.slice(8, 10)) < umbral) return [];
      const mes = fecha.slice(0, 7); const out = [];
      const filas = await db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').join('clientes', 'clientes.id', 'c.cliente_id').join('equipos as e', 'e.id', 'a.equipo_id')
        .whereNull('a.hasta').where('c.estado', 'vigente').whereNull('c.deleted_at').select('c.id as contrato_id', 'c.nombre as contrato', 'a.equipo_id', 'e.numero_serie', 'clientes.razon_social', 'clientes.nombre_comercial');
      const lec = new Set((await db('lecturas_contador').where('fecha', '>=', `${mes}-01`).select('equipo_id')).map((l) => l.equipo_id));
      const por = new Map();
      for (const f of filas) { if (lec.has(f.equipo_id)) continue; const x = por.get(f.contrato_id) ?? { f, series: [] }; x.series.push(f.numero_serie); por.set(f.contrato_id, x); }
      for (const [id, { f, series }] of por) out.push({ entidad: `lecturas:${id}:${mes}`, vars: { cliente: nombreCliente(f), contrato: f.contrato, series: series.join(', ') }, destino: '#/equipos', responsables: {} });
      return out;
    },
  },
  {
    clave: 'ajuste_ipc_pendiente', nombre: 'Ajuste por IPC pendiente', descripcion: 'Un contrato en pesos lleva meses sin actualizar sus precios.', unidad: 'meses sin ajustar', umbral: 3,
    canales: ['sistema', 'mail'], destinatarios: { roles: ['direccion', 'head_comercial'], responsables: [], usuarios: [] }, frecuencia_horas: 168,
    asunto: 'Ajuste por IPC pendiente: {cliente}', cuerpo: 'El contrato "{contrato}" de {cliente} tiene los mismos precios desde {desde}. Toca el ajuste trimestral por IPC.', variables: ['cliente', 'contrato', 'desde'],
    async evaluar(db, { umbral }) {
      const h = hoy(); const out = [];
      const cs = await db('contratos as c').join('clientes', 'clientes.id', 'c.cliente_id').where({ 'c.estado': 'vigente', 'c.moneda': 'ARS' }).whereNull('c.deleted_at').select('c.id', 'c.nombre', 'c.cliente_id', 'clientes.razon_social', 'clientes.nombre_comercial');
      for (const c of cs) {
        const cond = await db('contrato_condiciones').where({ contrato_id: c.id }).whereNull('vigente_hasta').orderBy('vigente_desde', 'desc').first(); if (!cond) continue;
        const desde = aDia(cond.vigente_desde);
        if (sumarMeses(desde, umbral) <= h) out.push({ entidad: `ipc:${c.id}:${desde}`, vars: { cliente: nombreCliente(c), contrato: c.nombre, desde: desde.split('-').reverse().join('/') }, destino: `#/clientes/${c.cliente_id}`, responsables: {} });
      }
      return out;
    },
  },
];

const porClave = new Map(REGLAS.map((r) => [r.clave, r]));
export const reglaDe = (clave) => porClave.get(clave);
export const render = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

/** Crea en la base las reglas que falten, con sus valores de fábrica. No toca las ya configuradas. */
export async function asegurarReglas(db) {
  const hay = new Set((await db('reglas_alerta').select('tipo')).map((r) => r.tipo));
  for (const r of REGLAS) {
    if (hay.has(r.clave)) continue;
    await db('reglas_alerta').insert({ tipo: r.clave, activa: true, umbral: r.umbral, unidad: r.unidad ? r.unidad.slice(0, 20) : null, canales: JSON.stringify(r.canales), destinatarios: JSON.stringify(r.destinatarios), frecuencia_horas: r.frecuencia_horas, plantilla_asunto: r.asunto, plantilla_cuerpo: r.cuerpo });
  }
}

const leerJson = (v, porDefecto) => { if (v == null) return porDefecto; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return porDefecto; } };
export const normalizarRegla = (fila) => ({ ...fila, clave: fila.tipo, activa: Boolean(fila.activa), umbral: fila.umbral == null ? null : Number(fila.umbral), canales: leerJson(fila.canales, []), destinatarios: { roles: [], responsables: [], usuarios: [], ...leerJson(fila.destinatarios, {}) } });

async function destinatariosDe(db, regla, item) {
  const d = regla.destinatarios; const ids = new Set(d.usuarios ?? []);
  for (const r of d.responsables ?? []) { const id = item.responsables?.[r]; if (id) ids.add(id); }
  const q = db('usuarios').join('roles', 'roles.id', 'usuarios.rol_id').where('usuarios.activo', true).whereNull('usuarios.deleted_at')
    .where((w) => { if (d.roles?.length) w.whereIn('roles.nombre', d.roles); if (ids.size) w.orWhereIn('usuarios.id', [...ids]); if (!d.roles?.length && !ids.size) w.whereRaw('1 = 0'); })
    .select('usuarios.id', 'usuarios.nombre', 'usuarios.email', 'usuarios.telefono');
  return q;
}

/**
 * Corre todas las reglas activas. Un mismo caso no se vuelve a avisar antes de `frecuencia_horas`.
 * Mail y WhatsApp salen agrupados: una sola comunicación por persona y por regla en cada corrida.
 */
export async function ejecutarAlertas(db, { ahora = Date.now() } = {}) {
  const resumen = { eventos: 0, envios: { sistema: 0, mail: 0, whatsapp: 0 }, errores: 0 };
  const reglas = (await db('reglas_alerta').where({ activa: true })).map(normalizarRegla);
  const base = config.appUrl;
  for (const regla of reglas) {
    const def = reglaDe(regla.clave); if (!def) continue;
    let casos;
    try { casos = await def.evaluar(db, { umbral: regla.umbral, ahora }); } catch (e) { resumen.errores += 1; continue; }
    const pendientes = new Map(); // usuario -> [{ evento, titulo, cuerpo, destino }]
    for (const caso of casos) {
      const ultimo = await db('alertas_eventos').where({ regla: regla.clave, entidad: caso.entidad }).orderBy('id', 'desc').first();
      if (ultimo && ahora - deSql(ultimo.disparada_en) < regla.frecuencia_horas * 3600e3) continue;
      const usuarios = await destinatariosDe(db, regla, caso); if (!usuarios.length) continue;
      const titulo = render(regla.plantilla_asunto, caso.vars); const cuerpo = render(regla.plantilla_cuerpo, caso.vars);
      const [eventoId] = await db('alertas_eventos').insert({ regla: regla.clave, entidad: caso.entidad, titulo, cuerpo, destino: caso.destino, datos: JSON.stringify(caso.vars), disparada_en: aSql(ahora) });
      resumen.eventos += 1;
      for (const u of usuarios) {
        if (regla.canales.includes('sistema')) {
          await db('notificaciones').insert({ usuario_id: u.id, evento_id: eventoId, titulo, cuerpo, mensaje: titulo.slice(0, 255), destino: caso.destino, ref_tipo: caso.entidad.split(':')[0], ref_id: Number(caso.entidad.split(':')[1]) || null, created_at: aSql(ahora) });
          await db('alertas_envios').insert({ evento_id: eventoId, usuario_id: u.id, canal: 'sistema', estado: 'enviado', created_at: aSql(ahora) }); resumen.envios.sistema += 1;
        }
        const lista = pendientes.get(u.id) ?? { u, items: [] }; lista.items.push({ eventoId, titulo, cuerpo, destino: caso.destino }); pendientes.set(u.id, lista);
      }
    }
    for (const { u, items } of pendientes.values()) {
      const texto = items.length === 1 ? `${items[0].cuerpo}${base ? `\n${base}/${items[0].destino}` : ''}` : items.map((i) => `• ${i.titulo}\n  ${i.cuerpo}`).join('\n\n');
      const asunto = items.length === 1 ? items[0].titulo : `${def.nombre}: ${items.length} casos`;
      for (const canal of ['mail', 'whatsapp']) {
        if (!regla.canales.includes(canal)) continue;
        let estado = 'enviado'; let detalle = null;
        const destinoCanal = canal === 'mail' ? u.email : u.telefono;
        if (!canales[canal].configurado()) { estado = 'error'; detalle = 'canal_no_configurado'; }
        else if (!destinoCanal) { estado = 'omitido'; detalle = canal === 'mail' ? 'sin_email' : 'sin_telefono'; }
        else { try { await canales[canal].enviar({ to: destinoCanal, subject: asunto, text: canal === 'mail' ? texto : `${asunto}\n${texto}` }); } catch (e) { estado = 'error'; detalle = String(e.message).slice(0, 200); } }
        if (estado === 'enviado') resumen.envios[canal] += 1; else if (estado === 'error') resumen.errores += 1;
        for (const i of items) await db('alertas_envios').insert({ evento_id: i.eventoId, usuario_id: u.id, canal, estado, detalle, created_at: aSql(ahora) });
      }
    }
  }
  return resumen;
}
