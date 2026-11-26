// Arma dist/agente-contadores.exe: un solo archivo para Windows (x64) que no necesita Node instalado.
// Usa Single Executable Applications de Node: se junta todo el código en un .cjs con esbuild, se genera el blob
// y se inyecta en una copia de node.exe. Corre en cualquier sistema: si no está en Windows baja el node.exe oficial.
//   npm run empaquetar                → dist/agente-contadores.exe
//   NODE_WIN=C:\ruta\node.exe npm run empaquetar   (usar un node.exe ya bajado)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(raiz, 'dist'); fs.mkdirSync(dist, { recursive: true });
const salida = path.join(dist, 'agente-contadores.exe');

await build({ entryPoints: [path.join(raiz, 'src/index.js')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: path.join(dist, 'agente.cjs'), logLevel: 'warning' });

const sea = path.join(dist, 'sea-config.json');
fs.writeFileSync(sea, JSON.stringify({ main: path.join(dist, 'agente.cjs'), output: path.join(dist, 'agente.blob'), disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
execFileSync(process.execPath, ['--experimental-sea-config', sea], { stdio: 'inherit' });

let nodeWin = process.env.NODE_WIN;
if (!nodeWin && process.platform === 'win32') nodeWin = process.execPath;
if (!nodeWin) {
  // Mismo número de versión que el Node que genera el blob (el blob depende de la versión).
  const v = process.version; const zip = path.join(dist, `node-${v}-win-x64.zip`);
  nodeWin = path.join(dist, `node-${v}-win-x64`, 'node.exe');
  if (!fs.existsSync(nodeWin)) {
    console.log(`Bajando node.exe ${v} para Windows…`);
    const r = await fetch(`https://nodejs.org/dist/${v}/node-${v}-win-x64.zip`);
    if (!r.ok) throw new Error(`No se pudo bajar node.exe (${r.status})`);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    execFileSync('unzip', ['-q', '-o', zip, `node-${v}-win-x64/node.exe`, '-d', dist], { stdio: 'inherit' });
  }
}
fs.copyFileSync(nodeWin, salida);
execFileSync(process.execPath, [path.join(raiz, 'node_modules/postject/dist/cli.js'), salida, 'NODE_SEA_BLOB', path.join(dist, 'agente.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { stdio: 'inherit' });
console.log(`Listo: ${salida} (${(fs.statSync(salida).size / 1048576).toFixed(1)} MB)`);
