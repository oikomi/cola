#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
REMOVE_DB=0
REMOVE_OPENCLAW_RUNNER=0
REMOVE_HERMES_RUNNER=0

usage() {
  cat <<'EOF'
Usage: ./cleanup-containers.sh [options]

Stops and removes local containers used by this repo.
If no option is provided, all supported containers are cleaned up.

Options:
  --db                Remove the local Postgres container
  --openclaw-runner   Remove the OpenClaw runner container
  --hermes-runner     Remove the Hermes runner container
  --all               Remove all supported containers
  -h, --help          Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)
      REMOVE_DB=1
      ;;
    --openclaw-runner)
      REMOVE_OPENCLAW_RUNNER=1
      ;;
    --hermes-runner)
      REMOVE_HERMES_RUNNER=1
      ;;
    --all)
      REMOVE_DB=1
      REMOVE_OPENCLAW_RUNNER=1
      REMOVE_HERMES_RUNNER=1
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

if [[ "$REMOVE_DB" -eq 0 && "$REMOVE_OPENCLAW_RUNNER" -eq 0 && "$REMOVE_HERMES_RUNNER" -eq 0 ]]; then
  REMOVE_DB=1
  REMOVE_OPENCLAW_RUNNER=1
  REMOVE_HERMES_RUNNER=1
fi

if command -v docker >/dev/null 2>&1; then
  CONTAINER_CMD="docker"
elif command -v podman >/dev/null 2>&1; then
  CONTAINER_CMD="podman"
else
  echo "Docker or Podman is not installed." >&2
  exit 1
fi

COMPOSE_CMD=()
if "$CONTAINER_CMD" compose version >/dev/null 2>&1; then
  COMPOSE_CMD=("$CONTAINER_CMD" "compose")
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=("docker-compose")
elif command -v podman-compose >/dev/null 2>&1; then
  COMPOSE_CMD=("podman-compose")
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

compose_down_or_remove() {
  local compose_file="$1"
  local container_name="$2"

  if [[ ${#COMPOSE_CMD[@]} -gt 0 ]]; then
    echo "Stopping compose stack from $compose_file ..."
    "${COMPOSE_CMD[@]}" -f "$compose_file" down --remove-orphans >/dev/null || true
  fi

  remove_container "$container_name"
}

if [[ "$REMOVE_DB" -eq 1 ]]; then
  remove_container "$database_container_name"
fi

if [[ "$REMOVE_OPENCLAW_RUNNER" -eq 1 ]]; then
  compose_down_or_remove "$ROOT_DIR/docker/openclaw-runner.compose.yml" "openclaw-runner-01"
fi

if [[ "$REMOVE_HERMES_RUNNER" -eq 1 ]]; then
  compose_down_or_remove "$ROOT_DIR/docker/hermes-runner.compose.yml" "hermes-runner-01"
fi

echo "Container cleanup completed."
