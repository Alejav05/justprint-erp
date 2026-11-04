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
      nodo.append(fotoNegocio(n), indicadoresNegocio(n), graficoNegocio(n), equiposNegocio(n));
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

  const signoUsd = (v) => `${v < 0 ? '−' : ''}${usd(Math.abs(v))}`;

  /** Lo que entra y lo que sale, con el equipo entero (plata puesta) y con el equipo repartido en su vida útil. */
  function fotoNegocio(n) {
    const f = n.foto; const fila = (rot, a, b, fuerte) => h('tr', { class: fuerte ? 'total' : '' }, h('td', null, fuerte ? h('b', null, rot) : rot), h('td', { class: 'num' }, a == null ? '' : (fuerte ? h('b', null, signoUsd(a)) : signoUsd(a))), h('td', { class: 'num' }, b == null ? '' : (fuerte ? h('b', null, signoUsd(b)) : signoUsd(b))));
    const g = (c, k) => -f[c][k]; const hayOtros = f.completa.otros > 0;
    return h('div', null, h('div', { class: 'carril' }, h('h2', null, 'Foto del negocio'), h('p', null, 'Lo que entra y lo que sale. A la izquierda, el equipo cuenta entero desde que llega; a la derecha, repartido en su vida útil.')),
      h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, h('table', { class: 'foto' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'num' }, 'Plata puesta'), h('th', { class: 'num' }, 'Equipo repartido'))),
        h('tbody', null, fila('Ingresos facturados', f.ingresos, f.ingresos), h('tr', null, h('td', { class: 'apoyo', colspan: '3' }, 'Gastos')),
          fila('Equipo y accesorios', g('completa', 'equipo'), g('amortizada', 'equipo')), fila('Insumos', g('completa', 'insumos'), g('amortizada', 'insumos')), fila('Mano de obra', g('completa', 'mano_de_obra'), g('amortizada', 'mano_de_obra')), hayOtros ? fila('Otros costos', g('completa', 'otros'), g('amortizada', 'otros')) : null,
          fila('Total de gastos', g('completa', 'total'), g('amortizada', 'total')), fila('Rentabilidad', f.completa.rentabilidad, f.amortizada.rentabilidad, true))),
        f.arranque_insumos > 0 ? h('p', { class: 'apoyo', style: 'margin:8px 12px 10px' }, `Los insumos incluyen ${usd(f.arranque_insumos)} del primer mes (kit de arranque).`) : null));
  }

  /** Tres números de lectura rápida: dónde estoy, cuánto aporta el negocio por mes y cuándo recupero. */
  function indicadoresNegocio(n) {
    const f = n.foto; const r = n.ritmo; const kpi = (rot, v, nota, c) => h('div', { class: 'tarjeta kpi' }, h('div', { class: 'rotulo' }, rot), h('div', { class: `valor ${c ?? ''}` }, v), nota && h('div', { class: 'nota' }, nota));
    const hoyR = f.completa.rentabilidad; const hayEquipo = n.recupero.invertido > 0;
    const tarjetas = [kpi('Rentabilidad hoy', signoUsd(hoyR), hoyR < 0 ? `Te faltan ${usd(-hoyR)} para recuperar lo invertido` : 'Ya recuperaste lo invertido', hoyR >= 0 ? 'pos' : 'neg')];
    tarjetas.push(r ? kpi('Aporte mensual', signoUsd(r.aporte_mensual), `Promedio de los últimos ${r.meses_base} meses, con el equipo repartido${r.margen != null ? ` · margen ${String(r.margen).replace('.', ',')} %` : ''}`, r.aporte_mensual >= 0 ? 'pos' : 'neg') : kpi('Aporte mensual', '—', 'Hacen falta al menos 2 meses después del arranque'));
    if (hayEquipo && r && r.meses_para_recuperar === 0) tarjetas.push(kpi('Recuperás en', 'Recuperado', null, 'pos'));
    else if (hayEquipo && r && r.meses_para_recuperar != null) tarjetas.push(kpi('Recuperás en', `~${r.meses_para_recuperar} ${r.meses_para_recuperar === 1 ? 'mes' : 'meses'} más`, `Al ritmo de los últimos ${r.meses_base} meses: mes ${r.mes_desde_inicio} desde el inicio. Tu meta: 12 a 14`, r.mes_desde_inicio <= 14 ? 'pos' : 'neg'));
    else tarjetas.push(kpi('Recuperás en', '—', hayEquipo ? (r ? 'Con el ritmo actual no se recupera' : 'Todavía no hay ritmo suficiente') : 'Sin equipos con costo cargado'));
    return h('div', { class: 'rejilla negocio-kpis kpis3' }, ...tarjetas);
  }

  /** Equipos del negocio: resumen y, con muchos equipos, los que más cuestan por página primero. */
  function equiposNegocio(n) {
    const lista = n.equipos; if (!lista.length) return h('div');
    const vig = lista.filter((e) => e.vigente); const conCosto = vig.filter((e) => e.costo_usd != null); const inv = conCosto.reduce((t, e) => t + e.costo_usd, 0); const libros = conCosto.reduce((t, e) => t + e.valor_en_libros, 0);
    const pct = inv > 0 ? Math.round(((inv - libros) / inv) * 100) : 0; const sinCosto = vig.length - conCosto.length;
    const orden = [...lista].sort((a, b) => (b.costo_pagina ?? -1) - (a.costo_pagina ?? -1)); const LIM = 5; let todos = false; let q = '';
    const cuerpo = h('ul', { class: 'lista' }); const mas = h('button', { class: 'btn-texto', type: 'button' }, ''); const buscar = h('input', { type: 'search', placeholder: 'Buscar por serie o modelo', 'aria-label': 'Buscar equipo', style: 'max-width:280px;margin:8px 0' });
    const cpp = (v) => `USD ${v.toLocaleString('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
    const pintar = () => {
      const f = orden.filter((e) => !q || `${e.equipo} ${e.numero_serie}`.toLowerCase().includes(q)); const ver = todos || q ? f : f.slice(0, LIM);
      vaciar(cuerpo).append(...ver.map((e) => h('li', null, h('span', null, `${e.equipo} · ${e.numero_serie}`, h('div', { class: 'apoyo' }, `${e.vigente ? 'Instalado' : `Retirado${e.retirado ? ` · le faltaban ${usd(e.retirado.valor_en_libros)} por amortizar al salir` : ''}`}${e.costo_usd != null ? ` · costo ${usd(e.costo_usd)} · amortizado ${usd(e.amortizado_en_este_cliente)} acá` : ' · sin costo cargado'}${e.costo_pagina != null ? ` · ${cpp(e.costo_pagina)} por página` : ''}`)), h('b', null, e.costo_usd != null ? `${usd(e.valor_en_libros)} en libros` : '—'))));
      mas.style.display = f.length > LIM && !q ? '' : 'none'; mas.textContent = todos ? 'Ver solo los primeros' : `Ver los ${f.length}`;
    };
    mas.addEventListener('click', () => { todos = !todos; pintar(); }); buscar.addEventListener('input', () => { q = buscar.value.trim().toLowerCase(); pintar(); }); pintar();
    return h('div', { class: 'tarjeta' }, h('h2', null, `Equipos de este negocio · ${plural(vig.length, 'instalado', 'instalados')}`),
      h('p', { class: 'apoyo' }, `Inversión ${usd(inv)} · valor en libros ${usd(libros)} · amortizado ${pct} %${sinCosto ? ` · ${plural(sinCosto, 'equipo sin costo cargado', 'equipos sin costo cargado')}` : ''}`),
      lista.length > LIM ? buscar : null, cuerpo, mas);
  }

  /** Dos miradas sobre el mismo negocio: Recupero (el equipo completo desde el día uno) y Resultado (el equipo repartido en su vida útil). */
  function graficoNegocio(nBase) {
    const caja = h('div', { class: 'tarjeta' }); let modo = 'acum'; let vista = nBase.recupero && nBase.recupero.invertido > 0 ? 'recupero' : 'resultado';
    // En la vista de recupero los costos incluyen el equipo entero (lo que falta amortizar) y devuelven el valor en libros de lo retirado.
    const datos = () => (vista === 'resultado' ? nBase : { ...nBase, punto_equilibrio: nBase.recupero.mes_recupero, serie: nBase.serie.map((s) => {
      const costoMes = s.ingresos - s.recupero; const acumCostos = s.acum_ingresos - s.acum_recupero;
      return { ...s, egresos: costoMes, acum_egresos: acumCostos, resultado: s.recupero, acum_resultado: s.acum_recupero };
    }) });
    const mover = h('div', { class: 'seg-chico', role: 'group', 'aria-label': 'Vista del gráfico' });
    const vistas = h('div', { class: 'seg-chico', role: 'group', 'aria-label': 'Mirada del negocio' });
    const lienzo = h('div', { class: 'grafico' });
    const mensaje = () => {
      const n = datos();
      if (!n.serie.length) return 'Todavía no hay facturas ni costos para este cliente.';
      if (n.sin_costos) return 'No hay costos cargados para este cliente, por eso no se puede calcular cuándo los ingresos superan a los costos.';
      const falta = Math.abs(Math.min(0, n.serie.at(-1).acum_resultado));
      if (vista === 'recupero') return n.punto_equilibrio ? `Recuperaste lo invertido (equipo, insumos y mano de obra) en ${nombreMes(n.punto_equilibrio)}.` : `Todavía no recuperaste lo invertido: faltan ${usd(falta)} de ingresos.`;
      return n.punto_equilibrio ? `Con el equipo repartido en su vida útil, los ingresos superaron a los costos en ${nombreMes(n.punto_equilibrio)}.` : `Todavía no superó los costos: faltan ${usd(falta)} de ingresos.`;
    };
    const nota = (nBase.facturas_sin_fecha ? `${plural(nBase.facturas_sin_fecha, 'factura sin fecha de emisión se ubicó', 'facturas sin fecha de emisión se ubicaron')} en su período. ` : '');
    const lectura = h('p', { class: 'apoyo', 'aria-live': 'polite', style: 'margin:10px 0 0;min-height:1.4em' });
    const conclusion = h('p', { class: 'conclusion' }); const ley = h('div', { class: 'leyenda' }); const titulo = h('h2', null, '');
    const mostrar = (s) => {
      const ultimo = datos().serie.at(-1); if (modo !== 'acum' || !ultimo) { lectura.textContent = ''; return; }
      const v = s ?? ultimo; const res = v.acum_resultado;
      lectura.textContent = `${nombreMes(v.mes)}${s ? '' : ' (último mes)'} · ingresos ${usd(v.acum_ingresos)} · costos ${usd(v.acum_egresos)} · ${vista === 'recupero' ? 'recupero' : 'resultado'} ${res < 0 ? '−' : ''}${usd(Math.abs(res))}`;
    };
    function pintar() {
      const n = datos();
      [...mover.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === modo)));
      [...vistas.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === vista)));
      titulo.textContent = vista === 'recupero' ? 'Recupero de inversión' : 'Resultado con el equipo amortizado';
      vaciar(lienzo).append(svgNegocio(n, modo, mostrar)); mostrar(null);
      vaciar(ley).append(h('span', null, h('i', { style: 'background:#0D1B2A' }), 'Ingresos'), h('span', null, h('i', { style: 'background:#E08A2E' }), vista === 'recupero' ? 'Costos con el equipo completo' : 'Costos con el equipo amortizado'),
        ...(n.punto_equilibrio && modo === 'acum' ? [h('span', { class: 'ley-eq' }, h('i', { style: 'background:#2FB37A;border-radius:50%' }), vista === 'recupero' ? 'Recuperaste lo invertido' : 'Punto de equilibrio')] : []));
      conclusion.textContent = mensaje();
    }
    [['recupero', 'Recupero'], ['resultado', 'Resultado']].forEach(([v, t]) => vistas.append(h('button', { type: 'button', 'data-v': v, onclick: () => { vista = v; pintar(); } }, t)));
    [['acum', 'Acumulado'], ['mes', 'Por mes']].forEach(([m, t]) => mover.append(h('button', { type: 'button', 'data-m': m, onclick: () => { modo = m; pintar(); } }, t)));
    const hayRecupero = nBase.recupero && nBase.recupero.invertido > 0;
    caja.append(h('div', { class: 'cab-grafico' }, titulo, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, hayRecupero ? vistas : null, mover)), lienzo, ley, lectura, conclusion, nota && h('p', { class: 'apoyo' }, nota));
    pintar(); return caja;
  }

  function svgNegocio(n, modo, alMover) {
    const movil = window.innerWidth < 600; const acum = modo === 'acum';
    const serie = acum ? n.serie : n.serie.slice(movil ? -12 : -24);
    const W = movil ? 380 : 760; const H = movil ? 270 : 300; const m = { i: 46, d: 12, s: 28, b: 32 };
    if (!serie.length) return h('div', { class: 'vacio' }, 'Sin datos.');
    const vals = acum ? serie.flatMap((s) => [s.acum_ingresos, s.acum_egresos]) : serie.flatMap((s) => [s.ingresos, s.egresos]);
    const max = Math.max(1, ...vals); const paso = (() => { const c = max / 4; const p = 10 ** Math.floor(Math.log10(c)); return [1, 2, 2.5, 5, 10].map((f) => f * p).find((v) => v >= c); })(); const tope = paso * 4;
    const compacto = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}k` : String(Math.round(v)));
    const pw = W - m.i - m.d; const ph = H - m.s - m.b; const y = (v) => m.s + ph * (1 - v / tope);
    const cantidad = serie.length; const ancho = pw / cantidad;
    const x = acum ? (k) => m.i + (cantidad === 1 ? pw / 2 : (k * pw) / (cantidad - 1)) : (k) => m.i + k * ancho + ancho / 2;
    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': acum ? 'Evolución acumulada de ingresos y egresos del cliente desde el primer mes' : 'Ingresos y egresos del cliente por mes', style: 'touch-action:pan-y' });
    for (let k = 0; k <= 4; k += 1) { const v = paso * k; svg.append(h('line', { x1: m.i, x2: W - m.d, y1: y(v), y2: y(v), stroke: '#E6EDF1' }), h('text', { x: m.i - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11.5, fill: '#6B7C88' }, compacto(v))); }
    // Etiquetas de meses: con muchos meses se espacian, y se agrega el año.
    const maxEtiquetas = movil ? 5 : 10; const cada = Math.max(1, Math.ceil(cantidad / maxEtiquetas)); const conAnio = acum && cantidad > 12;
    const etiqueta = (s) => (conAnio ? `${mesCorto(s.mes)} ${s.mes.slice(2, 4)}` : mesCorto(s.mes));
    serie.forEach((s, k) => { if (k % cada === 0 || (k === cantidad - 1 && (cantidad - 1) % cada >= cada / 2)) svg.append(h('text', { x: x(k), y: H - 10, 'text-anchor': acum && k === 0 && cantidad > 1 ? 'start' : 'middle', 'font-size': movil ? 12 : 11.5, fill: '#5B6B76' }, etiqueta(s))); });

    if (!acum) {
      const bw = Math.min(16, ancho / 3);
      serie.forEach((s, k) => [[s.ingresos, '#0D1B2A', 'Ingresos'], [s.egresos, '#E08A2E', 'Egresos']].forEach(([v, c, nom], j) => {
        svg.append(h('rect', { x: x(k) - bw - 1 + j * (bw + 2), y: y(v), width: bw, height: Math.max(0, ph * (v / tope)), rx: 3, fill: c }, h('title', null, `${nombreMes(s.mes)} · ${nom}: ${usd(v)}`)));
      }));
      return svg;
    }

    // Área entre las curvas, partida donde se cruzan.
    const VERDE = 'rgba(47,179,122,.2)'; const NARANJA = 'rgba(224,138,46,.2)';
    const poli = (pts, fill) => svg.append(h('polygon', { points: pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' '), fill }));
    for (let k = 1; k < cantidad; k += 1) {
      const a = serie[k - 1]; const b = serie[k]; const d0 = a.acum_ingresos - a.acum_egresos; const d1 = b.acum_ingresos - b.acum_egresos;
      const col = (d) => (d >= 0 ? VERDE : NARANJA);
      if ((d0 >= 0 && d1 >= 0) || (d0 <= 0 && d1 <= 0)) poli([[x(k - 1), y(a.acum_ingresos)], [x(k), y(b.acum_ingresos)], [x(k), y(b.acum_egresos)], [x(k - 1), y(a.acum_egresos)]], col(d0 === 0 ? d1 : d0));
      else {
        const t = d0 / (d0 - d1); const xc = x(k - 1) + t * (x(k) - x(k - 1)); const yc = y(a.acum_ingresos + t * (b.acum_ingresos - a.acum_ingresos));
        poli([[x(k - 1), y(a.acum_ingresos)], [xc, yc], [x(k - 1), y(a.acum_egresos)]], col(d0)); poli([[xc, yc], [x(k), y(b.acum_ingresos)], [x(k), y(b.acum_egresos)]], col(d1));
      }
    }
    const linea = (campo, color) => svg.append(h('path', { d: serie.map((s, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)} ${y(s[campo]).toFixed(1)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    linea('acum_egresos', '#E08A2E'); linea('acum_ingresos', '#0D1B2A');
    // Valor final de cada curva, rotulado sobre la propia línea.
    const ult = serie.at(-1); const arriba = ult.acum_ingresos >= ult.acum_egresos;
    [['acum_ingresos', '#0D1B2A', 'Ingresos', arriba], ['acum_egresos', '#E08A2E', 'Egresos', !arriba]].forEach(([c, col, nom, sobre]) => {
      svg.append(h('circle', { cx: x(cantidad - 1), cy: y(ult[c]), r: 4, fill: col, stroke: '#fff', 'stroke-width': 2 }),
        h('text', { x: x(cantidad - 1), y: y(ult[c]) + (sobre ? -10 : 18), 'text-anchor': 'end', 'font-size': 12, 'font-weight': 700, fill: col }, `${nom} ${compacto(ult[c])}`));
    });
    // Punto de equilibrio: donde la curva de ingresos pasa a la de egresos.
    const eq = n.punto_equilibrio ? serie.findIndex((s) => s.mes === n.punto_equilibrio) : -1;
    if (eq >= 0) {
      const b = serie[eq]; const a = serie[eq - 1]; let px = x(eq); let py = y(b.acum_ingresos);
      if (a && a.acum_ingresos < a.acum_egresos) { const d0 = a.acum_ingresos - a.acum_egresos; const d1 = b.acum_ingresos - b.acum_egresos; const t = d0 / (d0 - d1); px = x(eq - 1) + t * (x(eq) - x(eq - 1)); py = y(a.acum_ingresos + t * (b.acum_ingresos - a.acum_ingresos)); }
      const ancla = px < 100 ? 'start' : px > W - 130 ? 'end' : 'middle';
      svg.append(h('line', { x1: px, x2: px, y1: m.s - 6, y2: y(0), stroke: '#2FB37A', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }),
        h('circle', { cx: px, cy: py, r: 7, fill: '#2FB37A', stroke: '#fff', 'stroke-width': 3 }),
        h('text', { x: px, y: 12, 'text-anchor': ancla, 'font-size': 12.5, 'font-weight': 700, fill: '#0F6B49' }, `Equilibrio · ${mesCorto(b.mes)} ${b.mes.slice(0, 4)}`));
    }
    // Lectura al tocar o pasar el cursor: guía vertical y detalle del mes.
    const guia = h('g', { style: 'pointer-events:none', visibility: 'hidden' }, h('line', { y1: m.s - 6, y2: y(0), stroke: '#5B6B76', 'stroke-width': 1 }), h('circle', { r: 4.5, fill: '#0D1B2A', stroke: '#fff', 'stroke-width': 2 }), h('circle', { r: 4.5, fill: '#E08A2E', stroke: '#fff', 'stroke-width': 2 }));
    svg.append(guia);
    const mover = (ev) => {
      const r = svg.getBoundingClientRect(); const px = ((ev.clientX - r.left) * W) / r.width;
      const k = cantidad === 1 ? 0 : Math.max(0, Math.min(cantidad - 1, Math.round(((px - m.i) / pw) * (cantidad - 1))));
      const [l, c1, c2] = guia.children; l.setAttribute('x1', x(k)); l.setAttribute('x2', x(k)); c1.setAttribute('cx', x(k)); c1.setAttribute('cy', y(serie[k].acum_ingresos)); c2.setAttribute('cx', x(k)); c2.setAttribute('cy', y(serie[k].acum_egresos));
      guia.setAttribute('visibility', 'visible'); alMover?.(serie[k]);
    };
    svg.addEventListener('pointermove', mover); svg.addEventListener('pointerdown', mover);
    svg.addEventListener('pointerleave', () => { guia.setAttribute('visibility', 'hidden'); alMover?.(null); });
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
