// Anexo de la factura: el respaldo (equipos, contadores, lo contratado y el excedente) en un Excel.
import { liquidar } from './liquidacion.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const mesDePeriodo = (p) => `${MESES[Number(String(p).split('-')[1]) - 1]} ${String(p).split('-')[0]}`;
const dia = (s) => { const [y, m, d] = String(s).split('-'); return `${d}/${m}/${y}`; };
export const nombreAnexo = (f) => `Anexo_Factura_${mesDePeriodo(f.periodo).replace(' ', '_')}.xlsx`;

/** Devuelve el Excel (Buffer) o null si la factura no tiene contrato con condiciones de las que sacar el detalle. */
export async function anexoFactura(db, f) {
  if (!f.contrato_id) return null;
  const r = await liquidar(db, f.periodo, { contratoIds: [f.contrato_id] });
  const fila = r.filas.find((x) => x.contrato_id === f.contrato_id);
  if (!fila || fila.estado === 'sin_condiciones') return null;
  const cliente = await db('clientes').where({ id: f.cliente_id }).select('razon_social', 'nombre_comercial', 'cuit').first();
  const items = await db('factura_items').where({ factura_id: f.id }).orderBy('id');
  const fmt = f.moneda === 'ARS' ? '"$" #,##0.00' : '"USD" #,##0.00';
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook(); libro.creator = 'JustPrint'; libro.created = new Date();
  const AZUL = 'FF4F81BD';
  const cab = (row) => { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }; row.alignment = { vertical: 'middle', wrapText: true }; };

  // ----- Resumen -----
  const rs = libro.addWorksheet('Resumen'); rs.columns = [{ width: 38 }, { width: 22 }, { width: 22 }];
  rs.addRow([`Anexo a la factura de ${mesDePeriodo(f.periodo)}`]).font = { bold: true, size: 14 };
  rs.addRow([]);
  const dato = (k, v) => { const row = rs.addRow([k, v]); row.getCell(1).font = { bold: true }; return row; };
  dato('Cliente', cliente.nombre_comercial || cliente.razon_social);
  if (cliente.cuit) dato('CUIT', cliente.cuit);
  dato('Contrato', fila.contrato);
  if (f.numero) dato('Factura', f.numero);
  dato('Período', mesDePeriodo(f.periodo));
  if (fila.factor < 1) dato('Proporción del mes facturada', `${Math.round(fila.factor * 100)}% (alta durante el mes)`);
  if (fila.meses_consumo > 1) dato('Meses de consumo comprendidos', fila.meses_consumo);
  rs.addRow([]);
  cab(rs.addRow(['Lo contratado y lo consumido', 'Blanco y negro', 'Color']));
  const fr = (k, a, b, f2) => { const row = rs.addRow([k, a, b]); if (f2) { row.getCell(2).numFmt = f2; row.getCell(3).numFmt = f2; } return row; };
  fr('Páginas incluidas por mes', fila.franquicia_mensual_negro, fila.franquicia_mensual_color);
  fr('Páginas incluidas en este período', fila.franquicia_negro, fila.franquicia_color);
  fr('Páginas consumidas', fila.consumo_negro, fila.consumo_color);
  fr('Páginas excedentes', fila.excedente_negro, fila.excedente_color);
  fr('Precio por página excedente', fila.precio_excedente_negro, fila.precio_excedente_color, f.moneda === 'ARS' ? '"$" #,##0.00##' : '"USD" #,##0.00##');
  fr('Importe del excedente', fila.excedente_negro * fila.precio_excedente_negro, fila.excedente_color * fila.precio_excedente_color, fmt);
  rs.addRow([]);
  cab(rs.addRow(['Detalle de lo facturado', 'Cantidad', 'Importe']));
  for (const it of items) { const row = rs.addRow([it.descripcion, Number(it.cantidad), Number(it.subtotal)]); row.getCell(1).alignment = { wrapText: true, vertical: 'top' }; row.getCell(3).numFmt = fmt; }
  const tot = (k, v, neg) => { const row = rs.addRow([k, null, v]); row.getCell(1).font = { bold: true }; row.getCell(3).numFmt = fmt; if (neg) row.getCell(3).font = { bold: true }; return row; };
  tot('Neto', Number(f.neto)); tot('IVA', Number(f.iva)); tot('Total', Number(f.total), true);
  rs.addRow([]);
  const nota = rs.addRow([`Las páginas consumidas surgen de la diferencia entre el contador actual y el anterior de cada equipo (hoja "Equipos y contadores").`]);
  rs.mergeCells(`A${nota.number}:C${nota.number}`); nota.height = 30; nota.getCell(1).font = { italic: true, color: { argb: 'FF666666' } }; nota.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  rs.eachRow((row) => { if (row.getCell(1).fill?.fgColor?.argb === AZUL) { row.getCell(2).alignment = { horizontal: 'right' }; row.getCell(3).alignment = { horizontal: 'right' }; } });
  rs.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ----- Equipos y contadores -----
  const ws = libro.addWorksheet('Equipos y contadores', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [['Equipo', 28], ['N° de serie', 20], ['Tipo', 12], ['Ubicación', 30], ['Lectura anterior (fecha)', 16], ['B/N anterior', 14], ['Color anterior', 14], ['Lectura actual (fecha)', 16], ['B/N actual', 14], ['Color actual', 14], ['Páginas B/N', 13], ['Páginas color', 13]]
    .map(([header, width]) => ({ header, width }));
  cab(ws.getRow(1)); ws.getRow(1).height = 32;
  for (const e of fila.equipos) {
    const ubic = [e.sede, e.domicilio].filter(Boolean).join(' · ');
    const row = e.con_lectura
      ? ws.addRow([`${e.marca} ${e.modelo}`, e.serie, e.tipo === 'color' ? 'Color' : 'Monocromo', ubic, `${dia(e.anterior.fecha)}${e.anterior.inicial ? ' (instalación)' : ''}`, e.anterior.negro, e.tipo === 'color' ? e.anterior.color : null, dia(e.actual.fecha), e.actual.negro, e.tipo === 'color' ? e.actual.color : null, e.consumo_negro, e.tipo === 'color' ? e.consumo_color : null])
      : ws.addRow([`${e.marca} ${e.modelo}`, e.serie, e.tipo === 'color' ? 'Color' : 'Monocromo', ubic, 'Sin lectura en el período']);
    [6, 7, 9, 10, 11, 12].forEach((c) => { row.getCell(c).numFmt = '#,##0'; });
    [5, 8].forEach((c) => { row.getCell(c).alignment = { horizontal: 'right' }; });
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  for (let c = 5; c <= 12; c++) ws.getRow(1).getCell(c).alignment = { vertical: 'middle', wrapText: true, horizontal: 'right' };
  if (fila.equipos.length) {
    const t = ws.addRow(['Total', null, null, null, null, null, null, null, null, null, fila.consumo_negro, fila.consumo_color]);
    t.font = { bold: true }; t.getCell(11).numFmt = '#,##0'; t.getCell(12).numFmt = '#,##0';
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}
