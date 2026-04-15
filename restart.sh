#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.next-dev.pid"
LOG_FILE="$ROOT_DIR/.next-dev.log"
PORT="${PORT:-3000}"
NEXT_BIN="$ROOT_DIR/node_modules/.bin/next"
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
