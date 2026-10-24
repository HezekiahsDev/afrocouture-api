# Shared by backup-db.sh / restore-db.sh. Reads the DB_* settings from the environment,
# falling back to the API's .env, and builds the command that runs tools inside Postgres.

ENV_FILE="${ENV_FILE:-$(pwd)/.env}"

# env_get KEY DEFAULT — the environment wins, then .env, then the default.
env_get() {
  local key="$1" default="${2:-}" value=""
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return
  fi
  if [[ -f "$ENV_FILE" ]]; then
    value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
  fi
  printf '%s' "${value:-$default}"
}

DB_NAME="$(env_get DB_NAME afrocouture)"
DB_USER="$(env_get DB_USER afrocouture)"
DB_PASSWORD="$(env_get DB_PASSWORD)"
# A named container (e.g. PG_CONTAINER=afrocouture-dev-pg); otherwise the compose service.
PG_CONTAINER="${PG_CONTAINER:-}"
PG_SERVICE="${PG_SERVICE:-postgres}"

# pg_exec CMD... — runs a Postgres client tool inside the database container, stdin attached.
pg_exec() {
  if [[ -n "$PG_CONTAINER" ]]; then
    docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" "$@"
  else
    docker compose exec -T -e PGPASSWORD="$DB_PASSWORD" "$PG_SERVICE" "$@"
  fi
}
