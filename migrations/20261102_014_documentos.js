// Documentación firmada de los contratos: el contrato original, anexos, adendas. Cada contrato puede tener los que haga falta.
// El PDF se guarda en la base (tabla aparte, para que las listas no lo carguen): así viaja con el backup diario y
// no depende de una carpeta del servidor que se pierda al desplegar.
export async function up(knex) {
  await knex.schema.createTable('contrato_documentos', (t) => {
    t.increments('id');
    t.integer('contrato_id').unsigned().notNullable().references('id').inTable('contratos');
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes');
    t.string('tipo', 12).notNullable().defaultTo('contrato'); // contrato | anexo | adenda | otro
    t.string('titulo', 160).notNullable();
    t.date('fecha_documento').nullable(); // fecha de firma
    t.text('notas');
    t.string('nombre_original', 255);
    t.integer('bytes').unsigned().notNullable();
    t.string('sha256', 64).notNullable();
    t.integer('subido_por').unsigned().nullable().references('id').inTable('usuarios');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at').nullable();
    t.integer('eliminado_por').unsigned().nullable();
    t.index(['contrato_id']);
    t.index(['cliente_id']);
  });
  await knex.schema.createTable('contrato_documentos_contenido', (t) => {
    t.integer('documento_id').unsigned().primary().references('id').inTable('contrato_documentos');
    t.specificType('contenido', 'longblob').notNullable();
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('contrato_documentos_contenido');
  await knex.schema.dropTableIfExists('contrato_documentos');
}
