// Configuración del sistema: valores, módulos visibles y permisos por rol. Solo para quien tiene sistema.configurar.
export function crearConfiguracion(U) {
  const { h, agregar, vaciar, api, chip, cargando, encabezado, estado } = U;
  const GRUPOS = { clientes: 'Clientes y contactos', contratos: 'Contratos', finanzas: 'Finanzas y cobranzas', servicio: 'Servicio técnico', equipos: 'Equipos', insumos: 'Insumos', analitica: 'Tableros y reportes', sistema: 'Sistema' };
  const ROL = { direccion: 'Dirección', head_comercial: 'Head comercial', comercial: 'Comercial', head_atencion: 'Head atención', atencion: 'Atención', head_tecnico: 'Head técnico', tecnico: 'Técnico', facturacion: 'Facturación' };
  const rolNombre = (n) => ROL[n] ?? n.replaceAll('_', ' ');
  const ERR = { valor_invalido: 'Ese valor no es válido. Revisá el mínimo y el máximo.', rol_fijo: 'Dirección siempre tiene todo y no se edita.', permiso_desconocido: 'Ese permiso no existe.' };

  function aviso(t) {
    document.querySelector('.aviso-flotante')?.remove();
    const el = h('div', { class: 'aviso-flotante', role: 'status' }, t); document.body.append(el); setTimeout(() => el.remove(), 2600);
  }
  const msg = (e) => ERR[e.datos?.error] ?? 'No se pudo guardar. Probá de nuevo.';

  async function vistaConfiguracion(destino, tab = 'valores') {
    const pestanas = [['valores', 'Valores'], ['modulos', 'Módulos'], ['roles', 'Roles y permisos']];
    const cuerpo = h('div');
    agregar(destino, [encabezado('Configuración', 'Todo lo que se puede ajustar del sistema, en un solo lugar.',
      h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/usuarios' }, 'Usuarios'), h('a', { class: 'btn', href: '#/alertas' }, 'Alertas'), h('a', { class: 'btn', href: '#/auditoria' }, 'Auditoría'))),
    h('div', { class: 'pestanas' }, pestanas.map(([k, t]) => h('button', { type: 'button', class: k === tab ? 'activa' : '', onclick: () => { location.hash = `#/configuracion/${k}`; } }, t))), cuerpo]);
    const [cfg, perm] = await Promise.all([api('/api/admin/config'), tab === 'roles' ? api('/api/admin/permisos') : null]);
    if (tab === 'modulos') return modulos(cuerpo, cfg);
    if (tab === 'roles') return roles(cuerpo, perm);
    return valores(cuerpo, cfg);
  }

  function valores(dest, cfg) {
    const grupos = new Map();
    for (const i of cfg.items.filter((x) => x.tipo !== 'lista')) grupos.set(i.grupo, [...(grupos.get(i.grupo) ?? []), i]);
    for (const [g, items] of grupos) {
      dest.append(h('div', { class: 'tarjeta' }, h('h2', null, g), items.map((i) => {
        const inp = h('input', { id: `c-${i.clave}`, type: i.tipo === 'entero' ? 'number' : 'text', value: i.valor, min: i.min, max: i.max, maxlength: i.max && i.tipo === 'texto' ? String(i.max) : null });
        const err = h('span', { class: 'neg', role: 'alert' }); const ok = h('button', { class: 'btn btn-chico btn-principal', type: 'button' }, 'Guardar');
        ok.addEventListener('click', async () => {
          err.textContent = ''; ok.disabled = true;
          try { await api(`/api/admin/config/${i.clave}`, { metodo: 'PUT', cuerpo: { valor: i.tipo === 'entero' ? Number(inp.value) : inp.value } }); aviso('Guardado'); if (i.clave === 'ipc.meses_ajuste') estado.me.config.ipc_meses = Number(inp.value); }
          catch (e) { err.textContent = msg(e); }
          ok.disabled = false;
        });
        return h('div', { class: 'ajuste' }, h('div', { class: 'ajuste-texto' }, h('label', { for: `c-${i.clave}` }, i.titulo), h('div', { class: 'apoyo' }, i.ayuda)),
          h('div', { class: 'ajuste-campo' }, inp, i.unidad && h('span', { class: 'apoyo' }, i.unidad), ok), err);
      })));
    }
    dest.append(h('p', { class: 'apoyo' }, 'Quién puede hacer qué se define en Roles y permisos. Los textos de las alertas y a quién le llegan, en Alertas.'));
  }

  function modulos(dest, cfg) {
    const it = cfg.items.find((x) => x.clave === 'modulos.ocultos'); let ocultos = [...it.valor];
    dest.append(h('div', { class: 'tarjeta' }, h('h2', null, 'Módulos visibles'), h('p', { class: 'apoyo', style: 'margin-top:-6px' }, 'Un módulo oculto desaparece del menú y deja de responder para todos, incluida Dirección. Los datos no se borran: al volver a mostrarlo, está todo.'),
      cfg.modulos.map((m) => {
        const c = h('input', { type: 'checkbox', id: `m-${m.clave}`, checked: !ocultos.includes(m.clave) });
        c.addEventListener('change', async () => {
          const antes = [...ocultos]; ocultos = c.checked ? ocultos.filter((x) => x !== m.clave) : [...ocultos, m.clave];
          try { await api('/api/admin/config/modulos.ocultos', { metodo: 'PUT', cuerpo: { valor: ocultos } }); estado.me.config.modulos_ocultos = ocultos; aviso(c.checked ? `${m.nombre} visible` : `${m.nombre} oculto`); }
          catch { ocultos = antes; c.checked = !c.checked; aviso('No se pudo guardar'); }
        });
        return h('label', { class: 'interruptor', for: `m-${m.clave}` }, c, h('span', null, m.nombre));
      }),
      h('p', { class: 'apoyo' }, 'Configuración, Usuarios, Alertas y Auditoría no se pueden ocultar. El menú se actualiza al recargar la página.')));
  }

  function roles(dest, d) {
    const porModulo = new Map(); for (const p of d.permisos) porModulo.set(p.modulo, [...(porModulo.get(p.modulo) ?? []), p]);
    const guardar = async (rol, c, clave) => {
      const set = new Set(rol.permisos); if (c.checked) set.add(clave); else set.delete(clave);
      try { await api(`/api/admin/roles/${rol.id}/permisos`, { metodo: 'PUT', cuerpo: { permisos: [...set] } }); rol.permisos = [...set]; aviso(`Guardado para ${rolNombre(rol.nombre)}`); }
      catch (e) { c.checked = !c.checked; aviso(msg(e)); }
    };
    const filas = [];
    for (const [mod, ps] of porModulo) {
      filas.push(h('tr', { class: 'grupo-fila' }, h('th', { colspan: String(d.roles.length + 1) }, GRUPOS[mod] ?? mod)));
      for (const p of ps) filas.push(h('tr', null, h('td', { class: 'perm-desc' }, p.descripcion, h('div', { class: 'apoyo' }, p.clave)),
        d.roles.map((r) => { const c = h('input', { type: 'checkbox', checked: r.fijo || r.permisos.includes(p.clave), disabled: r.fijo, 'aria-label': `${r.nombre}: ${p.descripcion}` }); if (!r.fijo) c.addEventListener('change', () => guardar(r, c, p.clave)); return h('td', { class: 'celda-check' }, c); })));
    }
    dest.append(h('div', { class: 'tarjeta' }, h('p', { class: 'apoyo', style: 'margin:0 0 12px' }, 'Marcá qué puede hacer cada rol. Cada cambio se guarda al instante y queda en Auditoría. Dirección siempre tiene todo. Lo que cada persona ve de clientes y tickets depende además de su área y alcance (lo propio, su equipo o todo), que se define en Usuarios.'),
      h('div', { class: 'matriz-caja' }, h('table', { class: 'matriz' }, h('thead', null, h('tr', null, h('th', null, 'Permiso'), d.roles.map((r) => h('th', { class: 'celda-check' }, rolNombre(r.nombre), r.fijo && h('div', { class: 'apoyo' }, 'fijo'))))), h('tbody', null, filas)))));
  }

  return { vistaConfiguracion };
}
