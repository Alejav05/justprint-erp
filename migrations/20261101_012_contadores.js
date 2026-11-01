// Toma mensual de contadores: cada lectura puede declarar a qué período de facturación pertenece
// (la lectura de fin de mes suele tomarse la primera semana del mes siguiente). Sin período, vale el mes de su fecha.
export async function up(knex) {
  await knex.schema.alterTable('lecturas_contador', (t) => {
    t.string('periodo', 7).nullable();
    t.index(['equipo_id', 'periodo']);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('lecturas_contador', (t) => {
    t.dropIndex(['equipo_id', 'periodo']);
    t.dropColumn('periodo');
  });
}
