#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
K8S_DIR="$INFRA_DIR/k8s"
CLUSTER_CONFIG="$K8S_DIR/cluster/config.json"
DEFAULT_ENV_FILE="$SCRIPT_DIR/harbor.env"
KUBEASZ_BASE_DIR="${KUBEASZ_BASE_DIR:-/etc/kubeasz}"

ACTION="install"
ENV_FILE=""
DRY_RUN=0
KUBECONFIG_PATH="${KUBECONFIG:-}"
KUBECTL_BIN=""
HELM_BIN=""

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [install|status|smoke-test|render-values|render-service|uninstall] [options]

Deploy Harbor registry to the Cola Kubernetes cluster.

Actions:
  install                 Install/upgrade Harbor; default action
  status                  Show Helm release, pods, services, and access URLs
  smoke-test              Check Harbor health endpoint from the deployment machine
  render-values           Print generated Harbor Helm values
  render-service          Print expected Harbor LAN NodePort Service YAML
  uninstall               Remove the Helm release and helper Service

Options:
  --env-file <path>       Load Harbor settings from a local env file
  --kubeconfig <path>     Override kubeconfig path
  --dry-run               Print actions without applying cluster changes
  -h, --help              Show help
EOF
}

log() {
  echo "==> $*"
}

warn() {
  echo "WARN: $*" >&2
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

is_true() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES | on | ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

json_field() {
  local field="$1"

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$CLUSTER_CONFIG" "$field" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
field = sys.argv[2]
data = json.loads(path.read_text())
value = data.get(field)
if value is not None:
    print(value)
PY
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    node --input-type=module - "$CLUSTER_CONFIG" "$field" <<'EOF'
import fs from "node:fs";

const [path, field] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(path, "utf8"));
if (data[field] !== undefined && data[field] !== null) {
  process.stdout.write(String(data[field]));
}
EOF
    return 0
  fi

  die "缺少命令: python3 或 node，用于读取 $CLUSTER_CONFIG"
}

yaml_quote() {
  local value="$1"

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$value" <<'PY'
import json
import sys

print(json.dumps(sys.argv[1], ensure_ascii=False))
PY
    return 0
  fi

  node --input-type=module - "$value" <<'EOF'
process.stdout.write(JSON.stringify(process.argv[2] ?? ""));
EOF
}

cluster_name() {
  [[ -f "$CLUSTER_CONFIG" ]] || die "找不到集群配置: $CLUSTER_CONFIG"
  json_field clusterName
}

controller_ip() {
  local value
  value="$(json_field controllerIp)"
  [[ -n "$value" ]] || die "infra/k8s/cluster/config.json 缺少 controllerIp"
  printf '%s\n' "$value"
}

resolve_kubeconfig() {
  [[ -n "$KUBECONFIG_PATH" ]] && return 0

  local name
  name="$(cluster_name)"
  local user_kubeconfig="$HOME/.kube/${name}.config"
  local kubeasz_kubeconfig="/etc/kubeasz/clusters/${name}/kubectl.kubeconfig"

  if [[ -f "$user_kubeconfig" ]]; then
    KUBECONFIG_PATH="$user_kubeconfig"
    return 0
  fi

  if [[ -f "$kubeasz_kubeconfig" ]]; then
    KUBECONFIG_PATH="$kubeasz_kubeconfig"
    return 0
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    KUBECONFIG_PATH="$user_kubeconfig"
    warn "dry-run 模式未找到 kubeconfig，将使用预期路径打印命令: $KUBECONFIG_PATH"
    return 0
  fi

  die "找不到 kubeconfig。请先完成 infra/k8s 集群安装，或通过 --kubeconfig 指定。已尝试: $user_kubeconfig, $kubeasz_kubeconfig"
}

kubectl_bin_path() {
  if command -v kubectl >/dev/null 2>&1; then
    command -v kubectl
    return 0
  fi

  if [[ -x "$KUBEASZ_BASE_DIR/bin/kubectl" ]]; then
    printf '%s\n' "$KUBEASZ_BASE_DIR/bin/kubectl"
    return 0
  fi

  die "缺少 kubectl，且 $KUBEASZ_BASE_DIR/bin/kubectl 不存在。"
}

