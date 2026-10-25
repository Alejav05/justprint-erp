// JustPrint ERP — pantalla. Sin librerías: todo se arma con nodos del DOM (nunca con innerHTML sobre datos).
const raiz = document.getElementById('app');
const estado = { me: null };

/* ---------- utilidades ---------- */
const TAGS_SVG = new Set(['svg', 'path', 'rect', 'g', 'text', 'line', 'title', 'circle']);
function agregar(el, hijos) {
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}
function h(tag, attrs, ...hijos) {
  const el = TAGS_SVG.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  agregar(el, hijos);
  return el;
}
const vaciar = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
const usd = (n) => `USD ${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
const usd2 = (n) => `USD ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monto = (n, moneda) => (moneda === 'ARS' ? '$ ' : 'USD ') + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (iso) => { const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'; };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesCorto = (p) => MESES[Number(p.slice(5, 7)) - 1];
const puede = (clave) => estado.me?.permisos.includes(clave);
const chip = (texto, tipo = 'mudo') => h('span', { class: `chip chip-${tipo}` }, texto);
const ESTADO_CLIENTE = { activo: ['Activo', 'ok'], prospecto: ['Prospecto', 'info'], inactivo: ['Inactivo', 'mudo'] };
const chipEstado = (e) => chip(...(ESTADO_CLIENTE[e] ?? [e, 'mudo']));

async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  const r = await fetch(ruta, {
    method: metodo, credentials: 'same-origin',
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.status === 401 && ruta !== '/api/auth/login') { estado.me = null; mostrarIngreso(); throw new Error('sesion'); }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(datos.error ?? 'error'); e.estado = r.status; e.datos = datos; throw e; }
  return datos;
}

const ICONOS = {
  inicio: 'M3 11l9-8 9 8M5 10v10h14V10',
  clientes: 'M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-2a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  servicio: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  tickets: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z',
  equipos: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z',
  insumos: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  facturacion: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  usuarios: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  auditoria: 'M9 12l2 2 4-4M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
};
const icono = (n) => h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: ICONOS[n] }));

const MENU = [
  { ruta: 'inicio', texto: 'Inicio' },
  { grupo: 'Comercial' },
  { ruta: 'clientes', texto: 'Clientes', permiso: 'clientes.ver' },
  { grupo: 'Servicio' },
  { ruta: 'tickets', texto: 'Tickets', permiso: 'tickets.ver' },
  { ruta: 'servicio', texto: 'Tablero de servicio', permiso: 'tableros.servicio' },
  { ruta: 'equipos', texto: 'Equipos', permiso: 'equipos.ver' },
  { ruta: 'insumos', texto: 'Insumos', permiso: 'insumos.ver' },
  { grupo: 'Finanzas' },
  { ruta: 'facturacion', texto: 'Facturación y cobranzas', permiso: 'importes.ver' },
  { grupo: 'Sistema' },
  { ruta: 'usuarios', texto: 'Usuarios', permiso: 'usuarios.administrar' },
  { ruta: 'auditoria', texto: 'Auditoría', permiso: 'auditoria.ver' },
];
const PRONTO = {};

/* ---------- ingreso ---------- */
function logo(extra) {
  const img = h('img', { src: '/img/logo-blanco.png', alt: 'JustPrint' });
  const texto = h('span', null, 'Just', h('b', null, 'Print'));
  const caja = h('div', { class: `marca ${extra ?? ''}` }, texto);
  img.addEventListener('load', () => { vaciar(caja); caja.append(img); });
  return caja;
}

function mostrarIngreso() {
  const error = h('div', { class: 'error oculto', role: 'alert' });
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true });
  const clave = h('input', { id: 'clave', type: 'password', autocomplete: 'current-password', required: true });
  const boton = h('button', { class: 'btn btn-principal', type: 'submit', style: 'width:100%' }, 'Ingresar');
  const form = h('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      error.classList.add('oculto'); boton.disabled = true;
      try {
        await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: email.value, password: clave.value } });
        estado.me = await api('/api/me');
        iniciar();
      } catch (e) {
        error.textContent = e.estado === 429 || e.datos?.error === 'cuenta_bloqueada'
          ? 'Demasiados intentos. Esperá unos minutos y probá de nuevo.' : 'Email o contraseña incorrectos.';
        error.classList.remove('oculto'); boton.disabled = false; clave.value = '';
      }
    },
  }, h('h2', null, 'Ingresá a tu cuenta'), error,
  h('div', { class: 'campo' }, h('label', { for: 'email' }, 'Email'), email),
  h('div', { class: 'campo' }, h('label', { for: 'clave' }, 'Contraseña'), clave), boton);
  vaciar(raiz).append(h('div', { class: 'ingreso' },
    h('div', { class: 'ingreso-marca' }, logo(),
      h('div', null, h('div', { class: 'lema' }, 'Todo el negocio de alquiler de impresoras, ', h('span', null, 'en un solo lugar.')),
        h('p', null, 'Clientes, contratos, servicio técnico, facturación y cobranzas, con cada área viendo lo suyo.')),
      h('div', { class: 'apoyo' }, 'Europa Haus S.A.S.')),
    h('div', { class: 'ingreso-form' }, form)));
  email.focus();
}

/* ---------- estructura ---------- */
let contenedor;
function armarEstructura() {
  const lateral = h('aside', { class: 'lateral', id: 'lateral' });
  const velo = h('div', { class: 'velo oculto' });
  const cerrarMenu = () => { lateral.classList.remove('abierto'); velo.classList.add('oculto'); };
  velo.addEventListener('click', cerrarMenu);
  const menu = h('nav', { class: 'menu', 'aria-label': 'Principal' });
  let pendienteGrupo = null;
  for (const it of MENU) {
    if (it.grupo) { pendienteGrupo = it.grupo; continue; }
    if (it.permiso && !puede(it.permiso)) continue;
    if (pendienteGrupo) { menu.append(h('div', { class: 'menu-titulo' }, pendienteGrupo)); pendienteGrupo = null; }
    menu.append(h('a', { href: `#/${it.ruta}`, class: it.pronto ? 'pronto' : '', 'data-ruta': it.ruta, onclick: cerrarMenu }, icono(it.ruta), it.texto));
  }
  lateral.append(logo(), menu, h('div', { class: 'lateral-pie' }, h('b', null, estado.me.nombre),
    h('span', { class: 'apoyo' }, [...new Set(estado.me.areas.map((a) => a.area))].join(' · ') || estado.me.rol),
    h('div', null, h('button', { type: 'button', onclick: async () => { await api('/api/auth/logout', { metodo: 'POST' }).catch(() => {}); estado.me = null; mostrarIngreso(); } }, 'Salir'))));
  contenedor = h('main', { class: 'contenido', id: 'contenido', tabindex: '-1' });
  const barra = h('div', { class: 'barra' }, logo(), h('button', { type: 'button', 'aria-label': 'Abrir menú', onclick: () => { lateral.classList.add('abierto'); velo.classList.remove('oculto'); } }, '☰'));
  vaciar(raiz).append(h('div', { class: 'estructura' }, lateral, h('div', { class: 'principal' }, barra, contenedor)), velo);
}

/* ---------- vistas ---------- */
const cargando = () => h('div', { class: 'vacio' }, 'Cargando…');
const falla = (msg = 'No se pudo cargar esta pantalla.') => h('div', { class: 'vacio' }, h('b', null, 'Algo salió mal'), msg);
const encabezado = (titulo, sub, acciones) => h('div', { class: 'encabezado' }, h('div', null, h('h1', null, titulo), sub && h('p', null, sub)), acciones);

function grafico(serieCompleta) {
  const movil = window.innerWidth < 600;
  const serie = movil ? serieCompleta.slice(-6) : serieCompleta;
  const W = movil ? 380 : 720; const H = movil ? 230 : 250; const m = { i: 44, d: 8, s: 10, b: 28 };
  const max = Math.max(1, ...serie.flatMap((s) => [s.facturado, s.cobrado, s.sin_comprobante]));
  const paso = (() => { const crudo = max / 4; const pot = 10 ** Math.floor(Math.log10(crudo)); return [1, 2, 2.5, 5, 10].map((f) => f * pot).find((v) => v >= crudo); })();
  const tope = paso * 4;
  const ancho = (W - m.i - m.d) / serie.length;
  const y = (v) => m.s + (H - m.s - m.b) * (1 - v / tope);
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Facturado y cobrado por mes' });
  for (let k = 0; k <= 4; k += 1) {
    const v = paso * k;
    svg.append(h('line', { x1: m.i, x2: W - m.d, y1: y(v), y2: y(v), stroke: '#E6EEF1', 'stroke-width': 1 }),
      h('text', { x: m.i - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': movil ? 12 : 11, fill: '#7C8B96' }, v >= 1000 ? `${v / 1000}k` : v));
  }
  serie.forEach((s, i) => {
    const x0 = m.i + i * ancho; const bw = Math.min(14, ancho / 3.2); const cx = x0 + ancho / 2;
    const barras = [[s.facturado, '#0D1B2A', 'Facturado'], [s.cobrado, '#00BCD4', 'Cobrado']];
    if (s.sin_comprobante) barras.push([s.sin_comprobante, '#B7C6CD', 'Sin comprobante']);
    const total = barras.length * bw + (barras.length - 1) * 2;
    barras.forEach(([v, color, nombre], j) => {
      const alto = Math.max(0, (H - m.s - m.b) * (v / tope));
      svg.append(h('rect', { x: cx - total / 2 + j * (bw + 2), y: y(v), width: bw, height: alto, rx: 3, fill: color }, h('title', null, `${mesCorto(s.periodo)} ${s.periodo.slice(0, 4)} · ${nombre}: ${usd(v)}`)));
    });
    svg.append(h('text', { x: cx, y: H - 9, 'text-anchor': 'middle', 'font-size': movil ? 13 : 11.5, fill: '#5B6B76' }, mesCorto(s.periodo)));
  });
  return svg;
}


/* ---------- mi día (técnico) ---------- */
const hora = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' }) : null);
function tarjetaVisita(t) {
  const mapa = t.domicilio ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.domicilio)}` : null;
  return h('div', { class: 'tarjeta visita' },
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px' }, t.visita_en && h('b', { class: 'hora' }, hora(t.visita_en)), h('span', { class: 'apoyo' }, t.numero),
      t.prioridad !== 'normal' && chip(t.prioridad, PRIORIDAD[t.prioridad]), chipSla(t.sla)),
    h('div', { class: 'nombre-cliente' }, t.cliente), h('div', { class: 'apoyo' }, [t.sede, t.equipo].filter(Boolean).join(' · ')),
    t.domicilio && h('div', null, h('a', { href: mapa, target: '_blank', rel: 'noopener' }, t.domicilio)),
    h('p', { style: 'margin:8px 0' }, t.asunto),
    h('div', { class: 'acciones' }, h('a', { class: 'btn btn-principal', href: `#/tickets/${t.id}/cierre` }, 'Cerrar ticket'), h('a', { class: 'btn', href: `#/tickets/${t.id}` }, 'Ver detalle')));
}

async function vistaMiDia(destino) {
  const r = await api('/api/mi-dia');
  const nombre = estado.me.nombre.split(' ')[0];
  const dia = new Date(`${r.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const kpi = (rotulo, valor, clase) => h('div', { class: `tarjeta kpi ${clase ?? ''}` }, h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, String(valor)));
  const seccion = (titulo, lista, vacio) => (!lista.length && !vacio ? null : [h('h2', { style: 'margin:20px 0 8px' }, titulo), lista.length ? lista.map(tarjetaVisita) : vacio && h('div', { class: 'tarjeta vacio' }, vacio)]);
  agregar(destino, [encabezado(`Hola, ${nombre}`, dia),
    h('div', { class: 'rejilla kpis' }, kpi('Visitas de hoy', r.visitas_hoy.length), kpi('SLA vencido', r.vencidos, r.vencidos ? 'alerta' : ''), kpi('Cerrados hoy', r.cerrados_hoy)),
    seccion('Visitas de hoy', r.visitas_hoy, 'No tenés visitas agendadas para hoy.'),
    r.atrasadas.length ? seccion('Visitas atrasadas', r.atrasadas) : null,
    seccion('Pendientes sin fecha de visita', r.pendientes, r.visitas_hoy.length || r.atrasadas.length ? null : 'No tenés tickets pendientes. Buen trabajo.'),
    h('div', { style: 'margin-top:20px' }, bloqueSla(r.kpi, 'Tu SLA de resolución'))]);
}


/* ---------- tableros por área ---------- */
const kpiTarjeta = (rotulo, valor, nota, clase, href) => h(href ? 'a' : 'div', { class: `tarjeta kpi ${clase ?? ''}`, href, style: href ? 'text-decoration:none;color:inherit' : null }, h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, valor), nota && h('div', { class: 'nota' }, nota));
const listaTickets = (items, vacio) => (items.length ? h('ul', { class: 'lista' }, items.map((k) => h('li', null,
  h('div', null, h('a', { href: `#/tickets/${k.id}` }, h('b', null, `${k.numero} · ${k.cliente}`)), h('div', { class: 'apoyo' }, k.asunto, k.tecnico ? ` · ${k.tecnico}` : '')),
  h('span', null, k.prioridad !== 'normal' && chip(k.prioridad, PRIORIDAD[k.prioridad]), ' ', chipSla(k.sla))))) : h('div', { class: 'vacio' }, vacio));

async function vistaAtencion(destino) {
  const t = await api('/api/tableros/atencion');
  agregar(destino, [encabezado(`Hola, ${estado.me.nombre.split(' ')[0]}`, 'Atención al cliente · lo que hay que mover hoy',
    puede('tickets.crear') && h('div', { class: 'acciones' }, h('a', { class: 'btn btn-principal', href: '#/tickets/nuevo' }, '+ Nuevo ticket'))),
  h('div', { class: 'rejilla kpis' }, kpiTarjeta('Tickets abiertos', String(t.abiertos), `${t.nuevos_hoy} nuevos hoy`, '', '#/tickets'),
    kpiTarjeta('Sin asignar', String(t.sin_asignar_total), null, t.sin_asignar_total ? 'alerta' : ''), kpiTarjeta('SLA vencido', String(t.vencidos), null, t.vencidos ? 'alerta' : ''),
    kpiTarjeta('Esperando al cliente', String(t.esperando_cliente_total))),
  h('div', { class: 'rejilla dos-iguales' },
    h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Para asignar'), listaTickets(t.sin_asignar, 'No hay tickets sin asignar.')),
    h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Por vencer o vencidos'), listaTickets(t.por_vencer, 'Nada en riesgo de SLA.'))),
  h('div', { class: 'rejilla dos-iguales', style: 'margin-top:16px' },
    h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Esperando respuesta del cliente'), listaTickets(t.esperando_cliente, 'Ninguno por ahora.')),
    h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Insumos'),
      t.insumos.agotados || t.insumos.bajos ? h('div', null, t.insumos.agotados ? h('div', { class: 'alerta-item malo' }, `${t.insumos.agotados} sin stock`, h('a', { href: '#/insumos' }, 'Ver')) : null,
        t.insumos.bajos ? h('div', { class: 'alerta-item aviso' }, `${t.insumos.bajos} bajo el mínimo`, h('a', { href: '#/insumos' }, 'Ver')) : null) : h('div', { class: 'vacio' }, 'Stock en orden.'))),
  h('div', { style: 'margin-top:16px' }, bloqueSla(t.sla))]);
}

