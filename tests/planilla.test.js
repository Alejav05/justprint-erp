import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import knexLib from 'knex';
import knexfile from '../knexfile.js';
import { seed as base } from '../seeds/01_base.js';
import { leerPlanilla } from '../src/importacion/lector.js';
import { importarPlanilla } from '../src/importacion/planilla.js';
import { interpretarFecha } from '../src/importacion/fechas.js';
import { hashear } from '../src/lib/passwords.js';
import { siguienteNumero } from '../src/lib/numeradores.js';

// Reloj de pared tal como lo muestra la hoja (exceljs lo trae como UTC).
const P = (s) => new Date(`${s}Z`);

async function planilla(ruta) {
  const libro = new ExcelJS.Workbook();
  const hoja = (nombre, titulos, filas) => {
    const h = libro.addWorksheet(nombre);
    h.addRow(titulos);
    filas.forEach((f) => h.addRow(f));
  };
  hoja('Usuarios', ['Email', 'Nombre', 'Rol'], [['ale@x.com', 'Alejandro', 'Admin'], ['walter@x.com', 'Walter', 'Admin']]);
  hoja('Asignaciones', ['Email_Vendedor', 'ID_Cliente'], []);
  hoja('Clientes', ['ID_Cliente', 'Razon_Social', 'Nombre_Comercial', 'CUIT', 'Direccion', 'Localidad', 'Telefono', 'Mail', 'Fecha_Alta', 'Estado'], [
    ['CL-01', 'Cliente Uno S.A.', 'Uno', '30-11111111-1', 'Calle 1', 'CABA', '4444-0000', null, P('2024-08-15T00:00:00'), 'Activo'],
    ['CL-02', 'Cliente Dos SRL', 'Dos', '30-22222222-2', 'Calle 2', 'Rosario', null, null, P('2025-01-10T00:00:00'), 'Activo'],
    ['CL-03', 'Cliente Prueba SA', 'Cliente Prueba', null, null, null, null, null, P('2026-09-14T20:57:18'), 'Inactivo'],
  ]);
  hoja('Contactos', ['ID_Contacto', 'ID_Cliente', 'Nombre', 'Rol', 'Telefono', 'Mail', 'Autorizado_Toner'], [
    ['CT-01', 'CL-01', 'Ana Gómez', 'IT-Sistemas', 1149365356, 'ANA@uno.com', 'Si'],
    ['CT-02', 'CL-03', 'Test', 'Usuario', null, null, 'No'],
  ]);
  hoja('Contratos', ['ID_Contrato', 'ID_Cliente', 'Nombre_Contrato', 'Moneda', 'Monto_Mensual', 'Franquicia_Negro', 'Franquicia_Color', 'Costo_Excedente_Negro', 'Costo_Excedente_Color', 'Fecha_Inicio', 'Duracion_Meses', 'Vigente'], [
    ['CN-01', 'CL-01', 'Contrato general', 'USD', 316, 3000, 1000, 0.018, 0.18, P('2024-08-14T17:00:00'), 24, 'Si'],
    ['CN-02', 'CL-02', 'Contrato general', 'ARS', 566904.59, 1000, 300, 32, 395, P('2025-01-10T00:00:00'), null, 'Si'],
    ['CN-03', 'CL-03', 'Prueba', 'USD', 100, 1000, 200, 0.02, 0.15, P('2026-07-31T17:00:00'), 12, 'Si'],
  ]);
  hoja('Equipos', ['ID_Equipo', 'ID_Cliente', 'ID_Contrato', 'N_Serie', 'Modelo', 'Fecha_Instalacion', 'Estado', 'Contador_Inicial_Negro', 'Contador_Inicial_Color', 'Observaciones', 'Direccion', 'Localidad'], [
    ['EQ-001', null, null, 'SER-DEP', 'Brother MFC-9970CDW', null, 'Deposito', 100, 200, null, null, null],
    ['EQ-002', 'CL-01', 'CN-01', 'SER-UNO', 'Konica Minolta C558', P('2024-08-14T17:00:00'), 'Activo', 317565, 10254, null, null, null],
    ['EQ-003', 'CL-02', 'CN-02', 'SER-DOS', 'Brother MFC-L6900DW', P('2025-01-10T00:00:00'), 'Activo', 5000, 0, null, null, null],
    ['EQ-004', 'CL-03', 'CN-03', 'PRUEBA-001', 'Cualquiera', P('2026-09-14T17:00:00'), 'Activo', 0, 0, null, null, null],
  ]);
  hoja('Contadores', ['ID_Lectura', 'ID_Equipo', 'Fecha', 'Contador_Negro', 'Contador_Color', 'Observaciones'], [
    ['L1', 'EQ-002', P('2024-08-30T20:00:00'), 317992, 10692, null],
    ['L2', 'EQ-002', P('2024-11-29T19:00:00'), 321433, 13327, null],
    ['L3', 'EQ-002', P('2025-02-27T19:00:00'), 324516, 16489, null],
    ['L4', 'EQ-004', P('2026-08-30T17:00:00'), 1500, 250, null],
  ]);
  hoja('Servicios_Tecnicos', ['ID_Ticket', 'Fecha', 'ID_Cliente', 'ID_Equipo', 'Tipo', 'Descripcion', 'Estado', 'Responsable'], [
    ['TK-2', P('2026-09-16T13:37:05'), 'CL-02', 'EQ-003', 'Falla', 'Atasco de papel', 'Resuelto', 'Alejandro'],
    ['TK-1', P('2026-09-15T07:00:00'), 'CL-01', 'EQ-002', 'Toner', null, 'Abierto', 'Fulano'],
    ['TK-X', P('2026-09-15T07:00:00'), 'CL-03', 'EQ-004', 'Falla', 'Prueba', 'Abierto', 'Alejandro'],
  ]);
  hoja('Insumos', ['ID_Insumo', 'SKU', 'Nombre', 'Costo_Unitario', 'Moneda', 'Stock_Actual'], [
    ['INS-1', 'TN-1', 'Toner negro', 10.5, 'USD', 2],
    ['INS-2', 'DR-1', 'Unidad de imagen', 250, 'USD', -1],
  ]);
  hoja('Movimientos_Insumos', ['ID_Movimiento', 'ID_Insumo', 'Fecha', 'Tipo', 'Cantidad', 'Motivo', 'Usuario'], [
    ['M1', 'INS-1', P('2026-09-15T08:00:00'), 'Entrada', 3, 'Carga inicial', 'Alejandro'],
    ['M2', 'INS-1', P('2026-09-16T08:00:00'), 'Salida', 1, 'Entregado', 'Alejandro'],
    ['M3', 'INS-2', P('2026-09-16T09:00:00'), 'Salida', 1, 'Entregado', 'Alejandro'],
  ]);
  hoja('Remitos', ['Items', 'ID_Remito', 'Numero', 'Fecha', 'ID_Cliente', 'Tipo', 'Detalle', 'Cantidad', 'Contador_Inicial_Negro', 'Contador_Inicial_Color', 'Direccion_Entrega', 'Localidad_Entrega', 'Link_Firma', 'Link_PDF', 'Nombre_Firmante'], [
    [JSON.stringify([{ tipo: 'Insumo', detalle: 'TN-1 — Toner negro', cantidad: 2, idInsumo: 'INS-1' }]), 'REM-3', 201, P('2026-09-17T15:00:00'), 'CL-01', 'Insumo', null, null, null, null, 'Calle 1', 'CABA', null, null, null],
    [null, 'REM-2', 202, P('2026-09-17T05:00:00'), 'CL-01', 'Equipo', 'SER-UNO — Konica Minolta C558', 1, 0, 0, 'Calle 1', 'CABA', 'https://drive/firma', 'https://drive/pdf', 'Ana Gómez'],
    [null, 'REM-9', 209, P('2026-09-28T14:00:00'), 'CL-03', 'Equipo', 'PRUEBA-001 — Cualquiera', 1, 0, 0, null, null, null, null, null],
  ]);
  hoja('Costos', ['ID_Costo', 'ID_Cliente', 'ID_Equipo', 'ID_Ticket', 'ID_Insumo', 'Tipo', 'Moneda', 'Monto', 'Cotizacion_Usada', 'Monto_USD', 'Fecha', 'Descripcion'], [
    ['CO-1', 'CL-01', 'EQ-002', null, null, 'Mano_Obra', 'ARS', 45000, 1530, 29.41, P('2026-09-13T17:00:00'), 'Revisión'],
    ['CO-2', 'CL-03', 'EQ-004', null, null, 'Insumo', 'USD', 10, 1530, 10, P('2026-09-13T17:00:00'), 'Prueba'],
  ]);
  const F = (id, ct, cl, per, usd, cot, ars, fe, est, por) => [id, ct, cl, per, usd, cot, ars, fe, est, por, null];
  hoja('Facturas', ['ID_Factura', 'ID_Contrato', 'ID_Cliente', 'Periodo', 'Monto_USD', 'Cotizacion_Usada', 'Monto_ARS', 'Fecha_Emision', 'Estado', 'Facturada_Por', 'Link_Comprobante'], [
    F('FC-1', 'CN-01', 'CL-01', '2026-08', 115.065, 1530, 176049.45, P('2026-09-15T06:58:00'), 'Pagada', 'EUROPA HAUS S.A.S.'),
    F('FC-2', 'CN-01', 'CL-01', '2026-09', 316, 1550, 489800, null, 'Pendiente', null),
    F('FC-3', 'CN-02', 'CL-02', '2026-08', 560, 1000, 560000, P('2026-09-20T20:00:00'), 'Pagada', 'Europa Haus SAS'),
    F('FC-4', 'CN-02', 'CL-02', '2026-07', 500, 1000, 500000, P('2026-09-20T20:00:00'), 'Pagada', 'Justprint'),
    F('FC-5', 'CN-03', 'CL-03', '2026-08', 100, 1530, 153000, P('2026-09-15T06:58:00'), 'Pagada', 'Empresa amiga SRL'),
  ]);
  await libro.xlsx.writeFile(ruta);
}

