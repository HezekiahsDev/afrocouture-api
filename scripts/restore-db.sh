#!/usr/bin/env bash
# Restores a dump made by backup-db.sh. Replaces every table in the target database.
#
#   bash scripts/restore-db.sh ~/backups/afrocouture/afrocouture-20261024-023000.dump [target_db]
#
# target_db defaults to DB_NAME and is created if it doesn't exist. Stop the API first when
# restoring over the live database (pm2 stop afrocouture-api), then start it again.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/db-env.sh

file="${1:-}"
target="${2:-$DB_NAME}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage: bash scripts/restore-db.sh <dump file> [target_db]" >&2
  exit 1
fi
if ! [[ "$target" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "Invalid database name: $target" >&2
  exit 1
fi

echo "This replaces all data in database \"$target\" with $(basename "$file")."
read -r -p "Type the database name ($target) to continue: " answer
if [[ "$answer" != "$target" ]]; then
  echo "Cancelled — nothing was changed."
  exit 1
fi

exists="$(pg_exec psql -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$target'")"
if [[ "$exists" != "1" ]]; then
  echo "Creating database $target"
  pg_exec createdb -U "$DB_USER" "$target"
fi

# One transaction: either the whole dump is restored or nothing changes.
pg_exec pg_restore -U "$DB_USER" -d "$target" --clean --if-exists --no-owner --no-privileges \
  --single-transaction --exit-on-error < "$file"
echo "Restored $(basename "$file") into $target."
