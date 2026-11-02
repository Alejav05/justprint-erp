import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar } from './ayuda.js';

let ctx; let propio; let ajeno; let contratoPropio; let contratoAjeno;
const PDF = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n% ${extra}\n%%EOF`);
before(async () => {
  ctx = await montar();
  const nicolas = (await ctx.db('usuarios').where({ email: 'nicolas@demo.local' }).first()).id;
  [propio] = await ctx.db('clientes').insert({ razon_social: 'Cuenta de Nicolás', estado: 'activo' });
  [ajeno] = await ctx.db('clientes').insert({ razon_social: 'Cuenta de otro comercial', estado: 'activo' });
  await ctx.db('cartera_asignaciones').insert({ cliente_id: propio, usuario_id: nicolas, desde: '2026-01-01' });
  [contratoPropio] = await ctx.db('contratos').insert({ cliente_id: propio, nombre: 'Contrato A', estado: 'vigente', moneda: 'USD', fecha_inicio: '2026-01-01' });
  [contratoAjeno] = await ctx.db('contratos').insert({ cliente_id: ajeno, nombre: 'Contrato B', estado: 'vigente', moneda: 'USD', fecha_inicio: '2026-01-01' });
});
after(async () => { await ctx.cerrar(); });

const subir = async (usuario, contrato, pdf, query = '') => {
  const s = await entrar(ctx.app, usuario);
  return ctx.app.inject({ method: 'POST', url: `/api/contratos/${contrato}/documentos${query}`, payload: pdf, headers: { 'content-type': 'application/pdf', 'x-nombre-archivo': encodeURIComponent('Contrato firmado.pdf') }, cookies: { jp_sid: s.cookie.value } });
};

test('el comercial sube y descarga documentos de su cuenta; el contrato puede tener contrato, anexos y adendas', async () => {
  const r = await subir('nicolas@demo.local', contratoPropio, PDF('a'), '?tipo=contrato&titulo=Contrato%20original&fecha=2026-01-05');
  assert.equal(r.statusCode, 201, r.body);
  const anexo = await subir('nicolas@demo.local', contratoPropio, PDF('b'), '?tipo=anexo&titulo=Anexo%20I%20-%20equipo%20adicional&fecha=2026-06-01');
  assert.equal(anexo.statusCode, 201);
  const nico = await entrar(ctx.app, 'nicolas@demo.local');
  const lista = (await nico.llamar('GET', `/api/contratos/${contratoPropio}/documentos`)).json().documentos;
  assert.deepEqual(lista.map((d) => d.titulo), ['Anexo I - equipo adicional', 'Contrato original'], 'el más reciente primero');
  assert.equal(lista[0].tipo_nombre, 'Anexo');
  const porCliente = (await nico.llamar('GET', `/api/clientes/${propio}/documentos`)).json();
  assert.equal(porCliente.documentos.length, 2); assert.equal(porCliente.contratos.length, 1);
  const bajar = await nico.llamar('GET', `/api/documentos/${lista[1].id}/archivo`);
  assert.equal(bajar.statusCode, 200); assert.equal(bajar.headers['content-type'], 'application/pdf'); assert.equal(bajar.rawPayload.subarray(0, 5).toString(), '%PDF-');
  assert.match((await nico.llamar('GET', `/api/documentos/${lista[1].id}/archivo?descargar=1`)).headers['content-disposition'], /^attachment/);
});

test('validaciones: solo PDF, sin repetidos, tamaño máximo y fecha', async () => {
  assert.equal((await subir('nicolas@demo.local', contratoPropio, Buffer.from('esto no es un pdf'), '?tipo=otro')).json().error, 'no_es_pdf');
  assert.equal((await subir('nicolas@demo.local', contratoPropio, PDF('a'))).json().error, 'documento_repetido');
  assert.equal((await subir('nicolas@demo.local', contratoPropio, PDF('c'), '?fecha=2999-01-01')).json().error, 'fecha_futura');
  assert.equal((await subir('nicolas@demo.local', contratoPropio, PDF('d'), '?tipo=cualquiera')).statusCode, 400);
  const grande = await subir('nicolas@demo.local', contratoPropio, Buffer.concat([PDF('g'), Buffer.alloc(11 * 1024 * 1024)]));
  assert.ok([413, 400].includes(grande.statusCode));
});

test('alcance: el comercial no toca cuentas ajenas, el head y dirección ven todo', async () => {
  assert.equal((await subir('nicolas@demo.local', contratoAjeno, PDF('x'))).statusCode, 404);
  const head = await subir('head.comercial@demo.local', contratoAjeno, PDF('x'), '?titulo=Contrato%20B');
  assert.equal(head.statusCode, 201, head.body);
  const nico = await entrar(ctx.app, 'nicolas@demo.local');
  assert.equal((await nico.llamar('GET', `/api/contratos/${contratoAjeno}/documentos`)).statusCode, 404);
  assert.equal((await nico.llamar('GET', `/api/documentos/${head.json().id}/archivo`)).statusCode, 404, 'tampoco el archivo');
  const dir = await entrar(ctx.app, 'direccion@demo.local');
  assert.equal((await dir.llamar('GET', `/api/documentos/${head.json().id}/archivo`)).statusCode, 200);
  assert.equal((await subir('direccion@demo.local', contratoPropio, PDF('z'), '?tipo=adenda&titulo=Renovación')).statusCode, 201);
  // Quien no tiene el permiso no sube (facturación mira, técnico ni ve contratos).
  assert.equal((await subir('julia@demo.local', contratoPropio, PDF('j'))).statusCode, 403);
  assert.equal((await entrar(ctx.app, 'julia@demo.local').then((j) => j.llamar('GET', `/api/contratos/${contratoPropio}/documentos`))).statusCode, 200);
  assert.equal((await entrar(ctx.app, 'matias@demo.local').then((m) => m.llamar('GET', `/api/contratos/${contratoPropio}/documentos`))).statusCode, 403);
});

test('eliminar oculta el documento (queda en la base y en la auditoría) y solo lo hace quien edita contratos', async () => {
  const nico = await entrar(ctx.app, 'nicolas@demo.local');
  const id = (await nico.llamar('GET', `/api/contratos/${contratoPropio}/documentos`)).json().documentos.find((d) => d.tipo === 'adenda').id;
  assert.equal((await nico.llamar('DELETE', `/api/documentos/${id}`)).statusCode, 403, 'el comercial sube pero no borra');
  const head = await entrar(ctx.app, 'head.comercial@demo.local');
  assert.equal((await head.llamar('DELETE', `/api/documentos/${id}`)).statusCode, 200);
  assert.equal((await nico.llamar('GET', `/api/documentos/${id}/archivo`)).statusCode, 404);
  assert.ok(await ctx.db('contrato_documentos_contenido').where({ documento_id: id }).first(), 'el PDF sigue en la base');
  assert.ok(await ctx.db('audit_log').where({ tabla: 'contrato_documentos', accion: 'eliminar' }).first());
});
