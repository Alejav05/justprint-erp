import { ref, trazabilidad, importe } from '../src/db/helpers.js';

export async function up(knex) {
  await knex.schema.createTable('entidades_facturantes', (t) => {
    t.increments('id');
    t.string('razon_social', 160).notNullable();
    t.string('cuit', 13).notNullable();
    t.integer('punto_venta').unsigned();
    t.string('condicion_iva', 40);
    t.boolean('activa').notNullable().defaultTo(true);
    trazabilidad(knex, t);
  });

  await knex.schema.createTable('contratos', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    ref(t, 'sede_id', 'sedes', { nula: true });
    t.string('nombre', 160).notNullable();
    t.enu('estado', ['borrador', 'vigente', 'vencido', 'rescindido']).notNullable().defaultTo('borrador');
    t.date('fecha_inicio');
    t.integer('duracion_meses').unsigned();
    t.enu('moneda', ['USD', 'ARS']).notNullable().defaultTo('USD');
    ref(t, 'entidad_facturante_id', 'entidades_facturantes', { nula: true });
    t.text('notas');
    trazabilidad(knex, t);
    t.index(['cliente_id', 'estado']);
  });

  // Cada cambio de precio es una fila nueva: la historia no se pisa.
  await knex.schema.createTable('contrato_condiciones', (t) => {
    t.increments('id');
    ref(t, 'contrato_id', 'contratos');
    t.date('vigente_desde').notNullable();
    t.date('vigente_hasta').nullable();
    importe(t, 'monto_mensual');
    t.integer('franquicia_negro').unsigned().notNullable().defaultTo(0);
    t.integer('franquicia_color').unsigned().notNullable().defaultTo(0);
    importe(t, 'excedente_negro', { escala: 4 });
    importe(t, 'excedente_color', { escala: 4 });
    // Trazabilidad de cada cambio: por qué, cuánto y a qué valor en dólares (la referencia para medir al cliente).
    t.enu('motivo', ['alta', 'ajuste_ipc', 'renegociacion', 'sin_facturar', 'otro']).notNullable().defaultTo('alta');
    t.decimal('ajuste_pct', 7, 3).nullable();
    importe(t, 'monto_usd_referencia', { nulo: true });
    importe(t, 'cotizacion_referencia', { nulo: true, escala: 4 });
    t.boolean('facturable').notNullable().defaultTo(true); // false = se presta el servicio pero no se factura
    t.string('notas', 255);
    t.integer('creado_por').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['contrato_id', 'vigente_desde']);
  });

  await knex.schema.createTable('cotizaciones', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    t.integer('version').unsigned().notNullable().defaultTo(1);
    t.enu('estado', ['borrador', 'enviada', 'aceptada', 'rechazada', 'vencida']).notNullable().defaultTo('borrador');
    t.json('items');
    t.date('validez_hasta');
    importe(t, 'total');
    t.enu('moneda', ['USD', 'ARS']).notNullable().defaultTo('USD');
    ref(t, 'contrato_id', 'contratos', { nula: true });
    trazabilidad(knex, t);
  });
}

export async function down(knex) {
  for (const t of ['cotizaciones', 'contrato_condiciones', 'contratos', 'entidades_facturantes']) {
    await knex.schema.dropTableIfExists(t);
  }
}