let db; let ruta;
beforeEach(async () => {
  db = knexLib(knexfile.test);
  await db.migrate.latest();
  await base(db);
  await db('usuarios').insert({ nombre: 'Alejandro Iglesias', email: 'ale@x.com', password_hash: await hashear('Clave-Segura-2026'), rol_id: (await db('roles').where({ nombre: 'direccion' }).first()).id });
  ruta = join(tmpdir(), `planilla-${process.pid}-${Date.now()}.xlsx`);
  await planilla(ruta);
});
afterEach(async () => { await db.destroy(); });

const importar = async (opts = {}) => importarPlanilla(db, await leerPlanilla(ruta), opts);
const n = async (t) => Number((await db(t).count({ n: '*' }).first()).n);

test('las fechas con corrimiento de huso vuelven al día que se cargó', () => {
  assert.equal(interpretarFecha(P('2024-08-30T20:00:00')).fecha, '2024-08-31');
  assert.equal(interpretarFecha(P('2024-11-29T19:00:00')).fecha, '2024-11-30');
  assert.equal(interpretarFecha(P('2025-02-27T19:00:00')).fecha, '2025-02-28');
  assert.equal(interpretarFecha(P('2024-08-14T17:00:00')).fecha, '2024-08-15');
  assert.equal(interpretarFecha(P('2023-08-31T00:00:00')).fecha, '2023-08-31', 'una fecha tipeada a mano no se toca');
  assert.equal(interpretarFecha(null), null);
});