async function vistaComercial(destino) {
  const t = await api('/api/tableros/comercial');
  const lista = (items, fila, vacio) => (items.length ? h('ul', { class: 'lista' }, items.map(fila)) : h('div', { class: 'vacio' }, vacio));
  const enlace = (c) => h('a', { href: `#/clientes/${c.cliente_id}` }, h('b', null, c.cliente));
  agregar(destino, [encabezado(`Hola, ${estado.me.nombre.split(' ')[0]}`, `Tu cartera · valores en USD netos, sin IVA`, puede('clientes.editar') && h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/clientes' }, 'Ver clientes'))),
    h('div', { class: 'rejilla kpis' }, kpiTarjeta('Clientes en cartera', String(t.clientes.total), `${t.clientes.activo} activos · ${t.clientes.prospecto} prospectos`), kpiTarjeta('Abono mensual', usd(t.abono_mensual), `${t.contratos_vigentes} contratos vigentes`),
      kpiTarjeta('Por cobrar', usd(t.por_cobrar.usd), null, t.por_cobrar.usd > 0 ? 'alerta' : ''), t.sin_responsable != null ? kpiTarjeta('Sin responsable', String(t.sin_responsable), null, t.sin_responsable ? 'alerta' : '') : kpiTarjeta('Contratos por vencer', String(t.por_vencer.length))),
    h('div', { class: 'rejilla dos-iguales' },
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Contratos que vencen en 3 meses'), lista(t.por_vencer, (c) => h('li', null, h('div', null, enlace(c), h('div', { class: 'apoyo' }, c.contrato)), chip(`Vence ${fecha(c.vence)}`, c.vence < new Date().toISOString().slice(0, 10) ? 'malo' : 'aviso')), 'No hay vencimientos cerca.')),
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Clientes con deuda'), lista(t.por_cobrar.clientes, (c) => h('li', null, h('div', null, enlace(c), h('div', { class: 'apoyo' }, `${c.max_dias} día${c.max_dias === 1 ? '' : 's'} la más vieja`)), h('b', null, usd(c.usd))), 'Nadie debe nada.'))),
    h('div', { class: 'rejilla dos-iguales', style: 'margin-top:16px' },
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Con tickets abiertos (antes de llamar)'), lista(t.con_tickets, (c) => h('li', null, enlace(c), chip(`${c.tickets} ticket${c.tickets > 1 ? 's' : ''}`, 'aviso')), 'Ningún cliente tiene tickets abiertos.')),
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Prospectos recientes'), lista(t.prospectos, (c) => h('li', null, enlace(c), h('span', { class: 'apoyo' }, fecha(c.alta))), 'No hay prospectos.'))),
    t.equipo && h('div', { class: 'tarjeta', style: 'margin-top:16px' }, h('p', { class: 'etiqueta' }, 'Equipo comercial'),
      h('table', null, h('thead', null, h('tr', null, h('th', null, 'Comercial'), h('th', { class: 'num' }, 'Clientes'), h('th', { class: 'num' }, 'Abono USD'))),
        h('tbody', null, t.equipo.map((e) => h('tr', null, h('td', null, e.nombre), h('td', { class: 'num' }, e.clientes), h('td', { class: 'num' }, usd(e.abono_usd)))))))]);
}

async function vistaFinanzas(destino) {
  const periodo = mesAnterior();
  const [liq, cob, borr] = await Promise.all([api(`/api/facturacion/liquidacion?periodo=${periodo}`), api('/api/cobranzas'), api('/api/facturas?estado=borrador')]);
  const listos = liq.filas.filter((f) => f.estado === 'completo' && !f.factura_id); const incompletos = liq.filas.filter((f) => f.estado === 'incompleto' && !f.factura_id);
  const usdListos = listos.filter((f) => !f.interno).reduce((s, f) => s + (f.neto_usd || 0), 0);
  agregar(destino, [encabezado(`Hola, ${estado.me.nombre.split(' ')[0]}`, `Facturación y cobranzas · liquidación de ${nombreMes(periodo)} · USD netos`, h('div', { class: 'acciones' }, h('a', { class: 'btn btn-principal', href: '#/facturacion/liquidacion' }, 'Ir a liquidar'))),
    h('div', { class: 'rejilla kpis' }, kpiTarjeta('Listos para facturar', String(listos.length), usd(usdListos), '', '#/facturacion/liquidacion'), kpiTarjeta('Faltan lecturas', String(incompletos.length), null, incompletos.length ? 'alerta' : '', '#/facturacion/liquidacion'),
      kpiTarjeta('Borradores por emitir', String(borr.total), null, borr.total ? 'alerta' : '', '#/facturacion/facturas'), kpiTarjeta('Por cobrar', usd(cob.total_usd), `${cob.facturas} factura${cob.facturas === 1 ? '' : 's'}`, cob.tramos['+90'] > 0 ? 'alerta' : '', '#/facturacion/cobranzas')),
    h('div', { class: 'rejilla dos-iguales' },
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Falta cargar contadores'), incompletos.length ? h('ul', { class: 'lista' }, incompletos.map((f) => h('li', null, h('div', null, h('b', null, f.cliente), h('div', { class: 'apoyo' }, f.contrato)), chip('Sin lectura', 'aviso')))) : h('div', { class: 'vacio' }, 'Todos los contratos tienen lecturas.')),
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Deuda más antigua'), cob.clientes.length ? h('ul', { class: 'lista' }, cob.clientes.slice().sort((a, b) => b.max_dias - a.max_dias).slice(0, 6).map((c) => h('li', null, h('div', null, h('b', null, c.cliente), h('div', { class: 'apoyo' }, `${c.max_dias} día${c.max_dias === 1 ? '' : 's'}`)), h('b', null, usd(c.saldo_usd))))) : h('div', { class: 'vacio' }, 'No hay deuda pendiente.')))]);
}

async function vistaInicio(destino) {
  if (!puede('tableros.direccion')) {
    const areas = estado.me.areas.map((a) => a.area);
    if (areas.includes('Atención') && puede('tickets.crear')) { await vistaAtencion(destino); return; }
    if (areas.includes('Técnica') && puede('tickets.atender')) { await vistaMiDia(destino); return; }
    if (areas.includes('Comercial') && puede('crm.gestionar')) { await vistaComercial(destino); return; }
    if (puede('facturas.emitir')) { await vistaFinanzas(destino); return; }
    if (puede('tickets.atender')) { await vistaMiDia(destino); return; }
  }
  if (!puede('tableros.direccion')) {
    destino.append(encabezado(`Hola, ${estado.me.nombre.split(' ')[0]}`, 'Tu tablero por área llega en las próximas etapas.'),
      h('div', { class: 'tarjeta' }, h('h2', null, 'Mientras tanto'), h('p', null, 'Ya podés consultar los clientes que te corresponden desde el menú de la izquierda.'),
        puede('clientes.ver') && h('a', { class: 'btn btn-principal', href: '#/clientes' }, 'Ver clientes')));
    return;
  }
  const t = await api('/api/tableros/direccion');
  const mes = [...t.serie].reverse().find((s) => s.facturado > 0) ?? t.serie.at(-1);
  const kpi = (rotulo, valor, nota, clase) => h('div', { class: `tarjeta kpi ${clase ?? ''}` }, h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, valor), h('div', { class: 'nota' }, nota));
  destino.append(
    encabezado('Dirección', `Foto completa del negocio · valores en USD netos, sin IVA${t.cotizacion ? ` · dólar BNA ${t.cotizacion.valor.toLocaleString('es-AR', { minimumFractionDigits: 2 })} (${fecha(t.cotizacion.fecha)})` : ''}`),
    h('div', { class: 'rejilla kpis' },
      kpi('Abono mensual vigente', usd(t.abono_mensual), t.abono_no_facturable ? `+ ${usd(t.abono_no_facturable)} de cuentas no facturables` : `${t.contratos_vigentes} contratos vigentes`),
      kpi(`Facturado en ${mesCorto(mes.periodo)}`, usd(mes.facturado), `Cobrado de eso: ${usd(mes.cobrado)}`),
      kpi('Por cobrar', usd(t.por_cobrar.usd), `${t.por_cobrar.facturas} factura${t.por_cobrar.facturas === 1 ? '' : 's'} emitida${t.por_cobrar.facturas === 1 ? '' : 's'}`, t.por_cobrar.usd > 0 ? 'alerta' : ''),
      kpi('Clientes activos', String(t.clientes.activo), `${t.clientes.prospecto} prospectos · ${t.equipos.instalado} equipos instalados`)),
    h('div', { class: 'rejilla dos' },
      h('div', { class: 'tarjeta grafico' }, h('p', { class: 'etiqueta' }, `Facturado y cobrado, últimos ${window.innerWidth < 600 ? 6 : 12} meses`), grafico(t.serie),
        h('div', { class: 'leyenda' }, h('span', null, h('i', { style: 'background:#0D1B2A' }), 'Facturado'), h('span', null, h('i', { style: 'background:#00BCD4' }), 'Cobrado'),
          t.serie.some((s) => s.sin_comprobante) && h('span', null, h('i', { style: 'background:#B7C6CD' }), 'Cuentas sin comprobante (aparte)'))),
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Para atender'),
        t.alertas.length ? t.alertas.map((a) => h('div', { class: `alerta-item ${a.nivel}` }, a.texto, h('a', { href: a.destino }, 'Ver')))
          : h('div', { class: 'vacio' }, h('b', null, 'Todo en orden'), 'No hay nada pendiente.'))),
    bloqueSla(t.sla),
    h('div', { class: 'rejilla dos-iguales', style: 'margin-top:16px' },
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Clientes con más ingresos · 12 meses (USD neto)'),
        t.top_clientes.length ? h('ul', { class: 'lista' }, t.top_clientes.map((c) => h('li', { style: 'display:block' },
          h('div', { style: 'display:flex;justify-content:space-between' }, h('a', { href: `#/clientes/${c.cliente_id}` }, c.cliente), h('b', null, usd(c.usd))),
          h('div', { class: 'barrita' }, h('span', { style: `width:${Math.round((c.usd / t.top_clientes[0].usd) * 100)}%` }))))) : h('div', { class: 'vacio' }, 'Todavía no hay facturación.')),
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, `Tickets abiertos (${t.tickets.abiertos})`),
        t.tickets.lista.length ? h('ul', { class: 'lista' }, t.tickets.lista.map((k) => h('li', null,
          h('div', null, h('b', null, `${k.numero} · ${k.cliente}`), h('div', { class: 'apoyo' }, k.asunto)), chip(k.prioridad, k.prioridad === 'urgente' ? 'malo' : k.prioridad === 'alta' ? 'aviso' : 'mudo'))))
          : h('div', { class: 'vacio' }, h('b', null, 'Sin tickets abiertos'), `${t.tickets.cerrados_30_dias} cerrados en los últimos 30 días.`))));
}

async function vistaClientes(destino) {
  const f = { q: '', estado: '', pagina: 1 };
  const cuerpo = h('div');
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por razón social o nombre comercial', 'aria-label': 'Buscar cliente' });
  const filtro = h('select', { 'aria-label': 'Estado' }, h('option', { value: '' }, 'Todos los estados'), ...Object.entries(ESTADO_CLIENTE).map(([v, [t]]) => h('option', { value: v }, t)));
  let tiempo;
  buscar.addEventListener('input', () => { clearTimeout(tiempo); tiempo = setTimeout(() => { f.q = buscar.value; f.pagina = 1; cargar(); }, 250); });
  filtro.addEventListener('change', () => { f.estado = filtro.value; f.pagina = 1; cargar(); });

  async function cargar() {
    vaciar(cuerpo).append(cargando());
    try {
      const p = new URLSearchParams({ pagina: f.pagina, limite: 25 });
      if (f.q) p.set('q', f.q); if (f.estado) p.set('estado', f.estado);
      const r = await api(`/api/clientes?${p}`);
      const conAbono = puede('importes.ver');
      vaciar(cuerpo);
      if (!r.clientes.length) { cuerpo.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No hay clientes para mostrar'), 'Probá con otra búsqueda o cambiá el filtro.')); return; }
      cuerpo.append(h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, h('table', { class: 'tarjetas' },
        h('thead', null, h('tr', null, h('th', null, 'Cliente'), h('th', null, 'Estado'), h('th', null, 'Responsable'), conAbono && h('th', { class: 'num' }, 'Abono mensual'))),
        h('tbody', null, r.clientes.map((c) => h('tr', { class: 'fila', tabindex: '0', onclick: () => { location.hash = `#/clientes/${c.id}`; }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/clientes/${c.id}`; } },
          h('td', { 'data-rotulo': 'Cliente' }, h('div', { class: 'nombre-cliente' }, c.nombre_comercial || c.razon_social), c.nombre_comercial && h('div', { class: 'apoyo' }, c.razon_social)),
          h('td', { 'data-rotulo': 'Estado' }, chipEstado(c.estado)),
          h('td', { 'data-rotulo': 'Responsable' }, c.responsable ?? chip('Sin asignar', 'aviso')),
          conAbono && h('td', { class: 'num', 'data-rotulo': 'Abono mensual' }, c.abono_mensual_usd ? usd(c.abono_mensual_usd) : '—',
            c.abono_no_facturable_usd > 0 && h('div', { class: 'apoyo' }, `${usd(c.abono_no_facturable_usd)} no facturable`))))))));
      const paginas = Math.max(1, Math.ceil(r.total / r.limite));
      if (paginas > 1) {
        cuerpo.append(h('div', { class: 'paginacion' }, h('span', { class: 'apoyo' }, `${r.total} clientes · página ${r.pagina} de ${paginas}`),
          h('div', { style: 'display:flex;gap:8px' },
            h('button', { class: 'btn', disabled: r.pagina <= 1, onclick: () => { f.pagina -= 1; cargar(); } }, 'Anterior'),
            h('button', { class: 'btn', disabled: r.pagina >= paginas, onclick: () => { f.pagina += 1; cargar(); } }, 'Siguiente'))));
      }
    } catch (e) { if (e.message !== 'sesion') vaciar(cuerpo).append(falla()); }
  }
  destino.append(encabezado('Clientes', 'Las cuentas que podés ver según tu área y alcance', puede('clientes.editar') && h('span', { class: 'apoyo' }, '')),
    h('div', { class: 'herramientas' }, buscar, filtro), cuerpo);
  await cargar();
}

const MOTIVO = { alta: 'Alta', ajuste_ipc: 'Ajuste por IPC', renegociacion: 'Renegociación', sin_facturar: 'Sin facturar', otro: 'Otro' };
function tarjetaContrato(c) {
  const vigente = (x) => !x.vigente_hasta;
  return h('div', { class: 'tarjeta' },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px' },
      h('div', null, h('h2', { style: 'margin:0' }, c.nombre), h('div', { class: 'apoyo' }, `Desde ${fecha(c.fecha_inicio)} · ${c.duracion_meses ? `${c.duracion_meses} meses` : 'sin fin de vigencia'} · en ${c.moneda === 'ARS' ? 'pesos' : 'dólares'}`)),
      chip(c.estado === 'vigente' ? 'Vigente' : c.estado, c.estado === 'vigente' ? 'ok' : 'mudo')),
    puede('contratos.editar') && puede('importes.ver') && c.estado === 'vigente' && c.condiciones?.length && panelAjuste(c),
    c.condiciones ? c.condiciones.map((x) => h('div', { class: `linea ${vigente(x) ? 'vigente' : ''}` },
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' },
        h('b', null, monto(x.monto_mensual, c.moneda), ' / mes'), x.motivo !== 'sin_facturar' && chip(MOTIVO[x.motivo] ?? x.motivo, 'info'),
        !x.facturable && chip('No facturable', 'aviso'), x.ajuste_pct != null && chip(`${Number(x.ajuste_pct)}%`, 'mudo')),
      h('div', { class: 'apoyo' }, `${fecha(x.vigente_desde)} → ${x.vigente_hasta ? fecha(x.vigente_hasta) : 'hoy'}`),
      h('div', { class: 'apoyo' }, `Franquicia ${x.franquicia_negro} negro / ${x.franquicia_color} color · excedente ${Number(x.excedente_negro)} / ${Number(x.excedente_color)} por página`),
      x.monto_usd_referencia != null && h('div', { class: 'apoyo' }, `Referencia: ${usd2(x.monto_usd_referencia)}`),
      x.notas && h('div', { class: 'apoyo' }, x.notas))) : h('p', { class: 'apoyo' }, 'Las condiciones económicas no están disponibles para tu rol.'));
}


/** Ajuste trimestral por IPC: acumulado compuesto de los 3 meses que terminan en el período elegido. */
function panelAjuste(c) {
  const caja = h('div', { class: 'no-imprimir', style: 'margin-bottom:12px' });
  const abrir = h('button', { class: 'btn', type: 'button' }, 'Ajustar por IPC');
  const mes = h('input', { type: 'month', value: mesAnterior(), 'aria-label': 'Último mes del trimestre' });
  const zona = h('div');
  const calcular = async () => {
    vaciar(zona).append(cargando());
    const r = await api(`/api/contratos/${c.id}/ajuste?hasta=${mes.value}`).catch((e) => e);
    if (r instanceof Error) { vaciar(zona).append(h('div', { class: 'error' }, r.datos?.error === 'ya_ajustado' ? `Ya hay una condición desde ${fecha(r.datos.desde)} o posterior.` : 'No se pudo calcular el ajuste.')); return; }
    if (!r.ok) {
      const inputs = r.faltan.map((p) => { const i = h('input', { type: 'number', step: '0.01', 'aria-label': `IPC ${p}`, placeholder: '% del mes' }); return [p, i]; });
      vaciar(zona).append(h('div', { class: 'tarjeta' }, h('p', null, 'Faltan cargar estos índices de IPC (variación mensual en %):'),
        inputs.map(([p, i]) => h('div', { class: 'dos-col', style: 'margin-bottom:8px' }, h('span', null, nombreMes(p)), i)),
        h('button', { class: 'btn btn-principal', type: 'button', onclick: async () => { for (const [p, i] of inputs) { if (i.value === '') return; await api(`/api/ipc/${p}`, { metodo: 'PUT', cuerpo: { variacion: Number(i.value) } }); } calcular(); } }, 'Guardar y calcular')));
      return;
    }
    const fila = (t, a, b) => h('tr', null, h('td', null, t), h('td', { class: 'num' }, a), h('td', { class: 'num' }, b));
    const m4 = (n) => (c.moneda === 'ARS' ? '$ ' : 'USD ') + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    vaciar(zona).append(h('div', { class: 'tarjeta' },
      h('p', null, 'IPC: ', r.ipc.map((x) => `${nombreMes(x.periodo)} ${x.variacion}%`).join(' · '), h('br'), h('b', null, `Acumulado compuesto ${r.pct}%`), `, rige desde ${fecha(r.vigente_desde)}.`),
      h('table', null, h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'num' }, 'Hoy'), h('th', { class: 'num' }, 'Nuevo'))),
        h('tbody', null, fila('Abono mensual', monto(r.actual.monto_mensual, c.moneda), monto(r.nuevo.monto_mensual, c.moneda)),
          fila('Página negro', m4(r.actual.excedente_negro), m4(r.nuevo.excedente_negro)), fila('Página color', m4(r.actual.excedente_color), m4(r.nuevo.excedente_color)))),
      h('p', { class: 'apoyo' }, 'La franquicia no cambia. La condición actual se cierra el día anterior.'),
      h('div', { class: 'acciones' }, h('button', { class: 'btn btn-principal', type: 'button', onclick: async (ev) => { ev.target.disabled = true; try { await api(`/api/contratos/${c.id}/ajuste`, { metodo: 'POST', cuerpo: { hasta: mes.value } }); navegar(); } catch { ev.target.disabled = false; } } }, 'Aplicar ajuste'))));
  };
  abrir.addEventListener('click', () => { abrir.remove(); caja.append(h('div', { class: 'tarjeta herramientas', style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center' }, h('label', null, 'Último mes del trimestre ', mes), h('button', { class: 'btn', type: 'button', onclick: calcular }, 'Calcular')), zona); });
  caja.append(abrir);
  return caja;
}

async function vistaCliente(destino, id) {
  const d = await api(`/api/clientes/${id}`).catch((e) => { if (e.estado === 404) return null; throw e; });
  if (!d) { destino.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos ese cliente'), h('a', { href: '#/clientes' }, 'Volver a clientes'))); return; }
  const c = d.cliente;
  const panel = h('div');
  const pestanas = [['resumen', 'Resumen']];
  if (d.contactos) pestanas.push(['contactos', `Contactos (${d.contactos.length})`]);
  if (d.contratos) pestanas.push(['contratos', `Contratos (${d.contratos.length})`]);
  if (puede('cartera.asignar') || puede('crm.gestionar')) pestanas.push(['cartera', 'Cartera']);
  const barra = h('div', { class: 'pestanas', role: 'tablist' });

  const fila = (k, v) => h('div', null, h('dt', null, k), h('dd', null, v ?? '—'));
  const vistas = {
    resumen: () => h('div', null,
      h('div', { class: 'tarjeta' }, h('h2', null, 'Datos'), h('dl', { class: 'datos', style: 'margin:0' },
        fila('Razón social', c.razon_social), fila('Nombre comercial', c.nombre_comercial), fila('CUIT', c.cuit), fila('Estado', chipEstado(c.estado)),
        fila('Responsable', d.responsable ? d.responsable.nombre : chip('Sin asignar', 'aviso')), fila('Alta', fecha(c.fecha_alta)), fila('Rubro', c.rubro), fila('Origen', c.origen))),
      h('div', { class: 'tarjeta' }, h('h2', null, 'Sedes'), d.sedes.length ? h('ul', { class: 'lista' }, d.sedes.map((s) => h('li', null,
        h('div', null, h('b', null, s.nombre), h('div', { class: 'apoyo' }, [s.domicilio, s.localidad].filter(Boolean).join(', ') || 'Sin domicilio')),
        chip(s.zona === 'caba' ? 'CABA · SLA 24 h' : 'Resto · SLA 48 h', 'info')))) : h('p', { class: 'apoyo' }, 'Sin sedes cargadas.')),
      c.notas && h('div', { class: 'tarjeta' }, h('h2', null, 'Notas'), h('p', { style: 'white-space:pre-line;margin:0' }, c.notas))),
    contactos: () => (d.contactos.length ? h('div', { class: 'rejilla dos-iguales' }, d.contactos.map((k) => h('div', { class: 'tarjeta' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, h('b', { class: 'nombre-cliente' }, k.nombre), k.autorizado_toner ? chip('Autoriza tóner', 'ok') : chip('No autoriza tóner', 'mudo')),
      h('div', { style: 'margin:6px 0' }, k.roles.map((r) => chip(r, 'info')), ' '),
      k.telefonos.map((t) => h('div', null, t.numero)), k.emails.map((m) => h('div', null, h('a', { href: `mailto:${m.direccion}` }, m.direccion)))))) : h('div', { class: 'tarjeta vacio' }, 'Sin contactos.')),
    contratos: () => (d.contratos.length ? h('div', null, d.contratos.map(tarjetaContrato)) : h('div', { class: 'tarjeta vacio' }, h('b', null, 'Sin contratos'), 'Este cliente todavía no tiene contratos.')),
    cartera: () => h('div', { class: 'tarjeta' }, cargando()),
  };
  async function mostrar(clave) {
    [...barra.children].forEach((b) => b.classList.toggle('activa', b.dataset.clave === clave));
    vaciar(panel).append(vistas[clave]());
    if (clave === 'cartera') {
      const r = await api(`/api/cartera/${id}/historial`).catch(() => null);
      vaciar(panel).append(h('div', { class: 'tarjeta' }, h('h2', null, 'Historial de responsables'),
        r?.historial?.length ? r.historial.map((x) => h('div', { class: `linea ${x.hasta ? '' : 'vigente'}` }, h('b', null, x.usuario),
          h('div', { class: 'apoyo' }, `${fecha(x.desde)} → ${x.hasta ? fecha(x.hasta) : 'hoy'}`), x.motivo && h('div', { class: 'apoyo' }, x.motivo)))
          : h('p', { class: 'apoyo' }, 'Esta cuenta todavía no tuvo responsable asignado.')));
    }
  }
  pestanas.forEach(([clave, texto]) => barra.append(h('button', { type: 'button', role: 'tab', 'data-clave': clave, onclick: () => mostrar(clave) }, texto)));
  destino.append(h('a', { href: '#/clientes', class: 'apoyo' }, '← Clientes'),
    encabezado(c.nombre_comercial || c.razon_social, c.nombre_comercial ? c.razon_social : null, chipEstado(c.estado)), barra, panel);
  await mostrar('resumen');
}

async function vistaUsuarios(destino) {
  const r = await api('/api/usuarios');
  destino.append(encabezado('Usuarios', 'Quién accede al sistema y con qué rol'),
    h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, h('table', { class: 'tarjetas' },
      h('thead', null, h('tr', null, ['Nombre', 'Email', 'Rol', 'Áreas', 'Estado'].map((t) => h('th', null, t)))),
      h('tbody', null, r.usuarios.map((u) => h('tr', null,
        h('td', { 'data-rotulo': 'Nombre' }, h('span', { class: 'nombre-cliente' }, u.nombre)), h('td', { 'data-rotulo': 'Email' }, u.email),
        h('td', { 'data-rotulo': 'Rol' }, chip(u.rol, 'info')),
        h('td', { 'data-rotulo': 'Áreas' }, (u.areas ?? []).map((a) => `${a.area}${a.funcion === 'lider' ? ' (líder)' : ''}`).join(', ') || '—'),
        h('td', { 'data-rotulo': 'Estado' }, u.activo ? chip('Activo', 'ok') : chip('Inactivo', 'mudo'))))))));
}

async function vistaAuditoria(destino) {
  const r = await api('/api/auditoria');
  destino.append(encabezado('Auditoría', 'Quién cambió qué y cuándo'),
    h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, h('table', { class: 'tarjetas' },
      h('thead', null, h('tr', null, ['Cuándo', 'Quién', 'Acción', 'Dónde'].map((t) => h('th', null, t)))),
      h('tbody', null, r.eventos.map((e) => h('tr', null, h('td', { 'data-rotulo': 'Cuándo' }, String(e.created_at ?? '').slice(0, 16)),
        h('td', { 'data-rotulo': 'Quién' }, e.usuario ?? '—'), h('td', { 'data-rotulo': 'Acción' }, chip(e.accion, e.accion === 'login_fallido' ? 'aviso' : 'mudo')),
        h('td', { 'data-rotulo': 'Dónde' }, `${e.tabla ?? ''} ${e.registro_id ?? ''}`)))))));
}

function vistaPronto(destino, ruta) {
  const [titulo, desc] = PRONTO[ruta];
  destino.append(encabezado(titulo), h('div', { class: 'tarjeta vacio' }, h('b', null, 'Este módulo llega en una próxima etapa'), desc));
}

/* ---------- servicio: SLA, tickets, cierre del técnico ---------- */
const num1 = (n) => (n == null ? '—' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 }));
const horas = (n) => (n == null ? '—' : `${num1(n)} h`);
const ESTADO_TICKET = {
  abierto: ['Abierto', 'info'], asignado: ['Asignado', 'info'], en_curso: ['En curso', 'ok'], esperando_cliente: ['Esperando al cliente', 'aviso'],
  resuelto: ['Resuelto · falta conformidad', 'aviso'], cerrado: ['Cerrado', 'mudo'],
};
const PRIORIDAD = { urgente: 'malo', alta: 'aviso', normal: 'mudo', baja: 'mudo' };
const chipTicket = (e) => chip(...(ESTADO_TICKET[e] ?? [e, 'mudo']));
const cuando = (s) => { if (!s) return '—'; const d = new Date(`${String(s).replace(' ', 'T')}Z`); return d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
function chipSla(sla) {
  if (!sla) return null;
  if (sla.vencido) return chip(`Vencido hace ${num1(Math.abs(sla.restantes))} h`, 'malo');
  return chip(`Quedan ${num1(sla.restantes)} h`, sla.restantes <= 4 ? 'aviso' : 'ok');
}

/** Variación contra un período de comparación: la flecha dice si subió o bajó, el color si es bueno o malo. */
function variacion(cmp, unidad) {
  if (!cmp) return h('span', { class: 'apoyo' }, 'sin datos');
  if (cmp.delta === 0) return h('span', { class: 'apoyo' }, 'igual');
  const texto = `${cmp.delta < 0 ? '▼' : '▲'} ${num1(Math.abs(cmp.delta))}${unidad}`;
  return h('span', { class: `var ${cmp.mejora ? 'mejor' : 'peor'}` }, texto, h('i', null, cmp.mejora ? ' mejor' : ' peor'));
}

function bloqueSla(k, titulo = 'SLA de resolución') {
  const a = k.actual; const sin = !a.n;
  const metrica = (rotulo, valor, campo, unidad) => h('div', { class: 'metrica' },
    h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, valor),
    h('div', { class: 'compara' }, h('span', null, 'vs mes anterior ', sin ? '—' : variacion(k.vs_anterior[campo], unidad), h('span', { class: 'apoyo' }, ` (${campo === 'pct_sla' ? (k.anterior.pct_sla ?? '—') + '%' : horas(k.anterior[campo])})`))),
    h('div', { class: 'compara' }, h('span', null, 'vs histórico ', sin ? '—' : variacion(k.vs_historico[campo], unidad), h('span', { class: 'apoyo' }, ` (${campo === 'pct_sla' ? (k.historico.pct_sla ?? '—') + '%' : horas(k.historico[campo])})`))));
  return h('div', { class: 'tarjeta' },
    h('p', { class: 'etiqueta' }, `${titulo} · ${a.n} ticket${a.n === 1 ? '' : 's'} resuelto${a.n === 1 ? '' : 's'} este mes`),
    sin ? h('p', { class: 'apoyo' }, 'Todavía no hay tickets resueltos este mes para comparar.') : h('div', { class: 'metricas' },
      metrica('Tiempo medio de resolución', horas(a.horas_medias), 'horas_medias', ' h'),
      metrica('Dentro del SLA', a.pct_sla == null ? '—' : `${a.pct_sla}%`, 'pct_sla', ' pts'),
      metrica('Primera respuesta', horas(a.primera_respuesta_horas), 'primera_respuesta_horas', ' h')),
    h('p', { class: 'apoyo', style: 'margin:12px 0 0' }, `Horas hábiles (sin fines de semana ni feriados, desde que se abre hasta que se resuelve). Histórico: ${k.historico.n} tickets anteriores al mes en curso; mes anterior: ${k.anterior.n}.`,
      (a.muestra_chica || k.anterior.muestra_chica) && !sin ? ' Con pocos tickets los promedios se mueven mucho: tomalos como referencia.' : ''));
}

async function vistaTickets(destino) {
  const f = { vista: puede('tickets.atender') && !puede('tickets.asignar') ? 'mios' : 'activos', q: '', pagina: 1 };
  const cuerpo = h('div');
  const vistas = [['activos', 'Activos'], ['mios', 'Míos'], ['sin', 'Sin asignar'], ['vencidos', 'Vencidos'], ['cerrados', 'Resueltos y cerrados']];
  const barra = h('div', { class: 'pestanas', role: 'tablist' });
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por número, asunto o cliente', 'aria-label': 'Buscar ticket' });
  let tiempo;
  buscar.addEventListener('input', () => { clearTimeout(tiempo); tiempo = setTimeout(() => { f.q = buscar.value; f.pagina = 1; cargar(); }, 250); });
  vistas.forEach(([c, t]) => barra.append(h('button', { type: 'button', 'data-clave': c, onclick: () => { f.vista = c; f.pagina = 1; cargar(); } }, t)));

  async function cargar() {
    [...barra.children].forEach((b) => b.classList.toggle('activa', b.dataset.clave === f.vista));
    vaciar(cuerpo).append(cargando());
    try {
      const p = new URLSearchParams({ pagina: f.pagina, limite: 25 });
      if (f.q) p.set('q', f.q);
      if (f.vista === 'activos') p.set('estado', 'activos');
      if (f.vista === 'mios') { p.set('estado', 'activos'); p.set('asignado', 'yo'); }
      if (f.vista === 'sin') { p.set('estado', 'activos'); p.set('asignado', 'sin'); }
      if (f.vista === 'vencidos') p.set('vencidos', 'true');
      const r = await api(`/api/tickets?${p}`);
      const items = f.vista === 'cerrados' ? r.items.filter((t) => ['resuelto', 'cerrado'].includes(t.estado)) : r.items;
      vaciar(cuerpo);
      if (!items.length) { cuerpo.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No hay tickets en esta vista'), 'Cuando haya, van a aparecer acá.')); return; }
      cuerpo.append(h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, h('table', { class: 'tarjetas' },
        h('thead', null, h('tr', null, ['Ticket', 'Cliente', 'Estado', 'Técnico', 'SLA'].map((t) => h('th', null, t)))),
        h('tbody', null, items.map((t) => h('tr', { class: 'fila', tabindex: '0', onclick: () => { location.hash = `#/tickets/${t.id}`; }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/tickets/${t.id}`; } },
          h('td', { 'data-rotulo': 'Ticket' }, h('div', { class: 'nombre-cliente' }, `${t.numero} `, t.prioridad !== 'normal' && chip(t.prioridad, PRIORIDAD[t.prioridad])), h('div', { class: 'apoyo' }, t.asunto)),
          h('td', { 'data-rotulo': 'Cliente' }, t.nombre_comercial || t.cliente),
          h('td', { 'data-rotulo': 'Estado' }, chipTicket(t.estado)),
          h('td', { 'data-rotulo': 'Técnico' }, t.tecnico ?? chip('Sin asignar', 'aviso'), t.visita_en && h('div', { class: 'apoyo' }, `Visita ${cuando(t.visita_en)}`)),
          h('td', { 'data-rotulo': 'SLA' }, chipSla(t.sla) ?? (t.sla_cumplido == null ? '—' : t.sla_cumplido ? chip('Cumplido', 'ok') : chip('Fuera de SLA', 'malo')))))))));
      const paginas = Math.max(1, Math.ceil(r.total / 25));
      if (paginas > 1) cuerpo.append(h('div', { class: 'paginacion' }, h('span', { class: 'apoyo' }, `${r.total} tickets · página ${r.pagina} de ${paginas}`),
        h('div', { style: 'display:flex;gap:8px' }, h('button', { class: 'btn', disabled: r.pagina <= 1, onclick: () => { f.pagina -= 1; cargar(); } }, 'Anterior'),
          h('button', { class: 'btn', disabled: r.pagina >= paginas, onclick: () => { f.pagina += 1; cargar(); } }, 'Siguiente'))));
    } catch (e) { if (e.message !== 'sesion') vaciar(cuerpo).append(falla()); }
  }
  destino.append(encabezado('Tickets', 'Pedidos de servicio técnico, con el SLA corriendo',
    puede('tickets.crear') && h('a', { class: 'btn btn-principal', href: '#/tickets/nuevo' }, '+ Nuevo ticket')), barra, h('div', { class: 'herramientas' }, buscar), cuerpo);
  await cargar();
}

async function vistaNuevoTicket(destino) {
  const clientes = (await api('/api/clientes?limite=100')).clientes;
  const tecnicos = puede('tickets.asignar') ? await api('/api/tickets-ayuda/tecnicos') : [];
  const campo = (rotulo, el, id) => h('div', { class: 'campo' }, h('label', { for: id }, rotulo), el);
  const cliente = h('select', { id: 'cli', required: true }, h('option', { value: '' }, 'Elegí un cliente…'), clientes.map((c) => h('option', { value: c.id }, c.nombre_comercial || c.razon_social)));
  const sede = h('select', { id: 'sede' }); const equipo = h('select', { id: 'eq' }, h('option', { value: '' }, 'Sin equipo específico'));
  const asunto = h('input', { id: 'as', required: true, maxlength: 200, placeholder: 'Ej.: Atasco de papel en bandeja 2' });
  const desc = h('textarea', { id: 'de', rows: 4, maxlength: 4000 });
  const opciones = (vals, def) => vals.map(([v, t]) => h('option', { value: v, selected: v === def }, t));
  const tipo = h('select', { id: 'ti' }, opciones([['soporte', 'Soporte técnico'], ['insumos', 'Pedido de insumos'], ['instalacion', 'Instalación'], ['retiro', 'Retiro'], ['otro', 'Otro']], 'soporte'));
  const prio = h('select', { id: 'pr' }, opciones([['baja', 'Baja'], ['normal', 'Normal'], ['alta', 'Alta'], ['urgente', 'Urgente']], 'normal'));
  const origen = h('select', { id: 'or' }, opciones([['telefono', 'Teléfono'], ['whatsapp', 'WhatsApp'], ['mail', 'Mail'], ['portal', 'Portal'], ['qr', 'QR del equipo'], ['interno', 'Interno']], 'telefono'));
  const tec = h('select', { id: 'te' }, h('option', { value: '' }, 'Asignar después'), tecnicos.map((t) => h('option', { value: t.id }, t.nombre)));
  const error = h('div', { class: 'error oculto', role: 'alert' });
  const boton = h('button', { class: 'btn btn-principal', type: 'submit' }, 'Crear ticket');
  cliente.addEventListener('change', async () => {
    vaciar(sede); vaciar(equipo).append(h('option', { value: '' }, 'Sin equipo específico'));
    if (!cliente.value) return;
    const a = await api(`/api/tickets-ayuda/cliente/${cliente.value}`);
    a.sedes.forEach((s) => sede.append(h('option', { value: s.id, selected: s.es_principal }, `${s.nombre} · SLA ${s.zona === 'caba' ? '24' : '48'} h`)));
    a.equipos.forEach((e) => equipo.append(h('option', { value: e.id }, `${e.marca} ${e.modelo} · ${e.numero_serie}`)));
  });
  const form = h('form', { class: 'tarjeta formulario', onsubmit: async (ev) => {
    ev.preventDefault(); error.classList.add('oculto'); boton.disabled = true;
    const cuerpo = { cliente_id: Number(cliente.value), asunto: asunto.value, tipo: tipo.value, prioridad: prio.value, origen: origen.value };
    if (sede.value) cuerpo.sede_id = Number(sede.value); if (equipo.value) cuerpo.equipo_id = Number(equipo.value);
    if (desc.value.trim()) cuerpo.descripcion = desc.value; if (tec.value) cuerpo.asignado_a = Number(tec.value);
    try { const r = await api('/api/tickets', { metodo: 'POST', cuerpo }); location.hash = `#/tickets/${r.id}`; } catch (e) {
      if (e.message === 'sesion') return; error.textContent = 'No se pudo crear el ticket. Revisá los datos.'; error.classList.remove('oculto'); boton.disabled = false;
    }
  } }, error, campo('Cliente', cliente, 'cli'), h('div', { class: 'dos-col' }, campo('Sede', sede, 'sede'), campo('Equipo', equipo, 'eq')),
  campo('Asunto', asunto, 'as'), campo('Detalle', desc, 'de'),
  h('div', { class: 'dos-col' }, campo('Tipo', tipo, 'ti'), campo('Prioridad', prio, 'pr')),
  h('div', { class: 'dos-col' }, campo('Cómo llegó', origen, 'or'), tecnicos.length ? campo('Asignar a', tec, 'te') : null), boton);
  destino.append(h('a', { href: '#/tickets', class: 'apoyo' }, '← Tickets'), encabezado('Nuevo ticket', 'El SLA se calcula solo según la zona de la sede.'), form);
}

async function vistaTicket(destino, id) {
  const t = await api(`/api/tickets/${id}`).catch((e) => { if (e.estado === 404) return null; throw e; });
  if (!t) { destino.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos ese ticket'), h('a', { href: '#/tickets' }, 'Volver a tickets'))); return; }
  const abierto = ['abierto', 'asignado', 'en_curso', 'esperando_cliente'].includes(t.estado);
  const recargar = () => navegar();
  const accion = async (ruta, cuerpo) => { try { await api(`/api/tickets/${id}/${ruta}`, { metodo: 'POST', cuerpo }); recargar(); } catch (e) { if (e.message !== 'sesion') contenedor.prepend(h('div', { class: 'error', role: 'alert' }, 'No se pudo completar la acción.')); } };
  const botones = [];
  if (t.puede_atender && abierto) {
    if (t.estado === 'asignado') botones.push(h('button', { class: 'btn', onclick: () => accion('estado', { estado: 'en_curso' }) }, 'Empezar a atender'));
    if (t.estado === 'en_curso') botones.push(h('button', { class: 'btn', onclick: () => accion('estado', { estado: 'esperando_cliente' }) }, 'Esperando al cliente'));
    if (t.estado === 'esperando_cliente') botones.push(h('button', { class: 'btn', onclick: () => accion('estado', { estado: 'en_curso' }) }, 'Retomar'));
    if (t.asignado_a) botones.push(h('a', { class: 'btn btn-principal', href: `#/tickets/${id}/cierre` }, 'Cerrar ticket'));
  }
  if (t.puede_atender && t.estado === 'resuelto') botones.push(h('button', { class: 'btn', onclick: () => accion('estado', { estado: 'en_curso' }) }, 'Reabrir'));

  let asignar = null;
  if (puede('tickets.asignar') && abierto) {
    const tecnicos = await api('/api/tickets-ayuda/tecnicos');
    const sel = h('select', { 'aria-label': 'Técnico' }, tecnicos.map((x) => h('option', { value: x.id, selected: x.id === t.asignado_a }, x.nombre)));
    const visita = h('input', { type: 'datetime-local', 'aria-label': 'Fecha de visita' });
    asignar = h('div', { class: 'tarjeta' }, h('h2', null, t.asignado_a ? 'Reasignar' : 'Asignar técnico'),
      h('div', { class: 'herramientas', style: 'margin:0' }, sel, visita,
        h('button', { class: 'btn btn-principal', onclick: () => accion('asignar', { tecnico_id: Number(sel.value), ...(visita.value ? { visita_en: new Date(visita.value).toISOString() } : {}) }) }, 'Guardar')));
  }
  const comentario = h('textarea', { rows: 2, maxlength: 2000, placeholder: 'Agregar una nota o novedad…', 'aria-label': 'Comentario' });
  const TXT = { creado: 'Ticket creado', asignado: 'Asignado', primera_respuesta: 'Primera respuesta', estado: 'Cambio de estado', comentario: 'Nota' };
  const linea = (e) => h('div', { class: 'linea' }, h('b', null, e.tipo === 'estado' ? `${ESTADO_TICKET[e.estado_nuevo]?.[0] ?? e.estado_nuevo}` : TXT[e.tipo]),
    h('div', { class: 'apoyo' }, `${cuando(e.created_at)}${e.usuario ? ` · ${e.usuario}` : ''}`), e.comentario && h('div', { style: 'white-space:pre-line' }, e.comentario));

  destino.append(h('a', { href: '#/tickets', class: 'apoyo' }, '← Tickets'),
    encabezado(`${t.numero} · ${t.asunto}`, t.cliente.nombre_comercial || t.cliente.razon_social, h('div', { class: 'acciones' }, ...botones)),
    h('div', { class: 'rejilla dos' },
      h('div', null,
        h('div', { class: 'tarjeta' }, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px' }, chipTicket(t.estado), t.prioridad !== 'normal' && chip(t.prioridad, PRIORIDAD[t.prioridad]), chipSla(t.sla)),
          t.descripcion && h('p', { style: 'white-space:pre-line;margin-top:0' }, t.descripcion),
          h('dl', { class: 'datos', style: 'margin:0' },
            ...[['Técnico', t.tecnico?.nombre ?? chip('Sin asignar', 'aviso')], ['Visita', t.visita_en ? cuando(t.visita_en) : '—'], ['Sede', t.sede ? `${t.sede.nombre}${t.sede.domicilio ? ` · ${t.sede.domicilio}` : ''}` : '—'],
              ['Equipo', t.equipo ? `${t.equipo.marca} ${t.equipo.modelo} · ${t.equipo.numero_serie}` : '—'], ['Abierto', cuando(t.abierto_en)], ['Vence', t.sla_medible ? cuando(t.vence_sla) : 'Sin SLA (migrado)']]
              .map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))))),
        t.partes.length > 0 && h('div', { class: 'tarjeta' }, h('h2', null, 'Trabajo realizado'), t.partes.map((p) => h('div', null,
          h('p', { style: 'margin:0 0 4px;white-space:pre-line' }, p.trabajo_realizado), h('div', { class: 'apoyo' }, `${p.tecnico} · ${cuando(p.fin)}`),
          (p.contador_negro != null) && h('div', { class: 'apoyo' }, `Contadores: ${p.contador_negro} negro${p.contador_color ? ` / ${p.contador_color} color` : ''}`),
          p.repuestos.length > 0 && h('div', { class: 'apoyo' }, `Insumos usados: ${p.repuestos.reduce((s, r) => s + r.cantidad, 0)}`))),
          t.remitos.map((r) => h('div', { style: 'margin-top:10px' }, h('a', { href: `#/remitos/${r.id}` }, chip(`Remito ${r.numero}`, 'info')), ' ', r.conformidad ? chip(`Conforme: ${r.conformidad.firmante_nombre}`, 'ok') : chip('Sin conformidad', 'aviso')))),
        asignar),
      h('div', { class: 'tarjeta' }, h('h2', null, 'Historial'), t.eventos.map(linea),
        h('div', { style: 'margin-top:12px' }, comentario, h('div', { style: 'margin-top:8px' },
          h('button', { class: 'btn', onclick: () => { if (comentario.value.trim()) accion('comentarios', { comentario: comentario.value }); } }, 'Agregar nota'))))));
}

