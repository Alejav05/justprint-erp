// Clientes (alta y contactos) y Hunting (leads en tablero). Recibe las utilidades de app.js.
export function crearCrm(U) {
  const { h, agregar, vaciar, api, usd, fecha, chip, puede, cargando, encabezado, estado, cajon, aviso } = U;

  const ROL = { decisor: 'Decisor', comercial: 'Comercial', compras: 'Compras', administracion: 'Administración', facturacion: 'Recibe facturas', cobranzas: 'Gestiona cobranzas', it: 'IT', tecnico: 'Técnico', usuario: 'Usuario' };
  const ROL_AYUDA = { comercial: 'Con quien se negocia', facturacion: 'A quién se le mandan las facturas', cobranzas: 'A quién se le reclama el pago' };
  const ERR = {
    cuit_invalido: 'El CUIT no es válido. Revisá los 11 números.', cuit_duplicado: 'Ya hay un cliente con ese CUIT.', rubro_invalido: 'Ese rubro no está disponible.', subrubro_invalido: 'Ese subrubro no es de ese rubro.',
    subrubro_sin_rubro: 'Elegí primero el rubro.', contacto_sin_medio: 'Cada contacto necesita al menos un teléfono o un mail.', facturacion_sin_mail: 'Quien recibe las facturas necesita un mail.',
    nacimiento_invalido: 'La fecha de nacimiento no es válida.', sede_invalida: 'Esa sede no es de este cliente.', responsable_invalido: 'No podés asignar a esa persona.', sin_permiso: 'No tenés permiso para hacer eso.',
    motivo_requerido: 'Contanos por qué se perdió.', ya_convertido: 'Este lead ya es cliente.', ganado_se_convierte: 'Para ganarlo, convertilo en cliente.', lead_perdido: 'Un lead perdido no se convierte.', validacion: 'Revisá los datos: hay algo incompleto o fuera de rango.',
  };
  const msg = (e) => ERR[e.datos?.error] ?? 'No se pudo guardar. Probá de nuevo.';
  const hoyISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const nombreCompleto = (k) => [k.nombre, k.apellido].filter(Boolean).join(' ');

  const campo = (rot, el, ayuda, id) => h('div', { class: 'campo' }, h('label', { for: id }, rot), el, ayuda && h('div', { class: 'apoyo' }, ayuda));
  const inp = (id, v, o = {}) => h('input', { id, type: o.tipo ?? 'text', value: v ?? '', maxlength: o.max ?? null, placeholder: o.ph ?? null, inputmode: o.modo ?? null, min: o.min ?? null, autocomplete: 'off' });
  const area = (id, v, ph) => { const t = h('textarea', { id, maxlength: '2000', placeholder: ph ?? null }); t.value = v ?? ''; return t; };
  const opciones = (lista, sel, vacio) => [vacio && h('option', { value: '' }, vacio), ...lista.map(([v, t]) => h('option', { value: v, selected: String(v) === String(sel) }, t))].filter(Boolean);
  const err = () => h('div', { class: 'error oculto', role: 'alert' });
  const mostrarErr = (el, t) => { el.textContent = t; el.classList.remove('oculto'); };

  /* ---------- rubro y subrubro ---------- */
  let cacheRubros;
  const rubros = async () => (cacheRubros ??= (await api('/api/rubros')).rubros);
  async function selectorRubro(rubroId, subId) {
    const arbol = await rubros();
    const r = h('select', { id: 'rb-r', 'aria-label': 'Rubro' }, opciones(arbol.map((x) => [x.id, x.nombre]), rubroId, 'Elegí un rubro'));
    const s = h('select', { id: 'rb-s', 'aria-label': 'Subrubro' });
    const pintarSubs = (sel) => { const subs = arbol.find((x) => String(x.id) === r.value)?.subrubros ?? []; vaciar(s).append(...opciones(subs.map((x) => [x.id, x.nombre]), sel, subs.length ? 'Elegí un subrubro' : 'Primero el rubro')); s.disabled = !subs.length; };
    r.addEventListener('change', () => pintarSubs(null)); pintarSubs(subId);
    return { el: h('div', { class: 'dos-col' }, campo('Rubro', r, null, 'rb-r'), campo('Subrubro', s, null, 'rb-s')), valor: () => ({ rubro_id: r.value ? Number(r.value) : null, subrubro_id: s.value ? Number(s.value) : null }) };
  }

  /* ---------- contactos ---------- */
  /** Formulario de un contacto. `enviar(datos)` guarda (en el servidor o en la lista del alta) y puede lanzar un error de la API. */
  function formContacto({ inicial = {}, sedes = [], enviar, cerrar, etiqueta = 'Guardar contacto' }) {
    const roles = new Set(inicial.roles ?? []); let canal = inicial.canal_preferido ?? null;
    const nombre = inp('c-nom', inicial.nombre, { max: 120 }); const apellido = inp('c-ape', inicial.apellido, { max: 120 }); const cargo = inp('c-car', inicial.cargo, { max: 80, ph: 'Ej: Gerente de compras' });
    const rolesEl = h('div', { class: 'seg', role: 'group', 'aria-label': 'Qué hace para nosotros' });
    const pintarRoles = () => vaciar(rolesEl).append(...Object.entries(ROL).map(([k, t]) => h('button', { type: 'button', class: 'pill', title: ROL_AYUDA[k] ?? null, 'aria-pressed': String(roles.has(k)), onclick: () => { roles.has(k) ? roles.delete(k) : roles.add(k); pintarRoles(); } }, t)));
    pintarRoles();
    const lista = (clave, base, tipos, ph, tipoCampo, modo) => {
      const filas = (inicial[clave]?.length ? inicial[clave] : [{}]).map((x) => ({ ...x })); const caja = h('div');
      const pintar = () => vaciar(caja).append(...filas.map((f, i) => {
        const tipo = h('select', { 'aria-label': 'Tipo' }, opciones(tipos, f.tipo ?? tipos[0][0])); const val = h('input', { type: tipoCampo, inputmode: modo, value: f[base] ?? '', placeholder: ph, 'aria-label': ph, maxlength: '160' });
        tipo.addEventListener('change', () => { f.tipo = tipo.value; }); val.addEventListener('input', () => { f[base] = val.value; }); f.tipo ??= tipos[0][0];
        return h('div', { class: 'fila-medio' }, tipo, val, filas.length > 1 && h('button', { type: 'button', class: 'btn-texto', 'aria-label': 'Quitar', onclick: () => { filas.splice(i, 1); pintar(); } }, 'Quitar'));
      }), filas.length < 5 && h('button', { type: 'button', class: 'btn-texto', onclick: () => { filas.push({}); pintar(); } }, `+ Agregar ${clave === 'telefonos' ? 'otro teléfono' : 'otro mail'}`));
      pintar(); return { el: caja, valor: () => filas.filter((f) => String(f[base] ?? '').trim()).map((f) => ({ tipo: f.tipo, [base]: String(f[base]).trim() })) };
    };
    const tel = lista('telefonos', 'numero', [['celular', 'Celular'], ['whatsapp', 'WhatsApp'], ['fijo', 'Fijo'], ['interno', 'Interno']], 'Ej: 11 5555 0000', 'tel', 'tel');
    const mail = lista('emails', 'direccion', [['laboral', 'Laboral'], ['facturacion', 'Facturación'], ['cobranzas', 'Cobranzas'], ['personal', 'Personal']], 'nombre@empresa.com', 'email', 'email');
    const nac = inp('c-nac', inicial.fecha_nacimiento, { tipo: 'date' }); nac.max = hoyISO(); const edad = h('div', { class: 'apoyo' });
    const pintarEdad = () => { if (!nac.value) { edad.textContent = 'Sirve para saludarlo en su cumpleaños.'; return; } const n = new Date(`${nac.value}T12:00:00Z`); const t = new Date(`${hoyISO()}T12:00:00Z`); let e = t.getUTCFullYear() - n.getUTCFullYear(); if (t.getUTCMonth() < n.getUTCMonth() || (t.getUTCMonth() === n.getUTCMonth() && t.getUTCDate() < n.getUTCDate())) e -= 1; edad.textContent = e >= 0 && e < 110 ? `${e} años` : ''; };
    nac.addEventListener('input', pintarEdad); pintarEdad();
    const canalEl = h('div', { class: 'seg', role: 'group', 'aria-label': 'Canal preferido' });
    const pintarCanal = () => vaciar(canalEl).append(...[['whatsapp', 'WhatsApp'], ['llamada', 'Llamada'], ['mail', 'Mail'], ['presencial', 'En persona']].map(([k, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(canal === k), onclick: () => { canal = canal === k ? null : k; pintarCanal(); } }, t)));
    pintarCanal();
    const horario = inp('c-hor', inicial.horario_preferido, { max: 60, ph: 'Ej: mañanas, de 9 a 12' }); const linkedin = inp('c-lin', inicial.linkedin, { max: 200, ph: 'linkedin.com/in/…' });
    const toner = h('input', { id: 'c-ton', type: 'checkbox', checked: !!inicial.autorizado_toner }); const acepta = h('input', { id: 'c-ace', type: 'checkbox', checked: !!inicial.acepta_comunicaciones });
    const intereses = area('c-int', inicial.intereses, 'Equipo de fútbol, hijos, hobbies, cómo le gusta que lo traten…'); const notas = area('c-not', inicial.notas);
    const sede = h('select', { id: 'c-sed' }, opciones(sedes.map((s) => [s.id, s.nombre]), inicial.sede_id, 'Todas las sedes'));
    const e = err(); const ok = h('button', { class: 'btn btn-principal', type: 'button' }, etiqueta);
    ok.addEventListener('click', async () => {
      e.classList.add('oculto');
      if (!nombre.value.trim()) { mostrarErr(e, 'Falta el nombre.'); nombre.focus(); return; }
      ok.disabled = true;
      try {
        await enviar({ nombre: nombre.value.trim(), apellido: apellido.value.trim() || null, cargo: cargo.value.trim() || null, sede_id: sede.value ? Number(sede.value) : null, roles: [...roles], telefonos: tel.valor(), emails: mail.valor(),
          fecha_nacimiento: nac.value || null, canal_preferido: canal, horario_preferido: horario.value.trim() || null, autorizado_toner: toner.checked, acepta_comunicaciones: acepta.checked, linkedin: linkedin.value.trim() || null, intereses: intereses.value.trim() || null, notas: notas.value.trim() || null });
        cerrar();
      } catch (x) { mostrarErr(e, x.datos?.error ? msg(x) : x.message === 'sesion' ? 'Tu sesión venció.' : 'No se pudo guardar.'); ok.disabled = false; }
    });
    return h('div', null,
      h('div', { class: 'dos-col' }, campo('Nombre', nombre, null, 'c-nom'), campo('Apellido', apellido, null, 'c-ape')), campo('Cargo', cargo, null, 'c-car'),
      h('div', { class: 'campo' }, h('label', null, 'Qué hace para nosotros'), rolesEl, h('div', { class: 'apoyo' }, 'Puede tener varios. “Recibe facturas” y “Gestiona cobranzas” son los que usa Facturación y Cobranzas.')),
      h('div', { class: 'campo' }, h('label', null, 'Teléfonos'), tel.el), h('div', { class: 'campo' }, h('label', null, 'Mails'), mail.el),
      h('div', { class: 'aparte' }), h('h3', { style: 'margin:0 0 10px' }, 'Para fidelizar'),
      campo('Fecha de nacimiento', nac, null, 'c-nac'), edad,
      h('div', { class: 'campo' }, h('label', null, 'Cómo prefiere que lo contactemos'), canalEl), campo('Mejor horario', horario, null, 'c-hor'), campo('Intereses y cosas para recordar', intereses, null, 'c-int'), campo('LinkedIn', linkedin, null, 'c-lin'),
      sedes.length > 1 && campo('Sede con la que trabaja', sede, null, 'c-sed'),
      h('label', { class: 'interruptor', for: 'c-ton' }, toner, h('span', null, 'Puede autorizar pedidos de tóner')),
      h('label', { class: 'interruptor', for: 'c-ace' }, acepta, h('span', null, 'Aceptó recibir comunicaciones nuestras')),
      campo('Notas', notas, null, 'c-not'), e, h('div', { class: 'acciones-cajon' }, ok, h('button', { class: 'btn', type: 'button', onclick: cerrar }, 'Cancelar')));
  }

  const medios = (k) => h('div', { class: 'via' }, k.telefonos.map((t) => {
    const n = String(t.numero).replace(/[^\d+]/g, ''); const wa = t.tipo === 'whatsapp' || t.tipo === 'celular';
    return [h('a', { href: `tel:${n}`, title: 'Llamar' }, t.numero), wa && h('a', { href: `https://wa.me/${n.replace(/^\+/, '').replace(/^0+/, '')}`, target: '_blank', rel: 'noopener', 'aria-label': `WhatsApp a ${nombreCompleto(k)}` }, 'WhatsApp')];
  }), k.emails.map((m) => h('a', { href: `mailto:${m.direccion}` }, m.direccion)));

  /** Tarjeta de un contacto en la ficha del cliente. */
  function tarjetaContacto(k, { sedes, alCambiar }) {
    const editable = puede('contactos.editar');
    const cumple = k.fecha_nacimiento ? h('div', { class: 'cumple' }, k.dias_para_cumple === 0 ? '🎂 Cumple años hoy' : `Cumple ${k.cumple_anios} en ${k.dias_para_cumple} día${k.dias_para_cumple === 1 ? '' : 's'}`, h('span', { class: 'apoyo' }, ` · ${fecha(k.fecha_nacimiento).slice(0, 5)} · ${k.edad} años`)) : null;
    return h('div', { class: 'tarjeta contacto-tarjeta' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start' }, h('div', null, h('b', { class: 'nombre-cliente' }, nombreCompleto(k)), k.cargo && h('div', { class: 'apoyo' }, k.cargo)),
        k.estado !== 'activo' ? chip('Inactivo', 'mudo') : k.autorizado_toner ? chip('Autoriza tóner', 'ok') : null),
      h('div', { style: 'margin:8px 0;display:flex;gap:6px;flex-wrap:wrap' }, k.roles.length ? k.roles.map((r) => chip(ROL[r] ?? r, r === 'facturacion' || r === 'cobranzas' ? 'info' : 'mudo')) : h('span', { class: 'apoyo' }, 'Sin rol asignado')),
      medios(k), cumple,
      (k.canal_preferido || k.horario_preferido) && h('div', { class: 'apoyo', style: 'margin-top:6px' }, `Prefiere ${{ whatsapp: 'WhatsApp', llamada: 'que lo llamen', mail: 'mail', presencial: 'verse en persona' }[k.canal_preferido] ?? 'ser contactado'}${k.horario_preferido ? ` · ${k.horario_preferido}` : ''}`),
      k.intereses && h('div', { class: 'apoyo', style: 'margin-top:6px;white-space:pre-line' }, k.intereses),
      editable && h('div', { class: 'acciones-cajon', style: 'margin-top:10px' },
        h('button', { class: 'btn btn-chico', type: 'button', onclick: () => cajon(`Editar a ${k.nombre}`, (x) => formContacto({ inicial: k, sedes, cerrar: x, enviar: async (d) => { await api(`/api/contactos/${k.id}`, { metodo: 'PATCH', cuerpo: d }); aviso('Contacto actualizado'); alCambiar(); } })) }, 'Editar'),
        h('button', { class: 'btn btn-chico', type: 'button', onclick: (ev) => { const b = ev.currentTarget; if (!b.dataset.seguro) { b.dataset.seguro = '1'; b.textContent = 'Confirmar: eliminar'; setTimeout(() => { delete b.dataset.seguro; b.textContent = 'Eliminar'; }, 3500); return; } api(`/api/contactos/${k.id}`, { metodo: 'DELETE' }).then(() => { aviso('Contacto eliminado'); alCambiar(); }); } }, 'Eliminar')));
  }

  /** Pestaña Contactos del cliente: avisa si falta quien recibe facturas o quien gestiona cobranzas. */
  function pestanaContactos(d, alCambiar) {
    const sedes = d.sedes ?? []; const nuevo = () => cajon('Nuevo contacto', (x) => formContacto({ sedes, cerrar: x, enviar: async (c) => { await api(`/api/clientes/${d.cliente.id}/contactos`, { metodo: 'POST', cuerpo: c }); aviso('Contacto agregado'); alCambiar(); } }));
    const falta = ['facturacion', 'cobranzas'].filter((r) => !d.contactos.some((k) => k.roles.includes(r)));
    return h('div', null,
      h('div', { class: 'acciones', style: 'margin-bottom:12px' }, puede('contactos.editar') && h('button', { class: 'btn btn-principal', type: 'button', onclick: nuevo }, '+ Nuevo contacto')),
      falta.map((r) => h('div', { class: 'alerta-item aviso', style: 'margin-bottom:10px' }, r === 'facturacion' ? 'Falta definir a quién se le mandan las facturas.' : 'Falta definir a quién se le reclama el pago.')),
      d.contactos.length ? h('div', { class: 'rejilla dos-iguales' }, d.contactos.map((k) => tarjetaContacto(k, { sedes, alCambiar }))) : h('div', { class: 'tarjeta vacio' }, h('b', null, 'Todavía no hay contactos'), 'Cargá a quien decide, a quien recibe las facturas y a quien reclama los cobros.'));
  }

  /* ---------- sedes: locales y domicilios del cliente ---------- */
  function formSede({ inicial = {}, clienteId, cerrar, alGuardar }) {
    let zona = inicial.zona ?? 'caba'; const zonaEl = h('div', { class: 'seg', role: 'group', 'aria-label': 'Zona' });
    const nombre = inp('s-nom', inicial.nombre, { max: 120, ph: 'Ej: Sucursal Belgrano' }); const dom = inp('s-dom', inicial.domicilio, { max: 200 }); const loc = inp('s-loc', inicial.localidad, { max: 100 });
    const ind = area('s-ind', inicial.indicaciones, 'Cómo llegar, piso, quién recibe al técnico…'); const prin = h('input', { id: 's-pri', type: 'checkbox', checked: !!inicial.es_principal });
    const pintar = () => vaciar(zonaEl).append(...[['caba', 'CABA · 24 h'], ['resto', 'Resto del país · 48 h']].map(([k, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(zona === k), onclick: () => { zona = k; pintar(); } }, t))); pintar();
    const e = err(); const ok = h('button', { class: 'btn btn-principal', type: 'button' }, inicial.id ? 'Guardar cambios' : 'Agregar local');
    ok.addEventListener('click', async () => {
      if (!nombre.value.trim()) { mostrarErr(e, 'Poné un nombre para el local.'); return; } ok.disabled = true;
      const cuerpo = { nombre: nombre.value.trim(), domicilio: dom.value.trim() || null, localidad: loc.value.trim() || null, zona, indicaciones: ind.value.trim() || null, es_principal: prin.checked };
      try { await api(inicial.id ? `/api/sedes/${inicial.id}` : `/api/clientes/${clienteId}/sedes`, { metodo: inicial.id ? 'PATCH' : 'POST', cuerpo }); cerrar(); aviso(inicial.id ? 'Local actualizado' : 'Local agregado'); alGuardar(); }
      catch (x) { mostrarErr(e, x.datos?.error ? msg(x) : 'No se pudo guardar.'); ok.disabled = false; }
    });
    return h('div', null, campo('Nombre del local', nombre, null, 's-nom'), campo('Domicilio', dom, null, 's-dom'), campo('Localidad', loc, null, 's-loc'),
      h('div', { class: 'campo' }, h('label', null, 'Zona del servicio técnico'), zonaEl, h('div', { class: 'apoyo' }, 'Define en cuánto tiempo se atiende un ticket.')), campo('Indicaciones', ind, null, 's-ind'),
      h('label', { class: 'interruptor', for: 's-pri' }, prin, h('span', null, 'Es la sede principal (donde está el contacto)')), e, h('div', { class: 'acciones-cajon' }, ok, h('button', { class: 'btn', type: 'button', onclick: cerrar }, 'Cancelar')));
  }

  /** Locales del cliente con cuántos equipos y contratos tiene cada uno. El detalle por contrato está en Equipos. */
  function pestanaSedes(d, alCambiar) {
    const editable = puede('clientes.editar');
    const nueva = () => cajon('Nuevo local', (x) => formSede({ clienteId: d.cliente.id, cerrar: x, alGuardar: alCambiar }));
    return h('div', null, editable && h('div', { class: 'acciones', style: 'margin-bottom:12px' }, h('button', { class: 'btn btn-principal', type: 'button', onclick: nueva }, '+ Nuevo local')),
      d.sedes.length ? h('div', { class: 'rejilla dos-iguales' }, d.sedes.map((x) => h('div', { class: 'tarjeta' },
        h('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start' }, h('div', null, h('b', { class: 'nombre-cliente' }, x.nombre), h('div', { class: 'apoyo' }, [x.domicilio, x.localidad].filter(Boolean).join(', ') || 'Sin domicilio')),
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end' }, x.es_principal && chip('Principal', 'info'), chip(x.zona === 'caba' ? 'CABA · 24 h' : 'Resto · 48 h', 'mudo'))),
        h('div', { class: 'hechos', style: 'grid-template-columns:1fr 1fr;margin-top:12px' }, h('div', null, 'Equipos', h('b', null, String(x.equipos))), h('div', null, 'Contratos', h('b', null, String(x.contratos)))),
        x.indicaciones && h('div', { class: 'apoyo', style: 'margin-top:8px;white-space:pre-line' }, x.indicaciones),
        h('div', { class: 'acciones-cajon', style: 'margin-top:10px' },
          x.equipos > 0 && puede('equipos.ver') && h('a', { class: 'btn btn-chico', href: `#/equipos?cliente=${d.cliente.id}` }, 'Ver equipos'),
          editable && h('button', { class: 'btn btn-chico', type: 'button', onclick: () => cajon('Editar local', (c) => formSede({ inicial: x, clienteId: d.cliente.id, cerrar: c, alGuardar: alCambiar })) }, 'Editar'),
          editable && !x.es_principal && h('button', { class: 'btn btn-chico', type: 'button', onclick: (ev) => { const b = ev.currentTarget; if (!b.dataset.seguro) { b.dataset.seguro = '1'; b.textContent = 'Confirmar: eliminar'; setTimeout(() => { delete b.dataset.seguro; b.textContent = 'Eliminar'; }, 3500); return; } api(`/api/sedes/${x.id}`, { metodo: 'DELETE' }).then(() => { aviso('Local eliminado'); alCambiar(); }).catch((er) => aviso(msg(er))); } }, 'Eliminar')))))
        : h('div', { class: 'tarjeta vacio' }, h('b', null, 'Sin locales cargados'), 'Cargá cada domicilio donde haya equipos.'));
  }

  /** Seguimiento de la cuenta (farming): qué se habló, con quién y qué sigue. */
  async function pestanaSeguimiento(d, alCambiar) {
    const caja = h('div'); const TIPOS = { llamada: 'Llamada', visita: 'Visita', mail: 'Mail', whatsapp: 'WhatsApp', reunion: 'Reunión', nota: 'Nota' };
    async function pintar() {
      const r = await api(`/api/clientes/${d.cliente.id}/seguimiento`); let tipo = 'llamada';
      const txt = area('sg-txt', '', 'Qué se habló, qué pidió, cómo está la relación…'); const ctc = h('select', { id: 'sg-ctc', 'aria-label': 'Con quién' }, opciones((d.contactos ?? []).map((k) => [k.id, nombreCompleto(k)]), '', 'Sin contacto puntual'));
      const sig = inp('sg-sig', '', { max: 200, ph: 'Próximo paso (opcional)' }); const sigF = inp('sg-sigf', '', { tipo: 'date' }); const tipos = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de gestión' }); const e = err();
      const pt = () => vaciar(tipos).append(...Object.entries(TIPOS).map(([k, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(tipo === k), onclick: () => { tipo = k; pt(); } }, t))); pt();
      const ok = h('button', { class: 'btn btn-principal', type: 'button' }, 'Registrar');
      ok.addEventListener('click', async () => {
        if (!txt.value.trim()) { mostrarErr(e, 'Contá brevemente qué pasó.'); return; } ok.disabled = true;
        try { await api(`/api/clientes/${d.cliente.id}/seguimiento`, { metodo: 'POST', cuerpo: { tipo, resumen: txt.value.trim(), contacto_id: ctc.value ? Number(ctc.value) : null, proxima_tarea: sig.value.trim() || null, proxima_fecha: sigF.value || null } }); aviso('Gestión registrada'); pintar(); }
        catch (x) { mostrarErr(e, msg(x)); ok.disabled = false; }
      });
      vaciar(caja).append(h('div', { class: 'rejilla dos' },
        h('div', null, h('div', { class: 'tarjeta' }, h('h2', null, 'Historial de la cuenta'), r.interacciones.length ? h('div', { class: 'historia' }, r.interacciones.map((i) => h('div', { class: 'evento' }, h('b', null, TIPOS[i.tipo] ?? i.tipo), ' ',
          h('span', { class: 'apoyo' }, `${i.usuario} · ${fecha(i.fecha)}${i.contacto ? ` · con ${i.contacto}` : ''}`), h('div', { style: 'white-space:pre-line' }, i.resumen)))) : h('p', { class: 'apoyo' }, 'Todavía no hay gestiones. Cada llamada, visita o charla suma a conocer mejor la cuenta.'))),
        h('div', null,
          h('div', { class: 'tarjeta' }, h('h2', null, 'Próximos pasos'), r.tareas.length ? h('ul', { class: 'lista' }, r.tareas.map((t) => h('li', null, h('div', null, h('b', null, t.titulo), h('div', { class: 'apoyo' }, t.vence ? `Para el ${fecha(t.vence)}` : 'Sin fecha')),
            h('div', { style: 'display:flex;gap:8px;align-items:center' }, t.vencida && chip('Vencida', 'malo'), h('button', { class: 'btn btn-chico', type: 'button', onclick: () => api(`/api/tareas/${t.id}/hecha`, { metodo: 'POST' }).then(() => { aviso('Listo'); pintar(); }) }, 'Hecha'))))) : h('p', { class: 'apoyo' }, 'No hay pasos pendientes.')),
          h('div', { class: 'tarjeta' }, h('h2', null, 'Registrar una gestión'), tipos, campo('Con quién', ctc, null, 'sg-ctc'), txt, h('div', { class: 'dos-col', style: 'margin-top:10px' }, sig, sigF), e, h('div', { style: 'margin-top:10px' }, ok)))));
    }
    caja.append(cargando()); pintar(); return caja;
  }

  /* ---------- editar datos del cliente ---------- */
  async function formCliente(d, cerrar, alGuardar) {
    const c = d.cliente; const rub = await selectorRubro(c.rubro_id, c.subrubro_id);
    const rs = inp('e-rs', c.razon_social, { max: 160 }); const nc = inp('e-nc', c.nombre_comercial, { max: 160 }); const cuit = inp('e-cuit', c.cuit, { max: 13, modo: 'numeric', ph: '30-12345678-9' });
    const iva = h('select', { id: 'e-iva' }, opciones([['responsable_inscripto', 'Responsable inscripto'], ['monotributo', 'Monotributo'], ['exento', 'Exento'], ['consumidor_final', 'Consumidor final']], c.condicion_iva, 'Sin definir'));
    const web = inp('e-web', c.sitio_web, { max: 160 }); const tel = inp('e-tel', c.telefono, { max: 40, tipo: 'tel' }); const mail = inp('e-mail', c.email_general, { max: 160, tipo: 'email' });
    const dom = inp('e-dom', c.domicilio_fiscal, { max: 200 }); const loc = inp('e-loc', c.localidad_fiscal, { max: 100 }); const prov = inp('e-prov', c.provincia, { max: 60 });
    const emp = inp('e-emp', c.cantidad_empleados, { tipo: 'number', min: '0', modo: 'numeric' }); const notas = area('e-not', c.notas); let est = c.estado === 'inactivo' ? 'inactivo' : 'activo';
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Estado' }); const motivo = inp('e-mot', c.motivo_baja, { max: 255, ph: 'Por qué dejó de ser cliente' }); const campoMotivo = campo('Motivo de la baja', motivo, null, 'e-mot');
    const pint = () => { vaciar(seg).append(...[['activo', 'Activo'], ['inactivo', 'Inactivo']].map(([k, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(est === k), onclick: () => { est = k; pint(); } }, t))); campoMotivo.style.display = est === 'inactivo' ? '' : 'none'; }; pint();
    const e = err(); const ok = h('button', { class: 'btn btn-principal', type: 'button' }, 'Guardar cambios');
    ok.addEventListener('click', async () => {
      e.classList.add('oculto'); if (rs.value.trim().length < 2) { mostrarErr(e, 'Falta la razón social.'); return; } ok.disabled = true;
      try {
        await api(`/api/clientes/${c.id}`, { metodo: 'PATCH', cuerpo: { razon_social: rs.value.trim(), nombre_comercial: nc.value.trim() || null, cuit: cuit.value.trim() || null, condicion_iva: iva.value || undefined, ...rub.valor(), sitio_web: web.value.trim() || null, telefono: tel.value.trim() || null,
          email_general: mail.value.trim() || null, domicilio_fiscal: dom.value.trim() || null, localidad_fiscal: loc.value.trim() || null, provincia: prov.value.trim() || null, cantidad_empleados: emp.value === '' ? null : Number(emp.value), notas: notas.value.trim() || null,
          estado: est, ...(est === 'inactivo' ? { motivo_baja: motivo.value.trim() || null } : {}) } });
        cerrar(); aviso('Cliente actualizado'); alGuardar();
      } catch (x) { mostrarErr(e, x.datos?.error ? msg(x) : 'No se pudo guardar.'); ok.disabled = false; }
    });
    return h('div', null, campo('Razón social', rs, null, 'e-rs'), campo('Nombre comercial', nc, null, 'e-nc'), h('div', { class: 'dos-col' }, campo('CUIT', cuit, null, 'e-cuit'), campo('Condición frente al IVA', iva, null, 'e-iva')), rub.el,
      h('div', { class: 'dos-col' }, campo('Teléfono', tel, null, 'e-tel'), campo('Mail general', mail, null, 'e-mail')), h('div', { class: 'dos-col' }, campo('Sitio web', web, null, 'e-web'), campo('Empleados', emp, null, 'e-emp')),
      campo('Domicilio fiscal', dom, null, 'e-dom'), h('div', { class: 'dos-col' }, campo('Localidad', loc, null, 'e-loc'), campo('Provincia', prov, null, 'e-prov')),
      h('div', { class: 'campo' }, h('label', null, 'Estado'), seg), campoMotivo, campo('Notas', notas, null, 'e-not'), e, h('div', { class: 'acciones-cajon' }, ok, h('button', { class: 'btn', type: 'button', onclick: cerrar }, 'Cancelar')));
  }

  /* ---------- alta de cliente ---------- */
  async function vistaNuevoCliente(destino) {
    const [rub, eq] = await Promise.all([selectorRubro(null, null), api('/api/equipo-comercial').catch(() => ({ items: [], puede_elegir: false }))]);
    const rs = inp('n-rs', '', { max: 160, ph: 'Como figura en AFIP' }); const nc = inp('n-nc', '', { max: 160, ph: 'Cómo la conocemos' }); const cuit = inp('n-cuit', '', { max: 13, modo: 'numeric', ph: '30-12345678-9' });
    const iva = h('select', { id: 'n-iva' }, opciones([['responsable_inscripto', 'Responsable inscripto'], ['monotributo', 'Monotributo'], ['exento', 'Exento'], ['consumidor_final', 'Consumidor final']], '', 'Sin definir'));
    const tam = h('select', { id: 'n-tam' }, opciones(['Micro', 'Pequeña', 'Mediana', 'Grande'].map((x) => [x, x]), '', 'Sin definir')); const emp = inp('n-emp', '', { tipo: 'number', min: '0', modo: 'numeric' });
    const web = inp('n-web', '', { max: 160, ph: 'www.empresa.com' }); const tel = inp('n-tel', '', { max: 40, tipo: 'tel' }); const mail = inp('n-mail', '', { max: 160, tipo: 'email' });
    const dom = inp('n-dom', '', { max: 200 }); const loc = inp('n-loc', '', { max: 100 }); const prov = inp('n-prov', 'Buenos Aires', { max: 60 });
    const mismaSede = h('input', { id: 'n-misma', type: 'checkbox', checked: true }); const sNom = inp('n-snom', 'Sede principal', { max: 120 }); const sDom = inp('n-sdom', '', { max: 200 }); const sLoc = inp('n-sloc', '', { max: 100 });
    let zona = 'caba'; const zonaEl = h('div', { class: 'seg', role: 'group', 'aria-label': 'Zona' }); const sedeExtra = h('div'); const notas = area('n-not', '', 'Cómo llegó, qué necesita, quién la recomendó…');
    const origen = h('select', { id: 'n-ori' }, opciones(['Hunting', 'Referido', 'Web', 'Llamado entrante', 'Evento', 'Otro'].map((x) => [x, x]), '', 'Sin definir'));
    const resp = h('select', { id: 'n-resp' }, opciones(eq.items.map((u) => [u.id, u.nombre]), estado.me.id, 'Sin asignar'));
    const contactos = []; const listaK = h('div'); const faltan = h('div'); const resumen = h('div', { class: 'bloque resumen-contrato' });
    const e = err(); const guardar = h('button', { class: 'btn btn-principal', type: 'button' }, 'Crear cliente');
    const pintarZona = () => vaciar(zonaEl).append(...[['caba', 'CABA · atención en 24 h'], ['resto', 'Resto del país · 48 h']].map(([k, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(zona === k), onclick: () => { zona = k; pintarZona(); } }, t)));
    const pintarSede = () => { vaciar(sedeExtra); if (!mismaSede.checked) sedeExtra.append(campo('Nombre de la sede', sNom, null, 'n-snom'), campo('Domicilio de la sede', sDom, null, 'n-sdom'), campo('Localidad', sLoc, null, 'n-sloc')); };
    mismaSede.addEventListener('change', pintarSede);
    const sedesAlta = () => [{ id: 1, nombre: 'Sede principal' }];
    function pintarContactos() {
      vaciar(listaK).append(...contactos.map((k, i) => h('div', { class: 'tarjeta contacto-tarjeta', style: 'margin-bottom:10px' },
        h('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, h('div', null, h('b', null, nombreCompleto(k)), k.cargo && h('div', { class: 'apoyo' }, k.cargo)),
          h('div', { class: 'acciones-cajon' }, h('button', { class: 'btn btn-chico', type: 'button', onclick: () => cajon('Editar contacto', (x) => formContacto({ inicial: k, cerrar: x, etiqueta: 'Listo', enviar: async (d) => { contactos[i] = d; pintarContactos(); } })) }, 'Editar'),
            h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { contactos.splice(i, 1); pintarContactos(); } }, 'Quitar'))),
        h('div', { style: 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap' }, k.roles.length ? k.roles.map((r) => chip(ROL[r] ?? r, 'info')) : h('span', { class: 'apoyo' }, 'Sin rol asignado')), h('div', { class: 'apoyo' }, [...k.telefonos.map((t) => t.numero), ...k.emails.map((m) => m.direccion)].join(' · '))))
        , contactos.length === 0 && h('p', { class: 'apoyo' }, 'Todavía no cargaste ningún contacto.'));
      const falta = ['decisor', 'facturacion', 'cobranzas'].filter((r) => !contactos.some((k) => k.roles.includes(r)));
      vaciar(faltan).append(...falta.map((r) => h('div', { class: 'apoyo' }, `Falta quién ${{ decisor: 'decide', facturacion: 'recibe las facturas', cobranzas: 'gestiona las cobranzas' }[r]}`)));
      pintarResumen();
    }
    function pintarResumen() {
      const item = (ok, t) => h('li', { class: ok ? 'ok' : 'falta' }, h('span', { class: 'marca-chk', 'aria-hidden': 'true' }, ok ? '✓' : '!'), h('div', null, t));
      const rol = (r) => contactos.some((k) => k.roles.includes(r));
      vaciar(resumen).append(h('h3', null, 'Qué tiene hasta ahora'), h('ul', { class: 'lista checklist' },
        item(rs.value.trim().length > 1, 'Razón social'), item(!!cuit.value.trim(), 'CUIT (hace falta para facturar)'), item(!!rub.valor().subrubro_id, 'Rubro y subrubro'), item(contactos.length > 0, 'Al menos un contacto'),
        item(rol('facturacion'), 'Quién recibe las facturas'), item(rol('cobranzas'), 'Quién gestiona las cobranzas')),
        h('p', { class: 'apoyo', style: 'margin:12px 0 0' }, 'Nada de esto es obligatorio para crear el cliente: lo podés completar después.'));
    }
    [rs, cuit].forEach((x) => x.addEventListener('input', pintarResumen)); rub.el.addEventListener('change', pintarResumen);
    guardar.addEventListener('click', async () => {
      e.classList.add('oculto'); if (rs.value.trim().length < 2) { mostrarErr(e, 'Falta la razón social.'); rs.focus(); return; } guardar.disabled = true;
      const misma = mismaSede.checked;
      try {
        const r = await api('/api/clientes', { metodo: 'POST', cuerpo: { razon_social: rs.value.trim(), nombre_comercial: nc.value.trim() || null, cuit: cuit.value.trim() || null, condicion_iva: iva.value || undefined, ...rub.valor(), tamano: tam.value || undefined, cantidad_empleados: emp.value === '' ? null : Number(emp.value),
          sitio_web: web.value.trim() || null, telefono: tel.value.trim() || null, email_general: mail.value.trim() || null, domicilio_fiscal: dom.value.trim() || null, localidad_fiscal: loc.value.trim() || null, provincia: prov.value.trim() || null,
          origen: origen.value || undefined, notas: notas.value.trim() || undefined, estado: 'activo',
          sede: { nombre: misma ? 'Sede principal' : sNom.value.trim() || 'Sede principal', domicilio: (misma ? dom.value : sDom.value).trim() || null, localidad: (misma ? loc.value : sLoc.value).trim() || null, zona },
          contactos, responsable_id: eq.puede_elegir && resp.value ? Number(resp.value) : null } });
        aviso('Cliente creado'); location.hash = `#/clientes/${r.id}`;
      } catch (x) { mostrarErr(e, x.datos?.error ? msg(x) : 'No se pudo crear el cliente.'); guardar.disabled = false; }
    });
    pintarZona(); pintarSede(); pintarContactos();
    agregar(destino, [h('a', { href: '#/clientes', class: 'apoyo' }, '← Clientes'), encabezado('Nuevo cliente', 'Para cuentas que ya trabajan con nosotros. Los prospectos nuevos se cargan en Hunting.'),
      h('div', { class: 'rejilla dos' },
        h('div', null,
          h('div', { class: 'tarjeta' }, h('h2', null, 'La empresa'), campo('Razón social', rs, null, 'n-rs'), campo('Nombre comercial', nc, null, 'n-nc'),
            h('div', { class: 'dos-col' }, campo('CUIT', cuit, 'Se valida solo.', 'n-cuit'), campo('Condición frente al IVA', iva, null, 'n-iva')), rub.el,
            h('div', { class: 'dos-col' }, campo('Tamaño', tam, null, 'n-tam'), campo('Cantidad de empleados', emp, null, 'n-emp')),
            h('div', { class: 'dos-col' }, campo('Teléfono general', tel, null, 'n-tel'), campo('Mail general', mail, null, 'n-mail')), campo('Sitio web', web, null, 'n-web')),
          h('div', { class: 'tarjeta' }, h('h2', null, 'Dónde está'), campo('Domicilio fiscal', dom, null, 'n-dom'), h('div', { class: 'dos-col' }, campo('Localidad', loc, null, 'n-loc'), campo('Provincia', prov, null, 'n-prov')),
            h('label', { class: 'interruptor', for: 'n-misma' }, mismaSede, h('span', null, 'Los equipos van al domicilio fiscal')), sedeExtra,
            h('div', { class: 'campo', style: 'margin-top:12px' }, h('label', null, 'Zona del servicio técnico'), zonaEl, h('div', { class: 'apoyo' }, 'Define en cuánto tiempo se atiende un ticket.'))),
          h('div', { class: 'tarjeta' }, h('h2', null, 'Contactos'), h('p', { class: 'apoyo', style: 'margin-top:0' }, 'Quien decide, quien recibe las facturas, quien reclama los cobros. Puede ser uno o varios.'), listaK, faltan,
            h('button', { class: 'btn', type: 'button', style: 'margin-top:10px', onclick: () => cajon('Nuevo contacto', (x) => formContacto({ sedes: [], cerrar: x, etiqueta: 'Agregar', enviar: async (d) => { contactos.push(d); pintarContactos(); } })) }, '+ Agregar contacto')),
          h('div', { class: 'tarjeta' }, h('h2', null, 'Cuenta'), h('div', { class: 'dos-col' }, campo('De dónde llegó', origen, null, 'n-ori'), eq.puede_elegir ? campo('Comercial responsable', resp, null, 'n-resp') : h('div')),
            campo('Notas', notas, null, 'n-not')),
          e, h('div', { class: 'acciones' }, guardar, h('a', { class: 'btn', href: '#/clientes' }, 'Cancelar'))),
        h('div', null, resumen, h('div', { class: 'bloque', style: 'margin-top:16px' }, h('h3', null, 'Después'), h('p', { class: 'apoyo', style: 'margin:0' }, 'Desde la ficha del cliente cargás su contrato: de ahí sale todo lo que se factura.'))))]);
    pintarResumen();
  }

  /** Próximos cumpleaños de contactos: para que el comercial salude y fidelice. */
  async function tarjetaCumples(dias = 21) {
    if (!puede('contactos.ver')) return null;
    const { items } = await api(`/api/contactos/cumples?dias=${dias}`).catch(() => ({ items: [] }));
    if (!items.length) return null;
    return h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Próximos cumpleaños'), h('ul', { class: 'lista' }, items.slice(0, 6).map((c) => h('li', null,
      h('div', null, h('a', { href: `#/clientes/${c.cliente_id}` }, h('b', null, c.nombre)), h('div', { class: 'apoyo' }, `${c.cliente} · cumple ${c.cumple_anios}`)), chip(c.dias_para_cumple === 0 ? 'Hoy' : c.dias_para_cumple === 1 ? 'Mañana' : `En ${c.dias_para_cumple} días`, c.dias_para_cumple <= 3 ? 'aviso' : 'mudo')))));
  }

  /* ---------- Hunting ---------- */
  const ORIGENES = ['LinkedIn', 'Referido', 'Web', 'Llamado entrante', 'Evento', 'Base fría', 'Otro'];
  const TIPO_ACT = { llamada: 'Llamada', mail: 'Mail', whatsapp: 'WhatsApp', visita: 'Visita', reunion: 'Reunión', nota: 'Nota' };

  async function formLead({ inicial = {}, cerrar, alGuardar }) {
    const [rub, eq] = await Promise.all([selectorRubro(inicial.rubro_id, inicial.subrubro_id), api('/api/equipo-comercial').catch(() => ({ items: [], puede_elegir: false }))]);
    const emp = inp('l-emp', inicial.empresa, { max: 160, ph: 'Nombre de la empresa' }); const nom = inp('l-nom', inicial.contacto_nombre, { max: 120 }); const ape = inp('l-ape', inicial.contacto_apellido, { max: 120 }); const car = inp('l-car', inicial.cargo, { max: 80 });
    const mail = inp('l-mail', inicial.email, { tipo: 'email', max: 160 }); const tel = inp('l-tel', inicial.telefono, { tipo: 'tel', max: 40 });
    const ori = h('select', { id: 'l-ori' }, opciones(ORIGENES.map((x) => [x, x]), inicial.origen, 'Sin definir')); const val = inp('l-val', inicial.valor_estimado_usd, { tipo: 'number', min: '0', modo: 'decimal', ph: 'USD por mes' }); const eqs = inp('l-eqs', inicial.equipos_estimados, { tipo: 'number', min: '0', modo: 'numeric' });
    const acc = inp('l-acc', inicial.proxima_accion, { max: 200, ph: 'Ej: Llamar para coordinar una demo' }); const accF = inp('l-accf', inicial.proxima_accion_fecha, { tipo: 'date' }); const notas = area('l-not', inicial.notas);
    const resp = h('select', { id: 'l-resp' }, opciones(eq.items.map((u) => [u.id, u.nombre]), inicial.responsable_id ?? estado.me.id));
    const e = err(); const ok = h('button', { class: 'btn btn-principal', type: 'button' }, inicial.id ? 'Guardar cambios' : 'Crear lead');
    ok.addEventListener('click', async () => {
      e.classList.add('oculto'); if (emp.value.trim().length < 2) { mostrarErr(e, 'Falta el nombre de la empresa.'); emp.focus(); return; } ok.disabled = true;
      const cuerpo = { empresa: emp.value.trim(), contacto_nombre: nom.value.trim() || null, contacto_apellido: ape.value.trim() || null, cargo: car.value.trim() || null, email: mail.value.trim() || null, telefono: tel.value.trim() || null, ...rub.valor(),
        origen: ori.value || null, valor_estimado_usd: val.value === '' ? null : Number(val.value), equipos_estimados: eqs.value === '' ? null : Number(eqs.value), proxima_accion: acc.value.trim() || null, proxima_accion_fecha: accF.value || null, notas: notas.value.trim() || null,
        ...(eq.puede_elegir && resp.value ? { responsable_id: Number(resp.value) } : {}) };
      try { await api(inicial.id ? `/api/leads/${inicial.id}` : '/api/leads', { metodo: inicial.id ? 'PATCH' : 'POST', cuerpo }); cerrar(); aviso(inicial.id ? 'Lead actualizado' : 'Lead creado'); alGuardar(); }
      catch (x) { mostrarErr(e, x.datos?.error ? msg(x) : 'No se pudo guardar.'); ok.disabled = false; }
    });
    return h('div', null, campo('Empresa', emp, null, 'l-emp'), h('div', { class: 'dos-col' }, campo('Nombre del contacto', nom, null, 'l-nom'), campo('Apellido', ape, null, 'l-ape')), campo('Cargo', car, null, 'l-car'),
      h('div', { class: 'dos-col' }, campo('Mail', mail, null, 'l-mail'), campo('Teléfono', tel, null, 'l-tel')), rub.el, h('div', { class: 'dos-col' }, campo('De dónde llegó', ori, null, 'l-ori'), eq.puede_elegir ? campo('Responsable', resp, null, 'l-resp') : h('div')),
      h('div', { class: 'dos-col' }, campo('Abono estimado (USD por mes)', val, null, 'l-val'), campo('Equipos que necesitaría', eqs, null, 'l-eqs')),
      campo('Próxima acción', acc, null, 'l-acc'), campo('Para cuándo', accF, null, 'l-accf'), campo('Notas', notas, null, 'l-not'), e, h('div', { class: 'acciones-cajon' }, ok, h('button', { class: 'btn', type: 'button', onclick: cerrar }, 'Cancelar')));
  }

  function formPerdido(lead, cerrar, alGuardar) {
    const motivo = h('select', { id: 'p-mot' }, opciones(['Eligió otro proveedor', 'Precio', 'No tiene presupuesto', 'No respondió más', 'Ya tiene el servicio resuelto', 'No era el perfil'].map((x) => [x, x]), '', 'Elegí un motivo')); const otro = inp('p-otro', '', { max: 200, ph: 'Detalle (opcional)' });
    const e = err(); const ok = h('button', { class: 'btn btn-principal', type: 'button' }, 'Marcar como perdido');
    ok.addEventListener('click', async () => {
      if (!motivo.value) { mostrarErr(e, 'Elegí un motivo.'); return; } ok.disabled = true;
      try { await api(`/api/leads/${lead.id}/mover`, { metodo: 'POST', cuerpo: { etapa: 'perdido', motivo: otro.value.trim() ? `${motivo.value}: ${otro.value.trim()}` : motivo.value } }); cerrar(); aviso('Lead marcado como perdido'); alGuardar(); }
      catch (x) { mostrarErr(e, msg(x)); ok.disabled = false; }
    });
    return h('div', null, campo('Motivo', motivo, null, 'p-mot'), campo('Detalle', otro, null, 'p-otro'), e, h('div', { class: 'acciones-cajon' }, ok, h('button', { class: 'btn', type: 'button', onclick: cerrar }, 'Cancelar')));
  }

  function formConvertir(lead, cerrar) {
    const rs = inp('v-rs', lead.empresa, { max: 160 }); const cuit = inp('v-cuit', '', { max: 13, modo: 'numeric', ph: '30-12345678-9' }); const roles = new Set(['decisor']); const rolesEl = h('div', { class: 'seg', role: 'group', 'aria-label': 'Rol del contacto' });
    const pint = () => vaciar(rolesEl).append(...['decisor', 'comercial', 'compras', 'administracion', 'facturacion', 'cobranzas'].map((k) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(roles.has(k)), onclick: () => { roles.has(k) ? roles.delete(k) : roles.add(k); pint(); } }, ROL[k]))); pint();
    const e = err(); const ok = h('button', { class: 'btn btn-principal', type: 'button' }, puede('contratos.editar') ? 'Crear cliente y cargar contrato' : 'Crear el cliente');
    ok.addEventListener('click', async () => {
      ok.disabled = true; e.classList.add('oculto');
      try { const r = await api(`/api/leads/${lead.id}/convertir`, { metodo: 'POST', cuerpo: { razon_social: rs.value.trim() || undefined, cuit: cuit.value.trim() || null, roles: [...roles] } }); cerrar(); aviso('¡Ganado! Ya es cliente'); if (puede('contratos.editar') && puede('importes.ver')) { estado.nuevoContrato = { empresa: lead.empresa, abono: lead.valor_estimado_usd, equipos: lead.equipos_estimados }; location.hash = `#/contratos/nuevo/${r.cliente_id}`; } else location.hash = `#/clientes/${r.cliente_id}`; }
      catch (x) { mostrarErr(e, msg(x)); ok.disabled = false; }
    });
    return h('div', null, h('p', { class: 'apoyo', style: 'margin-top:0' }, 'Se crea el cliente con su sede, el contacto y la cuenta a tu nombre, y seguís con el contrato cerrado. Desde ahí el lead sale de Hunting y pasa a Clientes.'), campo('Razón social', rs, null, 'v-rs'), campo('CUIT (si ya lo tenés)', cuit, null, 'v-cuit'),
      lead.contacto_nombre && h('div', { class: 'campo' }, h('label', null, `Qué hace ${lead.contacto_nombre} en la empresa`), rolesEl), e, h('div', { class: 'acciones-cajon' }, ok, h('button', { class: 'btn', type: 'button', onclick: cerrar }, 'Cancelar')));
  }

  async function detalleLead(id, etapas, alCambiar) {
    cajon('Lead', (cerrar) => {
      const cuerpo = h('div', null, cargando());
      const refrescar = async () => {
        const d = await api(`/api/leads/${id}`).catch(() => null); if (!d) { vaciar(cuerpo).append(h('div', { class: 'vacio' }, 'No encontramos este lead.')); return; }
        const l = d.lead; const abierto = !['ganado', 'perdido'].includes(l.etapa); let tipo = 'llamada';
        const txt = area('a-txt', '', 'Qué pasó, qué se habló…'); const sig = inp('a-sig', '', { max: 200, ph: 'Próxima acción (opcional)' }); const sigF = inp('a-sigf', '', { tipo: 'date' }); const tipos = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de gestión' }); const e = err();
        const pintarTipos = () => vaciar(tipos).append(...Object.entries(TIPO_ACT).map(([k, t]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(tipo === k), onclick: () => { tipo = k; pintarTipos(); } }, t))); pintarTipos();
        const guardarAct = h('button', { class: 'btn btn-principal', type: 'button' }, 'Registrar');
        guardarAct.addEventListener('click', async () => {
          if (!txt.value.trim()) { mostrarErr(e, 'Contá brevemente qué pasó.'); return; } guardarAct.disabled = true;
          try { await api(`/api/leads/${id}/actividades`, { metodo: 'POST', cuerpo: { tipo, texto: txt.value.trim(), ...(sig.value.trim() || sigF.value ? { proxima_accion: sig.value.trim() || null, proxima_accion_fecha: sigF.value || null } : {}) } }); aviso('Gestión registrada'); alCambiar(); refrescar(); }
          catch (x) { mostrarErr(e, msg(x)); guardarAct.disabled = false; }
        });
        const mover = (clave) => async () => { try { await api(`/api/leads/${id}/mover`, { metodo: 'POST', cuerpo: { etapa: clave } }); aviso('Lead movido'); alCambiar(); refrescar(); } catch (x) { aviso(msg(x)); } };
        vaciar(cuerpo).append(
          h('div', { class: 'bloque' }, h('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start' }, h('div', null, h('h3', { style: 'font-size:19px;margin:0' }, l.empresa), h('div', { class: 'apoyo' }, [l.rubro, l.subrubro].filter(Boolean).join(' · ') || 'Sin rubro')),
            chip(etapas.find((x) => x.clave === l.etapa)?.titulo ?? l.etapa, l.etapa === 'ganado' ? 'ok' : l.etapa === 'perdido' ? 'malo' : 'info')),
            h('dl', { class: 'datos', style: 'grid-template-columns:1fr;margin:12px 0 0' },
              [['Contacto', [nombreCompleto({ nombre: l.contacto_nombre, apellido: l.contacto_apellido }), l.cargo].filter(Boolean).join(' · ')], ['Mail', l.email], ['Teléfono', l.telefono], ['Responsable', l.responsable], ['Origen', l.origen],
                ['Potencial', l.valor_estimado_usd != null ? `${usd(l.valor_estimado_usd)} por mes${l.equipos_estimados ? ` · ${l.equipos_estimados} equipos` : ''}` : null], ['En esta etapa', `${l.dias_en_etapa} día${l.dias_en_etapa === 1 ? '' : 's'}`], l.motivo_perdida && ['Motivo', l.motivo_perdida]]
                .filter(Boolean).filter(([, v]) => v).map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))),
            l.proxima_accion && h('div', { class: `alerta-item ${l.accion_vencida ? 'malo' : 'aviso'}`, style: 'margin-top:12px' }, `${l.proxima_accion}${l.proxima_accion_fecha ? ` · ${fecha(l.proxima_accion_fecha)}` : ''}`, l.accion_vencida && h('span', null, 'Vencida')),
            l.notas && h('p', { class: 'apoyo', style: 'white-space:pre-line;margin:12px 0 0' }, l.notas)),
          abierto && h('div', { class: 'bloque' }, h('h3', null, 'Mover a'), h('div', { class: 'seg', style: 'margin:0' }, etapas.filter((x) => !['ganado', 'perdido'].includes(x.clave)).map((x) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(x.clave === l.etapa), onclick: x.clave === l.etapa ? null : mover(x.clave) }, x.titulo)))),
          abierto && h('div', { class: 'bloque' }, h('h3', null, 'Registrar una gestión'), tipos, txt, h('div', { class: 'dos-col', style: 'margin-top:10px' }, sig, sigF), e, h('div', { style: 'margin-top:10px' }, guardarAct)),
          h('div', { class: 'bloque' }, h('h3', null, 'Historial'), h('div', { class: 'historia' }, d.actividades.map((a) => h('div', { class: `evento${a.tipo === 'etapa' ? ' e-escalada' : ''}` }, h('b', null, a.tipo === 'etapa' ? 'Etapa' : TIPO_ACT[a.tipo] ?? a.tipo), ' ', h('span', { class: 'apoyo' }, `${a.usuario ?? ''} · ${String(a.fecha).slice(0, 10).split('-').reverse().join('/')}`), a.texto && h('div', null, a.texto))))),
          l.cliente_id ? h('a', { class: 'btn btn-principal', href: `#/clientes/${l.cliente_id}`, onclick: cerrar }, 'Ver el cliente')
            : abierto && h('div', { class: 'acciones-cajon' }, puede('clientes.editar') && h('button', { class: 'btn btn-principal', type: 'button', onclick: () => { cerrar(); cajon('Convertir en cliente', (x) => formConvertir(l, x)); } }, 'Ganado: crear cliente y contrato'),
              h('button', { class: 'btn', type: 'button', onclick: () => { cerrar(); cajon('Editar lead', (x) => { const c = h('div', null, cargando()); formLead({ inicial: l, cerrar: x, alGuardar: alCambiar }).then((f) => vaciar(c).append(f)); return c; }); } }, 'Editar'),
              h('button', { class: 'btn', type: 'button', onclick: () => { cerrar(); cajon('Marcar como perdido', (x) => formPerdido(l, x, alCambiar)); } }, 'Perdido')));
      };
      refrescar(); return cuerpo;
    });
  }

  async function vistaHunting(destino) {
    const zona = h('div'); const buscar = h('input', { type: 'search', placeholder: 'Buscar empresa o contacto', 'aria-label': 'Buscar lead' }); const resp = h('select', { 'aria-label': 'Responsable' }); const resumen = h('div');
    let datos; let t0; let respCargado = false;
    async function cargar() {
      const q = new URLSearchParams(); if (buscar.value.trim()) q.set('q', buscar.value.trim()); if (resp.value) q.set('responsable', resp.value);
      datos = await api(`/api/leads?${q}`);
      if (datos.ve_todos && !respCargado) { respCargado = true; const eq = await api('/api/equipo-comercial').catch(() => ({ items: [] })); resp.append(...opciones(eq.items.map((u) => [u.id, u.nombre]), '', 'Todo el equipo')); } else if (!datos.ve_todos) resp.style.display = 'none';
      pintar();
    }
    const mover = async (lead, etapa) => {
      if (lead.etapa === etapa || lead.cliente_id) return;
      if (etapa === 'perdido') { cajon('Marcar como perdido', (x) => formPerdido(lead, x, cargar)); return; }
      if (etapa === 'ganado') { cajon('Convertir en cliente', (x) => formConvertir(lead, x)); return; }
      try { await api(`/api/leads/${lead.id}/mover`, { metodo: 'POST', cuerpo: { etapa } }); aviso('Lead movido'); } catch (x) { aviso(msg(x)); } cargar();
    };
    function pintar() {
      const abiertos = datos.items.filter((l) => !['ganado', 'perdido'].includes(l.etapa)); const potencial = abiertos.reduce((s, l) => s + (l.valor_estimado_usd ?? 0), 0); const vencidas = abiertos.filter((l) => l.accion_vencida).length;
      vaciar(resumen).append(h('div', { class: 'rejilla kpis' }, U.kpiTarjeta('Leads abiertos', String(abiertos.length)), U.kpiTarjeta('Potencial mensual', usd(potencial), 'Suma de abonos estimados'), U.kpiTarjeta('Acciones vencidas', String(vencidas), null, vencidas ? 'alerta' : '')));
      vaciar(zona).append(h('div', { class: 'tablero-leads' }, datos.etapas.map((et) => {
        const items = datos.items.filter((l) => l.etapa === et.clave); const suma = items.reduce((s, l) => s + (l.valor_estimado_usd ?? 0), 0);
        const col = h('section', { class: `col-lead col-${et.clave}`, 'aria-label': et.titulo },
          h('header', null, h('b', null, et.titulo), h('span', { class: 'cuenta' }, String(items.length)), suma > 0 && h('span', { class: 'apoyo' }, usd(suma))),
          h('div', { class: 'col-cuerpo' }, items.length ? items.map((l) => tarjetaLead(l)) : h('div', { class: 'col-vacia' }, et.clave === 'ganado' || et.clave === 'perdido' ? 'Acá van los cerrados de los últimos 30 días.' : 'Arrastrá un lead hasta acá.')));
        col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('sobre'); }); col.addEventListener('dragleave', (ev) => { if (!col.contains(ev.relatedTarget)) col.classList.remove('sobre'); });
        col.addEventListener('drop', (ev) => { ev.preventDefault(); col.classList.remove('sobre'); const l = datos.items.find((x) => String(x.id) === ev.dataTransfer.getData('text/plain')); if (l) mover(l, et.clave); });
        return col;
      })));
    }
    function tarjetaLead(l) {
      const t = h('article', { class: `lead${l.accion_vencida ? ' vencida' : ''}`, draggable: l.cliente_id ? 'false' : 'true', tabindex: '0', 'aria-label': `${l.empresa}, ${l.dias_en_etapa} días en la etapa` },
        h('b', { class: 'lead-nombre' }, l.empresa), (l.contacto_nombre || l.rubro) && h('div', { class: 'apoyo' }, [nombreCompleto({ nombre: l.contacto_nombre, apellido: l.contacto_apellido }), l.rubro].filter(Boolean).join(' · ')),
        h('div', { class: 'lead-pie' }, l.valor_estimado_usd != null && h('span', { class: 'lead-valor' }, `${usd(l.valor_estimado_usd)}/mes`), !['ganado', 'perdido'].includes(l.etapa) && h('span', { class: 'apoyo' }, `${l.dias_en_etapa} d`)),
        l.proxima_accion && h('div', { class: `lead-accion${l.accion_vencida ? ' vencida' : ''}` }, l.proxima_accion, l.proxima_accion_fecha && ` · ${fecha(l.proxima_accion_fecha).slice(0, 5)}`),
        l.responsable && datos.ve_todos && h('div', { class: 'apoyo' }, l.responsable));
      t.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', String(l.id)); ev.dataTransfer.effectAllowed = 'move'; t.classList.add('arrastrando'); }); t.addEventListener('dragend', () => t.classList.remove('arrastrando'));
      const abrir = () => detalleLead(l.id, datos.etapas, cargar); t.addEventListener('click', abrir); t.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abrir(); });
      return t;
    }
    buscar.addEventListener('input', () => { clearTimeout(t0); t0 = setTimeout(cargar, 250); }); resp.addEventListener('change', cargar);
    const nuevo = () => cajon('Nuevo lead', (x) => { const c = h('div', null, cargando()); formLead({ cerrar: x, alGuardar: cargar }).then((f) => vaciar(c).append(f)); return c; });
    agregar(destino, [encabezado('Hunting', 'Prospectos en camino a ser clientes.', puede('leads.editar') && h('div', { class: 'acciones' }, h('button', { class: 'btn btn-principal', type: 'button', onclick: nuevo }, '+ Nuevo lead'))),
      resumen, h('div', { class: 'herramientas' }, buscar, resp), zona]);
    vaciar(zona).append(cargando()); await cargar();
  }

  /** Tarjeta de Hunting para el inicio del comercial: qué leads piden acción. */
  async function resumenHunting() {
    const r = await api('/api/leads').catch(() => null); if (!r) return h('div');
    const abiertos = r.items.filter((l) => !['ganado', 'perdido'].includes(l.etapa)).sort((a, b) => (b.accion_vencida - a.accion_vencida) || String(a.proxima_accion_fecha ?? '9').localeCompare(String(b.proxima_accion_fecha ?? '9')));
    return h('div', { class: 'tarjeta' }, h('p', { class: 'etiqueta' }, 'Hunting: lo que sigue'), abiertos.length ? h('ul', { class: 'lista' }, abiertos.slice(0, 6).map((l) => h('li', null,
      h('div', null, h('a', { href: '#/hunting' }, h('b', null, l.empresa)), h('div', { class: 'apoyo' }, l.proxima_accion ?? 'Sin próxima acción')), l.accion_vencida ? chip('Vencida', 'malo') : l.proxima_accion_fecha ? chip(fecha(l.proxima_accion_fecha).slice(0, 5), 'mudo') : null)))
      : h('div', { class: 'vacio' }, h('b', null, 'Sin leads abiertos'), h('a', { href: '#/hunting' }, 'Cargar un lead')));
  }

  return { resumenHunting, vistaNuevoCliente, pestanaContactos, pestanaSedes, pestanaSeguimiento, formCliente, tarjetaCumples, vistaHunting };
}
