import { ref } from '../src/db/helpers.js';

// Cobranzas como carril propio: el plazo de pago se acuerda en el contrato, la factura lo copia al emitirse
// y el equipo de cobranzas deja registro de cada gestión hasta cobrar o pasarle el caso al comercial.
export async function up(knex) {
  await knex.schema.alterTable('contratos', (t) => { t.integer('plazo_pago_dias').unsigned().nullable(); });
  await knex.schema.alterTable('facturas', (t) => {
    t.integer('plazo_pago_dias').unsigned().nullable(); // copia del plazo del contrato al armar la factura
    t.enu('estado_gestion', ['sin_gestion', 'en_gestion', 'promesa', 'escalada']).notNullable().defaultTo('sin_gestion');
    t.date('proxima_gestion').nullable();
    t.integer('escalada_a').unsigned().nullable().references('id').inTable('usuarios');
    t.date('escalada_en').nullable();
  });
  // La regla "factura vencida" pasa de contar días desde la emisión a seguir el semáforo (vencida = pasó el plazo del contrato).
  const vieja = await knex('reglas_alerta').where({ tipo: 'factura_vencida' }).first();
  if (vieja) await knex('reglas_alerta').where({ tipo: 'factura_vencida' }).update({ umbral: 1, unidad: 'días de vencida',
    plantilla_asunto: 'Factura vencida: {cliente} · {periodo}', plantilla_cuerpo: '{cliente} tiene la factura de {periodo}{numero} con un saldo de {saldo}, vencida hace {dias} días (semáforo {color}).' });
  await knex.schema.createTable('gestiones_cobranza', (t) => {
    t.increments('id');
    ref(t, 'factura_id', 'facturas');
    ref(t, 'cliente_id', 'clientes');
    ref(t, 'usuario_id', 'usuarios');
    t.date('fecha').notNullable();
    t.enu('tipo', ['llamada', 'mail', 'whatsapp', 'visita', 'promesa', 'nota', 'escalada', 'retomada']).notNullable();
    t.string('resultado', 80);
    t.text('notas');
    t.date('proxima_gestion').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['factura_id', 'fecha']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('gestiones_cobranza');
  await knex.schema.alterTable('facturas', (t) => { t.dropColumn('escalada_en'); t.dropColumn('escalada_a'); t.dropColumn('proxima_gestion'); t.dropColumn('estado_gestion'); t.dropColumn('plazo_pago_dias'); });
  await knex.schema.alterTable('contratos', (t) => { t.dropColumn('plazo_pago_dias'); });
}
