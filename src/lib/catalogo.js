// Catálogo base: permisos, roles, áreas y reglas de alerta.
// Lo usan las semillas y las pruebas, así hay una sola fuente de verdad.

export const AREA = {
  ATENCION: 'Atención',
  TECNICA: 'Técnica',
  COMERCIAL: 'Comercial',
  FINANZAS: 'Finanzas',
  DIRECCION: 'Dirección',
};

export const PERMISOS = [
  ['clientes.ver', 'clientes', 'Ver clientes dentro de su alcance'],
  ['clientes.editar', 'clientes', 'Crear y editar clientes'],
  ['contactos.ver', 'clientes', 'Ver contactos'],
  ['contactos.editar', 'clientes', 'Crear y editar contactos'],
  ['crm.gestionar', 'clientes', 'Gestionar interacciones, tareas y oportunidades'],
  ['cartera.asignar', 'clientes', 'Asignar y reasignar cuentas a comerciales'],
  ['leads.ver', 'clientes', 'Ver el tablero de Hunting con sus propios leads'],
  ['leads.editar', 'clientes', 'Crear leads, moverlos de etapa y convertirlos en clientes'],
  ['leads.todos', 'clientes', 'Ver y gestionar los leads de todo el equipo'],
  ['contratos.ver', 'contratos', 'Ver contratos'],
  ['contratos.editar', 'contratos', 'Crear y editar contratos y condiciones'],
  ['importes.ver', 'finanzas', 'Ver importes: abonos, facturas y cobros'],
  ['facturas.emitir', 'finanzas', 'Generar y emitir facturas'],
  ['cobros.registrar', 'finanzas', 'Registrar cobros y aplicarlos'],
  ['costos.ver', 'finanzas', 'Ver costos y rentabilidad'],
  ['cobranzas.gestionar', 'finanzas', 'Gestionar cobranzas: reclamar, registrar gestiones y escalar al comercial'],
  ['cobranzas.escaladas', 'finanzas', 'Ver y gestionar las facturas que cobranzas le pasó al comercial'],
  ['tickets.ver', 'servicio', 'Ver tickets'],
  ['tickets.crear', 'servicio', 'Crear tickets'],
  ['tickets.atender', 'servicio', 'Atender y cerrar tickets'],
  ['tickets.asignar', 'servicio', 'Asignar tickets y visitas'],
  ['partes.editar', 'servicio', 'Cargar partes técnicos'],
  ['remitos.crear', 'servicio', 'Crear remitos'],
  ['equipos.ver', 'equipos', 'Ver equipos y su historial'],
  ['equipos.editar', 'equipos', 'Crear y editar equipos'],
  ['insumos.ver', 'insumos', 'Ver insumos y stock'],
  ['insumos.mover', 'insumos', 'Registrar movimientos de insumos'],
  ['tableros.direccion', 'analitica', 'Ver el tablero de Dirección'],
  ['tableros.servicio', 'analitica', 'Ver el tablero de Servicio: SLA, carga y reincidencias'],
  ['reportes.equipo', 'analitica', 'Ver indicadores de las personas de su equipo'],
  ['alertas.configurar', 'sistema', 'Configurar reglas de alerta'],
  ['sistema.configurar', 'sistema', 'Configurar el sistema: valores, módulos y permisos por rol'],
  ['usuarios.administrar', 'sistema', 'Administrar usuarios, roles y áreas'],
  ['auditoria.ver', 'sistema', 'Ver el registro de auditoría'],
];

const TODOS = PERMISOS.map((p) => p[0]);

