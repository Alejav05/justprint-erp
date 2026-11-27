// Monitoreo de equipos: estado diario de los equipos de JustPrint en cada cliente (insumos, errores, conexión) según
// los agentes. Es solo seguimiento: lo que se factura sale de la toma de fin de mes en Contadores.
export function crearMonitoreo(U) {
  const { h, agregar, vaciar, api, chip, puede, cargando, encabezado, aviso, fecha } = U;
  const num = (n) => Number(n ?? 0).toLocaleString('es-AR');
  const COLOR = { negro: 'var(--navy)', cian: '#00A9E0', magenta: '#E0287A', amarillo: '#F2C230' };
  const NOMBRE_TIPO = { toner: 'Toner', tinta: 'Tinta', tambor: 'Tambor', fusor: 'Fusor', residuos: 'Residuos', revelador: 'Revelador', transferencia: 'Transferencia' };
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const nombreMes = (p) => (p ? MESES[Number(p.slice(5, 7)) - 1] : null);
  const rotuloInsumo = (i) => (i.tipo === 'toner' || i.tipo === 'tinta') && i.color ? i.color[0].toUpperCase() + i.color.slice(1) : NOMBRE_TIPO[i.tipo] ?? i.nombre;
  const equipoTxt = (e) => `${e.marca} ${e.modelo}`;
  const atender = (e) => e.alertas.length > 0;

  async function vistaMonitoreo(destino) {
    const cuerpo = h('div');
    agregar(destino, [encabezado('Monitoreo de equipos', 'Estado de los equipos de JustPrint en cada cliente, leído todos los días por los agentes: insumos, errores, conexión y contadores del día. Es solo para seguimiento: lo que se factura sale de la toma de fin de mes en Contadores.',
      h('a', { class: 'btn', href: '#/contadores/agentes' }, 'Agentes')), cuerpo]);
    let datos = null; let vista = 'ins'; let filtro = 'todos'; let abiertos = null;
    const q = h('input', { type: 'search', placeholder: 'Buscar cliente, modelo o serie', 'aria-label': 'Buscar', style: 'flex:1 1 240px;max-width:none' });
    q.addEventListener('input', () => pintarLista());
    const lista = h('div'); const cuenta = h('div', { class: 'apoyo', style: 'margin:12px 0 8px' });

    async function cargar() {
      vaciar(cuerpo).append(cargando());
      datos = await api('/api/monitoreo').catch(() => null);
      vaciar(cuerpo);
      if (!datos) { cuerpo.append(h('div', { class: 'vacio' }, 'No se pudo cargar el monitoreo.')); return; }
      if (!datos.clientes.length) { cuerpo.append(h('div', { class: 'tarjeta vacio' }, 'Todavía no hay clientes con agente. Se da de alta en Contadores › Toma automática.')); return; }
      if (!abiertos) abiertos = new Set(datos.clientes.filter((c) => c.equipos.some(atender) || c.agentes.some((a) => a.caido)).map((c) => c.cliente_id));
      pintar();
    }

    // ——— Acciones: pedido de insumos y tickets (crean tickets normales, que siguen su circuito) ———
    async function crearTicket(c, e, tipo, asunto, descripcion, prioridad = 'normal') {
      const r = await api('/api/tickets', { metodo: 'POST', cuerpo: { cliente_id: c.cliente_id, equipo_id: e.equipo_id, tipo, asunto: asunto.slice(0, 200), descripcion, prioridad, origen: 'interno' } });
      return r.id;
    }
    const textoInsumos = (e) => e.alertas.filter((a) => a.tipo === 'insumo_bajo').map((a) => `${a.insumo} al ${a.nivel}%${a.dias != null ? ` (quedan unos ${a.dias} días)` : ''}`);
    async function pedirInsumos(pares) {
      let ok = 0;
      for (const { c, e } of pares) {
        const items = textoInsumos(e);
        try {
          await crearTicket(c, e, 'insumos', `Reponer insumos: ${equipoTxt(e)} (${items.length === 1 ? items[0].split(' al ')[0] : `${items.length} insumos`})`,
            `Pedido armado desde Monitoreo.\nEquipo ${equipoTxt(e)}, serie ${e.serie}${e.ip ? `, IP ${e.ip}` : ''}.\n${items.join('\n')}`, e.alertas.some((a) => a.tipo === 'insumo_bajo' && a.dias != null && a.dias <= 7) ? 'alta' : 'normal');
          ok += 1;
        } catch (err) { if (err.message === 'sesion') return; }
      }
      aviso(ok ? `Listo: ${ok} ${ok === 1 ? 'ticket de insumos creado' : 'tickets de insumos creados'}` : 'No se pudo crear el pedido');
      await cargar();
    }
    async function ticketSoporte(c, e, motivo) {
      try {
        const id = await crearTicket(c, e, 'soporte', `${motivo}: ${equipoTxt(e)}`, `Detectado por Monitoreo.\nEquipo ${equipoTxt(e)}, serie ${e.serie}${e.ip ? `, IP ${e.ip}` : ''}.${e.mensaje ? `\nPanel del equipo: ${e.mensaje}` : ''}`);
        location.hash = `#/tickets/${id}`;
      } catch (err) { if (err.message !== 'sesion') aviso('No se pudo crear el ticket'); }
    }
    const botonTicket = (e, crear) => (e.ticket ? h('a', { class: 'btn', href: `#/tickets/${e.ticket.id}` }, `Ticket ${e.ticket.numero} abierto`) : puede('tickets.crear') ? h('button', { type: 'button', class: 'btn', onclick: crear }, crear.texto) : null);

    function pintar() {
      const r = datos.resumen;
      const kpi = (rotulo, valor, nota, clase) => h('div', { class: `tarjeta kpi ${clase ?? ''}` }, h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, valor), nota && h('div', { class: 'nota' }, nota));
      const caidos = datos.clientes.flatMap((c) => c.agentes.filter((a) => a.caido).map((a) => ({ c, a })));
      const pares = datos.clientes.flatMap((c) => c.equipos.map((e) => ({ c, e })));
      const paraPedido = pares.filter(({ e }) => !e.ticket && e.alertas.some((a) => a.tipo === 'insumo_bajo'));
      const filas = [];
      for (const { c, a } of caidos) {
        filas.push({ orden: 0, ico: chip('PC', 'malo'), titulo: `Agente "${a.nombre}" sin conexión`, detalle: `${c.cliente} · ${a.ultima_conexion ? `última vez el ${fecha(String(a.ultima_conexion).slice(0, 10))}` : 'nunca se conectó'}${a.pc ? ` · PC ${a.pc}` : ''}. Sin él no se toman los contadores de fin de mes.`, accion: null });
      }
      for (const { c, e } of pares) {
        for (const a of e.alertas) {
          if (a.tipo === 'sin_conexion') filas.push({ orden: 1, ico: chip('!', 'malo'), titulo: `${equipoTxt(e)} no responde`, detalle: `${c.cliente} · visto el ${fecha(a.desde)}${e.ip ? ` · ${e.ip}` : ''}`, accion: botonTicket(e, Object.assign(() => ticketSoporte(c, e, 'Equipo sin conexión'), { texto: 'Abrir ticket' })) });
          if (a.tipo === 'error') filas.push({ orden: 2, ico: chip('!', 'malo'), titulo: `${a.texto} · ${equipoTxt(e)}`, detalle: `${c.cliente} · serie ${e.serie}${e.mensaje ? ` · panel: "${e.mensaje}"` : ''}`, accion: botonTicket(e, Object.assign(() => ticketSoporte(c, e, a.texto), { texto: 'Abrir ticket' })) });
          if (a.tipo === 'insumo_bajo') filas.push({ orden: 3 + a.nivel / 1000, ico: chip(`${a.nivel}%`, 'aviso'), titulo: `${a.insumo} al ${a.nivel}% · ${equipoTxt(e)}`, detalle: `${c.cliente}${a.dias != null ? ` · quedan unos ${a.dias} días` : ''}`, accion: botonTicket(e, Object.assign(() => pedirInsumos([{ c, e }]), { texto: 'Pedir' })) });
        }
      }
      filas.sort((a, b) => a.orden - b.orden);
      let todas = false;
      const cajaAt = h('div');
      const pintarAtender = () => {
        vaciar(cajaAt);
        if (!filas.length) { cajaAt.append(h('p', { class: 'apoyo', style: 'margin:0' }, 'Nada para atender: todos los equipos responden y los insumos están por encima del umbral.')); return; }
        cajaAt.append(...(todas ? filas : filas.slice(0, 6)).map((f) => h('div', { class: 'mon-al' }, f.ico, h('div', null, h('b', null, f.titulo), h('div', { class: 'apoyo' }, f.detalle)), f.accion)));
        if (filas.length > 6) cajaAt.append(h('button', { type: 'button', class: 'btn-texto', style: 'margin-top:8px', onclick: () => { todas = !todas; pintarAtender(); } }, todas ? 'Ver menos' : `Ver los ${filas.length}`));
      };
      pintarAtender();
      const tabs = h('div', { class: 'mon-tabs', role: 'tablist' }, [['ins', 'Insumos y estado'], ['cont', 'Contadores del día']].map(([v, t]) => h('button', { type: 'button', role: 'tab', class: 'mon-tab', 'aria-selected': String(vista === v), onclick: () => { vista = v; pintar(); } }, t)));
      const FIL = [['todos', 'Todos'], ['atender', 'Con algo para atender'], ['sin_conexion', 'Sin conexión'], ['color', 'Color'], ['mono', 'Monocromo']];
      const chips = h('div', { class: 'otr-chips', style: 'flex-basis:auto' }, FIL.map(([k, t]) => h('button', { type: 'button', class: 'otr-chip', 'aria-pressed': String(filtro === k), onclick: () => { filtro = k; pintar(); } }, t)));
      vaciar(cuerpo).append(
        h('div', { class: 'rejilla kpis' },
          kpi('Equipos monitoreados', num(r.equipos), `en ${r.clientes} ${r.clientes === 1 ? 'cliente' : 'clientes'}${r.sin_datos ? ` · ${r.sin_datos} todavía sin datos` : ''}`),
          kpi('Sin conexión', num(r.sin_conexion + r.agentes_caidos), r.agentes_caidos ? `${r.sin_conexion} equipos · ${r.agentes_caidos} ${r.agentes_caidos === 1 ? 'agente' : 'agentes'}` : 'equipos que no respondieron', r.sin_conexion + r.agentes_caidos ? 'alerta' : ''),
          kpi('Insumo bajo', num(r.insumo_bajo), `equipos con algo por debajo de ${datos.umbral}%`, r.insumo_bajo ? 'alerta' : ''),
          kpi('Páginas este mes', num(r.paginas_mes), 'desde la última toma de cierre')),
        h('section', { class: 'tarjeta', style: 'margin-bottom:16px' },
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px' }, h('h2', { style: 'margin:0' }, 'Para atender'),
            paraPedido.length && puede('tickets.crear') ? h('button', { type: 'button', class: 'btn btn-principal', onclick: () => pedirInsumos(paraPedido) }, `Armar pedido de insumos (${paraPedido.length})`) : null),
          cajaAt),
        tabs, h('div', { class: 'herramientas otr-filtros', style: 'border:0;margin-top:12px' }, q, chips), cuenta, lista,
        h('p', { class: 'apoyo', style: 'margin-top:16px' }, `Los agentes leen el estado una vez por día (desde la versión 1.4). Los días que quedan de cada insumo se estiman con cómo bajó en las últimas semanas. "Insumo bajo" es menos de ${datos.umbral}%: se cambia en Alertas › Toner o insumo bajo. La toma que se factura sigue siendo la de fin de mes y queda en Contadores.`));
      pintarLista();
    }

    function pasa(e) {
      if (filtro === 'atender') return atender(e);
      if (filtro === 'sin_conexion') return e.conexion === 'sin_conexion';
      if (filtro === 'color') return e.tipo === 'color';
      if (filtro === 'mono') return e.tipo !== 'color';
      return true;
    }
    const barra = (i) => {
      const bajo = i.bajo; const pct = i.nivel;
      return h('div', { class: `mon-bar${bajo ? ' bajo' : ''}` }, h('span', null, rotuloInsumo(i)),
        h('span', { class: 'mon-tr', title: i.nombre }, pct != null ? h('i', { style: `width:${pct}%;background:${(i.tipo === 'toner' || i.tipo === 'tinta') && COLOR[i.color] ? COLOR[i.color] : 'var(--gris)'}` }) : null),
        h('span', { class: 'mon-v' }, pct != null ? `${pct}%` : i.queda_algo ? 'OK' : '—'));
    };
    function tarjeta(e) {
      const reponibles = e.insumos.filter((i) => ['toner', 'tinta'].includes(i.tipo) && i.dias != null);
      const minDias = reponibles.length ? Math.min(...reponibles.map((i) => i.dias)) : null;
      const est = e.conexion === 'en_linea' ? chip('En línea', 'ok') : e.conexion === 'sin_conexion' ? chip('Sin conexión', 'malo') : chip('Sin datos', 'mudo');
      return h('div', { class: 'mon-eq' },
        h('div', { class: 'mon-eq-top' }, h('div', null, h('b', null, equipoTxt(e)), h('div', { class: 'apoyo' }, [e.serie, e.ip].filter(Boolean).join(' · '))), est),
        h('div', { class: 'apoyo' }, e.visto ? `Visto el ${fecha(e.visto)}` : 'El agente todavía no mandó el estado (necesita la versión 1.4)', ` · ${e.tipo === 'color' ? 'Color' : 'Monocromo'}`),
        e.errores.length ? h('div', { style: 'margin-top:6px;display:flex;gap:4px;flex-wrap:wrap' }, e.errores.map((x) => chip(x.texto, ['poco_papel', 'sin_papel', 'bandeja_vacia', 'poco_toner', 'bandeja_salida_casi_llena'].includes(x.clave) ? 'aviso' : 'malo'))) : null,
        e.mensaje ? h('div', { class: 'apoyo', style: 'margin-top:4px' }, `Panel: "${e.mensaje}"`) : null,
        e.insumos.length ? h('div', { class: 'mon-ins' }, e.insumos.filter((i) => i.tipo !== 'otro' || i.nivel != null).map(barra)) : e.visto ? h('div', { class: 'apoyo', style: 'margin-top:8px' }, 'El equipo no informa sus insumos.') : null,
        minDias != null ? h('div', { class: 'apoyo', style: 'margin-top:6px' }, e.insumos.some((i) => i.bajo) ? chip('Insumo bajo', 'aviso') : null, ` El toner alcanza para unos ${minDias} días`) : null,
        e.ticket ? h('div', { style: 'margin-top:6px' }, h('a', { href: `#/tickets/${e.ticket.id}` }, `Ticket ${e.ticket.numero} abierto`), h('span', { class: 'apoyo' }, ` · ${e.ticket.asunto}`)) : null);
    }
    function tablaContadores(c) {
      return h('div', null, h('table', { class: 'tarjetas' },
        h('thead', null, h('tr', null, ['Equipo', 'Contador hoy', 'Páginas este mes', 'Por día', 'Cierre del mes'].map((t, i) => h('th', { class: i && i < 4 ? 'num' : null }, t)))),
        h('tbody', null, c.equipos.map((e) => h('tr', null,
          h('td', { 'data-rotulo': 'Equipo' }, h('div', null, h('b', null, equipoTxt(e)), h('div', { class: 'apoyo' }, e.serie))),
          h('td', { 'data-rotulo': 'Contador hoy', class: 'num' }, e.contador ? h('div', null, num(e.contador.total), e.contador.color != null && e.tipo === 'color' ? h('div', { class: 'apoyo' }, `${num(e.contador.negro)} negro · ${num(e.contador.color)} color`) : null) : '—'),
          h('td', { 'data-rotulo': 'Páginas este mes', class: 'num' }, e.paginas ? h('div', null, num(e.paginas.total), h('div', { class: 'apoyo' }, [e.paginas.color != null && `${num(e.paginas.color)} color`, `desde el ${fecha(e.paginas.desde)}`].filter(Boolean).join(' · '))) : '—'),
          h('td', { 'data-rotulo': 'Por día', class: 'num' }, e.paginas ? num(e.paginas.por_dia) : '—'),
          h('td', { 'data-rotulo': 'Cierre del mes' }, h('div', null, e.cierre.cargada ? chip('Cargada', 'ok') : chip('Pendiente', 'info'), h('div', { class: 'apoyo' }, `toma de ${nombreMes(e.cierre.periodo)}`))))))),
      h('p', { class: 'apoyo', style: 'margin:8px 0 0' }, 'Estos contadores son solo de seguimiento. La lectura que se factura se toma a fin de mes y queda en ', h('a', { href: '#/contadores' }, 'Contadores'), '.'));
    }

    function pintarLista() {
      const t = q.value.trim().toLowerCase();
      const ls = datos.clientes.map((c) => ({ ...c, equipos: c.equipos.filter((e) => pasa(e) && (!t || c.cliente.toLowerCase().includes(t) || `${e.marca} ${e.modelo} ${e.serie} ${e.ip ?? ''}`.toLowerCase().includes(t))) }))
        .filter((c) => c.equipos.length || (filtro === 'todos' && !t && c.agentes.length));
      const ne = ls.reduce((s, c) => s + c.equipos.length, 0);
      cuenta.textContent = `${ls.length} ${ls.length === 1 ? 'cliente' : 'clientes'} · ${ne} ${ne === 1 ? 'equipo' : 'equipos'}`;
      vaciar(lista);
      if (!ls.length) { lista.append(h('div', { class: 'tarjeta vacio' }, 'No hay equipos que coincidan.')); return; }
      lista.append(...ls.map((c) => {
        const abierto = abiertos.has(c.cliente_id);
        const off = c.equipos.filter((e) => e.conexion === 'sin_conexion').length; const bajos = c.equipos.filter((e) => e.alertas.some((a) => a.tipo === 'insumo_bajo')).length;
        const errs = c.equipos.filter((e) => e.alertas.some((a) => a.tipo === 'error')).length; const caido = c.agentes.find((a) => a.caido);
        const resumen = [caido && chip('Agente sin conexión', 'malo'), off && chip(`${off} sin conexión`, 'malo'), errs && chip(`${errs} con error`, 'malo'), bajos && chip(`${bajos} con insumo bajo`, 'aviso')].filter(Boolean);
        const pags = c.equipos.reduce((s, e) => s + (e.paginas?.total ?? 0), 0);
        return h('section', { class: `tarjeta otr-cli${abierto ? ' abierto' : ''}` },
          h('button', { type: 'button', class: 'otr-cab mon-cab', 'aria-expanded': String(abierto), onclick: () => { if (abierto) abiertos.delete(c.cliente_id); else abiertos.add(c.cliente_id); pintarLista(); } },
            h('span', { class: 'otr-flecha', 'aria-hidden': 'true' }, '▶'),
            h('span', null, h('b', { class: 'otr-nom' }, c.cliente), h('div', { class: 'apoyo' }, `${c.equipos.length} ${c.equipos.length === 1 ? 'equipo' : 'equipos'} · agente ${c.agentes.map((a) => a.nombre).join(', ')}`)),
            h('span', { class: 'otr-tags' }, resumen.length ? resumen : chip('Todo en orden', 'ok')),
            h('span', { class: 'apoyo num' }, vista === 'cont' && pags ? `${num(pags)} pág. este mes` : '')),
          abierto && h('div', { class: 'otr-det' }, !c.equipos.length ? h('p', { class: 'apoyo' }, 'Este cliente no tiene equipos de JustPrint instalados.')
            : vista === 'ins' ? h('div', { class: 'mon-grilla' }, c.equipos.map(tarjeta)) : tablaContadores(c)));
      }));
    }

    await cargar();
  }

  return { vistaMonitoreo };
}