/** Cierre pensado para el celular: lo mínimo para cerrar en un minuto, parado frente a la impresora. */
async function vistaCierre(destino, id) {
  const t = await api(`/api/tickets/${id}`).catch((e) => { if (e.estado === 404) return null; throw e; });
  if (!t || !t.puede_atender) { destino.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No podés cerrar este ticket'), h('a', { href: '#/tickets' }, 'Volver'))); return; }
  const insumos = puede('insumos.ver') ? await api('/api/tickets-ayuda/insumos') : [];
  const trabajo = h('textarea', { id: 'tr', rows: 4, maxlength: 4000, required: true, placeholder: 'Qué hiciste' });
  const RAPIDOS = ['Limpieza general', 'Cambio de tóner', 'Cambio de unidad de imagen', 'Se destrabó el papel', 'Reinstalación de driver', 'Revisión de red'];
  const chips = h('div', { class: 'rapidos' }, RAPIDOS.map((r) => h('button', { type: 'button', class: 'rapido', onclick: () => { trabajo.value = trabajo.value ? `${trabajo.value}. ${r}` : r; } }, r)));
  const color = t.equipo?.tipo === 'color';
  const cNegro = h('input', { id: 'cn', type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Contador negro' });
  const cColor = h('input', { id: 'cc', type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Contador color' });
  const repuestos = []; const listaRep = h('div');
  const selIns = h('select', { 'aria-label': 'Insumo' }, h('option', { value: '' }, 'Agregar un insumo…'), insumos.map((i) => h('option', { value: i.id, disabled: i.stock <= 0 }, `${i.descripcion} (stock ${i.stock})`)));
  const pintarRep = () => { vaciar(listaRep).append(...repuestos.map((r, k) => h('div', { class: 'item-rep' }, h('span', null, `${r.cant} × ${r.nombre}`), h('button', { type: 'button', class: 'rapido', onclick: () => { repuestos.splice(k, 1); pintarRep(); } }, 'Quitar')))); };
  selIns.addEventListener('change', () => { if (!selIns.value) return; const i = insumos.find((x) => x.id === Number(selIns.value)); const ya = repuestos.find((r) => r.id === i.id); if (ya) ya.cant += 1; else repuestos.push({ id: i.id, nombre: i.descripcion, cant: 1 }); selIns.value = ''; pintarRep(); });

  const quien = h('input', { id: 'qn', maxlength: 120, placeholder: 'Nombre de quien recibe' }); const cargo = h('input', { id: 'qc', maxlength: 80, placeholder: 'Cargo (opcional)' });
  const lienzo = h('canvas', { class: 'firma', width: 600, height: 220, 'aria-label': 'Firma del cliente' });
  let trazo = false; let hayFirma = false; const g = lienzo.getContext('2d'); g.lineWidth = 3; g.lineCap = 'round'; g.strokeStyle = '#0D1B2A';
  const pos = (e) => { const r = lienzo.getBoundingClientRect(); return [(e.clientX - r.left) * (lienzo.width / r.width), (e.clientY - r.top) * (lienzo.height / r.height)]; };
  lienzo.addEventListener('pointerdown', (e) => { trazo = true; lienzo.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pos(e)); });
  lienzo.addEventListener('pointermove', (e) => { if (!trazo) return; g.lineTo(...pos(e)); g.stroke(); hayFirma = true; });
  lienzo.addEventListener('pointerup', () => { trazo = false; });
  const error = h('div', { class: 'error oculto', role: 'alert' });
  const boton = h('button', { class: 'btn btn-principal grande', type: 'submit' }, 'Cerrar ticket y generar remito');
  const MENSAJES = { contador_menor_al_anterior: 'El contador es menor al de la última lectura. Revisalo.', equipo_monocromo: 'Este equipo es monocromo: no lleva contador de color.', sin_stock: 'No hay stock suficiente de uno de los insumos.', firma_invalida: 'La firma no es válida. Volvé a firmar.', contador_color_requerido: 'Este equipo es color: cargá también el contador de color.', contador_negro_requerido: 'Cargá el contador negro.' };

  const form = h('form', { class: 'formulario', onsubmit: async (ev) => {
    ev.preventDefault(); error.classList.add('oculto'); boton.disabled = true;
    const cuerpo = { trabajo_realizado: trabajo.value, repuestos: repuestos.map((r) => ({ insumo_id: r.id, cantidad: r.cant })) };
    if (cNegro.value !== '') cuerpo.contador_negro = Number(cNegro.value); if (color && cColor.value !== '') cuerpo.contador_color = Number(cColor.value);
    if (quien.value.trim()) cuerpo.conformidad = { nombre: quien.value, ...(cargo.value.trim() ? { cargo: cargo.value } : {}), ...(hayFirma ? { firma: lienzo.toDataURL('image/png') } : {}) };
    try {
      const r = await api(`/api/tickets/${id}/cierre`, { metodo: 'POST', cuerpo });
      vaciar(contenedor).append(h('div', { class: 'tarjeta vacio' }, h('b', null, r.estado === 'cerrado' ? 'Ticket cerrado' : 'Ticket resuelto'),
        `Remito ${r.remito} generado.`, r.estado === 'resuelto' && h('p', null, 'Quedó pendiente la conformidad del cliente.'),
        r.sla_cumplido != null && h('p', null, chip(r.sla_cumplido ? 'Dentro del SLA' : 'Fuera de SLA', r.sla_cumplido ? 'ok' : 'malo'), ` ${num1(r.horas_resolucion)} h hábiles`),
        h('a', { class: 'btn btn-principal', href: '#/tickets' }, 'Volver a mis tickets')));
    } catch (e) {
      if (e.message === 'sesion') return; error.textContent = MENSAJES[e.datos?.error] ?? 'No se pudo cerrar el ticket. Revisá los datos.';
      error.classList.remove('oculto'); boton.disabled = false; error.scrollIntoView({ block: 'center' });
    }
  } }, error,
  h('div', { class: 'tarjeta' }, h('h2', null, 'Trabajo realizado'), chips, trabajo),
  t.equipo && h('div', { class: 'tarjeta' }, h('h2', null, `Contadores · ${t.equipo.marca} ${t.equipo.modelo}`), h('div', { class: 'dos-col' }, cNegro, color ? cColor : null),
    h('p', { class: 'apoyo', style: 'margin:8px 0 0' }, color ? 'Equipo color: se toman los dos contadores.' : 'Equipo monocromo: solo contador negro.')),
  insumos.length > 0 && h('div', { class: 'tarjeta' }, h('h2', null, 'Insumos usados'), selIns, listaRep),
  h('div', { class: 'tarjeta' }, h('h2', null, 'Conformidad del cliente'), h('p', { class: 'apoyo', style: 'margin-top:0' }, 'Si no puede firmar ahora, dejalo vacío: el ticket queda resuelto, a la espera de la conformidad.'),
    h('div', { class: 'dos-col' }, quien, cargo), lienzo,
    h('button', { type: 'button', class: 'rapido', onclick: () => { g.clearRect(0, 0, lienzo.width, lienzo.height); hayFirma = false; } }, 'Borrar firma')),
  boton);
  destino.append(h('a', { href: `#/tickets/${id}`, class: 'apoyo' }, `← ${t.numero}`), encabezado(`Cerrar ${t.numero}`, `${t.cliente.nombre_comercial || t.cliente.razon_social} · ${t.asunto}`), form);
}

async function vistaServicio(destino) {
  const s = await api('/api/tableros/servicio');
  const kpi = (rotulo, valor, nota, clase) => h('div', { class: `tarjeta kpi ${clase ?? ''}` }, h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, valor), h('div', { class: 'nota' }, nota));
  const propio = s.tecnicos.length === 1 && !puede('tickets.asignar');
  destino.append(encabezado('Servicio', propio ? 'Tus números del mes, en horas hábiles' : 'SLA, carga del equipo y reincidencias · horas hábiles'),
    h('div', { class: 'rejilla kpis' },
      kpi('Tickets abiertos', String(s.abiertos), `${s.por_prioridad.urgente} urgentes · ${s.por_prioridad.alta} altas`),
      kpi('Vencidos', String(s.vencidos), s.vencidos ? 'Pasaron su SLA sin resolverse' : 'Ninguno fuera de plazo', s.vencidos ? 'alerta' : ''),
      kpi('Sin asignar', s.sin_asignar == null ? '—' : String(s.sin_asignar), 'Esperan técnico', s.sin_asignar ? 'alerta' : ''),
      kpi('Antigüedad media', horas(s.antiguedad_media_horas), 'De lo que sigue abierto')),
    bloqueSla(s.sla, propio ? 'Tu SLA' : 'SLA del equipo'),
    !propio && h('div', { class: 'tarjeta', style: 'padding:6px 8px;margin-top:16px' }, h('p', { class: 'etiqueta', style: 'padding:14px 14px 0' }, 'Por técnico · mes en curso'), h('table', { class: 'tarjetas' },
      h('thead', null, h('tr', null, ['Técnico', 'Abiertos', 'Vencidos', 'Resueltos', 'Tiempo medio', 'Dentro del SLA'].map((t) => h('th', { class: t === 'Técnico' ? '' : 'num' }, t)))),
      h('tbody', null, s.tecnicos.map((t) => h('tr', null, h('td', { 'data-rotulo': 'Técnico' }, h('span', { class: 'nombre-cliente' }, t.nombre)),
        h('td', { class: 'num', 'data-rotulo': 'Abiertos' }, t.abiertos), h('td', { class: 'num', 'data-rotulo': 'Vencidos' }, t.vencidos ? chip(String(t.vencidos), 'malo') : '0'),
        h('td', { class: 'num', 'data-rotulo': 'Resueltos' }, t.resueltos_mes), h('td', { class: 'num', 'data-rotulo': 'Tiempo medio' }, horas(t.horas_medias)),
        h('td', { class: 'num', 'data-rotulo': 'Dentro del SLA' }, t.pct_sla == null ? '—' : `${t.pct_sla}%`, t.muestra_chica && t.resueltos_mes > 0 && h('span', { class: 'apoyo' }, ' · pocos')))))),
      ),
    h('div', { class: 'tarjeta', style: 'margin-top:16px' }, h('p', { class: 'etiqueta' }, 'Equipos con 2 o más tickets en 30 días'),
      s.reincidencia.length ? h('ul', { class: 'lista' }, s.reincidencia.map((r) => h('li', null, h('div', null, h('b', null, r.modelo), h('div', { class: 'apoyo' }, r.numero_serie)), chip(`${r.tickets} tickets`, 'aviso'))))
        : h('div', { class: 'vacio' }, 'Ningún equipo reincidente.')));
}

/* ---------- equipos, insumos, remitos ---------- */
const ESTADO_EQUIPO = { instalado: ['Instalado', 'ok'], deposito: ['En depósito', 'info'], reparacion: ['En taller', 'aviso'], baja: ['De baja', 'mudo'] };
const chipEquipo = (e) => chip(...(ESTADO_EQUIPO[e] ?? [e, 'mudo']));
const ERRORES = {
  contador_menor_al_anterior: 'El contador es menor al de la última lectura.', contador_color_requerido: 'Es un equipo color: cargá también el contador de color.',
  equipo_monocromo: 'Es un equipo monocromo: no lleva contador de color.', contador_negro_requerido: 'Cargá el contador negro.', ya_instalado: 'El equipo ya está instalado.',
  sin_stock: 'No hay stock suficiente.', stock_negativo: 'El stock no puede quedar negativo.', serie_repetida: 'Ya existe un equipo con ese número de serie.', codigo_repetido: 'Ya existe un insumo con ese código.',
  sin_items: 'Agregá al menos un insumo.', equipo_de_baja: 'El equipo está de baja.', retirar_primero: 'Primero hay que retirarlo del cliente.', no_esta_instalado: 'El equipo no está instalado.',
};
const msgError = (e) => ERRORES[e.datos?.error] ?? 'No se pudo guardar. Revisá los datos.';
const campoF = (rotulo, el, id) => h('div', { class: 'campo' }, h('label', { for: id }, rotulo), el);
const numIn = (id, ph) => h('input', { id, type: 'number', min: 0, inputmode: 'numeric', placeholder: ph });

/** Formulario simple en tarjeta, con error visible y botón que se bloquea mientras guarda. */
function formularioEnLinea({ titulo, campos, boton, enviar, alExito }) {
  const error = h('div', { class: 'error oculto', role: 'alert' }); const b = h('button', { class: 'btn btn-principal', type: 'submit' }, boton);
  return h('form', { class: 'tarjeta formulario', onsubmit: async (ev) => {
    ev.preventDefault(); error.classList.add('oculto'); b.disabled = true;
    try { const r = await enviar(); alExito(r); } catch (e) { if (e.message === 'sesion') return; error.textContent = msgError(e); error.classList.remove('oculto'); b.disabled = false; }
  } }, h('h2', null, titulo), error, ...campos, b);
}

async function escanear() {
  const video = h('video', { autoplay: true, playsinline: true, muted: true, class: 'camara' });
  const codigo = h('input', { placeholder: 'o escribí el número de serie', 'aria-label': 'Código del equipo' });
  const aviso = h('p', { class: 'apoyo' });
  let flujo; let activo = true;
  const detener = () => { activo = false; flujo?.getTracks().forEach((t) => t.stop()); };
  const ir = async (valor) => {
    const limpio = String(valor).trim(); let cod = limpio;
    try { const texto = new URL(limpio).searchParams.get('text'); const serie = texto?.match(/N° de Serie:\s*(\S+)/); if (serie) cod = serie[1]; } catch { /* no es una URL: se busca como código */ }
    try { const r = await api(`/api/equipos/qr/${encodeURIComponent(cod)}`); detener(); location.hash = `#/equipos/${r.id}`; } catch (e) { if (e.message !== 'sesion') aviso.textContent = 'No encontramos un equipo con ese código.'; }
  };
  const caja = h('div', { class: 'tarjeta' }, h('h2', null, 'Escanear QR del equipo'), video, aviso,
    h('form', { onsubmit: (ev) => { ev.preventDefault(); ir(codigo.value); }, style: 'display:flex;gap:8px;margin-top:8px' }, codigo, h('button', { class: 'btn btn-principal', type: 'submit' }, 'Buscar')));
  if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia) {
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); video.srcObject = flujo;
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      (async function ciclo() { while (activo) { try { const r = await det.detect(video); if (r[0]) { ir(r[0].rawValue); return; } } catch { /* sigue */ } await new Promise((ok) => setTimeout(ok, 350)); } }());
    } catch { video.classList.add('oculto'); aviso.textContent = 'No se pudo abrir la cámara. Escribí el código o escaneá con la cámara del celular.'; }
  } else { video.classList.add('oculto'); aviso.textContent = 'Este navegador no escanea desde acá: usá la cámara del celular sobre el QR, o escribí el número de serie.'; }
  window.addEventListener('hashchange', detener, { once: true });
  return caja;
}