test('el ensayo informa pero no guarda nada, ni siquiera la numeración', async () => {
  const inf = await importar();
  assert.equal(inf.aplicado, false);
  assert.equal(inf.tablas.clientes, 2);
  assert.equal(await n('clientes'), 0);
  assert.equal(await n('facturas'), 0);
  assert.equal((await db('numeradores').where({ clave: 'remito' }).first()).ultimo, 0);
});

test('la cuenta de pruebas queda afuera, con todo lo que cuelga de ella', async () => {
  const inf = await importar({ aplicar: true });
  assert.equal(inf.aplicado, true);
  assert.deepEqual((await db('clientes').orderBy('id')).map((c) => c.razon_social), ['Cliente Uno S.A.', 'Cliente Dos SRL']);
  assert.equal(await n('contratos'), 2);
  assert.equal(await n('facturas'), 4);
  assert.equal(await n('tickets'), 2);
  assert.equal(await n('costos'), 1);
  assert.equal(await n('contactos'), 1);
  assert.equal(await db('equipos').where({ numero_serie: 'PRUEBA-001' }).first(), undefined);
  assert.match(inf.excluidos[0], /Cliente Prueba/);
});

test('con --incluir-prueba entra todo', async () => {
  await importar({ aplicar: true, incluirPrueba: true });
  assert.equal(await n('clientes'), 3);
  assert.equal(await n('facturas'), 5);
});

