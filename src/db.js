import knex from 'knex';
import knexfile from '../knexfile.js';
import { config } from './config.js';

export function crearDb(entorno = config.env) {
  const cfg = knexfile[entorno];
  if (!cfg) throw new Error(`Entorno de base de datos desconocido: ${entorno}`);
  return knex(cfg);
}
