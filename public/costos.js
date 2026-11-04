// Costos: detalle de lo que costó prestar el servicio. Una pantalla general (por período, agrupable por cliente o tipo)
// y la misma tabla filtrada dentro de la ficha de cada cliente.
export function crearCostos(U) {
  const { h, agregar, vaciar, api, usd, fecha, chip, cargando, encabezado, nombreMes, puede, cajon, aviso } = U;
  const usd2 = (n) => `USD ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const mesActual = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
  const mesesAtras = (n) => { const [a, m] = mesActual().split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 - n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  const monto = (c) => (c.moneda === 'ARS' ? `$ ${Number(c.importe).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : usd2(c.importe));

  const ERR = {
    fecha_futura: 'La fecha no puede ser futura.', sin_cotizacion: 'No hay cotización del dólar cargada para convertir los pesos.', cliente_invalido: 'Ese cliente no existe o no está a tu alcance.',
    cliente_requerido: 'Elegí un cliente: los costos generales solo los carga quien ve todas las cuentas.', equipo_invalido: 'Ese equipo no existe.', contrato_invalido: 'Ese contrato no es de este cliente.',
    ticket_invalido: 'Ese ticket no es de este cliente.', costo_automatico: 'Este costo salió de un remito y no se edita: si el costo del insumo estaba mal, corregilo en el insumo.', validacion: 'Revisá los datos: falta algo o hay un número inválido.',
  };
  const TIPOS = [['insumo', 'Insumos'], ['mano_de_obra', 'Mano de obra'], ['logistica', 'Logística'], ['amortizacion', 'Amortización'], ['equipo', 'Equipo'], ['otro', 'Otro']];
  const campo = (rotulo, el) => h('label', { style: 'display:grid;gap:4px' }, rotulo, el);

  /** Formulario de alta y edición en un cajón lateral. `clienteFijo` lo usa la ficha del cliente. */
  function formularioCosto({ costo = null, clienteFijo = null, alGuardar }) {
    return cajon(costo ? 'Editar costo' : 'Nuevo costo', (cerrar) => {
      const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
      const fechaIn = h('input', { type: 'date', required: true, max: hoy, value: costo?.fecha ?? hoy });
      const concepto = h('input', { type: 'text', required: true, maxlength: 200, placeholder: 'Qué se compró o hizo', value: costo?.concepto ?? '' });
      const tipo = h('select', null, TIPOS.map(([v, t]) => h('option', { value: v, selected: (costo?.tipo ?? 'insumo') === v }, t)));
      const importe = h('input', { type: 'number', required: true, min: '0.01', step: '0.01', inputmode: 'decimal', value: costo?.importe ?? '' });
      const moneda = h('select', null, [['USD', 'Dólares (USD)'], ['ARS', 'Pesos (ARS)']].map(([v, t]) => h('option', { value: v, selected: (costo?.moneda ?? 'USD') === v }, t)));
      const cliente = h('select', { disabled: !!clienteFijo }, clienteFijo ? h('option', { value: clienteFijo }, 'Este cliente') : h('option', { value: '' }, 'Cargando clientes…'));
      const equipo = h('select', null, h('option', { value: '' }, 'Ninguno')); const contrato = h('select', null, h('option', { value: '' }, 'Ninguno')); const ticket = h('select', null, h('option', { value: '' }, 'Ninguno'));
      const proveedor = h('input', { type: 'text', maxlength: 160, list: 'lista-proveedores', placeholder: 'Opcional', value: costo?.proveedor ?? '' }); const datalist = h('datalist', { id: 'lista-proveedores' });
      const error = h('div', { class: 'error oculto', role: 'alert' }); const boton = h('button', { class: 'btn btn-principal', type: 'submit' }, costo ? 'Guardar cambios' : 'Guardar costo');
      const opciones = (sel, lista, texto, actual) => { sel.replaceChildren(h('option', { value: '' }, 'Ninguno'), ...lista.map((x) => h('option', { value: x.id, selected: actual === x.id }, texto(x)))); };
      async function referencias() {
        const cid = Number(cliente.value) || null;
        const r = await api(`/api/costos/referencias${cid ? `?cliente_id=${cid}` : ''}`).catch(() => ({ proveedores: [], equipos: [], contratos: [], tickets: [] }));
        datalist.replaceChildren(...r.proveedores.map((n) => h('option', { value: n })));
        opciones(equipo, r.equipos, (x) => x.serie, costo?.equipo_id); opciones(contrato, r.contratos, (x) => x.nombre, costo?.contrato_id); opciones(ticket, r.tickets, (x) => `${x.numero} · ${x.asunto}`.slice(0, 60), costo?.ticket_id);
      }
      if (!clienteFijo) {
        api('/api/clientes?limite=100&estado=activo').then((r) => {
          cliente.replaceChildren(h('option', { value: '' }, 'General (sin cliente)'), ...r.clientes.map((c) => h('option', { value: c.id, selected: costo?.cliente_id === c.id }, c.nombre_comercial || c.razon_social)));
          return referencias();
        }).catch(() => {});
        cliente.addEventListener('change', referencias);
      } else referencias();
      const form = h('form', { class: 'formulario', style: 'display:grid;gap:14px', onsubmit: async (ev) => {
        ev.preventDefault(); error.classList.add('oculto'); boton.disabled = true;
        const cuerpo = { fecha: fechaIn.value, concepto: concepto.value.trim(), tipo: tipo.value, importe: Number(importe.value), moneda: moneda.value, cliente_id: Number(cliente.value) || null,
          equipo_id: Number(equipo.value) || null, contrato_id: Number(contrato.value) || null, ticket_id: Number(ticket.value) || null, proveedor: proveedor.value.trim() || null };
        try { await api(costo ? `/api/costos/${costo.id}` : '/api/costos', { metodo: costo ? 'PATCH' : 'POST', cuerpo }); cerrar(); aviso(costo ? 'Costo actualizado' : 'Costo guardado'); alGuardar(); }
        catch (e) { if (e.message === 'sesion') return; error.textContent = ERR[e.datos?.error] ?? 'No se pudo guardar. Probá de nuevo.'; error.classList.remove('oculto'); boton.disabled = false; }
      } }, error, campo('Fecha', fechaIn), campo('Concepto', concepto), h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px' }, campo('Importe', importe), campo('Moneda', moneda)),
      campo('Tipo', tipo), campo('Cliente', cliente), h('p', { class: 'apoyo', style: 'margin:0' }, 'Si no elegís cliente, el costo queda como general del negocio.'),
      campo('Equipo', equipo), campo('Contrato', contrato), campo('Ticket', ticket), campo('Proveedor', proveedor), datalist, boton);
      return form;
    });
  }

  /** Quitar un costo, con confirmación. */
  async function pasarAAccesorio(c, alHecho) {
    if (!window.confirm(`¿Pasar este costo a accesorio del equipo ${c.equipo}?\n\n${c.concepto} · ${usd2(c.importe_usd)}\n\nSe suma al costo del equipo (se amortiza con él) y deja de contarse como insumo del cliente. Queda registrado en la auditoría.`)) return;
    try { await api(`/api/costos/${c.id}/pasar-a-accesorio`, { metodo: 'POST' }); aviso('Pasó a accesorio del equipo'); alHecho(); } catch (e) { if (e.message !== 'sesion') aviso({ equipo_sin_costo: 'Primero cargá el costo del equipo en su ficha.', moneda_distinta: 'El costo y el equipo están en monedas distintas.', sin_cotizacion: 'No hay cotización del dólar cargada.' }[e.datos?.error] ?? 'No se pudo pasar a accesorio.'); }
  }

  async function borrar(c, alBorrar) {
    if (!window.confirm(`¿Eliminar este costo?\n\n${c.concepto} · ${usd2(c.importe_usd)}\n\nDeja de sumar en el negocio del cliente. Queda registrado en la auditoría.`)) return;
    try { await api(`/api/costos/${c.id}`, { metodo: 'DELETE' }); aviso('Costo eliminado'); alBorrar(); } catch (e) { if (e.message !== 'sesion') aviso(ERR[e.datos?.error] ?? 'No se pudo eliminar.'); }
  }

  /** Una fila del detalle. `conCliente` agrega la columna cuando la lista mezcla clientes. */
  function fila(c, conCliente, recargar) {
    const refs = [c.equipo && `Equipo ${c.equipo}`, c.ticket && `Ticket ${c.ticket}`, c.contrato].filter(Boolean).join(' · ');
    return h('tr', null,
      h('td', { 'data-rotulo': 'Fecha' }, fecha(c.fecha)),
      conCliente && h('td', { 'data-rotulo': 'Cliente' }, c.cliente_id ? h('a', { href: `#/clientes/${c.cliente_id}` }, c.cliente) : c.cliente),
      h('td', { 'data-rotulo': 'Concepto' }, h('div', { class: 'nombre-cliente' }, c.concepto), (refs || c.proveedor) && h('div', { class: 'apoyo' }, [c.proveedor, refs].filter(Boolean).join(' · '))),
      h('td', { 'data-rotulo': 'Tipo' }, chip(c.tipo_nombre, 'mudo')),
      h('td', { class: 'num', 'data-rotulo': 'Importe' }, monto(c), c.moneda === 'ARS' && h('div', { class: 'apoyo' }, usd2(c.importe_usd))),
      h('td', { class: 'num', 'data-rotulo': 'USD' }, h('b', null, usd2(c.importe_usd))),
      puede('costos.cargar') && h('td', { class: 'acciones-fila', 'data-rotulo': 'Acciones' }, ...(() => {
        const acc = c.equipo_id && c.origen !== 'amortizacion' && ['insumo', 'amortizacion', 'equipo'].includes(c.tipo) ? [' ', h('button', { class: 'btn', type: 'button', title: 'Suma este costo al del equipo y se amortiza con él', onclick: () => pasarAAccesorio(c, recargar) }, 'Es un accesorio')] : [];
        if (c.automatico) return [h('span', { class: 'apoyo', title: c.origen === 'amortizacion' ? 'Se calcula solo desde el costo del equipo' : 'Salió de un remito de insumos' }, c.origen === 'amortizacion' ? 'Automático' : 'Del remito'), ...acc];
        return [h('button', { class: 'btn', type: 'button', onclick: () => formularioCosto({ costo: c, clienteFijo: null, alGuardar: recargar }) }, 'Editar'), ' ', h('button', { class: 'btn', type: 'button', onclick: () => borrar(c, recargar) }, 'Eliminar'), ...acc];
      })()));
  }
  const tabla = (filas, conCliente, recargar) => h('table', { class: 'tarjetas' },
    h('thead', null, h('tr', null, [['Fecha'], conCliente && ['Cliente'], ['Concepto'], ['Tipo'], ['Importe', true], ['USD', true], puede('costos.cargar') && ['']].filter(Boolean).map(([t, num]) => h('th', { class: num ? 'num' : '' }, t)))),
    h('tbody', null, filas.map((c) => fila(c, conCliente, recargar))));

  /** Lista agrupada con subtotal por grupo. `clave` y `titulo` definen cómo se agrupa. */
  function grupos(filas, clave, titulo, ordenar, conCliente, recargar) {
    const m = new Map();
    for (const f of filas) { const k = clave(f); if (!m.has(k)) m.set(k, []); m.get(k).push(f); }
    const lista = [...m.entries()].map(([k, fs]) => ({ k, fs, total: fs.reduce((s, x) => s + x.importe_usd, 0) })).sort(ordenar);
    return lista.map((g, i) => h('details', { class: 'tarjeta', open: i === 0 || lista.length <= 3 || undefined, style: 'margin-top:12px;padding:6px 8px' },
      h('summary', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:center;cursor:pointer;padding:8px;font-weight:700' }, h('span', null, titulo(g)), h('span', null, h('span', { class: 'apoyo', style: 'font-weight:400' }, `${g.fs.length} ${g.fs.length === 1 ? 'costo' : 'costos'} · `), usd2(g.total))),
      tabla(g.fs, conCliente, recargar)));
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
      if (f.agrupar === 'ninguno') cuerpo.append(h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, tabla(datos.costos, conCliente, cargar)));
      else if (f.agrupar === 'periodo') cuerpo.append(...grupos(datos.costos, (x) => x.periodo, (g) => nombreMes(g.k), (a, b) => b.k.localeCompare(a.k), conCliente, cargar));
      else if (f.agrupar === 'cliente') cuerpo.append(...grupos(datos.costos, (x) => x.cliente, (g) => g.k, (a, b) => b.total - a.total, false, cargar));
      else cuerpo.append(...grupos(datos.costos, (x) => x.tipo_nombre, (g) => g.k, (a, b) => b.total - a.total, conCliente, cargar));
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
    agregar(destino, [encabezado('Costos', 'Lo que costó prestar el servicio, en USD de referencia. Los remitos de insumos suman solos al cliente.', h('div', { class: 'acciones' }, puede('costos.cargar') && h('button', { class: 'btn btn-principal', type: 'button', onclick: () => formularioCosto({ alGuardar: cargar }) }, '+ Nuevo costo'), excel)),
      h('div', { class: 'tarjeta herramientas', style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end' },
        h('label', null, 'Desde ', desde), h('label', null, 'Hasta ', hasta), h('label', null, 'Tipo ', tipo), h('label', null, 'Buscar ', buscar), seg), cuerpo]);
    await cargar();
  }

  /** Pestaña "Costos" de la ficha de un cliente. */
  async function pestanaCostos(clienteId) {
    const caja = h('div');
    const nuevo = puede('costos.cargar') && h('button', { class: 'btn btn-principal', type: 'button', onclick: () => formularioCosto({ clienteFijo: clienteId, alGuardar: recargar }) }, '+ Nuevo costo');
    async function recargar() { const n = await pestanaCostos(clienteId); caja.replaceWith(n); }
    let d;
    try { d = await api(`/api/costos?cliente_id=${clienteId}`); } catch { return h('div', { class: 'tarjeta vacio' }, 'No se pudieron cargar los costos.'); }
    if (!d.costos.length) { caja.append(nuevo && h('div', { class: 'acciones', style: 'margin-bottom:12px' }, nuevo), h('div', { class: 'tarjeta vacio' }, h('b', null, 'Sin costos cargados'), 'Todavía no hay costos asociados a este cliente. Los remitos de insumos y lo que cargues acá aparecen en esta lista.')); return caja; }
    const barras = d.por_tipo.map((t) => h('li', { style: 'display:block' }, h('div', { style: 'display:flex;justify-content:space-between' }, h('span', null, t.nombre), h('b', null, usd2(t.usd))), h('div', { class: 'barrita' }, h('span', { style: `width:${Math.round((t.usd / d.total_usd) * 100)}%` }))));
    caja.append(h('div', { class: 'rejilla dos-iguales', style: 'margin-bottom:16px' },
      h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'Costo total'), h('div', { class: 'valor' }, usd(d.total_usd)), h('div', { class: 'nota' }, `${d.cantidad} ${d.cantidad === 1 ? 'costo' : 'costos'} · USD netos`)),
      h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Por tipo'), h('ul', { class: 'lista' }, barras))));
    caja.append(h('div', { class: 'acciones', style: 'margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap' }, nuevo, h('a', { class: 'btn', href: `/api/costos/excel?cliente_id=${clienteId}`, download: '' }, 'Descargar Excel')));
    caja.append(...grupos(d.costos, (x) => x.periodo, (g) => nombreMes(g.k), (a, b) => b.k.localeCompare(a.k), false, recargar));
    return caja;
  }

  return { vistaCostos, pestanaCostos };
}
