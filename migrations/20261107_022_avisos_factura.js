// Registro de los mails que avisan al cliente que ya tiene su factura (con el PDF adjunto).
export async function up(knex) {
  await knex.schema.createTable('factura_avisos', (t) => {
    t.increments('id');
    t.integer('factura_id').unsigned().notNullable().references('id').inTable('facturas');
    t.json('destinatarios');
    t.string('estado', 20).notNullable(); // enviado | error | sin_destinatarios | sin_mail
    t.string('detalle', 255);
    t.integer('enviado_por').unsigned().nullable().references('id').inTable('usuarios');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['factura_id']);
  });
}
export async function down(knex) { await knex.schema.dropTableIfExists('factura_avisos'); }
