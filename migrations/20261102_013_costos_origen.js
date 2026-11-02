// De dónde salió cada costo: cargado a mano, importado de la planilla o generado por un remito de insumos.
export async function up(knex) {
  await knex.schema.alterTable('costos', (t) => {
    t.string('origen', 12).notNullable().defaultTo('manual');
    t.integer('remito_id').unsigned().nullable().references('id').inTable('remitos');
    t.index(['remito_id']);
  });
  await knex('costos').update({ origen: 'importacion' });
}

export async function down(knex) {
  await knex.schema.alterTable('costos', (t) => {
    t.dropIndex(['remito_id']);
    t.dropColumn('remito_id');
    t.dropColumn('origen');
  });
}
