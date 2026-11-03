// Mail automático "ya tenés tu factura": sale al subir el PDF, a los contactos del cliente con rol Facturación, con el comprobante adjunto.
import { canales } from './canales.js';
import { aDia, json } from './fechas.js';

const plata = (n, m) => (m === 'ARS' ? '$ ' : 'USD ') + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (s) => { const [y, m, d] = String(s).split('-'); return `${d}/${m}/${y}`; };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesDe = (p) => { const [y, m] = String(p).split('-'); return `${MESES[Number(m) - 1]} de ${y}`; };

/** Contactos del cliente que reciben las facturas, con el mail que corresponde (facturación > cobranzas > el primero). */
export async function destinatariosFactura(db, clienteId) {
  const cs = await db('contactos').where({ cliente_id: clienteId }).whereNull('deleted_at').orderBy('id');
  const vistos = new Set(); const salida = [];
  for (const c of cs) {
    if (!json(c.roles, []).includes('facturacion')) continue;
    const mails = json(c.emails, []);
    const m = mails.find((x) => x.tipo === 'facturacion') ?? mails.find((x) => x.tipo === 'cobranzas') ?? mails[0];
    const dir = m?.direccion?.trim().toLowerCase();
    if (!dir || vistos.has(dir)) continue;
    vistos.add(dir); salida.push({ nombre: c.nombre, email: dir });
  }
  return salida;
}

export function armarMensaje({ factura, nombre, urlPortal, cliente }) {
  const hola = nombre ? `Hola ${String(nombre).split(' ')[0]}!` : 'Hola!';
  const importe = Number(factura.iva) > 0 ? `${plata(factura.neto, factura.moneda)} + IVA (total ${plata(factura.total, factura.moneda)})` : plata(factura.total, factura.moneda);
  const lineas = [hola, '',
    `Te escribimos de JustPrint para avisarte que ya está lista la factura de ${mesDe(factura.periodo)}${cliente ? ` de ${cliente}` : ''}. La dejamos adjunta a este mail.`, '',
    `Importe: ${importe}`,
    factura.vencimiento ? `Vencimiento: ${dia(aDia(factura.vencimiento))}` : null,
    factura.numero ? `Comprobante: ${factura.numero}` : null, '',
    urlPortal ? `También la podés ver y descargar cuando quieras desde tu portal: ${urlPortal}` : null,
    urlPortal ? '' : null,
    'Cualquier duda, respondé este mail y te damos una mano.', '', 'Un abrazo,', 'El equipo de JustPrint'];
  return { subject: `Tu factura de ${mesDe(factura.periodo)} · JustPrint`, text: lineas.filter((x) => x !== null).join('\n') };
}

/** Manda el aviso y deja registro. Devuelve { estado, destinatarios }. Nunca tira: un fallo de mail no debe frenar la carga del PDF. */
export async function avisarFactura(db, { factura, pdf, nombrePdf, cliente, urlPortal, usuarioId }) {
  const dest = await destinatariosFactura(db, factura.cliente_id);
  let estado; let detalle = null;
  if (!dest.length) estado = 'sin_destinatarios';
  else if (!canales.mail.configurado()) estado = 'sin_mail';
  else {
    estado = 'enviado';
    for (const d of dest) {
      const { subject, text } = armarMensaje({ factura, nombre: d.nombre, urlPortal, cliente });
      try { await canales.mail.enviar({ to: d.email, subject, text, cuenta: 'facturacion', attachments: [{ filename: nombrePdf, content: pdf, contentType: 'application/pdf' }] }); }
      catch (e) { estado = 'error'; detalle = String(e.code ?? e.message ?? 'fallo').slice(0, 200); }
    }
  }
  await db('factura_avisos').insert({ factura_id: factura.id, destinatarios: JSON.stringify(dest.map((d) => d.email)), estado, detalle, enviado_por: usuarioId ?? null });
  return { estado, destinatarios: dest.map((d) => d.email) };
}