export const ROLES = {
  direccion: { descripcion: 'Dirección: acceso total', permisos: TODOS },
  head_comercial: {
    descripcion: 'Líder del área comercial',
    permisos: ['clientes.ver', 'clientes.editar', 'contactos.ver', 'contactos.editar', 'crm.gestionar', 'cartera.asignar',
      'contratos.ver', 'contratos.editar', 'importes.ver', 'tickets.ver', 'equipos.ver', 'reportes.equipo', 'cobranzas.escaladas',
      'leads.ver', 'leads.editar', 'leads.todos'],
  },
  comercial: {
    descripcion: 'Comercial con cartera propia',
    permisos: ['clientes.ver', 'clientes.editar', 'contactos.ver', 'contactos.editar', 'crm.gestionar', 'contratos.ver',
      'importes.ver', 'tickets.ver', 'equipos.ver', 'cobranzas.escaladas', 'leads.ver', 'leads.editar'],
  },
  head_atencion: {
    descripcion: 'Líder de atención al cliente',
    permisos: ['clientes.ver', 'contactos.ver', 'contactos.editar', 'tickets.ver', 'tickets.crear', 'tickets.atender',
      'tickets.asignar', 'insumos.ver', 'insumos.mover', 'equipos.ver', 'reportes.equipo', 'tableros.servicio'],
  },
  atencion: {
    descripcion: 'Atención al cliente',
    permisos: ['clientes.ver', 'contactos.ver', 'contactos.editar', 'tickets.ver', 'tickets.crear', 'insumos.ver',
      'insumos.mover', 'equipos.ver'],
  },
  head_tecnico: {
    descripcion: 'Líder del área técnica',
    permisos: ['clientes.ver', 'contactos.ver', 'tickets.ver', 'tickets.atender', 'tickets.asignar', 'partes.editar',
      'remitos.crear', 'insumos.ver', 'insumos.mover', 'equipos.ver', 'equipos.editar', 'reportes.equipo', 'tableros.servicio'],
  },
  tecnico: {
    descripcion: 'Técnico de servicio',
    permisos: ['tableros.servicio', 'clientes.ver', 'contactos.ver', 'tickets.ver', 'tickets.atender', 'partes.editar', 'remitos.crear',
      'insumos.ver', 'insumos.mover', 'equipos.ver'],
  },
  facturacion: {
    descripcion: 'Facturación y cobranzas',
    permisos: ['clientes.ver', 'contactos.ver', 'contratos.ver', 'importes.ver', 'facturas.emitir', 'cobros.registrar',
      'costos.ver', 'cobranzas.gestionar'],
  },
};

// Feriados nacionales 2026 (fuente: argentina.travel). Los puentes turísticos son optativos para el sector privado:
// quedan cargados pero sin saltear en el SLA. Se editan desde la tabla `feriados`; cada año hay que cargar los nuevos.
export const FERIADOS = [
  ['2026-01-01', 'Año Nuevo'], ['2026-02-16', 'Carnaval'], ['2026-02-17', 'Carnaval'],
  ['2026-03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia'], ['2026-04-02', 'Día del Veterano y de los Caídos en Malvinas'],
  ['2026-04-03', 'Viernes Santo'], ['2026-05-01', 'Día del Trabajo'], ['2026-05-25', 'Día de la Revolución de Mayo'],
  ['2026-06-15', 'Paso a la Inmortalidad del Gral. Güemes (trasladado)'], ['2026-06-20', 'Paso a la Inmortalidad del Gral. Belgrano'],
  ['2026-07-09', 'Día de la Independencia'], ['2026-08-17', 'Paso a la Inmortalidad del Gral. San Martín'],
  ['2026-10-12', 'Día del Respeto a la Diversidad Cultural'], ['2026-11-23', 'Día de la Soberanía Nacional (trasladado)'],
  ['2026-12-08', 'Inmaculada Concepción de María'], ['2026-12-25', 'Navidad'],
];
export const PUENTES = [
  ['2026-03-23', 'Día no laborable con fines turísticos'], ['2026-07-10', 'Día no laborable con fines turísticos'],
  ['2026-12-07', 'Día no laborable con fines turísticos'],
];

// Horas comprometidas para resolver un ticket según la zona de la sede.
export const SLA_HORAS = { caba: 24, resto: 48 };

