import { hashear } from '../src/lib/passwords.js';
import { hoy } from '../src/lib/fechas.js';

export const CLAVE_DEMO = process.env.DEMO_PASSWORD || 'Demo-JustPrint-2026';

/**
 * Datos de ejemplo para desarrollo y pruebas. Nunca corre en producción.
 * Personas y empresas son ficticias (salvo los nombres de cliente que ya usabas como prueba).
 */
export async function seed(knex) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Las semillas de demostración no se pueden ejecutar en producción.');
  }
  if (await knex('usuarios').first()) return; // ya cargado

  const hash = await hashear(CLAVE_DEMO);
  const rol = async (nombre) => (await knex('roles').where({ nombre }).first()).id;
  const area = async (nombre) => (await knex('areas').where({ nombre }).first()).id;

  const personas = [
    ['Alejandro (Dirección)', 'direccion@demo.local', 'direccion', [['Dirección', 'lider', 'todo']]],
    ['Camila (Head comercial)', 'head.comercial@demo.local', 'head_comercial', [['Comercial', 'lider', 'equipo']]],
    ['Nicolás (Comercial)', 'nicolas@demo.local', 'comercial', [['Comercial', 'miembro', 'propio']]],
    ['Valentina (Comercial)', 'valentina@demo.local', 'comercial', [['Comercial', 'miembro', 'propio']]],
    ['Martín (Head técnico)', 'head.tecnico@demo.local', 'head_tecnico', [['Técnica', 'lider', 'equipo']]],
    ['Matías (Técnico)', 'matias@demo.local', 'tecnico', [['Técnica', 'miembro', 'propio']]],
    ['Lucía (Técnica)', 'lucia@demo.local', 'tecnico', [['Técnica', 'miembro', 'propio']]],
    ['Paula (Head atención)', 'head.atencion@demo.local', 'head_atencion', [['Atención', 'lider', 'todo']]],
    ['Sofía (Atención)', 'sofia@demo.local', 'atencion', [['Atención', 'miembro', 'todo']]],
    ['Julia (Facturación)', 'julia@demo.local', 'facturacion', [['Finanzas', 'miembro', 'todo']]],
  ];
  const u = {};
  for (const [nombre, email, r, areas] of personas) {
    const [id] = await knex('usuarios').insert({ nombre, email, password_hash: hash, rol_id: await rol(r) });
    u[email.split('@')[0]] = id;
    for (const [a, funcion, alcance] of areas) {
      await knex('usuario_area').insert({ usuario_id: id, area_id: await area(a), funcion, alcance });
    }
  }

  const h = hoy();
  const cliente = async (razon, estado, rubro) => (await knex('clientes').insert({ razon_social: razon, nombre_comercial: razon, estado, rubro, fecha_alta: h }))[0];
  const c = {
    prueba: await cliente('Cliente Prueba SRL', 'activo', 'Servicios'),
    juju: await cliente('The Juju', 'activo', 'Agencia'),
    farmacia: await cliente('Farmacia Central', 'activo', 'Farmacia'),
    g866: await cliente('Grupo 8.66', 'activo', 'Servicios'),
    rios: await cliente('Estudio Contable Ríos', 'prospecto', 'Contable'),
  };

  // Carteras: Nicolás tiene Prueba y Juju; Valentina, Farmacia y Grupo 8.66. El prospecto queda sin responsable.
  const cartera = [[c.prueba, u.nicolas], [c.juju, u.nicolas], [c.farmacia, u.valentina], [c.g866, u.valentina]];
  for (const [cliente_id, usuario_id] of cartera) {
    await knex('cartera_asignaciones').insert({ cliente_id, usuario_id, desde: '2026-01-01', asignado_por: u['head.comercial'], motivo: 'Asignación inicial' });
  }

  const sedes = {};
  for (const [k, id] of Object.entries(c)) {
    [sedes[k]] = await knex('sedes').insert({ cliente_id: id, nombre: 'Sede principal', zona: 'caba', es_principal: true });
  }

  await knex('contactos').insert({
    cliente_id: c.prueba, sede_id: sedes.prueba, nombre: 'Marcela Duarte', cargo: 'Administración',
    roles: JSON.stringify(['decisor']), telefonos: JSON.stringify([{ tipo: 'celular', numero: '1145678901' }]),
    emails: JSON.stringify([{ tipo: 'trabajo', direccion: 'marcela@clienteprueba.com.ar' }]),
    autorizado_toner: true, acepta_comunicaciones: true, consentimiento_fecha: '2026-03-12', consentimiento_origen: 'formulario web',
    fechas_clave: JSON.stringify([{ tipo: 'cumpleaños', fecha: '11-03', recordar: true }]),
  });

  const abonos = { prueba: 340, juju: 275, farmacia: 180, g866: 610 };
  const entidad = (await knex('entidades_facturantes').insert({ razon_social: 'Europa Haus S.A.S.', cuit: '30-00000000-0', punto_venta: 1 }))[0];
  const contratos = {};
  for (const [k, monto] of Object.entries(abonos)) {
    [contratos[k]] = await knex('contratos').insert({
      cliente_id: c[k], sede_id: sedes[k], nombre: `Contrato ${k}`, estado: 'vigente', fecha_inicio: '2026-01-01',
      duracion_meses: 12, moneda: 'USD', entidad_facturante_id: entidad,
    });
    await knex('contrato_condiciones').insert({
      contrato_id: contratos[k], vigente_desde: '2026-01-01', monto_mensual: monto,
      franquicia_negro: 3000, franquicia_color: 500, excedente_negro: 0.02, excedente_color: 0.09,
    });
  }

  const [modelo] = await knex('modelos_equipo').insert({ marca: 'Brother', modelo: 'HL-L8360', tipo: 'color' });
  const [equipo] = await knex('equipos').insert({ modelo_id: modelo, numero_serie: 'PRUEBA-003', codigo_qr: 'JP-PRUEBA-003', estado: 'instalado' });
  await knex('asignaciones_equipo').insert({ equipo_id: equipo, contrato_id: contratos.prueba, sede_id: sedes.prueba, desde: '2026-01-05' });

  // Tickets: Matías atiende uno de Cliente Prueba; Lucía uno de The Juju; el de Farmacia no tiene técnico.
  const ticket = async (numero, cliente_id, asunto, asignado_a, estado) => knex('tickets').insert({
    numero, cliente_id, asunto, asignado_a, estado, creado_por: u.sofia,
  });
  await ticket('T-0412', c.prueba, 'Atasco de papel en bandeja 2', u.matias, 'en_curso');
  await ticket('T-0409', c.juju, 'Manchas en impresión color', u.lucia, 'asignado');
  await ticket('T-0411', c.farmacia, 'Pedido de tóner negro', null, 'abierto');
}
