// Portal de clientes de JustPrint. Solo lectura de lo operativo; el cliente puede calificar la atención y elegir su contraseña.
const raiz = document.getElementById('raiz');
let D = null; // datos del portal
const E = { vista: 'inicio', eq: 'todos', doc: 'conf', ct: null, menu: false, meses: 12 };

// ── utilidades ─────────────────────────────────────────────
const SVG = 'http://www.w3.org/2000/svg';
function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  agregar(el, hijos); return el;
}
function agregar(el, hijos) { for (const x of hijos.flat(Infinity)) { if (x == null || x === false) continue; el.append(x.nodeType ? x : document.createTextNode(String(x))); } return el; }
const vaciar = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
function icono(d, cls = 'i') {
  const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); return s;
}
const I = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  print: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  chat: 'M4 5h16v11H9l-5 4z', down: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14', mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  x: 'M6 6l12 12M18 6L6 18', all: 'M3 12h4l3-8 4 16 3-8h4', star: 'M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
};
const n = (x) => Number(x ?? 0).toLocaleString('es-AR');
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fecha = (s) => { if (!s) return '—'; const [a, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${MES[m - 1]} ${a}`; };
const fechaLarga = (s) => { const [a, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} de ${MES_LARGO[m - 1]} de ${a}`; };
const mesCorto = (p) => MES[Number(p.slice(5, 7)) - 1][0].toUpperCase() + MES[Number(p.slice(5, 7)) - 1].slice(1);
const mesLargo = (p) => `${MES_LARGO[Number(p.slice(5, 7)) - 1][0].toUpperCase()}${MES_LARGO[Number(p.slice(5, 7)) - 1].slice(1)} ${p.slice(0, 4)}`;
const plata = (mon, v) => (mon === 'USD' ? `USD ${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$ ${Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`);
const neto = (f) => `${plata(f.moneda, f.neto)}${f.iva > 0 ? ' + IVA' : ''}`;
const botonExcel = (extra = '') => h('a', { class: `btn ghost ${extra}`.trim(), href: '/portal/api/excel', download: '' }, icono(I.down), 'Descargar Excel');
const iniciales = (s) => String(s || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const TIPO_TK = { soporte: 'Soporte técnico', instalacion: 'Instalación', retiro: 'Retiro de equipo' };
const ESTADO_TK = { abierto: 'Recibido', asignado: 'Técnico asignado', en_curso: 'En curso', esperando_cliente: 'Esperando tu respuesta' };

function toast(t) { document.querySelector('.toast')?.remove(); const el = h('div', { class: 'toast', role: 'status' }, t); document.body.append(el); setTimeout(() => el.remove(), 2800); }

async function api(url, { metodo = 'GET', cuerpo } = {}) {
  const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'error'); e.estado = r.status; e.codigo = j.error; e.mensaje = j.mensaje; throw e; }
  return j;
}

// ── pantallas de acceso ────────────────────────────────────
const logo = (cls) => h('img', { class: cls, src: '/img/logo-oscuro.png', alt: 'JustPrint' });
/** Campo de contraseña con el ojito para verla u ocultarla mientras se escribe. */
function conOjo(input) {
  const ojo = h('button', { class: 'ojo', type: 'button', 'aria-label': 'Mostrar contraseña', 'aria-pressed': 'false' }, icono(I.eye));
  ojo.addEventListener('click', () => { const ver = input.type === 'password'; input.type = ver ? 'text' : 'password'; ojo.setAttribute('aria-pressed', String(ver)); ojo.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña'); ojo.classList.toggle('on', ver); input.focus(); });
  return h('div', { class: 'conojo' }, input, ojo);
}
function campo(id, etiqueta, attrs) { return h('div', { class: 'fld' }, h('label', { for: id }, etiqueta), h('input', { id, ...attrs })); }

function pantallaLogin(aviso) {
  vaciar(raiz);
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true, placeholder: 'tu@empresa.com' });
  const clave = h('input', { id: 'clave', type: 'password', autocomplete: 'current-password', required: true });
  const msg = h('div', { role: 'alert' });
  const poner = (t, tipo) => { vaciar(msg).className = `msg ${tipo}`; msg.append(t); };
  if (aviso) poner(aviso, 'bad');
  const enviar = h('button', { class: 'btn', type: 'submit', style: 'width:100%;margin-top:20px' }, 'Entrar');
  raiz.append(h('div', { class: 'centro' }, h('form', { class: 'login', onsubmit: async (ev) => {
    ev.preventDefault(); enviar.disabled = true;
    try { await api('/portal/api/login', { metodo: 'POST', cuerpo: { email: email.value, password: clave.value } }); await cargar(); }
    catch (e) { poner(e.estado === 429 ? 'Hiciste muchos intentos. Esperá unos minutos.' : 'El mail o la contraseña no coinciden. Si no tenés contraseña o la olvidaste, pedí un enlace.', 'bad'); }
    enviar.disabled = false;
  } },
  logo('logo'), h('h1', null, 'Tu portal de JustPrint'), h('p', { class: 'mut', style: 'margin:0;font-size:16px' }, 'Tus equipos, contadores, conformidades y facturas en un solo lugar.'),
  h('div', { class: 'fld' }, h('label', { for: 'email' }, 'Mail'), email), h('div', { class: 'fld' }, h('label', { for: 'clave' }, 'Contraseña'), conOjo(clave)),
  enviar, msg,
  h('p', { style: 'margin:18px 0 0;font-size:14px;color:var(--mut)' }, '¿Primera vez o no recordás la contraseña? ',
    h('button', { class: 'linkbtn', type: 'button', onclick: async () => {
      if (!email.value || !email.validity.valid) { poner('Escribí tu mail arriba y volvé a tocar.', 'bad'); email.focus(); return; }
      try { await api('/portal/api/enlace', { metodo: 'POST', cuerpo: { email: email.value } }); poner('Listo. Si ese mail tiene acceso, te mandamos un enlace para ingresar. Revisá también la carpeta de spam.', 'ok'); }
      catch { poner('No pudimos enviarlo ahora. Probá de nuevo en unos minutos.', 'bad'); }
    } }, 'Pedí un enlace por mail')))));
  email.focus();
}

