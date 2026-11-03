// IPC automático con revisión manual: cada índice dice de dónde vino y si una persona lo revisó.
// Cada contrato en pesos puede tener su propio acuerdo de ajuste (cada cuántos meses y desde qué mes de servicio rige el último).
export async function up(knex) {
  await knex.schema.alterTable('indices_ipc', (t) => { t.string('fuente', 10).notNullable().defaultTo('manual'); t.boolean('revisado').notNullable().defaultTo(false); });
  await knex('indices_ipc').update({ revisado: true }); // lo que ya estaba cargado a mano se toma como revisado
  await knex.schema.alterTable('contratos', (t) => { t.integer('ajuste_ipc_meses').nullable(); t.string('ajuste_ipc_base', 7).nullable(); });
  // Los contratos que ya tuvieron un ajuste por IPC siguen el mismo ritmo (trimestral) a partir del último.
  const filas = await knex('contrato_condiciones as k').join('contratos as c', 'c.id', 'k.contrato_id')
    .where({ 'k.motivo': 'ajuste_ipc', 'c.moneda': 'ARS' }).whereNull('c.deleted_at').groupBy('k.contrato_id').select('k.contrato_id').max({ ultimo: 'k.vigente_desde' });
  for (const f of filas) {
    const d = f.ultimo instanceof Date ? f.ultimo.toISOString() : String(f.ultimo);
    await knex('contratos').where({ id: f.contrato_id }).update({ ajuste_ipc_meses: 3, ajuste_ipc_base: d.slice(0, 7) });
  }
}
export async function down(knex) {
  await knex.schema.alterTable('contratos', (t) => { t.dropColumn('ajuste_ipc_meses'); t.dropColumn('ajuste_ipc_base'); });
  await knex.schema.alterTable('indices_ipc', (t) => { t.dropColumn('fuente'); t.dropColumn('revisado'); });
}
