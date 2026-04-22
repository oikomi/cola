#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
REMOVE_DB=0

usage() {
  cat <<'EOF'
Usage: ./cleanup-containers.sh [options]

Stops and removes local containers used by this repo.
If no option is provided, all supported containers are cleaned up.

Options:
  --db                Remove the local Postgres container
  --all               Remove all supported containers
  -h, --help          Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)
      REMOVE_DB=1
      ;;
    --all)
      REMOVE_DB=1
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

if [[ "$REMOVE_DB" -eq 0 ]]; then
  REMOVE_DB=1
fi

if command -v docker >/dev/null 2>&1; then
  CONTAINER_CMD="docker"
elif command -v podman >/dev/null 2>&1; then
  CONTAINER_CMD="podman"
else
  echo "Docker or Podman is not installed." >&2
  exit 1
fi

database_container_name="${DB_CONTAINER_NAME:-}"
if [[ -z "$database_container_name" && -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a

  if [[ -n "${DATABASE_URL:-}" ]]; then
    database_url="${DATABASE_URL#*://}"
    host_and_path="${database_url#*@}"
    database_name="${host_and_path#*/}"
    database_name="${database_name%%\?*}"
    database_container_name="${database_name}-postgres"
  fi
fi

database_container_name="${database_container_name:-cola-postgres}"

container_exists() {
  local container_name="$1"
  "$CONTAINER_CMD" container inspect "$container_name" >/dev/null 2>&1
}

remove_container() {
  local container_name="$1"

  if container_exists "$container_name"; then
    echo "Removing container '$container_name' ..."
    "$CONTAINER_CMD" rm -f "$container_name" >/dev/null
    echo "Removed '$container_name'."
  else
    echo "Container '$container_name' does not exist, skipping."
  fi
}

if [[ "$REMOVE_DB" -eq 1 ]]; then
  remove_container "$database_container_name"
fi

echo "Container cleanup completed."
