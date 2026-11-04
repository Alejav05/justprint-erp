// Amortización de equipos: el costo viaja con el equipo (vida útil de 36 meses) y se carga mes a mes a quien lo tiene; en depósito o taller, a la flota.
export async function up(knex) {
  await knex.schema.alterTable('equipos', (t) => {
    t.decimal('costo_usd', 14, 2).nullable(); // costo en dólares al momento de cargarlo (base de la amortización)
    t.integer('vida_util_meses').unsigned().nullable(); // null = el valor general de Configuración
    t.date('fecha_baja').nullable();
  });
  await knex('equipos').where({ moneda: 'USD' }).whereNotNull('costo_adquisicion').update({ costo_usd: knex.raw('costo_adquisicion') });
  // Los equipos ya dados de baja: la fecha es la del último cambio de estado.
  const bajas = await knex('equipos').where({ estado: 'baja' }).select('id', 'updated_at', 'created_at');
  for (const b of bajas) {
    const f = new Date(b.updated_at ?? b.created_at ?? Date.now());
    await knex('equipos').where({ id: b.id }).update({ fecha_baja: Number.isNaN(f.getTime()) ? null : f.toISOString().slice(0, 10) });
  }
  // El costo "Equipo" cargado a mano al cliente (modelo anterior, todo de una vez) lo reemplaza la amortización.
  await knex('costos').where({ origen: 'equipo' }).whereNull('deleted_at').update({ deleted_at: knex.fn.now() });
}

export async function down(knex) {
  await knex('costos').where({ origen: 'amortizacion' }).del();
  await knex.schema.alterTable('equipos', (t) => { t.dropColumn('costo_usd'); t.dropColumn('vida_util_meses'); t.dropColumn('fecha_baja'); });
}
