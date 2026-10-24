import { z } from 'zod';
import { config } from '../config.js';
import { auditar } from '../lib/audit.js';
import { verificar } from '../lib/passwords.js';
import { crearSesion, hashToken, requerirSesion } from '../plugins/auth.js';

const MAX_FALLOS = 5;
const BLOQUEO_MIN = 15;
const VENTANA_IP_MS = 10 * 60 * 1000;
const MAX_INTENTOS_IP = 30;

const loginSchema = z.object({ email: z.string().email().max(160), password: z.string().min(1).max(200) });

export default async function rutasAuth(app, { db }) {
  const porIp = new Map(); // limitador simple en memoria: suficiente para una instancia

  function limitarIp(ip) {
    const ahora = Date.now();
    const lista = (porIp.get(ip) || []).filter((t) => ahora - t < VENTANA_IP_MS);
    lista.push(ahora);
    porIp.set(ip, lista);
    return lista.length > MAX_INTENTOS_IP;
  }

  app.post('/api/auth/login', async (req, reply) => {
    if (limitarIp(req.ip)) return reply.code(429).send({ error: 'demasiados_intentos' });
    const datos = loginSchema.parse(req.body);
    const email = datos.email.toLowerCase();

    const u = await db('usuarios').where({ email }).whereNull('deleted_at').first();
    const bloqueado = u?.bloqueado_hasta && new Date(u.bloqueado_hasta.replace(' ', 'T') + 'Z') > new Date();
    const ok = await verificar(datos.password, u?.password_hash);

    if (!u || !u.activo || bloqueado || !ok) {
      if (u && !bloqueado && !ok) {
        const fallos = u.intentos_fallidos + 1;
        const cambios = { intentos_fallidos: fallos };
        if (fallos >= MAX_FALLOS) {
          cambios.bloqueado_hasta = new Date(Date.now() + BLOQUEO_MIN * 60000).toISOString().slice(0, 19).replace('T', ' ');
          cambios.intentos_fallidos = 0;
        }
        await db('usuarios').where({ id: u.id }).update(cambios);
      }
      await auditar(db, { usuarioId: u?.id ?? null, ip: req.ip }, 'login_fallido', 'usuarios', u?.id ?? null, null, { email });
      // Mismo mensaje en todos los casos: no revela si el mail existe.
      return reply.code(401).send({ error: 'credenciales_invalidas' });
    }

    await db('usuarios').where({ id: u.id }).update({
      intentos_fallidos: 0, bloqueado_hasta: null, ultimo_ingreso: db.fn.now(),
    });
    const { token, expira } = await crearSesion(db, u.id, req);
    await auditar(db, { usuarioId: u.id, ip: req.ip }, 'login', 'usuarios', u.id);
    reply.setCookie(config.cookie, token, {
      httpOnly: true, sameSite: 'lax', secure: config.env === 'production', path: '/', expires: expira,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', { preHandler: requerirSesion(db) }, async (req, reply) => {
    await db('sesiones').where({ id: hashToken(req.cookies[config.cookie]) }).delete();
    await auditar(db, { usuarioId: req.ctx.id, ip: req.ip }, 'logout', 'usuarios', req.ctx.id);
    reply.clearCookie(config.cookie, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requerirSesion(db) }, async (req) => {
    const c = req.ctx;
    return { id: c.id, nombre: c.nombre, email: c.email, rol: c.rol, permisos: [...c.permisos].sort(), areas: c.areas };
  });
}
