// Página del remito para el cliente: se abre desde el enlace que le llega por WhatsApp o mail. Sin sesión, sin costos.
import { config } from '../config.js';
import { ASPECTOS } from './encuestas.js';

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
.op h2{margin-bottom:4px}.op .preg{font-size:18px;font-weight:700;margin:0 0 4px}
.estrellas{display:flex;flex-direction:row-reverse;justify-content:center;gap:4px;margin:10px 0 6px}
.estrellas input{position:absolute;opacity:0;pointer-events:none}
.estrellas label{font-size:46px;line-height:1;color:#CBD6DC;cursor:pointer;padding:0 2px;transition:transform .08s}
.estrellas label:active{transform:scale(1.12)}
.estrellas input:checked~label,.estrellas label:hover,.estrellas label:hover~label{color:#F5B301}
.estrellas input:focus-visible+label{outline:2px solid var(--cian-os);border-radius:6px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 14px}.chips input{position:absolute;opacity:0}
.chips label{border:1.5px solid var(--linea);border-radius:99px;padding:8px 14px;font-size:15px;cursor:pointer;background:#fff}
.chips input:checked+label{background:#E0F7FA;border-color:var(--cian);color:var(--cian-os);font-weight:700}
.chips input:focus-visible+label{outline:2px solid var(--cian-os)}
.op textarea{width:100%;border:1.5px solid var(--linea);border-radius:12px;padding:12px;font:inherit;resize:vertical;min-height:84px}
.op button{width:100%;border:0;cursor:pointer;font:inherit;font-weight:700}.op .fin{text-align:center;font-size:44px;letter-spacing:6px;color:#F5B301;margin:4px 0}
.hechos{display:grid;gap:12px}.hecho small{display:block;color:var(--suave);font-size:12px;font-weight:700;letter-spacing:.06em}.hecho b{font-weight:600}
.pie{text-align:center;color:var(--suave);font-size:12.5px;margin-top:22px}
`;

const base = (titulo, cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(titulo)}</title><link rel="icon" href="/img/logo-oscuro.png"><style>${CSS}</style></head><body>${cuerpo}</body></html>`;

function bloqueOpinion(r, e) {
  if (e) return `<div class="tarjeta op" id="opinion"><h2>Tu opinión</h2><div class="fin" aria-label="${e.puntaje} de 5 estrellas">${'★'.repeat(e.puntaje)}<span style="color:#CBD6DC">${'★'.repeat(5 - e.puntaje)}</span></div><p class="preg" style="text-align:center">¡Gracias por contarnos cómo te fue!</p><p class="apoyo" style="text-align:center">Lo leemos para mejorar la atención.</p></div>`;
  const estrellas = [5, 4, 3, 2, 1].map((n) => `<input type="radio" name="puntaje" id="p${n}" value="${n}" required><label for="p${n}" title="${n} de 5">★</label>`).join('');
  const chips = ASPECTOS.map((a) => `<input type="checkbox" name="aspectos" id="a-${a.clave}" value="${a.clave}"><label for="a-${a.clave}">${esc(a.texto)}</label>`).join('');
  return `<form class="tarjeta op" id="opinion" method="post" action="/r/${esc(r.token)}/encuesta"><h2>Tu opinión</h2><p class="preg">¿Cómo fue la atención que recibiste?</p>
    <div class="estrellas" role="radiogroup" aria-label="Calificación de 1 a 5 estrellas">${estrellas}</div>
    <p class="apoyo" style="text-align:center;margin-bottom:12px">Tocá una estrella: 5 es excelente.</p>
    <p class="apoyo" style="margin:0 0 2px"><b>¿Qué querés destacar o qué podemos mejorar?</b> (opcional)</p><div class="chips">${chips}</div>
    <textarea name="comentario" maxlength="1000" placeholder="¿Algo más que quieras contarnos? (opcional)" aria-label="Comentario"></textarea>
    <button class="btn" type="submit" style="margin:12px 0 0">Enviar opinión</button></form>`;
}

export function paginaPublicaRemito(r, { codigo, encuesta } = {}) {
  if (!r) {
    return base('Remito no encontrado · JustPrint', `<div class="cab"><div class="fila"><img src="/img/logo-blanco.png" alt="JustPrint"><h1>No encontramos este remito</h1><p>Revisá que el enlace esté completo o pedinos que te lo reenviemos.</p></div></div>
      <main><div class="tarjeta soporte"><h2>Contacto</h2><p>Escribinos por WhatsApp y te lo mandamos de nuevo.</p><a href="https://wa.me/${esc(config.whatsappSoporte)}">Abrir WhatsApp</a></div></main>`);
  }
  const c = r.conformidad; const cli = r.cliente; const srv = r.tipo === 'servicio'; const S = r.servicio ?? {};
  const items = r.items.map((i) => `<div class="item"><div class="cant">${esc(i.cantidad)}</div><div><b>${esc(i.descripcion)}</b>${i.detalle ? `<span>${esc(i.detalle)}</span>` : ''}</div></div>`).join('');
  const conf = c
    ? `<div class="tarjeta ok"><h2>Conformidad</h2><strong>${srv ? 'Servicio conforme' : 'Recibido conforme'}</strong><p class="apoyo" style="font-size:16px;color:var(--navy);margin-top:6px"><b>${esc(c.nombre)}</b>${c.cargo ? ` · ${esc(c.cargo)}` : ''}${c.dni ? ` · DNI ${esc(c.dni)}` : ''}</p>
        ${c.tiene_firma ? `<img class="firma" src="/r/${esc(r.token)}/firma.png" alt="Firma de ${esc(c.nombre)}">` : ''}
        <p class="apoyo">${c.metodo === 'papel' ? 'Firmó el ${esc(r.documento.toLowerCase())} en papel' : 'Firmó en pantalla'} · ${esc(cuando(c.firmado_en))}</p></div>`
    : `<div class="tarjeta pend"><h2>Conformidad</h2><strong>Pendiente de firma</strong><p class="apoyo">${srv ? 'Todavía no tenemos la conformidad de este servicio.' : 'Todavía no tenemos la conformidad de recepción de este remito.'}</p></div>`;
  const hora = (x) => cuando(x);
  const hechos = srv ? [['Ticket', S.ticket?.numero ?? r.numero], ['Motivo', S.ticket?.asunto], ['Equipo', S.equipo ? `${S.equipo.marca} ${S.equipo.modelo} · N° de serie ${S.equipo.serie}` : null],
    ['Fecha y horario', S.horario || dmy(r.fecha)], ['Atendió', S.tecnico ? `${S.tecnico} · JustPrint` : 'JustPrint'],
    S.contador_negro != null ? ['Contadores al cierre', `Negro ${S.contador_negro}${S.equipo?.tipo === 'color' || S.contador_color ? ` · Color ${S.contador_color ?? 0}` : ''}`] : null].filter((x) => x && x[1]) : [];
  const hechosHtml = hechos.map(([k, v]) => `<div class="hecho"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('');
  const tituloDoc = `${r.documento} ${r.numero} · JustPrint`;
  return base(tituloDoc, `<div class="cab"><div class="fila"><img src="/img/logo-blanco.png" alt="JustPrint"><small>${esc(r.documento.toUpperCase())}</small><h1${srv ? ' style="font-size:25px"' : ''}>${srv ? '' : 'N° '}${esc(r.numero)}</h1><p>${esc(dmy(r.fecha))}</p></div></div>
<main>
  <div class="tarjeta"><span class="tipo">${esc(r.tipo_texto.toUpperCase())}</span><p class="cli">${esc(cli.nombre_comercial || cli.razon_social)}</p>
    ${r.sede ? `<p class="apoyo">${esc([r.sede.nombre, r.sede.domicilio, r.sede.localidad].filter(Boolean).join(' · '))}</p>` : ''}</div>
  ${srv ? `<div class="tarjeta"><h2>Servicio realizado</h2><div class="hechos">${hechosHtml}</div></div>
  ${S.diagnostico ? `<div class="tarjeta"><h2>Diagnóstico</h2><p class="obs">${esc(S.diagnostico)}</p></div>` : ''}
  <div class="tarjeta"><h2>Trabajo realizado</h2><p class="obs">${esc(S.trabajo || 'Sin detalle.')}</p></div>
  ${r.items.length ? `<div class="tarjeta"><h2>Repuestos e insumos utilizados</h2>${items}</div>` : ''}`
  : `<div class="tarjeta"><h2>Detalle de lo entregado</h2>${items}</div>
  ${r.observaciones ? `<div class="tarjeta"><h2>Observaciones</h2><p class="obs">${esc(r.observaciones)}</p></div>` : ''}`}
  ${conf}
  ${c && srv ? bloqueOpinion(r, encuesta) : ''}
  <a class="btn" href="/r/${esc(r.token)}/pdf">Ver o descargar el PDF</a>
  <div class="tarjeta soporte"><h2>¿Necesitás soporte técnico o insumos?</h2><p>Escaneá el QR pegado en tu equipo o escribinos.</p><a href="https://wa.me/${esc(config.whatsappSoporte)}">Escribir por WhatsApp</a> &nbsp;·&nbsp; <a href="mailto:soporte@justprint.com.ar">soporte@justprint.com.ar</a></div>
  <p class="pie">Europa Haus S.A.S. · JustPrint · ${srv ? 'Comprobante de servicio' : 'Comprobante de entrega'}, no es un documento fiscal.${codigo ? `<br>Código de verificación ${esc(codigo)}` : ''}</p>
</main>`);
}
