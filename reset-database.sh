#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
SEED_OFFICE=0

usage() {
  cat <<'EOF'
Usage: ./reset-database.sh [options]

Starts the local Postgres container, clears the current database schema,
runs migrations, and optionally seeds demo data.

Options:
  --seed-office        Run `npm run db:setup:office` after the reset
  -h, --help           Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed-office)
      SEED_OFFICE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed." >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set in $ENV_FILE." >&2
  exit 1
fi

database_url="${DATABASE_URL#*://}"
if [[ "$database_url" != *"@"* || "$database_url" != */* ]]; then
  echo "Unsupported DATABASE_URL format: $DATABASE_URL" >&2
  exit 1
fi

credentials="${database_url%%@*}"
host_and_path="${database_url#*@}"
database_name="${host_and_path#*/}"
database_name="${database_name%%\?*}"
database_user="${credentials%%:*}"
database_container_name="${DB_CONTAINER_NAME:-${database_name}-postgres}"

if command -v docker >/dev/null 2>&1; then
  CONTAINER_CMD="docker"
elif command -v podman >/dev/null 2>&1; then
  CONTAINER_CMD="podman"
else
  echo "Docker or Podman is not installed." >&2
  exit 1
fi

echo "Ensuring local database container is running..."
"$ROOT_DIR/start-database.sh"

echo "Waiting for database container '$database_container_name' to become ready..."
ready=0
for _ in {1..30}; do
  if "$CONTAINER_CMD" exec "$database_container_name" \
    pg_isready -U "$database_user" -d "$database_name" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" -ne 1 ]]; then
  echo "Database container '$database_container_name' did not become ready in time." >&2
  exit 1
fi

echo "Resetting schema for database '$database_name'..."
"$CONTAINER_CMD" exec "$database_container_name" \
  psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database_name" \
  -c "DROP SCHEMA IF EXISTS drizzle CASCADE;" \
  -c "DROP SCHEMA IF EXISTS public CASCADE;" \
  -c "CREATE SCHEMA public;" \
  -c "GRANT ALL ON SCHEMA public TO \"$database_user\";" \
  -c "GRANT ALL ON SCHEMA public TO public;"

if [[ "$SEED_OFFICE" -eq 1 ]]; then
  echo "Running migrations and office seed data..."
  (
    cd "$ROOT_DIR"
    npm run db:setup:office
  )
else
  echo "Running migrations..."
  (
    cd "$ROOT_DIR"
    npm run db:migrate
  )
fi

echo "Database reset completed."