test('sedes: la zona sale de la localidad, y los contactos quedan listos para el CRM', async () => {
  await importar({ aplicar: true });
  const sedes = await db('sedes').join('clientes', 'clientes.id', 'sedes.cliente_id').select('razon_social', 'zona');
  assert.deepEqual(sedes.map((s) => s.zona), ['caba', 'resto']);
  const c = await db('contactos').first();
  assert.equal(c.nombre, 'Ana Gómez');
  assert.deepEqual(JSON.parse(c.roles), ['it']);
  assert.equal(JSON.parse(c.telefonos)[0].numero, '1149365356');
  assert.equal(JSON.parse(c.emails)[0].direccion, 'ana@uno.com');
  assert.ok(c.autorizado_toner);
  assert.match((await db('clientes').first()).notas, /4444-0000/);
});

test('los precios por página conservan sus decimales', async () => {
  await importar({ aplicar: true });
  const cond = await db('contrato_condiciones').orderBy('id');
  assert.equal(Number(cond[0].excedente_negro), 0.018);
  assert.equal(Number(cond[0].excedente_color), 0.18);
  assert.equal(Number(cond[1].excedente_negro), 32);
});

test('las lecturas de fin de mes caen en el último día del mes', async () => {
  await importar({ aplicar: true });
  const f = (await db('lecturas_contador').orderBy('fecha')).map((l) => l.fecha);
  assert.deepEqual(f, ['2024-08-31', '2024-11-30', '2025-02-28']);
  assert.ok((await db('lecturas_contador')).every((l) => l.origen === 'importacion'));
});

test('el equipo instalado queda asignado a su contrato con el contador de partida; el de depósito, no', async () => {
  await importar({ aplicar: true });
  const a = await db('asignaciones_equipo').join('equipos', 'equipos.id', 'equipo_id').select('numero_serie', 'desde', 'hasta', 'contador_inicial_negro');
  assert.deepEqual(a.map((x) => x.numero_serie).sort(), ['SER-DOS', 'SER-UNO']);
  const uno = a.find((x) => x.numero_serie === 'SER-UNO');
  assert.equal(uno.desde, '2024-08-15');
  assert.equal(uno.hasta, null);
  assert.equal(uno.contador_inicial_negro, 317565);
  assert.equal((await db('equipos').where({ numero_serie: 'SER-DEP' }).first()).estado, 'deposito');
  const tipos = Object.fromEntries((await db('modelos_equipo')).map((m) => [m.modelo, m.tipo]));
  assert.equal(tipos['MFC-9970CDW'], 'color');
  assert.equal(tipos['C558'], 'color');
  assert.equal(tipos['MFC-L6900DW'], 'monocromo');
});

