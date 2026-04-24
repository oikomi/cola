#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

require_cmd sudo

PROM_NAMESPACE="monitoring"
PROM_RELEASE="prometheus"
PROM_REPO_NAME="prometheus-community"
PROM_REPO_URL="https://prometheus-community.github.io/helm-charts"
PROM_CHART_REF="${PROM_REPO_NAME}/kube-prometheus-stack"
PROM_CHART_VERSION=""
PROM_SERVICE_NAME=""

WEBUI_NAMESPACE="kube-system"
WEBUI_RELEASE="hami-webui"
WEBUI_REPO_NAME="hami-webui"
WEBUI_REPO_URL="https://project-hami.github.io/HAMi-WebUI"
WEBUI_CHART_REF="${WEBUI_REPO_NAME}/hami-webui"
WEBUI_CHART_VERSION=""

ENABLE_GRAFANA=0
ENABLE_ALERTMANAGER=0
WAIT_TIMEOUT_SECONDS=600

usage() {
  cat <<'EOF'
Usage: ./bin/cluster.sh monitoring deploy [options]

Install Prometheus and HAMi-WebUI for GPU monitoring.

Options:
  --prom-namespace <name>        Prometheus namespace, default monitoring
  --prom-release <name>          Prometheus release name, default prometheus
  --prom-chart-version <ver>     kube-prometheus-stack chart version, default repo latest
  --prom-service <name>          Prometheus service name; default derives from release
  --webui-namespace <name>       HAMi-WebUI namespace, default kube-system
  --webui-release <name>         HAMi-WebUI release name, default hami-webui
  --webui-chart-version <ver>    HAMi-WebUI chart version, default repo latest
  --enable-grafana               Enable Grafana in kube-prometheus-stack
  --enable-alertmanager          Enable Alertmanager in kube-prometheus-stack
  --wait-timeout <sec>           Helm wait timeout in seconds, default 600
  -h, --help                     Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prom-namespace)
      PROM_NAMESPACE="$2"
      shift 2
      ;;
    --prom-release)
      PROM_RELEASE="$2"
      shift 2
      ;;
    --prom-chart-version)
      PROM_CHART_VERSION="$2"
      shift 2
      ;;
    --prom-service)
      PROM_SERVICE_NAME="$2"
      shift 2
      ;;
    --webui-namespace)
      WEBUI_NAMESPACE="$2"
      shift 2
      ;;
    --webui-release)
      WEBUI_RELEASE="$2"
      shift 2
      ;;
    --webui-chart-version)
      WEBUI_CHART_VERSION="$2"
      shift 2
      ;;
    --enable-grafana)
      ENABLE_GRAFANA=1
      shift
      ;;
    --enable-alertmanager)
      ENABLE_ALERTMANAGER=1
      shift
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

if [[ -z "$PROM_SERVICE_NAME" ]]; then
  PROM_SERVICE_NAME="${PROM_RELEASE}-kube-prometheus-prometheus"
fi

PROM_ADDRESS="http://${PROM_SERVICE_NAME}.${PROM_NAMESPACE}.svc.cluster.local:9090"
HELM_TIMEOUT="${WAIT_TIMEOUT_SECONDS}s"

print_monitoring_diagnostics() {
  echo
  echo "--- monitoring namespace pods ---"
  run_cluster_kubectl -n "$PROM_NAMESPACE" get pods -o wide || true
  echo
  echo "--- monitoring namespace services ---"
  run_cluster_kubectl -n "$PROM_NAMESPACE" get svc -o wide || true
  echo
  echo "--- hami-webui pods ---"
  run_cluster_kubectl -n "$WEBUI_NAMESPACE" get pods -l "app.kubernetes.io/instance=${WEBUI_RELEASE}" -o wide || true
  echo
  echo "--- hami-webui services ---"
  run_cluster_kubectl -n "$WEBUI_NAMESPACE" get svc -l "app.kubernetes.io/instance=${WEBUI_RELEASE}" -o wide || true
  echo
  echo "--- recent monitoring events ---"
  run_cluster_kubectl -n "$PROM_NAMESPACE" get events --sort-by=.lastTimestamp | tail -n 50 || true
  echo
  echo "--- recent hami-webui events ---"
  run_cluster_kubectl -n "$WEBUI_NAMESPACE" get events --sort-by=.lastTimestamp | tail -n 50 || true
}

print_step "检查集群连通性"
run_cluster_kubectl get nodes >/dev/null

if ! run_cluster_kubectl -n kube-system get deployment hami-scheduler >/dev/null 2>&1; then
  die "未检测到 hami-scheduler。请先执行 ./bin/cluster.sh gpu enable。"
fi

print_step "添加 Helm 仓库"
run_cluster_helm repo add "$PROM_REPO_NAME" "$PROM_REPO_URL" --force-update
run_cluster_helm repo add "$WEBUI_REPO_NAME" "$WEBUI_REPO_URL" --force-update
run_cluster_helm repo update "$PROM_REPO_NAME" "$WEBUI_REPO_NAME"

print_step "安装 Prometheus"
prom_helm_args=(
  upgrade --install
  "$PROM_RELEASE"
  "$PROM_CHART_REF"
  --namespace "$PROM_NAMESPACE"
  --create-namespace
  --wait
  --timeout "$HELM_TIMEOUT"
  --set "grafana.enabled=$([[ "$ENABLE_GRAFANA" -eq 1 ]] && echo true || echo false)"
  --set "alertmanager.enabled=$([[ "$ENABLE_ALERTMANAGER" -eq 1 ]] && echo true || echo false)"
)

if [[ -n "$PROM_CHART_VERSION" ]]; then
  prom_helm_args+=(--version "$PROM_CHART_VERSION")
fi

if ! run_cluster_helm "${prom_helm_args[@]}"; then
  print_step "Prometheus 安装失败，输出诊断信息"
  print_monitoring_diagnostics
  die "Prometheus 安装失败。"
fi

run_cluster_kubectl -n "$PROM_NAMESPACE" get svc "$PROM_SERVICE_NAME" >/dev/null 2>&1 || \
  die "未找到 Prometheus 服务 $PROM_SERVICE_NAME。请用 --prom-service 指定正确的服务名。"

print_step "安装 HAMi-WebUI"
webui_helm_args=(
  upgrade --install
  "$WEBUI_RELEASE"
  "$WEBUI_CHART_REF"
  --namespace "$WEBUI_NAMESPACE"
  --create-namespace
  --wait
  --timeout "$HELM_TIMEOUT"
  --set "externalPrometheus.enabled=true"
  --set "externalPrometheus.address=${PROM_ADDRESS}"
)

if [[ -n "$WEBUI_CHART_VERSION" ]]; then
  webui_helm_args+=(--version "$WEBUI_CHART_VERSION")
fi

if ! run_cluster_helm "${webui_helm_args[@]}"; then
  print_step "HAMi-WebUI 安装失败，输出诊断信息"
  print_monitoring_diagnostics
  die "HAMi-WebUI 安装失败。"
fi

echo
echo "Prometheus 已安装到 namespace: $PROM_NAMESPACE"
echo "HAMi-WebUI 已安装到 namespace: $WEBUI_NAMESPACE"
echo "Prometheus 地址: $PROM_ADDRESS"
echo "访问方式: ./bin/cluster.sh monitoring port-forward"
