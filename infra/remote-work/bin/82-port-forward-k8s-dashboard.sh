#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo

NAMESPACE="kubernetes-dashboard"
SERVICE_NAME="kubernetes-dashboard-kong-proxy"
LOCAL_PORT="8443"
REMOTE_PORT="443"

usage() {
  cat <<'EOF'
Usage: ./bin/82-port-forward-k8s-dashboard.sh [options]

Start a local port-forward for the Kubernetes Dashboard Kong proxy service.

Options:
  --namespace <name>     Namespace, default kubernetes-dashboard
  --service <name>       Service name, default kubernetes-dashboard-kong-proxy
  --local-port <port>    Local bind port, default 8443
  --remote-port <port>   Remote service port, default 443
  -h, --help             Show help
EOF
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
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

run_cluster_kubectl -n "$NAMESPACE" get service "$SERVICE_NAME" >/dev/null
run_cluster_kubectl -n "$NAMESPACE" port-forward "svc/${SERVICE_NAME}" "${LOCAL_PORT}:${REMOTE_PORT}"
