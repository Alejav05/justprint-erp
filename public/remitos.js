// Remitos: lista, alta (equipos + insumos), vista del remito, conformidad firmada en el celular, remito firmado en papel y envío al cliente.
export function crearRemitos(U) {
  const { h, vaciar, api, fecha, cuando, chip, puede, cargando, encabezado, cajon, aviso, usd } = U;
  const ERR = {
    sin_items: 'Agregá al menos un equipo o un insumo.', sin_stock: 'No hay stock suficiente de uno de los insumos.', equipo_invalido: 'Uno de los equipos no está disponible para este cliente.',
    insumo_invalido: 'Uno de los insumos ya no existe.', sede_invalida: 'La sede no es de este cliente.', firma_invalida: 'La firma no es válida. Volvé a firmar.', ya_firmado: 'Este remito ya tiene su conformidad.',
    remito_anulado: 'El remito está anulado.', archivo_invalido: 'El archivo tiene que ser un PDF, JPG o PNG.', archivo_muy_grande: 'El archivo pesa más de 10 MB. Sacale la foto con menos resolución o comprimilo.',
    mail_no_configurado: 'El envío automático por mail todavía no está configurado.', whatsapp_no_configurado: 'El envío automático por WhatsApp todavía no está configurado.',
    telefono_invalido: 'Revisá el número: tiene que incluir el código de área.', mail_invalido: 'Revisá el mail.', envio_fallido: 'No se pudo enviar. Probá de nuevo o usá la opción manual.', validacion: 'Revisá los datos: hay algo incompleto.',
  };
  const msg = (e) => ERR[e.datos?.error] ?? 'No se pudo completar. Probá de nuevo.';
  const campo = (rotulo, el, ayuda) => h('div', { class: 'campo' }, h('label', null, rotulo), el, ayuda && h('div', { class: 'apoyo', style: 'margin-top:4px' }, ayuda));
  const err = () => h('div', { class: 'error oculto', role: 'alert' });
  const mostrar = (el, t) => { el.textContent = t; el.classList.remove('oculto'); el.scrollIntoView?.({ block: 'center' }); };
  const telAR = (t) => { let d = String(t ?? '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('54')) { d = d.slice(2); if (d.startsWith('9')) d = d.slice(1); } d = d.replace(/^0/, ''); if (d.length === 12) d = d.replace(/^(\d{2,4})15/, '$1'); return d.length >= 10 && d.length <= 11 ? `549${d}` : null; };
  const telBonito = (n) => (n ? `+54 9 ${n.slice(3, 5)} ${n.slice(5, 9)}-${n.slice(9)}` : '');
  const ESTADO = { emitido: ['Sin firmar', 'aviso'], firmado: ['Firmado', 'ok'], anulado: ['Anulado', 'malo'] };
  const TIPO = { entrega: 'Entrega de insumos', mixto: 'Instalación de equipo', servicio: 'Servicio técnico' };
  const abrir = (url) => window.open(url, '_blank', 'noopener');
  const copiar = async (t) => { try { await navigator.clipboard.writeText(t); aviso('Enlace copiado'); } catch { window.prompt('Copiá el enlace:', t); } };

  // ---------- lista ----------
  const filaRemito = (r, conCliente = true) => h('li', { class: 'fila', tabindex: '0', style: 'cursor:pointer', onclick: () => { location.hash = `#/remitos/${r.id}`; }, onkeydown: (ev) => { if (ev.key === 'Enter') location.hash = `#/remitos/${r.id}`; } },
    h('div', { style: 'min-width:0;flex:1' },
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, h('b', { class: 'num-t' }, r.numero), chip(...(ESTADO[r.estado] ?? [r.estado, 'mudo']))),
      h('div', { class: 'apoyo' }, [conCliente && r.cliente, TIPO[r.tipo] ?? r.tipo, `${r.unidades} u.`, r.ticket].filter(Boolean).join(' · '))),
    h('div', { style: 'text-align:right' }, h('div', null, fecha(r.fecha)), r.conformidad && h('div', { class: 'apoyo' }, `Recibió ${r.conformidad.nombre}`)));

  async function vistaRemitos(destino) {
    let estado = ''; let q = '';
    const lista = h('div'); const buscar = h('input', { type: 'search', placeholder: 'Buscar por número o cliente', 'aria-label': 'Buscar remitos' });
    const pills = h('div', { class: 'seg', role: 'group', 'aria-label': 'Estado' });
    async function cargar() {
      const p = new URLSearchParams({ limite: '50' }); if (estado) p.set('estado', estado); if (q) p.set('q', q);
      const r = await api(`/api/remitos?${p}`);
      vaciar(pills).append(...[['', 'Todos', (r.por_estado.emitido ?? 0) + (r.por_estado.firmado ?? 0)], ['emitido', 'Sin firmar', r.por_estado.emitido ?? 0], ['firmado', 'Firmados', r.por_estado.firmado ?? 0]]
        .map(([k, t, n]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(estado === k), onclick: () => { estado = k; cargar(); } }, `${t} (${n})`)));
      vaciar(lista).append(r.items.length ? h('div', { class: 'tarjeta', style: 'padding:6px 8px' }, h('ul', { class: 'lista' }, r.items.map((x) => filaRemito(x)))) : h('div', { class: 'tarjeta vacio' }, h('b', null, 'No hay remitos para mostrar'), 'Los remitos se generan al entregar insumos o equipos, y al cerrar un servicio técnico.'));
    }
    let espera; buscar.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => { q = buscar.value.trim(); cargar(); }, 250); });
    destino.append(encabezado('Remitos', 'Entregas, instalaciones y servicios, con su conformidad', puede('remitos.crear') && h('div', { class: 'acciones' }, h('a', { class: 'btn btn-principal', href: '#/remitos/nuevo' }, '+ Nuevo remito'))),
      h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:14px' }, pills, h('div', { style: 'flex:1;min-width:200px' }, buscar)), lista);
    await cargar();
  }

  /** Remitos de un cliente (solapa Documentos de la ficha del cliente). */
  function panelCliente(clienteId) {
    const caja = h('div', { class: 'tarjeta', style: 'margin-top:16px' }, cargando());
    api(`/api/remitos?cliente=${clienteId}&limite=50`).then((r) => {
      vaciar(caja).append(h('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, h('h2', { style: 'margin:0' }, `Remitos (${r.total})`),
        puede('remitos.crear') && h('a', { class: 'btn', href: `#/remitos/nuevo/${clienteId}` }, '+ Nuevo remito')),
      r.items.length ? h('ul', { class: 'lista' }, r.items.map((x) => filaRemito(x, false))) : h('p', { class: 'apoyo', style: 'margin:0' }, 'Todavía no hay remitos para este cliente.'));
    }).catch((e) => { if (e.message !== 'sesion') vaciar(caja).append(h('p', { class: 'apoyo' }, 'No se pudieron cargar los remitos.')); });
    return caja;
  }

  // ---------- alta ----------
  async function vistaNuevoRemito(destino, clientePrevio) {
    const [clientes, insumos] = await Promise.all([api('/api/clientes?limite=100'), api('/api/insumos')]);
    const cli = h('select', { required: true, 'aria-label': 'Cliente' }, h('option', { value: '' }, 'Elegí un cliente…'), clientes.clientes.map((c) => h('option', { value: c.id, selected: String(c.id) === String(clientePrevio) }, c.nombre_comercial || c.razon_social)));
    const sede = h('select', { 'aria-label': 'Sede' }); const eqSel = h('select', { 'aria-label': 'Equipo' }); const insSel = h('select', { 'aria-label': 'Insumo' });
    const equipos = []; const items = []; const listaEq = h('div'); const listaIns = h('div'); let disponibles = [];
    const pintar = () => {
      vaciar(listaEq).append(...equipos.map((e, k) => h('div', { class: 'item-rep' }, h('span', null, h('b', null, e.descripcion), h('div', { class: 'apoyo' }, `N° de serie ${e.numero_serie}`)), h('button', { type: 'button', class: 'rapido', onclick: () => { equipos.splice(k, 1); pintar(); } }, 'Quitar'))));
      vaciar(listaIns).append(...items.map((it, k) => h('div', { class: 'item-rep' }, h('span', null, `${it.cant} × ${it.nombre}`), h('span', null, h('button', { type: 'button', class: 'rapido', onclick: () => { it.cant += 1; pintar(); } }, '+'), ' ', h('button', { type: 'button', class: 'rapido', onclick: () => { it.cant -= 1; if (!it.cant) items.splice(k, 1); pintar(); } }, '−')))));
      vaciar(eqSel).append(h('option', { value: '' }, disponibles.length ? 'Agregar un equipo…' : 'No hay equipos disponibles'), ...disponibles.filter((e) => !equipos.some((x) => x.id === e.id)).map((e) => h('option', { value: e.id }, `${e.descripcion} · ${e.numero_serie} (${e.ubicacion})`)));
    };
    vaciar(insSel).append(h('option', { value: '' }, 'Agregar un insumo…'), ...insumos.items.map((i) => h('option', { value: i.id, disabled: i.stock <= 0 }, `${i.descripcion} (stock ${i.stock})`)));
    insSel.addEventListener('change', () => { if (!insSel.value) return; const i = insumos.items.find((x) => x.id === Number(insSel.value)); const ya = items.find((x) => x.id === i.id); if (ya) ya.cant += 1; else items.push({ id: i.id, nombre: i.descripcion, cant: 1 }); insSel.value = ''; pintar(); });
    eqSel.addEventListener('change', () => { if (!eqSel.value) return; equipos.push(disponibles.find((e) => e.id === Number(eqSel.value))); pintar(); });
    async function alElegirCliente() {
      vaciar(sede); equipos.length = 0; disponibles = []; pintar(); if (!cli.value) return;
      const [a, b] = await Promise.all([api(`/api/tickets-ayuda/cliente/${cli.value}`), api(`/api/remitos-ayuda/equipos?cliente_id=${cli.value}`)]);
      a.sedes.forEach((s) => sede.append(h('option', { value: s.id, selected: s.es_principal }, s.nombre))); disponibles = b; pintar();
    }
    cli.addEventListener('change', alElegirCliente);
    const obs = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'Opcional: algo que el cliente tenga que saber (ej. “instalación en sala de reuniones”)' });
    const error = err(); const boton = h('button', { class: 'btn btn-principal', type: 'submit' }, 'Generar remito');
    const form = h('form', { class: 'formulario', onsubmit: async (ev) => {
      ev.preventDefault(); error.classList.add('oculto');
      if (!equipos.length && !items.length) { mostrar(error, ERR.sin_items); return; }
      boton.disabled = true;
      try {
        const r = await api('/api/remitos/entrega', { metodo: 'POST', cuerpo: { cliente_id: Number(cli.value), ...(sede.value ? { sede_id: Number(sede.value) } : {}), ...(obs.value.trim() ? { observaciones: obs.value.trim() } : {}), items: items.map((x) => ({ insumo_id: x.id, cantidad: x.cant })), equipos: equipos.map((x) => x.id) } });
        if (r.costo_usd > 0) aviso(`Remito generado. Se sumaron ${usd(r.costo_usd)} al costo del cliente.${r.insumos_sin_costo?.length ? ` Sin costo cargado: ${r.insumos_sin_costo.join(', ')}.` : ''}`); else aviso('Remito generado');
        location.hash = `#/remitos/${r.id}`;
      } catch (e) { if (e.message === 'sesion') return; mostrar(error, msg(e)); boton.disabled = false; }
    } }, error,
    h('div', { class: 'tarjeta' }, h('h2', null, '¿A quién se le entrega?'), campo('Cliente', cli), campo('Sede de entrega', sede)),
    h('div', { class: 'tarjeta' }, h('h2', null, 'Equipos'), h('p', { class: 'apoyo', style: 'margin-top:0' }, 'Los que están en el depósito o ya con este cliente. Si todavía no cargaste el equipo, hacelo desde Equipos y volvé.'), eqSel, listaEq),
    h('div', { class: 'tarjeta' }, h('h2', null, 'Insumos'), h('p', { class: 'apoyo', style: 'margin-top:0' }, 'Se descuentan del stock al generar el remito.'), insSel, listaIns),
    h('div', { class: 'tarjeta' }, h('h2', null, 'Observaciones'), obs), boton);
    destino.append(h('a', { href: '#/remitos', class: 'apoyo' }, '← Remitos'), encabezado('Nuevo remito', 'Se numera solo y queda listo para firmar en el celular o imprimir.'), form);
    if (clientePrevio) await alElegirCliente(); else pintar();
  }

  // ---------- envío ----------
  /** Mandar el remito al cliente: automático si el canal está configurado; si no, abre el WhatsApp o el mail del usuario con el mensaje y el enlace. */
  function panelEnvio(r, recargar, { compacto = false } = {}) {
    const primeroMail = r.conformidad?.email || r.contactos.flatMap((c) => c.emails)[0] || '';
    const primeroTel = r.conformidad?.telefono || r.contactos.flatMap((c) => c.telefonos)[0] || '';
    const mail = h('input', { type: 'email', value: primeroMail, placeholder: 'mail@cliente.com', 'aria-label': 'Mail del cliente', autocomplete: 'off' });
    const tel = h('input', { type: 'tel', value: primeroTel, placeholder: '11 5555-1234', 'aria-label': 'WhatsApp del cliente', inputmode: 'tel', autocomplete: 'off' });
    const vista = h('div', { class: 'apoyo' }); const error = err();
    const actualizar = () => { const n = telAR(tel.value); vista.textContent = tel.value.trim() ? (n ? `WhatsApp ${telBonito(n)}` : 'Falta el código de área') : ''; };
    tel.addEventListener('input', actualizar); actualizar();
    const texto = `Hola! Te acercamos el remito N° ${r.numero} de JustPrint con el detalle de lo entregado. Podés verlo y descargarlo acá: ${r.url_publica}`;
    const registrar = (canal, destino) => api(`/api/remitos/${r.id}/enviar`, { metodo: 'POST', cuerpo: { canal, destino, manual: true } }).catch(() => {});
    async function enviar(canal) {
      error.classList.add('oculto');
      const destino = canal === 'mail' ? mail.value.trim() : tel.value.trim();
      if (!destino) { mostrar(error, canal === 'mail' ? 'Escribí el mail del cliente.' : 'Escribí el WhatsApp del cliente.'); return; }
      if (canal === 'whatsapp' && !telAR(destino)) { mostrar(error, ERR.telefono_invalido); return; }
      if (r.canales[canal]) {
        try { await api(`/api/remitos/${r.id}/enviar`, { metodo: 'POST', cuerpo: { canal, destino } }); aviso(canal === 'mail' ? 'Mail enviado con el PDF adjunto' : 'WhatsApp enviado'); recargar?.(); } catch (e) { if (e.message !== 'sesion') mostrar(error, msg(e)); }
        return;
      }
      await registrar(canal, destino);
      if (canal === 'whatsapp') window.open(`https://wa.me/${telAR(destino)}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
      else window.location.href = `mailto:${encodeURIComponent(destino)}?subject=${encodeURIComponent(`Remito ${r.numero} · JustPrint`)}&body=${encodeURIComponent(`${texto}\n\nJustPrint · soporte@justprint.com.ar`)}`;
      recargar?.();
    }
    const contactos = r.contactos.length ? h('div', { class: 'rapidos', style: 'margin:0 0 10px' }, r.contactos.map((c) => h('button', { type: 'button', class: 'rapido', onclick: () => { if (c.emails[0]) mail.value = c.emails[0]; if (c.telefonos[0]) { tel.value = c.telefonos[0]; actualizar(); } } }, c.nombre))) : null;
    return h('div', { class: compacto ? '' : 'tarjeta' }, !compacto && h('h2', null, 'Enviar al cliente'), contactos,
      h('div', { class: 'campo' }, h('label', null, 'WhatsApp'), tel, vista), h('button', { class: 'btn', type: 'button', style: 'margin-bottom:12px', onclick: () => enviar('whatsapp') }, r.canales.whatsapp ? 'Enviar por WhatsApp' : 'Abrir WhatsApp con el mensaje'),
      h('div', { class: 'campo' }, h('label', null, 'Mail'), mail), h('button', { class: 'btn', type: 'button', style: 'margin-bottom:8px', onclick: () => enviar('mail') }, r.canales.mail ? 'Enviar por mail con el PDF' : 'Abrir mi mail con el mensaje'),
      h('button', { class: 'btn', type: 'button', onclick: () => copiar(r.url_publica) }, 'Copiar enlace'), error,
      (!r.canales.mail || !r.canales.whatsapp) && h('p', { class: 'apoyo', style: 'margin:10px 0 0' }, `${!r.canales.mail && !r.canales.whatsapp ? 'El envío automático todavía no está configurado:' : !r.canales.mail ? 'El mail automático todavía no está configurado:' : 'El WhatsApp automático todavía no está configurado:'} se abre tu ${!r.canales.mail && !r.canales.whatsapp ? 'WhatsApp o tu mail' : !r.canales.mail ? 'mail' : 'WhatsApp'} con el mensaje y el enlace ya escritos, y solo tenés que enviarlo.`));
  }


  // ---------- encuesta de satisfacción ----------
  const ASPECTOS = [['puntualidad', 'Puntualidad'], ['trato', 'Trato'], ['resolucion', 'Que quedó resuelto'], ['claridad', 'Claridad en las explicaciones'], ['orden', 'Orden y limpieza']];
  const estrellasTexto = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const FRASE = { 1: 'Lamentamos que no haya sido la mejor atención.', 2: 'Gracias por avisarnos, vamos a mejorar.', 3: 'Gracias, tomamos nota de lo que podemos mejorar.', 4: 'Gracias, nos alegra que haya ido bien.', 5: '¡Gracias! Nos alegra mucho.' };
  /** Una pregunta de estrellas; al tocar una aparecen qué destacar o mejorar y un comentario opcional. Cuatro toques como mucho. */
  function panelEncuesta(r) {
    const caja = h('div', { class: 'tarjeta encuesta' });
    if (r.encuesta) {
      const e = r.encuesta;
      caja.append(h('h2', null, 'Opinión del cliente'), h('div', { class: 'estrellas-fijas', 'aria-label': `${e.puntaje} de 5 estrellas` }, estrellasTexto(e.puntaje)),
        e.aspectos.length > 0 && h('div', { class: 'rapidos', style: 'margin:8px 0 0' }, e.aspectos.map((a) => h('span', { class: 'rapido' }, ASPECTOS.find((x) => x[0] === a)?.[1] ?? a))),
        e.comentario && h('p', { style: 'margin:10px 0 0' }, `“${e.comentario}”`));
      return caja;
    }
    let puntaje = 0; const marcados = new Set();
    const error = err(); const detalle = h('div', { class: 'oculto' }); const botones = [];
    const pintar = (n) => botones.forEach((b, i) => { b.classList.toggle('on', i < n); b.setAttribute('aria-checked', String(i + 1 === n)); });
    const preguntaAspectos = h('b', null, '');
    const comentario = h('textarea', { maxlength: 1000, rows: 2, placeholder: '¿Algo más que quieras contarnos? (opcional)', 'aria-label': 'Comentario' });
    const enviar = h('button', { class: 'btn btn-principal', type: 'button', onclick: async () => {
      error.classList.add('oculto'); enviar.disabled = true; enviar.textContent = 'Enviando…';
      try {
        await api(`/api/remitos/${r.id}/encuesta`, { metodo: 'POST', cuerpo: { puntaje, aspectos: [...marcados], ...(comentario.value.trim() ? { comentario: comentario.value.trim() } : {}) } });
        vaciar(caja).append(h('div', { class: 'gracias' }, h('div', { class: 'estrellas-fijas' }, estrellasTexto(puntaje)), h('b', null, '¡Gracias por tu opinión!'), h('p', { class: 'apoyo', style: 'margin:2px 0 0' }, 'La leemos para mejorar la atención.')));
      } catch (e) { if (e.message === 'sesion') return; mostrar(error, e.datos?.error === 'ya_respondida' ? 'Esta encuesta ya fue respondida.' : msg(e)); enviar.disabled = false; enviar.textContent = 'Enviar opinión'; }
    } }, 'Enviar opinión');
    const chips = h('div', { class: 'rapidos', style: 'margin:8px 0 12px' }, ASPECTOS.map(([k, t]) => {
      const b = h('button', { type: 'button', class: 'rapido', 'aria-pressed': 'false', onclick: () => { if (marcados.has(k)) marcados.delete(k); else marcados.add(k); b.classList.toggle('activo', marcados.has(k)); b.setAttribute('aria-pressed', String(marcados.has(k))); } }, t);
      return b;
    }));
    const frase = h('p', { class: 'apoyo', style: 'text-align:center;margin:0 0 10px' }, '');
    detalle.append(frase, preguntaAspectos, chips, comentario, error, h('div', { style: 'margin-top:10px' }, enviar));
    const estrellas = h('div', { class: 'estrellas-tap', role: 'radiogroup', 'aria-label': 'Calificación de 1 a 5 estrellas' }, [1, 2, 3, 4, 5].map((n) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': `${n} ${n === 1 ? 'estrella' : 'estrellas'}`, onclick: () => {
        puntaje = n; pintar(n); frase.textContent = FRASE[n];
        preguntaAspectos.textContent = n >= 4 ? '¿Qué querés destacar?' : '¿Qué podemos mejorar?';
        detalle.classList.remove('oculto');
      } }, '★');
      botones.push(b); return b;
    }));
    caja.append(h('h2', null, 'Opinión del cliente'), h('p', { class: 'preg-enc' }, '¿Cómo fue la atención que recibiste?'), estrellas, h('p', { class: 'apoyo', style: 'text-align:center;margin:4px 0 10px' }, 'Tocá una estrella: 5 es excelente. Es opcional.'), detalle);
    return caja;
  }

  // ---------- firma en el celular ----------
  function lienzoFirma() {
    const el = h('canvas', { class: 'firma firma-grande', width: 900, height: 360, 'aria-label': 'Firma de quien recibe' });
    const g = el.getContext('2d'); g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0D1B2A';
    let trazo = false; let hay = false;
    const pos = (e) => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) * (el.width / r.width), (e.clientY - r.top) * (el.height / r.height)]; };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); trazo = true; el.setPointerCapture(e.pointerId); g.beginPath(); const [x, y] = pos(e); g.moveTo(x, y); g.lineTo(x + 0.1, y + 0.1); g.stroke(); hay = true; el.classList.add('firmando'); });
    el.addEventListener('pointermove', (e) => { if (!trazo) return; g.lineTo(...pos(e)); g.stroke(); });
    const fin = () => { trazo = false; }; el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);
    return { el, hay: () => hay, limpiar: () => { g.clearRect(0, 0, el.width, el.height); hay = false; el.classList.remove('firmando'); }, png: () => el.toDataURL('image/png') };
  }

  async function vistaFirma(destino, id) {
    const r = await api(`/api/remitos/${id}`).catch((x) => { if (x.estado === 404) return null; throw x; });
    if (!r) { destino.append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos ese remito'))); return; }
    if (!r.puede_firmar) { destino.append(h('div', { class: 'tarjeta vacio' }, h('b', null, r.estado === 'firmado' ? 'Este remito ya está firmado' : 'No se puede firmar este remito'), h('a', { class: 'btn', href: `#/remitos/${id}` }, 'Ver remito'))); return; }
    const nombre = h('input', { id: 'f-nombre', maxlength: 120, autocomplete: 'off', placeholder: 'Nombre y apellido', required: true }); const cargo = h('input', { maxlength: 80, placeholder: 'Cargo (opcional)', autocomplete: 'off' });
    const dni = h('input', { maxlength: 20, inputmode: 'numeric', placeholder: 'DNI (opcional)', autocomplete: 'off' });
    const mail = h('input', { type: 'email', maxlength: 160, placeholder: 'Mail (opcional)', autocomplete: 'off', value: r.contactos.flatMap((c) => c.emails)[0] ?? '' });
    const tel = h('input', { type: 'tel', maxlength: 40, inputmode: 'tel', placeholder: 'WhatsApp (opcional)', autocomplete: 'off', value: r.contactos.flatMap((c) => c.telefonos)[0] ?? '' });
    const pad = lienzoFirma(); const error = err(); const boton = h('button', { class: 'btn btn-principal grande', type: 'submit' }, 'Confirmar y firmar');
    const cuerpo = h('div');
    const form = h('form', { class: 'formulario', onsubmit: async (ev) => {
      ev.preventDefault(); error.classList.add('oculto');
      if (!nombre.value.trim()) { mostrar(error, 'Escribí el nombre de quien recibe.'); nombre.focus(); return; }
      if (!pad.hay()) { mostrar(error, 'Falta la firma. Firmá con el dedo en el recuadro.'); return; }
      boton.disabled = true; boton.textContent = 'Guardando…';
      try {
        const out = await api(`/api/remitos/${id}/conformidad`, { metodo: 'POST', cuerpo: { nombre: nombre.value.trim(), ...(cargo.value.trim() ? { cargo: cargo.value.trim() } : {}), ...(dni.value.trim() ? { dni: dni.value.trim() } : {}), ...(mail.value.trim() ? { email: mail.value.trim() } : {}), ...(tel.value.trim() ? { telefono: tel.value.trim() } : {}), firma: pad.png() } });
        const nuevo = await api(`/api/remitos/${id}`); vaciar(cuerpo).append(pantallaListo(nuevo, out, nombre.value.trim()));
        window.scrollTo?.({ top: 0 });
      } catch (e) { if (e.message === 'sesion') return; mostrar(error, msg(e)); boton.disabled = false; boton.textContent = 'Confirmar y firmar'; }
    } }, error,
    h('div', { class: 'tarjeta' }, h('h2', null, 'Qué se entrega'), r.items.map((i) => h('div', { class: 'item-rem' }, h('span', { class: 'cant-rem' }, String(i.cantidad)), h('div', null, h('b', null, i.descripcion), i.detalle && h('div', { class: 'apoyo' }, i.detalle))))),
    h('div', { class: 'tarjeta' }, h('h2', null, 'Quién recibe'), campo('Nombre y apellido', nombre), h('div', { class: 'dos-col' }, campo('Cargo', cargo), campo('DNI', dni)),
      h('div', { class: 'dos-col' }, campo('Mail', mail), campo('WhatsApp', tel)), h('p', { class: 'apoyo', style: 'margin:0' }, 'Si dejás mail o WhatsApp te mandamos el remito firmado.')),
    h('div', { class: 'tarjeta' }, h('h2', null, 'Conformidad'), h('p', { style: 'margin:0 0 4px' }, 'Recibo conforme lo detallado en este remito.'), pad.el,
      h('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:center' }, h('span', { class: 'apoyo' }, 'Firmá con el dedo dentro del recuadro'), h('button', { type: 'button', class: 'rapido', onclick: () => pad.limpiar() }, 'Borrar'))), boton);
    cuerpo.append(form);
    destino.append(h('a', { href: `#/remitos/${id}`, class: 'apoyo' }, `← Remito ${r.numero}`), encabezado('Conformidad de recepción', `${r.cliente.nombre_comercial || r.cliente.razon_social} · remito ${r.numero}`), cuerpo);
  }

  function pantallaListo(r, out, nombre) {
    const auto = [out.enviado?.mail && 'por mail', out.enviado?.whatsapp && 'por WhatsApp'].filter(Boolean).join(' y ');
    return h('div', null, h('div', { class: 'tarjeta listo' }, h('div', { class: 'tilde' }, h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: 'M5 12.5l4.5 4.5L19 7.5' }))),
      h('h2', null, 'Remito firmado'), h('p', null, `Recibió ${nombre}. La conformidad quedó guardada junto al remito ${r.numero}.`), auto && h('p', { class: 'apoyo' }, `Ya se le envió ${auto}.`),
      h('div', { class: 'acciones', style: 'justify-content:center' }, h('a', { class: 'btn btn-principal', href: `/api/remitos/${r.id}/pdf?descargar=1` }, 'Descargar PDF'), h('a', { class: 'btn', href: `#/remitos/${r.id}` }, 'Ver remito'))),
    panelEncuesta(r),
    h('div', { class: 'tarjeta' }, h('h2', null, 'Enviar el remito firmado'), panelEnvio(r, null, { compacto: true })));
  }

  // ---------- remito firmado en papel ----------
  function subirPapel(r, recargar) {
    cajon('Remito firmado en papel', (cerrar) => {
      const archivo = h('input', { type: 'file', accept: 'application/pdf,image/jpeg,image/png', required: true });
      const nombre = h('input', { maxlength: 120, placeholder: 'Quién firmó (aclaración)', required: true, autocomplete: 'off' }); const cargo = h('input', { maxlength: 80, placeholder: 'Cargo (opcional)', autocomplete: 'off' }); const dni = h('input', { maxlength: 20, inputmode: 'numeric', placeholder: 'DNI (opcional)', autocomplete: 'off' });
      const error = err(); const boton = h('button', { class: 'btn btn-principal', type: 'submit' }, 'Guardar remito firmado');
      return h('form', { class: 'formulario', style: 'display:grid;gap:14px', onsubmit: async (ev) => {
        ev.preventDefault(); error.classList.add('oculto'); const f = archivo.files[0]; if (!f) return;
        if (f.size > 10 * 1048576) { mostrar(error, ERR.archivo_muy_grande); return; }
        boton.disabled = true; boton.textContent = 'Subiendo…';
        const p = new URLSearchParams({ nombre: nombre.value.trim() }); if (cargo.value.trim()) p.set('cargo', cargo.value.trim()); if (dni.value.trim()) p.set('dni', dni.value.trim());
        try {
          const x = await fetch(`/api/remitos/${r.id}/escaneo?${p}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': f.type, 'X-Nombre-Archivo': encodeURIComponent(f.name) }, body: f });
          if (x.status === 401) { location.reload(); return; }
          const d = await x.json().catch(() => ({}));
          if (!x.ok) { mostrar(error, ERR[d.error] ?? 'No se pudo subir. Probá de nuevo.'); boton.disabled = false; boton.textContent = 'Guardar remito firmado'; return; }
          cerrar(); aviso('Remito firmado guardado'); recargar();
        } catch { mostrar(error, 'No se pudo subir. Revisá la conexión y probá de nuevo.'); boton.disabled = false; boton.textContent = 'Guardar remito firmado'; }
      } }, error, h('p', { class: 'apoyo', style: 'margin:0' }, 'Sacale una foto al remito firmado o subí el escaneo (PDF, JPG o PNG, hasta 10 MB). Queda archivado en el remito y se marca como firmado.'),
      campo('Archivo', archivo), campo('Quién firmó', nombre), h('div', { class: 'dos-col' }, campo('Cargo', cargo), campo('DNI', dni)), boton);
    });
  }

  // ---------- el remito ----------
  async function vistaRemito(destino, id) {
    const cuerpo = h('div'); destino.append(cuerpo);
    async function pintar() {
      const r = await api(`/api/remitos/${id}`).catch((x) => { if (x.estado === 404) return null; throw x; });
      if (!r) { vaciar(cuerpo).append(h('div', { class: 'tarjeta vacio' }, h('b', null, 'No encontramos ese remito'))); return; }
      const c = r.conformidad; const cliente = r.cliente.nombre_comercial || r.cliente.razon_social;
      const hoja = h('div', { class: 'hoja-remito' },
        h('div', { class: 'hr-cab' }, h('img', { src: '/img/logo-blanco.png', alt: 'JustPrint' }), h('div', { class: 'hr-num' }, h('small', null, 'REMITO'), h('b', null, `N° ${r.numero}`), h('span', null, fecha(r.fecha)))),
        h('div', { class: 'hr-cuerpo' }, h('span', { class: 'hr-tipo' }, r.tipo_texto.toUpperCase()),
          h('div', { class: 'hr-partes' }, h('div', null, h('small', null, 'ENTREGADO A'), h('b', null, cliente), r.cliente.cuit && h('div', { class: 'apoyo' }, `CUIT ${r.cliente.cuit}`), r.sede && h('div', { class: 'apoyo' }, [r.sede.nombre, r.sede.domicilio, r.sede.localidad].filter(Boolean).join(' · '))),
            h('div', null, h('small', null, 'EMITIDO POR'), h('b', null, 'JustPrint'), h('div', { class: 'apoyo' }, 'CUIT 30-71646173-0'), h('div', { class: 'apoyo' }, 'soporte@justprint.com.ar'))),
          h('div', { class: 'hr-items' }, r.items.map((i) => h('div', { class: 'item-rem' }, h('span', { class: 'cant-rem' }, String(i.cantidad)), h('div', null, h('b', null, i.descripcion), i.detalle && h('div', { class: 'apoyo' }, i.detalle))))),
          r.observaciones && h('div', { class: 'hr-obs' }, h('small', null, r.tipo === 'servicio' ? 'TRABAJO REALIZADO' : 'OBSERVACIONES'), h('p', null, r.observaciones)),
          h('div', { class: `hr-conf ${c ? 'ok' : ''}` }, h('small', null, 'CONFORMIDAD DE RECEPCIÓN'),
            c ? h('div', null, c.tiene_firma && h('img', { class: 'hr-firma', src: `/api/remitos/${r.id}/firma.png`, alt: `Firma de ${c.nombre}` }), h('b', null, c.nombre), h('div', { class: 'apoyo' }, [c.cargo, c.dni && `DNI ${c.dni}`].filter(Boolean).join(' · ')),
              h('div', { class: 'apoyo' }, `${c.metodo === 'papel' ? 'Firmó el remito en papel' : 'Firmó en pantalla'} · ${cuando(c.firmado_en)}`))
              : h('p', { class: 'apoyo', style: 'margin:6px 0 0' }, 'Todavía sin firmar.'))));
      const acciones = h('div', { class: 'acciones no-imprimir' },
        r.puede_firmar && h('a', { class: 'btn btn-principal', href: `#/remitos/${r.id}/firmar` }, 'Tomar conformidad en el celular'),
        h('a', { class: 'btn', href: `/api/remitos/${r.id}/pdf?descargar=1` }, 'Descargar PDF'), h('button', { class: 'btn', type: 'button', onclick: () => abrir(`/api/remitos/${r.id}/pdf`) }, 'Ver / imprimir'));
      const lateral = h('div', null,
        h('div', { class: 'tarjeta' }, h('h2', null, 'Conformidad'),
          c ? h('div', null, chip('Firmado', 'ok'), h('p', { style: 'margin:8px 0 2px' }, h('b', null, c.nombre)), h('div', { class: 'apoyo' }, `${c.metodo === 'papel' ? 'En papel' : 'En pantalla'} · ${cuando(c.firmado_en)}`),
            r.escaneo && h('a', { class: 'btn', style: 'margin-top:10px', href: `/api/remitos/${r.id}/escaneo`, target: '_blank', rel: 'noopener' }, 'Ver remito firmado (archivo)'))
          : h('div', null, chip('Sin firmar', 'aviso'), h('p', { class: 'apoyo' }, 'Podés firmarlo en pantalla con el cliente, o imprimirlo, hacerlo firmar a mano y subir la foto o el escaneo.'),
            puede('remitos.crear') && h('button', { class: 'btn', type: 'button', onclick: () => subirPapel(r, pintar) }, 'Ya firmó en papel: subir archivo')),
          r.ticket && h('p', { class: 'apoyo', style: 'margin-bottom:0' }, `Servicio del ticket ${r.ticket.numero}.`)),
        c && (r.encuesta || puede('remitos.crear')) && panelEncuesta(r),
        puede('remitos.crear') && panelEnvio(r, pintar),
        r.envios.length > 0 && h('div', { class: 'tarjeta' }, h('h2', null, 'Envíos'), h('ul', { class: 'lista' }, r.envios.map((e) => h('li', null, h('div', null, h('b', null, e.canal === 'mail' ? 'Mail' : 'WhatsApp'), ` · ${e.destino}`, h('div', { class: 'apoyo' }, `${cuando(e.created_at)}${e.usuario ? ` · ${e.usuario}` : ''}${e.detalle ? ` · ${e.detalle}` : ''}`)),
          chip(e.resultado === 'enviado' ? 'Enviado' : e.resultado === 'manual' ? 'Abierto' : 'Error', e.resultado === 'enviado' ? 'ok' : e.resultado === 'manual' ? 'info' : 'malo'))))));
      vaciar(cuerpo).append(h('a', { href: '#/remitos', class: 'apoyo no-imprimir' }, '← Remitos'),
        encabezado(`Remito ${r.numero}`, `${cliente} · ${fecha(r.fecha)}`, acciones), h('div', { class: 'rejilla dos-remito' }, hoja, lateral));
    }
    await pintar();
  }

  return { vistaRemitos, vistaNuevoRemito, vistaRemito, vistaFirma, panelCliente, panelEnvio, panelEncuesta, lienzoFirma };
}
