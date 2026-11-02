import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { montar, entrar as entrarSinCache } from './ayuda.js';
import { reemplazarCanal } from '../src/lib/canales.js';
import { telefonoAR } from '../src/lib/remitos.js';

let ctx; let cli; let insumo; let equipo; const ses = new Map();
const entrar = async (e) => { if (!ses.has(e)) ses.set(e, await entrarSinCache(ctx.app, e)); return ses.get(e); };
const PNG = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');

before(async () => {
  ctx = await montar();
  const prueba = (await ctx.db('clientes').where({ razon_social: 'Cliente Prueba SRL' }).first()).id;
  cli = { prueba, sede: (await ctx.db('sedes').where({ cliente_id: prueba }).first()).id };
  [insumo] = await ctx.db('insumos').insert({ codigo: 'TN-9970', descripcion: 'Tóner negro Brother TN-9970' });
  await ctx.db('movimientos_insumo').insert({ insumo_id: insumo, tipo: 'entrada', cantidad: 10, motivo: 'compra' });
  const head = await entrar('head.tecnico@demo.local');
  const modelo = (await ctx.db('modelos_equipo').first()).id;
  equipo = (await head.llamar('POST', '/api/equipos', { modelo_id: modelo, numero_serie: 'U62513K2J366726' })).json().id;
});
after(async () => { await ctx.cerrar(); });

test('número de remito 0001-00000001, con equipo e insumos; valida equipo, stock y que haya algo para entregar', async () => {
  const head = await entrar('head.tecnico@demo.local');
  const r = await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, sede_id: cli.sede, equipos: [equipo], items: [{ insumo_id: insumo, cantidad: 2 }], observaciones: 'Instalación' });
  assert.equal(r.statusCode, 201, r.body);
  assert.match(r.json().numero, /^0001-\d{8}$/);
  const fila = await ctx.db('remitos').where({ id: r.json().id }).first();
  assert.equal(fila.tipo, 'mixto'); assert.match(fila.token, /^[a-f0-9]{32}$/);
  assert.equal((await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba })).json().error, 'sin_items');
  assert.equal((await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, equipos: [999999] })).json().error, 'equipo_invalido');
  assert.equal((await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, items: [{ insumo_id: insumo, cantidad: 50 }] })).statusCode, 409);
  const det = (await head.llamar('GET', `/api/remitos/${r.json().id}`)).json();
  assert.equal(det.tipo_texto, 'Entrega de insumos'.replace('Entrega de insumos', det.tipo_texto)); assert.equal(det.items.length, 2);
  assert.ok(det.items.some((i) => i.detalle === 'N° de serie U62513K2J366726')); assert.ok(det.items.some((i) => i.detalle === 'Cód. TN-9970'));
  assert.equal(det.puede_firmar, true); assert.match(det.url_publica, /\/r\/[a-f0-9]{32}$/);
  assert.equal((await (await entrar('julia@demo.local')).llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, items: [{ insumo_id: insumo, cantidad: 1 }] })).statusCode, 403);
});

