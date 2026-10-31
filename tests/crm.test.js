import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar as entrarSinCache } from './ayuda.js';
import { normalizarCuit } from '../src/lib/cuit.js';
import { datosDeNacimiento } from '../src/lib/contactos.js';

let ctx; let K; const ses = new Map();
const entrar = async (e) => { if (!ses.has(e)) ses.set(e, await entrarSinCache(ctx.app, e)); return ses.get(e); };

before(async () => {
  ctx = await montar();
  const rubro = await ctx.db('rubros').whereNull('parent_id').where({ nombre: 'Salud' }).first();
  const sub = await ctx.db('rubros').where({ parent_id: rubro.id }).first();
  const otro = await ctx.db('rubros').whereNull('parent_id').whereNot({ id: rubro.id }).first();
  K = { rubro: rubro.id, sub: sub.id, otroRubro: otro.id };
});
after(async () => { await ctx.cerrar(); });

const contacto = (o = {}) => ({ nombre: 'Laura', apellido: 'Paz', cargo: 'Compras', roles: ['comercial'], telefonos: [{ tipo: 'celular', numero: '1155550000' }], emails: [{ tipo: 'laboral', direccion: 'laura@clinica.com' }], fecha_nacimiento: '1985-11-03', ...o });
const alta = (o = {}) => ({ razon_social: 'Clínica Norte SA', nombre_comercial: 'Clínica Norte', cuit: '30-71646173-0', condicion_iva: 'responsable_inscripto', rubro_id: K.rubro, subrubro_id: K.sub,
  sede: { nombre: 'Casa central', domicilio: 'Av. Cabildo 1000', localidad: 'CABA', zona: 'caba' }, contactos: [contacto(), contacto({ nombre: 'Marta', apellido: 'Gil', roles: ['facturacion', 'cobranzas'], emails: [{ tipo: 'facturacion', direccion: 'pagos@clinica.com' }], fecha_nacimiento: null })], ...o });

test('CUIT: valida el dígito verificador y da formato', () => {
  assert.equal(normalizarCuit('30716461730'), '30-71646173-0'); assert.equal(normalizarCuit('30-71646173-1'), null); assert.equal(normalizarCuit('123'), null);
});

test('edad y próximo cumpleaños', () => {
  const d = datosDeNacimiento('1985-11-03', '2026-10-31'); assert.equal(d.edad, 40); assert.equal(d.dias_para_cumple, 3); assert.equal(d.cumple_anios, 41);
  assert.equal(datosDeNacimiento('1985-10-31', '2026-10-31').dias_para_cumple, 0);
  assert.equal(datosDeNacimiento('1985-02-29'.replace('29', '28'), '2026-10-31').proximo_cumple, '2027-02-28');
});

test('alta completa: cliente, sede, contactos con roles y responsable, todo en una operación', async () => {
  const dir = await entrar('direccion@demo.local'); const nicoId = (await ctx.db('usuarios').where({ email: 'nicolas@demo.local' }).first()).id;
  const r = await dir.llamar('POST', '/api/clientes', alta({ responsable_id: nicoId })); assert.equal(r.statusCode, 201, r.body);
  const d = (await dir.llamar('GET', `/api/clientes/${r.json().id}`)).json();
  assert.equal(d.cliente.cuit, '30-71646173-0'); assert.equal(d.cliente.rubro_nombre, 'Salud'); assert.ok(d.cliente.subrubro_nombre); assert.equal(d.sedes.length, 1); assert.equal(d.sedes[0].es_principal, 1);
  assert.equal(d.contactos.length, 2); assert.equal(d.responsable.id, nicoId);
  const laura = d.contactos.find((c) => c.nombre === 'Laura'); assert.equal(laura.fecha_nacimiento, '1985-11-03'); assert.ok(laura.edad >= 40); assert.deepEqual(laura.roles, ['comercial']);
  assert.deepEqual(d.contactos.find((c) => c.nombre === 'Marta').roles, ['facturacion', 'cobranzas']);
  K.cli = r.json().id; K.laura = laura.id;
});

