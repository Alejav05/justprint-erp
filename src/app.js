import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { config } from './config.js';
import rutasAuth from './routes/auth.js';
import rutasClientes from './routes/clientes.js';
import rutasCartera from './routes/cartera.js';
import rutasUsuarios from './routes/usuarios.js';
import rutasAuditoria from './routes/auditoria.js';
import rutasTableros from './routes/tableros.js';
import rutasTickets from './routes/tickets.js';
import rutasEquipos from './routes/equipos.js';
import rutasInsumos from './routes/insumos.js';
import rutasFacturacion from './routes/facturacion.js';
import rutasCobranzas from './routes/cobranzas.js';
import rutasAdmin from './routes/admin.js';
import rutasRubros from './routes/rubros.js';
import rutasLeads from './routes/leads.js';
import rutasContratos from './routes/contratos.js';
import { cargarAjustes, moduloDeUrl, modulosOcultos } from './lib/ajustes_sistema.js';
import rutasAjustes from './routes/ajustes.js';
import rutasTablerosAreas from './routes/tableros_areas.js';
import rutasAlertas from './routes/alertas.js';
import { asegurarReglas } from './lib/alertas.js';
import { ultimaCotizacion } from './lib/cotizacion.js';
import { requerirSesion } from './plugins/auth.js';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';

export async function crearApp({ db, logger = false } = {}) {
  const app = Fastify({ logger, trustProxy: true });
  await app.register(cookie);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    if (config.env === 'production') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // Defensa contra pedidos de otros sitios: si el navegador envía Origin en una escritura, tiene que ser el nuestro.
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && req.headers.origin) {
      const esperado = config.origenPermitido ?? `${req.protocol}://${req.headers.host}`;
      if (req.headers.origin !== esperado) return reply.code(403).send({ error: 'origen_no_permitido' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validacion', detalles: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })) });
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'solicitud_invalida' });
    req.log.error(err); if (process.env.DEBUG_ERRORES) console.error(err);
    return reply.code(500).send({ error: 'error_interno' });
  });

  app.get('/api/salud', async () => {
    await db.raw('select 1');
    return { ok: true };
  });

  await cargarAjustes(db).catch(() => {});
  // Un módulo oculto desde Configuración deja de responder para todos (el menú también lo esconde).
  app.addHook('onRequest', async (req, reply) => {
    const oc = modulosOcultos(); if (!oc.length) return;
    const k = moduloDeUrl(req.url); if (k && oc.includes(k)) return reply.code(404).send({ error: 'modulo_oculto' });
  });
  await app.register(rutasAuth, { db });
  await app.register(rutasClientes, { db });
  await app.register(rutasCartera, { db });
  await app.register(rutasUsuarios, { db });
  await app.register(rutasAuditoria, { db });
  await app.register(rutasTableros, { db });
  await app.register(rutasTickets, { db });
  await app.register(rutasEquipos, { db });
  await app.register(rutasInsumos, { db });
  await app.register(rutasFacturacion, { db });
  await app.register(rutasCobranzas, { db });
  await app.register(rutasAdmin, { db });
  await app.register(rutasContratos, { db });
  await app.register(rutasRubros, { db });
  await app.register(rutasLeads, { db });
  await app.register(rutasAjustes, { db });
  await app.register(rutasTablerosAreas, { db });
  await app.register(rutasAlertas, { db });
  await asegurarReglas(db).catch(() => {});
  app.get('/api/cotizacion', { preHandler: requerirSesion(db) }, async () => (await ultimaCotizacion(db)) ?? { valor: null });
  await app.register(fastifyStatic, { root: fileURLToPath(new URL('../public/', import.meta.url)), maxAge: config.env === 'production' ? '1h' : 0 });
  return app;
}
