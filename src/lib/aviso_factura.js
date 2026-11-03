// Mail automático "ya tenés tu factura": sale al subir el PDF, a los contactos del cliente con rol Facturación, con el comprobante adjunto.
import { canales } from './canales.js';
import { json } from './fechas.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

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

const DATOS_TRANSFERENCIA = ['BANCO FRANCES', 'CBU 0170043520000004629483', 'CC 043-046294/8', 'EUROPA HAUS SAS', 'CUIT 30716461730'];
const mesNombre = (p) => MESES[Number(String(p).split('-')[1]) - 1];
const capital = (x) => x.charAt(0).toUpperCase() + x.slice(1);

// Firma institucional: va igual en todos los avisos.
export const FIRMA_HTML = `<div style="font-family:Arial,Helvetica,sans-serif;color:#333333;">
  <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:650px;">
    <tbody>
      <tr>
        <td style="padding-right:20px;vertical-align:top;">
          <img src="https://justprint.com.ar/wp-content/uploads/2026/10/JustPrint_logo.png" alt="Justprint" width="175" style="display:block;width:175px;height:auto;border:0;margin:0;padding:0;">
          <br>
        </td>
        <td style="border-left:2px solid #4f81bd;width:2px;font-size:1px;line-height:0;">&nbsp;</td>
        <td style="padding-left:20px;vertical-align:top;">
          <div style="font-size:17px;font-weight:700;color:#333333;margin:0 0 5px 0;">Agustina Fabregas</div>
          <div style="font-size:12px;font-weight:700;color:#4f81bd;text-transform:uppercase;letter-spacing:0.4px;margin:0 0 9px 0;">Unidad de Empresas</div>
          <div style="font-size:12px;line-height:18px;color:#555555;margin:0;">
            <span style="color:#4f81bd;"><b>T</b></span> &nbsp;011 3510-4320&nbsp;&nbsp;|&nbsp;&nbsp;
            <span style="color:#4f81bd;"><b>E</b></span> &nbsp;
            <a href="mailto:administracion@justprint.com.ar" style="color:#555555;text-decoration:none;">administracion@justprint.com.ar</a> &nbsp;&nbsp;|&nbsp;&nbsp;
            <span style="color:#4f81bd;"><b>W</b></span> &nbsp;
            <a href="https://justprint.com.ar" style="color:#555555;text-decoration:none;">justprint.com.ar</a>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</div>
<div><br></div>`;
const FIRMA_TEXTO = ['Agustina Fabregas', 'Unidad de Empresas', 'T 011 3510-4320 | E administracion@justprint.com.ar | W justprint.com.ar'].join('\n');

/** "buenos días!" hasta las 12 (hora de Buenos Aires), "buenas tardes!" después. */
export const saludoSegunHora = (ahora = new Date()) => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora)) % 24;
  return h < 12 ? 'buenos días!' : 'buenas tardes!';
};

export function armarMensaje({ factura, ahora = new Date() }) {
  const mes = mesNombre(factura.periodo);
  const saludo = `Hola, ${saludoSegunHora(ahora)}`;
  const lineas = [saludo, '', `Adjuntamos factura por el servicio de ${mes}`, '', 'Dejamos los datos para la transferencia:', ...DATOS_TRANSFERENCIA, '', 'Quedamos atentos cualquier consulta,', 'Saludos!'];
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const p = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:20px;margin:0 0 14px 0;';
  const html = `<div style="${p}">${esc(saludo)}</div>
<div style="${p}">Adjuntamos factura por el servicio de ${esc(mes)}</div>
<div style="${p}">Dejamos los datos para la transferencia:<br>${DATOS_TRANSFERENCIA.map(esc).join('<br>')}</div>
<div style="${p}">Quedamos atentos cualquier consulta,<br>Saludos!</div>
${FIRMA_HTML}`;
  return { subject: `FAC Servicio de Impresión ${capital(mes)} <> JustPrint`, text: `${lineas.join('\n')}\n\n${FIRMA_TEXTO}`, html };
}

/** Manda el aviso y deja registro. Devuelve { estado, destinatarios }. Nunca tira: un fallo de mail no debe frenar la carga del PDF. */
export async function avisarFactura(db, { factura, pdf, nombrePdf, usuarioId, extras = [] }) {
  const dest = await destinatariosFactura(db, factura.cliente_id);
  let estado; let detalle = null;
  if (!dest.length) estado = 'sin_destinatarios';
  else if (!canales.mail.configurado()) estado = 'sin_mail';
  else {
    estado = 'enviado';
    const { subject, text, html } = armarMensaje({ factura });
    try { await canales.mail.enviar({ to: dest.map((d) => d.email).join(', '), subject, text, html, cuenta: 'facturacion', attachments: [{ filename: nombrePdf, content: pdf, contentType: 'application/pdf' }, ...extras] }); }
    catch (e) { estado = 'error'; detalle = String(e.code ?? e.message ?? 'fallo').slice(0, 200); }
  }
  await db('factura_avisos').insert({ factura_id: factura.id, destinatarios: JSON.stringify(dest.map((d) => d.email)), estado, detalle, enviado_por: usuarioId ?? null });
  return { estado, destinatarios: dest.map((d) => d.email) };
}
