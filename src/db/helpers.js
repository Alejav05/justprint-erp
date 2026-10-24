// Helpers compartidos por las migraciones.

/** Columnas de trazabilidad y baja lógica para tablas de negocio. */
export function trazabilidad(knex, t) {
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  t.integer('created_by').unsigned().nullable();
  t.integer('updated_by').unsigned().nullable();
  t.timestamp('deleted_at').nullable();
}

/** Clave foránea a `tabla.id`. */
export function ref(t, columna, tabla, { nula = false } = {}) {
  const c = t.integer(columna).unsigned();
  if (nula) c.nullable(); else c.notNullable();
  c.references('id').inTable(tabla);
  return c;
}

/** Importe monetario: DECIMAL, nunca punto flotante. */
export const importe = (t, nombre, { nulo = false, escala = 2 } = {}) => {
  const c = t.decimal(nombre, 14, escala);
  if (nulo) c.nullable(); else c.notNullable().defaultTo(0);
  return c;
};