function pantallaClave() {
  vaciar(raiz);
  const a = h('input', { id: 'c1', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const b = h('input', { id: 'c2', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const msg = h('div', { role: 'alert' });
  raiz.append(h('div', { class: 'centro' }, h('form', { class: 'login', onsubmit: async (ev) => {
    ev.preventDefault(); vaciar(msg).className = '';
    if (a.value !== b.value) { msg.className = 'msg bad'; msg.append('Las dos contraseñas tienen que ser iguales.'); return; }
    try { await api('/portal/api/clave', { metodo: 'POST', cuerpo: { clave: a.value } }); toast('Contraseña guardada'); await cargar(); }
    catch (e) { msg.className = 'msg bad'; msg.append(e.mensaje || 'No pudimos guardarla. Probá con otra.'); }
  } },
  logo('logo'), h('h1', null, 'Elegí tu contraseña'), h('p', { class: 'mut', style: 'margin:0;font-size:16px' }, 'La próxima vez vas a entrar con tu mail y esta contraseña. Usá al menos 8 caracteres, con letras y números.'),
  h('div', { class: 'fld' }, h('label', { for: 'c1' }, 'Contraseña nueva'), conOjo(a)), h('div', { class: 'fld' }, h('label', { for: 'c2' }, 'Repetila'), conOjo(b)),
  h('button', { class: 'btn', type: 'submit', style: 'width:100%;margin-top:20px' }, 'Guardar y entrar'), msg,
  h('p', { style: 'margin:14px 0 0;text-align:center' }, h('button', { class: 'linkbtn', type: 'button', onclick: () => cargar() }, 'Ahora no, entrar igual')))));
  a.focus();
}

// ── componentes ────────────────────────────────────────────
function estrellas({ valor = 0, bloqueada, alElegir, etiqueta = 'Calificar la atención' }) {
  const caja = h('div', { class: 'stars', role: 'group', 'aria-label': etiqueta });
  for (let i = 1; i <= 5; i += 1) caja.append(h('button', { type: 'button', class: `star ${i <= valor ? 'on' : ''}`, 'aria-label': `${i} ${i === 1 ? 'estrella' : 'estrellas'}`, disabled: bloqueada, onclick: () => alElegir?.(i) }, icono(I.star, '')));
  return caja;
}

/** Calificación: estrellas, qué destacó o qué mejorar y un comentario. Solo la responde el cliente. */
function formularioOpinion(c, alTerminar) {
  let punt = 0; const asp = new Set();
  const cuerpo = h('div'); const chips = h('div', { class: 'chips' }); const com = h('textarea', { rows: 3, maxlength: 1000, id: 'op-com', placeholder: 'Opcional' });
  const detalle = h('div', { class: 'oculto' });
  const enviar = h('button', { class: 'btn cy', type: 'button', disabled: true }, 'Enviar opinión');
  const pintar = () => {
    vaciar(cuerpo).append(estrellas({ valor: punt, alElegir: (i) => { punt = i; enviar.disabled = false; detalle.classList.remove('oculto'); pintar(); chips.previousSibling.textContent = i >= 4 ? '¿Qué destacás?' : '¿Qué podemos mejorar?'; } }));
  };
  for (const a of D.aspectos) chips.append(h('button', { type: 'button', 'aria-pressed': 'false', onclick: (ev) => { const b = ev.currentTarget; if (asp.has(a.clave)) { asp.delete(a.clave); b.setAttribute('aria-pressed', 'false'); } else { asp.add(a.clave); b.setAttribute('aria-pressed', 'true'); } } }, a.texto));
  enviar.addEventListener('click', async () => {
    enviar.disabled = true;
    try { await api('/portal/api/encuesta', { metodo: 'POST', cuerpo: { remito_id: c.id, puntaje: punt, aspectos: [...asp], comentario: com.value } }); toast('¡Gracias por tu opinión!'); await cargar(false); alTerminar?.(); }
    catch (e) { toast(e.codigo === 'ya_respondida' ? 'Esa atención ya tiene tu opinión.' : 'No pudimos guardarla. Probá de nuevo.'); enviar.disabled = false; }
  });
  pintar();
  detalle.append(h('p', { class: 't1', style: 'margin-top:14px' }, '¿Qué destacás?'), chips, h('div', { class: 'fld' }, h('label', { for: 'op-com' }, 'Comentario'), com), h('div', { style: 'margin-top:16px' }, enviar));
  return h('div', null, cuerpo, detalle);
}

function sheet(titulo, sub, cuerpo) {
  const cerrar = () => scrim.remove();
  const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) cerrar(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sh-t' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px' }, h('div', null, h('h2', { class: 'h2', id: 'sh-t' }, titulo), sub && h('p', { class: 't2', style: 'font-size:16px;margin-top:6px' }, sub)),
        h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Cerrar', onclick: cerrar, style: 'padding:0;width:44px;flex:none' }, icono(I.x))),
      typeof cuerpo === 'function' ? cuerpo(cerrar) : cuerpo));
  document.body.append(scrim); return cerrar;
}

function pedirSoporte() {
  const wa = `https://wa.me/${D.contacto.whatsapp}?text=${encodeURIComponent(`Hola, soy ${D.usuario.nombre} de ${D.cliente.nombre}. Necesito soporte técnico.`)}`;
  const mail = `mailto:${D.contacto.email_soporte}?subject=${encodeURIComponent(`Soporte técnico · ${D.cliente.nombre}`)}&body=${encodeURIComponent('Equipo:\nQué pasa:\n')}`;
  sheet('Pedir soporte', 'Contanos qué equipo y qué pasa. Te respondemos y coordinamos la visita.', () => h('div', { style: 'display:flex;flex-direction:column;gap:10px;margin-top:22px' },
    h('a', { class: 'btn cy', href: mail }, icono(I.mail), 'Escribir a soporte'), h('a', { class: 'btn ghost', href: wa, target: '_blank', rel: 'noopener' }, icono(I.chat), 'Escribir por WhatsApp')));
}

// ── vistas ─────────────────────────────────────────────────
function periodoActual() { const c = D.consumo.filter((x) => x.hay); return c.length ? c.at(-1).periodo : D.periodos.at(-1); }
const sumar = (l, k) => l.reduce((t, x) => t + (x[k] ?? 0), 0);

/** Anillo de consumo: cuánto se usó de lo incluido. Pasado el 100 % cambia a ámbar y dice cuántas páginas de más. */
function anillo(titulo, usado, incluido, trazo) {
  const R = 54; const C = Math.round(2 * Math.PI * R); const pct = incluido > 0 ? Math.round((usado / incluido) * 100) : null;
  const pasado = pct != null && pct > 100; const off = pct == null ? C : Math.round(C * (1 - Math.min(100, pct) / 100));
  const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 140 140'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="13"></circle><circle class="ring-fg" cx="70" cy="70" r="${R}" fill="none" stroke="${pasado ? '#FFB547' : trazo}" stroke-width="13" stroke-linecap="round" style="--c:${C};stroke-dasharray:${C};stroke-dashoffset:${off}"></circle>`;
  return h('div', { class: 'ringcol' },
    h('div', { class: 'ringbox', role: 'img', 'aria-label': pct == null ? `${titulo}: ${n(usado)} páginas` : `${titulo}: ${pct} por ciento de lo incluido` }, s,
      h('div', { class: 'mid' }, pct == null ? h('span', { class: 'big', style: 'font-size:22px' }, n(usado)) : h('span', { class: 'big', style: 'font-size:30px' }, `${pct}`, h('small', { style: 'font-size:15px;letter-spacing:0' }, '%')))),
    h('p', { style: 'font-weight:700;font-size:15px;margin-top:12px' }, titulo),
    h('p', { class: 'mut', style: 'font-size:14px;margin-top:2px' }, incluido > 0 ? `${n(usado)} de ${n(incluido)}` : 'Sin tope de páginas'),
    pasado && h('p', { style: 'font-size:13px;margin-top:4px;color:#FFB547;font-weight:600' }, `${n(usado - incluido)} sobre lo incluido`));
}

function vistaInicio() {
  const per = periodoActual(); const u = D.consumo.find((x) => x.periodo === per) ?? { negro: 0, color: 0 };
  const incN = sumar(D.contratos, 'franquicia_negro'); const incC = sumar(D.contratos, 'franquicia_color');
  const pend = D.conformidades.find((c) => c.puntaje == null);
  const com = D.comercial;
  const f = D.facturas[0];
  const saludo = new Date().getHours() < 12 ? 'Buen día' : new Date().getHours() < 20 ? 'Buenas tardes' : 'Buenas noches';

  return h('section', { class: 'view', 'aria-labelledby': 'h-ini' },
    h('h1', { class: 'h1', id: 'h-ini' }, `${saludo}, ${D.usuario.nombre.split(' ')[0]}.`),
    h('p', { class: 'sub' }, `Todo lo de ${D.cliente.nombre} con JustPrint, en un solo lugar: tus equipos, cuánto imprimiste y lo que necesitás descargar.`),
    h('div', { class: 'bento' },
      h('div', { class: 'tile dark s7' }, h('div', { class: 'hero-flex', style: 'display:flex;align-items:center;gap:36px' },
        h('div', { class: 'rings' }, anillo('Blanco y negro', u.negro, incN, '#FFFFFF'), (incC > 0 || u.color > 0) && anillo('Color', u.color, incC, '#00BCD4')),
        h('div', { style: 'flex:1;min-width:0' }, h('p', { class: 'lbl' }, mesLargo(per)), h('p', { class: 'big', style: 'margin-top:6px' }, n(u.negro + u.color)),
          h('p', { class: 'mut', style: 'margin:6px 0 0;font-size:16px' }, `páginas impresas entre ${D.equipos.length === 1 ? 'tu equipo' : `tus ${D.equipos.length} equipos`}${D.contratos.length > 1 ? ` y ${D.contratos.length} contratos` : ''}`)))),

      h('div', { class: 'tile s5' }, D.soporte ? [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px' }, h('p', { class: 'lbl' }, 'Tu pedido de soporte'), h('span', { class: 'chip cy' }, h('span', { class: 'dot' }), ESTADO_TK[D.soporte.estado] ?? 'En curso')),
        h('p', { class: 'h2', style: 'margin-top:14px' }, D.soporte.asunto),
        h('p', { class: 't2', style: 'font-size:16px;margin-top:10px' }, [TIPO_TK[D.soporte.tipo], D.soporte.equipo].filter(Boolean).join(' · ')),
        D.soporte.tecnico && h('div', { style: 'margin-top:22px;display:flex;align-items:center;gap:12px' }, h('div', { class: 'av', style: 'width:48px;height:48px', 'aria-hidden': 'true' }, iniciales(D.soporte.tecnico)), h('div', null, h('p', { class: 't1' }, D.soporte.tecnico), h('p', { class: 't2' }, `Técnico asignado · Ticket ${D.soporte.numero}`))),
      ] : [h('p', { class: 'lbl' }, 'Soporte'), h('p', { class: 'h2', style: 'margin-top:14px' }, 'No tenés pedidos abiertos.'),
        h('p', { class: 't2', style: 'font-size:16px;margin-top:10px' }, 'Si algo no anda bien, pedinos soporte y coordinamos la visita.'), h('div', { style: 'margin-top:22px' }, h('button', { class: 'btn cy', type: 'button', onclick: pedirSoporte }, icono(I.chat), 'Pedir soporte'))]),

      h('div', { class: 'tile s4' }, h('p', { class: 'lbl' }, 'Tu comercial'),
        h('div', { style: 'display:flex;align-items:center;gap:14px;margin-top:16px' }, h('div', { class: 'av', style: 'width:60px;height:60px;font-size:20px', 'aria-hidden': 'true' }, iniciales(com?.nombre || 'JP')),
          h('div', null, h('p', { class: 't1', style: 'font-size:19px' }, com?.nombre || 'Equipo comercial'), h('p', { class: 't2' }, 'Para contrato, equipos nuevos o dudas con la factura'))),
        h('div', { style: 'display:flex;gap:10px;margin-top:20px;flex-wrap:wrap' }, h('a', { class: 'btn ghost', href: `mailto:${D.contacto.email_ventas}` }, icono(I.mail), 'Escribirle'), h('a', { class: 'btn ghost', href: `https://wa.me/${D.contacto.whatsapp}`, target: '_blank', rel: 'noopener' }, icono(I.phone), 'WhatsApp'))),

      pend && h('div', { class: 'tile s4' }, h('p', { class: 'lbl' }, `¿Cómo te fue${pend.tecnico ? ` con ${pend.tecnico.split(' ')[0]}` : ''}?`),
        h('p', { class: 't2', style: 'font-size:15px;margin:8px 0 14px' }, `Cerramos tu ${(TIPO_TK[pend.tipo] || 'servicio').toLowerCase()} del ${fecha(pend.fecha)}. Tu opinión nos ayuda a mejorar la atención.`),
        D.usuario.vista ? estrellas({ valor: 0, bloqueada: true }) : h('button', { class: 'btn cy', type: 'button', onclick: () => sheet('Tu opinión', `${pend.asunto} · ${fecha(pend.fecha)}`, (cerrar) => formularioOpinion(pend, () => { cerrar(); mostrar(); })) }, icono(I.star), 'Calificar la atención')),

      f && h('div', { class: 'tile s4' }, h('p', { class: 'lbl' }, 'Última factura'), h('p', { class: 'h2', style: 'margin-top:12px;font-size:34px' }, neto(f)),
        h('p', { class: 't2', style: 'margin-top:6px' }, `${mesLargo(f.periodo)}${f.vencimiento ? ` · ${f.estado === 'cobrada' ? 'pagada' : `vence el ${fechaLarga(f.vencimiento).replace(/ de \d+$/, '')}`}` : ''}`),
        h('div', { style: 'margin-top:20px' }, chipFactura(f))),

      h('div', { class: 'tile s12' }, h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px' }, h('p', { class: 'h2', style: 'font-size:22px' }, 'Tus equipos'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => ir('equipos') }, 'Ver contadores')),
        h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px;margin-top:12px' },
          D.equipos.length ? D.equipos.map((e) => h('button', { class: 'eq', type: 'button', onclick: () => { E.eq = String(e.id); ir('equipos'); } }, h('span', { class: 'ic' }, icono(I.print)),
            h('span', { class: 'grow' }, h('span', { class: 't1', style: 'display:block' }, e.modelo), h('span', { class: 't2', style: 'display:block' }, e.sede || e.contrato)), h('span', { class: 'chip ok' }, h('span', { class: 'dot' }), 'Activo')))
            : h('p', { class: 't2' }, 'Todavía no hay equipos instalados.')))));
}

