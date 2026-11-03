// Portal de clientes: tokens, sesiones y envío del enlace de ingreso.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { canales } from './canales.js';
import { auditar } from './audit.js';

export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const nuevoToken = () => crypto.randomBytes(32).toString('base64url');
const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
export const ahora = () => sql(Date.now());
export const dentroDe = (minutos) => sql(Date.now() + minutos * 60000);
export const COOKIE = 'jp_portal';
export const SESION_DIAS = Number(process.env.PORTAL_SESION_DIAS || 14);

export const baseUrl = (req) => config.appUrl || `${req.protocol}://${req.headers.host}`;

/** Crea un enlace de un solo uso y devuelve el token (solo se guarda su hash). */
export async function crearEnlace(db, accesoId, { tipo = 'ingreso', minutos = 30, creadoPor = null } = {}) {
  const token = nuevoToken();
  await db('portal_enlaces').insert({ id: hashToken(token), acceso_id: accesoId, tipo, creado_por: creadoPor, expira_en: dentroDe(minutos) });
  return token;
}

export const urlEnlace = (req, token) => `${baseUrl(req)}/portal/#/entrar/${token}`;

/** Manda el enlace por mail. Devuelve true si salió; false si el mail no está configurado o falló. */
export async function enviarEnlace(acceso, url, { invitacion = false } = {}) {
  if (!canales.mail.configurado()) return false;
  const nombre = String(acceso.nombre || '').split(' ')[0];
  const subject = invitacion ? 'Tu acceso al portal de JustPrint' : 'Tu enlace para ingresar a JustPrint';
  const text = invitacion
    ? `Hola ${nombre},\n\nYa podés ver tus equipos, contadores, conformidades, remitos y facturas en tu portal de JustPrint.\n\nIngresá desde este enlace y elegí tu contraseña:\n${url}\n\nEl enlace sirve una sola vez y vence en 7 días. Después vas a entrar con este mismo mail y tu contraseña.\n\nJustPrint · soporte@justprint.com.ar`
    : `Hola ${nombre},\n\nIngresá a tu portal de JustPrint desde este enlace:\n${url}\n\nSirve una sola vez y vence en 30 minutos. Si no lo pediste vos, ignorá este mensaje.\n\nJustPrint · soporte@justprint.com.ar`;
  try { await canales.mail.enviar({ to: acceso.email, subject, text }); return true; } catch { return false; }
}

/** Sesión del portal: devuelve el token para la cookie. */
export async function crearSesionPortal(db, accesoId, req, { vistaPor = null } = {}) {
  const token = nuevoToken();
  const expira = vistaPor ? new Date(Date.now() + 3600e3) : new Date(Date.now() + SESION_DIAS * 86400e3);
  await db('portal_sesiones').insert({ id: hashToken(token), acceso_id: accesoId, vista_por: vistaPor, expira_en: sql(expira.getTime()), ip: req.ip });
  return { token, expira };
}

/** Suma meses a una fecha AAAA-MM-DD. */
export function sumarMeses(fecha, meses) {
  const [a, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  const t = a * 12 + (m - 1) + meses;
  const na = Math.floor(t / 12); const nm = (t % 12) + 1;
  const ult = new Date(Date.UTC(na, nm, 0)).getUTCDate();
  return `${na}-${String(nm).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`;
}
export const mesesEntre = (desde, hasta) => {
  const [a, m] = desde.slice(0, 7).split('-').map(Number); const [b, n] = hasta.slice(0, 7).split('-').map(Number);
  return (b - a) * 12 + (n - m);
};

const ACCION = { portal_invitar: 'crear', portal_baja: 'editar', portal_alta: 'editar', portal_reenviar: 'editar', portal_clave: 'editar', portal_ingreso_enlace: 'login', portal_login: 'login', portal_ver_como: 'otro' };
/** Registra un hecho del portal en la auditoría (audit_log solo admite acciones fijas: el evento queda en el detalle). */
export const auditarPortal = (db, ctx, evento, accesoId, extra = {}) => auditar(db, ctx, ACCION[evento] ?? 'otro', 'portal_accesos', accesoId, null, { evento, ...extra });

/** El día anterior (un contrato de 12 meses desde el 1/1 termina el 31/12). */
export const diaAnterior = (f) => new Date(Date.parse(`${String(f).slice(0, 10)}T00:00:00Z`) - 86400e3).toISOString().slice(0, 10);