helm_bin_path() {
  if command -v helm >/dev/null 2>&1; then
    command -v helm
    return 0
  fi

  if [[ -x "$KUBEASZ_BASE_DIR/bin/helm" ]]; then
    printf '%s\n' "$KUBEASZ_BASE_DIR/bin/helm"
    return 0
  fi

  die "缺少 helm，且 $KUBEASZ_BASE_DIR/bin/helm 不存在。"
}

resolve_cluster_bins() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
    HELM_BIN="${HELM_BIN:-helm}"
    return 0
  fi

  KUBECTL_BIN="$(kubectl_bin_path)"
  HELM_BIN="$(helm_bin_path)"
}

load_env_file() {
  local file="$ENV_FILE"

  if [[ -z "$file" && -f "$DEFAULT_ENV_FILE" ]]; then
    file="$DEFAULT_ENV_FILE"
  fi

  [[ -z "$file" ]] && return 0
  [[ -f "$file" ]] || die "找不到 env 文件: $file"

  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
}

parse_args() {
  if [[ $# -gt 0 ]]; then
    case "$1" in
      install | status | smoke-test | render-values | render-service | uninstall)
        ACTION="$1"
        shift
        ;;
    esac
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env-file)
        ENV_FILE="$2"
        shift 2
        ;;
      --kubeconfig)
        KUBECONFIG_PATH="$2"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        die "未知参数: $1"
        ;;
    esac
  done
}

set_defaults() {
  HARBOR_NAMESPACE="${HARBOR_NAMESPACE:-registry}"
  HARBOR_RELEASE="${HARBOR_RELEASE:-harbor}"
  HARBOR_HELM_REPO_NAME="${HARBOR_HELM_REPO_NAME:-harbor}"
  HARBOR_HELM_REPO_URL="${HARBOR_HELM_REPO_URL:-https://helm.goharbor.io}"
  HARBOR_CHART="${HARBOR_CHART:-${HARBOR_HELM_REPO_NAME}/harbor}"
  HARBOR_CHART_VERSION="${HARBOR_CHART_VERSION:-1.18.3}"
  HARBOR_IMAGE_TAG="${HARBOR_IMAGE_TAG:-v2.14.4}"
  HARBOR_WAIT_TIMEOUT="${HARBOR_WAIT_TIMEOUT:-900s}"

  HARBOR_EXPOSE_TYPE="${HARBOR_EXPOSE_TYPE:-nodePort}"
  HARBOR_EXPOSE_TLS_ENABLED="${HARBOR_EXPOSE_TLS_ENABLED:-false}"
  HARBOR_NODEPORT_SERVICE_NAME="${HARBOR_NODEPORT_SERVICE_NAME:-harbor-lan}"
  HARBOR_HTTP_NODE_PORT="${HARBOR_HTTP_NODE_PORT:-32248}"
  HARBOR_HTTPS_NODE_PORT="${HARBOR_HTTPS_NODE_PORT:-32249}"
  HARBOR_EXTERNAL_URL="${HARBOR_EXTERNAL_URL:-http://$(controller_ip):${HARBOR_HTTP_NODE_PORT}}"

  HARBOR_ADMIN_PASSWORD="${HARBOR_ADMIN_PASSWORD:-change-me-before-deploy}"
  HARBOR_SECRET_KEY="${HARBOR_SECRET_KEY:-not-a-secure-secret-key}"
  HARBOR_REGISTRY_CREDENTIAL_USERNAME="${HARBOR_REGISTRY_CREDENTIAL_USERNAME:-harbor_registry_user}"
  HARBOR_REGISTRY_CREDENTIAL_PASSWORD="${HARBOR_REGISTRY_CREDENTIAL_PASSWORD:-change-me-registry-password}"

  HARBOR_PERSISTENCE_ENABLED="${HARBOR_PERSISTENCE_ENABLED:-true}"
  HARBOR_STORAGE_CLASS="${HARBOR_STORAGE_CLASS:-}"
  HARBOR_REGISTRY_SIZE="${HARBOR_REGISTRY_SIZE:-200Gi}"
  HARBOR_JOB_SERVICE_SIZE="${HARBOR_JOB_SERVICE_SIZE:-5Gi}"
  HARBOR_DATABASE_SIZE="${HARBOR_DATABASE_SIZE:-10Gi}"
  HARBOR_REDIS_SIZE="${HARBOR_REDIS_SIZE:-5Gi}"
  HARBOR_TRIVY_SIZE="${HARBOR_TRIVY_SIZE:-10Gi}"

  HARBOR_TRIVY_ENABLED="${HARBOR_TRIVY_ENABLED:-true}"
  HARBOR_NOTARY_ENABLED="${HARBOR_NOTARY_ENABLED:-false}"
  HARBOR_CHARTMUSEUM_ENABLED="${HARBOR_CHARTMUSEUM_ENABLED:-false}"
  HARBOR_REPLICAS="${HARBOR_REPLICAS:-1}"
}