function chipFactura(f) {
  if (f.estado === 'cobrada') return h('span', { class: 'chip ok' }, h('span', { class: 'dot' }), 'Pagada');
  if (f.estado === 'cobrada_parcial') return h('span', { class: 'chip warn' }, h('span', { class: 'dot' }), 'Pago parcial');
  return f.vencida ? h('span', { class: 'chip bad' }, h('span', { class: 'dot' }), 'Vencida') : h('span', { class: 'chip warn' }, h('span', { class: 'dot' }), 'Por vencer');
}

function vistaEquipos() {
  const uno = D.equipos.find((e) => String(e.id) === E.eq);
  const serie = (uno ? uno.consumo : D.consumo).slice(-E.meses); const color = uno ? uno.color : D.equipos.some((e) => e.color);
  const max = Math.max(1, ...serie.map((x) => x.negro + x.color)); const H = 196;
  const per = periodoActual(); const i = serie.findIndex((x) => x.periodo === per); const a = serie[i]; const ant = serie[i - 1];
  const tot = a ? a.negro + a.color : 0; const totAnt = ant ? ant.negro + ant.color : 0;
  const delta = totAnt > 0 ? `${tot >= totAnt ? '+' : '−'}${Math.abs(Math.round(((tot - totAnt) / totAnt) * 1000) / 10).toString().replace('.', ',')}%` : '—';
  const lista = [{ id: 'todos', modelo: 'Todos los equipos', sede: D.equipos.length > 1 ? `Suma de tus ${D.equipos.length} equipos` : 'Total', d: I.all }, ...D.equipos.map((e) => ({ id: String(e.id), modelo: e.modelo, sede: e.sede || e.contrato, d: I.print }))];
  const dato = (t, v) => h('p', null, h('span', { class: 't2' }, t), h('br'), h('span', { class: 'v' }, v));

  return h('section', { class: 'view', 'aria-labelledby': 'h-eq' }, h('h1', { class: 'h1', id: 'h-eq' }, 'Equipos y contadores'), h('p', { class: 'sub' }, 'Mirá cuánto se imprime en total y en cada equipo, mes a mes.'),
    h('div', { class: 'eqsplit', style: 'display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:16px;margin-top:36px;align-items:start' },
      h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, lista.map((e) => h('button', { class: 'eq', type: 'button', 'aria-pressed': String(E.eq === e.id), onclick: () => { E.eq = e.id; mostrar(); } }, h('span', { class: 'ic' }, icono(e.d)), h('span', { class: 'grow' }, h('span', { class: 't1', style: 'display:block' }, e.modelo), h('span', { class: 't2', style: 'display:block' }, e.sede))))),
      h('div', { class: 'tile', style: 'padding:32px' },
        h('div', { style: 'display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start' }, h('div', null, h('h2', { class: 'h2' }, uno ? uno.modelo : 'Todos los equipos'), h('p', { class: 't2', style: 'font-size:16px;margin-top:6px' }, uno ? [uno.sede || uno.contrato, uno.domicilio].filter(Boolean).join(' · ') : `${D.equipos.length} ${D.equipos.length === 1 ? 'equipo' : 'equipos'}`)),
          uno && h('span', { class: 'chip ok' }, h('span', { class: 'dot' }), 'Activo')),
        h('div', { style: 'display:flex;gap:40px;flex-wrap:wrap;margin-top:28px' }, h('div', null, h('p', { class: 'lbl' }, `Total ${MES_LARGO[Number(per.slice(5, 7)) - 1]}`), h('p', { class: 'big', style: 'margin-top:6px' }, n(tot))),
          h('div', null, h('p', { class: 'lbl' }, 'Blanco y negro'), h('p', { class: 'big', style: 'margin-top:6px;font-size:36px' }, n(a?.negro))),
          color && h('div', null, h('p', { class: 'lbl' }, 'Color'), h('p', { class: 'big', style: 'margin-top:6px;font-size:36px;color:var(--cyd)' }, n(a?.color))),
          ant && h('div', null, h('p', { class: 'lbl' }, `Frente a ${MES_LARGO[Number(ant.periodo.slice(5, 7)) - 1]}`), h('p', { class: 'big', style: 'margin-top:6px;font-size:36px' }, delta))),
        !serie.some((x) => x.hay) ? h('p', { class: 't2', style: 'margin:32px 0 0;font-size:16px' }, 'Todavía no hay lecturas de contadores para mostrar. Aparecen apenas se toma la primera lectura del mes.') : [h('div', { style: 'margin-top:32px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap' }, h('p', { class: 't1' }, 'Páginas por mes'),
          h('div', { style: 'display:flex;gap:16px;font-size:13px;font-weight:600;color:var(--mut);align-items:center;flex-wrap:wrap' }, h('div', { class: 'seg-tabs sm', role: 'group', 'aria-label': 'Meses a mostrar' }, [6, 12].map((m) => h('button', { type: 'button', 'aria-pressed': String(E.meses === m), onclick: () => { E.meses = m; mostrar(); } }, `${m} meses`))), h('span', { style: 'display:flex;align-items:center;gap:6px' }, h('span', { style: 'width:12px;height:12px;border-radius:4px;background:var(--ink)' }), 'Blanco y negro'),
            color && h('span', { style: 'display:flex;align-items:center;gap:6px' }, h('span', { style: 'width:12px;height:12px;border-radius:4px;background:var(--cy)' }), 'Color'))),
        h('div', { class: `chart ${serie.length > 8 ? 'p12' : ''}`, role: 'img', 'aria-label': `Páginas impresas por mes, de ${MES_LARGO[Number(serie[0].periodo.slice(5, 7)) - 1]} a ${MES_LARGO[Number(serie.at(-1).periodo.slice(5, 7)) - 1]}` },
          serie.map((x, k) => { const hB = Math.round((x.negro / max) * H); const hC = Math.round((x.color / max) * H);
            return h('div', { class: 'col' }, h('small', { class: 'v' }, x.hay ? n(x.negro + x.color) : '—'), h('div', { class: 'stack', style: `animation-delay:${k * 0.07}s` }, h('div', { class: `seg cl ${hC && !hB ? 'only' : ''}`, style: `height:${hC}px` }), h('div', { class: `seg bn ${hB && !hC ? 'only' : ''}`, style: `height:${hB}px` })), h('small', null, mesCorto(x.periodo))); }))],
        uno && h('div', { class: 'facts', style: 'margin-top:28px;padding-top:24px;border-top:1px solid var(--line)' }, dato('Modelo', uno.modelo), dato('Número de serie', uno.serie), dato('Ubicación', uno.sede || '—'), dato('Dirección', uno.domicilio || '—'), dato('Instalado', fecha(uno.instalado)), dato('Última lectura', fecha(uno.ultima_lectura))),
        h('div', { style: 'display:flex;gap:10px;margin-top:28px;flex-wrap:wrap' }, h('button', { class: 'btn ghost', type: 'button', onclick: pedirSoporte }, 'Reportar un problema'), botonExcel()))));
}

