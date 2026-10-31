// Semáforo de cobranzas. Verde: dentro del plazo acordado. Amarillo: venció hace poco (días de gracia). Rojo: pasó la gracia.
import { aDia } from './fechas.js';
import { valor } from './ajustes_sistema.js';

// Valores de fábrica; los vigentes se editan en Configuración.
export const plazoDefecto = () => valor('cobranzas.plazo_defecto_dias') ?? 15;
export const gracia = () => valor('cobranzas.gracia_dias') ?? 15;

const MS = 86400000;
export const dias = (desde, hasta) => Math.round((Date.parse(hasta) - Date.parse(desde)) / MS);
export const sumarDias = (iso, n) => new Date(Date.parse(iso) + n * MS).toISOString().slice(0, 10);

/** Plazo vigente de una factura: su copia, si no el del contrato, si no el de fábrica. */
export const plazoDe = (f, contrato) => f.plazo_pago_dias ?? contrato?.plazo_pago_dias ?? plazoDefecto();

/** Vencimiento: el fijado a mano o, si no, emisión + plazo. */
export function vencimientoDe(f, contrato) {
  const venc = aDia(f.vencimiento); if (venc) return venc;
  const emi = aDia(f.fecha_emision); return emi ? sumarDias(emi, plazoDe(f, contrato)) : null;
}

/** { color, vence, dias_vencida (negativo = faltan) } */
export function semaforo(f, hoy, contrato) {
  const vence = vencimientoDe(f, contrato); if (!vence) return { color: 'verde', vence: null, dias_vencida: 0 };
  const d = dias(vence, hoy);
  return { color: d <= 0 ? 'verde' : d <= gracia() ? 'amarillo' : 'rojo', vence, dias_vencida: d };
}
