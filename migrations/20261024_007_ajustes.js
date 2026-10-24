import { ref } from '../src/db/helpers.js';

export async function up(knex) {
  // Variación mensual del IPC (INDEC), cargada a mano. Es la base de los ajustes trimestrales de los contratos.
  await knex.schema.createTable('indices_ipc', (t) => {
    t.increments('id');
    t.string('periodo', 7).notNullable().unique(); // AAAA-MM del mes al que corresponde el índice
    t.decimal('variacion', 7, 3).notNullable(); // % mensual
    ref(t, 'created_by', 'usuarios', { nula: true });
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  // Un descuento o bonificación manual queda marcado para poder medirlo después (el subtotal se guarda en negativo).
  await knex.schema.alterTable('factura_items', (t) => { t.boolean('bonificacion').notNullable().defaultTo(false); });
}

export async function down(knex) {
  await knex.schema.alterTable('factura_items', (t) => { t.dropColumn('bonificacion'); });
  await knex.schema.dropTableIfExists('indices_ipc');
}
