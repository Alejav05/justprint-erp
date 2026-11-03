// Trae el IPC nacional (nivel general, mensual) de la API de series de datos.gob.ar, que publica lo del INDEC.
// La serie trae el nivel del índice; la variación mensual se calcula contra el mes anterior.
export const SERIE_IPC = '145.3_INGNACNAL_DICI_M_15';
const URL_SERIES = 'https://apis.datos.gob.ar/series/api/series/';

/** De los niveles [[AAAA-MM-01, nivel], …] saca las variaciones mensuales en % (1 decimal, como las publica el INDEC). */
export function variaciones(filas) {
  const out = [];
  for (let i = 1; i < filas.length; i += 1) {
    const [f, v] = filas[i]; const previo = filas[i - 1][1];
    if (v == null || previo == null) continue;
    out.push({ periodo: String(f).slice(0, 7), variacion: Math.round((v / previo - 1) * 1000) / 10 });
  }
  return out;
}

/** Las pruebas reemplazan `fuente.fetchFn` para no salir a internet. */
export const fuente = { fetchFn: null };

export async function traerIpc({ desde, fetchFn = fuente.fetchFn ?? fetch } = {}) {
  const [a, m] = desde.split('-').map(Number); const ant = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; // un mes antes, para poder calcular el primero
  const r = await fetchFn(`${URL_SERIES}?ids=${SERIE_IPC}&start_date=${ant}&limit=120&format=json`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`datos.gob.ar respondió ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j.data)) throw new Error('respuesta inesperada de datos.gob.ar');
  return variaciones(j.data).filter((x) => x.periodo >= desde);
}
