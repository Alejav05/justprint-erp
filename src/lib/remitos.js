// Lo que comparten las rutas de remitos, el cierre del técnico y la página pública del remito.
import crypto from 'node:crypto';
import { aDia, json } from './fechas.js';
import { config } from '../config.js';

export const nuevoToken = () => crypto.randomBytes(16).toString('hex');
export const codigoVerificacion = (token) => token.slice(0, 8).toUpperCase().replace(/(.{4})/, '$1-');
export const urlPublica = (req, token) => {
  const host = String(req.headers.host ?? '');
  const base = config.appUrl || `${/^(localhost|127\.|\[::1\])/.test(host) ? req.protocol : 'https'}://${host}`; // detrás del proxy de Hostinger el protocolo llega como http
  return `${base}/r/${token}`;
};

/** PNG de la firma que llega como data URL desde el canvas. Devuelve el Buffer o null si no es un PNG razonable. */
export function parseFirma(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  const buf = m ? Buffer.from(m[1], 'base64') : null;
  if (!buf || buf.length > 250000 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return buf;
}

/** Número de celular argentino listo para WhatsApp (549 + área + número). */
export function telefonoAR(texto) {
  let d = String(texto ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) { d = d.slice(2); if (d.startsWith('9')) d = d.slice(1); }
  d = d.replace(/^0/, '');
  if (d.length === 12 && /^\d{2,4}15\d{6,8}$/.test(d)) d = d.replace(/^(\d{2,4})15/, '$1');
  return d.length >= 10 && d.length <= 11 ? `549${d}` : null;
}

const TIPO_SERVICIO = { soporte: 'Soporte técnico', instalacion: 'Instalación', retiro: 'Retiro de equipo', insumos: 'Entrega de insumos', otro: 'Servicio técnico' };
/** El servicio de un ticket no es un remito: es la conformidad del servicio. Las entregas de equipos e insumos sí son remitos. */
export const nombreDocumento = (tipo) => (tipo === 'servicio' ? 'Conformidad de servicio' : 'Remito');

export function tipoTexto(r, ticket, items) {
  if (r.tipo === 'servicio') return TIPO_SERVICIO[ticket?.tipo] ?? 'Servicio técnico';
  return items.some((i) => i.equipo_id && !i.insumo_id) ? 'Instalación de equipo' : 'Entrega de insumos';
}

/** El número de la conformidad es el del ticket (CIA-CL-01-TK0002); si el ticket se reabre y se vuelve a cerrar, lleva -2, -3… */
export async function numeroConformidad(trx, ticketNumero) {
  let n = 1; let numero = ticketNumero;
  while (await trx('remitos').where({ numero }).first()) { n += 1; numero = `${ticketNumero}-${n}`; }
  return numero;
}

/** Los costos nunca salen de acá: es lo que ve el cliente. */
export async function cargarRemitoCompleto(db, remito, { conFirma = false } = {}) {
  const [cliente, sede, filas, conf, escaneo, ticket] = await Promise.all([
    db('clientes').where({ id: remito.cliente_id }).select('id', 'razon_social', 'nombre_comercial', 'cuit').first(),
    remito.sede_id ? db('sedes').where({ id: remito.sede_id }).select('nombre', 'domicilio', 'localidad').first() : null,
    db('remito_items as ri').leftJoin('insumos as i', 'i.id', 'ri.insumo_id').leftJoin('equipos as e', 'e.id', 'ri.equipo_id')
      .where('ri.remito_id', remito.id).orderBy('ri.id').select('ri.descripcion', 'ri.cantidad', 'ri.equipo_id', 'ri.insumo_id', 'i.codigo as insumo_codigo', 'e.numero_serie'),
    db('conformidades').where({ documento_tipo: 'remito', documento_id: remito.id }).orderBy('id', 'desc').first(),
    db('remito_escaneos').where({ remito_id: remito.id }).orderBy('id', 'desc').select('id', 'nombre_original', 'mime', 'bytes', 'created_at').first(),
    remito.ticket_id ? db('tickets').where({ id: remito.ticket_id }).select('id', 'numero', 'asunto', 'tipo', 'equipo_id').first() : null,
  ]);
  const todos = filas.map((f) => ({
    descripcion: f.descripcion, cantidad: f.cantidad, equipo_id: f.equipo_id, insumo_id: f.insumo_id,
    detalle: [f.insumo_codigo ? `Cód. ${f.insumo_codigo}` : null, f.numero_serie ? `N° de serie ${f.numero_serie}` : null].filter(Boolean).join(' · ') || null,
  }));
  // En la conformidad de servicio solo van los repuestos e insumos usados; el servicio en sí es el documento.
  const items = remito.tipo === 'servicio' ? todos.filter((i) => i.insumo_id) : todos;
  const servicio = remito.tipo === 'servicio' ? await cargarServicio(db, remito, ticket) : null;
  let firma = null;
  if (conf && conFirma) firma = (await db('conformidad_firmas').where({ conformidad_id: conf.id }).first())?.png ?? null;
  const tieneFirma = conf ? Boolean(await db('conformidad_firmas').where({ conformidad_id: conf.id }).first()) : false;
  return {
    id: remito.id, numero: remito.numero, tipo: remito.tipo, tipo_texto: tipoTexto(remito, ticket, items), documento: nombreDocumento(remito.tipo), servicio, fecha: aDia(remito.fecha), estado: remito.estado,
    observaciones: remito.observaciones, token: remito.token, cliente, sede, items, ticket,
    conformidad: conf ? { id: conf.id, metodo: conf.metodo, nombre: conf.firmante_nombre, cargo: conf.firmante_cargo, dni: conf.firmante_dni, email: conf.firmante_email, telefono: conf.firmante_telefono, firmado_en: conf.firmado_en, tiene_firma: tieneFirma, firma: firma ? Buffer.from(firma) : null } : null,
    escaneo: escaneo ?? null,
  };
}

const BA = 'America/Argentina/Buenos_Aires';
const aFecha = (x) => new Date(`${String(x).replace(' ', 'T')}${String(x).includes('Z') ? '' : 'Z'}`);
const dia = (x) => aFecha(x).toLocaleDateString('es-AR', { timeZone: BA, day: '2-digit', month: '2-digit', year: 'numeric' });
const hora = (x) => aFecha(x).toLocaleTimeString('es-AR', { timeZone: BA, hour: '2-digit', minute: '2-digit', hour12: false });
/** "02/11/2026 · 14:05 a 15:20 h" (o con las dos fechas si cruza la medianoche). */
export const horarioServicio = (inicio, fin, respaldo) => {
  if (inicio && fin) return dia(inicio) === dia(fin) ? `${dia(inicio)} · ${hora(inicio)} a ${hora(fin)} h` : `${dia(inicio)} ${hora(inicio)} h a ${dia(fin)} ${hora(fin)} h`;
  return fin ? `${dia(fin)} · ${hora(fin)} h` : respaldo;
};

async function cargarServicio(db, remito, ticket) {
  const parte = remito.parte_id ? await db('partes_tecnicos as p').leftJoin('usuarios as u', 'u.id', 'p.tecnico_id').where('p.id', remito.parte_id)
    .select('p.inicio', 'p.fin', 'p.diagnostico', 'p.trabajo_realizado', 'p.contador_negro', 'p.contador_color', 'u.nombre as tecnico').first() : null;
  const eq = ticket?.equipo_id ? await db('equipos as e').join('modelos_equipo as m', 'm.id', 'e.modelo_id').where('e.id', ticket.equipo_id).select('m.marca', 'm.modelo', 'e.numero_serie', 'm.tipo').first() : null;
  return {
    ticket: ticket ? { id: ticket.id, numero: ticket.numero, asunto: ticket.asunto, tipo: ticket.tipo } : null,
    equipo: eq ? { marca: eq.marca, modelo: eq.modelo, serie: eq.numero_serie, tipo: eq.tipo } : null,
    tecnico: parte?.tecnico ?? null, inicio: parte?.inicio ?? null, fin: parte?.fin ?? null, horario: horarioServicio(parte?.inicio, parte?.fin, aDia(remito.fecha)),
    diagnostico: parte?.diagnostico ?? null, trabajo: parte?.trabajo_realizado ?? remito.observaciones ?? null,
    contador_negro: parte?.contador_negro ?? null, contador_color: parte?.contador_color ?? null,
  };
}

/** Registra la conformidad y marca el remito como firmado. Va dentro de la transacción del que la llama. */
export async function guardarConformidad(trx, remitoId, d, ctx) {
  const [id] = await trx('conformidades').insert({
    documento_tipo: 'remito', documento_id: remitoId, firmante_nombre: d.nombre, firmante_cargo: d.cargo ?? null, firmante_dni: d.dni ?? null,
    firmante_email: d.email ?? null, firmante_telefono: d.telefono ?? null, metodo: d.metodo, aceptado: true,
    dispositivo: String(ctx.userAgent || '').slice(0, 255), ip: ctx.ip,
  });
  if (d.firma) await trx('conformidad_firmas').insert({ conformidad_id: id, png: d.firma });
  await trx('remitos').where({ id: remitoId }).update({ estado: 'firmado' });
  return id;
}

export const contactosDe = async (db, clienteId) => (await db('contactos').where({ cliente_id: clienteId }).whereNull('deleted_at').orderBy('id'))
  .map((c) => ({ nombre: c.nombre, cargo: c.cargo, emails: json(c.emails, []).map((e) => e.direccion).filter(Boolean), telefonos: json(c.telefonos, []).map((t) => t.numero).filter(Boolean) }))
  .filter((c) => c.emails.length || c.telefonos.length);
