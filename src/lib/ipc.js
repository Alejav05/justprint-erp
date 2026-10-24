// Ajuste trimestral por IPC. El acumulado es compuesto: (1+a)(1+b)(1+c) − 1.
import { redondear } from './liquidacion.js';

export const mesesHasta = (hasta, n = 3) => {
  let [a, m] = hasta.split('-').map(Number); const out = [];
  for (let i = 0; i < n; i += 1) { out.unshift(`${a}-${String(m).padStart(2, '0')}`); m -= 1; if (m === 0) { m = 12; a -= 1; } }
  return out;
};

/** % acumulado compuesto de una lista de variaciones mensuales (en %). */
export const acumuladoCompuesto = (variaciones) => (variaciones.reduce((f, v) => f * (1 + Number(v) / 100), 1) - 1) * 100;

/** Precios nuevos a partir de la condición vigente. El abono se redondea al centavo y las páginas a 4 decimales, como se guardan. */
export function aplicarAjuste(cond, pct) {
  const f = 1 + pct / 100;
  return { monto_mensual: redondear(Number(cond.monto_mensual) * f), excedente_negro: Math.round(Number(cond.excedente_negro) * f * 1e4) / 1e4, excedente_color: Math.round(Number(cond.excedente_color) * f * 1e4) / 1e4 };
}

export const diaAnterior = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
