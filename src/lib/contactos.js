import { z } from 'zod';
import { ROLES_CONTACTO } from './catalogo.js';
import { aDia, hoy, json } from './fechas.js';

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const contactoSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
  apellido: z.string().trim().max(120).optional().nullable(),
  cargo: z.string().trim().max(80).optional().nullable(),
  sede_id: z.number().int().positive().optional().nullable(),
  roles: z.array(z.enum(ROLES_CONTACTO)).max(9).default([]),
  telefonos: z.array(z.object({ tipo: z.enum(['celular', 'fijo', 'whatsapp', 'interno']).default('celular'), numero: z.string().trim().min(6).max(40) })).max(5).default([]),
  emails: z.array(z.object({ tipo: z.enum(['laboral', 'personal', 'facturacion', 'cobranzas']).default('laboral'), direccion: z.string().trim().toLowerCase().email().max(160) })).max(5).default([]),
  fecha_nacimiento: fechaISO.optional().nullable(),
  canal_preferido: z.enum(['whatsapp', 'llamada', 'mail', 'presencial']).optional().nullable(),
  horario_preferido: z.string().trim().max(60).optional().nullable(),
  autorizado_toner: z.boolean().default(false),
  acepta_comunicaciones: z.boolean().default(false),
  linkedin: z.string().trim().max(200).optional().nullable(),
  intereses: z.string().trim().max(2000).optional().nullable(),
  notas: z.string().trim().max(2000).optional().nullable(),
});

/** Reglas que dependen de varios campos. Devuelve el código de error o null. */
export function validarContacto(c) {
  if (!c.telefonos.length && !c.emails.length) return 'contacto_sin_medio';
  if (c.roles.includes('facturacion') && !c.emails.length) return 'facturacion_sin_mail';
  if (c.fecha_nacimiento) {
    const a = Number(c.fecha_nacimiento.slice(0, 4));
    if (Number.isNaN(Date.parse(c.fecha_nacimiento)) || a < 1920 || c.fecha_nacimiento > hoy()) return 'nacimiento_invalido';
  }
  return null;
}

export function aFila(c, extra = {}) {
  return {
    nombre: c.nombre, apellido: c.apellido ?? null, cargo: c.cargo ?? null, sede_id: c.sede_id ?? null,
    roles: JSON.stringify(c.roles), telefonos: JSON.stringify(c.telefonos), emails: JSON.stringify(c.emails),
    fecha_nacimiento: c.fecha_nacimiento ?? null, canal_preferido: c.canal_preferido ?? null, horario_preferido: c.horario_preferido ?? null,
    autorizado_toner: c.autorizado_toner, acepta_comunicaciones: c.acepta_comunicaciones, linkedin: c.linkedin ?? null,
    intereses: c.intereses ?? null, notas: c.notas ?? null, ...extra,
  };
}

const MS = 86400000;
/** Edad, próximo cumpleaños y cuántos días faltan, calculados contra `ref` (AAAA-MM-DD). */
export function datosDeNacimiento(nac, ref = hoy()) {
  const n = aDia(nac); if (!n) return { edad: null, proximo_cumple: null, dias_para_cumple: null };
  const [y, m, d] = n.split('-').map(Number); const [ry, rm, rd] = ref.split('-').map(Number);
  let edad = ry - y; if (rm < m || (rm === m && rd < d)) edad -= 1;
  let anio = ry; let prox = Date.UTC(anio, m - 1, d); const hoyUtc = Date.UTC(ry, rm - 1, rd);
  if (prox < hoyUtc) { anio += 1; prox = Date.UTC(anio, m - 1, d); }
  return { edad, proximo_cumple: new Date(prox).toISOString().slice(0, 10), dias_para_cumple: Math.round((prox - hoyUtc) / MS), cumple_anios: anio - y };
}

export function armarContacto(c) {
  return { ...c, fecha_nacimiento: aDia(c.fecha_nacimiento), roles: json(c.roles, []), telefonos: json(c.telefonos, []), emails: json(c.emails, []),
    etiquetas: json(c.etiquetas, []), fechas_clave: json(c.fechas_clave, []), ...datosDeNacimiento(c.fecha_nacimiento) };
}
