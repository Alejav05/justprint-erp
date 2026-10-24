import { ref, trazabilidad, importe } from '../src/db/helpers.js';

export async function up(knex) {
  await knex.schema.createTable('modelos_equipo', (t) => {
    t.increments('id');
    t.string('marca', 60).notNullable();
    t.string('modelo', 80).notNullable();
    t.enu('tipo', ['monocromo', 'color']).notNullable();
    t.integer('velocidad_ppm').unsigned();
    t.json('insumos_compatibles');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['marca', 'modelo']);
  });

  await knex.schema.createTable('ubicaciones', (t) => {
    t.increments('id');
    t.string('nombre', 80).notNullable().unique();
    t.enu('tipo', ['deposito', 'taller', 'transito']).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('equipos', (t) => {
    t.increments('id');
    ref(t, 'modelo_id', 'modelos_equipo');
    t.string('numero_serie', 80).notNullable().unique();
    t.string('codigo_qr', 80).unique();
    t.enu('estado', ['deposito', 'instalado', 'reparacion', 'baja']).notNullable().defaultTo('deposito');
    ref(t, 'ubicacion_id', 'ubicaciones', { nula: true });
    t.date('fecha_adquisicion');
    importe(t, 'costo_adquisicion', { nulo: true });
    t.enu('moneda', ['USD', 'ARS']).notNullable().defaultTo('USD');
    t.text('observaciones');
    trazabilidad(knex, t);
    t.index(['estado']);
  });

  // Historia del equipo: dónde estuvo, con qué contrato y con qué contadores.
  await knex.schema.createTable('asignaciones_equipo', (t) => {
    t.increments('id');
    ref(t, 'equipo_id', 'equipos');
    ref(t, 'contrato_id', 'contratos');
    ref(t, 'sede_id', 'sedes', { nula: true });
    t.date('desde').notNullable();
    t.date('hasta').nullable(); // null = instalado hoy
    t.integer('contador_inicial_negro').unsigned().notNullable().defaultTo(0);
    t.integer('contador_inicial_color').unsigned().notNullable().defaultTo(0);
    t.integer('contador_final_negro').unsigned().nullable();
    t.integer('contador_final_color').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['equipo_id', 'hasta']);
    t.index(['contrato_id', 'hasta']);
  });
}

export async function down(knex) {
  for (const t of ['asignaciones_equipo', 'equipos', 'ubicaciones', 'modelos_equipo']) {
    await knex.schema.dropTableIfExists(t);
  }
}
