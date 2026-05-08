#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.next-dev.pid"
LOG_FILE="$ROOT_DIR/.next-dev.log"
PORT="${PORT:-50038}"
SCREEN_SESSION="${SCREEN_SESSION:-cola-next-dev-${PORT}}"
NEXT_BIN="$ROOT_DIR/node_modules/.bin/next"
DB_CHECK_SCRIPT="$ROOT_DIR/scripts/check-office-db.mjs"
START_DB_SCRIPT="$ROOT_DIR/start-database.sh"
RUN_MODE="background"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--foreground)
      RUN_MODE="foreground"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--foreground|-f]"
      echo
      echo "Restarts the local Next.js dev server for this repo."
      echo "Default: restart in background and write logs to $LOG_FILE"
      echo "Foreground: replace this shell with the Next.js dev server"
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

process_cwd() {
  local pid="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | awk '
      /^n/ {
        sub(/^n/, "")
        print
        exit
      }
    '
  fi
}

process_belongs_to_repo() {
  local pid="$1"
  local command="${2:-}"
  local cwd=""
  local parent_pid=""
  local parent_command=""

  cwd="$(process_cwd "$pid")"
  if [[ "$cwd" == "$ROOT_DIR"* ]]; then
    return 0
  fi

  if [[ "$command" == *"$ROOT_DIR"* ]]; then
    return 0
  fi

  parent_pid="$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d '[:space:]')"
  if [[ "$parent_pid" =~ ^[0-9]+$ && "$parent_pid" != "1" ]]; then
    parent_command="$(ps -p "$parent_pid" -o command= 2>/dev/null || true)"
    if process_belongs_to_repo "$parent_pid" "$parent_command"; then
      return 0
    fi
  fi

  return 1
}

if [[ -f "$PID_FILE" ]]; then
  stored_pid="$(tr -d '[:space:]' < "$PID_FILE")"
  if [[ "$stored_pid" =~ ^[0-9]+$ ]]; then
    stop_pid "$stored_pid" "stored dev process"
  elif [[ "$stored_pid" == screen:* ]] && command -v screen >/dev/null 2>&1; then
    screen -S "${stored_pid#screen:}" -X quit >/dev/null 2>&1 || true
  fi
  rm -f "$PID_FILE"
fi

if command -v screen >/dev/null 2>&1; then
  screen -S "$SCREEN_SESSION" -X quit >/dev/null 2>&1 || true
fi

while IFS= read -r pid; do
  [[ -z "$pid" || "$pid" == "$$" ]] && continue
  stop_pid "$pid" "Next dev process"
done < <(find_repo_next_pids || true)

ensure_virtual_office_schema

if command -v lsof >/dev/null 2>&1; then
  while IFS= read -r pid; do
    [[ -z "$pid" || "$pid" == "$$" ]] && continue
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if process_belongs_to_repo "$pid" "$command"; then
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

started_with_screen=0
server_pid=""

if command -v screen >/dev/null 2>&1; then
  root_quoted="$(printf "%q" "$ROOT_DIR")"
  next_quoted="$(printf "%q" "$NEXT_BIN")"
  log_quoted="$(printf "%q" "$LOG_FILE")"
  port_quoted="$(printf "%q" "$PORT")"
  screen -dmS "$SCREEN_SESSION" bash -lc "cd $root_quoted && exec $next_quoted dev --turbo --port $port_quoted >> $log_quoted 2>&1"
  echo "screen:$SCREEN_SESSION" > "$PID_FILE"
  started_with_screen=1
else
  nohup "$NEXT_BIN" dev --turbo --port "$PORT" >> "$LOG_FILE" 2>&1 < /dev/null &
  server_pid=$!
  echo "$server_pid" > "$PID_FILE"
fi

for _ in {1..30}; do
  if [[ "$started_with_screen" -eq 1 ]]; then
    if ! (screen -list 2>/dev/null || true) | awk -v session="$SCREEN_SESSION" '$0 ~ "\\." session "([[:space:]]|$)" { found = 1 } END { exit found ? 0 : 1 }'; then
      echo "Next dev server exited before becoming ready."
      rm -f "$PID_FILE"
      tail -n 40 "$LOG_FILE" || true
      exit 1
    fi
  elif ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Next dev server exited before becoming ready."
    rm -f "$PID_FILE"
    tail -n 40 "$LOG_FILE" || true
    exit 1
  fi

  if command -v lsof >/dev/null 2>&1; then
    listener_pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
    if [[ -n "$listener_pid" ]]; then
      echo "$listener_pid" > "$PID_FILE"
      echo "Next dev server restarted successfully."
      echo "PID: $listener_pid"
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
