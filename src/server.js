import { config } from './config.js';
import { crearDb } from './db.js';
import { crearApp } from './app.js';
import { sincronizarSiguiente } from './lib/feriados.js';

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
