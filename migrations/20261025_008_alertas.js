import { ref } from '../src/db/helpers.js';

export async function up(knex) {
  await knex.schema.alterTable('usuarios', (t) => { t.string('telefono', 30).nullable(); });

  // Las reglas y notificaciones del modelo original se amplían: umbral, canales y destinatarios ya estaban; se suman frecuencia y texto.
  await knex.schema.alterTable('reglas_alerta', (t) => {
    t.integer('frecuencia_horas').unsigned().notNullable().defaultTo(24); // no repite el aviso del mismo caso antes de esto
    t.string('plantilla_asunto', 200).nullable();
    t.text('plantilla_cuerpo').nullable();
    t.integer('updated_by').unsigned().nullable();
  });

  // Cada vez que una regla se dispara para un caso (un ticket, una factura…): guarda los datos de ese momento.
  await knex.schema.createTable('alertas_eventos', (t) => {
    t.increments('id');
    t.string('regla', 60).notNullable();
    t.string('entidad', 60).notNullable(); // p. ej. "ticket:12"
    t.string('titulo', 200).notNullable();
    t.text('cuerpo').notNullable();
    t.string('destino', 120).nullable(); // enlace dentro del sistema
    t.json('datos');
    t.timestamp('disparada_en').notNullable().defaultTo(knex.fn.now());
    t.index(['regla', 'entidad', 'disparada_en']);
  });

  await knex.schema.createTable('alertas_envios', (t) => {
    t.increments('id');
    ref(t, 'evento_id', 'alertas_eventos');
    ref(t, 'usuario_id', 'usuarios');
    t.enu('canal', ['sistema', 'mail', 'whatsapp']).notNullable();
    t.enu('estado', ['enviado', 'error', 'omitido']).notNullable();
    t.string('detalle', 255).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('notificaciones', (t) => {
    t.integer('evento_id').unsigned().nullable().references('id').inTable('alertas_eventos');
    t.string('titulo', 200).nullable();
    t.text('cuerpo').nullable();
    t.string('destino', 120).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('notificaciones', (t) => { t.dropColumn('evento_id'); t.dropColumn('titulo'); t.dropColumn('cuerpo'); t.dropColumn('destino'); });
  await knex.schema.dropTableIfExists('alertas_envios');
  await knex.schema.dropTableIfExists('alertas_eventos');
  await knex.schema.alterTable('reglas_alerta', (t) => { t.dropColumn('frecuencia_horas'); t.dropColumn('plantilla_asunto'); t.dropColumn('plantilla_cuerpo'); t.dropColumn('updated_by'); });
  await knex.schema.alterTable('usuarios', (t) => { t.dropColumn('telefono'); });
}
