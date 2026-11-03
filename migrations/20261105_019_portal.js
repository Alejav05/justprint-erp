// Portal de clientes: cada persona entra con su mail. El primer ingreso es por un enlace (link mágico) que vale una vez;
// ahí define su contraseña. Dirección puede dar de alta, de baja y mirar el portal como lo ve el cliente.
import { ref } from '../src/db/helpers.js';

export async function up(knex) {
  await knex.schema.createTable('portal_accesos', (t) => {
    t.increments('id');
    ref(t, 'cliente_id', 'clientes');
    t.integer('contacto_id').unsigned().nullable().references('id').inTable('contactos');
    t.string('nombre', 120).notNullable();
    t.string('email', 160).notNullable().unique();
    t.string('password_hash', 120).nullable(); // vacía hasta que el cliente la define
    t.string('estado', 10).notNullable().defaultTo('invitado'); // invitado | activo | baja
    t.timestamp('ultimo_ingreso').nullable();
    t.integer('intentos_fallidos').notNullable().defaultTo(0);
    t.timestamp('bloqueado_hasta').nullable();
    t.integer('created_by').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['cliente_id']);
  });

  // Enlaces de un solo uso. Se guarda solo el hash: quien lea la base no puede entrar.
  await knex.schema.createTable('portal_enlaces', (t) => {
    t.string('id', 64).primary(); // SHA-256 del token
    t.integer('acceso_id').unsigned().notNullable().references('id').inTable('portal_accesos');
    t.string('tipo', 10).notNullable().defaultTo('ingreso'); // ingreso | vista (Dirección mirando como el cliente)
    t.integer('creado_por').unsigned().nullable();
    t.timestamp('expira_en').notNullable();
    t.timestamp('usado_en').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('portal_sesiones', (t) => {
    t.string('id', 64).primary();
    t.integer('acceso_id').unsigned().notNullable().references('id').inTable('portal_accesos');
    t.integer('vista_por').unsigned().nullable(); // usuario del ERP que mira como el cliente: solo lectura
    t.timestamp('expira_en').notNullable();
    t.string('ip', 64);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  for (const t of ['portal_sesiones', 'portal_enlaces', 'portal_accesos']) await knex.schema.dropTableIfExists(t);
}