test('facturado y cobrado quedan separados: pagada = factura cobrada + cobro aplicado; pendiente = borrador', async () => {
  const inf = await importar({ aplicar: true });
  const f = await db('facturas').orderBy('id');
  assert.deepEqual(f.map((x) => x.estado), ['cobrada', 'borrador', 'cobrada', 'cobrada']);
  assert.ok(f[0].fecha_emision_estimada && f[0].fecha_emision === '2026-08-31', 'fecha estimada = fin del período');
  assert.equal(f[1].fecha_emision, null);
  assert.equal(Number(f[0].neto), 115.07);
  assert.equal(Number(f[0].iva), 24.16);
  assert.equal(Number(f[0].total), 139.23);
  assert.equal(f[2].moneda, 'ARS');
  assert.equal(Number(f[2].neto), 560000);
  assert.equal(Number(f[2].total), 677600);
  assert.equal(Number(f[2].neto_usd), 560, 'la referencia en USD de una factura en pesos es la de la planilla');
  assert.equal(await n('cobros'), 3);
  const aplicado = await db('cobro_aplicaciones').sum({ s: 'importe' }).first();
  assert.equal(Math.round(Number(aplicado.s) * 100), 139.23 * 100 + 677600 * 100 + 605000 * 100);
  assert.ok(inf.preguntas.some((p) => /FC-2/.test(p) && /borrador/.test(p)));
});

test('las entidades facturantes se unifican aunque estén escritas distinto', async () => {
  const inf = await importar({ aplicar: true });
  const e = await db('entidades_facturantes');
  assert.deepEqual(e.map((x) => x.razon_social), ['Europa Haus S.A.S.']);
  const ct = await db('contratos').orderBy('id');
  assert.ok(ct.every((c) => c.entidad_facturante_id === e[0].id));
  assert.ok(inf.preguntas.some((p) => /Justprint/.test(p)));
});

test('los remitos conservan su número, y el siguiente continúa la serie incluso contando los excluidos', async () => {
  await importar({ aplicar: true });
  assert.deepEqual((await db('remitos').orderBy('numero')).map((r) => [r.numero, r.estado]), [['00201', 'emitido'], ['00202', 'firmado']]);
  const items = await db('remito_items').join('remitos', 'remitos.id', 'remito_id').orderBy('numero');
  assert.equal(items[0].descripcion, 'TN-1 — Toner negro');
  assert.equal(items[0].cantidad, 2);
  assert.ok(items[0].insumo_id);
  assert.ok(items[1].equipo_id, 'el ítem de equipo se vincula por número de serie');
  assert.match((await db('remitos').where({ numero: '00202' }).first()).observaciones, /Firmó: Ana Gómez/);
  assert.equal(await db.transaction((t) => siguienteNumero(t, 'remito')), '00210');
});

test('los tickets se numeran en orden cronológico y se atribuyen por nombre cuando hay usuario', async () => {
  const inf = await importar({ aplicar: true });
  const t = await db('tickets').orderBy('numero');
  assert.deepEqual(t.map((x) => x.numero), ['T-0001', 'T-0002']);
  assert.equal(t[0].asunto, 'Toner', 'sin descripción se usa el tipo');
  assert.equal(t[0].estado, 'abierto');
  assert.equal(t[0].asignado_a, null, 'Fulano no existe como usuario');
  assert.equal(t[1].estado, 'cerrado');
  assert.ok(t[1].asignado_a, 'Alejandro coincide con Alejandro Iglesias');
  assert.ok(inf.avisos.some((a) => /Fulano/.test(a)));
});

