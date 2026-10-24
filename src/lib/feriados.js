// Feriados nacionales desde ArgentinaDatos (https://api.argentinadatos.com), que el SLA usa para saltear días no hábiles.
// Se sincronizan al arrancar y cada 24 horas. Si la API no responde, se siguen usando los que ya están cargados.
const URL_BASE = process.env.FERIADOS_URL || 'https://api.argentinadatos.com/v1/feriados';

const SchemaTipo = { inamovible: 'feriado', trasladable: 'feriado', puente: 'puente' };

/**
 * Trae los feriados de `anio` y los guarda. Lo que ya existe conserva su decisión de "es hábil o no" (se puede
 * editar a mano, por ejemplo para contar un puente); solo se agregan los nuevos y se actualiza el nombre.
 * Los puentes turísticos son optativos para el sector privado: entran como días hábiles.
 */
export async function sincronizarFeriados(db, anio, { buscar = fetch, log = () => {} } = {}) {
  const r = await buscar(`${URL_BASE}/${anio}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`ArgentinaDatos respondió ${r.status}`);
  const lista = await r.json();
  if (!Array.isArray(lista)) throw new Error('Respuesta inesperada de ArgentinaDatos');
  let nuevos = 0;
  for (const f of lista) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha ?? '') || !f.nombre) continue;
    const tipo = SchemaTipo[f.tipo] ?? 'feriado';
    const existente = await db('feriados').where({ fecha: f.fecha }).first();
    if (existente) await db('feriados').where({ id: existente.id }).update({ nombre: String(f.nombre).slice(0, 120), tipo });
    else { await db('feriados').insert({ fecha: f.fecha, nombre: String(f.nombre).slice(0, 120), tipo, no_habil: tipo === 'feriado' }); nuevos += 1; }
  }
  log(`Feriados ${anio}: ${lista.length} recibidos, ${nuevos} nuevos`);
  return { recibidos: lista.length, nuevos };
}

/** Año actual y el siguiente. Nunca tira el servidor: un error solo se registra. */
export async function sincronizarSiguiente(db, log = () => {}) {
  const anio = new Date().getFullYear();
  for (const a of [anio, anio + 1]) {
    try { await sincronizarFeriados(db, a, { log }); } catch (e) { log(`No se pudieron sincronizar los feriados ${a}: ${e.message}`); }
  }
}
