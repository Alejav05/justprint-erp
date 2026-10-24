import { interpretarFecha, finDePeriodo } from './fechas.js';
import { siguienteNumero } from '../lib/numeradores.js';
import { auditar } from '../lib/audit.js';

class Deshacer extends Error {}

const plata = (n) => (n == null || n === '' ? null : Math.round((Number(n) + Number.EPSILON) * 100) / 100);
const entero = (n) => (n == null || n === '' ? 0 : Math.max(0, Math.round(Number(n))));
const texto = (v) => (v == null ? null : String(v).trim() || null);
const clave = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const fecha = (v) => interpretarFecha(v)?.fecha ?? null;
const momento = (v) => interpretarFecha(v)?.momento ?? null;

const MARCAS = ['Konica Minolta', 'Brother', 'HP', 'Canon', 'Epson', 'Ricoh', 'Xerox', 'Samsung', 'Kyocera', 'Lexmark', 'Sharp', 'OKI'];
function separarModelo(nombre) {
  const n = texto(nombre) ?? 'Sin modelo';
  const marca = MARCAS.find((m) => n.toLowerCase().startsWith(m.toLowerCase()));
  if (marca) return { marca, modelo: n.slice(marca.length).trim() || n };
  const [primera, ...resto] = n.split(/\s+/);
  return resto.length ? { marca: primera, modelo: resto.join(' ') } : { marca: 'Sin marca', modelo: n };
}
const parecidoAColor = (modelo) => /CD[WN]\b|CW\b|\bC\d{3}\b|\bMFC-9970/i.test(modelo);

const ROLES_CONTACTO = {
  itsistemas: ['it'], gerenciadecisor: ['decisor'], administracioncompras: ['administracion', 'compras'], usuario: ['usuario'],
};
const TIPO_TICKET = { instalacion: 'instalacion', falla: 'soporte', toner: 'insumos', mantenimiento: 'soporte' };
const ENTIDAD_ALIAS = { europahaussas: 'Europa Haus S.A.S.', justprint: 'Europa Haus S.A.S.' };
const IVA = 0.21;
const sumarDias = (iso, dias) => new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);

function tipoInsumo(nombre) {
  if (/toner|tóner/i.test(nombre)) return 'toner';
  if (/unidad de imagen|tambor/i.test(nombre)) return 'unidad_imagen';
  if (/bandeja/i.test(nombre)) return 'bandeja';
  return 'otro';
}

/**
 * Carga los datos de la planilla en la base. Corre en una sola transacción: si algo falla no queda nada
 * a medias, y sin `aplicar` se deshace al final (ensayo) y solo devuelve el informe.
 */
