// Agente de toma de contadores: un programa instalado en la red de cada cliente lee por SNMP los contadores
// de los equipos y los manda al ERP con un token propio. Lo que llega queda registrado en `lecturas_agente`;
// las lecturas limpias pasan solas a `lecturas_contador` (origen 'automatica') y las dudosas esperan revisión.
import { ref, trazabilidad } from '../src/db/helpers.js';

export async function up(knex) {
  await knex.schema.createTable('agentes_contadores', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    t.string('nombre', 120).notNullable();
    t.string('token_hash', 64).notNullable().unique();
    t.string('token_pista', 8).notNullable(); // últimos caracteres, para reconocerlo sin guardarlo
    t.boolean('activo').notNullable().defaultTo(true);
    t.timestamp('ultima_conexion').nullable();
    t.string('ultima_ip', 64).nullable();
    t.string('version', 40).nullable();
    t.string('equipo_host', 120).nullable(); // nombre de la PC donde corre
    trazabilidad(knex, t);
    t.index(['cliente_id']);
  });

  await knex.schema.createTable('lecturas_agente', (t) => {
    t.increments('id');
    ref(t, 'agente_id', 'agentes_contadores');
    ref(t, 'equipo_id', 'equipos', { nula: true });
    t.string('numero_serie', 80).nullable();
    t.string('ip', 64).nullable();
    t.string('marca', 60).nullable();
    t.string('modelo', 120).nullable();
    t.integer('contador_negro').unsigned().nullable();
    t.integer('contador_color').unsigned().nullable();
    t.integer('contador_total').unsigned().nullable();
    t.date('fecha').notNullable();
    t.string('periodo', 7).nullable();
    t.boolean('prueba').notNullable().defaultTo(false);
    // aprobada: ya es una lectura del equipo · a_revisar: espera a una persona · rechazada · no_registrado: el número de serie no es un equipo nuestro de ese cliente · prueba: toma de verificación, no se usa
    t.enu('estado', ['aprobada', 'a_revisar', 'rechazada', 'no_registrado', 'prueba']).notNullable();
    t.string('motivo', 60).nullable();
    t.integer('lectura_id').unsigned().nullable();
    t.integer('revisado_por').unsigned().nullable();
    t.timestamp('revisado_en').nullable();
    t.text('datos'); // lo que mandó el agente, tal cual (JSON)
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['agente_id', 'periodo']);
    t.index(['estado']);
    t.index(['equipo_id', 'periodo']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('lecturas_agente');
  await knex.schema.dropTableIfExists('agentes_contadores');
}
