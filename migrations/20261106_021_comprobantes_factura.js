// Comprobante (PDF) de cada factura emitida a mano: se sube al ERP y el cliente lo ve en su portal. Uno por factura (subir otro lo reemplaza).
export async function up(knex) {
  await knex.schema.createTable('factura_comprobantes', (t) => {
    t.integer('factura_id').unsigned().primary().references('id').inTable('facturas');
    t.string('nombre_original', 255);
    t.integer('bytes').unsigned().notNullable();
    t.string('sha256', 64).notNullable();
    t.integer('subido_por').unsigned().nullable().references('id').inTable('usuarios');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('factura_comprobantes_contenido', (t) => {
    t.integer('factura_id').unsigned().primary().references('id').inTable('facturas');
    t.specificType('contenido', 'longblob').notNullable();
  });
}
export async function down(knex) {
  await knex.schema.dropTableIfExists('factura_comprobantes_contenido');
  await knex.schema.dropTableIfExists('factura_comprobantes');
}
