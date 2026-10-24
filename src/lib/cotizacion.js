// Cotización del dólar oficial del Banco Nación (vendedor), que es la referencia para medir en USD.
// Se trae de DolarAPI y se guarda una por día. Si la API no responde, queda la última cargada.
import { hoy } from './fechas.js';

const URL_COTIZACION = process.env.COTIZACION_URL || 'https://dolarapi.com/v1/dolares/oficial';

export async function sincronizarCotizacion(db, { buscar = fetch, log = () => {} } = {}) {
  const r = await buscar(URL_COTIZACION, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`DolarAPI respondió ${r.status}`);
  const d = await r.json();
  const valor = Number(d?.venta);
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('Cotización inválida');
  const fecha = hoy();
  const existente = await db('cotizaciones_usd').where({ fecha }).first();
  if (existente) await db('cotizaciones_usd').where({ id: existente.id }).update({ valor, fuente: 'BNA' });
  else await db('cotizaciones_usd').insert({ fecha, valor, fuente: 'BNA' });
  log(`Cotización BNA ${fecha}: ${valor}`);
  return { fecha, valor };
}

export async function ultimaCotizacion(db) {
  const f = await db('cotizaciones_usd').orderBy('fecha', 'desc').first();
  return f ? { fecha: String(f.fecha).slice(0, 10), valor: Number(f.valor), fuente: f.fuente } : null;
}

export async function sincronizarCotizacionSegura(db, log = () => {}) {
  try { await sincronizarCotizacion(db, { log }); } catch (e) { log(`No se pudo traer la cotización: ${e.message}`); }
}
