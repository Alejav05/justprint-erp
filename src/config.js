import 'dotenv/config';

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  sesionHoras: Number(process.env.SESSION_HOURS || 12),
  cookie: 'jp_sid',
  archivosDir: process.env.ARCHIVOS_DIR || new URL('../storage/', import.meta.url).pathname,
  origenPermitido: process.env.ALLOWED_ORIGIN || null,
};