/** Etiqueta autoadhesiva 90 × 58 mm: logo, serie, modelo y QR que abre WhatsApp de soporte con el serie ya cargado. */
function etiquetaSoporte(e) {
  return h('div', { class: 'label' }, h('div', { class: 'label-header' }, h('img', { src: '/img/logo-blanco.png', alt: 'JustPrint' })),
    h('div', { class: 'label-body' }, h('div', { class: 'label-info' }, h('p', { class: 'label-cta' }, 'Solicitá soporte técnico', h('br'), 'escaneando este código'),
      h('div', null, h('p', { class: 'label-serie-cap' }, 'N° de Serie'), h('p', { class: 'label-serie-val' }, e.numero_serie), h('p', { class: 'label-modelo' }, `${e.marca} ${e.modelo}`)),
      h('p', { class: 'label-footer-text' }, 'JustPrint · soporte@justprint.com.ar')),
    h('div', { class: 'label-qr' }, h('img', { src: `/api/equipos/${e.id}/qr.svg`, alt: `QR ${e.numero_serie}` }))));
}
function imprimirEtiquetas() {
  document.body.classList.add('imprimiendo-etiqueta');
  const hoja = h('style', { id: 'paginaEtiquetas' }, '@media print { @page { size: 90mm 58mm; margin: 0; } }'); document.head.append(hoja);
  const fin = () => { document.body.classList.remove('imprimiendo-etiqueta'); hoja.remove(); window.removeEventListener('afterprint', fin); };
  window.addEventListener('afterprint', fin); window.print();
}