kubectl_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf 'DRY-RUN KUBECONFIG=%q %q' "$KUBECONFIG_PATH" "$KUBECTL_BIN"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  KUBECONFIG="$KUBECONFIG_PATH" "$KUBECTL_BIN" "$@"
}

helm_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf 'DRY-RUN KUBECONFIG=%q %q' "$KUBECONFIG_PATH" "$HELM_BIN"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  KUBECONFIG="$KUBECONFIG_PATH" "$HELM_BIN" "$@"
}

apply_yaml() {
  local description="$1"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry-run: render $description"
    cat
    return 0
  fi

  KUBECONFIG="$KUBECONFIG_PATH" "$KUBECTL_BIN" apply -f -
}

validate_node_port() {
  local name="$1"
  local value="$2"

  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 30000 ]] || [[ "$value" -gt 32767 ]]; then
    die "$name 必须是 30000-32767 之间的整数"
  fi
}

validate_inputs() {
  [[ -n "$HARBOR_NAMESPACE" ]] || die "HARBOR_NAMESPACE 不能为空"
  [[ -n "$HARBOR_RELEASE" ]] || die "HARBOR_RELEASE 不能为空"
  [[ -n "$HARBOR_IMAGE_TAG" ]] || die "HARBOR_IMAGE_TAG 不能为空"
  [[ -n "$HARBOR_EXTERNAL_URL" ]] || die "HARBOR_EXTERNAL_URL 不能为空"
  [[ -n "$HARBOR_ADMIN_PASSWORD" ]] || die "HARBOR_ADMIN_PASSWORD 不能为空"
  [[ -n "$HARBOR_SECRET_KEY" ]] || die "HARBOR_SECRET_KEY 不能为空"
  [[ -n "$HARBOR_REGISTRY_CREDENTIAL_USERNAME" ]] || die "HARBOR_REGISTRY_CREDENTIAL_USERNAME 不能为空"
  [[ -n "$HARBOR_REGISTRY_CREDENTIAL_PASSWORD" ]] || die "HARBOR_REGISTRY_CREDENTIAL_PASSWORD 不能为空"

  if [[ "$HARBOR_EXPOSE_TYPE" != "nodePort" ]]; then
    die "当前脚本只支持 HARBOR_EXPOSE_TYPE=nodePort"
  fi

  validate_node_port HARBOR_HTTP_NODE_PORT "$HARBOR_HTTP_NODE_PORT"
  validate_node_port HARBOR_HTTPS_NODE_PORT "$HARBOR_HTTPS_NODE_PORT"

  if [[ "$HARBOR_HTTP_NODE_PORT" == "$HARBOR_HTTPS_NODE_PORT" ]]; then
    die "HARBOR_HTTP_NODE_PORT 和 HARBOR_HTTPS_NODE_PORT 不能相同"
  fi

  if [[ "$HARBOR_ADMIN_PASSWORD" == "change-me-before-deploy" || "$HARBOR_ADMIN_PASSWORD" == "123456" ]]; then
    warn "HARBOR_ADMIN_PASSWORD 仍是示例值。正式部署前必须修改。"
  fi

  if [[ "$HARBOR_SECRET_KEY" == "not-a-secure-secret-key" ]]; then
    warn "HARBOR_SECRET_KEY 仍是示例值。正式部署前必须修改为 16 字符以上随机字符串。"
  fi

  if [[ "$HARBOR_REGISTRY_CREDENTIAL_PASSWORD" == "change-me-registry-password" ]]; then
    warn "HARBOR_REGISTRY_CREDENTIAL_PASSWORD 仍是示例值。正式部署前必须修改。"
  fi

  if [[ "$HARBOR_IMAGE_TAG" != "v2.14.4" ]]; then
    warn "当前 HARBOR_IMAGE_TAG=${HARBOR_IMAGE_TAG}，用户要求的 Harbor 版本是 v2.14.4。"
  fi
}

