import { ref } from '../src/db/helpers.js';

export async function up(knex) {
  await knex.schema.createTable('roles', (t) => {
    t.increments('id');
    t.string('nombre', 60).notNullable().unique();
    t.string('descripcion', 255);
    t.boolean('es_sistema').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('permisos', (t) => {
    t.increments('id');
    t.string('clave', 60).notNullable().unique();
    t.string('modulo', 40).notNullable();
    t.string('descripcion', 255);
  });

  await knex.schema.createTable('rol_permiso', (t) => {
    ref(t, 'rol_id', 'roles');
    ref(t, 'permiso_id', 'permisos');
    t.primary(['rol_id', 'permiso_id']);
  });

  await knex.schema.createTable('areas', (t) => {
    t.increments('id');
    t.string('nombre', 60).notNullable().unique();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('usuarios', (t) => {
    t.increments('id');
    t.string('nombre', 120).notNullable();
    t.string('email', 160).notNullable().unique();
    t.string('password_hash', 120).notNullable();
    ref(t, 'rol_id', 'roles');
    t.boolean('activo').notNullable().defaultTo(true);
    t.timestamp('ultimo_ingreso').nullable();
    t.integer('intentos_fallidos').notNullable().defaultTo(0);
    t.timestamp('bloqueado_hasta').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').unsigned().nullable();
    t.integer('updated_by').unsigned().nullable();
    t.timestamp('deleted_at').nullable();
  });

  await knex.schema.createTable('usuario_area', (t) => {
    t.increments('id');
    ref(t, 'usuario_id', 'usuarios');
    ref(t, 'area_id', 'areas');
    t.enu('funcion', ['miembro', 'lider']).notNullable().defaultTo('miembro');
    t.enu('alcance', ['propio', 'equipo', 'todo']).notNullable().defaultTo('propio');
    t.unique(['usuario_id', 'area_id']);
  });

  // Infraestructura de sesión (no forma parte del modelo de negocio).
  await knex.schema.createTable('sesiones', (t) => {
    t.string('id', 64).primary(); // hash SHA-256 del token
    ref(t, 'usuario_id', 'usuarios');
    t.timestamp('expira_en').notNullable();
    t.string('ip', 64);
    t.string('user_agent', 255);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('numeradores', (t) => {
    t.string('clave', 40).primary();
    t.string('prefijo', 10).notNullable().defaultTo('');
    t.integer('ultimo').unsigned().notNullable().defaultTo(0);
    t.integer('ancho').unsigned().notNullable().defaultTo(5);
  });

  await knex.schema.createTable('archivos', (t) => {
    t.increments('id');
    t.string('entidad_tipo', 40).notNullable();
    t.integer('entidad_id').unsigned().notNullable();
    t.string('ruta', 255).notNullable();
    t.string('nombre_original', 255);
    t.string('mime', 100);
    t.integer('bytes').unsigned();
    t.integer('subido_por').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['entidad_tipo', 'entidad_id']);
  });

  await knex.schema.createTable('audit_log', (t) => {
    t.bigIncrements('id');
    t.integer('usuario_id').unsigned().nullable();
    t.enu('accion', ['crear', 'editar', 'eliminar', 'login', 'login_fallido', 'logout', 'otro']).notNullable();
    t.string('tabla', 60);
    t.string('registro_id', 40);
    t.text('antes');
    t.text('despues');
    t.string('ip', 64);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['tabla', 'registro_id']);
    t.index(['usuario_id', 'created_at']);
  });

  await knex.schema.createTable('reglas_alerta', (t) => {
    t.increments('id');
    t.string('tipo', 60).notNullable().unique();
    t.integer('umbral').nullable();
    t.string('unidad', 20).nullable();
    t.text('destinatarios'); // JSON: funciones que reciben la alerta
    t.text('canales'); // JSON: app, mail
    t.boolean('activa').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('notificaciones', (t) => {
    t.increments('id');
    ref(t, 'usuario_id', 'usuarios');
    ref(t, 'regla_id', 'reglas_alerta', { nula: true });
    t.string('ref_tipo', 40);
    t.integer('ref_id').unsigned();
    t.string('mensaje', 255).notNullable();
    t.boolean('leida').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['usuario_id', 'leida']);
  });
}

export async function down(knex) {
  for (const t of ['notificaciones', 'reglas_alerta', 'audit_log', 'archivos', 'numeradores', 'sesiones',
    'usuario_area', 'usuarios', 'areas', 'rol_permiso', 'permisos', 'roles']) {
    await knex.schema.dropTableIfExists(t);
  }
}
