// Carga inicial desde la planilla de Google Sheets, desde Configuración (solo Dirección).
// Primero se hace un ensayo (no guarda nada) y después se aplica. Solo funciona con la base sin clientes.
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requerirPermiso, requerirSesion } from '../plugins/auth.js';

const DECISIONES = new URL('../../scripts/decisiones-importacion.json', import.meta.url);

export default async function rutasImportar(app, { db }) {
  // El archivo llega como cuerpo binario; el parser vale solo para este plugin.
  app.addContentTypeParser(['application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 }, (req, body, done) => done(null, body));

  app.post('/api/admin/importar', { preHandler: [requerirSesion(db), requerirPermiso('sistema.configurar')], bodyLimit: 25 * 1024 * 1024 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) return reply.code(400).send({ error: 'archivo_invalido' });
    const aplicar = req.query.aplicar === '1';
    const ruta = join(tmpdir(), `planilla-${randomUUID()}.xlsx`);
    await writeFile(ruta, req.body);
    try {
      // Carga perezosa: si faltara la librería, solo falla esta pantalla y no toda la app.
      const { leerPlanilla } = await import('../importacion/lector.js');
      const { importarPlanilla, formatearInforme } = await import('../importacion/planilla.js');
      const datos = await leerPlanilla(ruta);
      const decisiones = JSON.parse(await readFile(DECISIONES, 'utf8').catch(() => '{}'));
      const inf = await importarPlanilla(db, datos, { aplicar, decisiones });
      return { aplicado: !!inf.aplicado, informe: formatearInforme(inf) };
    } catch (e) {
      req.log.error(e);
      return reply.code(400).send({ error: 'importacion_fallida', mensaje: e.message });
    } finally {
      await unlink(ruta).catch(() => {});
    }
  });
}
