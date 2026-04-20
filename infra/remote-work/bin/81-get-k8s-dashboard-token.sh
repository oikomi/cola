#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo

NAMESPACE="kubernetes-dashboard"
SERVICE_ACCOUNT="admin-user"
SECRET_NAME="admin-user-token"
WAIT_TIMEOUT_SECONDS=60
WAIT_INTERVAL_SECONDS=3

usage() {
  cat <<'EOF'
Usage: ./bin/81-get-k8s-dashboard-token.sh [options]

Print the long-lived bearer token stored in the Kubernetes Dashboard admin secret.

Options:
  --namespace <name>         Namespace, default kubernetes-dashboard
  --service-account <name>   ServiceAccount, default admin-user
  --secret <name>            Secret name, default admin-user-token
  --wait-timeout <sec>       Wait timeout in seconds, default 60
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
    --wait-timeout)
      WAIT_TIMEOUT_SECONDS="$2"
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

run_cluster_kubectl apply -f "$ROOT_DIR/manifests/dashboard/admin-user.yaml" >/dev/null

TOKEN=""
elapsed=0
while (( elapsed < WAIT_TIMEOUT_SECONDS )); do
  TOKEN="$(
    run_cluster_kubectl -n "$NAMESPACE" get secret "$SECRET_NAME" -o jsonpath='{.data.token}' 2>/dev/null | \
      python3 - <<'PY'
import base64
import sys

data = sys.stdin.read().strip()
if not data:
    raise SystemExit(0)
print(base64.b64decode(data).decode())
PY
  )"

  if [[ -n "$TOKEN" ]]; then
    break
  fi

  sleep "$WAIT_INTERVAL_SECONDS"
  elapsed=$((elapsed + WAIT_INTERVAL_SECONDS))
done

if [[ -z "$TOKEN" ]]; then
  die "Secret $SECRET_NAME 在 ${WAIT_TIMEOUT_SECONDS}s 内仍未被 Kubernetes 填充 token。请确认 kube-controller-manager 正常运行，并检查 kubernetes-dashboard namespace 资源状态。"
fi

printf '%s\n' "$TOKEN"
