// Trae los feriados del año actual y el siguiente. El servidor ya lo hace solo; esto es para correrlo a mano.
import 'dotenv/config';
import { crearDb } from '../src/db.js';
import { sincronizarSiguiente } from '../src/lib/feriados.js';

const db = crearDb();
await sincronizarSiguiente(db, console.log);
await db.destroy();
