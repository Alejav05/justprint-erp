import { config } from './config.js';
import { crearDb } from './db.js';
import { crearApp } from './app.js';
import { sincronizarSiguiente } from './lib/feriados.js';
import { sincronizarCotizacionSegura } from './lib/cotizacion.js';
import { ejecutarAlertas } from './lib/alertas.js';

// Sin await de nivel superior: el loader de Hostinger (lsnode) carga este archivo con require(),
// y require() no admite módulos ESM con top-level await.
async function main() {
  const db = crearDb();
  const app = await crearApp({ db, logger: true });

  const cerrar = async () => { await app.close(); await db.destroy(); process.exit(0); };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);

  await app.listen({ port: config.port, host: config.host });

  // Feriados (para el SLA): al arrancar y cada 24 horas. Sin conexión, quedan los ya cargados.
  const log = (m) => app.log.info(m);
  sincronizarSiguiente(db, log);
  setInterval(() => sincronizarSiguiente(db, log), 24 * 3600 * 1000).unref();

  // Cotización del dólar BNA: al arrancar y cada 6 horas.
  sincronizarCotizacionSegura(db, log);
  setInterval(() => sincronizarCotizacionSegura(db, log), 6 * 3600 * 1000).unref();

  // Alertas: se evalúan cada 15 minutos. Un mismo caso no se repite antes de la frecuencia de su regla.
  const correrAlertas = () => ejecutarAlertas(db).catch((e) => app.log.error({ err: e }, 'alertas'));
  setTimeout(correrAlertas, 60 * 1000).unref();
  setInterval(correrAlertas, 15 * 60 * 1000).unref();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
