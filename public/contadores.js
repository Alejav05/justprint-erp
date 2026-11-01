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

  async function vistaContadores(destino, periodoParam) {
    const periodo = /^\d{4}-\d{2}$/.test(periodoParam ?? '') ? periodoParam : periodoSugerido();
    const puedeCargar = puede('contadores.cargar');
    const per = h('input', { type: 'month', value: periodo, 'aria-label': 'Período a cargar' });
    const fechaLectura = h('input', { type: 'date', value: hoyISO(), max: hoyISO(), 'aria-label': 'Fecha de la lectura' });
    const origen = h('select', { 'aria-label': 'Quién informó' }, [['tecnico', 'Técnico'], ['cliente', 'Cliente']].map(([v, t]) => h('option', { value: v }, t)));
    const buscar = h('input', { type: 'search', placeholder: 'Buscar cliente', 'aria-label': 'Buscar cliente' });
    let soloPendientes = false;
    const zona = h('div'); const resumen = h('div'); const barra = h('div', { class: 'barra-guardar' }); const problemas = h('div');
    const cambios = new Map(); // equipo_id -> { negro, color, fila }
    let datos = null; const errores = new Map();

    agregar(destino, [
      encabezado('Contadores', 'Toma mensual por cliente. Se carga a fin de mes o la primera semana del siguiente y alimenta la factura de ese mes.'),
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

    function filaEquipo(e) {
      const inN = h('input', { type: 'number', min: '0', inputmode: 'numeric', value: e.actual?.negro ?? '', placeholder: String(e.base.negro), 'aria-label': `Contador negro ${e.serie}`, disabled: !puedeCargar });
      const inC = h('input', { type: 'number', min: '0', inputmode: 'numeric', value: e.tipo === 'color' ? (e.actual?.color ?? '') : '', placeholder: e.tipo === 'color' ? String(e.base.color) : '—', 'aria-label': `Contador color ${e.serie}`, disabled: !puedeCargar || e.tipo !== 'color' });
      const consumo = h('td', { class: 'num', 'data-rotulo': 'Consumo' }); const estadoTd = h('td', { 'data-rotulo': 'Estado' });
      const valor = (i) => (i.value === '' ? null : Number(i.value));
      const pintarFila = () => {
        const v = { negro: valor(inN), color: valor(inC) };
        const sucio = v.negro !== null && (v.negro !== (e.actual?.negro ?? null) || (e.tipo === 'color' && v.color !== (e.actual?.color ?? null)));
        const k = clasificar(e, v.negro === null ? null : v);
        vaciar(consumo).append(k ? h('span', { class: k.menor ? 'neg' : '' }, e.tipo === 'color' ? `${num(k.negro)} / ${num(k.color)}` : num(k.negro)) : '—');
        vaciar(estadoTd);
        const err = errores.get(e.equipo_id);
        if (err) estadoTd.append(chip('No se guardó', 'malo'), h('div', { class: 'apoyo neg', role: 'alert' }, err));
        else if (k?.menor) estadoTd.append(chip('Menor al anterior', 'malo'));
        else if (sucio) estadoTd.append(chip(e.actual ? 'Corrección sin guardar' : 'Sin guardar', 'aviso'));
        else if (e.actual) {
          estadoTd.append(chip('Cargado', 'ok'), h('div', { class: 'apoyo' }, `${fecha(e.actual.fecha)} · ${e.actual.origen === 'cliente' ? 'informó el cliente' : e.actual.usuario ?? 'técnico'}`));
          if (e.alerta === 'cero') estadoTd.append(h('div', { class: 'apoyo neg' }, 'Consumo 0: revisá si el equipo está parado.'));
          if (e.alerta === 'alto') estadoTd.append(h('div', { class: 'apoyo neg' }, `Consumo muy por encima de lo habitual (${num(e.promedio)} páginas).`));
        } else estadoTd.append(chip('Pendiente', 'mudo'));
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
              h('tbody', null, k.equipos.map(filaEquipo))))))); }
      pintarBarra();
    }

    function pintarBarra() {
      vaciar(barra);
      if (!puedeCargar) return;
      const n = cambios.size;
      const guardar = h('button', { type: 'button', class: 'btn btn-principal', disabled: !n }, n ? `Guardar ${n} ${n === 1 ? 'lectura' : 'lecturas'}` : 'Sin cambios para guardar');
      guardar.addEventListener('click', async () => {
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
      datos = await api(`/api/contadores?periodo=${per.value}`).catch(() => null);
      if (!datos) { vaciar(zona).append(h('div', { class: 'vacio' }, h('b', null, 'Algo salió mal'), 'No se pudo cargar esta pantalla.')); return; }
      const nombre = new Map(datos.clientes.flatMap((c) => c.contratos.flatMap((k) => k.equipos.map((e) => [e.equipo_id, `${c.cliente} · ${e.serie}`]))));
      for (const x of erroresServidor) errores.set(x.equipo_id, ERR[x.error] ?? 'No se pudo guardar.');
      const r = datos.resumen;
      vaciar(resumen).append(h('div', { class: 'rejilla kpis', style: 'margin-top:16px' },
        h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, `Equipos cargados · ${nombrePeriodo(per.value)}`), h('div', { class: 'valor' }, `${r.cargados} de ${r.equipos}`)),
        h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'Clientes completos'), h('div', { class: 'valor' }, `${r.clientes_completos} de ${r.clientes}`)),
        h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, 'Pendientes'), h('div', { class: 'valor' }, String(r.pendientes)))));
      if (erroresServidor.length) vaciar(problemas).append(h('div', { class: 'error', role: 'alert', style: 'margin-top:16px' }, `Estas lecturas no se guardaron: ${erroresServidor.map((x) => `${nombre.get(x.equipo_id) ?? `equipo ${x.equipo_id}`} (${ERR[x.error] ?? 'error'})`).join('; ')}.`));
      pintar();
    }

    per.addEventListener('change', () => { if (per.value) { location.hash = `#/contadores/${per.value}`; } });
    buscar.addEventListener('input', () => datos && pintar());
    await cargar();
  }

  return { vistaContadores };
}
