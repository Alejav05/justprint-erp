// El código corto del cliente (CIA) no se puede repetir. Los que quedaron repetidos al renumerar se corrigen y se reescriben los números de sus tickets.
import { codigoLibre, armarNumero } from '../src/lib/numero_ticket.js';

export async function up(knex) {
  const usados = new Set();
  for (const c of await knex('clientes').orderBy('id').select('id', 'razon_social', 'nombre_comercial', 'codigo_corto')) {
    if (c.codigo_corto && !usados.has(c.codigo_corto)) { usados.add(c.codigo_corto); continue; }
    const nuevo = codigoLibre(c.nombre_comercial || c.razon_social, usados);
    usados.add(nuevo);
    await knex('clientes').where({ id: c.id }).update({ codigo_corto: nuevo });
    const tickets = await knex('tickets').where({ cliente_id: c.id }).orderBy([{ column: 'abierto_en' }, { column: 'id' }]).select('id', 'numero');
    let n = 0;
    for (const t of tickets) { n += 1; if (/-CL-\d+-TK\d+$/.test(t.numero)) await knex('tickets').where({ id: t.id }).update({ numero: armarNumero(nuevo, c.id, n) }); }
  }
  await knex.schema.alterTable('clientes', (t) => { t.unique(['codigo_corto']); });
}

export async function down(knex) {
  await knex.schema.alterTable('clientes', (t) => { t.dropUnique(['codigo_corto']); });
}