render_storage_class_line() {
  local indent="${1:-6}"

  if [[ -n "$HARBOR_STORAGE_CLASS" ]]; then
    printf '%*sstorageClass: %s\n' "$indent" "" "$(yaml_quote "$HARBOR_STORAGE_CLASS")"
  fi
}

render_values() {
  cat <<YAML
expose:
  type: ${HARBOR_EXPOSE_TYPE}
  tls:
    enabled: $(if is_true "$HARBOR_EXPOSE_TLS_ENABLED"; then echo true; else echo false; fi)
  nodePort:
    name: ${HARBOR_NODEPORT_SERVICE_NAME}
    ports:
      http:
        port: 80
        nodePort: ${HARBOR_HTTP_NODE_PORT}
      https:
        port: 443
        nodePort: ${HARBOR_HTTPS_NODE_PORT}

externalURL: $(yaml_quote "$HARBOR_EXTERNAL_URL")

harborAdminPassword: $(yaml_quote "$HARBOR_ADMIN_PASSWORD")
secretKey: $(yaml_quote "$HARBOR_SECRET_KEY")

ipFamily:
  ipv6:
    enabled: false

imagePullPolicy: IfNotPresent

nginx:
  replicas: ${HARBOR_REPLICAS}
  image:
    repository: goharbor/nginx-photon
    tag: $(yaml_quote "$HARBOR_IMAGE_TAG")

portal:
  replicas: ${HARBOR_REPLICAS}
  image:
    repository: goharbor/harbor-portal
    tag: $(yaml_quote "$HARBOR_IMAGE_TAG")

core:
  replicas: ${HARBOR_REPLICAS}
  image:
    repository: goharbor/harbor-core
    tag: $(yaml_quote "$HARBOR_IMAGE_TAG")

jobservice:
  replicas: ${HARBOR_REPLICAS}
  image:
    repository: goharbor/harbor-jobservice
    tag: $(yaml_quote "$HARBOR_IMAGE_TAG")

registry:
  replicas: ${HARBOR_REPLICAS}
  registry:
    image:
      repository: goharbor/registry-photon
      tag: $(yaml_quote "$HARBOR_IMAGE_TAG")
  controller:
    image:
      repository: goharbor/harbor-registryctl
      tag: $(yaml_quote "$HARBOR_IMAGE_TAG")
  credentials:
    username: $(yaml_quote "$HARBOR_REGISTRY_CREDENTIAL_USERNAME")
    password: $(yaml_quote "$HARBOR_REGISTRY_CREDENTIAL_PASSWORD")

trivy:
  enabled: $(if is_true "$HARBOR_TRIVY_ENABLED"; then echo true; else echo false; fi)
  image:
    repository: goharbor/trivy-adapter-photon
    tag: $(yaml_quote "$HARBOR_IMAGE_TAG")

notary:
  enabled: $(if is_true "$HARBOR_NOTARY_ENABLED"; then echo true; else echo false; fi)

chartmuseum:
  enabled: $(if is_true "$HARBOR_CHARTMUSEUM_ENABLED"; then echo true; else echo false; fi)

database:
  type: internal
  internal:
    image:
      repository: goharbor/harbor-db
      tag: $(yaml_quote "$HARBOR_IMAGE_TAG")

redis:
  type: internal
  internal:
    image:
      repository: goharbor/redis-photon
      tag: $(yaml_quote "$HARBOR_IMAGE_TAG")

exporter:
  image:
    repository: goharbor/harbor-exporter
    tag: $(yaml_quote "$HARBOR_IMAGE_TAG")

persistence:
  enabled: $(if is_true "$HARBOR_PERSISTENCE_ENABLED"; then echo true; else echo false; fi)
  resourcePolicy: keep
  persistentVolumeClaim:
    registry:
$(render_storage_class_line 6)
      size: ${HARBOR_REGISTRY_SIZE}
    jobservice:
      jobLog:
$(render_storage_class_line 8)
        size: ${HARBOR_JOB_SERVICE_SIZE}
    database:
$(render_storage_class_line 6)
      size: ${HARBOR_DATABASE_SIZE}
    redis:
$(render_storage_class_line 6)
      size: ${HARBOR_REDIS_SIZE}
    trivy:
$(render_storage_class_line 6)
      size: ${HARBOR_TRIVY_SIZE}
YAML
}

