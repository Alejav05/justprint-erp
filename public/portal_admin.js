// Acceso de los clientes al portal: invitar, reenviar el enlace, dar de baja o de alta y ver el portal como lo ve cada cliente.
export function crearPortalAdmin(U) {
  const { h, api, fecha, chip, cargando, cajon, aviso } = U;
  const ERR = { email_en_uso: 'Ese mail ya tiene acceso al portal (puede ser de otro cliente).', contacto_invalido: 'Ese contacto no es de este cliente.', acceso_dado_de_baja: 'El acceso está dado de baja. Reactivalo primero.', validacion: 'Revisá el nombre y el mail.' };
  const ESTADO = { invitado: ['Invitado', 'aviso'], activo: ['Activo', 'ok'], baja: ['De baja', 'mudo'] };

  function copiar(url) { navigator.clipboard?.writeText(url).then(() => aviso('Enlace copiado'), () => window.prompt('Copiá el enlace:', url)); }
  function mostrarEnlace(r, que) {
    if (r.enviado) { aviso(`Mail enviado desde soporte@justprint.com.ar`); return; }
    cajon('Enlace de acceso', () => h('div', { style: 'display:grid;gap:12px' },
      h('p', { class: 'apoyo' }, `El mail no está configurado o no salió, así que no se envió. Copiá este enlace y mandáselo vos (${que}). Sirve una sola vez y vence en 7 días.`),
      h('input', { type: 'text', readonly: true, value: r.url, style: 'width:100%', onfocus: (e) => e.target.select() }), h('button', { class: 'btn btn-principal', type: 'button', onclick: () => copiar(r.url) }, 'Copiar enlace')));
  }

  function formularioInvitar(clienteId, d, alListo) {
    cajon('Dar acceso al portal', (cerrar) => {
      const contacto = h('select', null, h('option', { value: '' }, 'Otra persona (escribir mail)'), d.contactos.flatMap((c) => c.emails.map((e) => h('option', { value: `${c.id}|${e}|${c.nombre}` }, `${c.nombre} · ${e}`))));
      const nombre = h('input', { type: 'text', maxlength: 120, required: true }); const email = h('input', { type: 'email', maxlength: 160, required: true });
      contacto.addEventListener('change', () => { const [, e, nom] = contacto.value ? contacto.value.split('|') : []; if (e) { email.value = e; nombre.value = nom; } });
      const error = h('div', { class: 'error oculto', role: 'alert' }); const boton = h('button', { class: 'btn btn-principal', type: 'submit' }, 'Enviar invitación');
      return h('form', { class: 'formulario', style: 'display:grid;gap:14px', onsubmit: async (ev) => {
        ev.preventDefault(); error.classList.add('oculto'); boton.disabled = true;
        try {
          const cid = contacto.value ? Number(contacto.value.split('|')[0]) : undefined;
          const r = await api(`/api/clientes/${clienteId}/portal`, { metodo: 'POST', cuerpo: { nombre: nombre.value, email: email.value, ...(cid ? { contacto_id: cid } : {}) } });
          cerrar(); mostrarEnlace(r, `a ${email.value}`); alListo();
        } catch (e) { error.textContent = ERR[e.codigo] || 'No pudimos guardarlo.'; error.classList.remove('oculto'); boton.disabled = false; }
      } },
      h('p', { class: 'apoyo' }, 'La persona recibe un enlace por mail, entra y elige su contraseña. Solo va a ver lo de este cliente.'),
      d.contactos.length > 0 && h('label', null, 'Elegir de los contactos', contacto), h('label', null, 'Nombre', nombre), h('label', null, 'Mail', email), error, boton);
    });
  }

  /** Panel de la ficha del cliente. */
  function panel(clienteId) {
    const caja = h('div', { class: 'tarjeta' }, cargando());
    async function pintar() {
      const d = await api(`/api/clientes/${clienteId}/portal`).catch(() => null);
      if (!d) { caja.replaceChildren(h('p', { class: 'apoyo' }, 'No pudimos cargar los accesos.')); return; }
      const accion = (texto, fn, cls = 'btn') => h('button', { class: cls, type: 'button', onclick: async (ev) => { ev.currentTarget.disabled = true; try { await fn(); } catch (e) { aviso(ERR[e.codigo] || 'No se pudo completar.'); } pintar(); } }, texto);
      caja.replaceChildren(
        h('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap' }, h('h2', { style: 'margin:0' }, 'Acceso al portal del cliente'),
          h('button', { class: 'btn btn-principal', type: 'button', onclick: () => formularioInvitar(clienteId, d, pintar) }, '+ Dar acceso')),
        h('p', { class: 'apoyo' }, 'Cada persona entra con su mail. La primera vez, por un enlace que le llega, y ahí elige su contraseña. Podés darlo de baja o de alta cuando quieras y mirar el portal tal como lo ve.'),
        !d.mail_configurado && h('p', { class: 'apoyo', style: 'color:var(--a)' }, 'El envío de mails todavía no está configurado: al invitar te mostramos el enlace para que se lo mandes vos.'),
        d.accesos.length ? d.accesos.map((a) => h('div', { class: 'linea', style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--borde)' },
          h('div', { style: 'flex:1;min-width:220px' }, h('b', null, a.nombre), h('div', { class: 'apoyo' }, a.email), h('div', { class: 'apoyo' }, a.ultimo_ingreso ? `Último ingreso: ${fecha(a.ultimo_ingreso)}` : 'Todavía no ingresó')),
          chip(...ESTADO[a.estado]),
          h('div', { class: 'acciones', style: 'display:flex;gap:8px;flex-wrap:wrap' },
            a.estado !== 'baja' && accion('Ver como cliente', async () => { const r = await api(`/api/portal/accesos/${a.id}/ver-como`, { metodo: 'POST' }); window.open(r.url, '_blank', 'noopener'); }),
            a.estado !== 'baja' && accion(a.tiene_clave ? 'Mandar enlace' : 'Reenviar invitación', async () => mostrarEnlace(await api(`/api/portal/accesos/${a.id}/enlace`, { metodo: 'POST' }), `a ${a.email}`)),
            a.estado === 'baja' ? accion('Dar de alta', async () => { await api(`/api/portal/accesos/${a.id}/alta`, { metodo: 'POST' }); aviso('Acceso reactivado'); })
              : accion('Dar de baja', async () => { if (!window.confirm(`¿Dar de baja el acceso de ${a.nombre}? Deja de poder entrar ahora mismo.`)) return; await api(`/api/portal/accesos/${a.id}/baja`, { metodo: 'POST' }); aviso('Acceso dado de baja'); })))))
          : h('p', { class: 'apoyo', style: 'margin:16px 0 0' }, 'Todavía nadie de este cliente tiene acceso.'));
    }
    pintar(); return caja;
  }
  return { panel };
}
