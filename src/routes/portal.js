// Portal de clientes (lo que ve el cliente). Cookie y sesión propias, separadas de las del ERP.
// Nada de costos ni márgenes: solo lo operativo y lo que el cliente ya recibe (contrato, abono, facturas, conformidades y remitos).
import { z } from 'zod';
import { config } from '../config.js';
import { aDia, hoy } from '../lib/fechas.js';
import { hashear, validarPoliticaPortal, verificar } from '../lib/passwords.js';
import { encuestaSchema, guardarEncuesta } from '../lib/encuestas.js';
import { ASPECTOS } from '../lib/encuestas.js';
import { ahora, auditarPortal, COOKIE, crearEnlace, crearSesionPortal, dentroDe, enviarEnlace, hashToken, diaAnterior, mesesEntre, sumarMeses, urlEnlace } from '../lib/portal.js';
import { datosContadores, consumoPorPeriodo, ultimosPeriodos } from './cliente_panel.js';

const MAX_FALLOS = 5;
const BLOQUEO_MIN = 15;
const dia = (s) => (s ? String(s).slice(0, 10) : null);
const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(160) });

export default async function rutasPortal(app, { db }) {
  const porIp = new Map();
  const limitar = (ip, max, ventanaMs) => {
    const t = Date.now(); const l = (porIp.get(`${max}:${ip}`) || []).filter((x) => t - x < ventanaMs); l.push(t); porIp.set(`${max}:${ip}`, l);
    return l.length > max;
  };
  const poner = (reply, token, expira) => reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', path: '/portal', expires: expira });

  /** preHandler: exige sesión del portal vigente y con el acceso sin dar de baja. */
  async function portal(req, reply) {
    const token = req.cookies?.[COOKIE];
    if (!token) return reply.code(401).send({ error: 'no_autenticado' });
    const s = await db('portal_sesiones as s').join('portal_accesos as a', 'a.id', 's.acceso_id').where('s.id', hashToken(token))
      .select('s.vista_por', 's.expira_en', 'a.*').first();
    if (!s || s.expira_en < ahora() || s.estado === 'baja') return reply.code(401).send({ error: 'sesion_expirada' });
    req.portal = { acceso: s, vista: s.vista_por != null, clienteId: s.cliente_id };
  }

  // ───── Acceso ─────

  /** "Mandame un enlace": siempre responde lo mismo, exista o no el mail (no se puede averiguar quién es cliente). */
  app.post('/portal/api/enlace', async (req, reply) => {
    if (limitar(req.ip, 8, 10 * 60e3)) return reply.code(429).send({ error: 'demasiados_intentos' });
    const { email } = emailSchema.parse(req.body);
    const a = await db('portal_accesos').where({ email }).first();
    if (a && a.estado !== 'baja') {
      const reciente = await db('portal_enlaces').where({ acceso_id: a.id, tipo: 'ingreso' }).where('created_at', '>', new Date(Date.now() - 60e3).toISOString().slice(0, 19).replace('T', ' ')).first();
      if (!reciente) await enviarEnlace(a, urlEnlace(req, await crearEnlace(db, a.id, { minutos: 30 })));
    }
    return { ok: true };
  });

  /** Canjea el enlace del mail por una sesión. Es POST para que los antivirus que "abren" los enlaces no lo gasten. */
  app.post('/portal/api/entrar', async (req, reply) => {
    if (limitar(req.ip, 20, 10 * 60e3)) return reply.code(429).send({ error: 'demasiados_intentos' });
    const { token } = z.object({ token: z.string().min(20).max(80) }).parse(req.body);
    const e = await db('portal_enlaces').where({ id: hashToken(token) }).first();
    if (!e || e.usado_en || e.expira_en < ahora()) return reply.code(410).send({ error: 'enlace_vencido' });
    const a = await db('portal_accesos').where({ id: e.acceso_id }).first();
    if (!a || a.estado === 'baja') return reply.code(410).send({ error: 'enlace_vencido' });
    await db('portal_enlaces').where({ id: e.id }).update({ usado_en: ahora() });
    const vista = e.tipo === 'vista';
    const { token: t, expira } = await crearSesionPortal(db, a.id, req, { vistaPor: vista ? e.creado_por : null });
    if (!vista) await db('portal_accesos').where({ id: a.id }).update({ ultimo_ingreso: db.fn.now(), intentos_fallidos: 0, bloqueado_hasta: null });
    await auditarPortal(db, { usuarioId: vista ? e.creado_por : null, ip: req.ip }, vista ? 'portal_ver_como' : 'portal_ingreso_enlace', a.id);
    poner(reply, t, expira);
    return { ok: true, necesita_clave: !vista && !a.password_hash, vista };
  });

  app.post('/portal/api/login', async (req, reply) => {
    if (limitar(req.ip, 30, 10 * 60e3)) return reply.code(429).send({ error: 'demasiados_intentos' });
    const d = z.object({ email: z.string().trim().toLowerCase().email().max(160), password: z.string().min(1).max(200) }).parse(req.body);
    const a = await db('portal_accesos').where({ email: d.email }).first();
    const bloqueado = a?.bloqueado_hasta && new Date(String(a.bloqueado_hasta).replace(' ', 'T') + 'Z') > new Date();
    const ok = await verificar(d.password, a?.password_hash);
    if (!a || a.estado === 'baja' || !a.password_hash || bloqueado || !ok) {
      if (a && !bloqueado && a.password_hash && !ok) {
        const fallos = a.intentos_fallidos + 1; const c = { intentos_fallidos: fallos };
        if (fallos >= MAX_FALLOS) { c.bloqueado_hasta = dentroDe(BLOQUEO_MIN); c.intentos_fallidos = 0; }
        await db('portal_accesos').where({ id: a.id }).update(c);
      }
      return reply.code(401).send({ error: 'credenciales_invalidas' });
    }
    await db('portal_accesos').where({ id: a.id }).update({ ultimo_ingreso: db.fn.now(), intentos_fallidos: 0, bloqueado_hasta: null });
    const { token, expira } = await crearSesionPortal(db, a.id, req);
    poner(reply, token, expira);
    return { ok: true };
  });

  app.post('/portal/api/logout', async (req, reply) => {
    const t = req.cookies?.[COOKIE]; if (t) await db('portal_sesiones').where({ id: hashToken(t) }).delete();
    reply.clearCookie(COOKIE, { path: '/portal' });
    return { ok: true };
  });

  app.post('/portal/api/clave', { preHandler: portal }, async (req, reply) => {
    if (req.portal.vista) return reply.code(403).send({ error: 'solo_lectura' });
    const { clave } = z.object({ clave: z.string().max(200) }).parse(req.body);
    const err = validarPoliticaPortal(clave); if (err) return reply.code(400).send({ error: 'clave_debil', mensaje: err });
    await db('portal_accesos').where({ id: req.portal.acceso.id }).update({ password_hash: await hashear(clave), estado: 'activo', updated_at: db.fn.now() });
    await auditarPortal(db, { ip: req.ip }, 'portal_clave', req.portal.acceso.id);
    return { ok: true };
  });

  // ───── Datos ─────

  const armar = async ({ acceso, vista, clienteId }, meses = 12) => {
    const h = hoy();
    const c = await db('clientes').where({ id: clienteId }).first();
    const periodos = ultimosPeriodos(h, meses);

    // Contratos vigentes con su abono (más IVA) y las páginas incluidas por mes.
    const contratos = await db('contratos').where({ cliente_id: clienteId, estado: 'vigente' }).whereNull('deleted_at').orderBy('id');
    const conds = contratos.length ? await db('contrato_condiciones').whereIn('contrato_id', contratos.map((x) => x.id)).where('vigente_desde', '<=', h)
      .where((w) => w.whereNull('vigente_hasta').orWhere('vigente_hasta', '>=', h)).orderBy('vigente_desde', 'desc') : [];
    const { asigs, porEquipo } = await datosContadores(db, clienteId);
    const vivas = asigs.filter((a) => !a.hasta);
    const contratosOut = contratos.map((k) => {
      const cond = conds.find((x) => x.contrato_id === k.id);
      const ini = dia(k.fecha_inicio); const fin = ini && k.duracion_meses ? diaAnterior(sumarMeses(ini, k.duracion_meses)) : null;
      const total = k.duracion_meses ?? null; const trans = ini ? Math.max(0, mesesEntre(ini, h)) : null;
      return {
        id: k.id, nombre: k.nombre, moneda: k.moneda, inicio: ini, fin, meses_total: total, meses_restantes: total != null && trans != null ? Math.max(0, total - trans) : null,
        avance_pct: total ? Math.min(100, Math.round((trans / total) * 100)) : null,
        abono: cond && cond.facturable ? Number(cond.monto_mensual) : null, abono_sin_cargo: !!cond && !cond.facturable,
        franquicia_negro: cond?.franquicia_negro ?? 0, franquicia_color: cond?.franquicia_color ?? 0,
        equipos: vivas.filter((a) => a.contrato_id === k.id).length,
      };
    });

    const consumoGral = consumoPorPeriodo(asigs.map((a) => ({ ...a, desde: dia(a.desde) })), porEquipo, periodos);
    const equipos = vivas.map((a) => {
      const ls = porEquipo.get(a.equipo_id) ?? [];
      return {
        id: a.equipo_id, modelo: `${a.marca} ${a.modelo}`, serie: a.numero_serie, color: a.tipo === 'color', sede: a.sede, domicilio: [a.sede_domicilio, a.sede_localidad].filter(Boolean).join(', ') || null, contrato: a.contrato, contrato_id: a.contrato_id, instalado: dia(a.desde),
        ultima_lectura: ls.length ? dia(ls.at(-1).fecha) : null,
        consumo: consumoPorPeriodo([{ ...a, desde: dia(a.desde) }], porEquipo, periodos).map((x) => ({ periodo: x.periodo, negro: x.negro, color: x.color, hay: x.equipos > 0 })),
      };
    });

    // Último pedido de soporte sin cerrar.
    const t = await db('tickets as t').leftJoin('usuarios as u', 'u.id', 't.asignado_a').leftJoin('equipos as e', 'e.id', 't.equipo_id').leftJoin('modelos_equipo as m', 'm.id', 'e.modelo_id')
      .where('t.cliente_id', clienteId).whereNull('t.deleted_at').whereNotIn('t.estado', ['resuelto', 'cerrado']).orderBy('t.abierto_en', 'desc')
      .select('t.numero', 't.asunto', 't.tipo', 't.estado', 't.abierto_en', 'u.nombre as tecnico', 'm.marca', 'm.modelo').first();

    // Comercial asignado.
    const com = await db('cartera_asignaciones as ca').join('usuarios as u', 'u.id', 'ca.usuario_id').where('ca.cliente_id', clienteId).whereNull('ca.hasta').select('u.nombre').first();

    // Conformidades de servicio (firmadas) y remitos de entrega.
    const rem = await db('remitos as r').leftJoin('tickets as t', 't.id', 'r.ticket_id').leftJoin('usuarios as u', 'u.id', 't.asignado_a').leftJoin('encuestas as e', 'e.remito_id', 'r.id')
      .leftJoin('equipos as q', 'q.id', 't.equipo_id').leftJoin('modelos_equipo as m', 'm.id', 'q.modelo_id')
      .where('r.cliente_id', clienteId).whereNull('r.deleted_at').whereIn('r.estado', ['emitido', 'firmado']).orderBy([{ column: 'r.fecha', order: 'desc' }, { column: 'r.id', order: 'desc' }])
      .select('r.id', 'r.numero', 'r.tipo', 'r.estado', 'r.fecha', 'r.token', 'r.observaciones', 't.asunto', 't.tipo as tipo_ticket', 'u.nombre as tecnico', 'e.puntaje', 'm.marca', 'm.modelo');
    const conformidades = rem.filter((r) => r.tipo === 'servicio' && r.estado === 'firmado').map((r) => ({
      id: r.id, numero: r.numero, fecha: dia(r.fecha), tipo: r.tipo_ticket, asunto: r.asunto, equipo: r.marca ? `${r.marca} ${r.modelo}` : null, tecnico: r.tecnico, puntaje: r.puntaje ?? null, token: r.token,
    }));
    const remitos = rem.filter((r) => r.tipo !== 'servicio').map((r) => ({ id: r.id, numero: r.numero, fecha: dia(r.fecha), detalle: r.observaciones, estado: r.estado, token: r.token }));

    const facturas = (await db('facturas').where({ cliente_id: clienteId }).whereNull('deleted_at').whereNotIn('estado', ['borrador', 'anulada']).orderBy('periodo', 'desc').limit(24)
      .select('id', 'numero', 'tipo_comprobante', 'periodo', 'fecha_emision', 'vencimiento', 'moneda', 'neto', 'iva', 'total', 'estado')).map((f) => ({
      id: f.id, numero: f.numero, tipo: f.tipo_comprobante, periodo: f.periodo, emision: dia(f.fecha_emision), vencimiento: dia(f.vencimiento), moneda: f.moneda, neto: Number(f.neto), iva: Number(f.iva), total: Number(f.total), estado: f.estado,
      vencida: f.estado !== 'cobrada' && !!f.vencimiento && dia(f.vencimiento) < h,
    }));

    const documentos = (await db('contrato_documentos').where({ cliente_id: clienteId }).whereNull('deleted_at').orderBy('fecha_documento', 'desc').select('id', 'contrato_id', 'tipo', 'titulo', 'fecha_documento', 'bytes'))
      .map((d) => ({ id: d.id, contrato_id: d.contrato_id, tipo: d.tipo, titulo: d.titulo, fecha: dia(d.fecha_documento), bytes: d.bytes }));

    return {
      usuario: { nombre: acceso.nombre, email: acceso.email, vista },
      cliente: { nombre: c.nombre_comercial || c.razon_social, razon_social: c.razon_social },
      periodos, hoy: h,
      comercial: com ? { nombre: com.nombre } : null,
      contacto: { email_ventas: 'ventas@justprint.com.ar', email_soporte: 'soporte@justprint.com.ar', whatsapp: config.whatsappSoporte },
      contratos: contratosOut, equipos, consumo: consumoGral.map((x) => ({ periodo: x.periodo, negro: x.negro, color: x.color, hay: x.equipos > 0 })),
      soporte: t ? { numero: t.numero, asunto: t.asunto, tipo: t.tipo, estado: t.estado, tecnico: t.tecnico, equipo: t.marca ? `${t.marca} ${t.modelo}` : null, abierto: dia(t.abierto_en) } : null,
      conformidades, remitos, facturas, documentos, aspectos: ASPECTOS,
    };
  };

  app.get('/portal/api/inicio', { preHandler: portal }, async (req) => armar(req.portal, 12));

  /** Excel con todo lo que el cliente ve en su portal: contrato, equipos y ubicaciones, contadores, tickets y facturas. */
  app.get('/portal/api/excel', { preHandler: portal }, async (req, reply) => {
    const { clienteId } = req.portal;
    const d = await armar(req.portal, 24);
    const { default: ExcelJS } = await import('exceljs');
    const libro = new ExcelJS.Workbook(); libro.creator = 'JustPrint'; libro.created = new Date();
  
    const hoja = (titulo, columnas, filas) => {
      const ws = libro.addWorksheet(titulo, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = columnas.map(([header, key, width]) => ({ header, key, width }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2A' } };
      filas.forEach((f) => ws.addRow(f));
      if (filas.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
      return ws;
    };
    const resumen = libro.addWorksheet('Resumen'); resumen.columns = [{ width: 26 }, { width: 60 }];
    [['Cliente', d.cliente.nombre], d.cliente.razon_social !== d.cliente.nombre ? ['Razón social', d.cliente.razon_social] : null, ['Generado el', d.hoy], ['Equipos instalados', d.equipos.length], ['Contratos vigentes', d.contratos.length]]
      .filter(Boolean).forEach((f) => { const r = resumen.addRow(f); r.getCell(1).font = { bold: true }; });
    resumen.getCell('B1').font = { bold: true, size: 13 };

    hoja('Contratos', [['Contrato', 'nombre', 30], ['Inicio', 'inicio', 13], ['Vence', 'fin', 13], ['Meses restantes', 'rest', 16], ['Abono mensual (más IVA)', 'abono', 24], ['Moneda', 'moneda', 9], ['Páginas B/N incluidas por mes', 'fn', 28], ['Páginas color incluidas por mes', 'fc', 30], ['Equipos', 'equipos', 10]],
      d.contratos.map((k) => ({ nombre: k.nombre, inicio: k.inicio, fin: k.fin, rest: k.meses_restantes, abono: k.abono_sin_cargo ? 'Sin cargo' : k.abono, moneda: k.moneda, fn: k.franquicia_negro, fc: k.franquicia_color, equipos: k.equipos })));
    hoja('Equipos', [['Modelo', 'modelo', 28], ['Serie', 'serie', 18], ['Tipo', 'tipo', 12], ['Local', 'sede', 24], ['Dirección', 'dom', 40], ['Contrato', 'contrato', 28], ['Instalado el', 'inst', 14], ['Última lectura', 'ult', 14]],
      d.equipos.map((e) => ({ modelo: e.modelo, serie: e.serie, tipo: e.color ? 'Color' : 'Monocromo', sede: e.sede ?? '', dom: e.domicilio ?? '', contrato: e.contrato, inst: e.instalado, ult: e.ultima_lectura ?? '' })));
    const incN = d.contratos.reduce((t, k) => t + (k.franquicia_negro ?? 0), 0); const incC = d.contratos.reduce((t, k) => t + (k.franquicia_color ?? 0), 0);
    hoja('Consumo mensual', [['Período', 'p', 12], ['Páginas blanco y negro', 'n', 24], ['Páginas color', 'c', 16], ['Total', 't', 12], ['Incluidas B/N', 'in', 15], ['Incluidas color', 'ic', 16]],
      [...d.consumo].reverse().filter((x) => x.hay).map((x) => ({ p: x.periodo, n: x.negro, c: x.color, t: x.negro + x.color, in: incN || '', ic: incC || '' })));
    hoja('Contadores por equipo', [['Período', 'p', 12], ['Equipo', 'e', 28], ['Serie', 's', 18], ['Local', 'l', 24], ['Páginas blanco y negro', 'n', 24], ['Páginas color', 'c', 16], ['Total', 't', 12]],
      d.periodos.slice().reverse().flatMap((p) => d.equipos.map((e) => ({ e, x: e.consumo.find((y) => y.periodo === p) })).filter(({ x }) => x?.hay).map(({ e, x }) => ({ p, e: e.modelo, s: e.serie, l: e.sede ?? '', n: x.negro, c: x.color, t: x.negro + x.color }))));

    const tk = await db('tickets as t').leftJoin('equipos as e', 'e.id', 't.equipo_id').leftJoin('modelos_equipo as m', 'm.id', 'e.modelo_id').leftJoin('usuarios as u', 'u.id', 't.asignado_a')
      .where('t.cliente_id', clienteId).whereNull('t.deleted_at').orderBy('t.abierto_en', 'desc').select('t.numero', 't.asunto', 't.tipo', 't.estado', 't.abierto_en', 't.resuelto_en', 'm.marca', 'm.modelo', 'e.numero_serie', 'u.nombre as tecnico');
    const TIPO = { soporte: 'Soporte técnico', instalacion: 'Instalación', retiro: 'Retiro de equipo' };
    const EST = { abierto: 'Recibido', asignado: 'Técnico asignado', en_curso: 'En curso', esperando_cliente: 'Esperando respuesta', resuelto: 'Resuelto', cerrado: 'Cerrado' };
    hoja('Tickets', [['Período', 'per', 11], ['Número', 'num', 14], ['Fecha', 'f', 13], ['Tipo', 'tipo', 18], ['Asunto', 'a', 40], ['Equipo', 'eq', 28], ['Serie', 'se', 16], ['Técnico', 'tec', 22], ['Estado', 'est', 18], ['Resuelto el', 'res', 13]],
      tk.map((t) => ({ per: dia(t.abierto_en)?.slice(0, 7), num: t.numero, f: dia(t.abierto_en), tipo: TIPO[t.tipo] ?? t.tipo, a: t.asunto, eq: t.marca ? `${t.marca} ${t.modelo}` : '', se: t.numero_serie ?? '', tec: t.tecnico ?? '', est: EST[t.estado] ?? t.estado, res: dia(t.resuelto_en) ?? '' })));
    hoja('Conformidades', [['Fecha', 'f', 13], ['Número', 'n', 14], ['Tipo', 't', 18], ['Asunto', 'a', 40], ['Equipo', 'e', 28], ['Atendió', 'tec', 22], ['Tu calificación (1 a 5)', 'p', 22]],
      d.conformidades.map((c) => ({ f: c.fecha, n: c.numero, t: TIPO[c.tipo] ?? c.tipo, a: c.asunto, e: c.equipo ?? '', tec: c.tecnico ?? '', p: c.puntaje ?? '' })));
    const FEST = { cobrada: 'Pagada', cobrada_parcial: 'Pago parcial' };
    const fa = hoja('Facturas', [['Período', 'p', 11], ['Comprobante', 'n', 22], ['Emisión', 'em', 13], ['Vencimiento', 'v', 13], ['Moneda', 'mo', 9], ['Importe sin IVA', 'ne', 17], ['IVA', 'iv', 12], ['Total', 't', 14], ['Estado', 'es', 14]],
      d.facturas.map((f) => ({ p: f.periodo, n: [f.tipo && `Factura ${f.tipo}`, f.numero].filter(Boolean).join(' ') || '—', em: f.emision ?? '', v: f.vencimiento ?? '', mo: f.moneda, ne: f.neto, iv: f.iva, t: f.total, es: FEST[f.estado] ?? (f.vencida ? 'Vencida' : 'Por vencer') })));
    ['ne', 'iv', 't'].forEach((k) => { fa.getColumn(k).numFmt = '#,##0.00'; });
    hoja('Remitos', [['Fecha', 'f', 13], ['Número', 'n', 14], ['Detalle', 'd', 60]], d.remitos.map((r) => ({ f: r.fecha, n: r.numero, d: r.detalle ?? '' })));
    hoja('Documentos', [['Fecha', 'f', 13], ['Tipo', 't', 18], ['Documento', 'd', 50]], d.documentos.map((x) => ({ f: x.fecha ?? '', t: { contrato: 'Contrato firmado', anexo: 'Anexo', adenda: 'Adenda' }[x.tipo] ?? 'Documento', d: x.titulo })));

    const buf = Buffer.from(await libro.xlsx.writeBuffer());
    const archivo = `JustPrint_${d.cliente.nombre.normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'cliente'}_${d.hoy}.xlsx`;
    return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="${archivo}"`).header('Cache-Control', 'private, no-store').send(buf);
  });

  app.get('/portal/api/documentos/:id/archivo', { preHandler: portal }, async (req, reply) => {
    const id = Number(req.params.id);
    const d = Number.isInteger(id) ? await db('contrato_documentos').where({ id, cliente_id: req.portal.clienteId }).whereNull('deleted_at').first() : null;
    const c = d ? await db('contrato_documentos_contenido').where({ documento_id: d.id }).first() : null;
    if (!d || !c) return reply.code(404).send({ error: 'no_encontrado' });
    const nombre = `${d.titulo.replace(/[^\w\s.-]/g, '').trim().replace(/\s+/g, '_') || 'documento'}.pdf`;
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${nombre}"`).header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').send(Buffer.from(c.contenido));
  });

  /** El cliente califica la atención desde su portal. Una por conformidad; la mirada de Dirección es de solo lectura. */
  app.post('/portal/api/encuesta', { preHandler: portal }, async (req, reply) => {
    if (req.portal.vista) return reply.code(403).send({ error: 'solo_lectura' });
    const d = encuestaSchema.extend({ remito_id: z.coerce.number().int() }).parse(req.body);
    const r = await db('remitos').where({ id: d.remito_id, cliente_id: req.portal.clienteId, tipo: 'servicio', estado: 'firmado' }).whereNull('deleted_at').first();
    if (!r) return reply.code(404).send({ error: 'no_encontrado' });
    if (!(await guardarEncuesta(db, r, d, 'portal'))) return reply.code(409).send({ error: 'ya_respondida' });
    return { ok: true };
  });
}