async function vistaEtiquetas(destino, ids) {
  const equipos = await Promise.all(ids.split(',').map((i) => api(`/api/equipos/${Number(i)}`).catch(() => null)));
  const ok = equipos.filter(Boolean);
  destino.append(h('a', { href: '#/equipos', class: 'apoyo' }, '← Equipos'), encabezado(`Etiquetas (${ok.length})`, 'Una por hoja autoadhesiva de 90 × 58 mm.', h('button', { class: 'btn btn-principal', type: 'button', onclick: imprimirEtiquetas }, 'Imprimir etiquetas')),
    h('div', { class: 'etiqueta-qr hoja-etiquetas' }, ok.map((e) => etiquetaSoporte(e))));
}

async function vistaEquipos(destino) {
  const f = { q: '', estado: '', pagina: 1 }; const cuerpo = h('div'); const resumen = h('div', { class: 'rejilla kpis' });
  const elegidos = new Set(); const botonEtiquetas = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => { location.hash = `#/equipos/etiquetas/${[...elegidos].join(',')}`; } }, 'Etiquetas');
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por serie, modelo o cliente', 'aria-label': 'Buscar equipo' });
  const filtro = h('select', { 'aria-label': 'Estado' }, h('option', { value: '' }, 'Todos los estados'), ...Object.entries(ESTADO_EQUIPO).map(([v, [t]]) => h('option', { value: v }, t)));
  let tiempo;
  buscar.addEventListener('input', () => { clearTimeout(tiempo); tiempo = setTimeout(() => { f.q = buscar.value; f.pagina = 1; cargar(); }, 250); });
  filtro.addEventListener('change', () => { f.estado = filtro.value; f.pagina = 1; cargar(); });
  async function cargar() {
    vaciar(cuerpo).append(cargando());
    try {
      const p = new URLSearchParams({ pagina: f.pagina }); if (f.q) p.set('q', f.q); if (f.estado) p.set('estado', f.estado);
      const r = await api(`/api/equipos?${p}`);
      vaciar(resumen).append(...['instalado', 'deposito', 'reparacion', 'baja'].map((k) => h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, ESTADO_EQUIPO[k][0]), h('div', { class: 'valor' }, String(r.por_estado[k] ?? 0)))));
      vaciar(cuerpo);
      if (!r.items.length) { cuerpo.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No hay equipos para mostrar'), 'Probá con otra búsqueda.')); return; }
      cuerpo.append(h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, h('table', { class: 'tarjetas' },
        h('thead', null, h('tr', null, h('th', null, ''), ['Equipo', 'Estado', 'Dónde está', 'Última lectura'].map((t) => h('th', null, t)))),
        h('tbody', null, r.items.map((e) => h('tr', { class: 'fila', tabindex: '0', onclick: () => { location.hash = `#/equipos/${e.id}`; }, onkeydown: (ev) => { if (ev.key === 'Enter') location.hash = `#/equipos/${e.id}`; } },
          h('td', { class: 'casilla', onclick: (ev) => ev.stopPropagation() }, h('input', { type: 'checkbox', 'aria-label': `Elegir ${e.numero_serie}`, onchange: (ev) => { if (ev.target.checked) elegidos.add(e.id); else elegidos.delete(e.id); botonEtiquetas.disabled = !elegidos.size; botonEtiquetas.textContent = elegidos.size ? `Etiquetas (${elegidos.size})` : 'Etiquetas'; } })),
          h('td', { 'data-rotulo': 'Equipo' }, h('div', { class: 'nombre-cliente' }, `${e.marca} ${e.modelo}`), h('div', { class: 'apoyo' }, `${e.numero_serie} · ${e.tipo}`)),
          h('td', { 'data-rotulo': 'Estado' }, chipEquipo(e.estado)),
          h('td', { 'data-rotulo': 'Dónde está' }, e.cliente_id ? (e.nombre_comercial || e.razon_social) : (e.ubicacion ?? '—'), e.sede && h('div', { class: 'apoyo' }, e.sede)),
          h('td', { 'data-rotulo': 'Última lectura' }, e.ultima_lectura ? `${e.ultima_lectura.contador_negro} negro${e.tipo === 'color' ? ` / ${e.ultima_lectura.contador_color} color` : ''}` : '—', e.ultima_lectura && h('div', { class: 'apoyo' }, fecha(e.ultima_lectura.fecha)))))))));
      const paginas = Math.max(1, Math.ceil(r.total / 25));
      if (paginas > 1) cuerpo.append(h('div', { class: 'paginacion' }, h('span', { class: 'apoyo' }, `${r.total} equipos · página ${r.pagina} de ${paginas}`),
        h('div', { style: 'display:flex;gap:8px' }, h('button', { class: 'btn', disabled: r.pagina <= 1, onclick: () => { f.pagina -= 1; cargar(); } }, 'Anterior'), h('button', { class: 'btn', disabled: r.pagina >= paginas, onclick: () => { f.pagina += 1; cargar(); } }, 'Siguiente'))));
    } catch (e) { if (e.message !== 'sesion') vaciar(cuerpo).append(falla()); }
  }
  destino.append(encabezado('Equipos', 'Inventario con su historial', h('div', { class: 'acciones' },
    botonEtiquetas, h('a', { class: 'btn', href: '#/equipos/escanear' }, 'Escanear QR'), puede('equipos.editar') && h('a', { class: 'btn btn-principal', href: '#/equipos/nuevo' }, '+ Nuevo equipo'))),
  resumen, h('div', { class: 'herramientas' }, buscar, filtro), cuerpo);
  await cargar();
}

