import { ref, trazabilidad, importe } from '../src/db/helpers.js';

export async function up(knex) {
  await knex.schema.createTable('tickets', (t) => {
    t.increments('id');
    t.string('numero', 20).notNullable().unique();
    ref(t, 'cliente_id', 'clientes');
    ref(t, 'sede_id', 'sedes', { nula: true });
    ref(t, 'equipo_id', 'equipos', { nula: true });
    t.string('asunto', 200).notNullable();
    t.text('descripcion');
    t.enu('tipo', ['soporte', 'insumos', 'instalacion', 'retiro', 'otro']).notNullable().defaultTo('soporte');
    t.enu('prioridad', ['baja', 'normal', 'alta', 'urgente']).notNullable().defaultTo('normal');
    t.enu('estado', ['abierto', 'asignado', 'en_curso', 'esperando_cliente', 'resuelto', 'cerrado'])
      .notNullable().defaultTo('abierto');
    t.enu('origen', ['telefono', 'mail', 'whatsapp', 'portal', 'qr', 'interno']).notNullable().defaultTo('interno');
    ref(t, 'asignado_a', 'usuarios', { nula: true });
    t.integer('creado_por').unsigned().nullable();
    t.timestamp('abierto_en').notNullable().defaultTo(knex.fn.now());
    t.timestamp('vence_sla').nullable();
    t.timestamp('cerrado_en').nullable();
    // SLA: horas comprometidas según la zona de la sede; corre desde que se abre hasta que se resuelve.
    t.integer('sla_horas').unsigned().nullable();
    t.timestamp('primera_respuesta_en').nullable();
    t.timestamp('resuelto_en').nullable();
    t.decimal('horas_resolucion', 8, 2).nullable();
    t.boolean('sla_cumplido').nullable();
    t.boolean('sla_medible').notNullable().defaultTo(true); // false en lo migrado: no se conocen los tiempos reales
    t.timestamp('visita_en').nullable();
    trazabilidad(knex, t);
    t.index(['estado']);
    t.index(['asignado_a', 'estado']);
    t.index(['cliente_id']);
  });

  // Cada cambio con fecha: de acá salen SLA, primera respuesta y productividad.
  await knex.schema.createTable('feriados', (t) => {
    t.increments('id');
    t.date('fecha').notNullable().unique();
    t.string('nombre', 120).notNullable();
    t.enu('tipo', ['feriado', 'puente']).notNullable().defaultTo('feriado');
    t.boolean('no_habil').notNullable().defaultTo(true); // si el SLA lo saltea
  });

  await knex.schema.createTable('ticket_eventos', (t) => {
    t.bigIncrements('id');
    ref(t, 'ticket_id', 'tickets');
    t.enu('tipo', ['creado', 'asignado', 'primera_respuesta', 'estado', 'comentario']).notNullable();
    t.string('estado_anterior', 30);
    t.string('estado_nuevo', 30);
    t.integer('asignado_a').unsigned().nullable();
    t.integer('usuario_id').unsigned().nullable();
    t.text('comentario');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['ticket_id', 'created_at']);
  });

  await knex.schema.createTable('partes_tecnicos', (t) => {
    t.increments('id');
    ref(t, 'ticket_id', 'tickets');
    ref(t, 'tecnico_id', 'usuarios');
    t.timestamp('inicio').notNullable().defaultTo(knex.fn.now());
    t.timestamp('fin').nullable();
    t.text('diagnostico');
    t.text('trabajo_realizado');
    t.integer('contador_negro').unsigned().nullable();
    t.integer('contador_color').unsigned().nullable();
    t.json('repuestos');
    trazabilidad(knex, t);
  });

  await knex.schema.createTable('proveedores', (t) => {
    t.increments('id');
    t.string('nombre', 160).notNullable();
    t.string('cuit', 13);
    t.string('contacto', 160);
    trazabilidad(knex, t);
  });

  await knex.schema.createTable('insumos', (t) => {
    t.increments('id');
    t.string('codigo', 60).notNullable().unique();
    t.string('descripcion', 200).notNullable();
    t.string('tipo', 40);
    t.json('modelos_compatibles');
    t.integer('stock_minimo').unsigned().notNullable().defaultTo(0);
    importe(t, 'costo_referencia', { nulo: true });
    t.enu('moneda', ['USD', 'ARS']).notNullable().defaultTo('USD');
    trazabilidad(knex, t);
  });

  await knex.schema.createTable('remitos', (t) => {
    t.increments('id');
    t.string('numero', 20).notNullable().unique();
    ref(t, 'cliente_id', 'clientes');
    ref(t, 'sede_id', 'sedes', { nula: true });
    t.enu('tipo', ['entrega', 'servicio', 'mixto']).notNullable().defaultTo('entrega');
    t.date('fecha').notNullable();
    t.enu('estado', ['borrador', 'emitido', 'firmado', 'anulado']).notNullable().defaultTo('borrador');
    ref(t, 'ticket_id', 'tickets', { nula: true });
    ref(t, 'parte_id', 'partes_tecnicos', { nula: true });
    t.text('observaciones');
    trazabilidad(knex, t);
    t.index(['cliente_id', 'fecha']);
  });

  await knex.schema.createTable('remito_items', (t) => {
    t.increments('id');
    ref(t, 'remito_id', 'remitos');
    ref(t, 'insumo_id', 'insumos', { nula: true });
    ref(t, 'equipo_id', 'equipos', { nula: true });
    t.string('descripcion', 200).notNullable();
    t.integer('cantidad').unsigned().notNullable().defaultTo(1);
  });

  await knex.schema.createTable('conformidades', (t) => {
    t.increments('id');
    t.enu('documento_tipo', ['remito', 'parte']).notNullable();
    t.integer('documento_id').unsigned().notNullable();
    t.string('firmante_nombre', 120).notNullable();
    t.string('firmante_cargo', 80);
    t.integer('firma_archivo_id').unsigned().nullable();
    t.boolean('aceptado').notNullable().defaultTo(true);
    t.timestamp('firmado_en').notNullable().defaultTo(knex.fn.now());
    t.string('dispositivo', 255);
    t.string('ip', 64);
    t.index(['documento_tipo', 'documento_id']);
  });

  await knex.schema.createTable('lecturas_contador', (t) => {
    t.increments('id');
    ref(t, 'equipo_id', 'equipos');
    t.date('fecha').notNullable();
    t.integer('contador_negro').unsigned().notNullable().defaultTo(0);
    t.integer('contador_color').unsigned().notNullable().defaultTo(0);
    t.enu('origen', ['tecnico', 'cliente', 'importacion', 'automatica']).notNullable().defaultTo('tecnico');
    t.integer('usuario_id').unsigned().nullable();
    t.integer('foto_archivo_id').unsigned().nullable();
    t.text('observaciones');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['equipo_id', 'fecha']);
  });

  await knex.schema.createTable('movimientos_insumo', (t) => {
    t.increments('id');
    ref(t, 'insumo_id', 'insumos');
    t.timestamp('fecha').notNullable().defaultTo(knex.fn.now());
    t.enu('tipo', ['entrada', 'salida', 'ajuste']).notNullable();
    t.integer('cantidad').notNullable(); // el ajuste puede ser negativo
    ref(t, 'remito_id', 'remitos', { nula: true });
    ref(t, 'parte_id', 'partes_tecnicos', { nula: true });
    t.integer('usuario_id').unsigned().nullable();
    t.string('motivo', 255);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['insumo_id', 'fecha']);
  });

  await knex.schema.createTable('movimientos_equipo', (t) => {
    t.increments('id');
    ref(t, 'equipo_id', 'equipos');
    ref(t, 'ubicacion_origen_id', 'ubicaciones', { nula: true });
    ref(t, 'ubicacion_destino_id', 'ubicaciones', { nula: true });
    t.timestamp('fecha').notNullable().defaultTo(knex.fn.now());
    t.string('motivo', 255);
    t.integer('usuario_id').unsigned().nullable();
    ref(t, 'remito_id', 'remitos', { nula: true });
    t.index(['equipo_id', 'fecha']);
  });
}

export async function down(knex) {
  for (const t of ['movimientos_equipo', 'movimientos_insumo', 'lecturas_contador', 'conformidades', 'remito_items',
    'remitos', 'insumos', 'proveedores', 'partes_tecnicos', 'ticket_eventos', 'feriados', 'tickets']) {
    await knex.schema.dropTableIfExists(t);
  }
}