function vistaDocumentos() {
  const tabs = [['conf', 'Conformidades'], ['rem', 'Remitos'], ['fact', 'Facturas'], ['con', 'Contrato']];
  const pdf = (href, etiqueta, texto = 'PDF') => h('a', { class: 'btn ghost', href, download: '', 'aria-label': etiqueta }, icono(I.down), texto);
  const fila = (t1, l1, l2, medio, descarga) => h('div', { class: 'row' }, h('span', { class: 'ic' }, icono(I.doc)), h('div', { class: 'grow' }, h('p', { class: 't1' }, t1), h('p', { class: 't2' }, l1), l2 && h('p', { class: 't2' }, l2)), medio, descarga);
  const vacio = (t) => h('p', { class: 't2', style: 'padding:20px 0;font-size:16px' }, t);
  let filas;
  if (E.doc === 'conf') filas = D.conformidades.map((c) => fila(c.asunto || TIPO_TK[c.tipo] || 'Servicio técnico', `${TIPO_TK[c.tipo] || 'Servicio'} · ${fecha(c.fecha)} · ${c.numero}`, [c.equipo, c.tecnico && `Atendió ${c.tecnico}`].filter(Boolean).join(' · '),
    c.puntaje != null ? h('div', null, estrellas({ valor: c.puntaje, bloqueada: true, etiqueta: 'Tu calificación' }), h('span', { class: 't2', style: 'font-size:13px' }, 'Tu calificación'))
      : !D.usuario.vista && h('button', { class: 'btn cy', type: 'button', onclick: () => sheet('Tu opinión', `${c.asunto} · ${fecha(c.fecha)}`, (cerrar) => formularioOpinion(c, () => { cerrar(); mostrar(); })) }, icono(I.star), 'Calificar'),
    pdf(`/r/${c.token}/pdf`, `Descargar conformidad ${c.numero}`)));
  else if (E.doc === 'rem') filas = D.remitos.map((r) => fila(`Remito ${r.numero}`, `${fecha(r.fecha)}${r.detalle ? ` · ${r.detalle}` : ''}`, null, null, pdf(`/r/${r.token}/pdf`, `Descargar remito ${r.numero}`)));
  else if (E.doc === 'fact') filas = D.facturas.map((f) => fila(f.numero ? `${f.tipo ? `Factura ${f.tipo} ` : ''}${f.numero}` : `Factura ${mesLargo(f.periodo)}`, `${mesLargo(f.periodo)} · ${neto(f)}`, f.estado === 'cobrada' ? null : (f.vencimiento ? `Vence el ${fecha(f.vencimiento)}` : null), chipFactura(f), f.comprobante ? h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, pdf(`/portal/api/facturas/${f.id}/comprobante`, `Descargar factura ${f.numero || mesLargo(f.periodo)}`), f.anexo && pdf(`/portal/api/facturas/${f.id}/anexo`, `Descargar el anexo de la factura ${f.numero || mesLargo(f.periodo)}`, 'Anexo Excel')) : null));
  else filas = D.documentos.map((d) => fila(d.titulo, `${{ contrato: 'Contrato firmado', anexo: 'Anexo', adenda: 'Adenda', otro: 'Documento' }[d.tipo] || 'Documento'}${d.fecha ? ` · ${fecha(d.fecha)}` : ''}`, null, null, pdf(`/portal/api/documentos/${d.id}/archivo`, `Descargar ${d.titulo}`)));
  const VACIO = { conf: 'Todavía no tenés conformidades. Aparecen cuando cerramos un soporte, una instalación o un retiro.', rem: 'Todavía no tenés remitos de entrega.', fact: 'Todavía no hay facturas para mostrar.', con: 'Todavía no hay documentos del contrato cargados.' };
  return h('section', { class: 'view', 'aria-labelledby': 'h-doc' }, h('h1', { class: 'h1', id: 'h-doc' }, 'Tus documentos'),
    h('p', { class: 'sub' }, 'Conformidades de cada visita, remitos de lo que te entregamos, tus facturas y tu contrato firmado.'), h('div', { style: 'margin-top:20px' }, botonExcel()),
    h('div', { style: 'margin-top:32px' }, h('div', { class: 'seg-tabs', role: 'group', 'aria-label': 'Tipo de documento' }, tabs.map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(E.doc === k), onclick: () => { E.doc = k; mostrar(); } }, t)))),
    h('div', { class: 'tile', style: 'margin-top:16px;padding:12px 28px' }, filas.length ? filas : vacio(VACIO[E.doc])));
}

