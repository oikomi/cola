#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo

NAMESPACE="kubernetes-dashboard"
SERVICE_ACCOUNT="admin-user"
DURATION="24h"

usage() {
  cat <<'EOF'
Usage: ./bin/81-get-k8s-dashboard-token.sh [options]

Print a bearer token for the Kubernetes Dashboard admin service account.

Options:
  --namespace <name>         Namespace, default kubernetes-dashboard
  --service-account <name>   ServiceAccount, default admin-user
  --duration <dur>           Token duration, default 24h
  -h, --help                 Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --service-account)
      SERVICE_ACCOUNT="$2"
      shift 2
      ;;
    --duration)
      DURATION="$2"
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

run_cluster_kubectl -n "$NAMESPACE" get serviceaccount "$SERVICE_ACCOUNT" >/dev/null
run_cluster_kubectl create token "$SERVICE_ACCOUNT" -n "$NAMESPACE" --duration "$DURATION"

