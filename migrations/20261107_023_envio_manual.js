// Seguimiento del envío de cada factura al cliente: además del aviso automático, se puede dejar asentado un envío hecho a mano (con su fecha).
export async function up(knex) {
  await knex.schema.alterTable('factura_avisos', (t) => { t.date('enviado_el').nullable(); });
}
export async function down(knex) { await knex.schema.alterTable('factura_avisos', (t) => { t.dropColumn('enviado_el'); }); }
