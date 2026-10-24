// Indicadores de servicio técnico. Todos los tiempos en horas hábiles (ver lib/sla.js).
import { cargarFeriados, deSql, horasHabiles } from './sla.js';

const r1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10;
const mesBA = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(0, 7);
const MIN_MUESTRA = 5;

function resumen(filas, feriados) {
  const n = filas.length;
  if (!n) return { n: 0, horas_medias: null, pct_sla: null, primera_respuesta_horas: null, muestra_chica: true };
  const horas = filas.map((t) => Number(t.horas_resolucion));
  const cumplidos = filas.filter((t) => t.sla_cumplido === 1 || t.sla_cumplido === true).length;
  const resp = filas.filter((t) => t.primera_respuesta_en).map((t) => horasHabiles(deSql(t.abierto_en), deSql(t.primera_respuesta_en), feriados));
  return {
    n,
    horas_medias: r1(horas.reduce((a, b) => a + b, 0) / n),
    pct_sla: Math.round((cumplidos / n) * 100),
    primera_respuesta_horas: resp.length ? r1(resp.reduce((a, b) => a + b, 0) / resp.length) : null,
    muestra_chica: n < MIN_MUESTRA,
  };
}

/** Variación en puntos o porcentaje; `mejora` dice si el cambio es bueno (menos horas, más cumplimiento). */
function comparar(actual, base, campo, menorEsMejor) {
  if (actual[campo] == null || base[campo] == null) return null;
  const delta = r1(actual[campo] - base[campo]);
  return { delta, mejora: delta === 0 ? null : (delta < 0) === menorEsMejor };
}

/**
 * SLA del mes actual contra el mes anterior y contra el histórico (todo lo anterior al mes actual).
 * `tecnicos`: limita a esos usuarios (null = todos). Solo cuenta tickets resueltos con SLA medible.
 */
export async function kpiSla(db, { tecnicos = null, ahora = Date.now() } = {}) {
  const feriados = await cargarFeriados(db);
  const q = db('tickets').whereNull('deleted_at').where({ sla_medible: true }).whereNotNull('resuelto_en')
    .select('abierto_en', 'resuelto_en', 'primera_respuesta_en', 'horas_resolucion', 'sla_cumplido', 'asignado_a');
  if (tecnicos) q.whereIn('asignado_a', tecnicos);
  const filas = await q;
  const actualMes = mesBA(ahora);
  const [a, m] = actualMes.split('-').map(Number);
  const anteriorMes = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
  const por = (f) => filas.filter((t) => f(mesBA(deSql(t.resuelto_en))));
  const mes = resumen(por((x) => x === actualMes), feriados);
  const anterior = resumen(por((x) => x === anteriorMes), feriados);
  const historico = resumen(por((x) => x < actualMes), feriados);
  const dif = (base) => ({
    horas_medias: comparar(mes, base, 'horas_medias', true),
    pct_sla: comparar(mes, base, 'pct_sla', false),
    primera_respuesta_horas: comparar(mes, base, 'primera_respuesta_horas', true),
  });
  return {
    unidad: 'horas hábiles', minimo_muestra: MIN_MUESTRA, mes: actualMes, mes_anterior: anteriorMes,
    actual: mes, anterior, historico, vs_anterior: dif(anterior), vs_historico: dif(historico),
  };
}

/** Estado del SLA de un ticket abierto: horas usadas, restantes y si ya venció. */
export function estadoSla(t, feriados, ahora = Date.now()) {
  if (!t.sla_horas || !t.sla_medible) return null;
  const hasta = t.resuelto_en ? deSql(t.resuelto_en) : ahora;
  const usadas = horasHabiles(deSql(t.abierto_en), hasta, feriados);
  const restantes = r1(t.sla_horas - usadas);
  return {
    sla_horas: t.sla_horas, usadas: r1(usadas), restantes,
    vencido: t.resuelto_en ? t.sla_cumplido === 0 || t.sla_cumplido === false : restantes < 0,
  };
}
