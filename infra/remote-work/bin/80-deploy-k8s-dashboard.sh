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
WAIT_TIMEOUT_SECONDS=300
WAIT_INTERVAL_SECONDS=10

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
  --wait-timeout <sec>      Wait timeout in seconds, default 300
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
    --wait-timeout)
      WAIT_TIMEOUT_SECONDS="$2"
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

print_dashboard_diagnostics() {
  echo
  echo "--- dashboard pods ---"
  run_cluster_kubectl -n "$NAMESPACE" get pods -o wide || true
  echo
  echo "--- dashboard deployments ---"
  run_cluster_kubectl -n "$NAMESPACE" get deployments -o wide || true
  echo
  echo "--- dashboard services ---"
  run_cluster_kubectl -n "$NAMESPACE" get svc -o wide || true
  echo
  echo "--- recent dashboard events ---"
  run_cluster_kubectl -n "$NAMESPACE" get events --sort-by=.lastTimestamp | tail -n 50 || true
  echo
  echo "--- deployment describe ---"
  run_cluster_kubectl -n "$NAMESPACE" describe deployments || true
}

wait_for_dashboard_ready() {
  local elapsed=0
  local all_ready=0

  while (( elapsed < WAIT_TIMEOUT_SECONDS )); do
    echo "Waiting for dashboard readiness: ${elapsed}s/${WAIT_TIMEOUT_SECONDS}s"
    run_cluster_kubectl -n "$NAMESPACE" get pods -o wide || true

    if run_cluster_kubectl -n "$NAMESPACE" get deployments -o json | \
      node --input-type=module -e '
        let source = "";
        process.stdin.on("data", (chunk) => { source += chunk; });
        process.stdin.on("end", () => {
          const data = JSON.parse(source);
          const items = data.items ?? [];
          if (items.length === 0) process.exit(1);
          const ready = items.every((item) => {
            const desired = item.spec?.replicas ?? 1;
            const available = item.status?.availableReplicas ?? 0;
            return available >= desired;
          });
          process.exit(ready ? 0 : 1);
        });
      '; then
      all_ready=1
      break
    fi

    sleep "$WAIT_INTERVAL_SECONDS"
    elapsed=$((elapsed + WAIT_INTERVAL_SECONDS))
  done

  if [[ "$all_ready" -ne 1 ]]; then
    print_step "Dashboard 超时未就绪，输出诊断信息"
    print_dashboard_diagnostics
    echo
    echo "如果 Pod 处于 ImagePullBackOff，可先执行：./bin/83-prepull-k8s-dashboard-images.sh"
    die "Kubernetes Dashboard 在 ${WAIT_TIMEOUT_SECONDS}s 内未就绪。"
  fi
}

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
wait_for_dashboard_ready

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