render_service() {
  cat <<YAML
apiVersion: v1
kind: Service
metadata:
  name: ${HARBOR_NODEPORT_SERVICE_NAME}
  namespace: ${HARBOR_NAMESPACE}
  labels:
    app.kubernetes.io/name: harbor
    app.kubernetes.io/instance: ${HARBOR_RELEASE}
    app.kubernetes.io/part-of: harbor
spec:
  type: NodePort
  selector:
    app: harbor
    component: nginx
    release: ${HARBOR_RELEASE}
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: 8080
      nodePort: ${HARBOR_HTTP_NODE_PORT}
YAML

  if is_true "$HARBOR_EXPOSE_TLS_ENABLED"; then
    cat <<YAML
    - name: https
      protocol: TCP
      port: 443
      targetPort: 8443
      nodePort: ${HARBOR_HTTPS_NODE_PORT}
YAML
  fi
}

apply_service() {
  log "Harbor NodePort Service 由 harbor-helm chart 原生管理: ${HARBOR_NODEPORT_SERVICE_NAME}:${HARBOR_HTTP_NODE_PORT}"
}

print_harbor_progress() {
  echo
  echo "--- ${HARBOR_NAMESPACE} pods ---"
  kubectl_cmd -n "$HARBOR_NAMESPACE" get pods -l release="$HARBOR_RELEASE" -o wide || true
  echo
  echo "--- ${HARBOR_NAMESPACE} pvc ---"
  kubectl_cmd -n "$HARBOR_NAMESPACE" get pvc -o wide || true
  echo
  echo "--- ${HARBOR_NAMESPACE} recent events ---"
  kubectl_cmd -n "$HARBOR_NAMESPACE" get events --sort-by=.lastTimestamp | tail -n 30 || true
}

preflight_storage() {
  if ! is_true "$HARBOR_PERSISTENCE_ENABLED"; then
    return 0
  fi

  log "检查 Harbor PVC StorageClass"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    if [[ -n "$HARBOR_STORAGE_CLASS" ]]; then
      kubectl_cmd get storageclass "$HARBOR_STORAGE_CLASS"
    else
      kubectl_cmd get storageclass
    fi
    return 0
  fi

  if [[ -n "$HARBOR_STORAGE_CLASS" ]]; then
    kubectl_cmd get storageclass "$HARBOR_STORAGE_CLASS" >/dev/null || die "找不到 StorageClass: ${HARBOR_STORAGE_CLASS}。请先部署可用 CSI，或修改 HARBOR_STORAGE_CLASS。"
    return 0
  fi

  if ! kubectl_cmd get storageclass -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")]}{.metadata.name}{"\n"}{end}' | grep -q .; then
    die "HARBOR_PERSISTENCE_ENABLED=true 但 HARBOR_STORAGE_CLASS 为空，且集群没有默认 StorageClass。请先部署可用 CSI，或在 harbor.env 设置 HARBOR_STORAGE_CLASS，例如 juicefs-sc/cola-rbd。"
  fi
}

run_helm_with_progress() {
  local interval="${COLA_HELM_PROGRESS_INTERVAL_SECONDS:-30}"
  local helm_pid
  local status

  echo "等待 Harbor 就绪；每 ${interval}s 输出一次 Pod/PVC/Event 状态。"
  helm_cmd "$@" &
  helm_pid=$!

  while kill -0 "$helm_pid" >/dev/null 2>&1; do
    sleep "$interval"
    if kill -0 "$helm_pid" >/dev/null 2>&1; then
      print_harbor_progress
    fi
  done

  status=0
  wait "$helm_pid" || status=$?
  return "$status"
}

connectivity_check() {
  log "检查集群连通性"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    kubectl_cmd get nodes
    return 0
  fi

  kubectl_cmd get nodes >/dev/null
}

