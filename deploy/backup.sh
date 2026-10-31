#!/usr/bin/env bash
# Nightly backup of the database and uploaded images; keeps the last 14 days.
# Needs ~/.pgpass with the database password (see docs/DEPLOY.md). Schedule with `crontab -e`:
#   30 2 * * * /home/sabilling/salonbilling/deploy/backup.sh >> /home/sabilling/backups/backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-$HOME/uploads}"
DB_NAME="${DB_NAME:-sabilling}"
DB_USER="${DB_USER:-sabilling}"
STAMP="$(date +%F)"

mkdir -p "$BACKUP_DIR"
pg_dump -h 127.0.0.1 -U "$DB_USER" -Fc "$DB_NAME" > "$BACKUP_DIR/db-$STAMP.dump"
if [ -d "$UPLOADS_DIR" ]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
fi
find "$BACKUP_DIR" -name 'db-*.dump' -mtime +14 -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +14 -delete
echo "$(date -Is) backup done: $BACKUP_DIR/db-$STAMP.dump"
