// Toma mensual de contadores: por período, cada equipo con su lectura anterior, lo que se carga y el consumo resultante.
export function crearContadores(U) {
  const { h, agregar, vaciar, api, chip, puede, cargando, encabezado, aviso, fecha } = U;

  const ERR = {
    contador_menor_al_anterior: 'Es menor que la lectura anterior.', contador_mayor_al_siguiente: 'Es mayor que una lectura posterior ya cargada.',
    contador_color_requerido: 'Falta el contador color.', equipo_monocromo: 'Es un equipo monocromo: no lleva contador color.', equipo_no_disponible: 'Ese equipo ya no está en un contrato vigente.',
    fecha_futura: 'La fecha no puede ser futura.', sin_permiso: 'No tenés permiso para cargar contadores.', validacion: 'Revisá los números.',
  };
  const mesActual = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
  const hoyISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const mesAnterior = () => { const [a, m] = mesActual().split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; };
  // Los primeros días del mes se carga el mes que cerró; después, el mes en curso.
  const periodoSugerido = () => (Number(hoyISO().slice(8, 10)) <= 10 ? mesAnterior() : mesActual());
  const num = (n) => Number(n ?? 0).toLocaleString('es-AR');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const nombrePeriodo = (p) => { const [a, m] = p.split('-').map(Number); return `${MESES[m - 1]} de ${a}`; };
  const ESTADO = { completo: ['Completo', 'ok'], parcial: ['Faltan algunos', 'aviso'], pendiente: ['Sin cargar', 'malo'] };

  async function vistaContadores(destino, periodoParam, clienteParam) {
    if (periodoParam === 'agentes') return vistaAgentes(destino);
    const clienteId = /^\d+$/.test(clienteParam ?? '') ? clienteParam : null;
    const periodo = /^\d{4}-\d{2}$/.test(periodoParam ?? '') ? periodoParam : periodoSugerido();
    const puedeCargar = puede('contadores.cargar');
    const per = h('input', { type: 'month', value: periodo, 'aria-label': 'Período a cargar' });
    const fechaLectura = h('input', { type: 'date', value: hoyISO(), max: hoyISO(), 'aria-label': 'Fecha de la lectura' });
    const origen = h('select', { 'aria-label': 'Quién informó' }, [['tecnico', 'Técnico'], ['cliente', 'Cliente']].map(([v, t]) => h('option', { value: v }, t)));
    const buscar = h('input', { type: 'search', placeholder: 'Buscar cliente', 'aria-label': 'Buscar cliente' });
    let soloPendientes = false;
    const avisoRevisar = h('div');
    api('/api/contadores/recibidas').then((r) => { if (r.length) avisoRevisar.append(h('div', { class: 'tarjeta', role: 'status', style: 'margin:16px 0;display:flex;gap:12px;align-items:center;justify-content:space-between' }, h('span', null, h('b', null, `${r.length} ${r.length === 1 ? 'lectura automática espera' : 'lecturas automáticas esperan'} revisión. `), 'Hasta que alguien las apruebe no cuentan para la factura.'), h('a', { class: 'btn', href: '#/contadores/agentes' }, 'Revisar'))); }).catch(() => {});
    const zona = h('div'); const resumen = h('div'); const barra = h('div', { class: 'barra-guardar' }); const problemas = h('div');
    const cambios = new Map(); // equipo_id -> { negro, color, fila }
    let datos = null; const errores = new Map(); const equipoPorId = new Map(); const facturadoPorEquipo = new Map();

    agregar(destino, [
      encabezado('Contadores', 'Toma mensual por cliente. Se carga a fin de mes o la primera semana del siguiente y alimenta la factura de ese mes.',
        h('a', { class: 'btn', href: '#/contadores/agentes' }, 'Toma automática')),
      avisoRevisar,
      h('div', { class: 'tarjeta herramientas', style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end' },
        h('label', null, 'Período a facturar ', per),
        puedeCargar && h('label', null, 'Fecha de la lectura ', fechaLectura),
        puedeCargar && h('label', null, 'Quién informó ', origen),
        h('label', null, 'Cliente ', buscar),
        h('button', { type: 'button', class: 'btn', onclick: () => { soloPendientes = !soloPendientes; pintar(); boton.textContent = soloPendientes ? 'Ver todos' : 'Solo pendientes'; } }, 'Solo pendientes')),
      resumen, problemas, zona, barra]);
    const boton = destino.querySelector('.herramientas .btn');

    const clasificar = (e, v) => { // estado visual de un equipo según lo tipeado
      if (v) {
        const n = v.negro; const c = e.tipo === 'color' ? v.color : 0;
        if (n === null || (e.tipo === 'color' && c === null)) return null;
        return { negro: Math.max(0, n - e.base.negro), color: e.tipo === 'color' ? Math.max(0, c - e.base.color) : 0, menor: n < e.base.negro || (e.tipo === 'color' && c < e.base.color) };
      }
      return e.consumo ? { ...e.consumo, menor: false } : null;
    };

    function filaEquipo(e, facturado) {
      const inN = h('input', { type: 'number', min: '0', inputmode: 'numeric', value: e.actual?.negro ?? '', placeholder: String(e.base.negro), 'aria-label': `Contador negro ${e.serie}`, disabled: !puedeCargar });
      const inC = h('input', { type: 'number', min: '0', inputmode: 'numeric', value: e.tipo === 'color' ? (e.actual?.color ?? '') : '', placeholder: e.tipo === 'color' ? String(e.base.color) : '—', 'aria-label': `Contador color ${e.serie}`, disabled: !puedeCargar || e.tipo !== 'color' });
      const consumo = h('td', { class: 'num', 'data-rotulo': 'Consumo' }); const estadoTd = h('td', { 'data-rotulo': 'Estado' });
      const valor = (i) => (i.value === '' ? null : Number(i.value));
      const pintarFila = () => {
        const v = { negro: valor(inN), color: valor(inC) };
        const sucio = v.negro !== null && (v.negro !== (e.actual?.negro ?? null) || (e.tipo === 'color' && v.color !== (e.actual?.color ?? null)));
        const k = clasificar(e, v.negro === null ? null : v);
        const largo = !sucio && e.consumo?.meses > 1 ? h('div', { class: 'apoyo' }, `${e.consumo.meses} meses`) : null;
        vaciar(consumo).append(k ? h('span', { class: k.menor ? 'neg' : '' }, e.tipo === 'color' ? `${num(k.negro)} / ${num(k.color)}` : num(k.negro)) : '—', ...(largo ? [largo] : []));
        vaciar(estadoTd);
        const err = errores.get(e.equipo_id);
        if (err) estadoTd.append(chip('No se guardó', 'malo'), h('div', { class: 'apoyo neg', role: 'alert' }, err));
        else if (k?.menor) estadoTd.append(chip('Menor al anterior', 'malo'));
        else if (sucio) estadoTd.append(chip(e.actual ? 'Corrección sin guardar' : 'Sin guardar', 'aviso'));
        else if (e.actual) {
          estadoTd.append(chip('Cargado', 'ok'), h('div', { class: 'apoyo' }, `${fecha(e.actual.fecha)} · ${e.actual.origen === 'cliente' ? 'informó el cliente' : e.actual.origen === 'automatica' ? (e.actual.usuario ? `agente, aprobó ${e.actual.usuario}` : 'agente automático') : e.actual.usuario ?? 'técnico'}`));
          if (e.alerta === 'cero') estadoTd.append(h('div', { class: 'apoyo neg' }, 'Consumo 0: revisá si el equipo está parado.'));
          if (e.alerta === 'alto') estadoTd.append(h('div', { class: 'apoyo neg' }, `Consumo muy por encima de lo habitual (${num(e.promedio)} páginas).`));
        } else {
          estadoTd.append(chip('Pendiente', 'mudo'));
          if (e.candidata && puedeCargar) {
            const c = e.candidata;
            const usar = h('button', { type: 'button', class: 'btn', onclick: async () => {
              usar.disabled = true;
              try { await api('/api/contadores/asignar', { metodo: 'POST', cuerpo: { periodo: per.value, lectura_ids: [c.id] } }); aviso('Lectura asignada al período'); await cargar(); }
              catch (x) { if (x.message !== 'sesion') aviso('No se pudo asignar la lectura.'); usar.disabled = false; }
            } }, `Usar para ${nombrePeriodo(per.value).split(' de ')[0]}`);
            estadoTd.append(h('div', { class: 'apoyo' }, `Ya hay una lectura del ${fecha(c.fecha)}: ${e.tipo === 'color' ? `${num(c.negro)} / ${num(c.color)}` : num(c.negro)} (cargada en otro módulo).`), usar);
          }
        }
        if (sucio && v.negro !== null && !(e.tipo === 'color' && v.color === null)) cambios.set(e.equipo_id, { equipo_id: e.equipo_id, contador_negro: v.negro, ...(e.tipo === 'color' ? { contador_color: v.color } : {}) });
        else cambios.delete(e.equipo_id);
        pintarBarra();
      };
      for (const i of [inN, inC]) i.addEventListener('input', () => { errores.delete(e.equipo_id); pintarFila(); });
      queueMicrotask(pintarFila);
      return h('tr', null,
        h('td', { 'data-rotulo': 'Equipo' }, h('div', { class: 'nombre-cliente' }, e.serie), h('div', { class: 'apoyo' }, `${e.modelo}${e.sede ? ` · ${e.sede}` : ''}`), e.domicilio && h('div', { class: 'apoyo' }, e.domicilio)),
        h('td', { class: 'num', 'data-rotulo': 'Lectura anterior' }, e.tipo === 'color' ? `${num(e.base.negro)} / ${num(e.base.color)}` : num(e.base.negro)),
        h('td', { 'data-rotulo': 'Negro' }, inN), h('td', { 'data-rotulo': 'Color' }, inC), consumo, estadoTd);
    }

    function pintar() {
      cambios.clear(); vaciar(zona);
      const q = buscar.value.trim().toLowerCase();
      const lista = datos.clientes.filter((c) => (!soloPendientes || c.estado !== 'completo') && (!q || c.cliente.toLowerCase().includes(q)));
      if (!lista.length) { zona.append(h('div', { class: 'tarjeta vacio', style: 'margin-top:16px' }, h('b', null, datos.clientes.length ? 'No hay clientes con ese filtro' : 'No hay equipos instalados en contratos vigentes en este período'), datos.clientes.length ? 'Probá sacando el filtro.' : 'Cuando un equipo se instala en un contrato, aparece acá.')); pintarBarra(); return; }
      for (const c of lista) {
        const [t, tipo] = ESTADO[c.estado];
        zona.append(h('div', { class: 'tarjeta', style: 'margin-top:16px;padding:6px 8px' },
          h('div', { style: 'display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 8px 4px;flex-wrap:wrap' },
            h('h2', { style: 'margin:0' }, h('a', { href: `#/clientes/${c.cliente_id}` }, c.cliente)), h('div', null, chip(t, tipo), ' ', h('span', { class: 'apoyo' }, `${c.cargados} de ${c.equipos} equipos`))),
          c.contratos.map((k) => h('div', null,
            c.contratos.length > 1 || k.franquicia_negro != null ? h('div', { class: 'apoyo', style: 'padding:6px 8px' }, `${k.contrato}${k.franquicia_negro != null ? ` · franquicia ${num(k.franquicia_negro)} negro${k.franquicia_color ? ` / ${num(k.franquicia_color)} color` : ''}` : ''}`) : null,
            h('table', { class: 'tarjetas' }, h('thead', null, h('tr', null, ['Equipo', 'Lectura anterior', 'Negro', 'Color', 'Consumo', 'Estado'].map((x, i) => h('th', { class: i === 1 || i === 4 ? 'num' : '' }, x)))),
              h('tbody', null, k.equipos.map((e) => filaEquipo(e, k.facturado)))))))); }
      pintarBarra();
    }

    function pintarBarra() {
      vaciar(barra);
      if (!puedeCargar) return;
      const n = cambios.size;
      const guardar = h('button', { type: 'button', class: 'btn btn-principal', disabled: !n }, n ? `Guardar ${n} ${n === 1 ? 'lectura' : 'lecturas'}` : 'Sin cambios para guardar');
      guardar.addEventListener('click', async () => {
        const correcciones = [...cambios.values()].map((c) => ({ c, e: equipoPorId.get(c.equipo_id) })).filter(({ e }) => e?.actual);
        if (correcciones.length) {
          const lineas = correcciones.map(({ c, e }) => `• ${e.serie}: ${num(e.actual.negro)}${e.tipo === 'color' ? ` / ${num(e.actual.color)}` : ''} → ${num(c.contador_negro)}${e.tipo === 'color' ? ` / ${num(c.contador_color)}` : ''}`).join('\n');
          const facturadas = correcciones.some(({ e }) => facturadoPorEquipo.get(e.equipo_id));
          const texto = `Vas a cambiar ${correcciones.length === 1 ? 'una lectura ya cargada' : `${correcciones.length} lecturas ya cargadas`}:\n\n${lineas}\n\nEl consumo del período se recalcula con el nuevo valor.${facturadas ? '\n\nAtención: este período ya tiene factura emitida. La factura no se modifica; si el consumo cambia, hay que ajustarla aparte.' : ''}\n\n¿Confirmás el cambio?`;
          if (!confirm(texto)) return;
        }
        guardar.disabled = true;
        try {
          const r = await api('/api/contadores/lecturas', { metodo: 'POST', cuerpo: { periodo: per.value, lecturas: [...cambios.values()].map((c) => ({ ...c, fecha: fechaLectura.value || undefined, origen: origen.value })) } });
          aviso(`Se guardaron ${r.guardadas.length} ${r.guardadas.length === 1 ? 'lectura' : 'lecturas'}`);
          await cargar(r.errores);
        } catch (e) {
          if (e.message === 'sesion') return;
          if (e.datos?.errores) { await cargar(e.datos.errores); } else { aviso('No se pudo guardar. Probá de nuevo.'); guardar.disabled = false; }
        }
      });
      barra.append(guardar);
    }

    async function cargar(erroresServidor = []) {
      vaciar(zona).append(cargando()); errores.clear(); vaciar(problemas);
      datos = await api(`/api/contadores?periodo=${per.value}${clienteId ? `&cliente=${clienteId}` : ''}`).catch(() => null);
      if (!datos) { vaciar(zona).append(h('div', { class: 'vacio' }, h('b', null, 'Algo salió mal'), 'No se pudo cargar esta pantalla.')); return; }
      const nombre = new Map(datos.clientes.flatMap((c) => c.contratos.flatMap((k) => k.equipos.map((e) => [e.equipo_id, `${c.cliente} · ${e.serie}`]))));
      equipoPorId.clear(); facturadoPorEquipo.clear();
      for (const c of datos.clientes) for (const k of c.contratos) for (const e of k.equipos) { equipoPorId.set(e.equipo_id, e); facturadoPorEquipo.set(e.equipo_id, k.facturado); }
      for (const x of erroresServidor) errores.set(x.equipo_id, ERR[x.error] ?? 'No se pudo guardar.');
      const r = datos.resumen;
      vaciar(resumen).append(h('div', { class: 'rejilla kpis', style: 'margin-top:16px' },
        h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, `Equipos cargados · ${nombrePeriodo(per.value)}`), h('div', { class: 'valor' }, `${r.cargados} de ${r.equipos}`)),
        h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'Clientes completos'), h('div', { class: 'valor' }, `${r.clientes_completos} de ${r.clientes}`)),
        h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'Pendientes'), h('div', { class: 'valor' }, String(r.pendientes)))));
      if (erroresServidor.length) vaciar(problemas).append(h('div', { class: 'error', role: 'alert', style: 'margin-top:16px' }, `Estas lecturas no se guardaron: ${erroresServidor.map((x) => `${nombre.get(x.equipo_id) ?? `equipo ${x.equipo_id}`} (${ERR[x.error] ?? 'error'})`).join('; ')}.`));
      pintar();
    }

    per.addEventListener('change', () => { if (per.value) { location.hash = `#/contadores/${per.value}${clienteId ? `/${clienteId}` : ''}`; } });
    buscar.addEventListener('input', () => datos && pintar());
    await cargar();
  }


  const MOTIVO = {
    consumo_alto: 'Consumo muy por encima del habitual', consumo_cero: 'Consumo en cero', contador_menor_al_anterior: 'El contador es menor que el anterior',
    contador_mayor_al_siguiente: 'Es mayor que una lectura posterior', fuera_de_fecha_de_corte: 'Tomada a mitad de mes, fuera del corte', faltan_contadores: 'El equipo no informó negro y color',
    equipo_de_otro_cliente: 'El número de serie es de un equipo de otro cliente', ya_tiene_lectura_manual: 'Ya había una lectura cargada a mano', serie_desconocida: 'Número de serie que no es nuestro', sin_numero_de_serie: 'El equipo no informó número de serie',
  };
  const ERR_REV = { no_esta_a_revisar: 'Ya fue revisada.', equipo_no_corresponde: 'El equipo no es de este cliente: rechazala y revisá la ficha.', equipo_no_disponible: 'Ese equipo ya no está en un contrato vigente.',
    contador_menor_al_anterior: 'Queda por debajo de una lectura anterior. Corregí los números o rechazala.', contador_mayor_al_siguiente: 'Queda por encima de una lectura posterior. Corregí los números o rechazala.',
    ya_tiene_lectura_manual: 'El período ya tiene una lectura cargada a mano.', faltan_contadores: 'Faltan contadores: cargalos antes de aprobar.' };
  const hace = (iso) => { if (!iso) return 'Nunca'; const t = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z')).getTime(); const min = Math.round((Date.now() - t) / 60000);
    return min < 60 ? `Hace ${Math.max(1, min)} min` : min < 1440 ? `Hace ${Math.round(min / 60)} h` : `Hace ${Math.round(min / 1440)} días`; };

  async function vistaAgentes(destino) {
    const puedeAdministrar = puede('contadores.agentes'); const puedeRevisar = puede('contadores.cargar');
    const bandeja = h('div'); const lista = h('div'); const alta = h('div');
    agregar(destino, [
      encabezado('Toma automática de contadores', 'Un agente instalado en la red de cada cliente lee los contadores por SNMP a fin de mes y los manda acá. Las lecturas normales entran solas; las dudosas esperan revisión.',
        h('a', { class: 'btn', href: '#/contadores' }, 'Volver a Contadores')),
      bandeja, lista, alta]);

    async function pintarBandeja() {
      vaciar(bandeja).append(cargando());
      const filas = await api('/api/contadores/recibidas').catch(() => null);
      vaciar(bandeja);
      if (!filas) { bandeja.append(h('div', { class: 'vacio' }, 'No se pudo cargar la bandeja.')); return; }
      if (!filas.length) { bandeja.append(h('div', { class: 'tarjeta', style: 'margin-top:16px' }, h('h2', null, 'A revisar'), h('p', { class: 'apoyo' }, 'No hay lecturas automáticas esperando revisión.'))); return; }
      bandeja.append(h('div', { class: 'tarjeta', style: 'margin-top:16px' }, h('h2', null, `A revisar (${filas.length})`),
        h('table', null, h('thead', null, h('tr', null, ['Cliente', 'Equipo', 'Leído', 'Última cargada', 'Motivo', ''].map((t) => h('th', null, t)))),
          h('tbody', null, filas.map((f) => {
            const color = f.tipo === 'color';
            const inN = h('input', { type: 'number', min: '0', value: f.contador_negro ?? '', placeholder: 'Negro', 'aria-label': 'Contador negro', style: 'width:110px', disabled: !puedeRevisar });
            const inC = color ? h('input', { type: 'number', min: '0', value: f.contador_color ?? '', placeholder: 'Color', 'aria-label': 'Contador color', style: 'width:110px', disabled: !puedeRevisar }) : null;
            const err = h('div', { class: 'error oculto', role: 'alert' });
            const accion = async (ruta, cuerpo) => {
              err.classList.add('oculto');
              try { await api(ruta, { metodo: 'POST', cuerpo }); aviso('Listo'); await pintarBandeja(); } catch (e) { if (e.message === 'sesion') return; err.textContent = ERR_REV[e.message] ?? 'No se pudo guardar.'; err.classList.remove('oculto'); }
            };
            const corregido = () => ({ contador_negro: Number(inN.value), ...(color ? { contador_color: Number(inC.value) } : {}) });
            const cambio = () => Number(inN.value) !== f.contador_negro || (color && Number(inC.value) !== f.contador_color);
            const u = f.ultima_del_equipo;
            return h('tr', null,
              h('td', { 'data-rotulo': 'Cliente' }, h('b', null, f.cliente), h('div', { class: 'apoyo' }, `${f.agente} · ${fecha(f.fecha)}${f.periodo ? ` · período ${f.periodo}` : ''}`)),
              h('td', { 'data-rotulo': 'Equipo' }, f.serie_equipo ?? f.numero_serie ?? '—', h('div', { class: 'apoyo' }, [f.marca_equipo ? `${f.marca_equipo} ${f.modelo_equipo}` : f.modelo, f.ip].filter(Boolean).join(' · '))),
              h('td', { 'data-rotulo': 'Leído' }, h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, inN, inC), f.contador_total != null && h('div', { class: 'apoyo' }, `Total informado ${num(f.contador_total)}`)),
              h('td', { 'data-rotulo': 'Última cargada', class: 'num' }, u ? `${num(u.negro)}${color ? ` / ${num(u.color)}` : ''}` : '—', u && h('div', { class: 'apoyo' }, `${fecha(u.fecha)} · ${u.origen}`)),
              h('td', { 'data-rotulo': 'Motivo' }, chip(MOTIVO[f.motivo] ?? f.motivo, 'aviso')),
              h('td', null, puedeRevisar && h('div', { style: 'display:flex;gap:6px' },
                h('button', { type: 'button', class: 'btn btn-principal', onclick: () => accion(`/api/contadores/recibidas/${f.id}/aprobar`, cambio() ? corregido() : {}) }, 'Aprobar'),
                h('button', { type: 'button', class: 'btn', onclick: () => accion(`/api/contadores/recibidas/${f.id}/rechazar`, {}) }, 'Rechazar')), err));
          })))));
    }

    async function pintarLista() {
      vaciar(lista).append(cargando());
      const agentes = await api('/api/contadores/agentes').catch(() => null);
      vaciar(lista);
      if (!agentes) { lista.append(h('div', { class: 'vacio' }, 'No se pudieron cargar los agentes.')); return; }
      lista.append(h('div', { class: 'tarjeta', style: 'margin-top:16px' }, h('h2', null, 'Agentes instalados'),
        agentes.length ? h('table', null, h('thead', null, h('tr', null, ['Cliente', 'Agente', 'Última conexión', 'Lecturas', ''].map((t) => h('th', null, t)))),
          h('tbody', null, agentes.map((a) => h('tr', null,
            h('td', { 'data-rotulo': 'Cliente' }, h('b', null, a.cliente)),
            h('td', { 'data-rotulo': 'Agente' }, a.nombre, h('div', { class: 'apoyo' }, [a.equipo_host, a.version && `v${a.version}`, `token …${a.token_pista}`].filter(Boolean).join(' · '))),
            h('td', { 'data-rotulo': 'Última conexión' }, a.activo ? hace(a.ultima_conexion) : chip('Desactivado', 'malo'), a.ultima_ip && h('div', { class: 'apoyo' }, a.ultima_ip)),
            h('td', { 'data-rotulo': 'Lecturas' }, `${a.lecturas.aprobada ?? 0} aprobadas`, (a.lecturas.a_revisar ?? 0) ? h('div', null, chip(`${a.lecturas.a_revisar} a revisar`, 'aviso')) : null),
            h('td', null, puedeAdministrar && h('div', { style: 'display:flex;gap:6px' },
              h('button', { type: 'button', class: 'btn-texto', onclick: async () => {
                if (!confirm('El token actual deja de funcionar en el acto. Vas a tener que cargar el nuevo en el agente. ¿Seguís?')) return;
                const r = await api(`/api/contadores/agentes/${a.id}/token`, { metodo: 'POST' }).catch(() => null);
                if (r) mostrarToken(a.cliente, a.nombre, r.token);
              } }, 'Nuevo token'),
              h('button', { type: 'button', class: 'btn-texto', onclick: async () => { await api(`/api/contadores/agentes/${a.id}`, { metodo: 'PATCH', cuerpo: { activo: !a.activo } }).catch(() => null); pintarLista(); } }, a.activo ? 'Desactivar' : 'Activar')))))))
          : h('p', { class: 'apoyo' }, 'Todavía no hay agentes. Dá de alta uno por cliente (o por sede, si tienen redes separadas).')));
    }

    function mostrarToken(cliente, nombre, token) {
      const campo = h('input', { type: 'text', readonly: true, value: token, style: 'width:100%;font-family:monospace', 'aria-label': 'Token del agente' });
      vaciar(alta).append(h('div', { class: 'tarjeta', role: 'alert', style: 'margin-top:16px' },
        h('h2', null, `Token de ${nombre} · ${cliente}`),
        h('p', null, 'Copialo ahora: no se vuelve a mostrar. En la PC del cliente, al instalar el agente, pegalo cuando lo pida (o usá ', h('code', null, 'agente-contadores configurar'), ').'),
        campo, h('div', { style: 'margin-top:8px' }, h('button', { type: 'button', class: 'btn', onclick: () => { campo.select(); navigator.clipboard?.writeText(token); aviso('Token copiado'); } }, 'Copiar'),
          ' ', h('button', { type: 'button', class: 'btn-texto', onclick: () => { vaciar(alta); pintarAlta(); } }, 'Listo, ya lo copié'))));
      pintarLista();
    }

    function pintarAlta() {
      if (!puedeAdministrar) return;
      const buscarCli = h('input', { type: 'search', placeholder: 'Buscar cliente', 'aria-label': 'Cliente', list: 'agente-clientes', autocomplete: 'off' });
      const opciones = h('datalist', { id: 'agente-clientes' }); let clientes = [];
      const nombreAg = h('input', { type: 'text', maxlength: '120', placeholder: 'Ej.: Oficina central', 'aria-label': 'Nombre del agente' });
      const err = h('div', { class: 'error oculto', role: 'alert' });
      buscarCli.addEventListener('input', async () => {
        const q = buscarCli.value.trim(); if (q.length < 2) return;
        const r = await api(`/api/clientes?estado=activo&limite=20&q=${encodeURIComponent(q)}`).catch(() => null); if (!r) return;
        clientes = r.clientes; vaciar(opciones).append(...clientes.map((c) => h('option', { value: c.nombre_comercial || c.razon_social })));
      });
      vaciar(alta).append(h('form', { class: 'tarjeta formulario', style: 'margin-top:16px', onsubmit: async (ev) => {
        ev.preventDefault(); err.classList.add('oculto');
        const c = clientes.find((x) => (x.nombre_comercial || x.razon_social) === buscarCli.value);
        if (!c) { err.textContent = 'Elegí el cliente de la lista.'; err.classList.remove('oculto'); return; }
        try { const r = await api('/api/contadores/agentes', { metodo: 'POST', cuerpo: { cliente_id: c.id, nombre: nombreAg.value.trim() || 'Agente' } }); mostrarToken(buscarCli.value, nombreAg.value.trim() || 'Agente', r.token); } catch (e) { if (e.message === 'sesion') return; err.textContent = 'No se pudo dar de alta.'; err.classList.remove('oculto'); }
      } }, h('h2', null, 'Nuevo agente'), h('div', { class: 'dos-col' }, h('label', null, 'Cliente ', buscarCli, opciones), h('label', null, 'Nombre ', nombreAg)), err,
        h('button', { class: 'btn btn-principal', type: 'submit' }, 'Dar de alta y generar token')));
    }

    await Promise.all([pintarBandeja(), pintarLista()]); pintarAlta();
  }

  return { vistaContadores };
}