test('el stock negativo se carga tal cual y se pregunta; el que cierra no genera ajustes', async () => {
  const inf = await importar({ aplicar: true });
  assert.equal(await db('movimientos_insumo').where({ tipo: 'ajuste' }).first(), undefined);
  assert.ok(inf.preguntas.some((p) => /DR-1/.test(p)));
});

test('si el stock de la planilla no coincide con los movimientos, se agrega un ajuste', async () => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(ruta);
  libro.getWorksheet('Insumos').getRow(2).getCell(6).value = 5; // movimientos dan 2
  await libro.xlsx.writeFile(ruta);
  await importar({ aplicar: true });
  const aj = await db('movimientos_insumo').where({ tipo: 'ajuste' });
  assert.equal(aj.length, 1);
  assert.equal(aj[0].cantidad, 3);
});

test('no corre sobre una base con clientes ni sin los datos base, y no deja nada a medias', async () => {
  await importar({ aplicar: true });
  await assert.rejects(importar({ aplicar: true }), /base vacía/);
  assert.equal(await n('clientes'), 2);

  const otra = knexLib(knexfile.test);
  await otra.migrate.latest();
  await assert.rejects(importarPlanilla(otra, await leerPlanilla(ruta), { aplicar: true }), /seed:base/);
  await otra.destroy();
});

test('la importación queda en la auditoría', async () => {
  await importar({ aplicar: true });
  const a = await db('audit_log').where({ tabla: 'importacion' }).first();
  assert.ok(a);
  assert.ok(JSON.parse(a.despues).tablas.facturas === 4);
});

test('las decisiones del dueño se aplican: CUIT, facturas emitidas o cobradas, stock en cero', async () => {
  const decisiones = {
    entidades: { 'Europa Haus S.A.S.': { cuit: '30-71646173-0', activa: true } },
    facturas: { 'FC-2': { estado: 'emitida' } },
    regularizarStockNegativo: true,
  };
  const inf = await importar({ aplicar: true, decisiones });
  const e = await db('entidades_facturantes').first();
  assert.equal(e.cuit, '30-71646173-0');
  const f2 = await db('facturas').where({ periodo: '2026-09', cliente_id: (await db('clientes').where({ razon_social: 'Cliente Uno S.A.' }).first()).id }).first();
  assert.equal(f2.estado, 'emitida');
  assert.equal(f2.fecha_emision, '2026-09-30');
  assert.ok(f2.entidad_facturante_id, 'toma la entidad que usa su contrato');
  assert.equal(await db('cobros').where({ cliente_id: f2.cliente_id }).count({ n: '*' }).first().then((r) => Number(r.n)), 1, 'una emitida no genera cobro');
  const stock = await db('movimientos_insumo').join('insumos', 'insumos.id', 'insumo_id').where({ codigo: 'DR-1' }).select('movimientos_insumo.tipo', 'movimientos_insumo.cantidad');
  assert.equal(stock.reduce((s, m) => s + (m.tipo === 'entrada' ? m.cantidad : m.tipo === 'salida' ? -m.cantidad : m.cantidad), 0), 0);
  assert.ok(!inf.preguntas.some((p) => /DR-1|FC-2|CUIT/.test(p)));
});

