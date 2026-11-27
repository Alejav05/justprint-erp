// Comunicación con el ERP de JustPrint.
import os from 'node:os';
import { VERSION } from './version.js';

export class ErrorErp extends Error {
  constructor(mensaje, estado, datos) { super(mensaje); this.estado = estado; this.datos = datos; }
}

export function crearErp({ erp_url: url, token }, { fetchFn = globalThis.fetch } = {}) {
  if (!url || !token) throw new ErrorErp('Falta configurar la dirección del ERP o el token (agente-contadores configurar).', 0);
  const base = url.replace(/\/+$/, '');
  async function llamar(metodo, ruta, cuerpo) {
    let r;
    try {
      r = await fetchFn(`${base}${ruta}`, {
        method: metodo, signal: AbortSignal.timeout(30000),
        headers: { authorization: `Bearer ${token}`, 'x-agente-version': VERSION, 'x-agente-host': os.hostname().slice(0, 120), ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    } catch (e) { throw new ErrorErp(`No se pudo conectar con el ERP (${e.cause?.code ?? e.name}).`, 0); }
    const datos = await r.json().catch(() => ({}));
    if (r.status === 401) throw new ErrorErp('El ERP rechazó el token: puede estar desactivado o haber sido renovado.', 401, datos);
    if (!r.ok) throw new ErrorErp(`El ERP respondió ${r.status} (${datos.error ?? 'error'}).`, r.status, datos);
    return datos;
  }
  return {
    config: () => llamar('GET', '/api/agente/v1/config'),
    enviar: (lecturas, { prueba = false, tomada_en } = {}) => llamar('POST', '/api/agente/v1/lecturas', { prueba, tomada_en, lecturas }),
    estado: (equipos) => llamar('POST', '/api/agente/v1/estado', { equipos }),
  };
}
