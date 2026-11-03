// Los contactos importados de la planilla guardaron el mail como tipo "trabajo", que el sistema no reconoce (es "laboral"):
// al editarlos, el guardado fallaba. Se corrige lo ya cargado.
export async function up(knex) {
  const filas = await knex('contactos').whereRaw("emails like '%\"trabajo\"%'").select('id', 'emails');
  for (const f of filas) {
    let lista; try { lista = typeof f.emails === 'string' ? JSON.parse(f.emails) : f.emails; } catch { continue; }
    if (!Array.isArray(lista)) continue;
    await knex('contactos').where({ id: f.id }).update({ emails: JSON.stringify(lista.map((e) => (e.tipo === 'trabajo' ? { ...e, tipo: 'laboral' } : e))) });
  }
}
export async function down() {}
