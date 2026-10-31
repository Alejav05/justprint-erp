/** CUIT/CUIL argentino: 11 dígitos con dígito verificador (módulo 11). Devuelve XX-XXXXXXXX-X o null si no es válido. */
export function normalizarCuit(texto) {
  const d = String(texto ?? '').replace(/\D/g, '');
  if (d.length !== 11) return null;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((a, p, i) => a + p * Number(d[i]), 0);
  let v = 11 - (suma % 11); if (v === 11) v = 0; if (v === 10) v = 9;
  if (v !== Number(d[10])) return null;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d[10]}`;
}
