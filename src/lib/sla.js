// Cálculo de horas hábiles para el SLA. Buenos Aires es UTC-3 todo el año (sin horario de verano).
// Jornada configurable: por defecto lunes a viernes de 9 a 18, sin feriados. Con jornada 0-24 una "hora hábil"
// es una hora corrida de un día hábil.
const OFFSET = -3 * 3600000;
const DIA = 86400000;
const HORA = 3600000;

export const JORNADA = { desde: Number(process.env.SLA_JORNADA_DESDE ?? 9), hasta: Number(process.env.SLA_JORNADA_HASTA ?? 18) };

const aLocal = (ms) => ms + OFFSET;
const diaLocal = (msLocal) => Math.floor(msLocal / DIA);
const isoDia = (n) => new Date(n * DIA).toISOString().slice(0, 10);
const esFinDeSemana = (n) => { const d = new Date(n * DIA).getUTCDay(); return d === 0 || d === 6; };

/** `feriados`: Set de 'AAAA-MM-DD' que no se trabajan. */
export function esHabil(n, feriados) { return !esFinDeSemana(n) && !feriados.has(isoDia(n)); }

/** Horas hábiles entre dos instantes (ms UTC). */
export function horasHabiles(desde, hasta, feriados = new Set(), jornada = JORNADA) {
  if (hasta <= desde) return 0;
  const d0 = aLocal(desde); const d1 = aLocal(hasta);
  let total = 0;
  for (let n = diaLocal(d0); n <= diaLocal(d1); n += 1) {
    if (!esHabil(n, feriados)) continue;
    const ini = Math.max(d0, n * DIA + jornada.desde * HORA);
    const fin = Math.min(d1, n * DIA + jornada.hasta * HORA);
    if (fin > ini) total += (fin - ini) / HORA;
  }
  return total;
}

/** Instante (ms UTC) en el que se cumplen `horas` hábiles desde `desde`. */
export function sumarHorasHabiles(desde, horas, feriados = new Set(), jornada = JORNADA) {
  let resto = horas * HORA;
  let cursor = aLocal(desde);
  for (let guarda = 0; guarda < 3650; guarda += 1) {
    const n = diaLocal(cursor);
    if (esHabil(n, feriados)) {
      const ini = Math.max(cursor, n * DIA + jornada.desde * HORA);
      const fin = n * DIA + jornada.hasta * HORA;
      if (fin > ini) {
        if (resto <= fin - ini) return ini + resto - OFFSET;
        resto -= fin - ini;
      }
    }
    cursor = (n + 1) * DIA;
  }
  throw new Error('No se pudo calcular el vencimiento del SLA');
}

export async function cargarFeriados(db) {
  const filas = await db('feriados').where({ no_habil: true }).select('fecha');
  return new Set(filas.map((f) => String(f.fecha).slice(0, 10)));
}

export const aSql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
export const deSql = (s) => (s instanceof Date ? s.getTime() : Date.parse(`${String(s).replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z'}`));
