// Tarea programada de Windows: corre todos los días a las 9 y repite cada 3 horas hasta las 21.
// Si la PC estaba apagada a esa hora, corre apenas se prende (StartWhenAvailable). Fuera de fin de mes no hace nada.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const NOMBRE_TAREA = 'JustPrint - Toma de contadores';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function xmlTarea(ejecutable, argumentos) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Lee los contadores de las impresoras de JustPrint a fin de mes y los envía al ERP.</Description></RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T09:00:00</StartBoundary>
      <Repetition><Interval>PT3H</Interval><Duration>PT12H</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(ejecutable)}</Command><Arguments>${esc(argumentos)}</Arguments></Exec></Actions>
</Task>`;
}

/** Ejecutable y argumentos para la tarea: el .exe empaquetado, o node + este script si se corre desde el código. */
export function comandoPropio() {
  const exe = process.execPath; const script = process.argv[1];
  const empaquetado = !script || path.resolve(script) === path.resolve(exe) || !/\.(c|m)?js$/i.test(script);
  return empaquetado ? { ejecutable: exe, argumentos: 'tarea' } : { ejecutable: exe, argumentos: `"${path.resolve(script)}" tarea` };
}

export function instalarTarea() {
  if (process.platform !== 'win32') throw new Error('La tarea programada se instala solo en Windows. En Linux usá cron: 0 9,12,15,18 * * * agente-contadores tarea');
  const { ejecutable, argumentos } = comandoPropio();
  const f = path.join(os.tmpdir(), 'jp-contadores-tarea.xml');
  fs.writeFileSync(f, `﻿${xmlTarea(ejecutable, argumentos)}`, 'utf16le');
  execFileSync('schtasks', ['/Create', '/TN', NOMBRE_TAREA, '/XML', f, '/F'], { stdio: 'inherit' });
  fs.rmSync(f, { force: true });
}

export function desinstalarTarea() {
  if (process.platform !== 'win32') throw new Error('Solo en Windows.');
  execFileSync('schtasks', ['/Delete', '/TN', NOMBRE_TAREA, '/F'], { stdio: 'inherit' });
}
