import { ref, trazabilidad, importe } from '../src/db/helpers.js';

export async function up(knex) {
  // Historia de la cotización del dólar que se toma de referencia.
  await knex.schema.createTable('cotizaciones_usd', (t) => {
    t.increments('id');
    t.date('fecha').notNullable().unique();
    importe(t, 'valor', { escala: 4 });
    t.string('fuente', 40);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // Facturado y cobrado separados: la factura tiene su estado y fecha de emisión;
  // el cobro tiene su propia fecha y se aplica a una o más facturas.
  await knex.schema.createTable('facturas', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    ref(t, 'contrato_id', 'contratos', { nula: true });
    ref(t, 'entidad_facturante_id', 'entidades_facturantes', { nula: true });
    t.string('tipo_comprobante', 5);
    t.integer('punto_venta').unsigned();
    t.string('numero', 20);
    t.string('periodo', 7).notNullable(); // AAAA-MM
    t.date('fecha_emision').nullable(); // vacía mientras es borrador
    t.boolean('fecha_emision_estimada').notNullable().defaultTo(false); // migradas de la planilla
    t.date('vencimiento');
    t.enu('moneda', ['USD', 'ARS']).notNullable().defaultTo('USD');
    importe(t, 'tipo_cambio', { nulo: true, escala: 4 });
    importe(t, 'neto');
    importe(t, 'iva');
    importe(t, 'total');
    importe(t, 'neto_usd', { nulo: true }); // valor de referencia en dólares, para la evolución del cliente
    t.enu('estado', ['borrador', 'emitida', 'cobrada_parcial', 'cobrada', 'anulada']).notNullable().defaultTo('borrador');
    t.string('cae', 20);
    t.date('cae_vto');
    t.integer('comprobante_archivo_id').unsigned().nullable();
    trazabilidad(knex, t);
    t.index(['cliente_id', 'periodo']);
    t.index(['estado']);
  });

  await knex.schema.createTable('factura_items', (t) => {
    t.increments('id');
    ref(t, 'factura_id', 'facturas');
    // Una factura puede mezclar abono y ventas directas (equipo, insumo, soporte).
    t.enu('tipo', ['abono', 'excedente', 'equipo', 'insumo', 'servicio', 'otro']).notNullable().defaultTo('abono');
    ref(t, 'insumo_id', 'insumos', { nula: true });
    ref(t, 'equipo_id', 'equipos', { nula: true });
    ref(t, 'ticket_id', 'tickets', { nula: true });
    ref(t, 'remito_id', 'remitos', { nula: true });
    t.string('descripcion', 200).notNullable();
    t.decimal('cantidad', 10, 2).notNullable().defaultTo(1);
    importe(t, 'precio_unitario', { escala: 4 });
    t.decimal('alicuota_iva', 5, 2).notNullable().defaultTo(21);
    importe(t, 'subtotal');
  });

  await knex.schema.createTable('cobros', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    t.date('fecha_cobro').notNullable();
    t.enu('medio', ['transferencia', 'efectivo', 'cheque', 'mercadopago', 'otro']).notNullable().defaultTo('transferencia');
    importe(t, 'importe');
    t.enu('moneda', ['USD', 'ARS']).notNullable().defaultTo('USD');
    t.string('referencia', 120);
    trazabilidad(knex, t);
    t.index(['cliente_id', 'fecha_cobro']);
  });

  await knex.schema.createTable('cobro_aplicaciones', (t) => {
    t.increments('id');
    ref(t, 'cobro_id', 'cobros');
    ref(t, 'factura_id', 'facturas');
    importe(t, 'importe');
  });

  await knex.schema.createTable('costos', (t) => {
    t.increments('id');
    ref(t, 'proveedor_id', 'proveedores', { nula: true });
    t.date('fecha').notNullable();
    t.string('concepto', 200).notNullable();
    t.string('tipo', 40);
    importe(t, 'importe');
    t.enu('moneda', ['USD', 'ARS']).notNullable().defaultTo('USD');
    importe(t, 'cotizacion', { nulo: true, escala: 4 });
    importe(t, 'importe_usd');
    ref(t, 'cliente_id', 'clientes', { nula: true });
    ref(t, 'equipo_id', 'equipos', { nula: true });
    ref(t, 'contrato_id', 'contratos', { nula: true });
    ref(t, 'ticket_id', 'tickets', { nula: true });
    ref(t, 'insumo_id', 'insumos', { nula: true });
    t.integer('comprobante_archivo_id').unsigned().nullable();
    trazabilidad(knex, t);
    t.index(['cliente_id', 'fecha']);
  });
}

export async function down(knex) {
  for (const t of ['costos', 'cobro_aplicaciones', 'cobros', 'factura_items', 'facturas', 'cotizaciones_usd']) {
    await knex.schema.dropTableIfExists(t);
  }
}
