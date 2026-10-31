// Contratos: de acá sale todo lo que se factura. Lista, ficha, alta y edición.
export function crearContratos(U) {
  const { h, agregar, vaciar, api, usd, usd2, monto, fecha, chip, puede, cargando, encabezado, estado, proximoAjuste, panelAjuste, plazoContrato } = U;
  const ESTADO = { borrador: ['Borrador', 'mudo'], vigente: ['Vigente', 'ok'], vencido: ['Vencido', 'aviso'], rescindido: ['Rescindido', 'malo'] };
  const MOTIVO = { alta: 'Alta', ajuste_ipc: 'Ajuste por IPC', renegociacion: 'Renegociación', sin_facturar: 'Sin facturar', otro: 'Otro' };
  const ERR = {
    sede_invalida: 'Esa sede no es de este cliente.', entidad_invalida: 'Esa entidad facturante no está activa.', abono_en_cero: 'Un contrato que se factura necesita un abono mayor a cero. Si es sin cargo, marcá “No se factura”.',
    cliente_no_encontrado: 'No encontramos ese cliente.', moneda_con_facturas: 'No se puede cambiar la moneda: el contrato ya tiene facturas.', moneda_con_historial: 'No se puede cambiar la moneda: ya tiene cambios de precio.',
    ya_hay_condicion_posterior: 'Ya hay precios desde esa fecha o una posterior. Elegí una fecha más nueva.', contrato_cerrado: 'El contrato ya está cerrado.', equipos_instalados: 'Tiene equipos instalados. Retiralos primero desde Equipos.',
    motivo_requerido: 'Contanos el motivo de la rescisión.', sin_condiciones: 'Faltan los precios del contrato.', solo_borrador_se_activa: 'Solo un borrador se puede activar.',
  };
  const msg = (e) => ERR[e.datos?.error] ?? 'No se pudo guardar. Revisá los datos.';
  const hoyISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const sumarMeses = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
  const chipEstado = (e) => chip(...(ESTADO[e] ?? [e, 'mudo']));
  const { cajon, aviso } = U;
  const campo = (rot, el, ayuda, id) => h('div', { class: 'campo' }, h('label', { for: id }, rot), el, ayuda && h('div', { class: 'apoyo' }, ayuda));
  const nIn = (id, v, o = {}) => h('input', { id, type: 'number', inputmode: 'decimal', min: '0', step: o.step ?? 'any', value: v ?? '', placeholder: o.ph ?? null });
  const mon = (c) => (c === 'ARS' ? 'pesos' : 'dólares');

  /* ---------- lista ---------- */
  async function vistaContratos(destino) {
    const f = { estado: 'vigente', q: '', vencen: '' };
    const zona = h('div');
    const buscar = h('input', { type: 'search', placeholder: 'Buscar cliente o contrato', 'aria-label': 'Buscar' });
    const sel = h('select', { 'aria-label': 'Estado' }, [['', 'Todos los estados'], ['vigente', 'Vigentes'], ['borrador', 'Borradores'], ['vencido', 'Vencidos'], ['rescindido', 'Rescindidos']].map(([v, t]) => h('option', { value: v, selected: v === f.estado }, t)));
    const ven = h('select', { 'aria-label': 'Vencimiento' }, [['', 'Cualquier vencimiento'], ['90', 'Vencen en 90 días'], ['60', 'Vencen en 60 días'], ['30', 'Vencen en 30 días']].map(([v, t]) => h('option', { value: v }, t)));
    let t0;
    async function cargar() {
      vaciar(zona).append(cargando());
      const q = new URLSearchParams(); if (sel.value) q.set('estado', sel.value); if (buscar.value.trim()) q.set('q', buscar.value.trim()); if (ven.value) q.set('vencen', ven.value);
      const { items } = await api(`/api/contratos?${q}`);
      if (!items.length) { vaciar(zona).append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No hay contratos con ese filtro'), puede('contratos.editar') ? h('a', { href: '#/contratos/nuevo' }, 'Crear un contrato') : null)); return; }
      const verMonto = items.some((c) => c.monto_mensual != null);
      vaciar(zona).append(h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, h('table', { class: 'tarjetas' },
        h('thead', null, h('tr', null, ['Cliente', 'Contrato', 'Estado', verMonto && 'Abono mensual', 'Equipos', 'Vence'].filter(Boolean).map((t, k) => h('th', { class: t === 'Abono mensual' || t === 'Equipos' ? 'num' : '' }, t)))),
        h('tbody', null, items.map((c) => h('tr', { class: 'fila', tabindex: '0', onclick: () => { location.hash = `#/contratos/${c.id}`; }, onkeydown: (ev) => { if (ev.key === 'Enter') location.hash = `#/contratos/${c.id}`; } },
          h('td', { 'data-rotulo': 'Cliente' }, h('span', { class: 'nombre-cliente' }, c.cliente)), h('td', { 'data-rotulo': 'Contrato' }, c.nombre, h('div', { class: 'apoyo' }, `En ${mon(c.moneda)}`)), h('td', { 'data-rotulo': 'Estado' }, chipEstado(c.estado), c.facturable === false && [' ', chip('No se factura', 'aviso')]),
          verMonto && h('td', { class: 'num', 'data-rotulo': 'Abono mensual' }, c.monto_mensual == null ? '—' : monto(c.monto_mensual, c.moneda)), h('td', { class: 'num', 'data-rotulo': 'Equipos' }, String(c.equipos)),
          h('td', { 'data-rotulo': 'Vence' }, c.fin ? [fecha(c.fin), c.estado === 'vigente' && c.dias_para_fin <= 90 && [' ', chip(c.dias_para_fin < 0 ? 'Vencido' : `En ${c.dias_para_fin} d`, c.dias_para_fin < 30 ? 'malo' : 'aviso')]] : h('span', { class: 'apoyo' }, 'Sin fecha de fin'))))))));
    }
    [sel, ven].forEach((e) => e.addEventListener('change', cargar)); buscar.addEventListener('input', () => { clearTimeout(t0); t0 = setTimeout(cargar, 250); });
    agregar(destino, [encabezado('Contratos', 'De acá sale todo lo que se factura.', puede('contratos.editar') && h('div', { class: 'acciones' }, h('a', { class: 'btn btn-principal', href: '#/contratos/nuevo' }, '+ Nuevo contrato'))),
      h('div', { class: 'herramientas' }, buscar, sel, ven), zona]);
    await cargar();
  }

  /* ---------- alta ---------- */
  async function vistaNuevoContrato(destino, clienteInicial) {
    const [cl, ent] = await Promise.all([api('/api/clientes?limite=100'), api('/api/entidades-facturantes')]); const cot = {};
    const previo = estado.nuevoContrato; estado.nuevoContrato = null; let moneda = 'USD'; let estadoNuevo = 'vigente';
    const cliente = h('select', { id: 'k-cli' }, h('option', { value: '' }, 'Elegí un cliente'), cl.clientes.map((c) => h('option', { value: c.id, selected: String(c.id) === String(clienteInicial) }, c.nombre_comercial || c.razon_social)));
    const sede = h('select', { id: 'k-sede' }, h('option', { value: '' }, 'Sin sede específica'));
    const nombre = h('input', { id: 'k-nom', type: 'text', maxlength: '160', placeholder: 'Ej: Alquiler multifunción, oficina central', value: previo ? `Alquiler ${previo.empresa}` : '' });
    const ini = h('input', { id: 'k-ini', type: 'date', value: hoyISO() }); const dur = nIn('k-dur', '', { step: '1', ph: 'Sin fecha de fin' });
    const entidad = h('select', { id: 'k-ent' }, h('option', { value: '' }, 'La habitual'), ent.items.map((e) => h('option', { value: e.id }, e.razon_social)));
    const plazo = nIn('k-plz', '', { step: '1', ph: 'Usa el general' }); const notas = h('textarea', { id: 'k-not', maxlength: '2000', placeholder: 'Condiciones especiales, quién firmó, qué se acordó…' });
    const abono = nIn('k-ab', previo?.abono ?? '', { ph: '0' }); const fn = nIn('k-fn', 0, { step: '1' }); const fc = nIn('k-fc', 0, { step: '1' }); const en = nIn('k-en', 0, { step: '0.0001' }); const ec = nIn('k-ec', 0, { step: '0.0001' });
    const noFact = h('input', { id: 'k-nf', type: 'checkbox' });
    const err = h('div', { class: 'error oculto', role: 'alert' }); const resumen = h('div', { class: 'bloque resumen-contrato' });
    const segMoneda = h('div', { class: 'seg', role: 'group', 'aria-label': 'Moneda' }); const segEstado = h('div', { class: 'seg', role: 'group', 'aria-label': 'Estado inicial' });
    const pintarSeg = () => {
      vaciar(segMoneda).append(...[['USD', 'Dólares'], ['ARS', 'Pesos']].map(([v, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(moneda === v), onclick: () => { moneda = v; pintarSeg(); pintarResumen(); } }, t)));
      vaciar(segEstado).append(...[['vigente', 'Vigente: ya se factura'], ['borrador', 'Borrador: todavía no']].map(([v, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(estadoNuevo === v), onclick: () => { estadoNuevo = v; pintarSeg(); } }, t)));
    };
    async function cargarSedes() {
      vaciar(sede).append(h('option', { value: '' }, 'Sin sede específica'));
      if (!cliente.value) return; const d = await api(`/api/clientes/${cliente.value}`).catch(() => null); (d?.sedes ?? []).forEach((s) => sede.append(h('option', { value: s.id }, s.nombre)));
    }
    function pintarResumen() {
      const a = Number(abono.value) || 0; const fin = ini.value && dur.value ? sumarMeses(ini.value, Number(dur.value)) : null; const v = Number(cot.valor) || null;
      vaciar(resumen).append(h('h3', null, 'Cómo queda'),
        h('div', { class: 'hechos', style: 'grid-template-columns:1fr 1fr;margin-top:0' }, h('div', null, 'Abono mensual', h('b', null, monto(a, moneda))), h('div', null, 'Referencia en dólares', h('b', null, moneda === 'USD' ? usd2(a) : 'Se calcula al guardar')),
          h('div', null, 'Empieza', h('b', null, fecha(ini.value))), h('div', null, 'Termina', h('b', null, fin ? fecha(fin) : 'Sin fecha de fin'))),
        h('p', { class: 'apoyo', style: 'margin:12px 0 0' }, noFact.checked ? 'Se presta el servicio sin facturar: no entra en la facturación del mes.' : 'Cuando esté vigente y tenga equipos instalados, entra en la liquidación del mes.'));
    }
    cliente.addEventListener('change', cargarSedes); [abono, ini, dur, noFact].forEach((e) => e.addEventListener('input', pintarResumen)); noFact.addEventListener('change', pintarResumen);
    const guardar = h('button', { class: 'btn btn-principal', type: 'button' }, 'Crear contrato');
    guardar.addEventListener('click', async () => {
      err.classList.add('oculto');
      const falta = !cliente.value ? 'Elegí el cliente.' : nombre.value.trim().length < 2 ? 'Poné un nombre al contrato.' : !ini.value ? 'Falta la fecha de inicio.' : null;
      if (falta) { err.textContent = falta; err.classList.remove('oculto'); return; }
      guardar.disabled = true;
      try {
        const r = await api('/api/contratos', { metodo: 'POST', cuerpo: { cliente_id: Number(cliente.value), nombre: nombre.value.trim(), sede_id: sede.value ? Number(sede.value) : null, moneda, estado: estadoNuevo, fecha_inicio: ini.value,
          duracion_meses: dur.value ? Number(dur.value) : null, entidad_facturante_id: entidad.value ? Number(entidad.value) : null, plazo_pago_dias: plazo.value !== '' ? Number(plazo.value) : null, notas: notas.value.trim() || null,
          precios: { monto_mensual: Number(abono.value) || 0, franquicia_negro: Number(fn.value) || 0, franquicia_color: Number(fc.value) || 0, excedente_negro: Number(en.value) || 0, excedente_color: Number(ec.value) || 0, facturable: !noFact.checked } } });
        location.hash = `#/contratos/${r.id}`;
      } catch (e) { err.textContent = e.datos?.error ? msg(e) : 'Revisá los datos: hay algún valor fuera de rango.'; err.classList.remove('oculto'); guardar.disabled = false; }
    });
    pintarSeg(); pintarResumen(); await cargarSedes();
    agregar(destino, [h('a', { href: '#/contratos', class: 'apoyo' }, '← Contratos'), encabezado('Nuevo contrato', 'Cargá todo lo acordado: de acá sale la facturación.'),
      previo && h('div', { class: 'alerta-item aviso', style: 'margin-bottom:16px' }, `¡Cerraste con ${previo.empresa}! Cargá el contrato acordado${previo.abono ? ` (el abono estimado era USD ${previo.abono}: confirmalo)` : ''}. Si todavía no tenés los datos, volvé a la ficha del cliente.`, h('a', { href: `#/clientes/${clienteInicial}` }, 'Ver cliente')),
      h('div', { class: 'rejilla dos' },
        h('div', null,
          h('div', { class: 'tarjeta' }, h('h2', null, 'Quién y qué'), campo('Cliente', cliente, null, 'k-cli'), campo('Nombre del contrato', nombre, null, 'k-nom'), campo('Sede donde se presta el servicio', sede, null, 'k-sede'),
            h('div', { class: 'campo' }, h('label', null, 'Moneda del abono'), segMoneda)),
          h('div', { class: 'tarjeta' }, h('h2', null, 'Vigencia'), h('div', { class: 'dos-col' }, campo('Fecha de inicio', ini, null, 'k-ini'), campo('Duración en meses', dur, 'Vacío si no tiene fecha de fin.', 'k-dur')),
            h('div', { class: 'rapidos chicos' }, [12, 24, 36].map((n) => h('button', { type: 'button', class: 'rapido', onclick: () => { dur.value = n; pintarResumen(); } }, `${n} meses`)))),
          h('div', { class: 'tarjeta' }, h('h2', null, 'Precios'), campo('Abono mensual (en la moneda elegida)', abono, null, 'k-ab'),
            h('div', { class: 'dos-col' }, campo('Páginas incluidas en negro', fn, 'Franquicia mensual.', 'k-fn'), campo('Páginas incluidas en color', fc, null, 'k-fc')),
            h('div', { class: 'dos-col' }, campo('Excedente por página en negro', en, 'Lo que se cobra al pasarse.', 'k-en'), campo('Excedente por página en color', ec, null, 'k-ec')),
            h('label', { class: 'interruptor', for: 'k-nf' }, noFact, h('span', null, 'No se factura (se presta el servicio sin cargo)'))),
          h('div', { class: 'tarjeta' }, h('h2', null, 'Facturación'), h('div', { class: 'dos-col' }, campo('Entidad que factura', entidad, null, 'k-ent'), campo('Plazo de pago (días)', plazo, 'Desde la emisión de la factura. Vacío usa el general.', 'k-plz')), campo('Notas', notas, null, 'k-not')),
          h('div', { class: 'tarjeta' }, h('h2', null, 'Estado inicial'), segEstado, h('p', { class: 'apoyo', style: 'margin:0' }, 'Un borrador no se factura. Podés activarlo cuando esté todo listo.')),
          err, h('div', { class: 'acciones' }, guardar, h('a', { class: 'btn', href: '#/contratos' }, 'Cancelar'))),
        h('div', null, resumen, h('div', { class: 'bloque', style: 'margin-top:16px' }, h('h3', null, 'Después de crearlo'), h('p', { class: 'apoyo', style: 'margin:0' }, 'Instalá los equipos desde Equipos para que se tomen sus contadores. En la ficha del contrato ves qué falta para facturar.'))))]);
  }

  /* ---------- ficha ---------- */
  async function vistaContrato(destino, id) {
    const d = await api(`/api/contratos/${id}`).catch((e) => { if (e.estado === 404) return null; throw e; });
    if (!d) { destino.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos ese contrato'), h('a', { href: '#/contratos' }, 'Volver a contratos'))); return; }
    const c = d.contrato; const editable = puede('contratos.editar'); const abierto = c.estado === 'vigente' || c.estado === 'borrador';
    const vigente = d.condiciones.find((x) => !x.vigente_hasta); const listos = d.checklist.filter((x) => x.ok).length;
    const recargar = () => U.navegar();
    const acciones = h('div', { class: 'acciones' },
      editable && h('button', { class: 'btn', type: 'button', onclick: () => cajon('Editar datos', (x) => formDatos(d, x, recargar)) }, 'Editar datos'),
      editable && abierto && puede('importes.ver') && h('button', { class: 'btn', type: 'button', onclick: () => cajon('Cambiar precios', (x) => formPrecios(d, x, recargar)) }, 'Cambiar precios'),
      editable && c.estado === 'borrador' && h('button', { class: 'btn btn-principal', type: 'button', onclick: async (ev) => { ev.target.disabled = true; try { await api(`/api/contratos/${id}/estado`, { metodo: 'POST', cuerpo: { estado: 'vigente' } }); aviso('Contrato vigente'); recargar(); } catch (e) { aviso(msg(e)); ev.target.disabled = false; } } }, 'Activar contrato'),
      editable && c.estado === 'vigente' && h('button', { class: 'btn', type: 'button', onclick: () => cajon('Cerrar contrato', (x) => formCierre(d, x, recargar)) }, 'Cerrar contrato'));
    const fila = (k, v) => h('div', null, h('dt', null, k), h('dd', null, v ?? '—'));
    agregar(destino, [h('a', { href: '#/contratos', class: 'apoyo' }, '← Contratos'),
      encabezado(c.nombre, h('span', null, h('a', { href: `#/clientes/${d.cliente.id}` }, d.cliente.nombre_comercial || d.cliente.razon_social), ` · en ${mon(c.moneda)}`), h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, chipEstado(c.estado), acciones)),
      h('div', { class: 'rejilla dos' },
        h('div', null,
          h('div', { class: 'tarjeta' }, h('h2', null, c.estado === 'vigente' ? `Listo para facturar: ${listos} de ${d.checklist.length}` : 'Para poder facturar'),
            h('ul', { class: 'lista checklist' }, d.checklist.map((x) => h('li', { class: x.ok ? 'ok' : 'falta' }, h('span', { class: 'marca-chk', 'aria-hidden': 'true' }, x.ok ? '✓' : '!'), h('div', null, h('b', null, x.texto), !x.ok && h('div', { class: 'apoyo' }, x.ayuda)))))),
          puede('importes.ver') && h('div', { class: 'tarjeta' }, h('h2', null, 'Precios'),
            c.moneda === 'ARS' && c.estado === 'vigente' && vigente && proximoAjuste({ ...c, condiciones: d.condiciones }),
            puede('contratos.editar') && puede('importes.ver') && c.moneda === 'ARS' && c.estado === 'vigente' && vigente && panelAjuste({ ...c, condiciones: d.condiciones }),
            d.condiciones.map((x) => h('div', { class: `linea ${x.vigente_hasta ? '' : 'vigente'}` },
              h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, h('b', null, monto(x.monto_mensual, c.moneda), ' / mes'), chip(MOTIVO[x.motivo] ?? x.motivo, 'info'), !x.facturable && chip('No se factura', 'aviso'), x.ajuste_pct != null && chip(`${x.ajuste_pct}%`, 'mudo')),
              h('div', { class: 'apoyo' }, `${fecha(x.vigente_desde)} → ${x.vigente_hasta ? fecha(x.vigente_hasta) : 'hoy'}`),
              h('div', { class: 'apoyo' }, `Incluye ${x.franquicia_negro} en negro y ${x.franquicia_color} en color · excedente ${x.excedente_negro} y ${x.excedente_color} por página`), x.notas && h('div', { class: 'apoyo' }, x.notas))))),
        h('div', null,
          h('div', { class: 'tarjeta' }, h('h2', null, 'Datos'), h('dl', { class: 'datos', style: 'margin:0;grid-template-columns:1fr' },
            fila('Cliente', h('a', { href: `#/clientes/${d.cliente.id}` }, d.cliente.nombre_comercial || d.cliente.razon_social)), fila('Sede', d.sede?.nombre), fila('Empieza', fecha(c.fecha_inicio)),
            fila('Termina', c.fin ? [fecha(c.fin), c.estado === 'vigente' && c.dias_para_fin <= 90 && [' ', chip(c.dias_para_fin < 0 ? 'Vencido' : `En ${c.dias_para_fin} días`, c.dias_para_fin < 30 ? 'malo' : 'aviso')]] : 'Sin fecha de fin'),
            fila('Factura', d.entidad?.razon_social), fila('Facturas emitidas', String(d.facturas)))),
          h('div', { class: 'tarjeta' }, h('h2', null, 'Plazo de pago'), plazoContrato(c), h('p', { class: 'apoyo', style: 'margin:0' }, 'Desde la emisión de cada factura corre este plazo; después entra al semáforo de Cobranzas.')),
          h('div', { class: 'tarjeta' }, h('h2', null, `Equipos instalados (${d.equipos.length})`), d.equipos.length ? h('ul', { class: 'lista' }, d.equipos.map((e) => h('li', null, h('div', null, h('a', { href: `#/equipos/${e.id}` }, h('b', null, `${e.marca} ${e.modelo}`)), h('div', { class: 'apoyo' }, `${e.numero_serie}${e.sede ? ` · ${e.sede}` : ''}`)), chip(e.tipo === 'color' ? 'Color' : 'Monocromo', 'mudo'))))
            : h('p', { class: 'apoyo' }, 'Todavía no hay equipos. Instalalos desde Equipos para que entren en la liquidación.'), puede('equipos.editar') && h('a', { class: 'btn btn-chico', href: '#/equipos' }, 'Ir a equipos'))),
      c.notas && h('div', { class: 'tarjeta' }, h('h2', null, 'Notas'), h('p', { style: 'white-space:pre-line;margin:0' }, c.notas)))]);
  }

  function formDatos(d, cerrar, alGuardar) {
    const c = d.contrato; const nombre = h('input', { id: 'e-nom', type: 'text', value: c.nombre, maxlength: '160' }); const dur = nIn('e-dur', c.duracion_meses ?? '', { step: '1', ph: 'Sin fecha de fin' });
    const ini = h('input', { id: 'e-ini', type: 'date', value: c.fecha_inicio }); const plazo = nIn('e-plz', c.plazo_pago_dias ?? '', { step: '1', ph: 'Usa el general' }); const notas = h('textarea', { id: 'e-not', maxlength: '2000' }); notas.value = c.notas ?? '';
    const sede = h('select', { id: 'e-sede' }, h('option', { value: '' }, 'Sin sede específica')); const entidad = h('select', { id: 'e-ent' }, h('option', { value: '' }, 'Sin entidad'));
    const moneda = h('select', { id: 'e-mon' }, [['USD', 'Dólares'], ['ARS', 'Pesos']].map(([v, t]) => h('option', { value: v, selected: v === c.moneda }, t)));
    api(`/api/clientes/${c.cliente_id}`).then((x) => (x.sedes ?? []).forEach((s) => sede.append(h('option', { value: s.id, selected: s.id === c.sede_id }, s.nombre))));
    api('/api/entidades-facturantes').then((x) => x.items.forEach((e) => entidad.append(h('option', { value: e.id, selected: e.id === c.entidad_facturante_id }, e.razon_social))));
    const err = h('div', { class: 'error oculto', role: 'alert' }); const ok = h('button', { class: 'btn btn-principal', type: 'button' }, 'Guardar cambios');
    ok.addEventListener('click', async () => {
      ok.disabled = true; err.classList.add('oculto');
      try { await api(`/api/contratos/${c.id}`, { metodo: 'PATCH', cuerpo: { nombre: nombre.value.trim(), sede_id: sede.value ? Number(sede.value) : null, fecha_inicio: ini.value, duracion_meses: dur.value ? Number(dur.value) : null, entidad_facturante_id: entidad.value ? Number(entidad.value) : null,
        plazo_pago_dias: plazo.value !== '' ? Number(plazo.value) : null, notas: notas.value.trim() || null, moneda: moneda.value } }); cerrar(); aviso('Cambios guardados'); alGuardar(); }
      catch (e) { err.textContent = e.datos?.error ? msg(e) : 'Revisá los datos.'; err.classList.remove('oculto'); ok.disabled = false; }
    });
    return h('div', null, campo('Nombre', nombre, null, 'e-nom'), campo('Sede', sede, null, 'e-sede'), h('div', { class: 'dos-col' }, campo('Fecha de inicio', ini, null, 'e-ini'), campo('Duración (meses)', dur, null, 'e-dur')),
      campo('Entidad que factura', entidad, null, 'e-ent'), campo('Plazo de pago (días)', plazo, null, 'e-plz'), campo('Moneda', moneda, 'Solo se puede cambiar si todavía no tiene facturas ni cambios de precio.', 'e-mon'), campo('Notas', notas, null, 'e-not'), err, ok);
  }

  function formPrecios(d, cerrar, alGuardar) {
    const c = d.contrato; const v = d.condiciones.find((x) => !x.vigente_hasta) ?? {};
    const desde = h('input', { id: 'p-des', type: 'date', value: hoyISO(), min: v.vigente_desde ? new Date(Date.parse(v.vigente_desde) + 86400000).toISOString().slice(0, 10) : null });
    const ab = nIn('p-ab', v.monto_mensual ?? ''); const fn = nIn('p-fn', v.franquicia_negro ?? 0, { step: '1' }); const fc = nIn('p-fc', v.franquicia_color ?? 0, { step: '1' }); const en = nIn('p-en', v.excedente_negro ?? 0, { step: '0.0001' }); const ec = nIn('p-ec', v.excedente_color ?? 0, { step: '0.0001' });
    const nf = h('input', { id: 'p-nf', type: 'checkbox', checked: v.facturable === false }); const notas = h('input', { id: 'p-not', type: 'text', maxlength: '255', placeholder: 'Qué se acordó y con quién' });
    const err = h('div', { class: 'error oculto', role: 'alert' }); const ok = h('button', { class: 'btn btn-principal', type: 'button' }, 'Guardar nuevos precios');
    ok.addEventListener('click', async () => {
      ok.disabled = true; err.classList.add('oculto');
      try { await api(`/api/contratos/${c.id}/condiciones`, { metodo: 'POST', cuerpo: { vigente_desde: desde.value, monto_mensual: Number(ab.value) || 0, franquicia_negro: Number(fn.value) || 0, franquicia_color: Number(fc.value) || 0, excedente_negro: Number(en.value) || 0, excedente_color: Number(ec.value) || 0, facturable: !nf.checked, motivo: 'renegociacion', notas: notas.value.trim() || undefined } }); cerrar(); aviso('Precios actualizados'); alGuardar(); }
      catch (e) { err.textContent = e.datos?.error ? msg(e) : 'Revisá los datos.'; err.classList.remove('oculto'); ok.disabled = false; }
    });
    return h('div', null, h('p', { class: 'apoyo', style: 'margin-top:0' }, 'Los precios anteriores se conservan: la condición actual se cierra el día antes de la fecha que elijas.'), campo('Rigen desde', desde, null, 'p-des'), campo(`Abono mensual (en ${mon(c.moneda)})`, ab, null, 'p-ab'),
      h('div', { class: 'dos-col' }, campo('Incluidas en negro', fn, null, 'p-fn'), campo('Incluidas en color', fc, null, 'p-fc')), h('div', { class: 'dos-col' }, campo('Excedente en negro', en, null, 'p-en'), campo('Excedente en color', ec, null, 'p-ec')),
      h('label', { class: 'interruptor', for: 'p-nf' }, nf, h('span', null, 'No se factura')), campo('Nota', notas, null, 'p-not'), err, ok);
  }

  function formCierre(d, cerrar, alGuardar) {
    const c = d.contrato; let tipo = 'vencido'; const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de cierre' });
    const motivo = h('textarea', { id: 'x-mot', maxlength: '255', placeholder: 'Por qué se cierra' }); const dia = h('input', { id: 'x-dia', type: 'date', value: hoyISO(), max: hoyISO() });
    const pintar = () => vaciar(seg).append(...[['vencido', 'Terminó su plazo'], ['rescindido', 'Se rescindió']].map(([v, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(tipo === v), onclick: () => { tipo = v; pintar(); } }, t))); pintar();
    const err = h('div', { class: 'error oculto', role: 'alert' }); const ok = h('button', { class: 'btn btn-principal', type: 'button' }, 'Cerrar contrato');
    ok.addEventListener('click', async () => { ok.disabled = true; err.classList.add('oculto'); try { await api(`/api/contratos/${c.id}/estado`, { metodo: 'POST', cuerpo: { estado: tipo, fecha: dia.value, motivo: motivo.value.trim() || undefined } }); cerrar(); aviso('Contrato cerrado'); alGuardar(); } catch (e) { err.textContent = msg(e); err.classList.remove('oculto'); ok.disabled = false; } });
    return h('div', null, d.equipos.length > 0 && h('div', { class: 'error' }, `Tiene ${d.equipos.length} equipo${d.equipos.length === 1 ? '' : 's'} instalado${d.equipos.length === 1 ? '' : 's'}. Retiralos desde Equipos antes de cerrarlo.`),
      h('div', { class: 'campo' }, h('label', null, 'Motivo del cierre'), seg), campo('Fecha de cierre', dia, 'Los precios vigentes terminan ese día.', 'x-dia'), campo('Detalle', motivo, tipo === 'rescindido' ? 'Obligatorio al rescindir.' : null, 'x-mot'), err, ok);
  }

  return { vistaContratos, vistaNuevoContrato, vistaContrato };
}
