// Tablero de un cliente (qué pasa con esta cuenta hoy) y su exportación a Excel para compartir.
// Cada bloque aparece solo si el usuario tiene el permiso del dato que muestra.
import { aDia, hoy, json } from '../lib/fechas.js';
import { puede, puedeVerCliente } from '../lib/contexto.js';
import { abonosUsd } from '../lib/abonos.js';
import { consumoPeriodo, periodoDeLectura } from '../lib/contadores.js';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const ultimosPeriodos = (hasta, n) => {
  let [a, m] = hasta.slice(0, 7).split('-').map(Number); const l = [];
  for (let i = 0; i < n; i += 1) { l.unshift(`${a}-${String(m).padStart(2, '0')}`); m -= 1; if (m === 0) { m = 12; a -= 1; } }
  return l;
};
const dia = (s) => (s ? String(s).slice(0, 10) : null);

/** Lecturas de los equipos del cliente (agrupadas) y sus asignaciones. */
export async function datosContadores(db, clienteId) {
  const asigs = await db('asignaciones_equipo as a').join('contratos as c', 'c.id', 'a.contrato_id').join('equipos as e', 'e.id', 'a.equipo_id').join('modelos_equipo as m', 'm.id', 'e.modelo_id')
    .leftJoin('sedes as s', 's.id', 'a.sede_id').where('c.cliente_id', clienteId).whereNull('c.deleted_at')
    .select('a.id', 'a.equipo_id', 'a.contrato_id', 'a.desde', 'a.hasta', 'a.contador_inicial_negro', 'a.contador_inicial_color', 'e.numero_serie', 'm.marca', 'm.modelo', 'm.tipo', 's.nombre as sede', 's.domicilio as sede_domicilio', 's.localidad as sede_localidad', 'c.nombre as contrato');
  const ids = [...new Set(asigs.map((a) => a.equipo_id))];
  const filas = ids.length ? await db('lecturas_contador as l').leftJoin('usuarios as u', 'u.id', 'l.usuario_id').whereIn('l.equipo_id', ids).orderBy('l.fecha').orderBy('l.id').select('l.*', 'u.nombre as usuario') : [];
  const porEquipo = new Map();
  for (const l of filas) { if (!porEquipo.has(l.equipo_id)) porEquipo.set(l.equipo_id, []); porEquipo.get(l.equipo_id).push({ ...l, fecha: aDia(l.fecha), per: periodoDeLectura(l) }); }
  return { asigs, porEquipo };
}

/** Consumo de páginas por período: suma de los equipos con lectura en ese período. */
export function consumoPorPeriodo(asigs, porEquipo, periodos) {
  const mapa = Object.fromEntries(periodos.map((p) => [p, { periodo: p, negro: 0, color: 0, equipos: 0 }]));
  for (const a of asigs) {
    const ls = porEquipo.get(a.equipo_id) ?? [];
    for (const p of periodos) {
      const k = consumoPeriodo(ls, p, { ...a, desde: dia(a.desde), tipo: a.tipo });
      if (!k) continue;
      const fin = `${p}-31`; const ini = `${p}-01`;
      if (dia(a.desde) > fin || (a.hasta && dia(a.hasta) < ini)) continue;
      mapa[p].negro += k.negro; mapa[p].color += k.color; mapa[p].equipos += 1;
    }
  }
  return periodos.map((p) => mapa[p]);
}

