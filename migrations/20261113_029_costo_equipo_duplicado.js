// El costo del equipo que se había cargado de una vez como costo ("Equipo nuevo...", tipo Amortización o Equipo) queda reemplazado por la amortización mensual:
// si no, el equipo se contaría dos veces. Se dan de baja (borrado lógico, se pueden recuperar) solo los de equipos que ya tienen su costo cargado.
export async function up(knex) {
  const ids = (await knex('equipos').whereNotNull('costo_adquisicion').where('costo_adquisicion', '>', 0).select('id')).map((x) => x.id);
  if (!ids.length) return;
  await knex('costos').whereIn('equipo_id', ids).whereIn('tipo', ['amortizacion', 'equipo']).whereNot('origen', 'amortizacion').whereNull('deleted_at').update({ deleted_at: knex.fn.now() });
}
export async function down() {}
