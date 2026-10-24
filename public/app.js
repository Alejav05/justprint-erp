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
  { ruta: 'equipos', texto: 'Equipos', permiso: 'equipos.ver', pronto: true },
  { ruta: 'insumos', texto: 'Insumos', permiso: 'insumos.ver', pronto: true },
  { grupo: 'Finanzas' },
  { ruta: 'facturacion', texto: 'Facturación y cobranzas', permiso: 'importes.ver', pronto: true },
  { grupo: 'Sistema' },
  { ruta: 'usuarios', texto: 'Usuarios', permiso: 'usuarios.administrar' },
  { ruta: 'auditoria', texto: 'Auditoría', permiso: 'auditoria.ver' },
];
const PRONTO = {
  equipos: ['Equipos', 'Inventario con historial: dónde estuvo, con qué contrato y qué contadores tuvo.'],
  insumos: ['Insumos', 'Stock, movimientos, entregas por remito y alertas de faltante.'],
  facturacion: ['Facturación y cobranzas', 'Liquidación mensual por contador, facturas con IVA, ventas directas, cobros y aplicaciones.'],
};

/* ---------- ingreso ---------- */
function logo(extra) {
  const img = h('img', { src: '/img/logo.png', alt: 'JustPrint' });
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

async function vistaInicio(destino) {
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
    encabezado('Dirección', `Foto completa del negocio · valores en USD netos, sin IVA`),
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
    c.condiciones ? c.condiciones.map((x) => h('div', { class: `linea ${vigente(x) ? 'vigente' : ''}` },
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' },
        h('b', null, monto(x.monto_mensual, c.moneda), ' / mes'), x.motivo !== 'sin_facturar' && chip(MOTIVO[x.motivo] ?? x.motivo, 'info'),
        !x.facturable && chip('No facturable', 'aviso'), x.ajuste_pct != null && chip(`${Number(x.ajuste_pct)}%`, 'mudo')),
      h('div', { class: 'apoyo' }, `${fecha(x.vigente_desde)} → ${x.vigente_hasta ? fecha(x.vigente_hasta) : 'hoy'}`),
      h('div', { class: 'apoyo' }, `Franquicia ${x.franquicia_negro} negro / ${x.franquicia_color} color · excedente ${Number(x.excedente_negro)} / ${Number(x.excedente_color)} por página`),
      x.monto_usd_referencia != null && h('div', { class: 'apoyo' }, `Referencia: ${usd2(x.monto_usd_referencia)}`),
      x.notas && h('div', { class: 'apoyo' }, x.notas))) : h('p', { class: 'apoyo' }, 'Las condiciones económicas no están disponibles para tu rol.'));
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
          t.remitos.map((r) => h('div', { style: 'margin-top:10px' }, chip(`Remito ${r.numero}`, 'info'), ' ', r.conformidad ? chip(`Conforme: ${r.conformidad.firmante_nombre}`, 'ok') : chip('Sin conformidad', 'aviso')))),
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
    } else if (ruta === 'servicio' && puede('tableros.servicio')) await vistaServicio(nuevo);
    else if (ruta === 'usuarios' && puede('usuarios.administrar')) await vistaUsuarios(nuevo);
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
