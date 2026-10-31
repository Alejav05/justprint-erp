// Valores del sistema editables desde Configuración. La definición vive acá; los valores elegidos, en la tabla `configuracion`.
export const MODULOS = [
  ['clientes', 'Clientes', ['/api/clientes', '/api/cartera']], ['tickets', 'Tickets', ['/api/tickets']], ['servicio', 'Tablero de servicio', ['/api/tableros/servicio']],
  ['equipos', 'Equipos', ['/api/equipos']], ['insumos', 'Insumos', ['/api/insumos', '/api/remitos']], ['facturacion', 'Facturación', ['/api/facturas', '/api/facturacion', '/api/cobros', '/api/ipc']],
  ['cobranzas', 'Cobranzas', ['/api/cobranzas']],
];

export const DEFINICIONES = [
  { clave: 'cobranzas.plazo_defecto_dias', grupo: 'Cobranzas', titulo: 'Plazo de pago por defecto', ayuda: 'Días que se dan para pagar cuando el contrato no tiene plazo propio.', tipo: 'entero', defecto: 15, min: 0, max: 365, unidad: 'días' },
  { clave: 'cobranzas.gracia_dias', grupo: 'Cobranzas', titulo: 'Días de gracia (semáforo amarillo)', ayuda: 'Cuántos días después del vencimiento la factura queda en amarillo antes de pasar a rojo.', tipo: 'entero', defecto: 15, min: 0, max: 120, unidad: 'días' },
  { clave: 'ipc.meses_ajuste', grupo: 'Contratos en pesos', titulo: 'Cada cuántos meses se ajusta', ayuda: 'Se usa para mostrar la fecha del próximo ajuste. El ajuste siempre lo valida y carga una persona.', tipo: 'entero', defecto: 3, min: 1, max: 24, unidad: 'meses' },
  { clave: 'marca.slogan', grupo: 'Marca', titulo: 'Eslogan', ayuda: 'Aparece en la pantalla de ingreso.', tipo: 'texto', defecto: 'En cada página, en cada proyecto', max: 80 },
  { clave: 'marca.empresa', grupo: 'Marca', titulo: 'Razón social facturante', ayuda: 'Se muestra al pie de la pantalla de ingreso.', tipo: 'texto', defecto: 'Europa Haus S.A.S.', max: 80 },
  { clave: 'modulos.ocultos', grupo: 'Módulos', titulo: 'Módulos ocultos', ayuda: 'Un módulo oculto desaparece del menú y deja de responder para todos.', tipo: 'lista', defecto: [], opciones: MODULOS.map(([k]) => k) },
];

const porClave = new Map(DEFINICIONES.map((d) => [d.clave, d]));
const valores = new Map(DEFINICIONES.map((d) => [d.clave, d.defecto]));

export const valor = (clave) => valores.get(clave);
export const modulosOcultos = () => valores.get('modulos.ocultos') ?? [];
export const moduloDeUrl = (url) => { for (const [k, , prefijos] of MODULOS) if (prefijos.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`))) return k; return null; };

export function validar(clave, v) {
  const d = porClave.get(clave); if (!d) return { error: 'clave_desconocida' };
  if (d.tipo === 'entero') { if (!Number.isInteger(v) || v < d.min || v > d.max) return { error: 'valor_invalido' }; }
  else if (d.tipo === 'texto') { if (typeof v !== 'string' || !v.trim() || v.length > d.max) return { error: 'valor_invalido' }; v = v.trim(); }
  else if (d.tipo === 'lista') { if (!Array.isArray(v) || v.some((x) => !d.opciones.includes(x))) return { error: 'valor_invalido' }; v = [...new Set(v)]; }
  return { valor: v };
}

export async function cargarAjustes(db) {
  for (const f of await db('configuracion')) { if (!porClave.has(f.clave)) continue; try { valores.set(f.clave, JSON.parse(f.valor)); } catch { /* queda el de fábrica */ } }
}
export function aplicar(clave, v) { valores.set(clave, v); }
export function restablecer() { for (const d of DEFINICIONES) valores.set(d.clave, d.defecto); }