async function vistaNuevoEquipo(destino) {
  const modelos = await api('/api/modelos');
  const modelo = h('select', { id: 'mo', required: true }, h('option', { value: '' }, 'Elegí un modelo…'), modelos.map((m) => h('option', { value: m.id }, `${m.marca} ${m.modelo} · ${m.tipo}`)));
  const serie = h('input', { id: 'se', required: true, maxlength: 80, placeholder: 'Número de serie' });
  const mMarca = h('input', { id: 'ma', placeholder: 'Marca' }); const mModelo = h('input', { id: 'mm', placeholder: 'Modelo' });
  const mTipo = h('select', { id: 'mt' }, h('option', { value: 'monocromo' }, 'Monocromo'), h('option', { value: 'color' }, 'Color'));
  const nuevoModelo = h('details', { class: 'tarjeta' }, h('summary', null, 'El modelo no está en la lista'), h('div', { class: 'dos-col', style: 'margin-top:12px' }, mMarca, mModelo), mTipo,
    h('button', { type: 'button', class: 'btn', style: 'margin-top:12px', onclick: async () => {
      try { const r = await api('/api/modelos', { metodo: 'POST', cuerpo: { marca: mMarca.value, modelo: mModelo.value, tipo: mTipo.value } }); modelo.append(h('option', { value: r.id, selected: true }, `${mMarca.value} ${mModelo.value} · ${mTipo.value}`)); modelo.value = String(r.id); nuevoModelo.open = false; } catch (e) { if (e.message !== 'sesion') nuevoModelo.append(h('div', { class: 'error' }, 'No se pudo crear el modelo (¿ya existe?).')); }
    } }, 'Crear modelo'));
  destino.append(h('a', { href: '#/equipos', class: 'apoyo' }, '← Equipos'), encabezado('Nuevo equipo', 'Entra al depósito con su código QR.'),
    formularioEnLinea({ titulo: 'Datos del equipo', campos: [campoF('Modelo', modelo, 'mo'), campoF('Número de serie', serie, 'se')], boton: 'Crear equipo',
      enviar: () => api('/api/equipos', { metodo: 'POST', cuerpo: { modelo_id: Number(modelo.value), numero_serie: serie.value } }), alExito: (r) => { location.hash = `#/equipos/${r.id}`; } }), nuevoModelo);
}

async function vistaEquipo(destino, id) {
  const e = await api(`/api/equipos/${id}`).catch((x) => { if (x.estado === 404) return null; throw x; });
  if (!e) { destino.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos ese equipo'), h('a', { href: '#/equipos' }, 'Volver a equipos'))); return; }
  const color = e.tipo === 'color'; const recargar = () => navegar();
  const dato = (k, v) => h('div', null, h('dt', null, k), h('dd', null, v ?? '—'));
  const ult = e.lecturas[0];
  const lectura = puede('equipos.editar') || puede('tickets.atender') ? (() => { const n = numIn('ln', 'Contador negro'); const c = color ? numIn('lc', 'Contador color') : null;
    return formularioEnLinea({ titulo: 'Registrar lectura de contadores', campos: [h('div', { class: 'dos-col' }, n, c)], boton: 'Guardar lectura',
      enviar: () => api(`/api/equipos/${id}/lecturas`, { metodo: 'POST', cuerpo: { contador_negro: Number(n.value), ...(c && c.value !== '' ? { contador_color: Number(c.value) } : {}) } }), alExito: recargar }); })() : null;

  let mover = null;
  if (e.puede_editar && e.estado !== 'baja') {
    if (e.estado === 'instalado') {
      const n = numIn('rn', 'Contador negro'); const c = color ? numIn('rc', 'Contador color') : null;
      const dest = h('select', { 'aria-label': 'Destino' }, h('option', { value: 'deposito' }, 'Al depósito'), h('option', { value: 'reparacion' }, 'Al taller'));
      mover = formularioEnLinea({ titulo: 'Retirar del cliente', campos: [dest, h('div', { class: 'dos-col' }, n, c)], boton: 'Retirar equipo',
        enviar: () => api(`/api/equipos/${id}/mover`, { metodo: 'POST', cuerpo: { accion: 'retirar', destino: dest.value, contador_negro: Number(n.value), ...(c && c.value !== '' ? { contador_color: Number(c.value) } : {}) } }), alExito: recargar });
    } else {
      const contratos = await api('/api/equipos-ayuda/contratos');
      const sel = h('select', { required: true, 'aria-label': 'Contrato' }, h('option', { value: '' }, 'Elegí el cliente y contrato…'), contratos.map((c) => h('option', { value: c.id }, `${c.nombre_comercial || c.razon_social} · ${c.nombre}`)));
      const sede = h('select', { 'aria-label': 'Sede' }); const n = numIn('in', 'Contador negro inicial'); const c = color ? numIn('ic', 'Contador color inicial') : null;
      sel.addEventListener('change', () => { vaciar(sede); (contratos.find((x) => x.id === Number(sel.value))?.sedes ?? []).forEach((s) => sede.append(h('option', { value: s.id }, s.nombre))); });
      mover = formularioEnLinea({ titulo: 'Instalar en un cliente', campos: [sel, sede, h('div', { class: 'dos-col' }, n, c)], boton: 'Instalar equipo',
        enviar: () => api(`/api/equipos/${id}/mover`, { metodo: 'POST', cuerpo: { accion: 'instalar', contrato_id: Number(sel.value), ...(sede.value ? { sede_id: Number(sede.value) } : {}), contador_negro: Number(n.value), ...(c && c.value !== '' ? { contador_color: Number(c.value) } : {}) } }), alExito: recargar });
    }
  }
  destino.append(h('a', { href: '#/equipos', class: 'apoyo' }, '← Equipos'), encabezado(`${e.marca} ${e.modelo}`, `Serie ${e.numero_serie}`, chipEquipo(e.estado)),
    h('div', { class: 'rejilla dos' }, h('div', null,
      h('div', { class: 'tarjeta' }, h('dl', { class: 'datos', style: 'margin:0' }, dato('Tipo', color ? 'Color (cuenta negro y color)' : 'Monocromo'),
        dato('Cliente', e.cliente_id ? h('a', { href: `#/clientes/${e.cliente_id}` }, e.nombre_comercial || e.razon_social) : (e.ubicacion ?? '—')), dato('Sede', e.sede), dato('Contrato', e.contrato),
        dato('Última lectura', ult ? `${ult.contador_negro}${color ? ` / ${ult.contador_color}` : ''} · ${fecha(ult.fecha)}` : '—'),
        dato('Páginas entre las dos últimas', e.periodo ? `${e.periodo.negro}${color ? ` negro / ${e.periodo.color} color` : ''}` : '—'))),
      lectura, mover,
      h('div', { class: 'tarjeta' }, h('h2', null, 'Lecturas de contadores'), e.lecturas.length ? h('table', null, h('tbody', null, e.lecturas.map((l) => h('tr', null, h('td', null, fecha(l.fecha)), h('td', { class: 'num' }, `${l.contador_negro}${color ? ` / ${l.contador_color}` : ''}`), h('td', { class: 'apoyo' }, `${l.origen}${l.usuario ? ` · ${l.usuario}` : ''}`))))) : h('p', { class: 'apoyo' }, 'Todavía no hay lecturas.')),
      h('div', { class: 'tarjeta' }, h('h2', null, 'Tickets'), e.tickets.length ? h('ul', { class: 'lista' }, e.tickets.map((t) => h('li', null, h('a', { href: `#/tickets/${t.id}` }, `${t.numero} · ${t.asunto}`), chipTicket(t.estado)))) : h('p', { class: 'apoyo' }, 'Sin tickets.'))),
    h('div', null,
      h('div', { class: 'tarjeta etiqueta-qr' }, h('h2', null, 'Etiqueta para el equipo'), etiquetaSoporte(e), h('div', { class: 'apoyo', style: 'margin-top:8px' }, 'Autoadhesiva de 90 × 58 mm. El cliente la escanea y le llega a WhatsApp de soporte con el serie ya cargado.'),
        h('button', { class: 'btn', type: 'button', style: 'margin-top:10px', onclick: () => imprimirEtiquetas() }, 'Imprimir etiqueta')),
      h('div', { class: 'tarjeta' }, h('h2', null, 'Dónde estuvo'), e.asignaciones.length ? e.asignaciones.map((a) => h('div', { class: `linea ${a.hasta ? '' : 'vigente'}` }, h('b', null, a.nombre_comercial || a.razon_social),
        h('div', { class: 'apoyo' }, `${fecha(a.desde)} → ${a.hasta ? fecha(a.hasta) : 'hoy'}${a.sede ? ` · ${a.sede}` : ''}`), h('div', { class: 'apoyo' }, `Contador inicial ${a.contador_inicial_negro}${a.contador_final_negro != null ? ` · final ${a.contador_final_negro}` : ''}`)))
        : h('p', { class: 'apoyo' }, 'Nunca estuvo instalado.'), e.movimientos.map((m) => h('div', { class: 'apoyo' }, `${fecha(m.fecha)} · ${m.motivo ?? 'Movimiento'}${m.usuario ? ` (${m.usuario})` : ''}`))))));
}

async function vistaInsumos(destino) {
  const r = await api('/api/insumos'); const edita = puede('insumos.mover'); const NIVEL = { sin_stock: ['Sin stock', 'malo'], bajo: ['Bajo el mínimo', 'aviso'], ok: ['Normal', 'ok'] };
  destino.append(encabezado('Insumos', 'Stock según los movimientos registrados', edita && h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/insumos/nuevo' }, '+ Nuevo insumo'), puede('remitos.crear') && h('a', { class: 'btn btn-principal', href: '#/insumos/entrega' }, 'Nueva entrega (remito)'))),
    h('div', { class: 'rejilla kpis' }, h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'Insumos'), h('div', { class: 'valor' }, String(r.items.length))),
      h('div', { class: `tarjeta kpi ${r.sin_stock ? 'alerta' : ''}` }, h('div', { class: 'rotulo' }, 'Sin stock'), h('div', { class: 'valor' }, String(r.sin_stock))),
      h('div', { class: `tarjeta kpi ${r.bajo_minimo ? 'alerta' : ''}` }, h('div', { class: 'rotulo' }, 'Bajo el mínimo'), h('div', { class: 'valor' }, String(r.bajo_minimo)))),
    r.items.length ? h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, h('table', { class: 'tarjetas' }, h('thead', null, h('tr', null, ['Insumo', 'Stock', 'Mínimo', 'Nivel'].map((t, k) => h('th', { class: k && k < 3 ? 'num' : '' }, t)))),
      h('tbody', null, r.items.map((i) => h('tr', { class: 'fila', tabindex: '0', onclick: () => { location.hash = `#/insumos/${i.id}`; }, onkeydown: (ev) => { if (ev.key === 'Enter') location.hash = `#/insumos/${i.id}`; } },
        h('td', { 'data-rotulo': 'Insumo' }, h('div', { class: 'nombre-cliente' }, i.descripcion), h('div', { class: 'apoyo' }, i.codigo)), h('td', { class: 'num', 'data-rotulo': 'Stock' }, i.stock), h('td', { class: 'num', 'data-rotulo': 'Mínimo' }, i.stock_minimo), h('td', { 'data-rotulo': 'Nivel' }, chip(...NIVEL[i.nivel]))))))) : h('div', { class: 'tarjeta vacio' }, h('b', null, 'Todavía no hay insumos'), 'Cargá el primero para empezar a llevar stock.'));
}

