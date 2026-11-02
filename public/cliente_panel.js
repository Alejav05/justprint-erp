// Tablero de la ficha de un cliente: números clave, gráficos y lo último que pasó con la cuenta. Más la descarga a Excel.
export function crearPanelCliente(U) {
  const { h, vaciar, api, usd, fecha, chip, puede, cargando, kpiTarjeta, graficoFacturacion, mesCorto, cajon, chipTicket } = U;
  const num = (n) => Number(n ?? 0).toLocaleString('es-AR');
  const TIPO = { llamada: 'Llamada', visita: 'Visita', mail: 'Mail', whatsapp: 'WhatsApp', reunion: 'Reunión', nota: 'Nota' };

  /** Barras agrupadas simples: una o dos series por mes. */
  function barras(serie, series, { etiqueta, entero = false }) {
    const movil = window.innerWidth < 600; const datos = movil ? serie.slice(-6) : serie;
    const W = movil ? 380 : 520; const H = 200; const m = { i: 40, d: 8, s: 10, b: 26 };
    const max = Math.max(1, ...datos.flatMap((s) => series.map((k) => s[k.clave] ?? 0)));
    const crudo = max / 4; const pot = 10 ** Math.floor(Math.log10(crudo)); let paso = [1, 2, 2.5, 5, 10].map((f) => f * pot).find((v) => v >= crudo); if (entero) paso = Math.max(1, Math.ceil(paso)); const tope = paso * 4;
    const ancho = (W - m.i - m.d) / datos.length; const y = (v) => m.s + (H - m.s - m.b) * (1 - v / tope);
    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': etiqueta });
    for (let k = 0; k <= 4; k += 1) { const v = paso * k; svg.append(h('line', { x1: m.i, x2: W - m.d, y1: y(v), y2: y(v), stroke: '#E6EEF1' }), h('text', { x: m.i - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#7C8B96' }, v >= 1000 ? `${String(v / 1000).replace('.', ',')}k` : v)); }
    datos.forEach((s, i) => {
      const cx = m.i + i * ancho + ancho / 2; const bw = Math.min(16, ancho / (series.length + 1)); const total = series.length * bw + (series.length - 1) * 2;
      series.forEach((k, j) => { const v = s[k.clave] ?? 0; svg.append(h('rect', { x: cx - total / 2 + j * (bw + 2), y: y(v), width: bw, height: Math.max(0, (H - m.s - m.b) * (v / tope)), rx: 3, fill: k.color }, h('title', null, `${mesCorto(s.periodo)} ${s.periodo.slice(0, 4)} · ${k.nombre}: ${num(v)}`))); });
      svg.append(h('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': movil ? 12.5 : 11.5, fill: '#5B6B76' }, mesCorto(s.periodo)));
    });
    return svg;
  }
  const leyenda = (items) => h('div', { class: 'leyenda' }, items.map(([c, t]) => h('span', null, h('i', { style: `background:${c}` }), t)));

  async function panel(clienteId) {
    const caja = h('div', null, cargando());
    let p;
    try { p = await api(`/api/clientes/${clienteId}/panel`); } catch (e) { if (e.message === 'sesion') return caja; return h('div'); }
    const kpis = []; const bloques = [];
    if (p.facturacion) {
      const f = p.facturacion;
      kpis.push(kpiTarjeta('Abono mensual', f.abono_mensual ? usd(f.abono_mensual) : '—', f.abono_no_facturable ? `+ ${usd(f.abono_no_facturable)} sin facturar` : null),
        kpiTarjeta('Facturado · 12 meses', usd(f.facturado_12m)), kpiTarjeta('Por cobrar', usd(f.por_cobrar), f.facturas_pendientes.length ? `${f.facturas_pendientes.length} factura${f.facturas_pendientes.length === 1 ? '' : 's'}` : 'Está al día', f.por_cobrar > 0 ? 'alerta' : ''));
    }
    if (p.tickets) kpis.push(kpiTarjeta('Tickets abiertos', String(p.tickets.abiertos), `${p.tickets.total_12m} en 12 meses${p.tickets.pct_sla != null ? ` · ${p.tickets.pct_sla}% en SLA` : ''}`, p.tickets.abiertos > 0 ? 'alerta' : ''));
    if (p.equipos) kpis.push(kpiTarjeta('Equipos instalados', String(p.equipos.length)));

    if (p.facturacion && p.facturacion.serie.some((s) => s.facturado || s.cobrado)) {
      bloques.push(h('div', { class: 'tarjeta grafico' }, h('p', { class: 'etiqueta' }, 'Facturado y cobrado · USD neto'), graficoFacturacion(p.facturacion.serie.map((s) => ({ ...s, sin_comprobante: 0 }))), leyenda([['#0D1B2A', 'Facturado'], ['#00BCD4', 'Cobrado']])));
    }
    if (p.consumo && !p.consumo.sin_datos) {
      const series = [{ clave: 'negro', color: '#0D1B2A', nombre: 'Negro' }, ...(p.consumo.color ? [{ clave: 'color', color: '#E08A2E', nombre: 'Color' }] : [])];
      bloques.push(h('div', { class: 'tarjeta grafico' }, h('p', { class: 'etiqueta' }, 'Páginas impresas por mes'), barras(p.consumo.serie, series, { etiqueta: 'Páginas impresas por mes' }), leyenda(series.map((k) => [k.color, k.nombre]))));
    }
    if (p.tickets && p.tickets.total_12m > 0) {
      bloques.push(h('div', { class: 'tarjeta grafico' }, h('p', { class: 'etiqueta' }, 'Tickets por mes'), barras(p.tickets.serie.map((s) => ({ ...s, n: s.tickets })), [{ clave: 'n', color: '#00BCD4', nombre: 'Tickets' }], { etiqueta: 'Tickets abiertos por mes', entero: true }),
        p.tickets.horas_medias != null && h('p', { class: 'apoyo', style: 'margin:8px 0 0' }, `Resolución media: ${num(p.tickets.horas_medias)} h hábiles`)));
    }
    const listas = [];
    if (p.comercial) {
      listas.push(h('div', { class: 'tarjeta' }, h('h2', null, 'Últimas gestiones comerciales'),
        p.comercial.interacciones.length ? h('ul', { class: 'lista' }, p.comercial.interacciones.map((i) => h('li', { style: 'display:block' }, h('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, h('b', null, TIPO[i.tipo] ?? i.tipo), h('span', { class: 'apoyo' }, `${fecha(i.fecha)} · ${i.usuario}`)), h('div', { class: 'apoyo' }, i.resumen.length > 140 ? `${i.resumen.slice(0, 140)}…` : i.resumen))))
          : h('p', { class: 'apoyo' }, 'Todavía no hay gestiones registradas.'),
        p.comercial.tareas.length > 0 && h('div', { style: 'margin-top:12px' }, h('p', { class: 'etiqueta' }, 'Próximos pasos'), p.comercial.tareas.map((t) => h('div', { class: 'apoyo' }, `${t.titulo} · ${t.vence ? fecha(t.vence) : 'sin fecha'} · ${t.asignado}`, t.vencida ? ' ' : null, t.vencida && chip('Vencida', 'malo'))))));
    }
    if (p.tickets) {
      listas.push(h('div', { class: 'tarjeta' }, h('h2', null, 'Últimos tickets'),
        p.tickets.ultimos.length ? h('ul', { class: 'lista' }, p.tickets.ultimos.map((t) => h('li', null, h('div', null, h('a', { href: `#/tickets/${t.id}` }, `${t.numero} · ${t.asunto}`), h('div', { class: 'apoyo' }, fecha(t.abierto_en))), chipTicket(t.estado)))) : h('p', { class: 'apoyo' }, 'Sin tickets.')));
    }
    if (p.facturacion?.facturas_pendientes.length) {
      listas.push(h('div', { class: 'tarjeta' }, h('h2', null, 'Facturas por cobrar'), h('ul', { class: 'lista' }, p.facturacion.facturas_pendientes.map((f) => h('li', null, h('div', null, h('b', null, f.numero ?? 'Sin número'), h('div', { class: 'apoyo' }, `${f.periodo}${f.vencimiento ? ` · vence ${fecha(f.vencimiento)}` : ''}`)), h('b', null, usd(f.saldo_usd)))))));
    }
    if (p.equipos?.length) {
      listas.push(h('div', { class: 'tarjeta' }, h('h2', null, 'Equipos'), h('ul', { class: 'lista' }, p.equipos.map((e) => h('li', null, h('div', null, h('b', null, e.serie), h('div', { class: 'apoyo' }, `${e.modelo}${e.sede ? ` · ${e.sede}` : ''}`)),
        h('span', { class: 'apoyo' }, e.ultima ? `${num(e.ultima.negro)}${e.tipo === 'color' ? ` / ${num(e.ultima.color)}` : ''} · ${fecha(e.ultima.fecha)}` : 'Sin lecturas'))))));
    }
    vaciar(caja);
    if (kpis.length) caja.append(h('div', { class: 'rejilla kpis', style: 'margin-bottom:16px' }, kpis));
    if (bloques.length) caja.append(h('div', { class: 'rejilla dos-iguales', style: 'margin-bottom:16px' }, bloques));
    if (listas.length) caja.append(h('div', { class: 'rejilla dos-iguales', style: 'margin-bottom:16px' }, listas));
    return caja;
  }

  /** Botón que abre las opciones de la descarga a Excel. */
  function botonExcel(clienteId) {
    if (!(puede('equipos.ver') || puede('contadores.ver') || puede('tickets.ver'))) return null;
    return h('button', { class: 'btn', type: 'button', onclick: () => cajon('Descargar Excel', (cerrar) => {
      const opciones = [['contadores', 'Historial de contadores', puede('contadores.ver')], ['gestiones', 'Tickets y gestiones técnicas', puede('tickets.ver')], ['equipos', 'Equipos', puede('equipos.ver')], ['facturas', 'Facturación', puede('importes.ver')]].filter((o) => o[2]);
      const marcas = opciones.map(([k, t]) => [k, h('input', { type: 'checkbox', checked: k !== 'facturas' })]);
      const desde = h('input', { type: 'date', 'aria-label': 'Desde' }); const hasta = h('input', { type: 'date', 'aria-label': 'Hasta' });
      const bajar = h('button', { class: 'btn btn-principal', type: 'button' }, 'Descargar');
      bajar.addEventListener('click', () => {
        const secciones = marcas.filter(([, c]) => c.checked).map(([k]) => k);
        if (!secciones.length) return;
        const p = new URLSearchParams({ secciones: secciones.join(',') }); if (desde.value) p.set('desde', desde.value); if (hasta.value) p.set('hasta', hasta.value);
        const a = h('a', { href: `/api/clientes/${clienteId}/excel?${p}`, download: '' }); document.body.append(a); a.click(); a.remove(); cerrar();
      });
      return h('div', null, h('p', { class: 'apoyo' }, 'Pensado para compartir con el cliente: no incluye gestiones comerciales, costos ni notas internas.'),
        h('div', { style: 'display:grid;gap:10px;margin:12px 0' }, opciones.map(([k, t], i) => h('label', { style: 'display:flex;gap:8px;align-items:center' }, marcas[i][1], t))),
        h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px' }, [['Desde', desde], ['Hasta', hasta]].map(([t, i]) => h('label', { style: 'display:grid;gap:4px;flex:1 1 150px' }, t, i))),
        h('p', { class: 'apoyo' }, 'Sin fechas, baja todo el historial.'), bajar);
    }) }, 'Descargar Excel');
  }

  return { panel, botonExcel };
}
