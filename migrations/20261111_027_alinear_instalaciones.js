// Una instalación cargada con un día de diferencia respecto del inicio de su contrato (por la hora del servidor) se alinea con el contrato.
// Solo toca la primera asignación de cada equipo y solo cuando la diferencia es de exactamente un día; mueve con ella la lectura de instalación.
import { aDia } from '../src/lib/fechas.js';

const dias = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

export async function up(knex) {
  const filas = await knex('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').whereNotNull('c.fecha_inicio').select('a.id', 'a.equipo_id', 'a.desde', 'c.fecha_inicio');
  const primera = new Map();
  for (const f of filas) { const p = primera.get(f.equipo_id); if (!p || aDia(f.desde) < aDia(p.desde)) primera.set(f.equipo_id, f); }
  for (const f of primera.values()) {
    const d = aDia(f.desde); const ini = aDia(f.fecha_inicio); if (!d || !ini || Math.abs(dias(d) - dias(ini)) !== 1) continue;
    await knex('asignaciones_equipo').where({ id: f.id }).update({ desde: ini });
    await knex('lecturas_contador').where({ equipo_id: f.equipo_id }).whereRaw('date(fecha) = ?', [d]).update({ fecha: ini });
  }
}
export async function down() {}
