#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
K8S_DIR="$INFRA_DIR/k8s"
CLUSTER_CONFIG="$K8S_DIR/cluster/config.json"
DEFAULT_ENV_FILE="$SCRIPT_DIR/juicefs.env"
DEFAULT_VALUES_FILE="$SCRIPT_DIR/values.yaml"

ACTION="install"
ENV_FILE=""
DRY_RUN=0
KUBECONFIG_PATH="${KUBECONFIG:-}"

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [install|status|render-storageclass|uninstall] [options]

Deploy JuiceFS CSI Driver and optionally create the JuiceFS Secret and StorageClass.

Actions:
  install                 Install/upgrade JuiceFS CSI Driver; default action
  status                  Show Helm release and Kubernetes resources
  render-storageclass     Print the generated StorageClass YAML
  uninstall               Remove the Helm release only

Options:
  --env-file <path>       Load JuiceFS settings from a local env file
  --kubeconfig <path>     Override kubeconfig path
  --dry-run               Print actions without applying cluster changes
  -h, --help              Show help

Environment:
  JUICEFS_CREATE_STORAGECLASS=0 skips Secret and StorageClass creation.
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

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON)
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

cluster_name() {
  [[ -f "$CLUSTER_CONFIG" ]] || die "找不到集群配置: $CLUSTER_CONFIG"
  json_field clusterName
}

resolve_kubeconfig() {
  local name
  local user_kubeconfig
  local kubeasz_kubeconfig

  if [[ -n "$KUBECONFIG_PATH" ]]; then
    if [[ ! -f "$KUBECONFIG_PATH" ]]; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        warn "dry-run 模式未校验 kubeconfig 是否存在: $KUBECONFIG_PATH"
        return 0
      fi
      die "找不到 kubeconfig: $KUBECONFIG_PATH"
    fi
    return 0
  fi

  name="$(cluster_name)"
  [[ -n "$name" ]] || die "clusterName 为空: $CLUSTER_CONFIG"

  user_kubeconfig="$HOME/.kube/${name}.config"
  kubeasz_kubeconfig="/etc/kubeasz/clusters/${name}/kubectl.kubeconfig"

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
      install|status|render-storageclass|uninstall)
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
      -h|--help)
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
  JUICEFS_CSI_NAMESPACE="${JUICEFS_CSI_NAMESPACE:-kube-system}"
  JUICEFS_RELEASE="${JUICEFS_RELEASE:-juicefs-csi-driver}"
  JUICEFS_REPO_NAME="${JUICEFS_REPO_NAME:-juicefs}"
  JUICEFS_REPO_URL="${JUICEFS_REPO_URL:-https://juicedata.github.io/charts/}"
  JUICEFS_CHART_REF="${JUICEFS_CHART_REF:-${JUICEFS_REPO_NAME}/juicefs-csi-driver}"
  JUICEFS_CHART_VERSION="${JUICEFS_CHART_VERSION:-}"
  JUICEFS_HELM_VALUES="${JUICEFS_HELM_VALUES:-$DEFAULT_VALUES_FILE}"
  JUICEFS_WAIT_TIMEOUT="${JUICEFS_WAIT_TIMEOUT:-600s}"

  JUICEFS_CREATE_STORAGECLASS="${JUICEFS_CREATE_STORAGECLASS:-1}"
  JUICEFS_SECRET_NAMESPACE="${JUICEFS_SECRET_NAMESPACE:-kube-system}"
  JUICEFS_SECRET_NAME="${JUICEFS_SECRET_NAME:-juicefs-secret}"
  JUICEFS_STORAGECLASS_NAME="${JUICEFS_STORAGECLASS_NAME:-juicefs-sc}"
  JUICEFS_SET_DEFAULT_STORAGECLASS="${JUICEFS_SET_DEFAULT_STORAGECLASS:-0}"
  JUICEFS_RECLAIM_POLICY="${JUICEFS_RECLAIM_POLICY:-Retain}"
  JUICEFS_ALLOW_VOLUME_EXPANSION="${JUICEFS_ALLOW_VOLUME_EXPANSION:-true}"

  JUICEFS_NAME="${JUICEFS_NAME:-juicefs}"
  JUICEFS_METAURL="${JUICEFS_METAURL:-}"
  JUICEFS_STORAGE="${JUICEFS_STORAGE:-}"
  JUICEFS_BUCKET="${JUICEFS_BUCKET:-}"
  JUICEFS_ACCESS_KEY="${JUICEFS_ACCESS_KEY:-}"
  JUICEFS_SECRET_KEY="${JUICEFS_SECRET_KEY:-}"
  JUICEFS_FORMAT_OPTIONS="${JUICEFS_FORMAT_OPTIONS:-}"
  JUICEFS_MOUNT_OPTIONS="${JUICEFS_MOUNT_OPTIONS:-}"
  JUICEFS_EXISTING_VOLUME="${JUICEFS_EXISTING_VOLUME:-0}"
}

kubectl_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf 'DRY-RUN KUBECONFIG=%q kubectl' "$KUBECONFIG_PATH"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  KUBECONFIG="$KUBECONFIG_PATH" kubectl "$@"
}