function vistaContrato() {
  const lista = D.contratos; if (!lista.length) return h('section', { class: 'view' }, h('h1', { class: 'h1' }, 'Tu contrato'), h('p', { class: 'sub' }, 'No encontramos contratos vigentes. Escribile a tu comercial y lo revisamos.'));
  const k = lista.find((x) => String(x.id) === String(E.ct)) ?? lista[0];
  const docs = D.documentos.filter((d) => d.contrato_id === k.id);
  const dato = (t, v) => h('p', null, h('span', { class: 't2' }, t), h('br'), h('span', { class: 'v' }, v));
  return h('section', { class: 'view', 'aria-labelledby': 'h-con' }, h('h1', { class: 'h1', id: 'h-con' }, lista.length > 1 ? 'Tus contratos' : 'Tu contrato'), h('p', { class: 'sub' }, 'Alquiler de equipos con volumen incluido.'),
    lista.length > 1 && h('div', { style: 'margin-top:28px' }, h('div', { class: 'seg-tabs', role: 'group', 'aria-label': 'Elegí un contrato' }, lista.map((x) => h('button', { type: 'button', 'aria-pressed': String(x.id === k.id), onclick: () => { E.ct = x.id; mostrar(); } }, x.nombre)))),
    h('div', { class: 'bento', style: 'margin-top:20px' },
      h('div', { class: 'tile dark s7' }, h('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center' }, h('p', { class: 'lbl' }, k.nombre), h('span', { class: 'chip dk' }, h('span', { class: 'dot', style: 'color:#5BE3A0' }), 'Vigente')),
        k.meses_total != null ? [h('p', { class: 'big', style: 'margin-top:18px;font-size:48px' }, `${k.meses_restantes} ${k.meses_restantes === 1 ? 'mes' : 'meses'}`),
          h('p', { class: 'mut', style: 'font-size:17px;margin:8px 0 24px' }, `restantes de ${k.meses_total}. Vence el ${fechaLarga(k.fin)}.`), h('div', { class: 'meter' }, h('b', { style: `width:${k.avance_pct}%` })),
          h('div', { class: 'mut', style: 'display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-top:8px' }, h('span', null, `Inicio · ${fecha(k.inicio)}`), h('span', null, `Fin · ${fecha(k.fin)}`))]
          : h('p', { class: 'mut', style: 'font-size:17px;margin-top:18px' }, `Desde el ${fecha(k.inicio)}, sin fecha de fin.`)),
      h('div', { class: 'tile s5' }, h('p', { class: 'lbl' }, 'Abono mensual acordado'),
        k.abono != null ? [h('p', { class: 'big', style: 'margin-top:14px;font-size:48px' }, plata(k.moneda, k.abono), h('span', { style: 'font-size:22px;letter-spacing:0;font-weight:700;color:var(--mut)' }, ' + IVA')),
          h('p', { class: 't2', style: 'margin-top:10px;font-size:16px' }, 'Incluye el alquiler de los equipos y las páginas de cada mes.')]
          : h('p', { class: 'big', style: 'margin-top:14px;font-size:40px' }, k.abono_sin_cargo ? 'Sin cargo' : '—'),
        h('p', { class: 't2', style: 'margin-top:14px;font-size:15px' }, 'Las páginas que superen el volumen se facturan según la tarifa de tu contrato.')),
      h('div', { class: 's12 tile' }, h('div', { style: 'display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center' },
        h('div', { class: 'facts', style: 'flex:1;min-width:260px' }, dato('Equipos en el contrato', String(k.equipos)), dato('Páginas B/N por mes', n(k.franquicia_negro)), dato('Páginas color por mes', n(k.franquicia_color)), dato('Tu comercial', D.comercial?.nombre || 'Equipo comercial')),
        docs.length ? docs.map((d) => h('a', { class: 'btn', href: `/portal/api/documentos/${d.id}/archivo`, download: '' }, icono(I.down), d.tipo === 'contrato' ? 'Descargar contrato firmado' : `Descargar ${d.titulo}`)) : h('span', { class: 't2' }, 'El contrato firmado todavía no está cargado.')))));
}

