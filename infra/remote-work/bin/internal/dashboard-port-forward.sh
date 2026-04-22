#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

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
KUBECTL_BIN="$(kubectl_bin_path)"
DASHBOARD_KUBECONFIG="$(user_kubeconfig_path)"

usage() {
  cat <<'EOF'
Usage: ./bin/cluster.sh dashboard port-forward [options]

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

run_dashboard_kubectl() {
  KUBECONFIG="$DASHBOARD_KUBECONFIG" "$KUBECTL_BIN" "$@"
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

[[ -r "$DASHBOARD_KUBECONFIG" ]] || \
  die "找不到可读的用户 kubeconfig: $DASHBOARD_KUBECONFIG"

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

run_dashboard_kubectl -n "$NAMESPACE" get service "$SERVICE_NAME" >/dev/null

if [[ "$FOREGROUND" -eq 1 ]]; then
  echo "Port-forward listening on ${ADDRESS}:${LOCAL_PORT} -> svc/${SERVICE_NAME}:${REMOTE_PORT}"
  run_dashboard_kubectl -n "$NAMESPACE" port-forward --address "$ADDRESS" "svc/${SERVICE_NAME}" "${LOCAL_PORT}:${REMOTE_PORT}"
  exit 0
fi

if is_running; then
  echo "Dashboard port-forward is already running."
  echo "PID: $(cat "$PID_FILE")"
  echo "LOG: $LOG_FILE"
  exit 0
fi

BACKGROUND_COMMAND=$(
  printf '%s' "set -euo pipefail; "
  printf '%s' "echo $(printf '%q' "Port-forward listening on ${ADDRESS}:${LOCAL_PORT} -> svc/${SERVICE_NAME}:${REMOTE_PORT}"); "
  printf '%s' "exec env KUBECONFIG=$(printf '%q' "$DASHBOARD_KUBECONFIG") "
  printf '%s' "$(printf '%q' "$KUBECTL_BIN") -n $(printf '%q' "$NAMESPACE") port-forward --address $(printf '%q' "$ADDRESS") svc/$(printf '%q' "$SERVICE_NAME") $(printf '%q' "${LOCAL_PORT}:${REMOTE_PORT}")"
)

setsid bash -lc "$BACKGROUND_COMMAND" >"$LOG_FILE" 2>&1 < /dev/null &
echo "$!" > "$PID_FILE"

sleep 1
if ! kill -0 "$(cat "$PID_FILE")" >/dev/null 2>&1; then
  rm -f "$PID_FILE"
  echo "Dashboard port-forward 启动失败，日志如下：" >&2
  tail -n 50 "$LOG_FILE" >&2 || true
  exit 1
fi

echo "Dashboard port-forward started in background."
echo "PID: $(cat "$PID_FILE")"
echo "LOG: $LOG_FILE"
echo "URL: https://${ADDRESS}:${LOCAL_PORT}/"
