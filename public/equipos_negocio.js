// Equipos y negocio: el costo de cada equipo y la pestaña "Equipos" de la ficha del cliente, con el evolutivo de contadores.
export function crearEquiposNegocio(U) {
  const { h, vaciar, api, fecha, chip, cargando, nombreMes, puede, aviso, navegar } = U;
  const usd2 = (n) => `USD ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = (n) => (n == null ? '—' : Number(n).toLocaleString('es-AR'));
  const ERR = { sin_costo: 'Primero cargá el costo del equipo.', sin_cliente: 'El equipo no está instalado en ningún cliente.', ya_imputado: 'Este equipo ya está cargado en el negocio de ese cliente.', sin_cotizacion: 'No hay cotización del dólar cargada para convertir los pesos.' };

  /** Costo de adquisición del equipo y su imputación al negocio del cliente donde está instalado. Solo con permiso de costos. */
  async function tarjetaCosto(equipoId) {
    if (!puede('costos.ver')) return null;
    const c = await api(`/api/equipos/${equipoId}/costo`).catch(() => null); if (!c) return null;
    const edita = puede('costos.cargar');
    const importe = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: c.costo_adquisicion ?? '', placeholder: 'Sin cargar', 'aria-label': 'Costo del equipo' });
    const moneda = h('select', { 'aria-label': 'Moneda' }, [['USD', 'USD'], ['ARS', 'Pesos']].map(([v, t]) => h('option', { value: v, selected: v === c.moneda }, t)));
    const fadq = h('input', { type: 'date', value: c.fecha_adquisicion ?? '', 'aria-label': 'Fecha de compra' });
    const err = h('div', { class: 'error oculto', role: 'alert' });
    const guardar = h('button', { class: 'btn', type: 'button' }, 'Guardar costo');
    guardar.addEventListener('click', async () => {
      guardar.disabled = true; err.classList.add('oculto');
      try { await api(`/api/equipos/${equipoId}/costo`, { metodo: 'PATCH', cuerpo: { costo_adquisicion: importe.value === '' ? null : Number(importe.value), moneda: moneda.value, fecha_adquisicion: fadq.value || null } }); aviso('Costo guardado'); navegar(); }
      catch (e) { err.textContent = ERR[e.datos?.error] ?? 'No se pudo guardar. Revisá el importe.'; err.classList.remove('oculto'); guardar.disabled = false; }
    });
    const llevaCosto = c.costo_usd != null && c.costo_usd > 0;
    const pct = llevaCosto ? Math.min(100, Math.round((c.meses_amortizados / c.vida_util_meses) * 100)) : 0;
    const estado = llevaCosto ? h('div', { class: 'amort' },
      h('div', { class: 'barra-amort', role: 'img', 'aria-label': `${c.meses_amortizados} de ${c.vida_util_meses} meses amortizados` }, h('i', { style: `width:${pct}%` })),
      h('ul', { class: 'lista' },
        h('li', null, h('span', null, 'Amortizado'), h('b', null, `${c.meses_amortizados} de ${c.vida_util_meses} meses · ${usd2(c.amortizado)}`)),
        h('li', null, h('span', null, 'Valor en libros'), h('b', null, usd2(c.valor_en_libros))),
        c.perdida_baja ? h('li', null, h('span', null, 'Pérdida por baja (flota)'), h('b', null, usd2(c.perdida_baja))) : null,
        ...(c.retiros ?? []).map((r) => h('li', null, h('span', null, `Al salir de ${r.cliente}`, h('div', { class: 'apoyo' }, fecha(r.fecha))), h('b', null, `${usd2(r.valor_en_libros)} por amortizar`))),
        ...c.reparto.map((r) => h('li', null, h('span', null, `Cargado a ${r.cliente}`), h('b', null, usd2(r.usd))))))
      : h('p', { class: 'apoyo' }, 'Sin costo cargado, el equipo no suma costo a ningún negocio.');
    return h('div', { class: 'tarjeta' }, h('h2', null, 'Costo del equipo'),
      edita ? h('div', { class: 'dos-col', style: 'margin-bottom:8px' }, importe, moneda) : h('p', null, c.costo_adquisicion == null ? 'Sin cargar' : (c.moneda === 'ARS' ? `$ ${num(c.costo_adquisicion)}` : usd2(c.costo_adquisicion))),
      edita && h('div', { class: 'campo' }, h('label', null, 'Fecha de compra'), fadq),
      err, edita && h('div', { class: 'acciones' }, guardar),
      estado,
      h('p', { class: 'apoyo' }, `El costo se reparte en ${c.vida_util_meses} meses y cada mes lo carga quien tiene el equipo; en depósito o taller, la flota. Arranca en la fecha de compra o de la primera instalación.`));
  }

  /* ---------- flota ---------- */
  async function vistaFlota(destino) {
    const cuerpo = h('div'); let mes = null;
    const sel = h('input', { type: 'month', 'aria-label': 'Mes' });
    const cargar = async () => {
      vaciar(cuerpo).append(cargando());
      const [d, rev] = await Promise.all([api(`/api/flota${mes ? `?mes=${mes}` : ''}`), api('/api/flota/revision').catch(() => null)]);
      mes = d.mes; sel.value = d.mes;
      const kpi = (r, v, nota) => h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, r), h('div', { class: 'valor' }, v), nota && h('div', { class: 'nota' }, nota));
      const max = Math.max(1, ...d.serie.map((x) => x.usd));
      const barras = h('div', { class: 'flota-barras', role: 'img', 'aria-label': 'Costo de flota de los últimos 12 meses' }, d.serie.map((x) => h('div', { class: 'flota-col', title: `${nombreMes(x.mes)}: ${usd2(x.usd)}` }, h('i', { style: `height:${Math.round((x.usd / max) * 100)}%` }), h('span', null, nombreMes(x.mes).slice(0, 3)))));
      const grupos = (rev ? [['sin_costo', 'Equipos sin costo cargado', 'No suman costo a ningún negocio hasta que les cargues el valor.', (x) => h('span', null, x.equipo, h('div', { class: 'apoyo' }, x.cliente ? `En ${x.cliente}` : x.estado))],
        ['fechas', 'Fechas que no cierran', 'La amortización arranca en la fecha de instalación o de compra: conviene que sean las reales.', (x) => h('span', null, x.equipo, h('div', { class: 'apoyo' }, `${x.cliente ? `${x.cliente} · ` : ''}${x.problema}`))],
        ['duplicados', 'Costo del equipo contado dos veces', 'El costo del equipo ya se reparte mes a mes; un costo suelto del mismo equipo lo suma otra vez.', (x) => h('span', null, x.equipo, h('div', { class: 'apoyo' }, `${x.cliente ? `${x.cliente} · ` : ''}${x.problema}`))],
        ['estados', 'Estados que no coinciden', 'El estado del equipo y su asignación tienen que decir lo mismo.', (x) => h('span', null, x.equipo, h('div', { class: 'apoyo' }, x.problema))]] : []);
      vaciar(cuerpo).append(
        h('div', { class: 'rejilla negocio-kpis' }, kpi('Costo de flota del mes', usd2(d.total), 'Se suma al costo total del negocio, aparte de los clientes'), kpi('Equipos sin cliente', `${d.equipos_deposito} + ${d.equipos_taller}`, 'En depósito y en taller: siguen amortizando mientras esperan'), kpi('Pérdidas del mes', usd2(d.perdidas), 'Bajas con valor por amortizar')),
        h('div', { class: 'tarjeta' }, h('h2', null, 'Últimos 12 meses'), barras),
        h('div', { class: 'tarjeta' }, h('h2', null, `Detalle de ${nombreMes(d.mes)}`),
          d.detalle.length ? h('ul', { class: 'lista' }, d.detalle.map((x) => h('li', null, h('span', null, x.concepto, h('div', { class: 'apoyo' }, x.tipo === 'perdida' ? `Baja del ${fecha(x.fecha)}` : (x.estado === 'reparacion' ? 'En taller' : x.estado === 'deposito' ? 'En depósito' : 'Mes sin cliente'))), h('b', null, usd2(x.usd)))))
            : h('p', { class: 'apoyo' }, 'Este mes la flota no cargó costos.')),
        rev ? h('div', { class: 'carril' }, h('h2', null, 'Control de datos'), h('p', null, rev.total ? `${rev.total} cosas para revisar antes de confiar en la amortización.` : 'Todo en orden: costos, fechas y estados cierran.')) : null,
        ...grupos.filter(([k]) => rev[k].length).map(([k, t, ayuda, fila]) => h('div', { class: 'tarjeta' }, h('h3', null, `${t} (${rev[k].length})`), h('p', { class: 'apoyo' }, ayuda),
          h('ul', { class: 'lista' }, rev[k].map((x) => h('li', null, fila(x), h('a', { href: `#/equipos/${x.equipo_id}` }, 'Abrir'))))))
      );
    };
    sel.addEventListener('change', () => { if (sel.value) { mes = sel.value; cargar().catch(() => vaciar(cuerpo).append(h('div', { class: 'error' }, 'No se pudo cargar la flota.'))); } });
    vaciar(destino).append(h('div', { class: 'encabezado' }, h('div', null, h('h1', null, 'Flota'), h('p', null, 'Lo que cuestan los equipos que no están en ningún cliente.')), sel), cuerpo);
    await cargar().catch(() => vaciar(cuerpo).append(h('div', { class: 'error' }, 'No se pudo cargar la flota.')));
  }

  /* ---------- evolutivo ---------- */
  const COL_NEGRO = '#0D1B2A'; const COL_COLOR = '#E08A2E';
  const sumar = (equipos, periodo) => { let n = null; let c = null; for (const e of equipos) { const s = e.serie.find((x) => x.periodo === periodo); if (s && s.negro != null) { n = (n ?? 0) + s.negro; c = (c ?? 0) + (s.color ?? 0); } } return n == null ? null : { negro: n, color: c }; };

  function grafico(equipos, periodos) {
    const movil = window.innerWidth < 600; const W = movil ? 360 : 720; const H = 200; const m = { i: 44, d: 8, s: 14, b: 26 };
    const datos = periodos.map((p) => ({ p, v: sumar(equipos, p) }));
    if (!datos.some((d) => d.v)) return h('div', { class: 'apoyo' }, 'Todavía no hay lecturas para armar el gráfico.');
    const max = Math.max(1, ...datos.map((d) => (d.v ? d.v.negro + d.v.color : 0)));
    const paso = (() => { const c = max / 4; const p = 10 ** Math.floor(Math.log10(c)); return [1, 2, 2.5, 5, 10].map((f) => f * p).find((v) => v >= c); })(); const tope = paso * 4;
    const pw = W - m.i - m.d; const ph = H - m.s - m.b; const y = (v) => m.s + ph * (1 - v / tope); const ancho = pw / datos.length; const bw = Math.min(26, ancho * 0.6);
    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Páginas impresas por mes, negro y color', style: 'width:100%;height:auto;max-width:760px' });
    for (let k = 0; k <= 4; k += 1) { const v = paso * k; svg.append(h('line', { x1: m.i, x2: W - m.d, y1: y(v), y2: y(v), stroke: '#E6EDF1' }), h('text', { x: m.i - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': '10', fill: '#5B6B78' }, v >= 1000 ? `${(v / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}k` : String(Math.round(v)))); }
    const cada = Math.max(1, Math.ceil(datos.length / (movil ? 6 : 12)));
    datos.forEach((d, k) => {
      const cx = m.i + k * ancho + ancho / 2;
      if (k % cada === 0) svg.append(h('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': '10', fill: '#5B6B78' }, nombreMes(d.p).slice(0, 3)));
      if (!d.v) return;
      const hn = ph * (d.v.negro / tope); const hc = ph * (d.v.color / tope);
      svg.append(h('rect', { x: cx - bw / 2, y: y(d.v.negro), width: bw, height: hn, fill: COL_NEGRO, rx: 2 }, h('title', null, `${nombreMes(d.p)} · negro: ${num(d.v.negro)} páginas`)));
      if (d.v.color > 0) svg.append(h('rect', { x: cx - bw / 2, y: y(d.v.negro) - hc, width: bw, height: hc, fill: COL_COLOR, rx: 2 }, h('title', null, `${nombreMes(d.p)} · color: ${num(d.v.color)} páginas`)));
    });
    return svg;
  }

  const leyenda = () => h('div', { class: 'apoyo', style: 'display:flex;gap:14px;margin:4px 0 8px' }, h('span', null, h('span', { style: `display:inline-block;width:10px;height:10px;border-radius:2px;background:${COL_NEGRO};margin-right:6px` }), 'Negro'), h('span', null, h('span', { style: `display:inline-block;width:10px;height:10px;border-radius:2px;background:${COL_COLOR};margin-right:6px` }), 'Color'));

  /** Tabla mes a mes de un conjunto de equipos (último mes primero). */
  function tablaMeses(equipos, periodos) {
    const filas = [...periodos].reverse().map((p) => ({ p, v: sumar(equipos, p) })).filter((x) => x.v);
    if (!filas.length) return null;
    return h('table', null, h('thead', null, h('tr', null, h('th', null, 'Mes'), h('th', { class: 'num' }, 'Negro'), h('th', { class: 'num' }, 'Color'), h('th', { class: 'num' }, 'Total'))),
      h('tbody', null, filas.map(({ p, v }) => h('tr', null, h('td', null, nombreMes(p)), h('td', { class: 'num' }, num(v.negro)), h('td', { class: 'num' }, num(v.color)), h('td', { class: 'num' }, h('b', null, num(v.negro + v.color)))))));
  }

  function filaEquipo(e, periodos) {
    const u = e.ultima_lectura; const ultimoMes = [...periodos].reverse().map((p) => sumar([e], p)).find(Boolean);
    const det = h('details', null, h('summary', null, h('a', { href: `#/equipos/${e.equipo_id}` }, h('b', null, `${e.marca} ${e.modelo}`)), ' ', h('span', { class: 'apoyo' }, `${e.numero_serie} · ${e.contrato}`), ' ',
      e.vigente ? null : chip(`Retirado ${fecha(e.hasta)}`, 'mudo'), ' ', h('span', { class: 'apoyo' }, u ? `Contador ${num(u.negro)}${e.tipo === 'color' ? ` / ${num(u.color)}` : ''}` : 'Sin lecturas'), ultimoMes ? h('span', { class: 'apoyo' }, ` · último mes ${num(ultimoMes.negro + ultimoMes.color)} págs.`) : null));
    det.addEventListener('toggle', () => { if (det.open && det.children.length === 1) { det.append(h('div', { style: 'margin:8px 0 12px' }, leyenda(), grafico([e], periodos), tablaMeses([e], periodos) ?? h('div', { class: 'apoyo' }, 'Sin lecturas todavía.'))); } });
    return h('div', { style: 'padding:6px 0;border-top:1px solid #E6EDF1' }, det);
  }

  /** Pestaña Equipos del cliente: agrupa por local o por contrato, siempre con el total del cliente arriba. */
  async function pestanaEquipos(clienteId) {
    const caja = h('div', null, cargando());
    const r = await api(`/api/clientes/${clienteId}/equipos`).catch(() => null);
    if (!r) return h('div', { class: 'tarjeta vacio' }, 'No se pudieron cargar los equipos.');
    if (!r.equipos.length) return h('div', { class: 'tarjeta vacio' }, h('b', null, 'Todavía no tiene equipos'), 'Se ven acá cuando instalás un equipo en uno de sus contratos.');
    const f = { vista: 'local', meses: 12, retirados: false };
    const cuerpo = h('div'); const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Agrupar por', style: 'margin:0' });
    const mesSel = h('select', { 'aria-label': 'Período' }, [[6, 'Últimos 6 meses'], [12, 'Últimos 12 meses'], [24, 'Últimos 24 meses']].map(([v, t]) => h('option', { value: v, selected: v === f.meses }, t)));
    const chkRet = h('input', { type: 'checkbox', id: 'eq-ret' });
    const hayRetirados = r.equipos.some((e) => !e.vigente);
    const pintar = () => {
      vaciar(seg).append(...[['local', 'Por local'], ['contrato', 'Por contrato'], ['lista', 'Lista']].map(([k, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(f.vista === k), onclick: () => { f.vista = k; pintar(); } }, t)));
      const equipos = r.equipos.filter((e) => f.retirados || e.vigente);
      const todos = r.equipos.filter((e) => f.retirados || e.vigente);
      const mesesSet = new Set(todos.flatMap((e) => e.serie.map((s) => s.periodo))); const periodos = [...mesesSet].sort().slice(-f.meses);
      const grupos = new Map();
      const clave = (e) => (f.vista === 'local' ? [`s${e.sede_id ?? 0}`, e.sede, e.localidad] : [`c${e.contrato_id}`, e.contrato, null]);
      if (f.vista !== 'lista') for (const e of equipos) { const [k, t, sub] = clave(e); if (!grupos.has(k)) grupos.set(k, { titulo: t, sub, equipos: [] }); grupos.get(k).equipos.push(e); }
      const nContratos = new Set(equipos.map((e) => e.contrato_id)).size;
      vaciar(cuerpo).append(
        h('div', { class: 'tarjeta' }, h('h2', null, nContratos > 1 ? 'Total del cliente (todos los contratos)' : 'Total del cliente'), h('div', { class: 'apoyo' }, `${equipos.filter((e) => e.vigente).length} equipo${equipos.filter((e) => e.vigente).length === 1 ? '' : 's'} instalado${equipos.filter((e) => e.vigente).length === 1 ? '' : 's'}. Páginas impresas por mes.`), leyenda(), grafico(equipos, periodos),
          h('details', null, h('summary', null, 'Ver tabla mes a mes'), tablaMeses(equipos, periodos) ?? h('div', { class: 'apoyo' }, 'Sin lecturas todavía.'))),
        ...(f.vista === 'lista' ? [h('div', { class: 'tarjeta' }, equipos.map((e) => filaEquipo(e, periodos)))]
          : [...grupos.values()].map((g) => h('div', { class: 'tarjeta' }, h('h2', null, g.titulo), g.sub && h('div', { class: 'apoyo' }, g.sub), h('div', { class: 'apoyo' }, `${g.equipos.filter((e) => e.vigente).length} instalado${g.equipos.filter((e) => e.vigente).length === 1 ? '' : 's'}`),
            leyenda(), grafico(g.equipos, periodos), h('details', null, h('summary', null, 'Ver tabla mes a mes'), tablaMeses(g.equipos, periodos) ?? h('div', { class: 'apoyo' }, 'Sin lecturas todavía.')),
            h('div', { style: 'margin-top:10px' }, g.equipos.map((e) => filaEquipo(e, periodos)))))));
    };
    mesSel.addEventListener('change', () => { f.meses = Number(mesSel.value); pintar(); });
    chkRet.addEventListener('change', () => { f.retirados = chkRet.checked; pintar(); });
    pintar();
    vaciar(caja).append(h('div', { class: 'herramientas', style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px' }, seg, mesSel, hayRetirados && h('label', { class: 'interruptor', for: 'eq-ret' }, chkRet, h('span', null, 'Incluir equipos retirados'))), cuerpo);
    return caja;
  }

  return { tarjetaCosto, pestanaEquipos, vistaFlota };
}