helm_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf 'DRY-RUN KUBECONFIG=%q helm' "$KUBECONFIG_PATH"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  KUBECONFIG="$KUBECONFIG_PATH" helm "$@"
}

apply_yaml() {
  local description="$1"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry-run: render $description"
    cat
    return 0
  fi

  KUBECONFIG="$KUBECONFIG_PATH" kubectl apply -f -
}

validate_storageclass_inputs() {
  [[ -n "$JUICEFS_NAME" ]] || die "JUICEFS_NAME 不能为空"
  [[ -n "$JUICEFS_METAURL" ]] || die "JUICEFS_METAURL 不能为空"

  if ! is_true "$JUICEFS_EXISTING_VOLUME"; then
    [[ -n "$JUICEFS_STORAGE" ]] || die "JUICEFS_STORAGE 不能为空。若文件系统已格式化且不需要在 Pod 内 format，请设置 JUICEFS_EXISTING_VOLUME=1。"
    [[ -n "$JUICEFS_BUCKET" ]] || die "JUICEFS_BUCKET 不能为空。若文件系统已格式化且不需要在 Pod 内 format，请设置 JUICEFS_EXISTING_VOLUME=1。"
  fi

  case "$JUICEFS_RECLAIM_POLICY" in
    Retain|Delete|Recycle)
      ;;
    *)
      die "JUICEFS_RECLAIM_POLICY 只能是 Retain、Delete 或 Recycle"
      ;;
  esac

  case "$JUICEFS_ALLOW_VOLUME_EXPANSION" in
    true|false)
      ;;
    *)
      die "JUICEFS_ALLOW_VOLUME_EXPANSION 只能是 true 或 false"
      ;;
  esac
}

connectivity_check() {
  log "检查集群连通性"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    kubectl_cmd get nodes
    return 0
  fi

  kubectl_cmd get nodes >/dev/null
}

install_driver() {
  local helm_args

  log "添加 Helm 仓库"
  helm_cmd repo add "$JUICEFS_REPO_NAME" "$JUICEFS_REPO_URL" --force-update
  helm_cmd repo update "$JUICEFS_REPO_NAME"

  helm_args=(
    upgrade --install
    "$JUICEFS_RELEASE"
    "$JUICEFS_CHART_REF"
    --namespace "$JUICEFS_CSI_NAMESPACE"
    --create-namespace
    --wait
    --timeout "$JUICEFS_WAIT_TIMEOUT"
  )

  if [[ -f "$JUICEFS_HELM_VALUES" ]]; then
    helm_args+=(--values "$JUICEFS_HELM_VALUES")
  else
    warn "找不到 Helm values 文件，跳过: $JUICEFS_HELM_VALUES"
  fi

  if [[ -n "$JUICEFS_CHART_VERSION" ]]; then
    helm_args+=(--version "$JUICEFS_CHART_VERSION")
  fi

  log "安装或升级 JuiceFS CSI Driver"
  helm_cmd "${helm_args[@]}"
}

apply_secret() {
  local secret_args

  log "创建或更新 JuiceFS Secret: ${JUICEFS_SECRET_NAMESPACE}/${JUICEFS_SECRET_NAME}"

  secret_args=(
    create secret generic "$JUICEFS_SECRET_NAME"
    --namespace "$JUICEFS_SECRET_NAMESPACE"
    --from-literal="name=$JUICEFS_NAME"
    --from-literal="metaurl=$JUICEFS_METAURL"
  )

  if [[ -n "$JUICEFS_STORAGE" ]]; then
    secret_args+=(--from-literal="storage=$JUICEFS_STORAGE")
  fi

  if [[ -n "$JUICEFS_BUCKET" ]]; then
    secret_args+=(--from-literal="bucket=$JUICEFS_BUCKET")
  fi

  if [[ -n "$JUICEFS_ACCESS_KEY" ]]; then
    secret_args+=(--from-literal="access-key=$JUICEFS_ACCESS_KEY")
  fi

  if [[ -n "$JUICEFS_SECRET_KEY" ]]; then
    secret_args+=(--from-literal="secret-key=$JUICEFS_SECRET_KEY")
  fi

  if [[ -n "$JUICEFS_FORMAT_OPTIONS" ]]; then
    secret_args+=(--from-literal="format-options=$JUICEFS_FORMAT_OPTIONS")
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN kubectl create secret generic $JUICEFS_SECRET_NAME --namespace $JUICEFS_SECRET_NAMESPACE --from-literal=name=<redacted> --from-literal=metaurl=<redacted> ..."
    echo "DRY-RUN kubectl -n $JUICEFS_SECRET_NAMESPACE label secret $JUICEFS_SECRET_NAME juicefs.com/validate-secret=true --overwrite"
    return 0
  fi

  KUBECONFIG="$KUBECONFIG_PATH" kubectl "${secret_args[@]}" --dry-run=client -o yaml | \
    KUBECONFIG="$KUBECONFIG_PATH" kubectl apply -f -
  KUBECONFIG="$KUBECONFIG_PATH" kubectl -n "$JUICEFS_SECRET_NAMESPACE" label secret "$JUICEFS_SECRET_NAME" \
    juicefs.com/validate-secret=true --overwrite >/dev/null
}

