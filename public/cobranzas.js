// Cobranzas y negocio del cliente. Recibe las utilidades de app.js para no depender de ellas por importación.
export function crearCobranzas(U) {
  const { h, agregar, vaciar, api, usd, usd2, monto, fecha, chip, puede, cargando, falla, encabezado, estado, nombreMes, mesCorto } = U;

  const ERR = {
    promesa_sin_fecha: 'Para una promesa de pago, indicá la fecha prometida.', proxima_en_el_pasado: 'El seguimiento tiene que ser desde hoy en adelante.', fecha_futura: 'La fecha no puede ser futura.',
    sin_comercial: 'Esta cuenta no tiene comercial asignado. Asignalo desde la ficha del cliente, en Cartera.', ya_escalada: 'Esta factura ya está con el comercial.', no_escalada: 'Esta factura no está con el comercial.',
    sin_permiso: 'No tenés permiso para hacer esto.', no_encontrado: 'Esa factura ya no está pendiente de cobro.', no_emitida: 'La factura todavía no está emitida.',
  };
  const msg = (e) => ERR[e.datos?.error] ?? 'No se pudo guardar. Probá de nuevo.';
  const hoyISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const mas = (n) => new Date(Date.parse(hoyISO()) + n * 86400000).toISOString().slice(0, 10);
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const GRACIA_FALLBACK = 15;
  let gracia = GRACIA_FALLBACK;

  const COLOR = { verde: 'En plazo', amarillo: 'Vencida', rojo: 'Muy vencida' };
  const GESTION = { sin_gestion: ['Sin gestionar', 'mudo'], en_gestion: ['En gestión', 'info'], promesa: ['Prometió pagar', 'verde'], escalada: ['Con el comercial', 'info'] };

  function aviso(texto) {
    document.querySelector('.aviso-flotante')?.remove();
    const el = h('div', { class: 'aviso-flotante', role: 'status' }, texto); document.body.append(el);
    setTimeout(() => el.remove(), 3200);
  }

  /** "La regla": cuánto del plazo pasó. Tres tramos (plazo, gracia, más allá) y una marca en el día de hoy. */
  function regla(i, grande = false) {
    const cola = gracia; const total = i.plazo + gracia + cola;
    const pos = Math.max(0, Math.min(total, i.plazo + i.dias_vencida));
    const p = (n) => `${(n / total) * 100}%`;
    const d = Math.abs(i.dias_vencida);
    const texto = i.dias_vencida > 0 ? `Venció hace ${plural(d, 'día', 'días')}` : i.dias_vencida === 0 ? 'Vence hoy' : `Vence en ${plural(d, 'día', 'días')}`;
    return h('div', { class: `regla sem-${i.color} ${grande ? 'grande' : ''}`, role: 'img', 'aria-label': `${texto}${i.vence ? `, el ${fecha(i.vence)}` : ''}. ${COLOR[i.color]}.` },
      h('div', { class: 'pista' }, h('div', { class: 'tramo t-plazo', style: `width:${p(i.plazo)}` }), h('div', { class: 'tramo t-gracia', style: `width:${p(gracia)}` }), h('div', { class: 'tramo t-mas', style: `width:${p(cola)}` }),
        h('span', { class: 'hoy', style: `left:${p(pos)}` })),
      grande && h('div', { class: 'marcas' }, h('span', null, `Emitida ${fecha(i.emision)}`), h('span', null, `Vence ${fecha(i.vence)}`)),
      h('div', { class: 'texto' }, texto, !grande && i.vence ? ` · ${fecha(i.vence)}` : ''));
  }

  const chipGestion = (i) => {
    const [t, tipo] = GESTION[i.estado_gestion] ?? GESTION.sin_gestion;
    const extra = i.estado_gestion === 'escalada' && i.comercial ? `Con ${i.comercial.nombre.split(' ')[0]}` : i.estado_gestion === 'promesa' && i.proxima_gestion ? `Pagaría el ${fecha(i.proxima_gestion)}` : t;
    return chip(extra, tipo);
  };

  /* ---------- pantalla ---------- */
  async function vistaCobranzas(destino) {
    let datos = await api('/api/cobranzas/semaforo'); gracia = datos.gracia ?? GRACIA_FALLBACK;
    const soloEsc = datos.solo_escaladas;
    const f = { color: null, extra: null, texto: '' };
    const zonaTablero = h('div'); const zonaLista = h('div');

    const recargar = async () => { datos = await api('/api/cobranzas/semaforo'); pintarTablero(); pintarLista(); };

    function pintarTablero() {
      const r = datos.resumen;
      const sem = (c, q, d) => h('button', { type: 'button', class: `sem sem-${c}`, 'aria-pressed': String(f.color === c), onclick: () => { f.color = f.color === c ? null : c; pintarTablero(); pintarLista(); } },
        h('span', { class: 'q' }, q), h('span', { class: 'n' }, String(r[c].n)), h('span', { class: 'd' }, usd(r[c].usd)), h('span', { class: 'd desc' }, d));
      const extra = (k, txt, n) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(f.extra === k), onclick: () => { f.extra = f.extra === k ? null : k; pintarTablero(); pintarLista(); } }, txt, h('b', null, String(n)));
      const sinGest = datos.items.filter((i) => i.estado_gestion === 'sin_gestion' && i.color !== 'verde').length;
      const buscar = h('input', { type: 'search', placeholder: 'Buscar cliente', 'aria-label': 'Buscar cliente', value: f.texto });
      buscar.addEventListener('input', () => { f.texto = buscar.value; pintarLista(); });
      vaciar(zonaTablero).append(h('div', { class: 'tablero-cobro' },
        h('div', { class: 'total' }, h('div', { class: 'rotulo' }, soloEsc ? 'Para que gestiones vos' : 'Por cobrar'), h('div', { class: 'valor' }, usd(r.total_usd)), h('div', { class: 'nota' }, plural(r.facturas, 'factura', 'facturas'))),
        sem('rojo', 'Muy vencidas', `más de ${gracia} días`), sem('amarillo', 'Vencidas', `hasta ${gracia} días`), sem('verde', 'En plazo', 'según el contrato')),
      h('div', { class: 'filtros-cobro' }, buscar,
        !soloEsc && extra('hoy', 'Seguimiento para hoy', r.hoy), !soloEsc && extra('sin', 'Sin gestionar', sinGest), !soloEsc && extra('escalada', 'Con el comercial', r.escaladas)));
      if (document.activeElement === document.body && f.texto) zonaTablero.querySelector('input')?.focus();
    }

    function pintarLista() {
      const q = f.texto.trim().toLowerCase();
      const items = datos.items.filter((i) => (!f.color || i.color === f.color)
        && (!f.extra || (f.extra === 'hoy' ? i.proxima_gestion && i.proxima_gestion <= hoyISO() : f.extra === 'sin' ? i.estado_gestion === 'sin_gestion' && i.color !== 'verde' : i.estado_gestion === 'escalada'))
        && (!q || i.cliente.toLowerCase().includes(q)));
      if (!items.length) {
        vaciar(zonaLista).append(h('div', { class: 'tarjeta vacio' }, datos.items.length
          ? [h('b', null, 'Ninguna factura coincide'), 'Probá sacar algún filtro.']
          : soloEsc ? [h('b', null, 'No tenés cobros para gestionar'), 'Cuando cobranzas te pase una factura, la vas a ver acá.'] : [h('b', null, 'No hay nada pendiente de cobro'), 'Las facturas emitidas aparecen acá hasta que se cobran.']));
        return;
      }
      vaciar(zonaLista).append(h('ul', { class: 'cobros' }, items.map((i) => {
        const abrir = () => abrirDetalle(i.id, recargar);
        return h('li', { class: 'cobro', tabindex: '0', role: 'button', 'aria-label': `${i.cliente}, ${usd(i.saldo_usd)}, ${COLOR[i.color]}`, onclick: abrir, onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } } },
          h('div', { class: 'quien' }, h('b', null, i.cliente), h('span', { class: 'apoyo' }, `${nombreMes(i.periodo)}${i.numero ? ` · ${i.numero}` : ''}`)),
          h('div', { class: 'regla-celda' }, regla(i)),
          h('div', { class: 'monto' }, usd(i.saldo_usd), i.moneda === 'ARS' && h('small', null, monto(i.saldo, 'ARS'))),
          h('div', { class: 'estado' }, chipGestion(i), i.proxima_gestion && i.estado_gestion !== 'promesa' && i.estado_gestion !== 'escalada' && h('span', { class: 'apoyo' }, i.proxima_gestion <= hoyISO() ? 'Seguimiento: hoy' : `Seguimiento: ${fecha(i.proxima_gestion)}`)));
      })));
    }

    agregar(destino, [encabezado('Cobranzas', soloEsc ? 'Facturas que cobranzas te pasó porque el cliente no respondió.' : 'Lo que falta cobrar, según el plazo de pago de cada contrato.',
      puede('facturas.emitir') && h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/facturacion/facturas' }, 'Ver todas las facturas'))), zonaTablero, zonaLista,
    datos.sin_comprobante > 0 && !soloEsc && h('p', { class: 'apoyo', style: 'margin-top:14px' }, `Aparte: ${plural(datos.sin_comprobante, 'cuenta sin comprobante', 'cuentas sin comprobante')}. No entran en este semáforo.`)]);
    pintarTablero(); pintarLista();
  }

  /* ---------- cajón de una factura ---------- */
  async function abrirDetalle(id, alCambiar) {
    const previo = document.activeElement;
    const velo = h('div', { class: 'cajon-velo' }); const cajon = h('aside', { class: 'cajon', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Detalle de la factura' });
    const cerrar = () => { velo.remove(); cajon.remove(); document.removeEventListener('keydown', tecla); document.body.style.overflow = ''; previo?.focus?.(); };
    const tecla = (ev) => { if (ev.key === 'Escape') cerrar(); if (ev.key === 'Tab') { const f = [...cajon.querySelectorAll('a[href],button:not([disabled]),input,textarea,select')].filter((e) => e.offsetParent); if (!f.length) return; const a = f[0]; const z = f.at(-1); if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); } else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); } } };
    velo.addEventListener('click', cerrar); document.addEventListener('keydown', tecla); document.body.style.overflow = 'hidden';
    document.body.append(velo, cajon);

    async function pintar() {
      vaciar(cajon).append(h('div', { class: 'cajon-cuerpo' }, cargando()));
      let d;
      try { d = await api(`/api/cobranzas/facturas/${id}`); } catch (e) {
        vaciar(cajon).append(h('div', { class: 'cajon-cab' }, h('h2', null, 'Factura'), botonCerrar()), h('div', { class: 'cajon-cuerpo' }, h('div', { class: 'vacio' }, h('b', null, 'Esta factura ya no está pendiente'), 'Puede que se haya cobrado.')));
        alCambiar?.(); return;
      }
      const gestiona = puede('cobranzas.gestionar'); const soyComercial = !gestiona && d.estado_gestion === 'escalada';
      const cuerpo = h('div', { class: 'cajon-cuerpo' });
      cuerpo.append(h('div', { class: 'bloque' },
        h('div', { class: 'saldo-grande' }, usd2(d.saldo_usd), d.moneda === 'ARS' && h('span', { class: 'apoyo', style: 'font-size:15px;font-weight:500' }, `  (${monto(d.saldo, 'ARS')})`)),
        h('div', { style: 'margin:14px 0 4px' }, regla(d, true)),
        h('div', { class: 'hechos' }, h('div', null, 'Emisión', h('b', null, fecha(d.emision), d.estimada && ' (estimada)')), h('div', null, 'Plazo del contrato', h('b', null, `${d.plazo} días`)), h('div', null, 'Vencimiento', h('b', null, fecha(d.vence)))),
        puede('facturas.emitir') && fechaEmision(d)));

      if (d.estado_gestion === 'escalada') cuerpo.append(h('div', { class: 'bloque' }, h('h3', null, 'Está con el comercial'),
        h('p', { style: 'margin:0 0 10px' }, d.comercial ? `${d.comercial.nombre} tiene que contactar al cliente y dejar registrado el resultado.` : 'El comercial tiene que contactar al cliente.'),
        h('button', { class: 'btn btn-chico', type: 'button', onclick: async (ev) => { ev.target.disabled = true; try { await api(`/api/cobranzas/facturas/${id}/retomar`, { metodo: 'POST', cuerpo: {} }); aviso('Volvió a cobranzas'); await pintar(); alCambiar?.(); } catch (e) { aviso(msg(e)); ev.target.disabled = false; } } }, 'Devolver a cobranzas')));

      if (d.contactos.length) cuerpo.append(h('div', { class: 'bloque' }, h('h3', null, 'A quién llamar'), d.contactos.map((c) => {
        const tel = c.telefonos?.[0]?.numero; const mail = c.emails?.[0]?.direccion; const soloNum = tel ? tel.replace(/[^\d+]/g, '') : null;
        return h('div', { class: 'contacto' }, h('div', null, h('b', { class: 'nombre-cliente' }, c.nombre), h('div', { class: 'apoyo' }, [c.cargo, ...(c.roles ?? []).slice(0, 2)].filter(Boolean).join(' · ') || ' ')),
          h('div', { class: 'via' }, tel && h('a', { href: `tel:${soloNum}` }, tel), soloNum && h('a', { href: `https://wa.me/${soloNum.replace('+', '')}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'), mail && h('a', { href: `mailto:${mail}` }, 'Mail')));
      })));

      if (gestiona || soyComercial) cuerpo.append(formGestion(d, async () => { await pintar(); alCambiar?.(); }));
      if (gestiona && d.estado_gestion !== 'escalada') cuerpo.append(bloqueEscalar(d, async () => { await pintar(); alCambiar?.(); }));
      if (puede('cobros.registrar')) cuerpo.append(h('div', { class: 'acciones-cajon' }, h('a', { class: 'btn btn-principal', href: `#/facturacion/factura/${id}`, onclick: cerrar }, 'Registrar cobro')));

      cuerpo.append(h('div', { class: 'bloque' }, h('h3', null, 'Historial de gestiones'), d.gestiones.length
        ? h('div', { class: 'historia' }, d.gestiones.map((g) => h('div', { class: `evento e-${g.tipo}` },
          h('b', null, TIPOS[g.tipo] ?? g.tipo), h('span', { class: 'apoyo' }, ` · ${fecha(g.fecha)} · ${g.usuario}`), g.resultado && h('div', null, g.resultado), g.notas && h('p', { class: 'apoyo' }, g.notas),
          g.proxima_gestion && h('div', { class: 'apoyo' }, `Seguimiento: ${fecha(g.proxima_gestion)}`))))
        : h('p', { class: 'apoyo', style: 'margin:0' }, 'Todavía no hay gestiones. La primera que registres queda acá.')));

      vaciar(cajon).append(h('div', { class: 'cajon-cab' }, h('div', null, h('h2', null, d.cliente), h('div', { class: 'apoyo' }, `Factura de ${nombreMes(d.periodo)}${d.numero ? ` · ${d.numero}` : ''}`), h('div', { style: 'margin-top:8px' }, chip(COLOR[d.color], d.color), ' ', chipGestion(d))), botonCerrar()), cuerpo);
    }
    const botonCerrar = () => h('button', { class: 'cajon-cerrar', type: 'button', 'aria-label': 'Cerrar', onclick: cerrar }, h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: 'M6 6l12 12M18 6L6 18' })));
    await pintar();
    cajon.querySelector('.cajon-cerrar')?.focus();
  }

  const TIPOS = { llamada: 'Llamada', mail: 'Mail', whatsapp: 'WhatsApp', visita: 'Visita', promesa: 'Promesa de pago', nota: 'Nota', escalada: 'Pasada al comercial', retomada: 'Volvió a cobranzas' };
  const RESULTADOS = { llamada: ['No atendió', 'Dejé mensaje', 'Pidió que reenviemos la factura', 'Reclama algo de la factura'], mail: ['Enviado', 'Respondió', 'Rebotó'], whatsapp: ['Enviado', 'Leyó y no respondió', 'Respondió'], visita: ['Hablé con el responsable', 'No había nadie'], promesa: ['Prometió pagar'], nota: [] };

  function fechaEmision(d) {
    const caja = h('div'); const boton = h('button', { class: 'btn-texto', type: 'button' }, 'Corregir fecha de emisión');
    boton.addEventListener('click', () => {
      const inp = h('input', { type: 'date', value: d.emision ?? hoyISO(), max: hoyISO(), 'aria-label': 'Fecha de emisión' });
      const guardar = h('button', { class: 'btn btn-chico btn-principal', type: 'button' }, 'Guardar');
      guardar.addEventListener('click', async () => { guardar.disabled = true; try { await api(`/api/facturas/${d.id}/emision`, { metodo: 'PATCH', cuerpo: { fecha_emision: inp.value } }); aviso('Fecha corregida'); document.querySelector('.cajon-cerrar')?.click(); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { aviso(msg(e)); guardar.disabled = false; } });
      vaciar(caja).append(h('div', { class: 'plazo-edicion' }, inp, guardar, h('button', { class: 'btn-texto', type: 'button', onclick: () => vaciar(caja).append(boton) }, 'Cancelar')));
      inp.focus();
    });
    caja.append(boton); return caja;
  }

  function formGestion(d, alGuardar) {
    let tipo = 'llamada';
    const resultado = h('input', { type: 'text', id: 'g-res', maxlength: '80', placeholder: 'Qué pasó' });
    const notas = h('textarea', { id: 'g-notas', placeholder: 'Notas (opcional)', 'aria-label': 'Notas' });
    const prox = h('input', { type: 'date', id: 'g-prox', min: hoyISO() });
    const etqProx = h('label', { for: 'g-prox' }, 'Próximo seguimiento');
    const err = h('div', { class: 'error oculto', role: 'alert' });
    const zonaTipos = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de gestión' }); const zonaRes = h('div', { class: 'rapidos chicos' });
    const pintarTipos = () => {
      vaciar(zonaTipos).append(...['llamada', 'mail', 'whatsapp', 'visita', 'promesa', 'nota'].map((t) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(t === tipo), onclick: () => { tipo = t; pintarTipos(); } }, TIPOS[t])));
      vaciar(zonaRes).append(...(RESULTADOS[tipo] ?? []).map((r) => h('button', { type: 'button', class: 'rapido', onclick: () => { resultado.value = r; } }, r)));
      etqProx.textContent = tipo === 'promesa' ? '¿Qué fecha prometió pagar?' : 'Próximo seguimiento';
    };
    pintarTipos();
    const atajos = h('div', { class: 'rapidos chicos' }, [['Mañana', 1], ['En 3 días', 3], ['En una semana', 7]].map(([t, n]) => h('button', { type: 'button', class: 'rapido', onclick: () => { prox.value = mas(n); } }, t)));
    const guardar = h('button', { class: 'btn btn-principal', type: 'button' }, 'Guardar gestión');
    guardar.addEventListener('click', async () => {
      err.classList.add('oculto'); guardar.disabled = true;
      try { await api(`/api/cobranzas/facturas/${d.id}/gestiones`, { metodo: 'POST', cuerpo: { tipo, resultado: resultado.value || undefined, notas: notas.value || undefined, proxima_gestion: prox.value || null } }); aviso('Gestión guardada'); await alGuardar(); }
      catch (e) { err.textContent = msg(e); err.classList.remove('oculto'); guardar.disabled = false; }
    });
    return h('div', { class: 'bloque' }, h('h3', null, 'Registrar una gestión'), zonaTipos,
      h('div', { class: 'campo' }, h('label', { for: 'g-res' }, 'Resultado'), resultado, zonaRes), notas && h('div', { class: 'campo' }, notas),
      h('div', { class: 'campo' }, etqProx, prox, atajos), err, guardar);
  }

  function bloqueEscalar(d, alEscalar) {
    const caja = h('div', { class: 'bloque' });
    const inicio = () => vaciar(caja).append(h('h3', null, 'Si no responden'), h('p', { class: 'apoyo', style: 'margin:0 0 10px' }, 'Pasale la factura al comercial de la cuenta para que contacte al cliente.'),
      h('button', { class: 'btn', type: 'button', onclick: confirmar }, 'Pasar al comercial'));
    function confirmar() {
      if (!d.comercial) { vaciar(caja).append(h('h3', null, 'Esta cuenta no tiene comercial'), h('p', { style: 'margin:0 0 10px' }, 'Para poder pasarle la factura, asignale un comercial desde la ficha del cliente, en Cartera.'),
        h('a', { class: 'btn btn-chico', href: `#/clientes/${d.cliente_id}`, onclick: () => document.querySelector('.cajon-cerrar')?.click() }, 'Ir al cliente'), ' ', h('button', { class: 'btn-texto', type: 'button', onclick: inicio }, 'Cancelar')); return; }
      const nota = h('textarea', { 'aria-label': 'Qué pasó hasta ahora', placeholder: 'Qué pasó hasta ahora (opcional)' }); const err = h('div', { class: 'error oculto', role: 'alert' });
      const ok = h('button', { class: 'btn btn-principal', type: 'button' }, `Pasar a ${d.comercial.nombre.split(' ')[0]}`);
      ok.addEventListener('click', async () => { ok.disabled = true; try { await api(`/api/cobranzas/facturas/${d.id}/escalar`, { metodo: 'POST', cuerpo: { notas: nota.value || undefined } }); aviso(`Se la pasaste a ${d.comercial.nombre.split(' ')[0]}`); await alEscalar(); } catch (e) { err.textContent = msg(e); err.classList.remove('oculto'); ok.disabled = false; } });
      vaciar(caja).append(h('h3', null, `Pasar a ${d.comercial.nombre}`), h('p', { style: 'margin:0 0 10px' }, 'Va a recibir un aviso y esta factura aparece en su lista. Cobranzas puede seguir el caso desde acá.'), h('div', { class: 'campo' }, nota), err,
        h('div', { class: 'acciones-cajon' }, ok, h('button', { class: 'btn', type: 'button', onclick: inicio }, 'Cancelar')));
      nota.focus();
    }
    inicio(); return caja;
  }

  /* ---------- solapa "Negocio" del cliente ---------- */
  async function negocioCliente(destino, clienteId) {
    const verRent = puede('costos.ver') && puede('importes.ver');
    const n = verRent ? await api(`/api/clientes/${clienteId}/negocio`).catch(() => null) : null;
    const pc = n ? n.por_cobrar : (await api(`/api/cobranzas/semaforo`).then((r) => { gracia = r.gracia ?? gracia; const l = r.items.filter((i) => i.cliente_id === Number(clienteId)); return { usd: l.reduce((s, i) => s + i.saldo_usd, 0), facturas: l.length, detalle: l }; }).catch(() => null));
    if (n) gracia = gracia ?? GRACIA_FALLBACK;
    const nodo = h('div');
    if (n) {
      const t = n.totales; const col = t.resultado >= 0 ? 'pos' : 'neg';
      const kpi = (r, v, nota, c) => h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, r), h('div', { class: `valor ${c ?? ''}` }, v), nota && h('div', { class: 'nota' }, nota));
      nodo.append(h('div', { class: 'carril' }, h('h2', null, 'Rentabilidad'), h('p', null, 'Lo facturado contra lo que costó, mes a mes. No depende de si ya se cobró.')),
        h('div', { class: 'rejilla negocio-kpis' }, kpi('Ingresos (facturado)', usd(t.ingresos), 'USD netos'), kpi('Egresos (costos)', usd(t.egresos), n.sin_costos ? 'Sin costos cargados' : null),
          kpi('Resultado', `${t.resultado < 0 ? '−' : ''}${usd(Math.abs(t.resultado))}`, null, col), kpi('Margen', t.margen == null ? '—' : `${String(t.margen).replace('.', ',')} %`, null, col)));
      nodo.append(graficoNegocio(n));
    }
    if (pc) {
      nodo.append(h('div', { class: 'carril' }, h('h2', null, 'Por cobrar'), h('p', null, 'El flujo del dinero, aparte de la rentabilidad: lo facturado que todavía no se cobró.')));
      nodo.append(pc.detalle.length ? h('ul', { class: 'cobros' }, pc.detalle.map((i) => {
        const abrir = () => abrirDetalle(i.id, () => negocioCliente(destino, clienteId));
        return h('li', { class: 'cobro', tabindex: '0', role: 'button', onclick: abrir, onkeydown: (ev) => { if (ev.key === 'Enter') abrir(); } },
          h('div', { class: 'quien' }, h('b', null, nombreMes(i.periodo)), h('span', { class: 'apoyo' }, i.numero ?? 'Sin número')), h('div', { class: 'regla-celda' }, regla(i)), h('div', { class: 'monto' }, usd(i.saldo_usd)), h('div', { class: 'estado' }, chipGestion(i)));
      })) : h('div', { class: 'tarjeta vacio' }, h('b', null, 'Está al día'), 'No tiene facturas pendientes de cobro.'));
    } else if (!n) nodo.append(h('div', { class: 'tarjeta vacio' }, 'No hay información de cobranzas para mostrar.'));
    vaciar(destino).append(nodo);
  }

  function graficoNegocio(n) {
    const caja = h('div', { class: 'tarjeta' }); let modo = 'acum';
    const mover = h('div', { class: 'seg-chico', role: 'group', 'aria-label': 'Vista del gráfico' });
    const lienzo = h('div', { class: 'grafico' });
    const mensaje = (() => {
      if (!n.serie.length) return 'Todavía no hay facturas ni costos para este cliente.';
      if (n.sin_costos) return 'No hay costos cargados para este cliente, por eso no se puede calcular cuándo los ingresos superan a los costos.';
      if (n.punto_equilibrio) return `Los ingresos superaron a los costos en ${nombreMes(n.punto_equilibrio)}.`;
      return `Todavía no recuperó los costos: faltan ${usd(Math.abs(Math.min(0, n.totales.resultado)))} de ingresos.`;
    })();
    const nota = (n.facturas_sin_fecha ? `${plural(n.facturas_sin_fecha, 'factura sin fecha de emisión se ubicó', 'facturas sin fecha de emisión se ubicaron')} en su período. ` : '');
    function pintar() {
      [...mover.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === modo)));
      vaciar(lienzo).append(svgNegocio(n, modo));
    }
    [['acum', 'Acumulado'], ['mes', 'Por mes']].forEach(([m, t]) => mover.append(h('button', { type: 'button', 'data-m': m, onclick: () => { modo = m; pintar(); } }, t)));
    caja.append(h('div', { class: 'cab-grafico' }, h('h2', null, 'Ingresos y costos'), mover), lienzo,
      h('div', { class: 'leyenda' }, h('span', null, h('i', { style: 'background:#0D1B2A' }), 'Ingresos'), h('span', null, h('i', { style: 'background:#E08A2E' }), 'Egresos'), n.punto_equilibrio && modo === 'acum' && h('span', null, h('i', { style: 'background:#2FB37A;border-radius:50%' }), 'Punto de equilibrio')),
      h('p', { class: 'conclusion' }, mensaje), nota && h('p', { class: 'apoyo' }, nota));
    pintar(); return caja;
  }

  function svgNegocio(n, modo) {
    const movil = window.innerWidth < 600; const todo = n.serie; const serie = movil ? todo.slice(-6) : todo.slice(-18);
    const W = movil ? 380 : 760; const H = movil ? 240 : 270; const m = { i: 46, d: 14, s: 22, b: 30 };
    if (!serie.length) return h('div', { class: 'vacio' }, 'Sin datos.');
    const vals = modo === 'acum' ? serie.flatMap((s) => [s.acum_ingresos, s.acum_egresos]) : serie.flatMap((s) => [s.ingresos, s.egresos]);
    const max = Math.max(1, ...vals); const paso = (() => { const c = max / 4; const p = 10 ** Math.floor(Math.log10(c)); return [1, 2, 2.5, 5, 10].map((f) => f * p).find((v) => v >= c); })(); const tope = paso * 4;
    const ancho = (W - m.i - m.d) / serie.length; const y = (v) => m.s + (H - m.s - m.b) * (1 - v / tope); const cx = (k) => m.i + k * ancho + ancho / 2;
    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Ingresos y egresos del cliente por mes' });
    for (let k = 0; k <= 4; k += 1) { const v = paso * k; svg.append(h('line', { x1: m.i, x2: W - m.d, y1: y(v), y2: y(v), stroke: '#E6EDF1' }), h('text', { x: m.i - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11.5, fill: '#6B7C88' }, v >= 1000 ? `${String(v / 1000).replace('.', ',')}k` : v)); }
    const cadaN = serie.length > 12 ? 2 : 1;
    serie.forEach((s, k) => { if (k % cadaN === 0) svg.append(h('text', { x: cx(k), y: H - 9, 'text-anchor': 'middle', 'font-size': movil ? 12.5 : 11.5, fill: '#5B6B76' }, mesCorto(s.mes))); });
    if (modo === 'mes') {
      const bw = Math.min(16, ancho / 3);
      serie.forEach((s, k) => [[s.ingresos, '#0D1B2A', 'Ingresos'], [s.egresos, '#E08A2E', 'Egresos']].forEach(([v, c, nom], j) => {
        svg.append(h('rect', { x: cx(k) - bw - 1 + j * (bw + 2), y: y(v), width: bw, height: Math.max(0, (H - m.s - m.b) * (v / tope)), rx: 3, fill: c }, h('title', null, `${nombreMes(s.mes)} · ${nom}: ${usd(v)}`)));
      }));
      return svg;
    }
    const linea = (campo, color) => {
      const d = serie.map((s, k) => `${k ? 'L' : 'M'}${cx(k).toFixed(1)} ${y(s[campo]).toFixed(1)}`).join(' ');
      svg.append(h('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      serie.forEach((s, k) => svg.append(h('circle', { cx: cx(k), cy: y(s[campo]), r: 3.2, fill: '#fff', stroke: color, 'stroke-width': 2 }, h('title', null, `${nombreMes(s.mes)} · ${campo === 'acum_ingresos' ? 'Ingresos' : 'Egresos'} acumulados: ${usd(s[campo])}`))));
    };
    // El punto de equilibrio se marca con una línea vertical antes que las series, para que no las tape.
    const eq = n.punto_equilibrio ? serie.findIndex((s) => s.mes === n.punto_equilibrio) : -1;
    if (eq >= 0) {
      svg.append(h('line', { x1: cx(eq), x2: cx(eq), y1: m.s - 4, y2: H - m.b, stroke: '#2FB37A', 'stroke-width': 2, 'stroke-dasharray': '4 4' }));
    }
    linea('acum_egresos', '#E08A2E'); linea('acum_ingresos', '#0D1B2A');
    if (eq >= 0) {
      const s = serie[eq]; const ancla = cx(eq) > W - 120 ? 'end' : 'middle';
      svg.append(h('circle', { cx: cx(eq), cy: y(s.acum_ingresos), r: 7, fill: '#2FB37A', stroke: '#fff', 'stroke-width': 3 }),
        h('text', { x: cx(eq), y: 12, 'text-anchor': ancla, 'font-size': 12.5, 'font-weight': 700, fill: '#0F6B49' }, `Equilibrio · ${mesCorto(s.mes)} ${s.mes.slice(0, 4)}`));
    }
    return svg;
  }

  /** Plazo de pago del contrato: se muestra y, quien edita contratos, lo cambia. */
  function plazoContrato(c, alGuardar) {
    const caja = h('div', { style: 'margin-bottom:12px' });
    const ver = () => {
      vaciar(caja).append(h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, h('span', null, 'Plazo de pago: ', h('b', null, c.plazo_pago_dias != null ? `${c.plazo_pago_dias} días` : 'sin definir (se usan 15)')),
        puede('contratos.editar') && h('button', { class: 'btn-texto', type: 'button', onclick: editar }, 'Cambiar')));
    };
    const editar = () => {
      const inp = h('input', { type: 'number', min: '0', max: '365', value: c.plazo_pago_dias ?? 15, 'aria-label': 'Días de plazo de pago' });
      const ok = h('button', { class: 'btn btn-chico btn-principal', type: 'button' }, 'Guardar'); const err = h('span', { class: 'neg', role: 'alert' });
      ok.addEventListener('click', async () => { ok.disabled = true; try { await api(`/api/contratos/${c.id}`, { metodo: 'PATCH', cuerpo: { plazo_pago_dias: Number(inp.value) } }); c.plazo_pago_dias = Number(inp.value); aviso('Plazo guardado'); ver(); alGuardar?.(); } catch { err.textContent = 'No se pudo guardar.'; ok.disabled = false; } });
      vaciar(caja).append(h('div', null, h('div', { class: 'plazo-edicion' }, h('span', null, 'Plazo de pago'), inp, h('span', null, 'días'), ok, h('button', { class: 'btn-texto', type: 'button', onclick: ver }, 'Cancelar'), err),
        h('p', { class: 'apoyo', style: 'margin:6px 0 0' }, 'Rige para las facturas que se armen desde ahora. Las ya emitidas conservan el suyo.'))); inp.focus();
    };
    ver(); return caja;
  }

  return { vistaCobranzas, negocioCliente, plazoContrato, regla, abrirDetalle };
}