test('alta: CUIT duplicado o inválido, rubro y subrubro inconsistentes, contacto sin medio, facturación sin mail', async () => {
  const dir = await entrar('direccion@demo.local');
  const dup = await dir.llamar('POST', '/api/clientes', alta()); assert.equal(dup.statusCode, 409); assert.equal(dup.json().error, 'cuit_duplicado');
  assert.equal((await dir.llamar('POST', '/api/clientes', alta({ cuit: '30-71646173-9' }))).json().error, 'cuit_invalido');
  assert.equal((await dir.llamar('POST', '/api/clientes', alta({ cuit: null, rubro_id: K.otroRubro }))).json().error, 'subrubro_invalido');
  assert.equal((await dir.llamar('POST', '/api/clientes', alta({ cuit: null, rubro_id: null }))).json().error, 'subrubro_sin_rubro');
  assert.equal((await dir.llamar('POST', '/api/clientes', alta({ cuit: null, contactos: [contacto({ telefonos: [], emails: [] })] }))).json().error, 'contacto_sin_medio');
  assert.equal((await dir.llamar('POST', '/api/clientes', alta({ cuit: null, contactos: [contacto({ roles: ['facturacion'], emails: [] })] }))).json().error, 'facturacion_sin_mail');
  assert.equal((await dir.llamar('POST', '/api/clientes', alta({ cuit: null, contactos: [contacto({ fecha_nacimiento: '2999-01-01' })] }))).json().error, 'nacimiento_invalido');
  assert.equal((await ctx.db('clientes').where({ razon_social: 'Clínica Norte SA' })).length, 1, 'ningún intento fallido dejó un cliente a medias');
});

test('un comercial que da de alta queda como responsable; no puede elegir a otro', async () => {
  const nico = await entrar('nicolas@demo.local');
  const sinCuit = await nico.llamar('POST', '/api/clientes', alta({ cuit: null, razon_social: 'Del comercial 2 SA' })); assert.equal(sinCuit.statusCode, 201);
  const d = (await nico.llamar('GET', `/api/clientes/${sinCuit.json().id}`)).json(); assert.equal(d.responsable.nombre.length > 0, true);
  assert.equal((await nico.llamar('POST', '/api/clientes', alta({ cuit: null, razon_social: 'Con responsable', responsable_id: 1 }))).json().error, 'responsable_invalido');
});

test('contactos: alta, edición, baja, consentimiento y alcance', async () => {
  const dir = await entrar('direccion@demo.local');
  const n = await dir.llamar('POST', `/api/clientes/${K.cli}/contactos`, contacto({ nombre: 'Pedro', roles: ['cobranzas'], acepta_comunicaciones: true })); assert.equal(n.statusCode, 201);
  assert.equal(n.json().consentimiento_fecha != null, true);
  const e = await dir.llamar('PATCH', `/api/contactos/${n.json().id}`, contacto({ nombre: 'Pedro', apellido: 'Díaz', roles: ['cobranzas', 'decisor'], acepta_comunicaciones: false })); assert.equal(e.statusCode, 200);
  assert.equal(e.json().apellido, 'Díaz'); assert.ok(e.json().baja_comunicaciones_fecha);
  assert.equal((await dir.llamar('POST', `/api/clientes/${K.cli}/contactos`, contacto({ roles: ['jefe'] }))).statusCode, 400);
  assert.equal((await dir.llamar('POST', `/api/clientes/${K.cli}/contactos`, contacto({ sede_id: 999999 }))).json().error, 'sede_invalida');
  assert.equal((await (await entrar('julia@demo.local')).llamar('PATCH', `/api/contactos/${n.json().id}`, contacto())).statusCode, 403);
  assert.equal((await dir.llamar('DELETE', `/api/contactos/${n.json().id}`)).statusCode, 200);
  const d = (await dir.llamar('GET', `/api/clientes/${K.cli}`)).json(); assert.equal(d.contactos.some((c) => c.nombre === 'Pedro'), false);
});