apply_namespace() {
  log "确保 namespace 存在: $JUICEFS_SECRET_NAMESPACE"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN kubectl create namespace $JUICEFS_SECRET_NAMESPACE --dry-run=client -o yaml | kubectl apply -f -"
    return 0
  fi

  KUBECONFIG="$KUBECONFIG_PATH" kubectl create namespace "$JUICEFS_SECRET_NAMESPACE" --dry-run=client -o yaml | \
    KUBECONFIG="$KUBECONFIG_PATH" kubectl apply -f -
}

render_mount_options() {
  local raw="$JUICEFS_MOUNT_OPTIONS"
  local option

  [[ -n "$raw" ]] || return 0

  echo "mountOptions:"
  IFS=',' read -ra MOUNT_OPTIONS <<<"$raw"
  for option in "${MOUNT_OPTIONS[@]}"; do
    option="${option#"${option%%[![:space:]]*}"}"
    option="${option%"${option##*[![:space:]]}"}"
    [[ -n "$option" ]] || continue
    printf '  - %s\n' "$option"
  done
}

render_storageclass() {
  cat <<YAML
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${JUICEFS_STORAGECLASS_NAME}
YAML

  if is_true "$JUICEFS_SET_DEFAULT_STORAGECLASS"; then
    cat <<'YAML'
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
YAML
  fi

  cat <<YAML
provisioner: csi.juicefs.com
reclaimPolicy: ${JUICEFS_RECLAIM_POLICY}
allowVolumeExpansion: ${JUICEFS_ALLOW_VOLUME_EXPANSION}
parameters:
  csi.storage.k8s.io/provisioner-secret-name: ${JUICEFS_SECRET_NAME}
  csi.storage.k8s.io/provisioner-secret-namespace: ${JUICEFS_SECRET_NAMESPACE}
  csi.storage.k8s.io/node-publish-secret-name: ${JUICEFS_SECRET_NAME}
  csi.storage.k8s.io/node-publish-secret-namespace: ${JUICEFS_SECRET_NAMESPACE}
  csi.storage.k8s.io/controller-expand-secret-name: ${JUICEFS_SECRET_NAME}
  csi.storage.k8s.io/controller-expand-secret-namespace: ${JUICEFS_SECRET_NAMESPACE}
YAML

  render_mount_options
}

apply_storageclass() {
  log "创建或更新 StorageClass: $JUICEFS_STORAGECLASS_NAME"
  render_storageclass | apply_yaml "StorageClass $JUICEFS_STORAGECLASS_NAME"
}

print_status() {
  log "Helm release"
  helm_cmd status "$JUICEFS_RELEASE" --namespace "$JUICEFS_CSI_NAMESPACE" || true

  echo
  log "JuiceFS CSI Pods"
  kubectl_cmd -n "$JUICEFS_CSI_NAMESPACE" get pods -l "app.kubernetes.io/name=juicefs-csi-driver" -o wide || true

  echo
  log "JuiceFS StorageClass"
  kubectl_cmd get storageclass "$JUICEFS_STORAGECLASS_NAME" -o wide || true
}

uninstall_driver() {
  log "卸载 JuiceFS CSI Driver Helm release: ${JUICEFS_CSI_NAMESPACE}/${JUICEFS_RELEASE}"
  helm_cmd uninstall "$JUICEFS_RELEASE" --namespace "$JUICEFS_CSI_NAMESPACE"
  echo
  echo "Secret 和 StorageClass 未自动删除。如需删除，请手动确认后执行："
  echo "  kubectl --kubeconfig \"$KUBECONFIG_PATH\" delete storageclass \"$JUICEFS_STORAGECLASS_NAME\""
  echo "  kubectl --kubeconfig \"$KUBECONFIG_PATH\" -n \"$JUICEFS_SECRET_NAMESPACE\" delete secret \"$JUICEFS_SECRET_NAME\""
}

main() {
  parse_args "$@"

  if [[ "$ACTION" == "render-storageclass" ]]; then
    load_env_file
    set_defaults
    validate_storageclass_inputs
    render_storageclass
    exit 0
  fi

  if [[ "$DRY_RUN" -ne 1 ]]; then
    require_cmd kubectl
    require_cmd helm
  fi

  load_env_file
  set_defaults
  resolve_kubeconfig

  case "$ACTION" in
    install)
      connectivity_check
      install_driver
      if is_true "$JUICEFS_CREATE_STORAGECLASS"; then
        validate_storageclass_inputs
        apply_namespace
        apply_secret
        apply_storageclass
      else
        warn "JUICEFS_CREATE_STORAGECLASS=0，仅安装 CSI Driver。"
      fi
      print_status
      ;;
    status)
      print_status
      ;;
    uninstall)
      uninstall_driver
      ;;
    *)
      die "未知动作: $ACTION"
      ;;
  esac
}

main "$@"
