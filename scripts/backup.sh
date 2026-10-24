#!/bin/sh
# Copia de seguridad diaria de la base MySQL, con rotación.
# Cron sugerido (hPanel > Cron Jobs), todos los días 03:30:
#   30 3 * * * /bin/sh $HOME/justprint-erp/scripts/backup.sh
# Lee DB_HOST, DB_USER, DB_PASSWORD y DB_NAME del archivo .env.
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$DIR/.env" ] && { set -a; . "$DIR/.env"; set +a; }
DESTINO="${BACKUP_DIR:-$HOME/backups-justprint}"
DIAS="${BACKUP_DIAS:-14}"
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
ARCHIVO="$DESTINO/justprint-$(date +%Y%m%d-%H%M%S).sql.gz"
MYSQL_PWD="$DB_PASSWORD" mysqldump -h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}" -u "$DB_USER" \
  --single-transaction --routines --no-tablespaces "$DB_NAME" | gzip > "$ARCHIVO"
chmod 600 "$ARCHIVO"
find "$DESTINO" -name 'justprint-*.sql.gz' -mtime +"$DIAS" -delete
echo "Backup listo: $ARCHIVO"

# Firmas de conformidad (archivos): se copian junto a la base.
STORAGE="${ARCHIVOS_DIR:-$DIR/storage}"
[ -d "$STORAGE" ] && tar -czf "$DESTINO/firmas-$(date +%Y%m%d).tar.gz" -C "$STORAGE" . && chmod 600 "$DESTINO/firmas-$(date +%Y%m%d).tar.gz" && find "$DESTINO" -name 'firmas-*.tar.gz' -mtime +"$DIAS" -delete
