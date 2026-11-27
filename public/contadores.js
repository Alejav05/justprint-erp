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
    if (periodoParam === 'otras') return vistaOtras(destino);
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
    const bandeja = h('div'); const lista = h('div'); const alta = h('div'); const recibidas = h('div'); const parque = h('div');
    agregar(destino, [
      encabezado('Toma automática de contadores', 'Un agente instalado en la red de cada cliente lee los contadores por SNMP a fin de mes y los manda acá. Las lecturas normales entran solas; las dudosas esperan revisión.',
        h('a', { class: 'btn', href: '#/contadores' }, 'Volver a Contadores')),
      bandeja, lista, parque, recibidas, alta]);

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
              try { await api(ruta, { metodo: 'POST', cuerpo }); aviso('Listo'); await Promise.all([pintarBandeja(), pintarRecibidas()]); } catch (e) { if (e.message === 'sesion') return; err.textContent = ERR_REV[e.message] ?? 'No se pudo guardar.'; err.classList.remove('oculto'); }
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

    const ESTADO_REC = { aprobada: ['Cargada', 'ok'], a_revisar: ['A revisar', 'aviso'], rechazada: ['Rechazada', 'malo'], no_registrado: ['No es nuestro', 'mudo'], prueba: ['Prueba', 'mudo'] };
    async function pintarRecibidas() {
      const filas = await api('/api/contadores/recibidas?estado=todas').catch(() => null);
      vaciar(recibidas);
      if (!filas) return;
      const ultimas = filas.filter((f) => f.estado !== 'no_registrado').slice(0, 30);
      recibidas.append(h('div', { class: 'tarjeta', style: 'margin-top:16px' }, h('h2', null, 'Últimas lecturas recibidas'),
        ultimas.length ? h('table', null, h('thead', null, h('tr', null, ['Recibida', 'Cliente', 'Equipo', 'Negro', 'Color', 'Estado'].map((t) => h('th', null, t)))),
          h('tbody', null, ultimas.map((f) => {
            const [txt, tipo] = ESTADO_REC[f.estado] ?? [f.estado, 'mudo'];
            return h('tr', null,
              h('td', { 'data-rotulo': 'Recibida' }, fecha(f.fecha), h('div', { class: 'apoyo' }, f.periodo ? `período ${f.periodo}` : 'sin período')),
              h('td', { 'data-rotulo': 'Cliente' }, f.cliente, h('div', { class: 'apoyo' }, f.agente)),
              h('td', { 'data-rotulo': 'Equipo' }, f.serie_equipo ?? f.numero_serie ?? '—', h('div', { class: 'apoyo' }, [f.marca_equipo ? `${f.marca_equipo} ${f.modelo_equipo}` : f.modelo, f.ip].filter(Boolean).join(' · '))),
              h('td', { 'data-rotulo': 'Negro', class: 'num' }, f.contador_negro != null ? num(f.contador_negro) : '—'),
              h('td', { 'data-rotulo': 'Color', class: 'num' }, f.contador_color != null ? num(f.contador_color) : '—'),
              h('td', { 'data-rotulo': 'Estado' }, chip(txt, tipo), f.motivo && h('div', { class: 'apoyo' }, MOTIVO[f.motivo] ?? f.motivo)));
          })))
          : h('p', { class: 'apoyo' }, 'Todavía no llegó ninguna lectura. Con "Probar" en el agente aparece acá como prueba.')));
    }

    async function pintarParque() {
      const filas = await api('/api/contadores/parque').catch(() => null);
      vaciar(parque);
      if (!filas?.length) return;
      const clientes = new Set(filas.map((f) => f.cliente_id)).size;
      parque.append(h('div', { class: 'tarjeta', style: 'margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap' },
        h('div', null, h('h2', { style: 'margin:0' }, 'Otras impresoras en los clientes'),
          h('p', { class: 'apoyo', style: 'margin:4px 0 0' }, `Los agentes encontraron ${filas.length} ${filas.length === 1 ? 'equipo' : 'equipos'} que no son de JustPrint en ${clientes} ${clientes === 1 ? 'cliente' : 'clientes'}.`)),
        h('a', { class: 'btn', href: '#/contadores/otras' }, 'Ver por cliente')));
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
            h('td', { 'data-rotulo': 'Lecturas' }, `${a.lecturas.aprobada ?? 0} cargadas${a.lecturas.prueba ? ` · ${a.lecturas.prueba} de prueba` : ''}`, (a.lecturas.a_revisar ?? 0) ? h('div', null, chip(`${a.lecturas.a_revisar} a revisar`, 'aviso')) : null),
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

    async function pintarAlta() {
      if (!puedeAdministrar) return;
      // Todos los clientes que no están inactivos, ordenados por nombre (la API entrega de a 100).
      let clientes = []; let pagina = 1;
      for (;;) {
        const r = await api(`/api/clientes?limite=100&pagina=${pagina}`).catch(() => null); if (!r) break;
        clientes.push(...r.clientes); if (clientes.length >= r.total || !r.clientes.length) break; pagina += 1;
      }
      clientes = clientes.filter((c) => c.estado !== 'inactivo').sort((a, b) => (a.nombre_comercial || a.razon_social).localeCompare(b.nombre_comercial || b.razon_social, 'es'));
      const selCli = h('select', { 'aria-label': 'Cliente' }, h('option', { value: '' }, 'Elegí un cliente'), clientes.map((c) => h('option', { value: String(c.id) }, c.nombre_comercial || c.razon_social)));
      const nombreAg = h('input', { type: 'text', maxlength: '120', placeholder: 'Ej.: Oficina central', 'aria-label': 'Nombre del agente' });
      const err = h('div', { class: 'error oculto', role: 'alert' });
      vaciar(alta).append(h('form', { class: 'tarjeta formulario', style: 'margin-top:16px', onsubmit: async (ev) => {
        ev.preventDefault(); err.classList.add('oculto');
        const c = clientes.find((x) => String(x.id) === selCli.value);
        if (!c) { err.textContent = 'Elegí el cliente.'; err.classList.remove('oculto'); return; }
        const nombre = nombreAg.value.trim() || 'Agente';
        try { const r = await api('/api/contadores/agentes', { metodo: 'POST', cuerpo: { cliente_id: c.id, nombre } }); mostrarToken(c.nombre_comercial || c.razon_social, nombre, r.token); } catch (e) { if (e.message === 'sesion') return; err.textContent = 'No se pudo dar de alta.'; err.classList.remove('oculto'); }
      } }, h('h2', null, 'Nuevo agente'), h('div', { class: 'dos-col' }, h('label', null, 'Cliente ', selCli), h('label', null, 'Nombre ', nombreAg)), err,
        h('button', { class: 'btn btn-principal', type: 'submit' }, 'Dar de alta y generar token')));
    }

    await Promise.all([pintarBandeja(), pintarLista(), pintarParque(), pintarRecibidas(), pintarAlta()]);
  }

  /** Impresoras de los clientes que no son de JustPrint, agrupadas por cliente, para ofrecerles el servicio. */
  async function vistaOtras(destino) {
    const ALTO = 5000;
    const cuerpo = h('div');
    agregar(destino, [encabezado('Otras impresoras en los clientes', 'Equipos que los agentes encontraron en la red de cada cliente y que no son de JustPrint: propios del cliente o de otro proveedor. Los clientes que más imprimen aparecen primero.',
      h('a', { class: 'btn', href: '#/contadores/agentes' }, 'Volver a Toma automática')), cuerpo]);
    cuerpo.append(cargando());
    const filas = await api('/api/contadores/parque').catch(() => null);
    vaciar(cuerpo);
    if (!filas) { cuerpo.append(h('div', { class: 'vacio' }, 'No se pudo cargar el listado.')); return; }
    if (!filas.length) { cuerpo.append(h('div', { class: 'tarjeta vacio' }, 'Todavía no apareció ninguna. Se completa sola con cada toma de los agentes.')); return; }

    const grupos = new Map();
    for (const f of filas) {
      if (!grupos.has(f.cliente_id)) grupos.set(f.cliente_id, { id: f.cliente_id, nombre: f.cliente, agentes: new Set(), justprint: f.equipos_justprint ?? 0, equipos: [] });
      const g = grupos.get(f.cliente_id); g.equipos.push(f); if (f.agente) g.agentes.add(f.agente);
    }
    const clientes = [...grupos.values()];
    const marcaDe = (e) => e.marca ?? 'Sin marca';
    const volumen = (eqs) => eqs.reduce((a, e) => a + (e.paginas_por_mes ?? 0), 0);
    const total = volumen(filas);
    const porMarca = [...filas.reduce((m, e) => m.set(marcaDe(e), (m.get(marcaDe(e)) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
    const PALETA = ['#00BCD4', '#0D1B2A', '#2FB37A', '#F0B429', '#E5484D', '#7A4FBF', '#007E8C', '#6B7C88'];
    const colorMarca = new Map(porMarca.map(([m], i) => [m, m === 'Sin marca' ? '#B5C2CC' : PALETA[i % PALETA.length]]));
    const kpi = (rotulo, valor) => h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, valor));

    const q = h('input', { type: 'search', placeholder: 'Buscar cliente, modelo o serie', 'aria-label': 'Buscar', style: 'flex:1 1 240px;max-width:none' });
    const orden = h('select', { 'aria-label': 'Ordenar' }, [['vol', 'Más páginas por mes'], ['eq', 'Más equipos'], ['nom', 'Cliente (A a Z)'], ['vis', 'Visto hace más tiempo']].map(([v, t]) => h('option', { value: v }, t)));
    const btnTodos = h('button', { type: 'button', class: 'btn' }, 'Abrir todos');
    let marca = null;
    const chips = h('div', { class: 'otr-chips' });
    const pintarChips = () => vaciar(chips).append(...['Todas', ...porMarca.map((x) => x[0])].map((m) => h('button', { type: 'button', class: 'otr-chip', 'aria-pressed': String((m === 'Todas' && !marca) || m === marca), onclick: () => { marca = m === 'Todas' ? null : m; pintarChips(); pintar(); } }, m)));
    const cuenta = h('div', { class: 'apoyo', style: 'margin:12px 0 8px' });
    const lista = h('div');
    let visibles = [];
    const abiertos = new Set([clientes.reduce((a, c) => (volumen(c.equipos) > volumen(a.equipos) ? c : a)).id]);

    function csv() {
      const cols = [['Cliente', 'cliente'], ['Equipos de JustPrint', 'equipos_justprint'], ['Marca', 'marca'], ['Modelo', 'modelo'], ['Serie', 'numero_serie'], ['IP', 'ip'], ['Visto por primera vez', 'visto_primero'], ['Visto por última vez', 'visto_ultimo'], ['Contador negro', 'contador_negro'], ['Contador color', 'contador_color'], ['Contador total', 'contador_total'], ['Páginas por mes (estimado)', 'paginas_por_mes']];
      const esc = (v) => (v == null ? '' : /[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const txt = [cols.map((c) => c[0]), ...filas.map((f) => cols.map((c) => f[c[1]]))].map((r) => r.map(esc).join(';')).join('\r\n');
      const a = h('a', { href: URL.createObjectURL(new Blob(['\ufeff' + txt], { type: 'text/csv;charset=utf-8' })), download: `otras-impresoras-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.append(a); a.click(); a.remove();
    }

    function pintar() {
      const t = q.value.trim().toLowerCase();
      const ls = clientes.map((c) => ({ ...c, equipos: c.equipos.filter((e) => (!marca || marcaDe(e) === marca) && (!t || c.nombre.toLowerCase().includes(t) || `${e.marca ?? ''} ${e.modelo ?? ''} ${e.numero_serie ?? ''} ${e.ip ?? ''}`.toLowerCase().includes(t))) })).filter((c) => c.equipos.length);
      const primero = (c) => c.equipos.map((e) => e.visto_ultimo).sort()[0];
      const cmp = { eq: (a, b) => b.equipos.length - a.equipos.length, nom: (a, b) => a.nombre.localeCompare(b.nombre, 'es'), vis: (a, b) => (primero(a) < primero(b) ? -1 : 1), vol: (a, b) => volumen(b.equipos) - volumen(a.equipos) || a.nombre.localeCompare(b.nombre, 'es') };
      ls.sort(cmp[orden.value]); visibles = ls.map((c) => c.id);
      cuenta.textContent = `${ls.length} ${ls.length === 1 ? 'cliente' : 'clientes'} · ${ls.reduce((a, c) => a + c.equipos.length, 0)} equipos`;
      btnTodos.textContent = ls.length && ls.every((c) => abiertos.has(c.id)) ? 'Cerrar todos' : 'Abrir todos';
      vaciar(lista);
      if (!ls.length) { lista.append(h('div', { class: 'tarjeta vacio' }, 'No hay equipos que coincidan con la búsqueda.')); return; }
      const maxVol = Math.max(1, ...filas.map((e) => e.paginas_por_mes ?? 0));
      lista.append(...ls.map((c) => {
        const v = volumen(c.equipos); const abierto = abiertos.has(c.id);
        const marcas = [...new Set(c.equipos.map(marcaDe))]; const ult = c.equipos.map((e) => e.visto_ultimo).sort().at(-1);
        const sinEstimar = c.equipos.every((e) => e.paginas_por_mes == null);
        return h('section', { class: `tarjeta otr-cli${abierto ? ' abierto' : ''}` },
          h('button', { type: 'button', class: 'otr-cab', 'aria-expanded': String(abierto), onclick: () => { if (abiertos.has(c.id)) abiertos.delete(c.id); else abiertos.add(c.id); pintar(); } },
            h('span', { class: 'otr-flecha', 'aria-hidden': 'true' }, '▶'),
            h('span', null, h('b', { class: 'otr-nom' }, c.nombre), h('div', { class: 'apoyo' }, `${c.equipos.length} ${c.equipos.length === 1 ? 'equipo' : 'equipos'} de otros${c.agentes.size ? ` · agente ${[...c.agentes].join(', ')}` : ''}`)),
            h('span', { class: 'otr-tags' }, marcas.map((m) => chip(m, 'mudo')), c.justprint ? chip(`${c.justprint} de JustPrint`, 'ok') : chip('Sin equipos nuestros', 'info'), v > ALTO ? chip('Alto volumen', 'aviso') : null),
            h('span', { class: 'apoyo otr-visto' }, `visto ${fecha(ult)}`),
            h('span', { class: 'num' }, sinEstimar ? h('span', { class: 'apoyo' }, 'falta otra toma') : [h('b', { class: 'otr-vol' }, num(v)), h('div', { class: 'apoyo' }, 'pág./mes')])),
          abierto && h('div', { class: 'otr-det' }, h('table', { class: 'tarjetas' },
            h('thead', null, h('tr', null, ['Equipo', 'Serie / IP', 'Visto', 'Contador', 'Páginas por mes'].map((x, i) => h('th', { class: i > 2 ? 'num' : null }, x)))),
            h('tbody', null, [...c.equipos].sort((a, b) => (b.paginas_por_mes ?? -1) - (a.paginas_por_mes ?? -1)).map((e) => h('tr', null,
              h('td', { 'data-rotulo': 'Equipo' }, h('div', null, h('b', null, marcaDe(e)), ' ', e.modelo ?? '', h('div', { class: 'apoyo' }, e.contador_color != null && e.contador_negro != null ? 'Color' : 'Monocromo o sin detalle'))),
              h('td', { 'data-rotulo': 'Serie / IP' }, h('div', null, e.numero_serie || '—', h('div', { class: 'apoyo' }, e.ip ?? ''))),
              h('td', { 'data-rotulo': 'Visto' }, h('div', null, fecha(e.visto_ultimo), h('div', { class: 'apoyo' }, e.tomas > 1 ? `${e.tomas} tomas desde ${fecha(e.visto_primero)}` : 'una toma'))),
              h('td', { 'data-rotulo': 'Contador', class: 'num' }, h('div', null, e.contador_total != null ? num(e.contador_total) : '—', e.contador_color != null && e.contador_negro != null && h('div', { class: 'apoyo' }, `${num(e.contador_negro)} negro · ${num(e.contador_color)} color`))),
              h('td', { 'data-rotulo': 'Páginas por mes', class: 'num' }, e.paginas_por_mes != null
                ? h('span', { class: 'otr-barra' }, h('i', { style: `width:${Math.max(4, Math.round((e.paginas_por_mes / maxVol) * 90))}px` }), num(e.paginas_por_mes))
                : h('span', { class: 'apoyo' }, 'falta otra toma'))))))));
      }));
    }

    btnTodos.addEventListener('click', () => {
      const cerrar = visibles.length && visibles.every((id) => abiertos.has(id));
      for (const id of visibles) { if (cerrar) abiertos.delete(id); else abiertos.add(id); }
      pintar();
    });
    q.addEventListener('input', pintar); orden.addEventListener('change', pintar);
    pintarChips();
    cuerpo.append(
      h('div', { class: 'rejilla kpis' }, kpi('Clientes con otras impresoras', num(clientes.length)), kpi('Equipos que no son de JustPrint', num(filas.length)), kpi('Páginas por mes estimadas', num(total)), kpi(`Clientes de más de ${num(ALTO)} pág./mes`, num(clientes.filter((c) => volumen(c.equipos) > ALTO).length))),
      h('div', { class: 'tarjeta', style: 'margin-bottom:16px' }, h('p', { class: 'etiqueta' }, 'Por marca'),
        h('div', { class: 'otr-marcas', role: 'img', 'aria-label': porMarca.map(([m, n]) => `${m} ${n}`).join(', ') }, porMarca.map(([m, n]) => h('i', { style: `background:${colorMarca.get(m)};width:${(n / filas.length) * 100}%`, title: `${m}: ${n}` }))),
        h('div', { class: 'otr-ley' }, porMarca.map(([m, n]) => h('span', { style: `--c:${colorMarca.get(m)}` }, `${m} ${n}`)))),
      h('div', { class: 'herramientas otr-filtros' }, q, orden, btnTodos, h('button', { type: 'button', class: 'btn btn-principal', onclick: csv }, 'Descargar planilla'), chips),
      cuenta, lista,
      h('p', { class: 'apoyo', style: 'margin-top:16px' }, `Las páginas por mes se estiman entre la primera y la última toma de cada equipo; hace falta casi un mes entre las dos. "Alto volumen" marca a los clientes que imprimen más de ${num(ALTO)} páginas por mes fuera de JustPrint. Solo aparecen impresoras de red que responden SNMP: las conectadas por USB no se ven.`));
    pintar();
  }

  return { vistaContadores };
}
