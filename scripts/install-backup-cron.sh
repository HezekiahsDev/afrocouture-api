#!/usr/bin/env bash
# Installs (or updates) a daily crontab entry that runs backup-db.sh. Safe to run again.
#
#   bash scripts/install-backup-cron.sh            # daily at 02:30 server time
#   BACKUP_CRON="0 */6 * * *" bash scripts/install-backup-cron.sh
#   bash scripts/install-backup-cron.sh --remove
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/db-env.sh

MARKER="# afrocouture-db-backup"
BACKUP_CRON="${BACKUP_CRON:-30 2 * * *}"
BACKUP_DIR="$(env_get BACKUP_DIR "$HOME/backups/afrocouture")"
repo="$(pwd)"

current="$(crontab -l 2>/dev/null | grep -vF "$MARKER" || true)"

if [[ "${1:-}" == "--remove" ]]; then
  printf '%s\n' "$current" | sed '/^$/d' | crontab -
  echo "Removed the backup cron entry."
  exit 0
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
line="$BACKUP_CRON cd $repo && PATH=/usr/local/bin:/usr/bin:/bin bash scripts/backup-db.sh >> $BACKUP_DIR/backup.log 2>&1 $MARKER"
printf '%s\n%s\n' "$current" "$line" | sed '/^$/d' | crontab -
echo "Installed: $line"
echo "Run one now to check it works: bash scripts/backup-db.sh"
