import { ref, trazabilidad, importe } from '../src/db/helpers.js';

export async function up(knex) {
  await knex.schema.createTable('clientes', (t) => {
    t.increments('id');
    t.string('razon_social', 160).notNullable();
    t.string('nombre_comercial', 160);
    t.string('cuit', 13);
    t.enu('condicion_iva', ['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final']).nullable();
    t.string('rubro', 80);
    t.string('tamano', 40);
    t.enu('estado', ['prospecto', 'activo', 'inactivo']).notNullable().defaultTo('prospecto');
    t.string('origen', 60);
    t.date('fecha_alta');
    t.text('notas');
    trazabilidad(knex, t);
    t.index(['estado']);
  });

  await knex.schema.createTable('sedes', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    t.string('nombre', 120).notNullable();
    t.string('domicilio', 200);
    t.string('localidad', 100);
    t.enu('zona', ['caba', 'resto']).notNullable().defaultTo('caba'); // define el SLA del ticket
    t.text('indicaciones');
    t.boolean('es_principal').notNullable().defaultTo(false);
    trazabilidad(knex, t);
  });

  await knex.schema.createTable('contactos', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    ref(t, 'sede_id', 'sedes', { nula: true });
    t.string('nombre', 120).notNullable();
    t.string('cargo', 80);
    t.json('roles'); // decisor, administracion, usuario, tecnico
    t.json('telefonos'); // [{tipo, numero}]
    t.json('emails'); // [{tipo, direccion}]
    t.string('canal_preferido', 30);
    t.string('horario_preferido', 60);
    t.boolean('autorizado_toner').notNullable().defaultTo(false);
    t.boolean('acepta_comunicaciones').notNullable().defaultTo(false);
    t.date('consentimiento_fecha');
    t.string('consentimiento_origen', 60);
    t.date('baja_comunicaciones_fecha');
    t.string('origen', 60);
    t.integer('responsable_id').unsigned().nullable();
    t.enu('estado', ['activo', 'inactivo', 'rebotado']).notNullable().defaultTo('activo');
    t.json('etiquetas');
    t.json('fechas_clave'); // [{tipo, fecha, recordar}]
    t.text('notas');
    trazabilidad(knex, t);
  });

  await knex.schema.createTable('cartera_asignaciones', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    ref(t, 'usuario_id', 'usuarios');
    t.date('desde').notNullable();
    t.date('hasta').nullable(); // null = asignación vigente
    t.integer('asignado_por').unsigned().nullable();
    t.string('motivo', 255);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['cliente_id', 'hasta']);
    t.index(['usuario_id', 'hasta']);
  });

  await knex.schema.createTable('usuario_cliente', (t) => {
    t.increments('id');
    ref(t, 'usuario_id', 'usuarios');
    ref(t, 'cliente_id', 'clientes');
    t.string('motivo', 255);
    t.unique(['usuario_id', 'cliente_id']);
  });

  await knex.schema.createTable('interacciones', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    ref(t, 'contacto_id', 'contactos', { nula: true });
    ref(t, 'usuario_id', 'usuarios');
    t.enu('tipo', ['llamada', 'visita', 'mail', 'whatsapp', 'reunion', 'nota']).notNullable();
    t.timestamp('fecha').notNullable().defaultTo(knex.fn.now());
    t.text('resumen');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['cliente_id', 'fecha']);
  });

  await knex.schema.createTable('oportunidades', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    t.enu('tipo', ['venta', 'renovacion', 'ampliacion']).notNullable().defaultTo('venta');
    t.enu('etapa', ['lead', 'prospecto', 'propuesta', 'ganada', 'perdida']).notNullable().defaultTo('lead');
    importe(t, 'valor_estimado_usd', { nulo: true });
    t.date('cierre_esperado');
    t.string('motivo_perdida', 255);
    t.integer('responsable_id').unsigned().nullable();
    trazabilidad(knex, t);
    t.index(['etapa']);
  });

  await knex.schema.createTable('tareas_crm', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes', { nula: true });
    ref(t, 'contacto_id', 'contactos', { nula: true });
    ref(t, 'oportunidad_id', 'oportunidades', { nula: true });
    ref(t, 'asignado_a', 'usuarios');
    t.string('titulo', 200).notNullable();
    t.date('vence');
    t.enu('estado', ['pendiente', 'hecha', 'cancelada']).notNullable().defaultTo('pendiente');
    t.timestamp('completada_en').nullable();
    trazabilidad(knex, t);
    t.index(['asignado_a', 'estado']);
  });
}

export async function down(knex) {
  for (const t of ['tareas_crm', 'oportunidades', 'interacciones', 'usuario_cliente', 'cartera_asignaciones',
    'contactos', 'sedes', 'clientes']) {
    await knex.schema.dropTableIfExists(t);
  }
}
