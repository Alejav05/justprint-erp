// Carga inicial desde la planilla de Google Sheets (descargada como .xlsx).
//   npm run importar -- ruta/planilla.xlsx            -> ensayo: muestra el informe y no guarda nada
//   npm run importar -- ruta/planilla.xlsx --aplicar  -> guarda
// Las respuestas a las dudas de la migración están en scripts/decisiones-importacion.json (--decisiones=otro.json).
// Opciones: --incluir-prueba (carga también la cuenta de pruebas), --informe=archivo.md
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { crearDb } from '../src/db.js';
import { leerPlanilla } from '../src/importacion/lector.js';
import { importarPlanilla, formatearInforme } from '../src/importacion/planilla.js';

const args = process.argv.slice(2);
const ruta = args.find((a) => !a.startsWith('--'));
if (!ruta) { console.error('Uso: npm run importar -- planilla.xlsx [--aplicar] [--incluir-prueba] [--informe=informe.md]'); process.exit(1); }
const rutaDecisiones = args.find((a) => a.startsWith('--decisiones='))?.split('=')[1] ?? new URL('./decisiones-importacion.json', import.meta.url);
const decisiones = JSON.parse(await readFile(rutaDecisiones, 'utf8').catch(() => '{}'));
const informe = args.find((a) => a.startsWith('--informe='))?.split('=')[1];

const db = crearDb();
try {
  const datos = await leerPlanilla(ruta);
  const inf = await importarPlanilla(db, datos, { aplicar: args.includes('--aplicar'), incluirPrueba: args.includes('--incluir-prueba'), decisiones });
  const md = formatearInforme(inf);
  console.log(md);
  if (informe) await writeFile(informe, md + '\n');
  if (!inf.aplicado) console.log('\nNo se guardó nada. Para cargar de verdad, repetí el comando con --aplicar.');
} catch (e) {
  console.error(`\nNo se pudo importar: ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
