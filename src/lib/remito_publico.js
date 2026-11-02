// Página del remito para el cliente: se abre desde el enlace que le llega por WhatsApp o mail. Sin sesión, sin costos.
import { config } from '../config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dmy = (s) => { const [a, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const cuando = (s) => new Date(`${String(s).replace(' ', 'T')}${String(s).includes('Z') ? '' : 'Z'}`).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const CSS = `
:root{--navy:#0D1B2A;--cian:#00BCD4;--cian-os:#00838F;--gris:#5B6B76;--suave:#7C8B96;--linea:#D9E2E7;--fondo:#EEF3F6}
*{box-sizing:border-box}body{margin:0;background:var(--fondo);color:var(--navy);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
.cab{background:var(--navy);border-bottom:3px solid var(--cian);padding:22px 20px 26px;color:#fff}
.cab .fila{max-width:640px;margin:0 auto}.cab img{height:26px;display:block;margin-bottom:22px}
.cab small{display:block;color:#9FB4BD;font-size:12px;font-weight:700;letter-spacing:.14em}
.cab h1{margin:2px 0 4px;font-size:30px;letter-spacing:-.01em;line-height:1.15}.cab p{margin:0;color:#9FB4BD;font-size:14px}
main{max-width:640px;margin:0 auto;padding:16px 16px 40px}
.tarjeta{background:#fff;border-radius:14px;padding:18px 18px;margin-bottom:14px;box-shadow:0 1px 2px rgba(13,27,42,.06),0 6px 20px rgba(13,27,42,.05)}
.tarjeta h2{margin:0 0 10px;font-size:12px;letter-spacing:.12em;text-transform:none;color:var(--suave);font-weight:700}
.tipo{display:inline-block;background:#E0F7FA;color:var(--cian-os);font-weight:700;font-size:12px;letter-spacing:.06em;border-radius:99px;padding:5px 12px;margin-bottom:12px}
.cli{font-size:19px;font-weight:700;margin:0}.apoyo{color:var(--gris);font-size:14px;margin:2px 0 0}
.item{display:flex;gap:14px;padding:12px 0;border-top:1px solid var(--linea)}.item:first-of-type{border-top:0;padding-top:2px}
.cant{min-width:38px;height:38px;border-radius:10px;background:var(--fondo);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px}
.item b{display:block;font-weight:600}.item span{color:var(--gris);font-size:14px}
.obs{white-space:pre-line;margin:0;color:var(--navy)}
.ok{border-left:4px solid #1F9D63}.pend{border-left:4px solid #E5A100}
.ok strong{color:#14693A}.pend strong{color:#8A5E00}
.firma{display:block;max-width:240px;width:100%;height:auto;border-bottom:1px solid var(--navy);margin:8px 0 6px}
.btn{display:block;text-align:center;background:var(--cian);color:var(--navy);font-weight:700;text-decoration:none;border-radius:12px;padding:15px 18px;font-size:16px;margin-bottom:10px}
.btn.sec{background:#fff;border:1.5px solid var(--linea);color:var(--navy)}
.soporte{background:var(--navy);color:#fff}.soporte h2{color:#9FB4BD}.soporte p{margin:0 0 10px;color:#D5E1E6}.soporte a{color:var(--cian);font-weight:700}
.pie{text-align:center;color:var(--suave);font-size:12.5px;margin-top:22px}
`;

const base = (titulo, cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(titulo)}</title><link rel="icon" href="/img/logo-oscuro.png"><style>${CSS}</style></head><body>${cuerpo}</body></html>`;

export function paginaPublicaRemito(r, { codigo } = {}) {
  if (!r) {
    return base('Remito no encontrado · JustPrint', `<div class="cab"><div class="fila"><img src="/img/logo-blanco.png" alt="JustPrint"><h1>No encontramos este remito</h1><p>Revisá que el enlace esté completo o pedinos que te lo reenviemos.</p></div></div>
      <main><div class="tarjeta soporte"><h2>Contacto</h2><p>Escribinos por WhatsApp y te lo mandamos de nuevo.</p><a href="https://wa.me/${esc(config.whatsappSoporte)}">Abrir WhatsApp</a></div></main>`);
  }
  const c = r.conformidad; const cli = r.cliente;
  const items = r.items.map((i) => `<div class="item"><div class="cant">${esc(i.cantidad)}</div><div><b>${esc(i.descripcion)}</b>${i.detalle ? `<span>${esc(i.detalle)}</span>` : ''}</div></div>`).join('');
  const conf = c
    ? `<div class="tarjeta ok"><h2>Conformidad</h2><strong>Recibido conforme</strong><p class="apoyo" style="font-size:16px;color:var(--navy);margin-top:6px"><b>${esc(c.nombre)}</b>${c.cargo ? ` · ${esc(c.cargo)}` : ''}${c.dni ? ` · DNI ${esc(c.dni)}` : ''}</p>
        ${c.tiene_firma ? `<img class="firma" src="/r/${esc(r.token)}/firma.png" alt="Firma de ${esc(c.nombre)}">` : ''}
        <p class="apoyo">${c.metodo === 'papel' ? 'Firmó el remito en papel' : 'Firmó en pantalla'} · ${esc(cuando(c.firmado_en))}</p></div>`
    : `<div class="tarjeta pend"><h2>Conformidad</h2><strong>Pendiente de firma</strong><p class="apoyo">Todavía no tenemos la conformidad de recepción de este remito.</p></div>`;
  return base(`Remito ${r.numero} · JustPrint`, `<div class="cab"><div class="fila"><img src="/img/logo-blanco.png" alt="JustPrint"><small>REMITO</small><h1>N° ${esc(r.numero)}</h1><p>${esc(dmy(r.fecha))}</p></div></div>
<main>
  <div class="tarjeta"><span class="tipo">${esc(r.tipo_texto.toUpperCase())}</span><p class="cli">${esc(cli.nombre_comercial || cli.razon_social)}</p>
    ${r.sede ? `<p class="apoyo">${esc([r.sede.nombre, r.sede.domicilio, r.sede.localidad].filter(Boolean).join(' · '))}</p>` : ''}</div>
  <div class="tarjeta"><h2>Detalle de lo entregado</h2>${items}</div>
  ${r.observaciones ? `<div class="tarjeta"><h2>${r.tipo === 'servicio' ? 'Trabajo realizado' : 'Observaciones'}</h2><p class="obs">${esc(r.observaciones)}</p></div>` : ''}
  ${conf}
  <a class="btn" href="/r/${esc(r.token)}/pdf">Ver o descargar el PDF</a>
  <div class="tarjeta soporte"><h2>¿Necesitás soporte técnico o insumos?</h2><p>Escaneá el QR pegado en tu equipo o escribinos.</p><a href="https://wa.me/${esc(config.whatsappSoporte)}">Escribir por WhatsApp</a> &nbsp;·&nbsp; <a href="mailto:soporte@justprint.com.ar">soporte@justprint.com.ar</a></div>
  <p class="pie">Europa Haus S.A.S. · JustPrint · Comprobante de entrega, no es un documento fiscal.${codigo ? `<br>Código de verificación ${esc(codigo)}` : ''}</p>
</main>`);
}