export async function importarPlanilla(db, datos, { aplicar = false, incluirPrueba = false, decisiones = {} } = {}) {
  const sinComprobante = new Set(decisiones.contratosSinComprobante ?? []);
  const alias = { ...ENTIDAD_ALIAS, ...Object.fromEntries(Object.entries(decisiones.aliasEntidades ?? {}).map(([a, n]) => [clave(a), n])) };
  const decEntidad = Object.fromEntries(Object.entries(decisiones.entidades ?? {}).map(([n, v]) => [clave(n), v]));
  const inf = { aplicado: false, tablas: {}, excluidos: [], avisos: [], preguntas: [] };
  const cuenta = (t, n = 1) => { inf.tablas[t] = (inf.tablas[t] ?? 0) + n; };
  const aviso = (m) => inf.avisos.push(m);
  const pregunta = (m) => inf.preguntas.push(m);
  const S = (hoja) => datos[hoja] ?? [];

  try {
    await db.transaction(async (trx) => {
      if ((await trx('clientes').count({ n: '*' }).first()).n > 0) {
        throw new Error('La base ya tiene clientes. El importador es para una carga inicial sobre una base vacía.');
      }
      for (const c of ['ticket', 'remito']) {
        if (!(await trx('numeradores').where({ clave: c }).first())) throw new Error('Faltan los datos base. Corré primero: npm run seed:base');
      }

      // ---- Qué se deja afuera: la cuenta de pruebas y todo lo que cuelga de ella ----
      const esPrueba = (c) => /prueba/i.test(`${c.Razon_Social ?? ''} ${c.Nombre_Comercial ?? ''}`);
      const fuera = new Set(incluirPrueba ? [] : S('Clientes').filter(esPrueba).map((c) => c.ID_Cliente));
      const contratosFuera = new Set(S('Contratos').filter((c) => fuera.has(c.ID_Cliente)).map((c) => c.ID_Contrato));
      const equiposFuera = new Set(S('Equipos').filter((e) => fuera.has(e.ID_Cliente)).map((e) => e.ID_Equipo));
      const dentro = (hoja, f) => S(hoja).filter((r) => !f(r));
      if (fuera.size) {
        const nombres = S('Clientes').filter((c) => fuera.has(c.ID_Cliente)).map((c) => c.Razon_Social).join(', ');
        inf.excluidos.push(`Cliente de pruebas (${nombres}) con ${contratosFuera.size} contratos, ${equiposFuera.size} equipos, ` +
          `${S('Servicios_Tecnicos').filter((t) => fuera.has(t.ID_Cliente)).length} tickets, ` +
          `${S('Facturas').filter((f) => fuera.has(f.ID_Cliente)).length} facturas, ` +
          `${S('Costos').filter((c) => fuera.has(c.ID_Cliente)).length} costos y ${S('Remitos').filter((r) => fuera.has(r.ID_Cliente)).length} remitos. ` +
          'Para cargarlo igual: --incluir-prueba.');
      }

      // ---- Usuarios del sistema, para atribuir tickets y movimientos ----
      const usuarios = await trx('usuarios').select('id', 'nombre');
      const sinUsuario = new Set();
      const usuarioPorNombre = (nombre) => {
        const n = clave(nombre);
        if (!n) return null;
        const u = usuarios.find((x) => clave(x.nombre) === n) ?? usuarios.find((x) => clave(x.nombre).startsWith(n));
        if (!u) sinUsuario.add(nombre);
        return u?.id ?? null;
      };

      // ---- Entidades facturantes (a partir de "Facturada_Por") ----
      const entidades = new Map(); // clave normalizada -> id
      const nombreEntidad = (raw) => {
        const k = clave(raw);
        if (!k) return null;
        return { k: alias[k] ? clave(alias[k]) : k, nombre: alias[k] ?? String(raw).trim() };
      };
      const facturasValidas = dentro('Facturas', (f) => fuera.has(f.ID_Cliente));
      for (const f of facturasValidas) {
        const e = nombreEntidad(f.Facturada_Por);
        if (!e || entidades.has(e.k)) continue;
        const dec = decEntidad[e.k] ?? {};
        const [id] = await trx('entidades_facturantes').insert({ razon_social: e.nombre, cuit: dec.cuit ?? '', activa: dec.activa ?? true });
        entidades.set(e.k, id);
        cuenta('entidades_facturantes');
        if (!dec.cuit) pregunta(`Falta el CUIT de la entidad facturante "${e.nombre}" (quedó vacío).`);
      }
      if (facturasValidas.some((f) => clave(f.Facturada_Por) === 'justprint') && !decisiones.entidades) {
        pregunta('Una factura figuraba como emitida por "Justprint". La cargué como Europa Haus S.A.S. ¿Es correcto?');
      }

      // ---- Clientes y sedes ----
      const cliente = new Map();
      const sede = new Map();
      for (const c of dentro('Clientes', (x) => fuera.has(x.ID_Cliente))) {
        const notas = [c.Telefono && `Teléfono general: ${c.Telefono}`, c.Mail && `Mail general: ${c.Mail}`].filter(Boolean).join('\n') || null;
        const [id] = await trx('clientes').insert({
          razon_social: texto(c.Razon_Social), nombre_comercial: texto(c.Nombre_Comercial), cuit: texto(c.CUIT),
          estado: clave(c.Estado) === 'inactivo' ? 'inactivo' : 'activo', origen: 'planilla', fecha_alta: fecha(c.Fecha_Alta), notas,
        });
        cliente.set(c.ID_Cliente, id);
        cuenta('clientes');
        if (!texto(c.CUIT)) aviso(`El cliente ${c.Razon_Social} no tiene CUIT.`);
        const localidad = texto(c.Localidad);
        if (!localidad) aviso(`El cliente ${c.Razon_Social} no tiene localidad: se asumió CABA para el SLA.`);
        const caba = !localidad || /caba|capital|ciudad aut/i.test(localidad);
        const [sid] = await trx('sedes').insert({
          cliente_id: id, nombre: 'Principal', domicilio: texto(c.Direccion), localidad, zona: caba ? 'caba' : 'resto', es_principal: true,
        });
        sede.set(c.ID_Cliente, sid);
        cuenta('sedes');
      }

      // ---- Contactos ----
      for (const k of dentro('Contactos', (x) => fuera.has(x.ID_Cliente))) {
        const tel = k.Telefono == null ? null : String(Math.round(Number(k.Telefono)) || k.Telefono);
        await trx('contactos').insert({
          cliente_id: cliente.get(k.ID_Cliente), nombre: texto(k.Nombre),
          roles: JSON.stringify(ROLES_CONTACTO[clave(k.Rol)] ?? []),
          telefonos: JSON.stringify(tel ? [{ tipo: 'celular', numero: tel }] : []),
          emails: JSON.stringify(k.Mail ? [{ tipo: 'trabajo', direccion: String(k.Mail).trim().toLowerCase() }] : []),
          autorizado_toner: clave(k.Autorizado_Toner) === 'si', origen: 'planilla', estado: 'activo',
        });
        cuenta('contactos');
      }

      // ---- Contratos y condiciones ----
      const contrato = new Map();
      const contratoInfo = new Map();
      const entidadDeContrato = (idc) => {
        const veces = new Map();
        for (const f of facturasValidas.filter((x) => x.ID_Contrato === idc)) {
          if (sinComprobante.has(idc)) break;
          const e = nombreEntidad(f.Facturada_Por);
          if (e) veces.set(e.k, (veces.get(e.k) ?? 0) + 1);
        }
        const mejor = [...veces.entries()].sort((a, b) => b[1] - a[1])[0];
        return mejor ? entidades.get(mejor[0]) : null;
      };
      for (const c of dentro('Contratos', (x) => contratosFuera.has(x.ID_Contrato))) {
        const moneda = clave(c.Moneda) === 'ars' ? 'ARS' : 'USD';
        const inicio = fecha(c.Fecha_Inicio);
        const [id] = await trx('contratos').insert({
          cliente_id: cliente.get(c.ID_Cliente), sede_id: sede.get(c.ID_Cliente), nombre: texto(c.Nombre_Contrato) ?? 'Contrato',
          estado: clave(c.Vigente) === 'si' ? 'vigente' : 'vencido', fecha_inicio: inicio,
          duracion_meses: c.Duracion_Meses == null ? null : entero(c.Duracion_Meses), moneda, entidad_facturante_id: entidadDeContrato(c.ID_Contrato),
        });
        const cond = {
          contrato_id: id, vigente_desde: inicio ?? fecha(new Date()), monto_mensual: plata(c.Monto_Mensual) ?? 0,
          franquicia_negro: entero(c.Franquicia_Negro), franquicia_color: entero(c.Franquicia_Color),
          excedente_negro: Number(c.Costo_Excedente_Negro ?? 0), excedente_color: Number(c.Costo_Excedente_Color ?? 0),
          motivo: 'alta', monto_usd_referencia: moneda === 'USD' ? plata(c.Monto_Mensual) : null,
        };
        // Contrato que se cobra sin comprobante fiscal: queda como no facturable desde el inicio, sin simular una factura.
        if (sinComprobante.has(c.ID_Contrato)) Object.assign(cond, { motivo: 'sin_facturar', facturable: false, notas: 'Cobro sin comprobante fiscal (acuerdo con el cliente)' });
        const [condId] = await trx('contrato_condiciones').insert(cond);
        const sf = decisiones.contratosSinFacturar?.[c.ID_Contrato];
        if (sf?.desde) {
          await trx('contrato_condiciones').where({ id: condId }).update({ vigente_hasta: sumarDias(sf.desde, -1) });
          await trx('contrato_condiciones').insert({ ...cond, vigente_desde: sf.desde, motivo: 'sin_facturar', facturable: false, notas: sf.motivo ?? null });
        }
        if (moneda === 'ARS') {
          aviso(`El contrato ${c.ID_Contrato} está en pesos: su equivalente en USD de referencia sale de cada factura. Los ajustes por IPC se cargan a mano como una condición nueva, con su porcentaje y la cotización del momento.`);
        }
        contrato.set(c.ID_Contrato, id);
        contratoInfo.set(c.ID_Contrato, { moneda, inicio, cliente: c.ID_Cliente });
        cuenta('contratos');
      }

      // ---- Equipos ----
      const lecturas = dentro('Contadores', (l) => equiposFuera.has(l.ID_Equipo));
      const tieneColor = (idEq, e) => Number(e.Contador_Inicial_Color) > 0 || lecturas.some((l) => l.ID_Equipo === idEq && Number(l.Contador_Color) > 0);
      const modelos = new Map();
      const equipo = new Map();
      let deposito = null;
      const esColor = new Map();
      for (const e of dentro('Equipos', (x) => equiposFuera.has(x.ID_Equipo))) {
        const { marca, modelo } = separarModelo(e.Modelo);
        const color = tieneColor(e.ID_Equipo, e) || parecidoAColor(modelo);
        const km = `${marca}|${modelo}`;
        if (!modelos.has(km)) {
          const [mid] = await trx('modelos_equipo').insert({ marca, modelo, tipo: color ? 'color' : 'monocromo' });
          modelos.set(km, mid);
          cuenta('modelos_equipo');
          aviso(`El modelo ${marca} ${modelo} quedó como ${color ? 'color' : 'monocromo'} (se dedujo de los contadores y del nombre; confirmalo).`);
        }
        esColor.set(e.ID_Equipo, color);
        const enDeposito = clave(e.Estado) !== 'activo';
        if (enDeposito && !deposito) {
          [deposito] = await trx('ubicaciones').insert({ nombre: 'Depósito principal', tipo: 'deposito' });
          cuenta('ubicaciones');
        }
        const [id] = await trx('equipos').insert({
          modelo_id: modelos.get(km), numero_serie: texto(e.N_Serie), estado: enDeposito ? 'deposito' : 'instalado',
          ubicacion_id: enDeposito ? deposito : null, observaciones: texto(e.Observaciones),
        });
        equipo.set(e.ID_Equipo, id);
        cuenta('equipos');
        const idc = e.ID_Contrato;
        if (!enDeposito && contrato.has(idc)) {
          await trx('asignaciones_equipo').insert({
            equipo_id: id, contrato_id: contrato.get(idc), sede_id: sede.get(e.ID_Cliente),
            desde: fecha(e.Fecha_Instalacion) ?? contratoInfo.get(idc).inicio ?? fecha(new Date()),
            contador_inicial_negro: entero(e.Contador_Inicial_Negro), contador_inicial_color: entero(e.Contador_Inicial_Color),
          });
          cuenta('asignaciones_equipo');
        } else if (!enDeposito) {
          aviso(`El equipo ${e.N_Serie} figura activo pero sin contrato: queda sin asignación.`);
        }
      }

      // ---- Lecturas de contador ----
      const ult = new Map();
      for (const l of lecturas.filter((x) => equipo.has(x.ID_Equipo)).sort((a, b) => (fecha(a.Fecha) ?? '').localeCompare(fecha(b.Fecha) ?? ''))) {
        const f = fecha(l.Fecha);
        if (!f) { aviso(`Lectura ${l.ID_Lectura} sin fecha: no se importó.`); continue; }
        const neg = entero(l.Contador_Negro);
        const col = entero(l.Contador_Color);
        const prev = ult.get(l.ID_Equipo);
        if (prev && (neg < prev.neg || col < prev.col)) aviso(`El contador del equipo ${l.ID_Equipo} baja el ${f} (lectura ${l.ID_Lectura}). Revisá si es un error de carga.`);
        ult.set(l.ID_Equipo, { neg, col });
        await trx('lecturas_contador').insert({
          equipo_id: equipo.get(l.ID_Equipo), fecha: f, contador_negro: neg, contador_color: col, origen: 'importacion', observaciones: texto(l.Observaciones),
        });
        cuenta('lecturas_contador');
      }

      // ---- Tickets ----
      const ticket = new Map();
      const tickets = dentro('Servicios_Tecnicos', (t) => fuera.has(t.ID_Cliente))
        .sort((a, b) => (momento(a.Fecha) ?? '').localeCompare(momento(b.Fecha) ?? ''));
      for (const t of tickets) {
        const abierto = momento(t.Fecha);
        const cerrado = clave(t.Estado) === 'resuelto';
        const numero = await siguienteNumero(trx, 'ticket');
        const [id] = await trx('tickets').insert({
          numero, cliente_id: cliente.get(t.ID_Cliente), sede_id: sede.get(t.ID_Cliente), equipo_id: equipo.get(t.ID_Equipo) ?? null,
          asunto: (texto(t.Descripcion) ?? texto(t.Tipo) ?? 'Sin descripción').slice(0, 200),
          descripcion: `Importado de la planilla (${t.ID_Ticket}).`, tipo: TIPO_TICKET[clave(t.Tipo)] ?? 'otro', prioridad: 'normal',
          estado: cerrado ? 'cerrado' : 'abierto', origen: 'interno', asignado_a: usuarioPorNombre(t.Responsable), abierto_en: abierto, sla_medible: false,
          cerrado_en: cerrado ? abierto : null,
        });
        ticket.set(t.ID_Ticket, id);
        cuenta('tickets');
      }
      const abiertos = tickets.filter((t) => clave(t.Estado) !== 'resuelto');
      if (abiertos.length) aviso(`${abiertos.length} tickets quedaron abiertos y sin SLA calculado: ${abiertos.map((t) => t.ID_Ticket).join(', ')}.`);

      // ---- Insumos y stock ----
      const insumo = new Map();
      const porSku = new Map();
      for (const i of S('Insumos')) {
        const [id] = await trx('insumos').insert({
          codigo: texto(i.SKU), descripcion: texto(i.Nombre), tipo: tipoInsumo(i.Nombre ?? ''), stock_minimo: 0,
          costo_referencia: plata(i.Costo_Unitario), moneda: clave(i.Moneda) === 'ars' ? 'ARS' : 'USD',
        });
        insumo.set(i.ID_Insumo, id);
        porSku.set(clave(i.SKU), id);
        cuenta('insumos');
      }
      const saldo = new Map();
      for (const m of S('Movimientos_Insumos').sort((a, b) => (momento(a.Fecha) ?? '').localeCompare(momento(b.Fecha) ?? ''))) {
        if (!insumo.has(m.ID_Insumo)) continue;
        const entrada = clave(m.Tipo) === 'entrada';
        const cant = entero(m.Cantidad);
        await trx('movimientos_insumo').insert({
          insumo_id: insumo.get(m.ID_Insumo), fecha: momento(m.Fecha) ?? momento(new Date()), tipo: entrada ? 'entrada' : 'salida',
          cantidad: cant, usuario_id: usuarioPorNombre(m.Usuario), motivo: texto(m.Motivo)?.slice(0, 255),
        });
        saldo.set(m.ID_Insumo, (saldo.get(m.ID_Insumo) ?? 0) + (entrada ? cant : -cant));
        cuenta('movimientos_insumo');
      }
      const negativos = [];
      for (const i of S('Insumos')) {
        const real = Number(i.Stock_Actual ?? 0);
        const calc = saldo.get(i.ID_Insumo) ?? 0;
        const regulariza = real < 0 && decisiones.regularizarStockNegativo;
        const destino = regulariza ? 0 : real;
        if (destino !== calc) {
          await trx('movimientos_insumo').insert({
            insumo_id: insumo.get(i.ID_Insumo), fecha: momento(new Date()), tipo: 'ajuste', cantidad: destino - calc,
            motivo: regulariza ? 'Regularización de stock negativo (migración)' : 'Ajuste de migración al stock de la planilla',
          });
          cuenta('movimientos_insumo');
          if (regulariza) aviso(`El stock de ${i.SKU} estaba en ${real}: se regularizó a 0.`);
          else aviso(`El stock de ${i.SKU} no coincidía con sus movimientos (planilla ${real}, movimientos ${calc}); se agregó un ajuste.`);
        }
        if (real < 0 && !regulariza) negativos.push(i.SKU);
      }
      if (negativos.length) {
        pregunta(`Estos insumos tienen stock negativo en la planilla (se entregaron sin registrar la compra): ${negativos.join(', ')}. Los cargué igual; ¿querés regularizarlos con un ajuste?`);
      }

      // ---- Remitos ----
      let maxNumero = 0;
      const remitos = dentro('Remitos', (r) => fuera.has(r.ID_Cliente));
      for (const r of S('Remitos')) maxNumero = Math.max(maxNumero, Math.round(Number(r.Numero) || 0));
      for (const r of remitos.sort((a, b) => Number(a.Numero) - Number(b.Numero))) {
        const numero = String(Math.round(Number(r.Numero))).padStart(5, '0');
        const firmado = !!texto(r.Link_Firma);
        const obs = [
          texto(r.Nombre_Firmante) && `Firmó: ${texto(r.Nombre_Firmante)}`, texto(r.Link_Firma) && `Firma: ${texto(r.Link_Firma)}`,
          texto(r.Link_PDF) && `PDF: ${texto(r.Link_PDF)}`, `Importado de la planilla (${r.ID_Remito}).`,
        ].filter(Boolean).join('\n');
        const [id] = await trx('remitos').insert({
          numero, cliente_id: cliente.get(r.ID_Cliente), sede_id: sede.get(r.ID_Cliente), tipo: clave(r.Tipo) === 'mixto' ? 'mixto' : 'entrega',
          fecha: fecha(r.Fecha), estado: firmado ? 'firmado' : 'emitido', observaciones: obs,
        });
        cuenta('remitos');
        let items = [];
        if (r.Items) { try { items = JSON.parse(r.Items); } catch { aviso(`Remito ${numero}: no se pudo leer el detalle.`); } }
        if (!items.length && r.Detalle) items = [{ tipo: r.Tipo, detalle: r.Detalle, cantidad: r.Cantidad ?? 1 }];
        if (!items.length) aviso(`El remito ${numero} no tiene ítems en la planilla.`);
        for (const it of items) {
          const detalle = String(it.detalle ?? '').trim();
          const cabeza = clave(detalle.split('—')[0]);
          let equipoId = null;
          let insumoId = it.idInsumo ? insumo.get(it.idInsumo) ?? null : null;
          if (!insumoId && cabeza && porSku.has(cabeza)) insumoId = porSku.get(cabeza);
          if (!insumoId) {
            const e = dentro('Equipos', (x) => equiposFuera.has(x.ID_Equipo)).find((x) => clave(x.N_Serie) === cabeza);
            if (e) equipoId = equipo.get(e.ID_Equipo);
          }
          await trx('remito_items').insert({
            remito_id: id, insumo_id: insumoId, equipo_id: equipoId, descripcion: detalle.slice(0, 200) || 'Sin detalle', cantidad: Math.max(1, entero(it.cantidad ?? 1)),
          });
          cuenta('remito_items');
        }
      }
      // Que el próximo remito nuevo siga la serie, incluso contando los de pruebas que no se cargaron.
      await trx('numeradores').where({ clave: 'remito' }).update({ ultimo: maxNumero });

      // ---- Costos ----
      for (const c of dentro('Costos', (x) => fuera.has(x.ID_Cliente))) {
        const idEq = c.ID_Equipo;
        const delEquipo = S('Equipos').find((e) => e.ID_Equipo === idEq)?.ID_Contrato;
        const delCliente = [...contratoInfo.entries()].filter(([, v]) => v.cliente === c.ID_Cliente).map(([k]) => k);
        const idContrato = contrato.has(delEquipo) ? delEquipo : (delCliente.length === 1 ? delCliente[0] : null);
        const moneda = clave(c.Moneda) === 'ars' ? 'ARS' : 'USD';
        await trx('costos').insert({
          fecha: fecha(c.Fecha) ?? fecha(new Date()), concepto: (texto(c.Descripcion) ?? texto(c.Tipo) ?? 'Costo').slice(0, 200),
          tipo: { manoobra: 'mano_de_obra', insumo: 'insumo', logistica: 'logistica', amortizacion: 'amortizacion' }[clave(c.Tipo)] ?? clave(c.Tipo),
          importe: plata(c.Monto) ?? 0, moneda, cotizacion: c.Cotizacion_Usada == null ? null : Number(c.Cotizacion_Usada),
          importe_usd: plata(c.Monto_USD) ?? (moneda === 'USD' ? plata(c.Monto) : 0),
          cliente_id: cliente.get(c.ID_Cliente) ?? null, equipo_id: equipo.get(idEq) ?? null,
          contrato_id: contrato.get(idContrato) ?? null,
          ticket_id: ticket.get(c.ID_Ticket) ?? null, insumo_id: insumo.get(c.ID_Insumo) ?? null,
        });
        cuenta('costos');
      }

      // ---- Facturas y cobros (facturado y cobrado, por separado) ----
      const pendientes = [];
      const cotizaciones = new Map();
      for (const f of facturasValidas.sort((a, b) => String(a.ID_Factura).localeCompare(String(b.ID_Factura)))) {
        const info = contratoInfo.get(f.ID_Contrato);
        const moneda = info?.moneda ?? 'USD';
        const neto = moneda === 'ARS' ? plata(f.Monto_ARS) : plata(f.Monto_USD);
        const interno = sinComprobante.has(f.ID_Contrato); // registro interno: sin IVA, sin entidad, sin comprobante
        const iva = interno ? 0 : plata(neto * IVA);
        const total = plata(neto + iva);
        const netoUsd = moneda === 'ARS' ? plata(f.Monto_USD) : neto;
        const dec = decisiones.facturas?.[f.ID_Factura];
        const estado = clave(f.Estado) === 'pagada' ? 'cobrada' : (dec?.estado ?? 'borrador');
        const pagada = estado === 'cobrada';
        const emitida = estado !== 'borrador';
        if (!emitida) pendientes.push(`${f.ID_Factura} (${f.Periodo})`);
        const ent = nombreEntidad(f.Facturada_Por);
        const [id] = await trx('facturas').insert({
          cliente_id: cliente.get(f.ID_Cliente), contrato_id: contrato.get(f.ID_Contrato) ?? null,
          entidad_facturante_id: interno ? null : (ent ? entidades.get(ent.k) : (emitida ? entidadDeContrato(f.ID_Contrato) : null)), periodo: f.Periodo,
          // La planilla pisaba la fecha de emisión con la de pago: la de emisión real no se conoce.
          fecha_emision: emitida ? finDePeriodo(f.Periodo) : null, fecha_emision_estimada: emitida,
          moneda, tipo_cambio: f.Cotizacion_Usada == null ? null : Number(f.Cotizacion_Usada), neto, iva, total, neto_usd: netoUsd, estado,
        });
        await trx('factura_items').insert({
          factura_id: id, tipo: 'abono', descripcion: `Alquiler de equipos y consumos – ${f.Periodo}`, cantidad: 1, precio_unitario: neto, alicuota_iva: interno ? 0 : 21, subtotal: neto,
        });
        cuenta('facturas');
        if (f.Cotizacion_Usada != null && !cotizaciones.has(finDePeriodo(f.Periodo))) cotizaciones.set(finDePeriodo(f.Periodo), Number(f.Cotizacion_Usada));
        if (pagada) {
          const [cid] = await trx('cobros').insert({
            cliente_id: cliente.get(f.ID_Cliente), fecha_cobro: fecha(f.Fecha_Emision) ?? finDePeriodo(f.Periodo), medio: 'otro',
            importe: total, moneda, referencia: fecha(f.Fecha_Emision) ? 'Migrado de la planilla' : 'Migrado de la planilla (fecha de cobro estimada)',
          });
          await trx('cobro_aplicaciones').insert({ cobro_id: cid, factura_id: id, importe: total });
          cuenta('cobros');
        }
        if (f.Link_Comprobante) aviso(`La factura ${f.ID_Factura} tiene un enlace a su comprobante que no se importó: ${f.Link_Comprobante}`);
      }
      if (pendientes.length) {
        pregunta(`Estas facturas figuraban como "Pendiente" y sin fecha de emisión: ${pendientes.join(', ')}. Las cargué como borrador (no emitidas). ` +
          'Si ya las emitiste y están por cobrar, decímelo y las paso a emitidas.');
      }
      aviso('Las facturas pagadas quedaron con fecha de emisión estimada (fin del período) porque la planilla la reemplazaba por la de pago. Los cobros usan esa fecha de pago y llevan la marca "Migrado de la planilla".');
      aviso('Las fechas de la planilla venían corridas por huso horario (las de fin de mes figuraban como día 29 o 30); se corrigieron. Conviene mirar al azar un par de fechas de contratos e instalaciones.');
      for (const [f, valor] of [...cotizaciones.entries()].sort()) { await trx('cotizaciones_usd').insert({ fecha: f, valor, fuente: 'planilla' }); cuenta('cotizaciones_usd'); }
      if (sinComprobante.size) aviso(`Contratos que se cobran sin comprobante fiscal (${[...sinComprobante].join(', ')}): sus registros se cargaron como internos, sin IVA, sin entidad facturante y marcados como no facturables. No cuentan como facturado.`);
      aviso('Los importes de la planilla son sin IVA: se cargaron como neto y se les sumó el 21% para armar el total de lo histórico (como se factura siempre). El valor en USD de referencia de cada factura es el neto.');

      // ---- Cosas que la planilla no tiene o no decía ----
      if (S('Asignaciones').length === 0) pregunta('La hoja Asignaciones está vacía, así que ningún cliente tiene comercial responsable. Hay que asignarlos desde el sistema o decime quién lleva cada cuenta.');
      const adm = S('Usuarios').filter((u) => !usuarios.some((x) => clave(x.nombre) === clave(u.Nombre) || clave(x.nombre).startsWith(clave(u.Nombre))));
      if (adm.length) pregunta(`En la hoja Usuarios figuran: ${adm.map((u) => `${u.Nombre} (${u.Rol})`).join(', ')}. No los creé porque no tengo sus contraseñas: se dan de alta desde el sistema.`);
      if (sinUsuario.size) aviso(`Responsables sin usuario en el sistema (quedaron sin asignar): ${[...sinUsuario].join(', ')}.`);
      const sinCliente = dentro('Equipos', (x) => equiposFuera.has(x.ID_Equipo)).filter((e) => !e.ID_Cliente && remitos.some((r) => clave(r.Detalle ?? '').startsWith(clave(e.N_Serie))));
      for (const e of sinCliente.filter((x) => !(decisiones.equiposEnDeposito ?? []).includes(x.N_Serie))) pregunta(`El equipo ${e.N_Serie} está en depósito pero tiene un remito de entrega a un cliente. ¿Sigue en el cliente o volvió?`);

      await auditar(trx, {}, 'otro', 'importacion', 'planilla', null, { tablas: inf.tablas });
      if (!aplicar) throw new Deshacer();
    });
    inf.aplicado = true;
  } catch (e) {
    if (!(e instanceof Deshacer)) throw e;
  }
  return inf;
}

export function formatearInforme(inf) {
  const l = [];
  l.push(inf.aplicado ? '# Importación aplicada' : '# Ensayo de importación (no se guardó nada)');
  l.push('', '## Qué se cargaría', ...Object.entries(inf.tablas).map(([t, n]) => `- ${t}: ${n}`));
  if (inf.excluidos.length) l.push('', '## Dejado afuera', ...inf.excluidos.map((x) => `- ${x}`));
  if (inf.preguntas.length) l.push('', '## Necesito que me confirmes', ...inf.preguntas.map((x) => `- ${x}`));
  if (inf.avisos.length) l.push('', '## Avisos', ...inf.avisos.map((x) => `- ${x}`));
  return l.join('\n');
}
