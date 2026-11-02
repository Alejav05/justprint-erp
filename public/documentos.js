// Documentación firmada de los contratos: el contrato original, anexos y adendas en PDF.
export function crearDocumentos(U) {
  const { h, vaciar, api, fecha, chip, puede, cargando, cajon, aviso } = U;
  const TIPOS = [['contrato', 'Contrato firmado'], ['anexo', 'Anexo'], ['adenda', 'Adenda o renovación'], ['otro', 'Otro']];
  const COLOR = { contrato: 'ok', anexo: 'info', adenda: 'aviso', otro: 'mudo' };
  const ERR = {
    no_es_pdf: 'El archivo tiene que ser un PDF.', archivo_muy_grande: 'El PDF pesa más de 10 MB. Comprimilo o dividilo.', documento_repetido: 'Este mismo archivo ya está cargado en el contrato.',
    fecha_futura: 'La fecha de firma no puede ser futura.', archivo_invalido: 'El archivo está vacío o dañado.', sin_permiso: 'No tenés permiso para subir documentos.', no_encontrado: 'No encontramos ese contrato.',
  };
  const peso = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  /** Formulario de subida en un cajón lateral. `contratos` permite elegir a cuál va (desde la ficha del cliente). */
  function formularioSubida({ contratos, contratoId, alSubir }) {
    cajon('Subir documento', (cerrar) => {
      const archivo = h('input', { type: 'file', accept: 'application/pdf,.pdf', required: true });
      const tipo = h('select', null, TIPOS.map(([v, t]) => h('option', { value: v }, t)));
      const titulo = h('input', { type: 'text', maxlength: 160, placeholder: 'Ej.: Anexo I – equipo adicional' });
      const firma = h('input', { type: 'date', max: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10) });
      const notas = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'Opcional: qué cambia, quién firmó, etc.' });
      const contrato = h('select', null, (contratos ?? []).map((c) => h('option', { value: c.id, selected: c.id === contratoId }, c.nombre)));
      const error = h('div', { class: 'error oculto', role: 'alert' }); const boton = h('button', { class: 'btn btn-principal', type: 'submit' }, 'Subir');
      archivo.addEventListener('change', () => { if (archivo.files[0] && !titulo.value) titulo.placeholder = archivo.files[0].name.replace(/\.pdf$/i, ''); });
      return h('form', { class: 'formulario', style: 'display:grid;gap:14px', onsubmit: async (ev) => {
        ev.preventDefault(); error.classList.add('oculto'); const f = archivo.files[0]; if (!f) return;
        if (f.size > 10 * 1048576) { error.textContent = ERR.archivo_muy_grande; error.classList.remove('oculto'); return; }
        boton.disabled = true; boton.textContent = 'Subiendo…';
        const p = new URLSearchParams({ tipo: tipo.value }); if (titulo.value.trim()) p.set('titulo', titulo.value.trim()); if (firma.value) p.set('fecha', firma.value); if (notas.value.trim()) p.set('notas', notas.value.trim());
        try {
          const r = await fetch(`/api/contratos/${contrato.value}/documentos?${p}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/pdf', 'X-Nombre-Archivo': encodeURIComponent(f.name) }, body: f });
          if (r.status === 401) { location.reload(); return; }
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { error.textContent = ERR[d.error] ?? 'No se pudo subir. Probá de nuevo.'; error.classList.remove('oculto'); boton.disabled = false; boton.textContent = 'Subir'; return; }
          cerrar(); aviso('Documento subido'); alSubir();
        } catch { error.textContent = 'No se pudo subir. Revisá la conexión y probá de nuevo.'; error.classList.remove('oculto'); boton.disabled = false; boton.textContent = 'Subir'; }
      } }, error, h('label', { style: 'display:grid;gap:4px' }, 'Archivo PDF', archivo), contratos && contratos.length > 1 && h('label', { style: 'display:grid;gap:4px' }, 'Contrato', contrato),
      h('label', { style: 'display:grid;gap:4px' }, 'Qué es', tipo), h('label', { style: 'display:grid;gap:4px' }, 'Título', titulo), h('label', { style: 'display:grid;gap:4px' }, 'Fecha de firma', firma), h('label', { style: 'display:grid;gap:4px' }, 'Notas', notas),
      h('p', { class: 'apoyo', style: 'margin:0' }, 'PDF de hasta 10 MB. Cada contrato puede tener el contrato original, anexos y adendas.'), boton);
    });
  }

  async function quitar(d, alQuitar) {
    if (!window.confirm(`¿Quitar este documento?\n\n${d.titulo}\n\nDeja de verse en la lista. El archivo queda guardado y la acción en la auditoría.`)) return;
    try { await api(`/api/documentos/${d.id}`, { metodo: 'DELETE' }); aviso('Documento quitado'); alQuitar(); } catch (e) { if (e.message !== 'sesion') aviso('No se pudo quitar el documento.'); }
  }

  function filaDoc(d, recargar) {
    return h('li', { style: 'display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap' },
      h('div', { style: 'min-width:0;flex:1 1 240px' },
        h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, chip(d.tipo_nombre, COLOR[d.tipo] ?? 'mudo'), h('b', null, d.titulo)),
        h('div', { class: 'apoyo' }, [d.fecha_documento ? `Firmado el ${fecha(d.fecha_documento)}` : 'Sin fecha de firma', peso(d.bytes), d.subido_por ? `subido por ${d.subido_por} el ${fecha(d.subido_el)}` : `subido el ${fecha(d.subido_el)}`].join(' · ')),
        d.notas && h('div', { class: 'apoyo' }, d.notas)),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('a', { class: 'btn', href: `/api/documentos/${d.id}/archivo`, target: '_blank', rel: 'noopener' }, 'Ver'),
        h('a', { class: 'btn', href: `/api/documentos/${d.id}/archivo?descargar=1`, download: '' }, 'Descargar'),
        puede('contratos.editar') && h('button', { class: 'btn', type: 'button', onclick: () => quitar(d, recargar) }, 'Quitar')));
  }

  /**
   * Panel de documentos. Con `contratoId`: los de ese contrato. Con `clienteId`: los de todos los contratos del cliente, agrupados por contrato.
   */
  function panel({ contratoId = null, clienteId = null }) {
    const caja = h('div', { class: 'tarjeta' }, cargando());
    async function pintar() {
      let r;
      try { r = contratoId ? await api(`/api/contratos/${contratoId}/documentos`) : await api(`/api/clientes/${clienteId}/documentos`); }
      catch (e) { if (e.message !== 'sesion') vaciar(caja).append(h('p', { class: 'apoyo' }, 'No se pudieron cargar los documentos.')); return; }
      const contratos = r.contratos ?? [{ id: contratoId, nombre: '' }];
      const subir = puede('contratos.documentos') && contratos.length > 0 && h('button', { class: 'btn btn-principal', type: 'button', onclick: () => formularioSubida({ contratos: r.contratos, contratoId: contratoId ?? contratos[0].id, alSubir: pintar }) }, '+ Subir documento');
      vaciar(caja).append(h('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, h('h2', { style: 'margin:0' }, `Documentación firmada (${r.documentos.length})`), subir));
      if (!r.documentos.length) { caja.append(h('p', { class: 'apoyo', style: 'margin:0' }, contratos.length ? 'Todavía no hay documentos. Subí el contrato firmado y, más adelante, los anexos y adendas.' : 'Este cliente todavía no tiene contratos.')); return; }
      if (contratoId) { caja.append(h('ul', { class: 'lista' }, r.documentos.map((d) => filaDoc(d, pintar)))); return; }
      for (const c of contratos) {
        const ds = r.documentos.filter((d) => d.contrato_id === c.id); if (!ds.length) continue;
        caja.append(h('p', { class: 'etiqueta', style: 'margin:14px 0 4px' }, c.nombre), h('ul', { class: 'lista' }, ds.map((d) => filaDoc(d, pintar))));
      }
    }
    pintar();
    return caja;
  }

  return { panel };
}
