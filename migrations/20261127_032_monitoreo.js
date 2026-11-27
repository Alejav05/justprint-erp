// Monitoreo de equipos: el agente manda una vez por día el estado de cada impresora de JustPrint del cliente
// (insumos, errores, contadores). Es solo seguimiento: lo que se factura sigue saliendo de `lecturas_contador`.
import { ref } from '../src/db/helpers.js';

export async function up(knex) {
  await knex.schema.createTable('estado_equipos', (t) => {
    t.increments('id');
    ref(t, 'agente_id', 'agentes_contadores');
    ref(t, 'equipo_id', 'equipos');
    t.date('fecha').notNullable(); // un registro por equipo y día; una lectura posterior del mismo día lo actualiza
    t.string('ip', 64).nullable();
    t.string('estado', 20).nullable(); // ok · advertencia · error (hrDeviceStatus)
    t.text('errores'); // JSON: ['atasco', 'sin_toner', …]
    t.string('mensaje', 120).nullable(); // texto del panel del equipo
    t.text('insumos'); // JSON: [{ nombre, tipo, color, nivel, queda_algo }]
    t.integer('contador_negro').unsigned().nullable();
    t.integer('contador_color').unsigned().nullable();
    t.integer('contador_total').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['equipo_id', 'fecha']);
    t.index(['agente_id', 'fecha']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('estado_equipos');
}
