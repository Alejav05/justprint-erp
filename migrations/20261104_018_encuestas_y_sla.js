// 1) El SLA corre solo para soporte técnico: las instalaciones, retiros e insumos se programan y no se miden contra el plazo.
// 2) Encuesta de satisfacción que el cliente responde al dar la conformidad (o después, desde el enlace del remito).
export async function up(knex) {
  await knex('tickets').whereNot({ tipo: 'soporte' }).update({ sla_medible: false, sla_horas: null, vence_sla: null, sla_cumplido: null });
  await knex.schema.createTable('encuestas', (t) => {
    t.increments('id');
    t.integer('remito_id').unsigned().notNullable().unique().references('id').inTable('remitos');
    t.integer('ticket_id').unsigned().nullable();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes');
    t.integer('tecnico_id').unsigned().nullable(); // quien atendió: el técnico del ticket o quien emitió el remito
    t.tinyint('puntaje').unsigned().notNullable(); // 1 a 5 estrellas
    t.text('aspectos').nullable(); // JSON: lo que destacó (4-5) o lo que hay que mejorar (1-3)
    t.string('comentario', 1000).nullable();
    t.string('origen', 10).notNullable().defaultTo('equipo'); // equipo (en el celular del técnico) | enlace (desde el remito)
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['tecnico_id', 'created_at']);
    t.index(['cliente_id']);
  });
}
export async function down(knex) { await knex.schema.dropTable('encuestas'); }
