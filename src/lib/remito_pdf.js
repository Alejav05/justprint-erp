// PDF del remito (A4). Es el mismo documento para imprimir, descargar, mandar por mail o WhatsApp y para el enlace del cliente.
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { config } from '../config.js';

const NAVY = '#0D1B2A'; const CIAN = '#00BCD4'; const CIAN_OSC = '#00838F'; const GRIS = '#5B6B76'; const SUAVE = '#7C8B96'; const LINEA = '#D9E2E7'; const FONDO = '#F3F7F9';
const LOGO = new URL('../../public/img/logo-blanco.png', import.meta.url).pathname;
const M = 44; // margen
const EMISOR = { nombre: 'Europa Haus S.A.S.', marca: 'JustPrint', cuit: '30-71646173-0', mail: 'soporte@justprint.com.ar' };

const fechaLarga = (s) => { const [a, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const fechaHora = (s) => new Date(`${String(s).replace(' ', 'T')}${String(s).includes('Z') ? '' : 'Z'}`).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const telFormato = (n) => { const d = String(n).replace(/\D/g, ''); return d.length === 13 && d.startsWith('549') ? `+54 9 ${d.slice(3, 5)} ${d.slice(5, 9)}-${d.slice(9)}` : `+${d}`; };

export async function generarRemitoPdf(r) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `${r.documento} ${r.numero}`, Author: 'JustPrint', Subject: r.tipo_texto } });
  const trozos = []; doc.on('data', (c) => trozos.push(c));
  const fin = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(trozos))));
  const srv = r.tipo === 'servicio'; const S = r.servicio ?? {};
  const W = doc.page.width; const H = doc.page.height; const ancho = W - M * 2;

  // ---- cabecera
  doc.rect(0, 0, W, 104).fill(NAVY);
  doc.rect(0, 104, W, 3).fill(CIAN);
  doc.image(LOGO, M, 34, { height: 30 });
  doc.fillColor('#9FB4BD').font('Helvetica-Bold').fontSize(9).text(r.documento.toUpperCase(), M, 30, { width: ancho, align: 'right', characterSpacing: 2.4 });
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(23).text(srv ? r.numero : `N° ${r.numero}`, M, 44, { width: ancho, align: 'right' });
  doc.fillColor('#9FB4BD').font('Helvetica').fontSize(10).text(`Fecha ${fechaLarga(r.fecha)}`, M, 76, { width: ancho, align: 'right' });

  // ---- tipo
  let y = srv ? 122 : 128;
  doc.roundedRect(M, y, doc.widthOfString(r.tipo_texto.toUpperCase(), { characterSpacing: 1 }) + 22, 22, 11).fill('#E0F7FA');
  doc.fillColor(CIAN_OSC).font('Helvetica-Bold').fontSize(9).text(r.tipo_texto.toUpperCase(), M + 11, y + 7, { characterSpacing: 1, lineBreak: false });
  y += srv ? 34 : 40;

  // ---- partes
  const col = (x, w, titulo, lineas) => {
    doc.fillColor(SUAVE).font('Helvetica-Bold').fontSize(8).text(titulo.toUpperCase(), x, y, { width: w, characterSpacing: 1.2 });
    let yy = y + 15;
    lineas.filter(Boolean).forEach((l, i) => {
      doc.fillColor(i === 0 ? NAVY : GRIS).font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 0 ? 12.5 : 10);
      doc.text(l, x, yy, { width: w }); yy = doc.y + (i === 0 ? 3 : 1.5);
    });
    return yy;
  };
  const colW = (ancho - 28) / 2;
  const cli = r.cliente;
  const y1 = col(M, colW, srv ? 'Cliente' : 'Entregado a', [cli.nombre_comercial || cli.razon_social, cli.nombre_comercial && cli.nombre_comercial !== cli.razon_social ? cli.razon_social : null, cli.cuit ? `CUIT ${cli.cuit}` : null,
    r.sede ? [r.sede.nombre, r.sede.domicilio, r.sede.localidad].filter(Boolean).join(' · ') : null]);
  const y2 = srv
    ? col(M + colW + 28, colW, 'Atendió', [S.tecnico || EMISOR.marca, S.tecnico ? `Técnico de ${EMISOR.marca}` : null, `CUIT ${EMISOR.cuit}`, EMISOR.mail])
    : col(M + colW + 28, colW, 'Emitido por', [EMISOR.marca, `CUIT ${EMISOR.cuit}`, EMISOR.mail, `WhatsApp ${telFormato(config.whatsappSoporte)}`]);
  y = Math.max(y1, y2) + 14;

  // ---- servicio realizado (solo en la conformidad de servicio)
  const caja = (titulo, texto) => {
    doc.font('Helvetica').fontSize(10);
    const alto = doc.heightOfString(texto, { width: ancho - 28 }) + 38;
    if (y + alto > H - 190) { doc.addPage(); y = M; }
    doc.roundedRect(M, y, ancho, alto, 6).fill(FONDO); doc.rect(M, y, 3, alto).fill(CIAN);
    doc.fillColor(SUAVE).font('Helvetica-Bold').fontSize(8).text(titulo, M + 16, y + 11, { characterSpacing: 1.2 });
    doc.fillColor(NAVY).font('Helvetica').fontSize(10).text(texto, M + 16, y + 25, { width: ancho - 28 });
    y += alto + 10;
  };
  if (srv) {
    const horario = S.horario || fechaLarga(r.fecha);
    const hechos = [['Ticket', S.ticket?.numero ?? r.numero], ['Motivo', S.ticket?.asunto ?? '—'],
      ['Equipo', S.equipo ? `${S.equipo.marca} ${S.equipo.modelo} · N° de serie ${S.equipo.serie}` : 'Sin equipo asociado'], ['Fecha y horario', horario]];
    if (S.contador_negro != null) hechos.push(['Contadores al cierre', `Negro ${S.contador_negro}${S.equipo?.tipo === 'color' || S.contador_color ? ` · Color ${S.contador_color ?? 0}` : ''}`]);
    const w = (ancho - 32 - 24) / 2; const altos = [];
    hechos.forEach(([, v]) => { doc.font('Helvetica-Bold').fontSize(10.5); altos.push(doc.heightOfString(String(v), { width: w }) + 24); });
    let alto = 16; for (let i = 0; i < hechos.length; i += 2) alto += Math.max(altos[i], altos[i + 1] ?? 0);
    alto += 4;
    if (y + alto > H - 190) { doc.addPage(); y = M; }
    doc.roundedRect(M, y, ancho, alto, 8).lineWidth(1).strokeColor(LINEA).stroke();
    let yy = y + 14;
    for (let i = 0; i < hechos.length; i += 2) {
      [0, 1].forEach((k) => { const f = hechos[i + k]; if (!f) return; const x = M + 16 + k * (w + 24);
        doc.fillColor(SUAVE).font('Helvetica-Bold').fontSize(8).text(f[0].toUpperCase(), x, yy, { width: w, characterSpacing: 1.1 });
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10.5).text(String(f[1]), x, yy + 12, { width: w }); });
      yy += Math.max(altos[i], altos[i + 1] ?? 0);
    }
    y += alto + 10;
    if (S.diagnostico) caja('DIAGNÓSTICO', S.diagnostico);
    caja('TRABAJO REALIZADO', S.trabajo || 'Sin detalle.');
  }

  // ---- detalle
  const cC = 52; const cD = 150; const cT = ancho - cC - cD;
  const fila = (cant, desc, det, cab, par) => {
    const hDesc = doc.font(cab ? 'Helvetica-Bold' : 'Helvetica').fontSize(cab ? 8 : 10.5).heightOfString(desc, { width: cT - 16 });
    const hDet = cab ? 0 : doc.fontSize(9).heightOfString(det || '', { width: cD - 8 });
    const alto = cab ? 24 : Math.max(hDesc, hDet) + 16;
    if (y + alto > H - 190) { doc.addPage(); y = M; }
    if (cab) doc.rect(M, y, ancho, alto).fill(NAVY); else if (par) doc.rect(M, y, ancho, alto).fill(FONDO);
    if (!cab) doc.moveTo(M, y + alto).lineTo(M + ancho, y + alto).lineWidth(0.5).strokeColor(LINEA).stroke();
    if (cab) { doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8); doc.text('CANT.', M + 10, y + 8, { width: cC - 10, characterSpacing: 1 }); doc.text('DESCRIPCIÓN', M + cC, y + 8, { width: cT, characterSpacing: 1 }); doc.text('DETALLE', M + cC + cT, y + 8, { width: cD - 8, characterSpacing: 1 }); }
    else {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(String(cant), M + 10, y + 7, { width: cC - 14 });
      doc.fillColor(NAVY).font('Helvetica').fontSize(10.5).text(desc, M + cC, y + 8, { width: cT - 16 });
      doc.fillColor(GRIS).font('Helvetica').fontSize(9).text(det || '', M + cC + cT, y + 9, { width: cD - 8 });
    }
    y += alto;
  };
  if (!srv || r.items.length) {
    if (srv) { doc.fillColor(SUAVE).font('Helvetica-Bold').fontSize(8).text('REPUESTOS E INSUMOS UTILIZADOS', M, y, { characterSpacing: 1.2 }); y += 16; }
    fila('', 'Descripción', '', true);
    r.items.forEach((it, i) => fila(it.cantidad, it.descripcion, it.detalle, false, i % 2 === 1));
    y += srv ? 10 : 16;
  }

  // ---- observaciones
  if (!srv && r.observaciones) {
    doc.font('Helvetica').fontSize(10);
    const alto = doc.heightOfString(r.observaciones, { width: ancho - 28 }) + 38;
    if (y + alto > H - 190) { doc.addPage(); y = M; }
    doc.roundedRect(M, y, ancho, alto, 6).fill(FONDO);
    doc.rect(M, y, 3, alto).fill(CIAN);
    doc.fillColor(SUAVE).font('Helvetica-Bold').fontSize(8).text(r.tipo === 'servicio' ? 'TRABAJO REALIZADO' : 'OBSERVACIONES', M + 16, y + 11, { characterSpacing: 1.2 });
    doc.fillColor(NAVY).font('Helvetica').fontSize(10).text(r.observaciones, M + 16, y + 25, { width: ancho - 28 });
    y += alto + 16;
  }

  // ---- conformidad (siempre entera en la misma hoja)
  const altoConf = r.conformidad?.metodo === 'digital' ? 140 : 150;
  if (y + altoConf > H - 70) { doc.addPage(); y = M; }
  doc.roundedRect(M, y, ancho, altoConf, 8).lineWidth(1).strokeColor(LINEA).stroke();
  doc.fillColor(SUAVE).font('Helvetica-Bold').fontSize(8).text(srv ? 'CONFORMIDAD DEL SERVICIO' : 'CONFORMIDAD DE RECEPCIÓN', M + 16, y + 14, { characterSpacing: 1.2 });
  const c = r.conformidad;
  if (c?.metodo === 'digital') {
    if (c.firma) { try { doc.image(c.firma, M + 16, y + 32, { fit: [200, 70] }); } catch { /* firma ilegible: queda el nombre */ } }
    doc.moveTo(M + 16, y + 106).lineTo(M + 236, y + 106).lineWidth(0.8).strokeColor(NAVY).stroke();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11.5).text(c.nombre, M + 16, y + 112, { width: 230 });
    doc.fillColor(GRIS).font('Helvetica').fontSize(9.5).text([c.cargo, c.dni ? `DNI ${c.dni}` : null].filter(Boolean).join(' · ') || srv ? 'Dio su conformidad' : 'Recibió conforme', M + 16, doc.y + 1, { width: 230 });
    doc.fillColor(CIAN_OSC).font('Helvetica-Bold').fontSize(11).text(srv ? 'Servicio conforme' : 'Recibido conforme', M + 270, y + 38);
    doc.fillColor(GRIS).font('Helvetica').fontSize(9.5).text(`Firmado en pantalla el ${fechaHora(c.firmado_en)}\nLa firma quedó registrada en el sistema de JustPrint junto con el dispositivo y la hora.`, M + 270, y + 56, { width: ancho - 286, lineGap: 2 });
  } else if (c?.metodo === 'papel') {
    doc.fillColor(CIAN_OSC).font('Helvetica-Bold').fontSize(11).text(srv ? 'Servicio conforme' : 'Recibido conforme', M + 16, y + 38);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11.5).text(c.nombre, M + 16, y + 58, { width: ancho - 32 });
    doc.fillColor(GRIS).font('Helvetica').fontSize(9.5).text(`${[c.cargo, c.dni ? `DNI ${c.dni}` : null].filter(Boolean).join(' · ')}${c.cargo || c.dni ? '\n' : ''}Firmó el ${r.documento.toLowerCase()} en papel. El original firmado está archivado (registrado el ${fechaHora(c.firmado_en)}).`, M + 16, doc.y + 2, { width: ancho - 32, lineGap: 2 });
  } else {
    const l = (x, w, t) => { doc.moveTo(x, y + 100).lineTo(x + w, y + 100).lineWidth(0.8).strokeColor(NAVY).stroke(); doc.fillColor(SUAVE).font('Helvetica').fontSize(8.5).text(t, x, y + 106, { width: w }); };
    const w3 = (ancho - 32 - 40) / 3;
    l(M + 16, w3 * 1.3, 'Firma de quien recibe'); l(M + 16 + w3 * 1.3 + 20, w3 * 1.1, 'Aclaración'); l(M + 16 + w3 * 2.4 + 40, w3 * 0.6, 'DNI');
    doc.fillColor(GRIS).font('Helvetica').fontSize(9.5).text(srv ? 'Doy conformidad al servicio realizado, según el detalle de este comprobante.' : 'Recibí los equipos e insumos detallados, en buen estado y de conformidad.', M + 16, y + 34, { width: ancho - 32 });
    doc.fillColor(SUAVE).fontSize(8.5).text('Fecha:  ____ / ____ / ________', M + 16, y + 126);
  }
  y += altoConf + (srv ? 12 : 14);

  // ---- soporte + verificación
  const qr = await QRCode.toBuffer(r.url, { margin: 0, width: 220, errorCorrectionLevel: 'M', color: { dark: NAVY, light: '#FFFFFF' } });
  if (y + (srv ? 60 : 70) > H - 30) { doc.addPage(); y = M; }
  doc.roundedRect(M, y, ancho, srv ? 58 : 64, 8).fill(NAVY);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11).text('¿Necesitás soporte técnico o insumos?', M + 18, y + 14, { width: ancho - 150 });
  doc.fillColor('#9FB4BD').font('Helvetica').fontSize(9.5).text(`Escaneá el QR pegado en tu equipo o escribinos por WhatsApp al ${telFormato(config.whatsappSoporte)} · ${EMISOR.mail}`, M + 18, y + 31, { width: ancho - 150 });
  doc.roundedRect(M + ancho - 54, y + 7, 50, 50, 4).fill('#FFFFFF'); doc.image(qr, M + ancho - 51, y + 10, { width: 44 });
  doc.fillColor('#9FB4BD').font('Helvetica').fontSize(6.5).text(`Verificá este comprobante · ${r.codigo}`, M + ancho - 214, y + 50, { width: 150, align: 'right', lineBreak: false });

  // ---- pie en todas las hojas
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(SUAVE).font('Helvetica').fontSize(7.5).text(`${srv ? r.numero : `${r.documento} ${r.numero}`} · ${srv ? 'Comprobante de servicio' : 'Comprobante de entrega'}, no es un documento fiscal · ${EMISOR.nombre} · CUIT ${EMISOR.cuit}`, M, H - 26, { width: ancho - 60, lineBreak: false });
    doc.text(`Hoja ${i + 1} de ${paginas.count}`, M, H - 26, { width: ancho, align: 'right', lineBreak: false });
  }
  doc.end();
  return fin;
}