export const NUMERADORES = [
  { clave: 'ticket', prefijo: 'T-', ancho: 4 },
  { clave: 'remito', prefijo: '', ancho: 5 },
];

export const REGLAS_ALERTA = [
  ['ticket_por_vencer', 2, 'horas', ['asignado', 'lider_area'], 'Ticket por vencer su SLA'],
  ['ticket_vencido', null, null, ['lider_tecnica', 'lider_atencion'], 'Ticket vencido'],
  ['contrato_por_vencer_90', 90, 'dias', ['comercial_responsable', 'lider_comercial'], 'Contrato vence en 90 días'],
  ['contrato_por_vencer_60', 60, 'dias', ['comercial_responsable', 'lider_comercial'], 'Contrato vence en 60 días'],
  ['contrato_por_vencer_30', 30, 'dias', ['comercial_responsable', 'lider_comercial'], 'Contrato vence en 30 días'],
  ['contrato_sin_factura', null, null, ['facturacion'], 'Contrato sin factura del período'],
  ['margen_negativo', null, null, ['direccion', 'comercial_responsable'], 'Margen negativo de un cliente'],
  ['stock_bajo_minimo', null, null, ['atencion', 'tecnica'], 'Stock bajo el mínimo'],
  ['lead_sin_contacto', 24, 'horas', ['comercial_responsable'], 'Lead sin primer contacto'],
];

/** Etapas del tablero de Hunting, en orden. Las dos últimas cierran el lead. */
export const ETAPAS_LEAD = [
  ['nuevo', 'Nuevo'], ['contactado', 'Contactado'], ['reunion', 'Reunión'], ['propuesta', 'Propuesta'],
  ['negociacion', 'Negociación'], ['ganado', 'Ganado'], ['perdido', 'Perdido'],
];

/** Roles que puede cumplir un contacto del cliente. */
export const ROLES_CONTACTO = ['decisor', 'comercial', 'compras', 'administracion', 'facturacion', 'cobranzas', 'it', 'tecnico', 'usuario'];

/** Rubros y subrubros base. Dirección los puede editar desde Configuración. */
export const RUBROS = {
  'Salud': ['Clínicas y sanatorios', 'Consultorios y centros médicos', 'Laboratorios y diagnóstico', 'Odontología', 'Farmacias', 'Salud mental y kinesiología'],
  'Educación': ['Colegios', 'Universidades e institutos', 'Capacitación y academias', 'Jardines de infantes'],
  'Servicios profesionales': ['Estudios contables', 'Estudios jurídicos', 'Consultoras', 'Arquitectura e ingeniería', 'Escribanías', 'Agencias de marketing y diseño'],
  'Comercio': ['Retail y tiendas', 'Mayoristas y distribuidoras', 'E-commerce', 'Ferreterías y corralones', 'Librerías y papelerías'],
  'Industria': ['Alimenticia', 'Textil e indumentaria', 'Metalúrgica', 'Química y plásticos', 'Gráfica y packaging', 'Autopartes'],
  'Logística y transporte': ['Transporte de cargas', 'Courier y última milla', 'Depósitos y almacenes', 'Comercio exterior y aduana'],
  'Construcción e inmobiliaria': ['Constructoras', 'Desarrolladoras', 'Inmobiliarias', 'Administración de consorcios'],
  'Gastronomía y hotelería': ['Restaurantes y bares', 'Hoteles', 'Catering y eventos'],
  'Tecnología y telecomunicaciones': ['Software y servicios IT', 'Telecomunicaciones', 'Electrónica'],
  'Finanzas y seguros': ['Bancos y financieras', 'Seguros y ART', 'Cambio y inversiones'],
  'Sector público y ONG': ['Municipios y organismos', 'Fundaciones y ONG', 'Cámaras y asociaciones'],
  'Agro y energía': ['Agropecuario', 'Petróleo, gas y energía', 'Minería'],
  'Otros': ['Sin clasificar'],
};
