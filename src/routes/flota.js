// Flota: lo que cuestan los equipos que no están en ningún cliente (depósito, taller, bajas) y el control de datos que la amortización necesita.
import { clientesVisibles } from '../lib/contexto.js';
import { aDia, hoy } from '../lib/fechas.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const nombreCli = (x) => x.nombre_comercial || x.razon_social;

export default async function rutasFlota(app, { db }) {
  const auth = requerirSesion(db);

  app.get('/api/flota', { preHandler: [auth, requerirPermiso('costos.ver')] }, async (req, reply) => {
    if ((await clientesVisibles(db, req.ctx)) !== null) return reply.code(404).send({ error: 'no_encontrado' }); // la flota es de toda la empresa
    const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes ?? '')) ? req.query.mes : hoy().slice(0, 7);
    const desde = `${mes}-01`; const hasta = `${mes}-31`;
    const filas = await db('costos as k').leftJoin('equipos as e', 'e.id', 'k.equipo_id').leftJoin('modelos_equipo as m', 'm.id', 'e.modelo_id')
      .whereNull('k.deleted_at').whereNull('k.cliente_id').where('k.origen', 'amortizacion').whereBetween('k.fecha', [desde, hasta]).orderBy('k.tipo').orderBy('k.id')
      .select('k.id', 'k.tipo', 'k.concepto', 'k.fecha', 'k.importe_usd', 'k.equipo_id', 'e.numero_serie', 'e.estado', 'm.marca', 'm.modelo');
    const amort = filas.filter((f) => f.tipo === 'amortizacion'); const perd = filas.filter((f) => f.tipo === 'perdida');
    const sinCliente = await db('equipos').whereNull('deleted_at').whereIn('estado', ['deposito', 'reparacion']).select('estado').count({ n: 'id' }).groupBy('estado');
    const conteo = (e) => Number(sinCliente.find((x) => x.estado === e)?.n ?? 0);
    const t = (l) => r2(l.reduce((s, f) => s + Number(f.importe_usd), 0));

    // Serie de los últimos 12 meses para ver la tendencia.
    const hace = (() => { const [a, m] = mes.split('-').map(Number); const x = a * 12 + (m - 1) - 11; return `${Math.floor(x / 12)}-${String((x % 12) + 1).padStart(2, '0')}-01`; })();
    const todas = await db('costos').whereNull('deleted_at').whereNull('cliente_id').where('origen', 'amortizacion').whereBetween('fecha', [hace, hasta]).select('fecha', 'importe_usd');
    const porMes = new Map(); for (const k of todas) { const p = String(aDia(k.fecha)).slice(0, 7); porMes.set(p, r2((porMes.get(p) ?? 0) + Number(k.importe_usd))); }
    const serie = []; { let [a, m] = hace.slice(0, 7).split('-').map(Number); for (let i = 0; i < 12; i += 1) { const p = `${a}-${String(m).padStart(2, '0')}`; serie.push({ mes: p, usd: porMes.get(p) ?? 0 }); m += 1; if (m > 12) { m = 1; a += 1; } } }

    return {
      mes, total: r2(t(amort) + t(perd)), amortizacion: t(amort), perdidas: t(perd), equipos_deposito: conteo('deposito'), equipos_taller: conteo('reparacion'), serie,
      detalle: filas.map((f) => ({ id: f.id, tipo: f.tipo, fecha: aDia(f.fecha), usd: Number(f.importe_usd), concepto: f.concepto, equipo_id: f.equipo_id, equipo: f.marca ? `${f.marca} ${f.modelo}` : null, numero_serie: f.numero_serie, estado: f.estado })),
    };
  });

  /** Control de datos: lo que hay que mirar antes de confiar en las cifras de amortización. */
  app.get('/api/flota/revision', { preHandler: [auth, requerirPermiso('costos.ver')] }, async (req, reply) => {
    if ((await clientesVisibles(db, req.ctx)) !== null) return reply.code(404).send({ error: 'no_encontrado' });
    const equipos = await db('equipos as e').join('modelos_equipo as m', 'm.id', 'e.modelo_id').whereNull('e.deleted_at').select('e.*', 'm.marca', 'm.modelo');
    const asigs = await db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').join('clientes as cl', 'cl.id', 'c.cliente_id')
      .select('a.id', 'a.equipo_id', 'a.desde', 'a.hasta', 'a.contrato_id', 'c.nombre as contrato', 'c.fecha_inicio', 'cl.id as cliente_id', 'cl.razon_social', 'cl.nombre_comercial');
    const lect = await db('lecturas_contador').select('equipo_id').min({ primera: 'fecha' }).groupBy('equipo_id');
    const primeraLect = new Map(lect.map((l) => [l.equipo_id, aDia(l.primera)]));
    const porEquipo = new Map(); for (const a of asigs) { if (!porEquipo.has(a.equipo_id)) porEquipo.set(a.equipo_id, []); porEquipo.get(a.equipo_id).push(a); }
    const nombre = (e) => `${e.marca} ${e.modelo} · ${e.numero_serie}`;
    const sinCosto = []; const fechas = []; const estados = [];

    for (const e of equipos) {
      const mias = (porEquipo.get(e.id) ?? []).sort((x, y) => (aDia(x.desde) < aDia(y.desde) ? -1 : 1)); const abierta = mias.find((a) => !a.hasta);
      if (e.estado !== 'baja' && e.costo_usd == null && !(Number(e.costo_adquisicion) > 0)) sinCosto.push({ equipo_id: e.id, equipo: nombre(e), estado: e.estado, cliente: abierta ? nombreCli(abierta) : null });
      if (e.estado === 'instalado' && !abierta) estados.push({ equipo_id: e.id, equipo: nombre(e), problema: 'Figura instalado pero no tiene un cliente asignado.' });
      if (e.estado !== 'instalado' && abierta) estados.push({ equipo_id: e.id, equipo: nombre(e), problema: `Figura ${e.estado} pero tiene una asignación abierta en ${nombreCli(abierta)}.` });
      if (mias.filter((a) => !a.hasta).length > 1) estados.push({ equipo_id: e.id, equipo: nombre(e), problema: 'Tiene más de una asignación abierta.' });
      const primera = mias[0];
      if (primera) {
        const d = aDia(primera.desde); const ini = aDia(primera.fecha_inicio);
        if (ini && ini !== d) fechas.push({ equipo_id: e.id, equipo: nombre(e), cliente: nombreCli(primera), problema: `Instalado el ${d} pero el contrato empieza el ${ini}.`, desde: d, contrato_inicio: ini });
        const pl = primeraLect.get(e.id); if (pl && pl < d) fechas.push({ equipo_id: e.id, equipo: nombre(e), cliente: nombreCli(primera), problema: `Tiene una lectura del ${pl}, anterior a la instalación (${d}).`, desde: d });
        const adq = aDia(e.fecha_adquisicion); if (adq && adq > d) fechas.push({ equipo_id: e.id, equipo: nombre(e), cliente: nombreCli(primera), problema: `La compra (${adq}) es posterior a la instalación (${d}).`, desde: d });
      }
      for (let i = 1; i < mias.length; i += 1) {
        const prev = mias[i - 1]; if (prev.hasta && aDia(mias[i].desde) < aDia(prev.hasta)) fechas.push({ equipo_id: e.id, equipo: nombre(e), cliente: nombreCli(mias[i]), problema: `Las asignaciones se pisan: una termina el ${aDia(prev.hasta)} y la siguiente empieza el ${aDia(mias[i].desde)}.` });
      }
    }
    return { sin_costo: sinCosto, fechas, estados, total: sinCosto.length + fechas.length + estados.length };
  });
}