async function vistaInsumo(destino, id) {
  const i = await api(`/api/insumos/${id}`).catch((x) => { if (x.estado === 404) return null; throw x; });
  if (!i) { destino.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos ese insumo'), h('a', { href: '#/insumos' }, 'Volver'))); return; }
  const tipo = h('select', { 'aria-label': 'Tipo' }, h('option', { value: 'entrada' }, 'Entrada (compra o devolución)'), h('option', { value: 'ajuste' }, 'Ajuste de inventario (+/−)'));
  const cant = h('input', { type: 'number', step: 1, required: true, placeholder: 'Cantidad', 'aria-label': 'Cantidad' }); const motivo = h('input', { required: true, maxlength: 255, placeholder: 'Motivo', 'aria-label': 'Motivo' });
  const MOV = { entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste' };
  destino.append(h('a', { href: '#/insumos', class: 'apoyo' }, '← Insumos'), encabezado(i.descripcion, i.codigo, chip(`Stock ${i.stock}`, i.stock <= 0 ? 'malo' : i.stock < i.stock_minimo ? 'aviso' : 'ok')),
    puede('insumos.mover') && formularioEnLinea({ titulo: 'Registrar movimiento', campos: [tipo, h('div', { class: 'dos-col' }, cant, motivo)], boton: 'Guardar',
      enviar: () => api(`/api/insumos/${id}/movimientos`, { metodo: 'POST', cuerpo: { tipo: tipo.value, cantidad: Number(cant.value), motivo: motivo.value } }), alExito: () => navegar() }),
    h('div', { class: 'tarjeta', style: 'margin-top:16px' }, h('h2', null, 'Movimientos'), i.movimientos.length ? h('table', null, h('tbody', null, i.movimientos.map((m) => h('tr', null, h('td', null, cuando(m.fecha)), h('td', null, MOV[m.tipo]),
      h('td', { class: 'num' }, `${m.tipo === 'salida' ? '−' : m.cantidad > 0 ? '+' : ''}${m.cantidad}`), h('td', { class: 'apoyo' }, [m.motivo, m.remito && `remito ${m.remito}`, m.usuario].filter(Boolean).join(' · ')))))) : h('p', { class: 'apoyo' }, 'Sin movimientos.')));
}

async function vistaNuevoInsumo(destino) {
  const cod = h('input', { required: true, maxlength: 60, placeholder: 'Código' }); const des = h('input', { required: true, maxlength: 200, placeholder: 'Descripción' }); const min = numIn('mi', 'Stock mínimo');
  destino.append(h('a', { href: '#/insumos', class: 'apoyo' }, '← Insumos'), encabezado('Nuevo insumo'),
    formularioEnLinea({ titulo: 'Datos', campos: [campoF('Código', cod, ''), campoF('Descripción', des, ''), campoF('Stock mínimo (avisa cuando baja de acá)', min, 'mi')], boton: 'Crear insumo',
      enviar: () => api('/api/insumos', { metodo: 'POST', cuerpo: { codigo: cod.value, descripcion: des.value, stock_minimo: Number(min.value || 0) } }), alExito: (r) => { location.hash = `#/insumos/${r.id}`; } }));
}

async function vistaEntrega(destino) {
  const [clientes, insumos] = await Promise.all([api('/api/clientes?limite=100'), api('/api/insumos')]);
  const cli = h('select', { required: true, 'aria-label': 'Cliente' }, h('option', { value: '' }, 'Elegí un cliente…'), clientes.clientes.map((c) => h('option', { value: c.id }, c.nombre_comercial || c.razon_social)));
  const sede = h('select', { 'aria-label': 'Sede' }); const items = []; const lista = h('div');
  const sel = h('select', { 'aria-label': 'Insumo' }, h('option', { value: '' }, 'Agregar un insumo…'), insumos.items.map((i) => h('option', { value: i.id, disabled: i.stock <= 0 }, `${i.descripcion} (stock ${i.stock})`)));
  const pintar = () => vaciar(lista).append(...items.map((it, k) => h('div', { class: 'item-rep' }, h('span', null, `${it.cant} × ${it.nombre}`), h('span', null, h('button', { type: 'button', class: 'rapido', onclick: () => { it.cant += 1; pintar(); } }, '+'), ' ', h('button', { type: 'button', class: 'rapido', onclick: () => { it.cant -= 1; if (!it.cant) items.splice(k, 1); pintar(); } }, '−')))));
  sel.addEventListener('change', () => { if (!sel.value) return; const i = insumos.items.find((x) => x.id === Number(sel.value)); const ya = items.find((x) => x.id === i.id); if (ya) ya.cant += 1; else items.push({ id: i.id, nombre: i.descripcion, cant: 1 }); sel.value = ''; pintar(); });
  cli.addEventListener('change', async () => { vaciar(sede); if (!cli.value) return; (await api(`/api/tickets-ayuda/cliente/${cli.value}`)).sedes.forEach((s) => sede.append(h('option', { value: s.id, selected: s.es_principal }, s.nombre))); });
  const obs = h('input', { maxlength: 1000, placeholder: 'Observaciones (opcional)' });
  destino.append(h('a', { href: '#/insumos', class: 'apoyo' }, '← Insumos'), encabezado('Nueva entrega', 'Genera el remito y descuenta el stock.'),
    formularioEnLinea({ titulo: 'Remito de entrega', campos: [campoF('Cliente', cli, ''), campoF('Sede', sede, ''), sel, lista, obs], boton: 'Generar remito',
      enviar: () => { if (!items.length) { const e = new Error('x'); e.datos = { error: 'sin_items' }; throw e; } return api('/api/remitos/entrega', { metodo: 'POST', cuerpo: { cliente_id: Number(cli.value), ...(sede.value ? { sede_id: Number(sede.value) } : {}), ...(obs.value.trim() ? { observaciones: obs.value } : {}), items: items.map((x) => ({ insumo_id: x.id, cantidad: x.cant })) } }); },
      alExito: (r) => { location.hash = `#/remitos/${r.id}`; } }));
}

async function vistaRemito(destino, id) {
  const r = await api(`/api/remitos/${id}`).catch((x) => { if (x.estado === 404) return null; throw x; });
  if (!r) { destino.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos ese remito'))); return; }
  destino.append(h('div', { class: 'acciones no-imprimir', style: 'margin-bottom:16px' }, h('button', { class: 'btn btn-principal', type: 'button', onclick: () => window.print() }, 'Imprimir / guardar PDF')),
    h('div', { class: 'tarjeta remito' }, h('div', { style: 'display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap' }, h('div', null, h('h1', null, `Remito ${r.numero}`), h('div', { class: 'apoyo' }, r.emisor)),
      h('div', { style: 'text-align:right' }, h('b', null, fecha(r.fecha)), h('div', { class: 'apoyo' }, r.tipo === 'servicio' ? `Servicio técnico${r.ticket ? ` · ticket ${r.ticket}` : ''}` : 'Entrega'))),
    h('dl', { class: 'datos', style: 'margin:16px 0' }, h('div', null, h('dt', null, 'Cliente'), h('dd', null, r.cliente.nombre_comercial || r.cliente.razon_social)), h('div', null, h('dt', null, 'CUIT'), h('dd', null, r.cliente.cuit ?? '—')),
      h('div', null, h('dt', null, 'Sede'), h('dd', null, r.sede ? `${r.sede.nombre}${r.sede.domicilio ? ` · ${r.sede.domicilio}` : ''}` : '—'))),
    h('table', null, h('thead', null, h('tr', null, h('th', null, 'Descripción'), h('th', { class: 'num' }, 'Cantidad'))), h('tbody', null, r.items.map((i) => h('tr', null, h('td', null, i.descripcion), h('td', { class: 'num' }, i.cantidad))))),
    r.observaciones && h('p', { style: 'white-space:pre-line' }, r.observaciones),
    h('div', { style: 'margin-top:28px;border-top:1px solid var(--borde);padding-top:12px' }, r.conformidad ? h('div', null, chip('Conforme', 'ok'), ` ${r.conformidad.firmante_nombre}${r.conformidad.firmante_cargo ? ` · ${r.conformidad.firmante_cargo}` : ''} · ${cuando(r.conformidad.firmado_en)}`) : h('div', { style: 'height:60px' }, h('span', { class: 'apoyo' }, 'Firma y aclaración de quien recibe')))));
}

/* ---------- facturación y cobranzas ---------- */
Object.assign(ERRORES, {
  sin_cotizacion: 'Todavía no hay cotización del dólar cargada.', no_es_borrador: 'La factura ya no es un borrador.', tiene_cobros: 'Tiene cobros aplicados: no se puede anular.',
  factura_no_cobrable: 'Esa factura no admite cobros.', moneda_distinta: 'El cobro tiene que ser en la misma moneda de la factura.', supera_saldo: 'El importe supera el saldo de la factura.',
  fecha_futura: 'La fecha no puede ser futura.', no_se_puede_anular: 'Esa factura no se puede anular.', aplicado_supera_cobro: 'Lo aplicado supera el importe del cobro.',
  contrato_invalido: 'El contrato no es de ese cliente.', factura_invalida: 'La factura no corresponde a ese cliente.', sin_items: 'Agregá al menos un renglón.',
});
const ESTADO_FACTURA = { borrador: ['Borrador', 'info'], emitida: ['Emitida', 'aviso'], cobrada_parcial: ['Cobro parcial', 'aviso'], cobrada: ['Cobrada', 'ok'], anulada: ['Anulada', 'mudo'] };
const chipFactura = (f) => h('span', null, chip(...(ESTADO_FACTURA[f.estado] ?? [f.estado, 'mudo'])), f.clase === 'interno' && [' ', chip('Sin comprobante', 'mudo')]);
const mesActual = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
const mesAnterior = () => { const [a, m] = mesActual().split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; };
const nombreMes = (p) => `${mesCorto(p)} ${p.slice(0, 4)}`;
const verFactura = (id) => { location.hash = `#/facturacion/factura/${id}`; };
const filaClic = (fn) => ({ class: 'fila', tabindex: '0', onclick: fn, onkeydown: (ev) => { if (ev.key === 'Enter') fn(); } });

function pestanasFact(activa) {
  const t = [['liquidacion', 'Liquidación del mes', puede('facturas.emitir')], ['facturas', 'Facturas', true], ['cobranzas', 'Cobranzas', true]].filter((x) => x[2]);
  return h('div', { class: 'pestanas no-imprimir' }, t.map(([k, txt]) => h('button', { type: 'button', class: k === activa ? 'activa' : '', onclick: () => { location.hash = `#/facturacion/${k}`; } }, txt)));
}

async function vistaFacturacion(destino, tab) {
  const tabs = ['liquidacion', 'facturas', 'cobranzas'];
  if (!tabs.includes(tab) || (tab === 'liquidacion' && !puede('facturas.emitir'))) tab = puede('facturas.emitir') ? 'liquidacion' : 'facturas';
  destino.append(encabezado('Facturación y cobranzas', 'Todo en USD neto de IVA; el IVA se suma al facturar.',
    puede('facturas.emitir') && h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/facturacion/nueva' }, '+ Venta directa'))), pestanasFact(tab));
  const cuerpo = h('div'); destino.append(cuerpo);
  if (tab === 'liquidacion') await tabLiquidacion(cuerpo); else if (tab === 'facturas') await tabFacturas(cuerpo); else await tabCobranzas(cuerpo);
}

async function tabLiquidacion(dest) {
  const per = h('input', { type: 'month', value: mesAnterior(), 'aria-label': 'Período' });
  const sinC = h('input', { type: 'checkbox', id: 'sinc', style: 'width:auto;min-height:0' });
  const zona = h('div'); const mensaje = h('div');
  const cargar = async () => {
    vaciar(zona).append(cargando());
    const r = await api(`/api/facturacion/liquidacion?periodo=${per.value}&sin_contadores=${sinC.checked}`).catch(() => null);
    if (!r) { vaciar(zona).append(falla()); return; }
    const sel = new Set(r.filas.filter((f) => f.estado === 'completo' && !f.factura_id).map((f) => f.contrato_id));
    const boton = h('button', { class: 'btn btn-principal', type: 'button' });
    const rotulo = () => { boton.textContent = `Generar borradores (${sel.size})`; boton.disabled = !sel.size; };
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      try {
        const g = await api('/api/facturacion/generar', { metodo: 'POST', cuerpo: { periodo: per.value, contrato_ids: [...sel], sin_contadores: sinC.checked } });
        vaciar(mensaje).append(h('div', { class: 'tarjeta ok-caja' }, `Se crearon ${g.creadas.length} borradores. `, h('a', { href: '#/facturacion/facturas' }, 'Verlos en Facturas'), g.saltadas.length ? ` · ${g.saltadas.length} quedaron afuera.` : ''));
        await cargar();
      } catch (e) { if (e.message !== 'sesion') { vaciar(mensaje).append(h('div', { class: 'error' }, msgError(e))); boton.disabled = false; } }
    });
    rotulo();
    const totalUsd = r.filas.filter((f) => !f.interno).reduce((s, f) => s + (f.neto_usd || 0), 0);
    const ESTADOS = (f) => f.factura_id ? chip(f.factura_estado === 'borrador' ? 'Borrador creado' : 'Ya facturado', 'ok') : f.estado === 'completo' ? chip('Listo', 'ok') : f.estado === 'incompleto' ? chip('Faltan lecturas', 'aviso') : chip('Sin condiciones', 'malo');
    vaciar(zona).append(
      h('div', { class: 'rejilla kpis' }, h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'Contratos del período'), h('div', { class: 'valor' }, String(r.filas.length))),
        h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'A facturar (USD neto)'), h('div', { class: 'valor' }, usd(totalUsd))),
        h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'Cotización BNA'), h('div', { class: 'valor' }, r.cotizacion ? `$ ${Number(r.cotizacion.valor).toLocaleString('es-AR')}` : '—'))),
      r.filas.length ? h('div', { class: 'tarjeta', style: 'padding:6px 8px;margin-top:16px' }, h('table', { class: 'tarjetas' },
        h('thead', null, h('tr', null, h('th', null, ''), ['Cliente / contrato', 'Consumo N / C', 'Excedente N / C', 'Neto', 'Estado'].map((t, k) => h('th', { class: k > 0 && k < 4 ? 'num' : '' }, t)))),
        h('tbody', null, r.filas.map((f) => {
          const ok = f.estado === 'completo' && !f.factura_id;
          const caja = h('input', { type: 'checkbox', disabled: !ok, checked: ok && sel.has(f.contrato_id), 'aria-label': 'Incluir', onchange: (ev) => { if (ev.target.checked) sel.add(f.contrato_id); else sel.delete(f.contrato_id); rotulo(); } });
          return h('tr', null, h('td', null, caja),
            h('td', { 'data-rotulo': 'Cliente' }, h('div', { class: 'nombre-cliente' }, f.cliente), h('div', { class: 'apoyo' }, `${f.contrato}${f.factor < 1 ? ` · prorrateo ${Math.round(f.factor * 100)}%` : ''}${f.interno ? ' · sin comprobante' : ''}`)),
            h('td', { class: 'num', 'data-rotulo': 'Consumo' }, f.estado === 'sin_condiciones' ? '—' : `${f.consumo_negro} / ${f.consumo_color}`),
            h('td', { class: 'num', 'data-rotulo': 'Excedente' }, f.estado === 'sin_condiciones' ? '—' : `${f.excedente_negro} / ${f.excedente_color}`),
            h('td', { class: 'num', 'data-rotulo': 'Neto' }, f.estado === 'sin_condiciones' ? '—' : monto(f.neto, f.moneda)),
            h('td', { 'data-rotulo': 'Estado' }, ESTADOS(f), f.estado === 'incompleto' && h('div', { class: 'apoyo' }, f.faltan.map((x) => x.serie ?? x).join(', '))));
        })))) : h('div', { class: 'tarjeta vacio', style: 'margin-top:16px' }, h('b', null, 'No hay contratos para liquidar en ese período')),
      h('div', { class: 'acciones', style: 'margin-top:16px' }, boton));
  };
  dest.append(h('div', { class: 'tarjeta herramientas', style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:center' }, h('label', null, 'Período ', per), h('label', null, sinC, ' Permitir sin lecturas (cobra solo el abono)'),
    h('button', { class: 'btn', type: 'button', onclick: cargar }, 'Calcular')), mensaje, zona);
  per.addEventListener('change', cargar); sinC.addEventListener('change', cargar);
  await cargar();
}

async function tabFacturas(dest) {
  const est = h('select', { 'aria-label': 'Estado' }, [['', 'Todas'], ['borrador', 'Borradores'], ['por_cobrar', 'Por cobrar'], ['cobrada', 'Cobradas'], ['anulada', 'Anuladas']].map(([v, t]) => h('option', { value: v }, t)));
  const per = h('input', { type: 'month', 'aria-label': 'Período' }); const q = h('input', { type: 'search', placeholder: 'Cliente o número', 'aria-label': 'Buscar' });
  const zona = h('div'); let pagina = 1;
  const cargar = async () => {
    vaciar(zona).append(cargando());
    const p = new URLSearchParams({ pagina }); if (est.value) p.set('estado', est.value); if (per.value) p.set('periodo', per.value); if (q.value.trim()) p.set('q', q.value.trim());
    const r = await api(`/api/facturas?${p}`).catch(() => null);
    if (!r) { vaciar(zona).append(falla()); return; }
    const paginas = Math.max(1, Math.ceil(r.total / 25));
    agregar(vaciar(zona), [r.items.length ? h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, h('table', { class: 'tarjetas' },
      h('thead', null, h('tr', null, ['Cliente', 'Período', 'Comprobante', 'Total', 'Saldo', 'Estado'].map((t, k) => h('th', { class: k === 3 || k === 4 ? 'num' : '' }, t)))),
      h('tbody', null, r.items.map((f) => h('tr', filaClic(() => verFactura(f.id)),
        h('td', { 'data-rotulo': 'Cliente' }, h('div', { class: 'nombre-cliente' }, f.cliente)), h('td', { 'data-rotulo': 'Período' }, nombreMes(f.periodo)),
        h('td', { 'data-rotulo': 'Comprobante' }, f.numero ?? (f.estado === 'borrador' ? '—' : 's/n'), f.fecha_emision && h('div', { class: 'apoyo' }, fecha(f.fecha_emision))),
        h('td', { class: 'num', 'data-rotulo': 'Total' }, monto(f.total, f.moneda)), h('td', { class: 'num', 'data-rotulo': 'Saldo' }, f.estado === 'borrador' || f.estado === 'anulada' ? '—' : monto(f.saldo, f.moneda)),
        h('td', { 'data-rotulo': 'Estado' }, chipFactura(f))))))) : h('div', { class: 'tarjeta vacio' }, h('b', null, 'No hay facturas con esos filtros')),
    paginas > 1 && h('div', { class: 'acciones', style: 'margin-top:12px;align-items:center' }, h('button', { class: 'btn', type: 'button', disabled: pagina <= 1, onclick: () => { pagina -= 1; cargar(); } }, '← Anterior'),
      h('span', { class: 'apoyo' }, ` Página ${pagina} de ${paginas} `), h('button', { class: 'btn', type: 'button', disabled: pagina >= paginas, onclick: () => { pagina += 1; cargar(); } }, 'Siguiente →'))]);
  };
  const nuevoFiltro = () => { pagina = 1; cargar(); };
  [est, per].forEach((el) => el.addEventListener('change', nuevoFiltro)); q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(nuevoFiltro, 300); });
  dest.append(h('div', { class: 'tarjeta herramientas', style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center' }, est, per, q), zona);
  await cargar();
}

async function tabCobranzas(dest) {
  const r = await api('/api/cobranzas');
  agregar(dest, [h('div', { class: 'rejilla kpis' }, h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'Por cobrar (USD neto)'), h('div', { class: 'valor' }, usd(r.total_usd)), h('div', { class: 'apoyo' }, `${r.facturas} factura${r.facturas === 1 ? '' : 's'}`)),
    ['0-30', '31-60', '61-90', '+90'].map((t) => h('div', { class: `tarjeta kpi ${t === '+90' && r.tramos[t] > 0 ? 'alerta' : ''}` }, h('div', { class: 'rotulo' }, `${t} días`), h('div', { class: 'valor' }, usd(r.tramos[t]))))),
  r.clientes.length ? h('div', { class: 'tarjeta', style: 'padding:6px 8px;margin-top:16px' }, h('table', { class: 'tarjetas' },
    h('thead', null, h('tr', null, ['Cliente', 'Saldo USD', '0-30', '31-60', '61-90', '+90', 'Más vieja'].map((t, k) => h('th', { class: k && k < 6 ? 'num' : '' }, t)))),
    h('tbody', null, r.clientes.flatMap((c) => [h('tr', null, h('td', { 'data-rotulo': 'Cliente' }, h('div', { class: 'nombre-cliente' }, c.cliente), h('details', null, h('summary', { class: 'apoyo' }, `${c.facturas} factura${c.facturas > 1 ? 's' : ''}`),
      c.detalle.map((d) => h('div', null, h('a', { href: `#/facturacion/factura/${d.id}` }, `${nombreMes(d.periodo)}${d.numero ? ` · ${d.numero}` : ''}`), ` — ${monto(d.saldo, d.moneda)} · ${d.dias} días${d.estimada ? ' (fecha estimada)' : ''}`)))),
      h('td', { class: 'num', 'data-rotulo': 'Saldo USD' }, h('b', null, usd(c.saldo_usd))), ...['0-30', '31-60', '61-90', '+90'].map((t) => h('td', { class: 'num', 'data-rotulo': `${t} días` }, c.tramos[t] ? usd(c.tramos[t]) : '—')),
      h('td', { 'data-rotulo': 'Más vieja' }, `${c.max_dias} días`))])))) : h('div', { class: 'tarjeta vacio', style: 'margin-top:16px' }, h('b', null, 'No hay nada pendiente de cobro')),
  r.sin_comprobante.facturas > 0 && h('p', { class: 'apoyo' }, `Aparte: ${r.sin_comprobante.facturas} cuenta${r.sin_comprobante.facturas > 1 ? 's' : ''} sin comprobante por ${usd(r.sin_comprobante.usd)} (no entran en el total).`)]);
}