test('una factura puede mezclar abono con venta directa de equipo, insumo y soporte', async () => {
  await importar({ aplicar: true });
  const cliente = await db('clientes').first();
  const insumo = await db('insumos').first();
  const equipo = await db('equipos').first();
  const [fid] = await db('facturas').insert({ cliente_id: cliente.id, periodo: '2026-10', moneda: 'USD', neto: 1000, iva: 210, total: 1210, estado: 'borrador' });
  await db('factura_items').insert([
    { factura_id: fid, tipo: 'abono', descripcion: 'Abono octubre', cantidad: 1, precio_unitario: 316, alicuota_iva: 21, subtotal: 316 },
    { factura_id: fid, tipo: 'insumo', insumo_id: insumo.id, descripcion: 'Toner negro', cantidad: 2, precio_unitario: 50, alicuota_iva: 21, subtotal: 100 },
    { factura_id: fid, tipo: 'equipo', equipo_id: equipo.id, descripcion: 'Venta de equipo', cantidad: 1, precio_unitario: 484, alicuota_iva: 21, subtotal: 484 },
    { factura_id: fid, tipo: 'servicio', descripcion: 'Soporte fuera de abono', cantidad: 1, precio_unitario: 100, alicuota_iva: 21, subtotal: 100 },
  ]);
  const items = await db('factura_items').where({ factura_id: fid });
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((i) => i.tipo), ['abono', 'insumo', 'equipo', 'servicio']);
  assert.equal(items.reduce((s, i) => s + Number(i.subtotal), 0), 1000);
});

test('alias de entidad: "Empresa amiga" se unifica con Europa Haus y no queda como entidad', async () => {
  await importar({ aplicar: true, incluirPrueba: true, decisiones: { aliasEntidades: { 'Empresa amiga SRL': 'Europa Haus S.A.S.' } } });
  assert.deepEqual((await db('entidades_facturantes')).map((e) => e.razon_social), ['Europa Haus S.A.S.']);
});

test('un contrato en pesos conserva la referencia en dólares de cada factura y guarda la cotización usada', async () => {
  await importar({ aplicar: true });
  const ars = await db('facturas').where({ moneda: 'ARS' });
  assert.ok(ars.length && ars.every((f) => f.neto_usd != null && f.tipo_cambio != null));
  const usd = await db('facturas').where({ moneda: 'USD' });
  assert.ok(usd.every((f) => Number(f.neto_usd) === Number(f.neto)));
  assert.ok(await db('cotizaciones_usd').first());
  const cond = await db('contrato_condiciones').join('contratos', 'contratos.id', 'contrato_id').where({ moneda: 'USD' }).first();
  assert.equal(Number(cond.monto_usd_referencia), 316);
});

test('un contrato sin facturar queda como un período de la historia de condiciones, sin perder los términos', async () => {
  await importar({ aplicar: true, decisiones: { contratosSinFacturar: { 'CN-02': { desde: '2026-10-01', motivo: 'Acuerdo comercial' } } } });
  const id = (await db('contratos').where({ nombre: 'Contrato general', moneda: 'ARS' }).first()).id;
  const c = await db('contrato_condiciones').where({ contrato_id: id }).orderBy('vigente_desde');
  assert.equal(c.length, 2);
  assert.equal(c[0].vigente_hasta, '2026-09-30');
  assert.ok(c[0].facturable);
  assert.equal(c[1].facturable, 0);
  assert.equal(c[1].motivo, 'sin_facturar');
  assert.equal(c[1].notas, 'Acuerdo comercial');
  assert.equal(Number(c[1].monto_mensual), Number(c[0].monto_mensual));
});

test('un contrato que se cobra sin comprobante no se simula como factura: sin IVA, sin entidad, no facturable', async () => {
  await importar({ aplicar: true, decisiones: { contratosSinComprobante: ['CN-02'] } });
  const ct = await db('contratos').where({ moneda: 'ARS' }).first();
  const cond = await db('contrato_condiciones').where({ contrato_id: ct.id }).first();
  assert.equal(cond.facturable, 0);
  assert.equal(cond.motivo, 'sin_facturar');
  const f = await db('facturas').where({ contrato_id: ct.id });
  assert.ok(f.length && f.every((x) => Number(x.iva) === 0 && Number(x.total) === Number(x.neto) && x.entidad_facturante_id === null));
  assert.ok(f.every((x) => Number(x.neto_usd) > 0), 'la referencia en USD se conserva');
  assert.equal((await db('cobros').where({ cliente_id: f[0].cliente_id }).count({ n: '*' }).first()).n, f.length, 'los cobros se registran igual');
});
