// Costos: detalle de lo que costó prestar el servicio. Una pantalla general (por período, agrupable por cliente o tipo)
// y la misma tabla filtrada dentro de la ficha de cada cliente.
export function crearCostos(U) {
  const { h, agregar, vaciar, api, usd, fecha, chip, cargando, encabezado, nombreMes } = U;
  const usd2 = (n) => `USD ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const mesActual = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
  const mesesAtras = (n) => { const [a, m] = mesActual().split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 - n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  const monto = (c) => (c.moneda === 'ARS' ? `$ ${Number(c.importe).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : usd2(c.importe));

  /** Una fila del detalle. `conCliente` agrega la columna cuando la lista mezcla clientes. */
  function fila(c, conCliente) {
    const refs = [c.equipo && `Equipo ${c.equipo}`, c.ticket && `Ticket ${c.ticket}`, c.contrato].filter(Boolean).join(' · ');
    return h('tr', null,
      h('td', { 'data-rotulo': 'Fecha' }, fecha(c.fecha)),
      conCliente && h('td', { 'data-rotulo': 'Cliente' }, c.cliente_id ? h('a', { href: `#/clientes/${c.cliente_id}` }, c.cliente) : c.cliente),
      h('td', { 'data-rotulo': 'Concepto' }, h('div', { class: 'nombre-cliente' }, c.concepto), (refs || c.proveedor) && h('div', { class: 'apoyo' }, [c.proveedor, refs].filter(Boolean).join(' · '))),
      h('td', { 'data-rotulo': 'Tipo' }, chip(c.tipo_nombre, 'mudo')),
      h('td', { class: 'num', 'data-rotulo': 'Importe' }, monto(c), c.moneda === 'ARS' && h('div', { class: 'apoyo' }, usd2(c.importe_usd))),
      h('td', { class: 'num', 'data-rotulo': 'USD' }, h('b', null, usd2(c.importe_usd))));
  }
  const tabla = (filas, conCliente) => h('table', { class: 'tarjetas' },
    h('thead', null, h('tr', null, ['Fecha', conCliente && 'Cliente', 'Concepto', 'Tipo', 'Importe', 'USD'].filter(Boolean).map((t, i, a) => h('th', { class: i >= a.length - 2 ? 'num' : '' }, t)))),
    h('tbody', null, filas.map((c) => fila(c, conCliente))));

  /** Lista agrupada con subtotal por grupo. `clave` y `titulo` definen cómo se agrupa. */
  function grupos(filas, clave, titulo, ordenar, conCliente) {
    const m = new Map();
    for (const f of filas) { const k = clave(f); if (!m.has(k)) m.set(k, []); m.get(k).push(f); }
    const lista = [...m.entries()].map(([k, fs]) => ({ k, fs, total: fs.reduce((s, x) => s + x.importe_usd, 0) })).sort(ordenar);
    return lista.map((g, i) => h('details', { class: 'tarjeta', open: i === 0 || lista.length <= 3 || undefined, style: 'margin-top:12px;padding:6px 8px' },
      h('summary', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:center;cursor:pointer;padding:8px;font-weight:700' }, h('span', null, titulo(g)), h('span', null, h('span', { class: 'apoyo', style: 'font-weight:400' }, `${g.fs.length} ${g.fs.length === 1 ? 'costo' : 'costos'} · `), usd2(g.total))),
      tabla(g.fs, conCliente)));
  }

  /** Pantalla general de Costos. */
  async function vistaCostos(destino) {
    const f = { desde: mesesAtras(5), hasta: mesActual(), tipo: '', q: '', agrupar: 'periodo' };
    const cuerpo = h('div');
    const desde = h('input', { type: 'month', value: f.desde, 'aria-label': 'Desde' }); const hasta = h('input', { type: 'month', value: f.hasta, 'aria-label': 'Hasta' });
    const tipo = h('select', { 'aria-label': 'Tipo de costo' }, h('option', { value: '' }, 'Todos los tipos'));
    const buscar = h('input', { type: 'search', placeholder: 'Cliente, concepto, proveedor', 'aria-label': 'Buscar' });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Agrupar por', style: 'margin:0' });
    const pintarSeg = () => vaciar(seg).append(...[['periodo', 'Por período'], ['cliente', 'Por cliente'], ['tipo', 'Por tipo'], ['ninguno', 'Lista']].map(([k, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(f.agrupar === k), onclick: () => { f.agrupar = k; pintarSeg(); pintar(); } }, t)));
    pintarSeg();
    const excel = h('a', { class: 'btn', href: '#', download: '' }, 'Descargar Excel');
    let datos = null; let tiempo;
    const query = () => { const p = new URLSearchParams(); if (f.desde) p.set('desde', f.desde); if (f.hasta) p.set('hasta', f.hasta); if (f.tipo) p.set('tipo', f.tipo); if (f.q) p.set('q', f.q); return p; };

    function pintar() {
      vaciar(cuerpo);
      if (!datos) return;
      excel.setAttribute('href', `/api/costos/excel?${query()}`);
      if (!datos.costos.length) { cuerpo.append(h('div', { class: 'tarjeta vacio', style: 'margin-top:16px' }, h('b', null, 'No hay costos en ese período'), 'Probá ampliando las fechas o sacando filtros.')); return; }
      const kpi = (r, v, n) => h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, r), h('div', { class: 'valor' }, v), n && h('div', { class: 'nota' }, n));
      const mayor = datos.por_cliente[0]; const t = datos.por_tipo[0];
      cuerpo.append(h('div', { class: 'rejilla kpis', style: 'margin:16px 0' }, kpi('Total del período', usd(datos.total_usd), 'USD'), kpi('Costos cargados', String(datos.cantidad)), mayor && kpi('Cliente que más costó', mayor.nombre, usd(mayor.usd)), t && kpi('Tipo principal', t.nombre, usd(t.usd))));
      if (datos.truncado) cuerpo.append(h('div', { class: 'error', role: 'alert' }, 'Hay más de 5.000 costos: se muestran los más recientes. Acotá las fechas para ver todo.'));
      const conCliente = true;
      if (f.agrupar === 'ninguno') cuerpo.append(h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, tabla(datos.costos, conCliente)));
      else if (f.agrupar === 'periodo') cuerpo.append(...grupos(datos.costos, (x) => x.periodo, (g) => nombreMes(g.k), (a, b) => b.k.localeCompare(a.k), conCliente));
      else if (f.agrupar === 'cliente') cuerpo.append(...grupos(datos.costos, (x) => x.cliente, (g) => g.k, (a, b) => b.total - a.total, false));
      else cuerpo.append(...grupos(datos.costos, (x) => x.tipo_nombre, (g) => g.k, (a, b) => b.total - a.total, conCliente));
    }
    async function cargar() {
      vaciar(cuerpo).append(cargando());
      try { datos = await api(`/api/costos?${query()}`); } catch (e) { if (e.message !== 'sesion') vaciar(cuerpo).append(h('div', { class: 'vacio' }, h('b', null, 'Algo salió mal'), 'No se pudieron cargar los costos.')); return; }
      if (tipo.options.length === 1 || tipo.dataset.lleno !== '1') { const previo = tipo.value; for (const t of datos.por_tipo) if (![...tipo.options].some((o) => o.value === (t.clave ?? ''))) tipo.append(h('option', { value: t.clave }, t.nombre)); tipo.value = previo; tipo.dataset.lleno = '1'; }
      pintar();
    }
    desde.addEventListener('change', () => { f.desde = desde.value; cargar(); }); hasta.addEventListener('change', () => { f.hasta = hasta.value; cargar(); });
    tipo.addEventListener('change', () => { f.tipo = tipo.value; cargar(); });
    buscar.addEventListener('input', () => { clearTimeout(tiempo); tiempo = setTimeout(() => { f.q = buscar.value.trim(); cargar(); }, 250); });
    agregar(destino, [encabezado('Costos', 'Lo que costó prestar el servicio, en USD de referencia. Se carga con la planilla y desde el sistema.', excel),
      h('div', { class: 'tarjeta herramientas', style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end' },
        h('label', null, 'Desde ', desde), h('label', null, 'Hasta ', hasta), h('label', null, 'Tipo ', tipo), h('label', null, 'Buscar ', buscar), seg), cuerpo]);
    await cargar();
  }

  /** Pestaña "Costos" de la ficha de un cliente. */
  async function pestanaCostos(clienteId) {
    const caja = h('div', null, cargando());
    let d;
    try { d = await api(`/api/costos?cliente_id=${clienteId}`); } catch { return h('div', { class: 'tarjeta vacio' }, 'No se pudieron cargar los costos.'); }
    vaciar(caja);
    if (!d.costos.length) return caja.appendChild(h('div', { class: 'tarjeta vacio' }, h('b', null, 'Sin costos cargados'), 'Todavía no hay costos asociados a este cliente.')) && caja;
    const barras = d.por_tipo.map((t) => h('li', { style: 'display:block' }, h('div', { style: 'display:flex;justify-content:space-between' }, h('span', null, t.nombre), h('b', null, usd2(t.usd))), h('div', { class: 'barrita' }, h('span', { style: `width:${Math.round((t.usd / d.total_usd) * 100)}%` }))));
    caja.append(h('div', { class: 'rejilla dos-iguales', style: 'margin-bottom:16px' },
      h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'Costo total'), h('div', { class: 'valor' }, usd(d.total_usd)), h('div', { class: 'nota' }, `${d.cantidad} costos · USD netos`)),
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Por tipo'), h('ul', { class: 'lista' }, barras))));
    caja.append(h('div', { class: 'acciones', style: 'margin-bottom:8px' }, h('a', { class: 'btn', href: `/api/costos/excel?cliente_id=${clienteId}`, download: '' }, 'Descargar Excel')));
    caja.append(...grupos(d.costos, (x) => x.periodo, (g) => nombreMes(g.k), (a, b) => b.k.localeCompare(a.k), false));
    return caja;
  }

  return { vistaCostos, pestanaCostos };
}
