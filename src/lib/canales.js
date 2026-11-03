// Canales de salida de las alertas. El del sistema (campana) no pasa por acá.
const env = (k) => process.env[k]?.trim() || '';

const mail = {
  configurado: () => Boolean(env('SMTP_HOST')),
  async enviar({ to, subject, text, html, attachments, cuenta }) {
    const { default: nodemailer } = await import('nodemailer');
    const puerto = Number(env('SMTP_PORT') || 587);
    // Los avisos de facturación pueden salir de su propia casilla (SMTP_FACTURACION_*); si no está definida, salen por la general.
    const f = cuenta === 'facturacion' && env('SMTP_FACTURACION_USER');
    const user = f ? env('SMTP_FACTURACION_USER') : env('SMTP_USER');
    const t = nodemailer.createTransport({ host: env('SMTP_HOST'), port: puerto, secure: puerto === 465, auth: user ? { user, pass: f ? env('SMTP_FACTURACION_PASS') : env('SMTP_PASS') } : undefined });
    await t.sendMail({ from: (f ? env('MAIL_FROM_FACTURACION') : '') || env('MAIL_FROM') || user, to, subject, text, ...(html ? { html } : {}), ...(attachments ? { attachments } : {}) });
  },
};

// WhatsApp Business (API de Meta). Para avisar a alguien que no te escribió en las últimas 24 h, Meta exige una plantilla aprobada:
// si WHATSAPP_TEMPLATE está definida se manda con ella (un solo parámetro con el texto); si no, se manda texto libre.
const whatsapp = {
  configurado: () => Boolean(env('WHATSAPP_API_TOKEN') && env('WHATSAPP_PHONE_ID')),
  async enviar({ to, text }) {
    const cuerpo = env('WHATSAPP_TEMPLATE')
      ? { type: 'template', template: { name: env('WHATSAPP_TEMPLATE'), language: { code: env('WHATSAPP_TEMPLATE_LANG') || 'es_AR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s*\n+\s*/g, ' | ').slice(0, 900) }] }] } }
      : { type: 'text', text: { body: text.slice(0, 3800) } };
    const r = await fetch(`https://graph.facebook.com/v21.0/${env('WHATSAPP_PHONE_ID')}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${env('WHATSAPP_API_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: String(to).replace(/\D/g, ''), ...cuerpo }),
    });
    if (!r.ok) throw new Error(`whatsapp_${r.status}`);
  },
};

export const canales = { mail, whatsapp };
/** Para las pruebas: reemplaza un canal por uno falso. */
export const reemplazarCanal = (nombre, impl) => { canales[nombre] = impl; };
export const estadoCanales = () => ({ sistema: true, mail: canales.mail.configurado(), whatsapp: canales.whatsapp.configurado() });
