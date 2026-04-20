#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo
require_cmd node

NAMESPACE="kubernetes-dashboard"
RELEASE_NAME="kubernetes-dashboard"
CHART_VERSION="7.14.0"
REPO_URL="https://kubernetes.github.io/dashboard/"
SKIP_ADMIN_USER=0

usage() {
  cat <<'EOF'
Usage: ./bin/80-deploy-k8s-dashboard.sh [options]

Install Kubernetes Dashboard via the official Helm chart, create an admin user,
and expose the Kong proxy service for browser access.

Options:
  --namespace <name>        Namespace, default kubernetes-dashboard
  --release <name>          Helm release name, default kubernetes-dashboard
  --chart-version <ver>     Helm chart version, default 7.14.0
  --repo-url <url>          Helm repo URL, default https://kubernetes.github.io/dashboard/
  --skip-admin-user         Do not create the sample admin user
  -h, --help                Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --release)
      RELEASE_NAME="$2"
      shift 2
      ;;
    --chart-version)
      CHART_VERSION="$2"
      shift 2
      ;;
    --repo-url)
      REPO_URL="$2"
      shift 2
      ;;
    --skip-admin-user)
      SKIP_ADMIN_USER=1
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

print_step "检查集群连通性"
run_cluster_kubectl get nodes >/dev/null

print_step "安装 Kubernetes Dashboard"
CHART_REF="kubernetes-dashboard/kubernetes-dashboard"
if run_cluster_helm repo add kubernetes-dashboard "$REPO_URL" --force-update && \
  run_cluster_helm repo update kubernetes-dashboard; then
  echo "Using Helm repo source: $REPO_URL"
else
  CHART_REF="https://github.com/kubernetes/dashboard/releases/download/kubernetes-dashboard-${CHART_VERSION}/kubernetes-dashboard-${CHART_VERSION}.tgz"
  echo "WARN: Helm repo $REPO_URL 不可用，回退到官方 GitHub release chart:"
  echo "WARN: $CHART_REF"
fi

helm_args=(
  upgrade --install
  "$RELEASE_NAME"
  "$CHART_REF"
  --namespace "$NAMESPACE"
  --create-namespace
)

if [[ "$CHART_REF" == "kubernetes-dashboard/kubernetes-dashboard" ]]; then
  helm_args+=(--version "$CHART_VERSION")
fi

run_cluster_helm "${helm_args[@]}"

print_step "等待 Dashboard Deployment 就绪"
run_cluster_kubectl wait \
  --namespace "$NAMESPACE" \
  --for=condition=Available \
  deployment \
  --all \
  --timeout=300s

if [[ "$SKIP_ADMIN_USER" -eq 0 ]]; then
  print_step "创建 Dashboard 管理员账号"
  run_cluster_kubectl apply -f "$ROOT_DIR/manifests/dashboard/admin-user.yaml"
fi

echo
echo "已按 Kubernetes 官方文档方式安装 Dashboard。"
echo "访问方式：./bin/82-port-forward-k8s-dashboard.sh"
echo "浏览器地址：https://localhost:8443/"
if [[ "$SKIP_ADMIN_USER" -eq 0 ]]; then
  echo "获取登录 Token：./bin/81-get-k8s-dashboard-token.sh"
fi
