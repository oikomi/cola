#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

require_cmd sudo

PROM_NAMESPACE="monitoring"
PROM_RELEASE="prometheus"
PROM_REPO_NAME="prometheus-community"
PROM_REPO_URL="${COLA_PROMETHEUS_HELM_REPO_URL:-https://prometheus-community.github.io/helm-charts}"
PROM_REPO_URL_EXPLICIT=0
PROM_CHART_REF="${COLA_PROMETHEUS_CHART_REF:-${PROM_REPO_NAME}/kube-prometheus-stack}"
PROM_CHART_REF_EXPLICIT=0
PROM_CHART_VERSION="${COLA_PROMETHEUS_CHART_VERSION:-79.1.1}"
PROM_SERVICE_NAME=""

WEBUI_NAMESPACE="kube-system"
WEBUI_RELEASE="hami-webui"
WEBUI_REPO_NAME="hami-webui"
WEBUI_REPO_URL="${COLA_HAMI_WEBUI_HELM_REPO_URL:-https://project-hami.github.io/HAMi-WebUI}"
WEBUI_CHART_REF="${WEBUI_REPO_NAME}/hami-webui"
WEBUI_CHART_VERSION="${COLA_HAMI_WEBUI_CHART_VERSION:-}"

ENABLE_GRAFANA=0
ENABLE_ALERTMANAGER=0
WAIT_TIMEOUT_SECONDS=600

if [[ -n "${COLA_PROMETHEUS_HELM_REPO_URL:-}" ]]; then
  PROM_REPO_URL_EXPLICIT=1
fi
if [[ -n "${COLA_PROMETHEUS_CHART_REF:-}" ]]; then
  PROM_CHART_REF_EXPLICIT=1
fi

usage() {
  cat <<'EOF'
Usage: ./bin/cluster.sh monitoring deploy [options]

Install Prometheus and HAMi-WebUI for GPU monitoring.

Options:
  --prom-namespace <name>        Prometheus namespace, default monitoring
  --prom-release <name>          Prometheus release name, default prometheus
  --prom-chart-version <ver>     kube-prometheus-stack chart version, default 79.1.1
  --prom-chart-ref <ref>         Prometheus chart ref, URL, or local .tgz path
  --prom-service <name>          Prometheus service name; default derives from release
  --prom-repo-url <url>          Prometheus Helm repo URL
  --webui-namespace <name>       HAMi-WebUI namespace, default kube-system
  --webui-release <name>         HAMi-WebUI release name, default hami-webui
  --webui-chart-version <ver>    HAMi-WebUI chart version, default repo latest
  --webui-repo-url <url>         HAMi-WebUI Helm repo URL
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
    --prom-chart-ref)
      PROM_CHART_REF="$2"
      PROM_CHART_REF_EXPLICIT=1
      shift 2
      ;;
    --prom-repo-url)
      PROM_REPO_URL="$2"
      PROM_REPO_URL_EXPLICIT=1
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
    --webui-repo-url)
      WEBUI_REPO_URL="$2"
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
PROM_REPO_READY=0
WEBUI_REPO_READY=0

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

helm_repo_exists() {
  local repo_name="$1"

  run_cluster_helm repo list -o yaml 2>/dev/null | grep -q "name: ${repo_name}$"
}

run_helm_repo_command_with_retry() {
  local label="$1"
  shift

  local attempts="${COLA_HELM_REPO_RETRY_COUNT:-3}"
  local delay_seconds="${COLA_HELM_REPO_RETRY_DELAY_SECONDS:-5}"
  local attempt

  for (( attempt = 1; attempt <= attempts; attempt++ )); do
    if run_cluster_helm "$@"; then
      return 0
    fi

    if (( attempt < attempts )); then
      echo "WARN: Helm 仓库操作失败: ${label}，准备第 $((attempt + 1)) 次重试。"
      sleep "$delay_seconds"
    fi
  done

  return 1
}

ensure_helm_repo_available() {
  local repo_name="$1"
  local repo_url="$2"

  if run_helm_repo_command_with_retry \
    "repo add ${repo_name}" \
    repo add "$repo_name" "$repo_url" --force-update
  then
    return 0
  fi

  if helm_repo_exists "$repo_name"; then
    echo "WARN: Helm 仓库 $repo_name 更新失败，继续使用本地已有仓库配置。"
    return 0
  fi

  return 1
}

prometheus_chart_release_url() {
  [[ -n "$PROM_CHART_VERSION" ]] || return 1
  printf 'https://github.com/prometheus-community/helm-charts/releases/download/kube-prometheus-stack-%s/kube-prometheus-stack-%s.tgz\n' \
    "$PROM_CHART_VERSION" \
    "$PROM_CHART_VERSION"
}

update_helm_repos_best_effort() {
  local -a repo_names=("$@")

  if run_helm_repo_command_with_retry \
    "repo update ${repo_names[*]}" \
    repo update "${repo_names[@]}"
  then
    return 0
  fi

  echo "WARN: Helm 仓库更新失败，继续尝试使用本地缓存的 chart index。"
  return 0
}

print_step "检查集群连通性"
run_cluster_kubectl get nodes >/dev/null

if ! run_cluster_kubectl -n kube-system get deployment hami-scheduler >/dev/null 2>&1; then
  die "未检测到 hami-scheduler。请先执行 ./bin/cluster.sh gpu enable。"
fi

print_step "准备 Helm chart 来源"
if [[ "$PROM_CHART_REF_EXPLICIT" -eq 1 ]]; then
  echo "Using Prometheus chart ref: $PROM_CHART_REF"
elif [[ "$PROM_REPO_URL_EXPLICIT" -eq 0 && -n "$PROM_CHART_VERSION" ]]; then
  PROM_CHART_REF="$(prometheus_chart_release_url)"
  echo "Using Prometheus chart release package: $PROM_CHART_REF"
else
  if ensure_helm_repo_available "$PROM_REPO_NAME" "$PROM_REPO_URL"; then
    PROM_REPO_READY=1
  else
    if [[ -n "$PROM_CHART_VERSION" ]]; then
      PROM_CHART_REF="$(prometheus_chart_release_url)"
      echo "WARN: Helm 仓库 $PROM_REPO_URL 不可用，回退到 Prometheus chart release 包:"
      echo "WARN: $PROM_CHART_REF"
    else
      die "无法添加 Prometheus Helm 仓库：$PROM_REPO_URL"
    fi
  fi
fi

ensure_helm_repo_available "$WEBUI_REPO_NAME" "$WEBUI_REPO_URL" && WEBUI_REPO_READY=1 || \
  die "无法添加 HAMi-WebUI Helm 仓库：$WEBUI_REPO_URL"

repo_update_names=()
[[ "$PROM_REPO_READY" -eq 1 ]] && repo_update_names+=("$PROM_REPO_NAME")
[[ "$WEBUI_REPO_READY" -eq 1 ]] && repo_update_names+=("$WEBUI_REPO_NAME")
if [[ "${#repo_update_names[@]}" -gt 0 ]]; then
  update_helm_repos_best_effort "${repo_update_names[@]}"
fi

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

if [[ -n "$PROM_CHART_VERSION" && "$PROM_CHART_REF" == "${PROM_REPO_NAME}/kube-prometheus-stack" ]]; then
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
  --set "serviceMonitor.additionalLabels.release=${PROM_RELEASE}"
  --set "hamiServiceMonitor.additionalLabels.release=${PROM_RELEASE}"
  --set "dcgm-exporter.serviceMonitor.additionalLabels.release=${PROM_RELEASE}"
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
