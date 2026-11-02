// Número de ticket por cliente: CIA-CL-01-TK0002 = código del cliente, su ID y el ticket correlativo de ESE cliente.
const SIN_VALOR = new Set(['SA', 'SRL', 'SAS', 'SCA', 'SH', 'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'CIA', 'COMPANIA', 'THE']);

/** Código corto sugerido (3 letras) a partir del nombre: las primeras letras de la primera palabra con valor. */
export function abreviarCliente(nombre) {
  const palabras = String(nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter((p) => p && !SIN_VALOR.has(p));
  let letras = '';
  for (const p of palabras) { letras += p.replace(/[^A-Z]/g, ''); if (letras.length >= 3) break; }
  return (letras.slice(0, 3) || 'CLI').padEnd(3, 'X');
}

const normalizar = (nombre) => String(nombre ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter((p) => p && !SIN_VALOR.has(p));

/** Candidatos en orden de preferencia: primeras 3 letras, iniciales, 2 letras + inicial de la siguiente palabra, y después combinaciones. */
function* candidatos(nombre) {
  const pal = normalizar(nombre).map((p) => p.replace(/[^A-Z]/g, '')).filter(Boolean);
  yield abreviarCliente(nombre);
  if (pal.length >= 2) {
    yield (pal[0][0] + pal[1][0] + (pal[2]?.[0] ?? pal[1][1] ?? pal[0][1] ?? 'X')).slice(0, 3);
    for (const w of pal.slice(1)) if (pal[0].length >= 2) yield pal[0].slice(0, 2) + w[0];
    for (const w of pal.slice(1)) if (w.length >= 3) yield w.slice(0, 3);
  }
  const base = abreviarCliente(nombre).slice(0, 2);
  for (let i = 0; i < 26; i++) yield base + String.fromCharCode(65 + i);
  for (let i = 0; i < 26 * 26; i++) yield String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)) + base[0];
}

/** Primer candidato que no esté en `usados`. */
export function codigoLibre(nombre, usados) {
  for (const c of candidatos(nombre)) if (!usados.has(c)) return c;
  return abreviarCliente(nombre);
}

/** Código de 3 letras que ningún otro cliente usa todavía. */
export async function codigoUnico(db, nombre, excluirId = 0) {
  const usados = new Set((await db('clientes').whereNotNull('codigo_corto').whereNot({ id: excluirId }).select('codigo_corto')).map((c) => c.codigo_corto));
  return codigoLibre(nombre, usados);
}

export const armarNumero = (codigo, clienteId, n) => `${codigo}-CL-${String(clienteId).padStart(2, '0')}-TK${String(n).padStart(4, '0')}`;

/** Siguiente número de ticket de un cliente. Va dentro de la transacción de quien crea el ticket (el UPDATE bloquea la fila: no se repite). */
export async function numeroTicket(trx, clienteId) {
  const c = await trx('clientes').where({ id: clienteId }).first();
  let codigo = c.codigo_corto;
  if (!codigo) { codigo = await codigoUnico(trx, c.nombre_comercial || c.razon_social, clienteId); await trx('clientes').where({ id: clienteId }).update({ codigo_corto: codigo }); }
  await trx('clientes').where({ id: clienteId }).increment('contador_tickets', 1);
  const { contador_tickets: n } = await trx('clientes').where({ id: clienteId }).first();
  return armarNumero(codigo, clienteId, n);
}