test('cumpleaños próximos, solo de cuentas visibles', async () => {
  const dir = await entrar('direccion@demo.local');
  const c = (await dir.llamar('GET', '/api/contactos/cumples?dias=90')).json().items; const l = c.find((x) => x.nombre === 'Laura Paz'); assert.ok(l); assert.equal(l.cliente, 'Clínica Norte');
  const otro = (await entrar('valentina@demo.local')); const f = (await otro.llamar('GET', '/api/contactos/cumples?dias=90')).json().items;
  assert.equal(f.some((x) => x.nombre === 'Laura Paz'), false, 'Valentina no ve cuentas ajenas');
});

test('rubros: árbol para elegir; solo Dirección edita; no se duplican', async () => {
  const dir = await entrar('direccion@demo.local'); const t = (await dir.llamar('GET', '/api/rubros')).json().rubros;
  assert.ok(t.length >= 10 && t[0].subrubros.length > 0);
  const n = await dir.llamar('POST', '/api/rubros', { nombre: 'Rubro nuevo' }); assert.equal(n.statusCode, 201);
  assert.equal((await dir.llamar('POST', '/api/rubros', { nombre: 'Rubro nuevo' })).statusCode, 409);
  assert.equal((await dir.llamar('POST', '/api/rubros', { nombre: 'Sub', parent_id: n.json().id })).statusCode, 201);
  assert.equal((await (await entrar('nicolas@demo.local')).llamar('POST', '/api/rubros', { nombre: 'X1' })).statusCode, 403);
  await dir.llamar('PATCH', `/api/rubros/${n.json().id}`, { activo: false });
  assert.equal((await dir.llamar('GET', '/api/rubros')).json().rubros.some((r) => r.nombre === 'Rubro nuevo'), false);
  assert.equal((await dir.llamar('POST', '/api/clientes', alta({ cuit: null, razon_social: 'R inactivo', rubro_id: n.json().id, subrubro_id: null }))).json().error, 'rubro_invalido');
});

const lead = (o = {}) => ({ empresa: 'Estudio Pérez', contacto_nombre: 'Juan', contacto_apellido: 'Pérez', email: 'juan@perez.com', telefono: '1166667777', rubro_id: K.rubro, subrubro_id: K.sub, origen: 'LinkedIn', valor_estimado_usd: 300, equipos_estimados: 2, ...o });

test('Hunting: un lead nace en Nuevo, cada comercial ve los suyos y el líder ve todos', async () => {
  const nico = await entrar('nicolas@demo.local'); const val = await entrar('valentina@demo.local'); const head = await entrar('head.comercial@demo.local');
  const a = await nico.llamar('POST', '/api/leads', lead()); assert.equal(a.statusCode, 201); K.l1 = a.json().id;
  const b = await val.llamar('POST', '/api/leads', lead({ empresa: 'Taller Gómez' })); K.l2 = b.json().id;
  const mios = (await nico.llamar('GET', '/api/leads')).json(); assert.deepEqual(mios.items.map((x) => x.empresa), ['Estudio Pérez']); assert.equal(mios.items[0].etapa, 'nuevo'); assert.equal(mios.etapas.length, 7);
  assert.equal((await head.llamar('GET', '/api/leads')).json().items.length >= 2, true);
  assert.equal((await nico.llamar('GET', `/api/leads/${K.l2}`)).statusCode, 404);
  assert.equal((await (await entrar('julia@demo.local')).llamar('GET', '/api/leads')).statusCode, 403);
});