async function vistaFactura(destino, id) {
  const f = await api(`/api/facturas/${id}`).catch((x) => { if (x.estado === 404) return null; throw x; });
  if (!f) { destino.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos esa factura'), h('a', { href: '#/facturacion/facturas' }, 'Volver'))); return; }
  const edita = puede('facturas.emitir'); const borrador = f.estado === 'borrador'; const porCobrar = f.estado === 'emitida' || f.estado === 'cobrada_parcial';
  const cli = f.cliente.nombre_comercial || f.cliente.razon_social; const recargar = () => navegar();
  const titulo = f.numero ? `Factura ${f.numero}` : borrador ? 'Borrador de factura' : f.clase === 'interno' ? 'Cuenta sin comprobante' : 'Factura';
  const delItem = (it) => h('button', { type: 'button', class: 'rapido', 'aria-label': 'Quitar renglón', onclick: async () => { await api(`/api/facturas/${f.id}/items/${it.id}`, { metodo: 'DELETE' }); recargar(); } }, '✕');
  destino.append(h('a', { href: '#/facturacion/facturas', class: 'apoyo no-imprimir' }, '← Facturas'), encabezado(titulo, `${cli} · ${nombreMes(f.periodo)}${f.contrato ? ` · ${f.contrato}` : ''}`, chipFactura(f)),
    h('div', { class: 'tarjeta' }, h('dl', { class: 'datos' },
      h('div', null, h('dt', null, 'Cliente'), h('dd', null, `${cli}${f.cliente.cuit ? ` · ${f.cliente.cuit}` : ''}`)),
      h('div', null, h('dt', null, 'Emisor'), h('dd', null, f.entidad ? `${f.entidad.razon_social} · ${f.entidad.cuit}` : 'Sin comprobante')),
      h('div', null, h('dt', null, 'Emisión'), h('dd', null, f.fecha_emision ? `${fecha(f.fecha_emision)}${f.fecha_emision_estimada ? ' (estimada)' : ''}` : '—')),
      f.vencimiento && h('div', null, h('dt', null, 'Vencimiento'), h('dd', null, fecha(f.vencimiento))),
      f.tipo_cambio && h('div', null, h('dt', null, 'Cotización BNA usada'), h('dd', null, `$ ${f.tipo_cambio.toLocaleString('es-AR')}`))),
    h('table', { style: 'margin-top:16px' }, h('thead', null, h('tr', null, h('th', null, 'Concepto'), h('th', { class: 'num' }, 'Cant.'), h('th', { class: 'num' }, 'Precio'), h('th', { class: 'num' }, 'Subtotal'), borrador && edita && h('th', null, ''))),
      h('tbody', null, f.items.map((i) => h('tr', null, h('td', null, i.descripcion, i.bonificacion ? [' ', chip('Bonificación', 'info')] : null), h('td', { class: 'num' }, i.cantidad.toLocaleString('es-AR')), h('td', { class: 'num' }, monto(i.precio_unitario, f.moneda)), h('td', { class: 'num' }, monto(i.subtotal, f.moneda)), borrador && edita && h('td', null, delItem(i)))))),
    h('div', { style: 'text-align:right;margin-top:12px' }, h('div', null, `Neto ${monto(f.neto, f.moneda)}`), f.iva > 0 && h('div', null, `IVA 21% ${monto(f.iva, f.moneda)}`), h('div', null, h('b', null, `Total ${monto(f.total, f.moneda)}`)),
      f.neto_usd != null && f.moneda === 'ARS' && h('div', { class: 'apoyo' }, `Equivale a ${usd2(f.neto_usd)} neto`),
      !borrador && f.estado !== 'anulada' && h('div', { class: 'apoyo' }, `Cobrado ${monto(f.cobrado, f.moneda)} · Saldo ${monto(f.saldo, f.moneda)}`))));

  if (borrador && edita) {
    const tipo = h('select', { 'aria-label': 'Tipo' }, ['servicio', 'insumo', 'equipo', 'abono', 'excedente', 'otro'].map((t) => h('option', { value: t }, t[0].toUpperCase() + t.slice(1))), h('option', { value: 'bonificacion' }, 'Bonificación / descuento'));
    const des = h('input', { required: true, maxlength: 200, placeholder: 'Concepto', 'aria-label': 'Concepto' }); const cant = h('input', { type: 'number', step: 'any', min: 0, value: 1, 'aria-label': 'Cantidad' }); const pre = h('input', { type: 'number', step: 'any', min: 0, required: true, placeholder: 'Precio unitario', 'aria-label': 'Precio' });
    const fe = h('input', { type: 'date', value: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), 'aria-label': 'Fecha de emisión' }); const nu = h('input', { maxlength: 20, placeholder: 'N° de comprobante (opcional)', 'aria-label': 'Número' }); const ve = h('input', { type: 'date', 'aria-label': 'Vencimiento' });
    destino.append(formularioEnLinea({ titulo: 'Agregar renglón', campos: [h('div', { class: 'dos-col' }, tipo, des), h('div', { class: 'dos-col' }, cant, pre)], boton: 'Agregar',
      enviar: () => api(`/api/facturas/${f.id}/items`, { metodo: 'POST', cuerpo: { tipo: tipo.value === 'bonificacion' ? 'otro' : tipo.value, ...(tipo.value === 'bonificacion' ? { bonificacion: true } : {}), descripcion: des.value, cantidad: Number(cant.value), precio_unitario: Number(pre.value) } }), alExito: recargar }),
    h('div', { style: 'height:16px' }),
    formularioEnLinea({ titulo: f.clase === 'interno' || !f.entidad_facturante_id ? 'Confirmar' : 'Emitir', campos: [h('div', { class: 'dos-col' }, campoF('Fecha de emisión', fe, ''), campoF('Vencimiento (opcional)', ve, '')), nu], boton: 'Emitir',
      enviar: () => api(`/api/facturas/${f.id}/emitir`, { metodo: 'POST', cuerpo: { fecha_emision: fe.value, ...(nu.value.trim() ? { numero: nu.value.trim() } : {}), ...(ve.value ? { vencimiento: ve.value } : {}) } }), alExito: recargar }),
    h('div', { class: 'acciones', style: 'margin-top:12px' }, h('button', { class: 'btn', type: 'button', onclick: async () => { if (!window.confirm('¿Eliminar este borrador?')) return; await api(`/api/facturas/${f.id}`, { metodo: 'DELETE' }); location.hash = '#/facturacion/facturas'; } }, 'Eliminar borrador')));
  }

  if (f.cobros.length) destino.append(h('div', { class: 'tarjeta', style: 'margin-top:16px' }, h('h2', null, 'Cobros'), h('table', null, h('tbody', null, f.cobros.map((c) => h('tr', null, h('td', null, fecha(c.fecha_cobro)), h('td', null, c.medio), h('td', { class: 'apoyo' }, c.referencia ?? ''), h('td', { class: 'num' }, monto(c.importe, f.moneda))))))));

  if (porCobrar && puede('cobros.registrar')) {
    const fe = h('input', { type: 'date', value: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), 'aria-label': 'Fecha' }); const imp = h('input', { type: 'number', step: '0.01', min: 0, value: f.saldo, required: true, 'aria-label': 'Importe' });
    const medio = h('select', { 'aria-label': 'Medio' }, ['transferencia', 'efectivo', 'cheque', 'mercadopago', 'otro'].map((m) => h('option', { value: m }, m))); const ref = h('input', { maxlength: 120, placeholder: 'Referencia (opcional)', 'aria-label': 'Referencia' });
    destino.append(h('div', { style: 'height:16px' }), formularioEnLinea({ titulo: 'Registrar cobro', campos: [h('div', { class: 'dos-col' }, campoF('Fecha', fe, ''), campoF(`Importe (${f.moneda})`, imp, '')), h('div', { class: 'dos-col' }, medio, ref)], boton: 'Registrar cobro',
      enviar: () => api('/api/cobros', { metodo: 'POST', cuerpo: { cliente_id: f.cliente_id, fecha_cobro: fe.value, medio: medio.value, importe: Number(imp.value), moneda: f.moneda, ...(ref.value.trim() ? { referencia: ref.value.trim() } : {}), aplicaciones: [{ factura_id: f.id, importe: Number(imp.value) }] } }), alExito: recargar }));
  }
  if (porCobrar && edita && !f.cobros.length) {
    const mot = h('input', { required: true, minlength: 3, maxlength: 255, placeholder: 'Motivo de la anulación', 'aria-label': 'Motivo' });
    destino.append(h('div', { style: 'height:16px' }), formularioEnLinea({ titulo: 'Anular', campos: [mot], boton: 'Anular factura', enviar: () => api(`/api/facturas/${f.id}/anular`, { metodo: 'POST', cuerpo: { motivo: mot.value } }), alExito: recargar }));
  }
  if (f.estado !== 'borrador') destino.append(h('div', { class: 'acciones no-imprimir', style: 'margin-top:16px' }, h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir')));
}

async function vistaVentaDirecta(destino) {
  const [clientes] = await Promise.all([api('/api/clientes?limite=100')]);
  const cli = h('select', { required: true, 'aria-label': 'Cliente' }, h('option', { value: '' }, 'Elegí un cliente…'), clientes.clientes.map((c) => h('option', { value: c.id }, c.nombre_comercial || c.razon_social)));
  const mon = h('select', { 'aria-label': 'Moneda' }, h('option', { value: 'USD' }, 'Dólares (USD)'), h('option', { value: 'ARS' }, 'Pesos (ARS)'));
  const inter = h('input', { type: 'checkbox', id: 'inter', style: 'width:auto;min-height:0' });
  const filas = []; const lista = h('div');
  const nuevaFila = () => {
    const tipo = h('select', { 'aria-label': 'Tipo' }, ['equipo', 'insumo', 'servicio', 'otro'].map((t) => h('option', { value: t }, t[0].toUpperCase() + t.slice(1)))); const des = h('input', { maxlength: 200, placeholder: 'Concepto', 'aria-label': 'Concepto' });
    const cant = h('input', { type: 'number', step: 'any', min: 0, value: 1, 'aria-label': 'Cantidad' }); const pre = h('input', { type: 'number', step: 'any', min: 0, placeholder: 'Precio unitario', 'aria-label': 'Precio' });
    const fila = { tipo, des, cant, pre }; filas.push(fila);
    fila.el = h('div', { class: 'item-rep', style: 'display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(120px,1fr))' }, tipo, des, cant, pre, h('button', { type: 'button', class: 'rapido', onclick: () => { filas.splice(filas.indexOf(fila), 1); fila.el.remove(); } }, 'Quitar'));
    lista.append(fila.el);
  };
  nuevaFila();
  destino.append(h('a', { href: '#/facturacion/facturas', class: 'apoyo' }, '← Facturas'), encabezado('Venta directa', 'Equipos, insumos o servicios fuera del abono mensual. Se crea como borrador.'),
    formularioEnLinea({ titulo: 'Datos', campos: [campoF('Cliente', cli, ''), campoF('Moneda', mon, ''), h('label', null, inter, ' Sin comprobante (cuenta interna, sin IVA)'), lista, h('button', { type: 'button', class: 'btn', onclick: nuevaFila }, '+ Otro renglón')], boton: 'Crear borrador',
      enviar: () => {
        const items = filas.filter((x) => x.des.value.trim() && x.pre.value !== '').map((x) => ({ tipo: x.tipo.value, descripcion: x.des.value.trim(), cantidad: Number(x.cant.value), precio_unitario: Number(x.pre.value) }));
        if (!items.length) { const e = new Error('x'); e.datos = { error: 'sin_items' }; throw e; }
        return api('/api/facturas', { metodo: 'POST', cuerpo: { cliente_id: Number(cli.value), moneda: mon.value, interno: inter.checked, items } });
      }, alExito: (r) => verFactura(r.id) }));
}

/* ---------- navegación ---------- */
async function navegar() {
  if (!estado.me || !contenedor) return;
  const [ruta = 'inicio', param, sub] = location.hash.replace(/^#\//, '').split('/');
  document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('activo', a.dataset.ruta === ruta));
  const destino = vaciar(contenedor);
  destino.append(cargando());
  const nuevo = h('div');
  try {
    if (ruta === 'inicio') await vistaInicio(nuevo);
    else if (ruta === 'clientes' && puede('clientes.ver')) await (param ? vistaCliente(nuevo, param) : vistaClientes(nuevo));
    else if (ruta === 'tickets' && puede('tickets.ver')) {
      if (param === 'nuevo' && puede('tickets.crear')) await vistaNuevoTicket(nuevo);
      else if (param && sub === 'cierre') await vistaCierre(nuevo, param);
      else if (param) await vistaTicket(nuevo, param);
      else await vistaTickets(nuevo);
    } else if (ruta === 'equipos' && puede('equipos.ver')) {
      if (param === 'nuevo' && puede('equipos.editar')) await vistaNuevoEquipo(nuevo);
      else if (param === 'escanear') nuevo.append(await escanear());
      else if (param === 'etiquetas' && sub) await vistaEtiquetas(nuevo, sub);
      else if (param === 'qr' && sub) { const r = await api(`/api/equipos/qr/${encodeURIComponent(sub)}`).catch(() => null); if (r) { location.replace(`#/equipos/${r.id}`); return; } nuevo.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos ese equipo'), h('a', { href: '#/equipos' }, 'Ver equipos'))); }
      else if (param) await vistaEquipo(nuevo, param);
      else await vistaEquipos(nuevo);
    } else if (ruta === 'insumos' && puede('insumos.ver')) {
      if (param === 'nuevo' && puede('insumos.mover')) await vistaNuevoInsumo(nuevo);
      else if (param === 'entrega' && puede('remitos.crear')) await vistaEntrega(nuevo);
      else if (param) await vistaInsumo(nuevo, param);
      else await vistaInsumos(nuevo);
    } else if (ruta === 'remitos' && param && puede('insumos.ver')) await vistaRemito(nuevo, param);
    else if (ruta === 'servicio' && puede('tableros.servicio')) await vistaServicio(nuevo);
    else if (ruta === 'facturacion' && puede('importes.ver')) {
      if (param === 'nueva' && puede('facturas.emitir')) await vistaVentaDirecta(nuevo);
      else if (param === 'factura' && sub) await vistaFactura(nuevo, sub);
      else await vistaFacturacion(nuevo, param);
    } else if (ruta === 'usuarios' && puede('usuarios.administrar')) await vistaUsuarios(nuevo);
    else if (ruta === 'auditoria' && puede('auditoria.ver')) await vistaAuditoria(nuevo);
    else if (PRONTO[ruta]) vistaPronto(nuevo, ruta);
    else nuevo.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos esa pantalla'), h('a', { href: '#/inicio' }, 'Ir al inicio')));
    vaciar(destino).append(...nuevo.childNodes);
  } catch (e) {
    if (e.message !== 'sesion') vaciar(destino).append(falla());
  }
  window.scrollTo(0, 0);
  document.title = 'JustPrint ERP';
}

function iniciar() {
  armarEstructura();
  if (!location.hash) location.hash = '#/inicio';
  navegar();
}
window.addEventListener('hashchange', navegar);

(async () => {
  try { estado.me = await api('/api/me'); iniciar(); } catch { mostrarIngreso(); }
})();
