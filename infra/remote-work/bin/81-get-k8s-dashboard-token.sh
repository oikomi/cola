#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo

NAMESPACE="kubernetes-dashboard"
SERVICE_ACCOUNT="admin-user"
SECRET_NAME="admin-user-token"

usage() {
  cat <<'EOF'
Usage: ./bin/81-get-k8s-dashboard-token.sh [options]

Print the long-lived bearer token stored in the Kubernetes Dashboard admin secret.

Options:
  --namespace <name>         Namespace, default kubernetes-dashboard
  --service-account <name>   ServiceAccount, default admin-user
  --secret <name>            Secret name, default admin-user-token
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
    --secret)
      SECRET_NAME="$2"
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
run_cluster_kubectl -n "$NAMESPACE" get secret "$SECRET_NAME" >/dev/null
TOKEN="$(
  run_cluster_kubectl -n "$NAMESPACE" get secret "$SECRET_NAME" -o jsonpath='{.data.token}' | \
    python3 - <<'PY'
import base64
import sys

data = sys.stdin.read().strip()
if not data:
    raise SystemExit(1)
print(base64.b64decode(data).decode())
PY
)"

if [[ -z "$TOKEN" ]]; then
  die "Secret $SECRET_NAME 还没有被 Kubernetes 填充 token。可稍等片刻后重试，或重新执行 ./bin/80-deploy-k8s-dashboard.sh。"
fi

printf '%s\n' "$TOKEN"
