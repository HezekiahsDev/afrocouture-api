#!/usr/bin/env bash
# Dumps the AfroCouture database (pg_dump custom format) into BACKUP_DIR and prunes old dumps.
#
#   bash scripts/backup-db.sh
#
# Settings (environment, else .env, else default):
#   BACKUP_DIR            ~/backups/afrocouture
#   BACKUP_KEEP_DAYS      14
#   BACKUP_RCLONE_REMOTE  optional, e.g. "gdrive:afrocouture-backups" — also copies each dump off the server
#   BACKUP_REMOTE_KEEP_DAYS  90; dumps older than this are deleted from the remote
#   PG_CONTAINER          optional container name; default is the "postgres" compose service
#   ALERT_WEBHOOK_URL     optional; posted to if the backup fails
set -Eeuo pipefail
cd "$(dirname "$0")/.."
source scripts/db-env.sh

BACKUP_DIR="$(env_get BACKUP_DIR "$HOME/backups/afrocouture")"
BACKUP_KEEP_DAYS="$(env_get BACKUP_KEEP_DAYS 14)"
BACKUP_RCLONE_REMOTE="$(env_get BACKUP_RCLONE_REMOTE)"
BACKUP_REMOTE_KEEP_DAYS="$(env_get BACKUP_REMOTE_KEEP_DAYS 90)"
ALERT_WEBHOOK_URL="$(env_get ALERT_WEBHOOK_URL)"

stamp="$(date -u +%Y%m%d-%H%M%S)"
file="$BACKUP_DIR/${DB_NAME}-${stamp}.dump"
tmp="$file.partial"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

failed=""
on_error() {
  local line="$1"
  # With set -E the trap also fires in the failing function; report once. Use stderr, since
  # stdout may be the dump file at this point.
  [[ -n "$failed" ]] && return
  failed=1
  rm -f "$tmp"
  log "BACKUP FAILED (line $line). No new dump was written for ${DB_NAME}." >&2
  if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
    local text="[AfroCouture] Database backup FAILED on $(hostname) at $(date -u +%FT%TZ). Check $BACKUP_DIR/backup.log."
    curl -fsS -m 10 -H 'Content-Type: application/json' \
      -d "{\"text\":\"$text\",\"content\":\"$text\"}" "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
}
trap 'on_error $LINENO' ERR

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

log "Backing up ${DB_NAME} to ${file}"
pg_exec pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner --no-privileges > "$tmp"

# A dump that pg_restore can't list is not a backup.
if [[ ! -s "$tmp" ]] || ! pg_exec pg_restore --list < "$tmp" > /dev/null; then
  log "The dump is empty or unreadable."
  false
fi
mv "$tmp" "$file"
chmod 600 "$file"
log "Wrote $(du -h "$file" | cut -f1) — $(pg_exec pg_restore --list < "$file" | grep -c 'TABLE DATA') tables"

if [[ -n "$BACKUP_RCLONE_REMOTE" ]]; then
  log "Copying to ${BACKUP_RCLONE_REMOTE}"
  rclone copy "$file" "$BACKUP_RCLONE_REMOTE"
  rclone delete "$BACKUP_RCLONE_REMOTE" --min-age "${BACKUP_REMOTE_KEEP_DAYS}d" --include "${DB_NAME}-*.dump"
fi

pruned="$(find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.dump" -mtime +"$BACKUP_KEEP_DAYS" -print -delete | wc -l)"
log "Done. Pruned ${pruned} dump(s) older than ${BACKUP_KEEP_DAYS} days."
