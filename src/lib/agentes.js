// Agente de toma de contadores: lo que manda cada agente se registra en `lecturas_agente` y se valida acá.
// Una lectura limpia pasa sola a `lecturas_contador` con origen 'automatica'; una dudosa queda 'a_revisar'.
import crypto from 'node:crypto';
import { auditar } from './audit.js';
import { aDia } from './fechas.js';
import { limitesPeriodo } from './liquidacion.js';
import { consumoPeriodo, periodoDeLectura } from './contadores.js';

/** Hasta este día del mes, una toma factura el mes anterior (se toma la primera semana del mes siguiente). */
export const CORTE_HASTA_DIA = 10;
/** Desde este día del mes, una toma factura el mes en curso. Entre uno y otro, la toma no es de cierre. */
export const CORTE_DESDE_DIA = 20;

export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const nuevoToken = () => `jpa_${crypto.randomBytes(24).toString('base64url')}`;
export const normalizarSerie = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const mesAnterior = (p, n = 1) => { const [a, m] = p.split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 - n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

/** Período de facturación de una toma según su fecha, o null si cae a mitad de mes. */
export function periodoDeCorte(fecha) {
  const dia = Number(fecha.slice(8, 10)); const mes = fecha.slice(0, 7);
  if (dia <= CORTE_HASTA_DIA) return mesAnterior(mes);
  if (dia >= CORTE_DESDE_DIA) return mes;
  return null;
}

/** Equipos del cliente instalados en contratos vigentes durante `periodo`. */
export async function equiposDelCliente(db, clienteId, periodo) {
  const { inicio, fin } = limitesPeriodo(periodo);
  return db('asignaciones_equipo as a').join('equipos as e', 'e.id', 'a.equipo_id').join('modelos_equipo as m', 'm.id', 'e.modelo_id')
    .join('contratos as c', 'c.id', 'a.contrato_id')
    .where('c.cliente_id', clienteId).where('c.estado', 'vigente').whereNull('c.deleted_at')
    .where('a.desde', '<=', fin).where((w) => w.whereNull('a.hasta').orWhere('a.hasta', '>=', inicio))
    .select('a.equipo_id', 'a.desde', 'a.contador_inicial_negro', 'a.contador_inicial_color', 'e.numero_serie', 'm.marca', 'm.modelo', 'm.tipo');
}

/** Las lecturas que se cargan al instalar o retirar un equipo marcan el arranque o el cierre, no son la toma del mes. */
export const esLecturaDeMovimiento = (l) => /^Lectura de (instalación|retiro)/i.test(l.observaciones ?? '');
/** La toma del período: la última lectura del período que no sea de instalación o retiro. */
const tomaDelPeriodo = (ls, periodo) => ls.filter((x) => x.per === periodo && !esLecturaDeMovimiento(x)).at(-1);

async function lecturasDe(db, equipoId) {
  return (await db('lecturas_contador').where({ equipo_id: equipoId }).orderBy('fecha').orderBy('id')).map((x) => ({ ...x, fecha: aDia(x.fecha), per: periodoDeLectura(x) }));
}

/**
 * Graba la lectura del período (nueva o corrigiendo la automática que ya había) si queda en orden con las demás del equipo.
 * Devuelve { lectura_id } o { error }.
 */
export async function grabarLectura(db, { eq, periodo, fecha, negro, color, observaciones, usuarioId = null, ip = null, permitirBajar = false }) {
  const todas = await lecturasDe(db, eq.equipo_id);
  const existente = tomaDelPeriodo(todas, periodo);
  if (existente && existente.origen !== 'automatica') return { error: 'ya_tiene_lectura_manual' };
  // Reemplazar la automática del período por una menor solo vale como corrección explícita de una persona.
  if (existente && !permitirBajar && (negro < existente.contador_negro || color < existente.contador_color)) return { error: 'contador_menor_al_anterior' };
  const resto = todas.filter((x) => x.id !== existente?.id);
  const prev = resto.filter((x) => x.fecha <= fecha).at(-1); const sig = resto.find((x) => x.fecha > fecha);
  if (prev && (negro < prev.contador_negro || color < prev.contador_color)) return { error: 'contador_menor_al_anterior' };
  if (sig && (negro > sig.contador_negro || color > sig.contador_color)) return { error: 'contador_mayor_al_siguiente' };
  const fila = { fecha, contador_negro: negro, contador_color: color, origen: 'automatica', usuario_id: usuarioId, observaciones, periodo };
  if (existente) {
    await db('lecturas_contador').where({ id: existente.id }).update(fila);
    await auditar(db, { usuarioId, ip }, 'editar', 'lecturas_contador', existente.id, { negro: existente.contador_negro, color: existente.contador_color }, { negro, color, periodo, origen: 'automatica' });
    return { lectura_id: existente.id };
  }
  const [id] = await db('lecturas_contador').insert({ equipo_id: eq.equipo_id, ...fila });
  await auditar(db, { usuarioId, ip }, 'crear', 'lecturas_contador', id, null, { equipo_id: eq.equipo_id, negro, color, periodo, origen: 'automatica' });
  return { lectura_id: id };
}

/** Consumo fuera de lo habitual contra el promedio de los 3 períodos anteriores con lectura (mismo criterio que la pantalla de Contadores). */
function consumoAnomalo(ls, periodo, eq, negro, color, fecha) {
  const conNueva = [...ls.filter((x) => x.per !== periodo), { fecha, per: periodo, contador_negro: negro, contador_color: color }]
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  const k = consumoPeriodo(conNueva, periodo, eq);
  const previos = [1, 2, 3].map((n) => consumoPeriodo(ls, mesAnterior(periodo, n), eq)).filter(Boolean).map((x) => x.negro + x.color);
  if (!k || !previos.length) return null;
  const promedio = previos.reduce((s, x) => s + x, 0) / previos.length; const paginas = k.negro + k.color;
  if (paginas === 0 && promedio > 0) return 'consumo_cero';
  if (paginas > promedio * 2 && paginas - promedio > 200) return 'consumo_alto';
  return null;
}

/** Contadores negro y color a guardar según el tipo del equipo. null si faltan datos. */
export function contadoresPara(tipo, l) {
  if (tipo === 'monocromo') { const n = l.negro ?? l.total; return n == null ? null : { negro: n, color: 0 }; }
  let { negro, color } = l;
  if (negro == null && color != null && l.total != null && l.total >= color) negro = l.total - color;
  if (color == null && negro != null && l.total != null && l.total >= negro) color = l.total - negro;
  return negro == null || color == null ? null : { negro, color };
}

/**
 * Procesa una lectura que mandó el agente: identifica el equipo por número de serie, decide el período y la valida.
 * Devuelve la fila guardada en `lecturas_agente`.
 */
export async function procesarLectura(db, agente, l, { fecha, prueba = false, ip = null, cache = new Map() }) {
  const periodo = periodoDeCorte(fecha);
  const perEquipos = periodo ?? fecha.slice(0, 7);
  if (!cache.has(perEquipos)) cache.set(perEquipos, await equiposDelCliente(db, agente.cliente_id, perEquipos));
  const serie = normalizarSerie(l.serie);
  const eq = serie ? cache.get(perEquipos).find((e) => normalizarSerie(e.numero_serie) === serie) : null;
  const fila = {
    agente_id: agente.id, equipo_id: eq?.equipo_id ?? null, numero_serie: l.serie ?? null, ip: l.ip ?? null, marca: l.marca ?? null, modelo: l.modelo ?? null,
    contador_negro: l.negro ?? null, contador_color: l.color ?? null, contador_total: l.total ?? null, fecha, periodo, prueba, datos: JSON.stringify(l),
  };
  const guardar = async (estado, motivo = null, extra = {}) => {
    const [id] = await db('lecturas_agente').insert({ ...fila, ...extra, estado, motivo });
    return { id, ...fila, ...extra, estado, motivo };
  };

  if (!eq) {
    if (serie) {
      const todos = await db('equipos').select('id', 'numero_serie');
      const ajeno = todos.find((e) => normalizarSerie(e.numero_serie) === serie);
      if (ajeno) return guardar('a_revisar', 'equipo_de_otro_cliente', { equipo_id: ajeno.id });
    }
    return guardar('no_registrado', serie ? 'serie_desconocida' : 'sin_numero_de_serie');
  }
  if (prueba) return guardar('prueba');
  if (!periodo) return guardar('a_revisar', 'fuera_de_fecha_de_corte');
  const c = contadoresPara(eq.tipo, l);
  if (!c) return guardar('a_revisar', 'faltan_contadores');

  const ls = await lecturasDe(db, eq.equipo_id);
  const existente = tomaDelPeriodo(ls, periodo);
  if (existente && existente.origen !== 'automatica') return guardar('rechazada', 'ya_tiene_lectura_manual');
  // Una toma posterior del mismo período reemplaza a la anterior automática, pero nunca para atrás.
  if (existente && (c.negro < existente.contador_negro || c.color < existente.contador_color)) return guardar('a_revisar', 'contador_menor_al_anterior');
  const anomalia = consumoAnomalo(ls.filter((x) => x.id !== existente?.id), periodo, eq, c.negro, c.color, fecha);
  if (anomalia) return guardar('a_revisar', anomalia);
  const r = await grabarLectura(db, { eq, periodo, fecha, negro: c.negro, color: c.color, observaciones: `Agente: ${agente.nombre}`, ip });
  if (r.error) return guardar('a_revisar', r.error);
  return guardar('aprobada', null, { lectura_id: r.lectura_id });
}

/** Aprueba a mano una lectura que quedó a revisar. Los contadores se pueden corregir antes de aprobar. */
export async function aprobarRecibida(db, la, { usuarioId, ip, negro, color }) {
  if (la.estado !== 'a_revisar') return { error: 'no_esta_a_revisar' };
  if (!la.equipo_id || la.motivo === 'equipo_de_otro_cliente') return { error: 'equipo_no_corresponde' };
  const agente = await db('agentes_contadores').where({ id: la.agente_id }).first();
  const fecha = aDia(la.fecha);
  const periodo = la.periodo ?? fecha.slice(0, 7);
  const eq = (await equiposDelCliente(db, agente.cliente_id, periodo)).find((e) => e.equipo_id === la.equipo_id);
  if (!eq) return { error: 'equipo_no_disponible' };
  const c = negro != null ? { negro, color: eq.tipo === 'monocromo' ? 0 : color } : contadoresPara(eq.tipo, { negro: la.contador_negro, color: la.contador_color, total: la.contador_total });
  if (!c || c.color == null) return { error: 'faltan_contadores' };
  const r = await grabarLectura(db, { eq, periodo, fecha, negro: c.negro, color: c.color, observaciones: `Agente: ${agente.nombre} · aprobada a mano`, usuarioId, ip, permitirBajar: negro != null });
  if (r.error) return r;
  await db('lecturas_agente').where({ id: la.id }).update({ estado: 'aprobada', periodo, lectura_id: r.lectura_id, revisado_por: usuarioId, revisado_en: new Date().toISOString().slice(0, 19).replace('T', ' '), contador_negro: c.negro, contador_color: c.color });
  await auditar(db, { usuarioId, ip }, 'editar', 'lecturas_agente', la.id, { estado: la.estado, motivo: la.motivo }, { estado: 'aprobada', lectura_id: r.lectura_id });
  return { lectura_id: r.lectura_id };
}

/**
 * Impresoras que el agente encontró en la red del cliente y que no son de JustPrint, una por equipo (número de serie,
 * o IP si no informa serie), con lo último que se leyó y un volumen mensual estimado entre la primera y la última toma.
 * `filas` son lecturas_agente en estado 'no_registrado', con `cliente_id` y `cliente`.
 */
export function parqueAjeno(filas) {
  const grupos = new Map();
  for (const f of filas) {
    const serie = normalizarSerie(f.numero_serie);
    const k = `${f.cliente_id}|${serie || `ip:${f.ip ?? f.id}`}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push({ ...f, fecha: aDia(f.fecha) });
  }
  const paginas = (x) => x.contador_total ?? (x.contador_negro != null ? x.contador_negro + (x.contador_color ?? 0) : null);
  const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  return [...grupos.values()].map((ls) => {
    ls.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id));
    const ult = ls.at(-1); const conPag = ls.filter((x) => paginas(x) != null);
    const pri = conPag[0]; const fin = conPag.at(-1);
    // Con menos de 20 días entre tomas el promedio no dice mucho.
    const d = pri && fin ? dias(pri.fecha, fin.fecha) : 0;
    const porMes = d >= 20 && paginas(fin) >= paginas(pri) ? Math.round(((paginas(fin) - paginas(pri)) / d) * 30) : null;
    // Color o monocromo: lo que informó el agente (por los colorantes del equipo) y, si no, los contadores.
    const datos = (x) => { try { return typeof x.datos === 'string' ? JSON.parse(x.datos) : x.datos ?? {}; } catch { return {}; } };
    const informado = [...ls].reverse().map((x) => datos(x).es_color).find((v) => typeof v === 'boolean');
    const esColor = informado ?? (ls.some((x) => x.contador_color > 0) ? true : null);
    // Si el equipo separa negro y color, el volumen también se separa.
    const sep = ls.filter((x) => x.contador_negro != null && x.contador_color != null);
    const s0 = sep[0]; const s1 = sep.at(-1); const ds = s0 && s1 ? dias(s0.fecha, s1.fecha) : 0;
    const porMesColor = ds >= 20 && s1.contador_color >= s0.contador_color ? Math.round(((s1.contador_color - s0.contador_color) / ds) * 30) : null;
    return {
      cliente_id: ult.cliente_id, cliente: ult.cliente, agente: ult.agente,
      marca: [...ls].reverse().find((x) => x.marca)?.marca ?? null, modelo: [...ls].reverse().find((x) => x.modelo)?.modelo ?? null,
      numero_serie: ult.numero_serie ?? null, ip: ult.ip ?? null,
      visto_primero: ls[0].fecha, visto_ultimo: ult.fecha, tomas: ls.length,
      contador_negro: ult.contador_negro, contador_color: ult.contador_color, contador_total: paginas(ult),
      paginas_por_mes: porMes, paginas_color_por_mes: esColor === false ? 0 : porMesColor, es_color: esColor,
    };
  }).sort((a, b) => a.cliente.localeCompare(b.cliente, 'es') || String(a.marca ?? '~').localeCompare(String(b.marca ?? '~')) || String(a.modelo).localeCompare(String(b.modelo)));
}
