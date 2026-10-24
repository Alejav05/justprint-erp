const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Fecha de hoy en Buenos Aires, AAAA-MM-DD. */
export const hoy = () => fmt.format(new Date());

/** Los campos JSON vuelven como texto en SQLite y como objeto en MySQL. */
export function json(valor, porDefecto = null) {
  if (valor == null) return porDefecto;
  if (typeof valor !== 'string') return valor;
  try { return JSON.parse(valor); } catch { return porDefecto; }
}
