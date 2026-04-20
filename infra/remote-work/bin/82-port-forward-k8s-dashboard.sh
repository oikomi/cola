#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
NAMESPACE="kubernetes-dashboard"
SERVICE_NAME="kubernetes-dashboard-kong-proxy"
LOCAL_PORT="8443"
REMOTE_PORT="443"
ADDRESS="0.0.0.0"
FOREGROUND=0
SHOW_STATUS=0
STOP_RUNNING=0
PID_FILE="$RUNTIME_DIR/k8s-dashboard-port-forward.pid"
LOG_FILE="$RUNTIME_DIR/k8s-dashboard-port-forward.log"

usage() {
  cat <<'EOF'
Usage: ./bin/82-port-forward-k8s-dashboard.sh [options]

Start a port-forward for the Kubernetes Dashboard Kong proxy service.
Default behavior: bind 0.0.0.0:8443 and run in the background.

Options:
  --namespace <name>     Namespace, default kubernetes-dashboard
  --service <name>       Service name, default kubernetes-dashboard-kong-proxy
  --local-port <port>    Local bind port, default 8443
  --remote-port <port>   Remote service port, default 443
  --address <addr>       Bind address, default 0.0.0.0
  --foreground           Run in foreground instead of background
  --status               Show current background process status
  --stop                 Stop the current background process
  -h, --help             Show help
EOF
}

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --service)
      SERVICE_NAME="$2"
      shift 2
      ;;
    --local-port)
      LOCAL_PORT="$2"
      shift 2
      ;;
    --remote-port)
      REMOTE_PORT="$2"
      shift 2
      ;;
    --address)
      ADDRESS="$2"
      shift 2
      ;;
    --foreground)
      FOREGROUND=1
      shift
      ;;
    --status)
      SHOW_STATUS=1
      shift
      ;;
    --stop)
      STOP_RUNNING=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

ensure_runtime_dirs

if [[ "$SHOW_STATUS" -eq 1 ]]; then
  if is_running; then
    echo "Dashboard port-forward is running."
    echo "PID: $(cat "$PID_FILE")"
    echo "LOG: $LOG_FILE"
  else
    echo "Dashboard port-forward is not running."
  fi
  exit 0
fi

if [[ "$STOP_RUNNING" -eq 1 ]]; then
  if is_running; then
    kill "$(cat "$PID_FILE")"
    rm -f "$PID_FILE"
    echo "Stopped dashboard port-forward."
  else
    echo "Dashboard port-forward is not running."
  fi
  exit 0
fi

run_cluster_kubectl -n "$NAMESPACE" get service "$SERVICE_NAME" >/dev/null

if [[ "$FOREGROUND" -eq 1 ]]; then
  echo "Port-forward listening on ${ADDRESS}:${LOCAL_PORT} -> svc/${SERVICE_NAME}:${REMOTE_PORT}"
  run_cluster_kubectl -n "$NAMESPACE" port-forward --address "$ADDRESS" "svc/${SERVICE_NAME}" "${LOCAL_PORT}:${REMOTE_PORT}"
  exit 0
fi

if is_running; then
  echo "Dashboard port-forward is already running."
  echo "PID: $(cat "$PID_FILE")"
  echo "LOG: $LOG_FILE"
  exit 0
fi

sudo -v
nohup bash "$SCRIPT_PATH" \
  --namespace "$NAMESPACE" \
  --service "$SERVICE_NAME" \
  --local-port "$LOCAL_PORT" \
  --remote-port "$REMOTE_PORT" \
  --address "$ADDRESS" \
  --foreground \
  >"$LOG_FILE" 2>&1 &
echo "$!" > "$PID_FILE"

echo "Dashboard port-forward started in background."
echo "PID: $(cat "$PID_FILE")"
echo "LOG: $LOG_FILE"
echo "URL: https://${ADDRESS}:${LOCAL_PORT}/"