export default async function rutasClientePanel(app, { db }) {
  const auth = requerirSesion(db);

  async function cliente(req, reply) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await puedeVerCliente(db, req.ctx, id))) { reply.code(404).send({ error: 'no_encontrado' }); return null; }
    const c = await db('clientes').where({ id }).whereNull('deleted_at').first();
    if (!c) { reply.code(404).send({ error: 'no_encontrado' }); return null; }
    return c;
  }

  app.get('/api/clientes/:id/panel', { preHandler: [auth, requerirPermiso('clientes.ver')] }, async (req, reply) => {
    const c = await cliente(req, reply); if (!c) return;
    const periodos = ultimosPeriodos(hoy(), 12);
    const out = { periodos };

    if (puede(req.ctx, 'importes.ver')) {
      const facturas = await db('facturas').where({ cliente_id: c.id }).whereNull('deleted_at').whereNotIn('estado', ['borrador', 'anulada']).select('id', 'numero', 'periodo', 'estado', 'total', 'neto_usd', 'moneda', 'fecha_emision', 'vencimiento');
      const aplicado = new Map();
      if (facturas.length) for (const a of await db('cobro_aplicaciones').whereIn('factura_id', facturas.map((f) => f.id)).select('factura_id').sum({ s: 'importe' }).groupBy('factura_id')) aplicado.set(a.factura_id, Number(a.s));
      const cobradoUsd = (f) => (Number(f.total) > 0 ? (Math.min(aplicado.get(f.id) ?? 0, Number(f.total)) / Number(f.total)) * Number(f.neto_usd ?? 0) : 0);
      const serie = periodos.map((p) => ({ periodo: p, facturado: 0, cobrado: 0, sin_comprobante: 0 }));
      let porCobrar = 0; const pendientes = [];
      for (const f of facturas) {
        const s = serie.find((x) => x.periodo === f.periodo);
        if (s) { s.facturado += Number(f.neto_usd ?? 0); s.cobrado += cobradoUsd(f); }
        if (f.estado !== 'cobrada') { const saldo = Number(f.neto_usd ?? 0) - cobradoUsd(f); porCobrar += saldo; pendientes.push({ id: f.id, numero: f.numero, periodo: f.periodo, vencimiento: dia(f.vencimiento), saldo_usd: redondear(saldo) }); }
      }
      const ab = (await abonosUsd(db, { clienteIds: [c.id] })).porCliente[c.id] ?? { abono: 0, noFacturable: 0 };
      out.facturacion = {
        serie: serie.map((s) => ({ ...s, facturado: redondear(s.facturado), cobrado: redondear(s.cobrado) })),
        facturado_12m: redondear(serie.reduce((t, s) => t + s.facturado, 0)), por_cobrar: redondear(porCobrar), facturas_pendientes: pendientes.sort((a, b) => (a.vencimiento ?? '').localeCompare(b.vencimiento ?? '')).slice(0, 5),
        abono_mensual: redondear(ab.abono), abono_no_facturable: redondear(ab.noFacturable),
      };
    }

    if (puede(req.ctx, 'equipos.ver') || puede(req.ctx, 'contadores.ver')) {
      const { asigs, porEquipo } = await datosContadores(db, c.id);
      const vivos = asigs.filter((a) => !a.hasta);
      out.equipos = vivos.map((a) => {
        const ls = porEquipo.get(a.equipo_id) ?? []; const u = ls.at(-1);
        return { equipo_id: a.equipo_id, serie: a.numero_serie, modelo: `${a.marca} ${a.modelo}`, tipo: a.tipo, sede: a.sede, contrato: a.contrato, ultima: u ? { fecha: u.fecha, negro: u.contador_negro, color: u.contador_color } : null };
      });
      if (puede(req.ctx, 'contadores.ver')) {
        const consumo = consumoPorPeriodo(asigs.map((a) => ({ ...a, desde: dia(a.desde) })), porEquipo, periodos);
        out.consumo = { serie: consumo, color: asigs.some((a) => a.tipo === 'color'), sin_datos: consumo.every((x) => !x.equipos) };
      }
    }

    if (puede(req.ctx, 'tickets.ver')) {
      const desde = `${periodos[0]}-01`;
      const tk = await db('tickets').where({ cliente_id: c.id }).whereNull('deleted_at').orderBy('abierto_en', 'desc').select('id', 'numero', 'asunto', 'tipo', 'estado', 'prioridad', 'abierto_en', 'resuelto_en', 'horas_resolucion', 'sla_cumplido', 'sla_medible');
      const porMes = periodos.map((p) => ({ periodo: p, tickets: tk.filter((t) => String(t.abierto_en).slice(0, 7) === p).length }));
      const resueltos = tk.filter((t) => t.sla_medible && t.resuelto_en && String(t.abierto_en).slice(0, 10) >= desde);
      const cumplidos = resueltos.filter((t) => t.sla_cumplido === 1 || t.sla_cumplido === true).length;
      const hs = resueltos.map((t) => Number(t.horas_resolucion)).filter((x) => Number.isFinite(x));
      out.tickets = {
        serie: porMes, abiertos: tk.filter((t) => !['resuelto', 'cerrado'].includes(t.estado)).length, total_12m: porMes.reduce((s, x) => s + x.tickets, 0),
        pct_sla: resueltos.length ? Math.round((cumplidos / resueltos.length) * 100) : null, horas_medias: hs.length ? redondear(hs.reduce((s, x) => s + x, 0) / hs.length) : null,
        ultimos: tk.slice(0, 6),
      };
    }

    if (puede(req.ctx, 'crm.gestionar')) {
      const inter = await db('interacciones as i').join('usuarios as u', 'u.id', 'i.usuario_id').where('i.cliente_id', c.id).orderBy([{ column: 'i.fecha', order: 'desc' }, { column: 'i.id', order: 'desc' }]).limit(6)
        .select('i.id', 'i.tipo', 'i.resumen', 'i.fecha', 'u.nombre as usuario');
      const tareas = await db('tareas_crm as t').join('usuarios as u', 'u.id', 't.asignado_a').where('t.cliente_id', c.id).whereNull('t.deleted_at').where('t.estado', 'pendiente').orderBy('t.vence').limit(5).select('t.id', 't.titulo', 't.vence', 'u.nombre as asignado');
      const h = hoy();
      out.comercial = { interacciones: inter.map((i) => ({ ...i, fecha: dia(i.fecha) })), tareas: tareas.map((t) => ({ ...t, vence: dia(t.vence), vencida: !!t.vence && dia(t.vence) < h })) };
    }
    return out;
  });

  /**
   * Excel para compartir con el cliente: solo lo operativo que el usuario puede ver. No incluye gestiones comerciales,
   * costos ni notas internas.
   */
  app.get('/api/clientes/:id/excel', { preHandler: [auth, requerirPermiso('clientes.ver')] }, async (req, reply) => {
    const c = await cliente(req, reply); if (!c) return;
    const pedidas = String(req.query.secciones ?? 'contadores,gestiones,equipos').split(',').map((x) => x.trim());
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const desde = re.test(req.query.desde ?? '') ? req.query.desde : null; const hasta = re.test(req.query.hasta ?? '') ? req.query.hasta : null;
    const entra = (f) => (!desde || f >= desde) && (!hasta || f <= hasta);
    const ok = {
      equipos: pedidas.includes('equipos') && puede(req.ctx, 'equipos.ver'),
      contadores: pedidas.includes('contadores') && puede(req.ctx, 'contadores.ver'),
      gestiones: pedidas.includes('gestiones') && puede(req.ctx, 'tickets.ver'),
      facturas: pedidas.includes('facturas') && puede(req.ctx, 'importes.ver'),
    };
    if (!Object.values(ok).some(Boolean)) return reply.code(403).send({ error: 'sin_permiso' });

    const { default: ExcelJS } = await import('exceljs');
    const libro = new ExcelJS.Workbook(); libro.creator = 'JustPrint'; libro.created = new Date();
    const nombre = c.nombre_comercial || c.razon_social;
    const hoja = (titulo, columnas, filas) => {
      const ws = libro.addWorksheet(titulo, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = columnas.map(([header, key, width]) => ({ header, key, width }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2A' } };
      filas.forEach((f) => ws.addRow(f));
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
      return ws;
    };

    const resumen = libro.addWorksheet('Resumen');
    resumen.columns = [{ width: 24 }, { width: 60 }];
    [['Cliente', nombre], c.nombre_comercial ? ['Razón social', c.razon_social] : null, ['CUIT', c.cuit ?? ''], ['Generado el', hoy()],
      ['Período incluido', desde || hasta ? `${desde ?? 'inicio'} a ${hasta ?? 'hoy'}` : 'Todo el historial']].filter(Boolean).forEach((f) => { const r = resumen.addRow(f); r.getCell(1).font = { bold: true }; });
    resumen.getCell('B1').font = { bold: true, size: 13 };

    let datos = null;
    if (ok.equipos || ok.contadores) datos = await datosContadores(db, c.id);
    if (ok.equipos) {
      hoja('Equipos', [['Serie', 'serie', 18], ['Modelo', 'modelo', 28], ['Tipo', 'tipo', 12], ['Local', 'sede', 24], ['Contrato', 'contrato', 28], ['Instalado el', 'desde', 14], ['Retirado el', 'hasta', 14], ['Contador inicial negro', 'ini', 14], ['Última lectura', 'ult', 14]],
        datos.asigs.map((a) => ({ serie: a.numero_serie, modelo: `${a.marca} ${a.modelo}`, tipo: a.tipo === 'color' ? 'Color' : 'Monocromo', sede: a.sede ?? '', contrato: a.contrato, desde: dia(a.desde), hasta: dia(a.hasta) ?? 'Instalado', ini: a.contador_inicial_negro, ult: (datos.porEquipo.get(a.equipo_id) ?? []).at(-1)?.contador_negro ?? '' })));
    }
    if (ok.contadores) {
      const filas = [];
      for (const a of datos.asigs) {
        const ls = datos.porEquipo.get(a.equipo_id) ?? []; let prev = null;
        for (const l of ls) {
          if (l.fecha < dia(a.desde) || (a.hasta && l.fecha > dia(a.hasta))) continue;
          const bn = prev ? prev.contador_negro : a.contador_inicial_negro; const bc = prev ? prev.contador_color : a.contador_inicial_color;
          if (entra(l.fecha)) filas.push({ fecha: l.fecha, periodo: l.per, serie: a.numero_serie, modelo: `${a.marca} ${a.modelo}`, sede: a.sede ?? '', negro: l.contador_negro, color: a.tipo === 'color' ? l.contador_color : '', cn: Math.max(0, l.contador_negro - bn), cc: a.tipo === 'color' ? Math.max(0, l.contador_color - bc) : '', origen: { tecnico: 'Técnico', cliente: 'Cliente', importacion: 'Histórico', automatica: 'Automática' }[l.origen] ?? l.origen });
          prev = l;
        }
      }
      filas.sort((x, y) => y.fecha.localeCompare(x.fecha) || x.serie.localeCompare(y.serie));
      hoja('Contadores', [['Fecha', 'fecha', 12], ['Período', 'periodo', 10], ['Serie', 'serie', 18], ['Modelo', 'modelo', 28], ['Local', 'sede', 24], ['Contador negro', 'negro', 14], ['Contador color', 'color', 14], ['Páginas negro', 'cn', 14], ['Páginas color', 'cc', 14], ['Informó', 'origen', 12]], filas);
    }
    if (ok.gestiones) {
      const tk = await db('tickets as t').leftJoin('equipos as e', 'e.id', 't.equipo_id').leftJoin('sedes as s', 's.id', 't.sede_id').where('t.cliente_id', c.id).whereNull('t.deleted_at').orderBy('t.abierto_en', 'desc')
        .select('t.id', 't.numero', 't.asunto', 't.tipo', 't.estado', 't.prioridad', 't.abierto_en', 't.resuelto_en', 't.horas_resolucion', 'e.numero_serie', 's.nombre as sede');
      const sel = tk.filter((t) => entra(dia(t.abierto_en)));
      const partes = sel.length ? await db('partes_tecnicos as p').join('usuarios as u', 'u.id', 'p.tecnico_id').whereIn('p.ticket_id', sel.map((t) => t.id)).orderBy('p.inicio').select('p.*', 'u.nombre as tecnico') : [];
      const insumos = new Map((await db('insumos').select('id', 'descripcion')).map((i) => [i.id, i.descripcion]));
      const ESTADO = { abierto: 'Abierto', asignado: 'Asignado', en_curso: 'En curso', esperando_cliente: 'Esperando al cliente', resuelto: 'Resuelto', cerrado: 'Cerrado' };
      const TIPO = { soporte: 'Soporte', insumos: 'Insumos', instalacion: 'Instalación', retiro: 'Retiro', otro: 'Otro' };
      hoja('Tickets', [['Número', 'numero', 12], ['Abierto el', 'abierto', 12], ['Asunto', 'asunto', 44], ['Tipo', 'tipo', 13], ['Estado', 'estado', 20], ['Equipo', 'serie', 18], ['Local', 'sede', 22], ['Resuelto el', 'resuelto', 12], ['Horas hábiles', 'horas', 12]],
        sel.map((t) => ({ numero: t.numero, abierto: dia(t.abierto_en), asunto: t.asunto, tipo: TIPO[t.tipo] ?? t.tipo, estado: ESTADO[t.estado] ?? t.estado, serie: t.numero_serie ?? '', sede: t.sede ?? '', resuelto: dia(t.resuelto_en) ?? '', horas: t.horas_resolucion == null ? '' : Number(t.horas_resolucion) })));
      const porId = new Map(sel.map((t) => [t.id, t]));
      const ws = hoja('Gestiones técnicas', [['Fecha', 'fecha', 12], ['Ticket', 'ticket', 12], ['Asunto', 'asunto', 36], ['Equipo', 'serie', 18], ['Técnico', 'tecnico', 22], ['Diagnóstico', 'diag', 44], ['Trabajo realizado', 'trabajo', 50], ['Repuestos', 'rep', 36], ['Contador negro', 'cn', 14], ['Contador color', 'cc', 14]],
        partes.map((p) => { const t = porId.get(p.ticket_id); return { fecha: dia(p.inicio), ticket: t.numero, asunto: t.asunto, serie: t.numero_serie ?? '', tecnico: p.tecnico, diag: p.diagnostico ?? '', trabajo: p.trabajo_realizado ?? '', rep: json(p.repuestos, []).map((r) => `${r.cantidad} × ${insumos.get(r.insumo_id) ?? 'repuesto'}`).join(', '), cn: p.contador_negro ?? '', cc: p.contador_color ?? '' }; }));
      ws.getColumn('diag').alignment = { wrapText: true, vertical: 'top' }; ws.getColumn('trabajo').alignment = { wrapText: true, vertical: 'top' };
    }
    if (ok.facturas) {
      const fs = await db('facturas').where({ cliente_id: c.id }).whereNull('deleted_at').whereNotIn('estado', ['borrador', 'anulada']).orderBy('periodo', 'desc').select('numero', 'periodo', 'fecha_emision', 'vencimiento', 'moneda', 'neto', 'iva', 'total', 'estado');
      const ESTADO = { emitida: 'Emitida', cobrada_parcial: 'Cobrada parcial', cobrada: 'Cobrada' };
      hoja('Facturación', [['Número', 'numero', 18], ['Período', 'periodo', 10], ['Emisión', 'em', 12], ['Vencimiento', 'vto', 12], ['Moneda', 'moneda', 9], ['Neto', 'neto', 14], ['IVA', 'iva', 14], ['Total', 'total', 14], ['Estado', 'estado', 16]],
        fs.filter((f) => entra(dia(f.fecha_emision) ?? `${f.periodo}-01`)).map((f) => ({ numero: f.numero ?? '', periodo: f.periodo, em: dia(f.fecha_emision) ?? '', vto: dia(f.vencimiento) ?? '', moneda: f.moneda, neto: Number(f.neto), iva: Number(f.iva), total: Number(f.total), estado: ESTADO[f.estado] ?? f.estado })));
    }
    const buf = Buffer.from(await libro.xlsx.writeBuffer());
    const archivo = `${nombre.normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'cliente'}_${hoy()}.xlsx`;
    return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="${archivo}"`).send(buf);
  });
}
