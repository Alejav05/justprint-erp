// Encuesta de satisfacción: 1 a 5 estrellas, qué destacó o qué mejorar, y un comentario libre. Una por remito.
import { z } from 'zod';

export const ASPECTOS = [
  { clave: 'puntualidad', texto: 'Puntualidad' },
  { clave: 'trato', texto: 'Trato' },
  { clave: 'resolucion', texto: 'Que quedó resuelto' },
  { clave: 'claridad', texto: 'Claridad en las explicaciones' },
  { clave: 'orden', texto: 'Orden y limpieza' },
];
const CLAVES = ASPECTOS.map((a) => a.clave);
export const textoAspecto = (c) => ASPECTOS.find((a) => a.clave === c)?.texto ?? c;

export const encuestaSchema = z.object({
  puntaje: z.coerce.number().int().min(1).max(5),
  aspectos: z.array(z.enum(CLAVES)).max(CLAVES.length).default([]),
  comentario: z.string().trim().max(1000).optional().transform((v) => v || undefined),
});

/** Guarda la encuesta del remito. Devuelve false si ya estaba respondida. */
export async function guardarEncuesta(db, remito, d, origen) {
  if (await db('encuestas').where({ remito_id: remito.id }).first()) return false;
  const ticket = remito.ticket_id ? await db('tickets').where({ id: remito.ticket_id }).select('asignado_a').first() : null;
  await db('encuestas').insert({
    remito_id: remito.id, ticket_id: remito.ticket_id ?? null, cliente_id: remito.cliente_id,
    tecnico_id: ticket?.asignado_a ?? remito.created_by ?? null, puntaje: d.puntaje,
    aspectos: JSON.stringify([...new Set(d.aspectos)]), comentario: d.comentario ?? null, origen,
  });
  return true;
}

export const leerEncuesta = async (db, remitoId) => {
  const e = await db('encuestas').where({ remito_id: remitoId }).first();
  return e ? { puntaje: e.puntaje, aspectos: JSON.parse(e.aspectos || '[]'), comentario: e.comentario, created_at: e.created_at } : null;
};
