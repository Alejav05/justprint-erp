// Remitos con numeración 0001-00000001, enlace público para el cliente, conformidad digital (firma guardada en la base),
// remito firmado en papel escaneado y registro de los envíos. Todo en la base: viaja con el backup y no se pierde al desplegar.
import crypto from 'node:crypto';

export async function up(knex) {
  await knex.schema.alterTable('remitos', (t) => { t.string('token', 40).nullable().unique(); });
  for (const r of await knex('remitos').select('id', 'numero')) {
    const numero = /^\d+$/.test(r.numero) ? `0001-${r.numero.padStart(8, '0')}` : r.numero;
    await knex('remitos').where({ id: r.id }).update({ numero, token: crypto.randomBytes(16).toString('hex') });
  }
  // Si el numerador todavía no existe (instalación nueva), lo crea el seed con el formato nuevo.
  await knex('numeradores').where({ clave: 'remito' }).update({ prefijo: '0001-', ancho: 8 });

  await knex.schema.alterTable('conformidades', (t) => {
    t.string('metodo', 10).notNullable().defaultTo('digital'); // digital (firma en pantalla) | papel (escaneo del remito firmado)
    t.string('firmante_dni', 20).nullable();
    t.string('firmante_email', 160).nullable();
    t.string('firmante_telefono', 40).nullable();
  });
  await knex.schema.createTable('conformidad_firmas', (t) => {
    t.integer('conformidad_id').unsigned().primary().references('id').inTable('conformidades');
    t.specificType('png', 'longblob').notNullable();
  });
  await knex.schema.createTable('remito_escaneos', (t) => {
    t.increments('id');
    t.integer('remito_id').unsigned().notNullable().references('id').inTable('remitos');
    t.string('mime', 40).notNullable();
    t.string('nombre_original', 255);
    t.integer('bytes').unsigned().notNullable();
    t.integer('subido_por').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['remito_id']);
  });
  await knex.schema.createTable('remito_escaneos_contenido', (t) => {
    t.integer('escaneo_id').unsigned().primary().references('id').inTable('remito_escaneos');
    t.specificType('contenido', 'longblob').notNullable();
  });
  await knex.schema.createTable('remito_envios', (t) => {
    t.increments('id');
    t.integer('remito_id').unsigned().notNullable().references('id').inTable('remitos');
    t.string('canal', 12).notNullable(); // mail | whatsapp
    t.string('destino', 160).notNullable();
    t.string('resultado', 12).notNullable(); // enviado | error | manual (se abrió el mail o WhatsApp del usuario)
    t.string('detalle', 255);
    t.integer('usuario_id').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['remito_id']);
  });
}

export async function down(knex) {
  for (const t of ['remito_envios', 'remito_escaneos_contenido', 'remito_escaneos', 'conformidad_firmas']) await knex.schema.dropTableIfExists(t);
  await knex.schema.alterTable('conformidades', (t) => { t.dropColumn('metodo'); t.dropColumn('firmante_dni'); t.dropColumn('firmante_email'); t.dropColumn('firmante_telefono'); });
  await knex.schema.alterTable('remitos', (t) => { t.dropColumn('token'); });
}
