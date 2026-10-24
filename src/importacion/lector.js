import ExcelJS from 'exceljs';

function valorCelda(c) {
  if (c == null) return null;
  if (typeof c === 'object' && !(c instanceof Date)) {
    if ('result' in c) return valorCelda(c.result);
    if ('richText' in c) return c.richText.map((x) => x.text).join('');
    if ('text' in c) return c.text;
    if ('error' in c) return null;
  }
  if (typeof c === 'string') {
    const t = c.trim();
    return t === '' ? null : t;
  }
  return c;
}

/** Lee todas las hojas: { Clientes: [{ID_Cliente: 'CL-01', ...}], ... }. Ignora filas vacías y columnas sin título. */
export async function leerPlanilla(ruta) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(ruta);
  const datos = {};
  libro.eachSheet((hoja) => {
    const titulos = [];
    hoja.getRow(1).eachCell({ includeEmpty: false }, (celda, n) => { titulos[n] = String(valorCelda(celda.value) ?? '').trim(); });
    const filas = [];
    hoja.eachRow({ includeEmpty: false }, (fila, nFila) => {
      if (nFila === 1) return;
      const obj = {};
      let alguno = false;
      titulos.forEach((t, n) => {
        if (!t) return;
        const v = valorCelda(fila.getCell(n).value);
        obj[t] = v;
        if (v != null) alguno = true;
      });
      if (alguno) filas.push(obj);
    });
    datos[hoja.name] = filas;
  });
  return datos;
}
