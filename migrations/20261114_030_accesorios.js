// Accesorios del equipo (bandejas, finishers, etc.): se cargan aparte pero se amortizan junto con el equipo.
export async function up(knex) {
  await knex.schema.alterTable('equipos', (t) => { t.decimal('costo_accesorios', 14, 2).nullable(); });
}
export async function down(knex) {
  await knex.schema.alterTable('equipos', (t) => { t.dropColumn('costo_accesorios'); });
}