test('Hunting: mover de etapa deja historial; perdido pide motivo; ganado solo convirtiendo', async () => {
  const nico = await entrar('nicolas@demo.local');
  assert.equal((await nico.llamar('POST', `/api/leads/${K.l1}/mover`, { etapa: 'contactado' })).statusCode, 200);
  assert.equal((await nico.llamar('POST', `/api/leads/${K.l1}/mover`, { etapa: 'perdido' })).json().error, 'motivo_requerido');
  assert.equal((await nico.llamar('POST', `/api/leads/${K.l1}/mover`, { etapa: 'ganado' })).json().error, 'ganado_se_convierte');
  assert.equal((await nico.llamar('POST', `/api/leads/${K.l1}/actividades`, { tipo: 'llamada', texto: 'Quiere cotización', proxima_accion: 'Mandar propuesta', proxima_accion_fecha: '2020-01-01' })).statusCode, 201);
  const d = (await nico.llamar('GET', `/api/leads/${K.l1}`)).json(); assert.equal(d.lead.etapa, 'contactado'); assert.equal(d.lead.accion_vencida, true); assert.equal(d.actividades.length, 3);
  assert.match(d.actividades.find((x) => x.tipo === 'etapa' && x.texto.includes('→')).texto, /Nuevo → Contactado/);
});

test('Hunting: convertir crea el cliente con sede, contacto y responsable; después no se toca', async () => {
  const nico = await entrar('nicolas@demo.local'); const nicoId = (await ctx.db('usuarios').where({ email: 'nicolas@demo.local' }).first()).id;
  const r = await nico.llamar('POST', `/api/leads/${K.l1}/convertir`, { cuit: '30-71646173-0' }); assert.equal(r.statusCode, 409); assert.equal(r.json().error, 'cuit_duplicado');
  const ok = await nico.llamar('POST', `/api/leads/${K.l1}/convertir`, { roles: ['decisor', 'comercial'] }); assert.equal(ok.statusCode, 201, ok.body);
  const c = (await nico.llamar('GET', `/api/clientes/${ok.json().cliente_id}`)).json();
  assert.equal(c.cliente.estado, 'prospecto'); assert.equal(c.cliente.rubro_nombre, 'Salud'); assert.equal(c.responsable.id, nicoId); assert.equal(c.contactos.length, 1); assert.deepEqual(c.contactos[0].roles, ['decisor', 'comercial']);
  assert.equal((await nico.llamar('POST', `/api/leads/${K.l1}/convertir`, {})).json().error, 'ya_convertido');
  assert.equal((await nico.llamar('POST', `/api/leads/${K.l1}/mover`, { etapa: 'nuevo' })).json().error, 'ya_convertido');
  assert.equal((await nico.llamar('GET', `/api/leads/${K.l1}`)).json().lead.etapa, 'ganado');
});

test('Hunting: perdido guarda el motivo; Dirección puede reasignar, un comercial no', async () => {
  const val = await entrar('valentina@demo.local'); const dir = await entrar('direccion@demo.local'); const nico = (await ctx.db('usuarios').where({ email: 'nicolas@demo.local' }).first()).id;
  assert.equal((await val.llamar('POST', `/api/leads/${K.l2}/mover`, { etapa: 'perdido', motivo: 'Eligió otro proveedor' })).statusCode, 200);
  assert.equal((await val.llamar('GET', `/api/leads/${K.l2}`)).json().lead.motivo_perdida, 'Eligió otro proveedor');
  assert.equal((await val.llamar('PATCH', `/api/leads/${K.l2}`, { responsable_id: nico })).json().error, 'responsable_invalido');
  assert.equal((await dir.llamar('PATCH', `/api/leads/${K.l2}`, { responsable_id: nico })).statusCode, 200);
});

test('activar un contrato vuelve activo al cliente que era prospecto', async () => {
  const dir = await entrar('direccion@demo.local');
  const id = (await dir.llamar('POST', '/api/contratos', { cliente_id: K.cli, nombre: 'Primero', moneda: 'USD', fecha_inicio: '2026-10-01', precios: { monto_mensual: 100, franquicia_negro: 0, franquicia_color: 0, excedente_negro: 0, excedente_color: 0, facturable: true } })).json().id;
  assert.ok(id); assert.equal((await ctx.db('clientes').where({ id: K.cli }).first()).estado, 'activo');
});
