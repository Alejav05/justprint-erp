// Las fechas de la planilla vienen con un corrimiento de huso horario: Apps Script guardó "medianoche de
// Buenos Aires" (o de UTC) y la hoja la muestra en hora del Pacífico de EE.UU. (UTC-7 en verano, UTC-8 en
// invierno; por eso unas aparecen a las 20:00 y otras a las 19:00, y las de fin de mes figuran como día 29/30).
// Se vuelve al instante real y de ahí al día que quien cargó tenía en mente.
const TZ_PLANILLA = 'America/Los_Angeles';
const TZ_AR = 'America/Argentina/Buenos_Aires';
const DIA = 86400000;

function partes(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
}

function offsetMs(ms, tz) {
  const s = Math.floor(ms / 1000) * 1000;
  const p = partes(s, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - s;
}

/** Reloj de pared (en ms como si fuera UTC) -> instante real, suponiendo que era hora de `tz`. */
function relojAInstante(pared, tz) {
  const primero = pared - offsetMs(pared, tz);
  return pared - offsetMs(primero, tz);
}

const dosDig = (n) => String(n).padStart(2, '0');
const isoDia = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${dosDig(d.getUTCMonth() + 1)}-${dosDig(d.getUTCDate())}`;
};
const isoHora = (ms) => `${isoDia(ms)} ${dosDig(new Date(ms).getUTCHours())}:${dosDig(new Date(ms).getUTCMinutes())}:${dosDig(new Date(ms).getUTCSeconds())}`;

function diaEnArgentina(instante) {
  const p = partes(instante, TZ_AR);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Interpreta un valor de fecha de la planilla (Date de exceljs, cuyo reloj de pared es el que mostraba la hoja).
 * Devuelve { fecha: 'AAAA-MM-DD', momento: 'AAAA-MM-DD hh:mm:ss' (UTC) } o null.
 */
export function interpretarFecha(valor) {
  if (valor == null || valor === '') return null;
  let v = valor;
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    v = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return null;

  const pared = v.getTime();
  if (((pared % DIA) + DIA) % DIA === 0) {
    // Fecha tipeada a mano: medianoche en la hoja, sin corrimiento.
    return { fecha: isoDia(pared), momento: `${isoDia(pared)} 12:00:00` };
  }
  const instante = relojAInstante(pared, TZ_PLANILLA);
  const horaUtc = ((instante % DIA) + DIA) % DIA;
  if (horaUtc === 0 || horaUtc === 3 * 3600000) {
    // Era una fecha sola guardada como medianoche UTC o de Buenos Aires: vale el día UTC.
    return { fecha: isoDia(instante), momento: `${isoDia(instante)} 12:00:00` };
  }
  return { fecha: diaEnArgentina(instante), momento: isoHora(instante) };
}

/** Último día del mes de un período 'AAAA-MM'. */
export function finDePeriodo(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  return isoDia(Date.UTC(a, m, 0));
}
