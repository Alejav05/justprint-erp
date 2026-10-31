export async function up(knex) {
  // Valores del sistema que edita quien administra (plazos, módulos visibles, textos de marca…). Una fila por clave.
  await knex.schema.createTable('configuracion', (t) => {
    t.string('clave', 80).primary();
    t.text('valor').notNullable(); // JSON
    t.integer('updated_by').unsigned().nullable();
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}
export async function down(knex) { await knex.schema.dropTableIfExists('configuracion'); }