test('PDF, página pública sin costos y enlace inexistente', async () => {
  const head = await entrar('head.tecnico@demo.local');
  const { id } = (await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, equipos: [equipo], items: [{ insumo_id: insumo, cantidad: 1 }] })).json();
  const pdf = await head.llamar('GET', `/api/remitos/${id}/pdf`);
  assert.equal(pdf.statusCode, 200); assert.equal(pdf.headers['content-type'], 'application/pdf'); assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const token = (await ctx.db('remitos').where({ id }).first()).token;
  const pagina = await ctx.app.inject({ method: 'GET', url: `/r/${token}` });
  assert.equal(pagina.statusCode, 200); assert.match(pagina.body, /Tóner negro Brother/); assert.match(pagina.body, /U62513K2J366726/); assert.doesNotMatch(pagina.body, /costo/i);
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/r/${token}/pdf` })).statusCode, 200);
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/r/${'0'.repeat(32)}` })).statusCode, 404);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/r/abc' })).statusCode, 404);
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/remitos/${id}/pdf` })).statusCode, 401, 'el PDF de la API pide sesión');
});

test('conformidad con firma en pantalla: una sola vez, y el PDF y la página muestran quién recibió', async () => {
  const head = await entrar('head.tecnico@demo.local');
  const { id } = (await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, items: [{ insumo_id: insumo, cantidad: 1 }] })).json();
  assert.equal((await head.llamar('POST', `/api/remitos/${id}/conformidad`, { nombre: 'Ana Gómez', firma: 'data:image/png;base64,AAAA' })).json().error, 'firma_invalida');
  const ok = await head.llamar('POST', `/api/remitos/${id}/conformidad`, { nombre: 'Ana Gómez', cargo: 'Administración', dni: '30111222', email: 'ana@cliente.com', telefono: '11 5555-1234', firma: PNG });
  assert.equal(ok.statusCode, 201, ok.body);
  assert.equal((await ctx.db('remitos').where({ id }).first()).estado, 'firmado');
  assert.equal((await head.llamar('POST', `/api/remitos/${id}/conformidad`, { nombre: 'Otra', firma: PNG })).statusCode, 409);
  const det = (await head.llamar('GET', `/api/remitos/${id}`)).json();
  assert.equal(det.conformidad.nombre, 'Ana Gómez'); assert.equal(det.conformidad.tiene_firma, true); assert.equal(det.puede_firmar, false);
  assert.equal((await head.llamar('GET', `/api/remitos/${id}/firma.png`)).statusCode, 200);
  assert.equal((await head.llamar('GET', `/api/remitos/${id}/pdf`)).statusCode, 200);
  const token = (await ctx.db('remitos').where({ id }).first()).token;
  assert.match((await ctx.app.inject({ method: 'GET', url: `/r/${token}` })).body, /Ana Gómez/);
  const lista = (await head.llamar('GET', '/api/remitos?estado=firmado')).json();
  assert.ok(lista.items.some((r) => r.id === id && r.conformidad.nombre === 'Ana Gómez'));
});

test('firmar el remito de un servicio que quedó resuelto cierra el ticket', async () => {
  const mat = await entrar('matias@demo.local');
  const dir = await entrar('direccion@demo.local');
  const t = await dir.llamar('POST', '/api/tickets', { cliente_id: cli.prueba, asunto: 'No imprime', descripcion: 'x' }); assert.equal(t.statusCode, 201, t.body);
  const tid = t.json().id; await dir.llamar('POST', `/api/tickets/${tid}/asignar`, { tecnico_id: (await ctx.db('usuarios').where({ email: 'matias@demo.local' }).first()).id });
  const c = await mat.llamar('POST', `/api/tickets/${tid}/cierre`, { trabajo_realizado: 'Limpieza de rodillos' }); assert.equal(c.statusCode, 201, c.body);
  assert.equal(c.json().estado, 'resuelto'); assert.match(c.json().remito_url, /\/r\/[a-f0-9]{32}$/);
  const f = await mat.llamar('POST', `/api/remitos/${c.json().remito_id}/conformidad`, { nombre: 'Luis Paz', firma: PNG });
  assert.equal(f.statusCode, 201, f.body);
  assert.equal((await ctx.db('tickets').where({ id: tid }).first()).estado, 'cerrado');
});

test('remito firmado en papel: se sube el escaneo y queda archivado', async () => {
  const head = await entrar('head.tecnico@demo.local');
  const { id } = (await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, items: [{ insumo_id: insumo, cantidad: 1 }] })).json();
  const subir = (cuerpo, tipo, q = '?nombre=Pedro%20Ruiz&cargo=Encargado') => ctx.app.inject({ method: 'POST', url: `/api/remitos/${id}/escaneo${q}`, payload: cuerpo, headers: { 'content-type': tipo, 'x-nombre-archivo': 'scan.pdf' }, cookies: { jp_sid: head.cookie.value } });
  assert.equal((await subir(Buffer.from('hola mundo'), 'application/pdf')).statusCode, 400, 'no es un PDF de verdad');
  assert.equal((await subir(PDF, 'application/pdf', '')).statusCode, 400, 'falta quién firmó');
  assert.equal((await subir(PDF, 'application/pdf')).statusCode, 201);
  assert.equal((await subir(PDF, 'application/pdf')).statusCode, 409, 'ya estaba firmado');
  const det = (await head.llamar('GET', `/api/remitos/${id}`)).json();
  assert.equal(det.conformidad.metodo, 'papel'); assert.equal(det.escaneo.mime, 'application/pdf');
  const e = await head.llamar('GET', `/api/remitos/${id}/escaneo`); assert.equal(e.statusCode, 200); assert.equal(e.rawPayload.subarray(0, 5).toString(), '%PDF-');
});

test('envío: sin canal configurado avisa; con canal manda el PDF y deja registro; el celular argentino se normaliza', async () => {
  const head = await entrar('head.tecnico@demo.local');
  const { id } = (await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, items: [{ insumo_id: insumo, cantidad: 1 }] })).json();
  assert.equal((await head.llamar('POST', `/api/remitos/${id}/enviar`, { canal: 'mail', destino: 'a@b.com' })).json().error, 'mail_no_configurado');
  assert.equal((await head.llamar('POST', `/api/remitos/${id}/enviar`, { canal: 'whatsapp', destino: '1155551234', manual: true })).statusCode, 200);
  const enviados = [];
  reemplazarCanal('mail', { configurado: () => true, enviar: async (m) => enviados.push(m) });
  assert.equal((await head.llamar('POST', `/api/remitos/${id}/enviar`, { canal: 'mail', destino: 'cliente@empresa.com' })).statusCode, 200);
  assert.equal(enviados[0].attachments[0].contentType, 'application/pdf'); assert.match(enviados[0].text, /\/r\/[a-f0-9]{32}/);
  const firmado = await head.llamar('POST', `/api/remitos/${id}/conformidad`, { nombre: 'Ana Gómez', email: 'ana@cliente.com', firma: PNG });
  assert.equal(firmado.json().enviado.mail, true, 'si dejó mail y el canal está activo, se manda solo al firmar'); assert.equal(enviados.length, 2);
  const det = (await head.llamar('GET', `/api/remitos/${id}`)).json();
  assert.deepEqual(det.envios.map((e) => e.resultado).sort(), ['enviado', 'enviado', 'manual']);
  assert.equal(telefonoAR('11 5104-1954'), '5491151041954'); assert.equal(telefonoAR('+54 9 11 5104 1954'), '5491151041954'); assert.equal(telefonoAR('011 15 5104-1954'), '5491151041954'); assert.equal(telefonoAR('123'), null);
});

test('los remitos viejos se renumeran al formato nuevo sin perder el orden', async () => {
  const filas = await ctx.db('remitos').select('numero');
  assert.ok(filas.every((f) => /^0001-\d{8}$/.test(f.numero)));
});

test('encuesta: se toma después de la conformidad, una sola vez, y también desde el enlace público', async () => {
  const head = await entrar('head.tecnico@demo.local');
  const nuevo = async () => (await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, items: [{ insumo_id: insumo, cantidad: 1 }] })).json().id;
  const a = await nuevo();
  assert.equal((await head.llamar('POST', `/api/remitos/${a}/encuesta`, { puntaje: 5 })).json().error, 'sin_conformidad', 'primero la conformidad');
  await head.llamar('POST', `/api/remitos/${a}/conformidad`, { nombre: 'Ana Gómez', firma: PNG });
  assert.equal((await head.llamar('POST', `/api/remitos/${a}/encuesta`, { puntaje: 9 })).statusCode, 400);
  assert.equal((await head.llamar('POST', `/api/remitos/${a}/encuesta`, { puntaje: 5, aspectos: ['trato', 'puntualidad'], comentario: 'Todo muy bien' })).statusCode, 201);
  assert.equal((await head.llamar('POST', `/api/remitos/${a}/encuesta`, { puntaje: 1 })).json().error, 'ya_respondida');
  const det = (await head.llamar('GET', `/api/remitos/${a}`)).json();
  assert.equal(det.encuesta.puntaje, 5); assert.deepEqual(det.encuesta.aspectos, ['trato', 'puntualidad']);

  // Desde el enlace del cliente, sin sesión y sin JavaScript (formulario común).
  const b = await nuevo(); const tokenB = (await ctx.db('remitos').where({ id: b }).first()).token;
  let pagina = (await ctx.app.inject({ method: 'GET', url: `/r/${tokenB}` })).body;
  assert.ok(!pagina.includes('Tu opinión'), 'sin firmar no se pide opinión');
  await head.llamar('POST', `/api/remitos/${b}/conformidad`, { nombre: 'Luis Paz', firma: PNG });
  pagina = (await ctx.app.inject({ method: 'GET', url: `/r/${tokenB}` })).body;
  assert.match(pagina, /¿Cómo fue la atención que recibiste\?/);
  const envio = await ctx.app.inject({ method: 'POST', url: `/r/${tokenB}/encuesta`, payload: 'puntaje=2&aspectos=puntualidad&aspectos=trato&comentario=Llegaron+tarde', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(envio.statusCode, 303);
  const e = await ctx.db('encuestas').where({ remito_id: b }).first();
  assert.equal(e.puntaje, 2); assert.equal(e.origen, 'enlace'); assert.equal(e.comentario, 'Llegaron tarde'); assert.deepEqual(JSON.parse(e.aspectos), ['puntualidad', 'trato']);
  await ctx.app.inject({ method: 'POST', url: `/r/${tokenB}/encuesta`, payload: 'puntaje=5', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal((await ctx.db('encuestas').where({ remito_id: b })).length, 1, 'no se pisa la primera respuesta');
  assert.match((await ctx.app.inject({ method: 'GET', url: `/r/${tokenB}` })).body, /Gracias por contarnos/);
  assert.equal((await ctx.app.inject({ method: 'POST', url: `/r/${'0'.repeat(32)}/encuesta`, payload: 'puntaje=5', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode, 404);

  const dir = await entrar('direccion@demo.local');
  const r = (await dir.llamar('GET', '/api/encuestas')).json();
  assert.equal(r.cantidad, 2); assert.equal(r.promedio, 3.5); assert.equal(r.satisfechos, 50); assert.equal(r.para_revisar.length, 1);
  assert.equal(r.aspectos.find((x) => x.clave === 'trato').destacados, 1); assert.equal(r.aspectos.find((x) => x.clave === 'trato').a_mejorar, 1);
  assert.ok(r.ranking.length >= 1);
  const com = await entrar('valentina@demo.local');
  assert.equal((await com.llamar('GET', '/api/encuestas')).statusCode, 403, 'el comercial no ve las encuestas');
});

test('el pie del remito dice solo JustPrint como emisor', async () => {
  const head = await entrar('head.tecnico@demo.local');
  const { id } = (await head.llamar('POST', '/api/remitos/entrega', { cliente_id: cli.prueba, items: [{ insumo_id: insumo, cantidad: 1 }] })).json();
  const d = (await head.llamar('GET', `/api/remitos/${id}`)).json();
  assert.equal(d.emisor, 'JustPrint · CUIT 30-71646173-0');
});
