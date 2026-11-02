// Los tickets pasan a numerarse por cliente: CIA-CL-01-TK0002. Cada cliente lleva su código corto y su propio contador.
// Los tickets que ya existían se renumeran por cliente, en orden de apertura; el número viejo queda guardado para poder buscarlo.
import { abreviarCliente, armarNumero } from '../src/lib/numero_ticket.js';

export async function up(knex) {
  await knex.schema.alterTable('clientes', (t) => { t.string('codigo_corto', 6).nullable(); t.integer('contador_tickets').unsigned().notNullable().defaultTo(0); });
  await knex.schema.alterTable('tickets', (t) => { t.string('numero_anterior', 20).nullable(); });
  for (const c of await knex('clientes').select('id', 'razon_social', 'nombre_comercial')) {
    const codigo = abreviarCliente(c.nombre_comercial || c.razon_social);
    const tickets = await knex('tickets').where({ cliente_id: c.id }).orderBy([{ column: 'abierto_en' }, { column: 'id' }]).select('id', 'numero');
    let n = 0;
    for (const t of tickets) {
      n += 1; const nuevo = armarNumero(codigo, c.id, n);
      await knex('tickets').where({ id: t.id }).update({ numero: nuevo, numero_anterior: t.numero });
      await knex('notificaciones').where('mensaje', 'like', `%${t.numero}%`).update({ mensaje: knex.raw('replace(mensaje, ?, ?)', [t.numero, nuevo]) });
    }
    await knex('clientes').where({ id: c.id }).update({ codigo_corto: codigo, contador_tickets: n });
  }
}

export async function down(knex) {
  await knex.schema.alterTable('tickets', (t) => { t.dropColumn('numero_anterior'); });
  await knex.schema.alterTable('clientes', (t) => { t.dropColumn('codigo_corto'); t.dropColumn('contador_tickets'); });
}