install_chart() {
  log "添加 Harbor Helm 仓库"
  helm_cmd repo add "$HARBOR_HELM_REPO_NAME" "$HARBOR_HELM_REPO_URL" --force-update
  helm_cmd repo update "$HARBOR_HELM_REPO_NAME"

  log "安装或升级 Harbor ${HARBOR_IMAGE_TAG}"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry-run: render Harbor Helm values"
    render_values
    local -a dry_run_args=(
      upgrade --install "$HARBOR_RELEASE" "$HARBOR_CHART"
      --namespace "$HARBOR_NAMESPACE"
      --create-namespace
      --wait
      --timeout "$HARBOR_WAIT_TIMEOUT"
      --values -
    )
    if [[ -n "$HARBOR_CHART_VERSION" ]]; then
      dry_run_args+=(--version "$HARBOR_CHART_VERSION")
    fi
    helm_cmd "${dry_run_args[@]}"
    return 0
  fi

  local values_file
  values_file="$(mktemp)"
  render_values >"$values_file"

  local args=(
    upgrade --install "$HARBOR_RELEASE" "$HARBOR_CHART"
    --namespace "$HARBOR_NAMESPACE"
    --create-namespace
    --wait
    --timeout "$HARBOR_WAIT_TIMEOUT"
    --values "$values_file"
  )

  if [[ -n "$HARBOR_CHART_VERSION" ]]; then
    args+=(--version "$HARBOR_CHART_VERSION")
  fi

  local helm_status=0
  run_helm_with_progress "${args[@]}" || helm_status=$?
  rm -f "$values_file"
  return "$helm_status"
}

run_smoke_test() {
  local health_url="${HARBOR_EXTERNAL_URL%/}/api/v2.0/health"

  log "检查 Harbor health endpoint: ${health_url}"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN curl -fsS ${health_url}"
    return 0
  fi

  command -v curl >/dev/null 2>&1 || die "缺少命令: curl"
  curl -fsS "$health_url"
  echo
}

status() {
  log "Harbor Helm release"
  helm_cmd status "$HARBOR_RELEASE" --namespace "$HARBOR_NAMESPACE" || true
  echo

  log "Harbor pods"
  kubectl_cmd -n "$HARBOR_NAMESPACE" get pods -l release="$HARBOR_RELEASE" -o wide || true
  echo

  log "Harbor services"
  kubectl_cmd -n "$HARBOR_NAMESPACE" get svc -l release="$HARBOR_RELEASE" -o wide || true
  echo

  log "Harbor LAN NodePort"
  kubectl_cmd -n "$HARBOR_NAMESPACE" get svc "$HARBOR_NODEPORT_SERVICE_NAME" -o wide || true
  echo

  local ip
  ip="$(controller_ip)"
  cat <<EOF
Harbor UI: ${HARBOR_EXTERNAL_URL}
Harbor health: ${HARBOR_EXTERNAL_URL%/}/api/v2.0/health
Docker login:
  docker login ${ip}:${HARBOR_HTTP_NODE_PORT}
Admin user: admin
Admin password: <redacted>
Image tag: ${HARBOR_IMAGE_TAG}
Chart version: ${HARBOR_CHART_VERSION:-latest}
EOF
}

uninstall() {
  log "卸载 Harbor Helm release: ${HARBOR_NAMESPACE}/${HARBOR_RELEASE}"
  helm_cmd uninstall "$HARBOR_RELEASE" --namespace "$HARBOR_NAMESPACE" || true
  kubectl_cmd -n "$HARBOR_NAMESPACE" delete svc "$HARBOR_NODEPORT_SERVICE_NAME" --ignore-not-found || true

  cat <<EOF

注意：
- uninstall 不会删除 Harbor PVC，因为 persistence.resourcePolicy 默认是 keep。
- 删除 PVC 前请确认镜像仓库数据、数据库、Redis 和 Trivy 数据不再需要。
EOF
}

main() {
  parse_args "$@"
  load_env_file
  set_defaults
  validate_inputs

  case "$ACTION" in
    render-values)
      render_values
      return 0
      ;;
    render-service)
      render_service
      return 0
      ;;
    smoke-test)
      run_smoke_test
      return 0
      ;;
  esac

  resolve_kubeconfig
  resolve_cluster_bins

  case "$ACTION" in
    install)
      connectivity_check
      preflight_storage
      install_chart
      apply_service
      status
      ;;
    status)
      status
      ;;
    uninstall)
      uninstall
      ;;
    *)
      die "未知 action: $ACTION"
      ;;
  esac
}

main "$@"