// ── armado ─────────────────────────────────────────────────
const NAV = [['inicio', 'Inicio', I.home], ['equipos', 'Equipos', I.print], ['docs', 'Documentos', I.doc], ['contrato', 'Contrato', I.shield]];
const VISTAS = { inicio: vistaInicio, equipos: vistaEquipos, docs: vistaDocumentos, contrato: vistaContrato };
function ir(v) { E.vista = v; mostrar(); window.scrollTo({ top: 0 }); }

function mostrar() {
  vaciar(raiz);
  const salir = async () => { await api('/portal/api/logout', { metodo: 'POST' }).catch(() => {}); D = null; pantallaLogin(); };
  raiz.append(...[
    D.usuario.vista && h('div', { class: 'vista', role: 'status' }, icono(I.eye, 'i'), `Estás viendo el portal como ${D.usuario.nombre} (${D.cliente.nombre}). Solo lectura.`, h('button', { class: 'btn', type: 'button', onclick: async () => { await api('/portal/api/logout', { metodo: 'POST' }).catch(() => {}); window.close(); location.replace('/'); } }, 'Cerrar vista')),
    h('header', { class: 'top' }, h('div', { class: 'top-in' }, logo('logo'),
      h('nav', { class: 'nav', 'aria-label': 'Secciones' }, NAV.map(([k, t, d]) => h('button', { type: 'button', 'aria-current': E.vista === k ? 'page' : 'false', onclick: () => ir(k) }, icono(d), t))),
      h('div', { class: 'who' }, h('button', { class: 'btn cy', type: 'button', onclick: pedirSoporte }, icono(I.chat), 'Pedir soporte'),
        h('div', { class: 'menu-u' }, h('button', { class: 'av', type: 'button', 'aria-label': `Cuenta de ${D.usuario.nombre}`, 'aria-expanded': String(E.menu), style: 'border:0', onclick: () => { E.menu = !E.menu; mostrar(); } }, iniciales(D.usuario.nombre)),
          E.menu && h('div', { class: 'lista' }, h('p', null, D.usuario.email), !D.usuario.vista && h('button', { type: 'button', onclick: () => { E.menu = false; pantallaClave(); } }, 'Cambiar contraseña'), h('button', { type: 'button', onclick: salir }, 'Salir')))))),
    h('main', { class: 'wrap' }, VISTAS[E.vista]())].filter(Boolean));
}

async function cargar(redibujar = true) {
  try { D = await api('/portal/api/inicio'); } catch (e) { D = null; if (e.estado === 401) { pantallaLogin(); return; } throw e; }
  if (redibujar) { E.eq = 'todos'; E.ct = D.contratos[0]?.id ?? null; }
  mostrar();
}

async function arrancar() {
  const m = location.hash.match(/^#\/entrar\/([\w-]{20,80})$/);
  if (m) {
    history.replaceState(null, '', '/portal/'); // saca el token de la barra de direcciones
    try { const r = await api('/portal/api/entrar', { metodo: 'POST', cuerpo: { token: m[1] } }); if (r.necesita_clave) { pantallaClave(); return; } await cargar(); return; }
    catch { pantallaLogin('Ese enlace ya se usó o venció. Pedí uno nuevo con tu mail.'); return; }
  }
  await cargar();
}
arrancar();
