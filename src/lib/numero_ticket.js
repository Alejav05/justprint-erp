// Número de ticket por cliente: CIA-CL-01-TK0002 = código del cliente, su ID y el ticket correlativo de ESE cliente.
const SIN_VALOR = new Set(['SA', 'SRL', 'SAS', 'SCA', 'SH', 'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'CIA', 'COMPANIA', 'THE']);

/** Código corto sugerido (3 letras) a partir del nombre: las primeras letras de la primera palabra con valor. */
export function abreviarCliente(nombre) {
  const palabras = String(nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter((p) => p && !SIN_VALOR.has(p));
  let letras = '';
  for (const p of palabras) { letras += p.replace(/[^A-Z]/g, ''); if (letras.length >= 3) break; }
  return (letras.slice(0, 3) || 'CLI').padEnd(3, 'X');
}

export const armarNumero = (codigo, clienteId, n) => `${codigo}-CL-${String(clienteId).padStart(2, '0')}-TK${String(n).padStart(4, '0')}`;

/** Siguiente número de ticket de un cliente. Va dentro de la transacción de quien crea el ticket (el UPDATE bloquea la fila: no se repite). */
export async function numeroTicket(trx, clienteId) {
  const c = await trx('clientes').where({ id: clienteId }).first();
  let codigo = c.codigo_corto;
  if (!codigo) { codigo = abreviarCliente(c.nombre_comercial || c.razon_social); await trx('clientes').where({ id: clienteId }).update({ codigo_corto: codigo }); }
  await trx('clientes').where({ id: clienteId }).increment('contador_tickets', 1);
  const { contador_tickets: n } = await trx('clientes').where({ id: clienteId }).first();
  return armarNumero(codigo, clienteId, n);
}
