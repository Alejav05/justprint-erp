// Reemplazo de un equipo por falla: el cliente sigue con la cuota del plan original; lo demás lo absorbe la flota.
export async function up(knex) {
  await knex.schema.alterTable('asignaciones_equipo', (t) => {
    t.decimal('cuota_continuada_usd', 14, 2).nullable(); // cuota mensual del equipo reemplazado, que el cliente sigue pagando
    t.string('continua_hasta', 7).nullable(); // último mes (AAAA-MM) del plan original
    t.integer('reemplaza_equipo_id').unsigned().nullable().references('id').inTable('equipos');
    t.string('motivo_reemplazo', 12).nullable(); // perdida | garantia
  });
}
export async function down(knex) {
  await knex.schema.alterTable('asignaciones_equipo', (t) => { t.dropColumn('motivo_reemplazo'); t.dropColumn('reemplaza_equipo_id'); t.dropColumn('continua_hasta'); t.dropColumn('cuota_continuada_usd'); });
}
