import { ref, trazabilidad, importe } from '../src/db/helpers.js';

export async function up(knex) {
  await knex.schema.createTable('rubros', (t) => {
    t.increments('id');
    t.integer('parent_id').unsigned().nullable().references('id').inTable('rubros');
    t.string('nombre', 80).notNullable();
    t.boolean('activo').notNullable().defaultTo(true);
    t.integer('orden').notNullable().defaultTo(0);
    t.index(['parent_id']);
  });

  await knex.schema.alterTable('clientes', (t) => {
    t.integer('rubro_id').unsigned().nullable().references('id').inTable('rubros');
    t.integer('subrubro_id').unsigned().nullable().references('id').inTable('rubros');
    t.string('sitio_web', 160);
    t.string('telefono', 40);
    t.string('email_general', 160);
    t.string('domicilio_fiscal', 200);
    t.string('localidad_fiscal', 100);
    t.string('provincia', 60);
    t.integer('cantidad_empleados').unsigned().nullable();
    t.integer('lead_id').unsigned().nullable();
    t.string('motivo_baja', 255);
    t.date('fecha_baja');
  });

  await knex.schema.alterTable('contactos', (t) => {
    t.string('apellido', 120);
    t.date('fecha_nacimiento');
    t.string('linkedin', 200);
    t.text('intereses'); // gustos, familia, hobbies: lo que sirve para fidelizar
  });

  await knex.schema.createTable('leads', (t) => {
    t.increments('id');
    t.string('empresa', 160).notNullable();
    t.string('contacto_nombre', 120);
    t.string('contacto_apellido', 120);
    t.string('cargo', 80);
    t.string('email', 160);
    t.string('telefono', 40);
    t.integer('rubro_id').unsigned().nullable().references('id').inTable('rubros');
    t.integer('subrubro_id').unsigned().nullable().references('id').inTable('rubros');
    t.string('origen', 60);
    t.string('etapa', 20).notNullable().defaultTo('nuevo');
    t.date('etapa_desde');
    t.integer('orden').notNullable().defaultTo(0);
    t.integer('responsable_id').unsigned().nullable();
    importe(t, 'valor_estimado_usd', { nulo: true });
    t.integer('equipos_estimados').unsigned().nullable();
    t.string('proxima_accion', 200);
    t.date('proxima_accion_fecha');
    t.string('motivo_perdida', 255);
    t.integer('cliente_id').unsigned().nullable().references('id').inTable('clientes');
    t.timestamp('cerrado_en').nullable();
    t.text('notas');
    trazabilidad(knex, t);
    t.index(['etapa']);
    t.index(['responsable_id']);
  });

  await knex.schema.createTable('lead_actividades', (t) => {
    t.increments('id');
    ref(t, 'lead_id', 'leads');
    t.integer('usuario_id').unsigned().nullable();
    t.string('tipo', 20).notNullable(); // llamada, mail, whatsapp, visita, reunion, nota, etapa
    t.text('texto');
    t.timestamp('fecha').notNullable().defaultTo(knex.fn.now());
    t.index(['lead_id', 'fecha']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('lead_actividades');
  await knex.schema.dropTableIfExists('leads');
  await knex.schema.alterTable('contactos', (t) => { t.dropColumns('apellido', 'fecha_nacimiento', 'linkedin', 'intereses'); });
  await knex.schema.alterTable('clientes', (t) => {
    t.dropColumns('rubro_id', 'subrubro_id', 'sitio_web', 'telefono', 'email_general', 'domicilio_fiscal', 'localidad_fiscal', 'provincia', 'cantidad_empleados', 'lead_id', 'motivo_baja', 'fecha_baja');
  });
  await knex.schema.dropTableIfExists('rubros');
}
