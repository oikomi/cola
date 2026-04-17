#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.next-dev.pid"
LOG_FILE="$ROOT_DIR/.next-dev.log"
PORT="${PORT:-50038}"
NEXT_BIN="$ROOT_DIR/node_modules/.bin/next"
DB_CHECK_SCRIPT="$ROOT_DIR/scripts/check-office-db.mjs"
START_DB_SCRIPT="$ROOT_DIR/start-database.sh"
RUN_MODE="background"
CLEAN_RUNNERS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--foreground)
      RUN_MODE="foreground"
      shift
      ;;
    --clean-runners)
      CLEAN_RUNNERS=1
      shift
      ;;
    --keep-runners)
      CLEAN_RUNNERS=0
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--foreground|-f]"
      echo
      echo "Restarts the local Next.js dev server for this repo."
      echo "Default: restart in background and write logs to $LOG_FILE"
      echo "Foreground: replace this shell with the Next.js dev server"
      echo "By default, dynamic cola Docker runner containers are preserved."
      echo "Use --clean-runners to remove runner containers before restart."
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--foreground|-f]"
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"

if [[ ! -x "$NEXT_BIN" ]]; then
  echo "Next.js is not installed. Run npm install first."
  exit 1
fi

load_env_file() {
  if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
  fi
}

run_db_check() {
  node "$DB_CHECK_SCRIPT"
}

ensure_virtual_office_schema() {
  if [[ ! -f "$DB_CHECK_SCRIPT" ]]; then
    return 0
  fi

  load_env_file

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is not set. Skipping Virtual Office database check."
    return 0
  fi

  local status=0
  if run_db_check; then
    return 0
  else
    status=$?
  fi

  if [[ "$status" -eq 3 && -x "$START_DB_SCRIPT" ]]; then
    echo "Database is unreachable. Attempting to start local database container..."
    if NON_INTERACTIVE=1 "$START_DB_SCRIPT"; then
      for _ in {1..30}; do
        if run_db_check; then
          return 0
        fi
        status=$?

        if [[ "$status" -ne 3 ]]; then
          break
        fi

        sleep 1
      done
    fi
  fi

  case "$status" in
    2)
      echo "Virtual Office tables are missing. Running migrations..."
      if npm run db:migrate; then
        echo "Virtual Office migrations applied."
      else
        echo "Virtual Office migration failed. Starting app with fallback office snapshot."
      fi
      ;;
    3)
      echo "Database is unreachable. Starting app with fallback office snapshot."
      ;;
    4)
      echo "DATABASE_URL is not set. Starting app without schema verification."
      ;;
    *)
      echo "Unexpected database readiness status: $status"
      ;;
  esac
}

stop_pid() {
  local pid="$1"
  local label="$2"

  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  echo "Stopping $label (PID $pid)..."
  kill "$pid" 2>/dev/null || true

  for _ in {1..10}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done

  echo "Force killing $label (PID $pid)..."
  kill -9 "$pid" 2>/dev/null || true
}

find_repo_next_pids() {
  ps ax -o pid=,command= | awk -v root="$ROOT_DIR" '
    index($0, root) && ($0 ~ /npm run dev/ || $0 ~ /next dev/ || $0 ~ /next\/dist\/bin\/next/) {
      print $1
    }
  '
}

cleanup_dynamic_runner_containers() {
  [[ "$CLEAN_RUNNERS" -eq 1 ]] || return 0

  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi

  local runner_names=""
  runner_names="$(
    docker ps -a --format '{{.Names}}' 2>/dev/null | awk '
      /^cola-[a-z0-9-]+-[0-9a-f]{8}$/ { print }
    '
  )"

  if [[ -z "$runner_names" ]]; then
    return 0
  fi

  echo "Removing dynamic Cola runner containers..."
  while IFS= read -r container_name; do
    [[ -n "$container_name" ]] || continue
    docker rm -f "$container_name" >/dev/null 2>&1 || true
    echo "Removed runner container: $container_name"
  done <<< "$runner_names"
}

if [[ -f "$PID_FILE" ]]; then
  stored_pid="$(tr -d '[:space:]' < "$PID_FILE")"
  if [[ "$stored_pid" =~ ^[0-9]+$ ]]; then
    stop_pid "$stored_pid" "stored dev process"
  fi
  rm -f "$PID_FILE"
fi

while IFS= read -r pid; do
  [[ -z "$pid" || "$pid" == "$$" ]] && continue
  stop_pid "$pid" "Next dev process"
done < <(find_repo_next_pids || true)

cleanup_dynamic_runner_containers

ensure_virtual_office_schema

if command -v lsof >/dev/null 2>&1; then
  while IFS= read -r pid; do
    [[ -z "$pid" || "$pid" == "$$" ]] && continue
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" == *"$ROOT_DIR"* ]]; then
      stop_pid "$pid" "port $PORT listener"
      continue
    fi

    echo "Port $PORT is already in use by another process:"
    echo "$command"
    exit 1
  done < <(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
fi

echo "Starting Next dev server on port $PORT..."
if [[ "$RUN_MODE" == "foreground" ]]; then
  echo "$$" > "$PID_FILE"
  exec "$NEXT_BIN" dev --turbo --port "$PORT"
fi

nohup "$NEXT_BIN" dev --turbo --port "$PORT" >> "$LOG_FILE" 2>&1 < /dev/null &
server_pid=$!
echo "$server_pid" > "$PID_FILE"

for _ in {1..30}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Next dev server exited before becoming ready."
    rm -f "$PID_FILE"
    tail -n 40 "$LOG_FILE" || true
    exit 1
  fi

  if command -v lsof >/dev/null 2>&1; then
    if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Next dev server restarted successfully."
      echo "PID: $server_pid"
      echo "Log: $LOG_FILE"
      exit 0
    fi
  else
    sleep 2
    echo "Next dev server restarted successfully."
    echo "PID: $server_pid"
    echo "Log: $LOG_FILE"
    exit 0
  fi

  sleep 1
done

echo "Next dev server is still starting."
echo "PID: $server_pid"
echo "Log: $LOG_FILE"
