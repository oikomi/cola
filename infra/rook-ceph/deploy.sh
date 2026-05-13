#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
K8S_DIR="$INFRA_DIR/k8s"
CLUSTER_CONFIG="$K8S_DIR/cluster/config.json"
CLUSTER_NODES="$K8S_DIR/cluster/nodes.json"
DEFAULT_ENV_FILE="$SCRIPT_DIR/rook-ceph.env"
DEFAULT_OPERATOR_VALUES="$SCRIPT_DIR/values-operator.yaml"

ACTION="install"
ENV_FILE=""
DRY_RUN=0
KUBECONFIG_PATH="${KUBECONFIG:-}"

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [install|status|render-values|render-training-pvc|uninstall] [options]

Deploy Rook-Ceph as a local distributed storage layer for the Cola Kubernetes cluster.

Actions:
  install                 Install/upgrade Rook operator and Ceph cluster; default action
  status                  Show Rook/Ceph resources and StorageClasses
  render-values           Print generated rook-ceph-cluster Helm values
  render-training-pvc     Print the training workspace PVC YAML
  uninstall               Remove Helm releases only; does not wipe disks

Options:
  --env-file <path>       Load Rook-Ceph settings from a local env file
  --kubeconfig <path>     Override kubeconfig path
  --dry-run               Print actions without applying cluster changes
  -h, --help              Show help

Important:
  OSD disks are not configured by default. Copy rook-ceph.env.example to
  rook-ceph.env and set ROOK_STORAGE_NODES before production install.
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

cluster_name() {
  [[ -f "$CLUSTER_CONFIG" ]] || die "找不到集群配置: $CLUSTER_CONFIG"
  json_field clusterName
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
      install | status | render-values | render-training-pvc | uninstall)
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
  ROOK_CEPH_NAMESPACE="${ROOK_CEPH_NAMESPACE:-rook-ceph}"
  ROOK_OPERATOR_RELEASE="${ROOK_OPERATOR_RELEASE:-rook-ceph}"
  ROOK_CLUSTER_RELEASE="${ROOK_CLUSTER_RELEASE:-rook-ceph-cluster}"
  ROOK_HELM_REPO_NAME="${ROOK_HELM_REPO_NAME:-rook-release}"
  ROOK_HELM_REPO_URL="${ROOK_HELM_REPO_URL:-https://charts.rook.io/release}"
  ROOK_OPERATOR_CHART="${ROOK_OPERATOR_CHART:-${ROOK_HELM_REPO_NAME}/rook-ceph}"
  ROOK_CLUSTER_CHART="${ROOK_CLUSTER_CHART:-${ROOK_HELM_REPO_NAME}/rook-ceph-cluster}"
  ROOK_CHART_VERSION="${ROOK_CHART_VERSION:-}"
  ROOK_WAIT_TIMEOUT="${ROOK_WAIT_TIMEOUT:-900s}"
  ROOK_OPERATOR_VALUES="${ROOK_OPERATOR_VALUES:-$DEFAULT_OPERATOR_VALUES}"

  ROOK_CEPH_CLUSTER_NAME="${ROOK_CEPH_CLUSTER_NAME:-rook-ceph}"
  ROOK_CEPH_IMAGE="${ROOK_CEPH_IMAGE:-quay.io/ceph/ceph:v19.2.3}"
  ROOK_ALLOW_MASTER_NODES="${ROOK_ALLOW_MASTER_NODES:-0}"
  ROOK_STORAGE_USE_ALL_NODES="${ROOK_STORAGE_USE_ALL_NODES:-0}"
  ROOK_STORAGE_USE_ALL_DEVICES="${ROOK_STORAGE_USE_ALL_DEVICES:-0}"
  ROOK_STORAGE_NODES="${ROOK_STORAGE_NODES:-[]}"
  ROOK_REPLICATED_SIZE="${ROOK_REPLICATED_SIZE:-3}"
  ROOK_MON_COUNT="${ROOK_MON_COUNT:-3}"
  ROOK_DASHBOARD_ENABLED="${ROOK_DASHBOARD_ENABLED:-true}"
  ROOK_DASHBOARD_SSL="${ROOK_DASHBOARD_SSL:-false}"

  ROOK_CEPHFS_STORAGECLASS="${ROOK_CEPHFS_STORAGECLASS:-cola-cephfs}"
  ROOK_RBD_STORAGECLASS="${ROOK_RBD_STORAGECLASS:-cola-rbd}"
  ROOK_CEPHFS_DEFAULT_STORAGECLASS="${ROOK_CEPHFS_DEFAULT_STORAGECLASS:-0}"
  ROOK_RBD_DEFAULT_STORAGECLASS="${ROOK_RBD_DEFAULT_STORAGECLASS:-0}"

  ROOK_CREATE_TRAINING_PVC="${ROOK_CREATE_TRAINING_PVC:-0}"
  ROOK_TRAINING_NAMESPACE="${ROOK_TRAINING_NAMESPACE:-remote-work}"
  ROOK_TRAINING_PVC_NAME="${ROOK_TRAINING_PVC_NAME:-cola-training-workspace}"
  ROOK_TRAINING_PVC_SIZE="${ROOK_TRAINING_PVC_SIZE:-500Gi}"
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

validate_json_nodes() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$ROOK_STORAGE_NODES" <<'PY'
import json
import sys

raw = sys.argv[1]
try:
    nodes = json.loads(raw)
except json.JSONDecodeError as exc:
    raise SystemExit(f"ROOK_STORAGE_NODES 不是合法 JSON: {exc}")

if not isinstance(nodes, list):
    raise SystemExit("ROOK_STORAGE_NODES 必须是 JSON array")

for index, node in enumerate(nodes):
    if not isinstance(node, dict) or not node.get("name"):
        raise SystemExit(f"ROOK_STORAGE_NODES[{index}] 必须包含 name")
    devices = node.get("devices", [])
    if devices is not None and not isinstance(devices, list):
        raise SystemExit(f"ROOK_STORAGE_NODES[{index}].devices 必须是 array")
    for device_index, device in enumerate(devices or []):
        if not isinstance(device, dict) or not device.get("name"):
            raise SystemExit(
                f"ROOK_STORAGE_NODES[{index}].devices[{device_index}] 必须包含 name"
            )
PY
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    node --input-type=module - "$ROOK_STORAGE_NODES" <<'EOF'
const raw = process.argv[2];
let nodes;
try {
  nodes = JSON.parse(raw);
} catch (error) {
  throw new Error(`ROOK_STORAGE_NODES 不是合法 JSON: ${error.message}`);
}
if (!Array.isArray(nodes)) throw new Error("ROOK_STORAGE_NODES 必须是 JSON array");
nodes.forEach((node, index) => {
  if (!node || typeof node !== "object" || !node.name) {
    throw new Error(`ROOK_STORAGE_NODES[${index}] 必须包含 name`);
  }
  const devices = node.devices ?? [];
  if (!Array.isArray(devices)) {
    throw new Error(`ROOK_STORAGE_NODES[${index}].devices 必须是 array`);
  }
  devices.forEach((device, deviceIndex) => {
    if (!device || typeof device !== "object" || !device.name) {
      throw new Error(`ROOK_STORAGE_NODES[${index}].devices[${deviceIndex}] 必须包含 name`);
    }
  });
});
EOF
    return 0
  fi

  die "缺少命令: python3 或 node，用于校验 ROOK_STORAGE_NODES"
}

json_array_length() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$1" <<'PY'
import json
import sys

value = json.loads(sys.argv[1])
print(len(value) if isinstance(value, list) else 0)
PY
    return 0
  fi

  node --input-type=module - "$1" <<'EOF'
const value = JSON.parse(process.argv[2]);
process.stdout.write(String(Array.isArray(value) ? value.length : 0));
EOF
}

validate_inputs() {
  [[ -n "$ROOK_CEPH_NAMESPACE" ]] || die "ROOK_CEPH_NAMESPACE 不能为空"
  [[ -n "$ROOK_CEPH_CLUSTER_NAME" ]] || die "ROOK_CEPH_CLUSTER_NAME 不能为空"
  [[ -n "$ROOK_CEPH_IMAGE" ]] || die "ROOK_CEPH_IMAGE 不能为空"
  [[ -n "$ROOK_CEPHFS_STORAGECLASS" ]] || die "ROOK_CEPHFS_STORAGECLASS 不能为空"
  [[ -n "$ROOK_RBD_STORAGECLASS" ]] || die "ROOK_RBD_STORAGECLASS 不能为空"

  case "$ROOK_REPLICATED_SIZE" in
    '' | *[!0-9]*)
      die "ROOK_REPLICATED_SIZE 必须是正整数"
      ;;
  esac

  case "$ROOK_MON_COUNT" in
    '' | *[!0-9]*)
      die "ROOK_MON_COUNT 必须是正整数"
      ;;
  esac

  validate_json_nodes

  if ! is_true "$ROOK_STORAGE_USE_ALL_NODES"; then
    local node_count
    node_count="$(json_array_length "$ROOK_STORAGE_NODES")"
    if [[ "$node_count" -eq 0 ]]; then
      warn "ROOK_STORAGE_NODES 为空。render 可以继续，但 install 后不会有 OSD 数据盘。生产部署前必须显式配置。"
    fi
  fi

  if [[ "$ROOK_REPLICATED_SIZE" -lt 3 ]]; then
    warn "ROOK_REPLICATED_SIZE=$ROOK_REPLICATED_SIZE 低于生产建议值 3。"
  fi
}

bool_yaml() {
  if is_true "$1"; then
    echo "true"
  else
    echo "false"
  fi
}

default_class_annotation() {
  if is_true "$1"; then
    cat <<'YAML'
      storageclass.kubernetes.io/is-default-class: "true"
YAML
  else
    echo "      storageclass.kubernetes.io/is-default-class: \"false\""
  fi
}

render_storage_nodes() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$ROOK_STORAGE_NODES" <<'PY'
import json
import sys

nodes = json.loads(sys.argv[1])
for node in nodes:
    print(f"    - name: {node['name']}")
    devices = node.get("devices") or []
    if devices:
        print("      devices:")
        for device in devices:
            print(f"        - name: {device['name']}")
            config = device.get("config")
            if isinstance(config, dict) and config:
                print("          config:")
                for key, value in config.items():
                    print(f"            {key}: {json.dumps(str(value))}")
PY
    return 0
  fi

  node --input-type=module - "$ROOK_STORAGE_NODES" <<'EOF'
const nodes = JSON.parse(process.argv[2]);
for (const node of nodes) {
  console.log(`    - name: ${node.name}`);
  const devices = node.devices ?? [];
  if (devices.length > 0) {
    console.log("      devices:");
    for (const device of devices) {
      console.log(`        - name: ${device.name}`);
      if (device.config && typeof device.config === "object") {
        console.log("          config:");
        for (const [key, value] of Object.entries(device.config)) {
          console.log(`            ${key}: ${JSON.stringify(String(value))}`);
        }
      }
    }
  }
}
EOF
}

render_cluster_values() {
  cat <<YAML
operatorNamespace: ${ROOK_CEPH_NAMESPACE}

clusterName: ${ROOK_CEPH_CLUSTER_NAME}

toolbox:
  enabled: true

monitoring:
  enabled: false

cephClusterSpec:
  cephVersion:
    image: ${ROOK_CEPH_IMAGE}
    allowUnsupported: false
  dataDirHostPath: /var/lib/rook
  mon:
    count: ${ROOK_MON_COUNT}
    allowMultiplePerNode: false
  mgr:
    count: 2
    allowMultiplePerNode: false
  dashboard:
    enabled: $(bool_yaml "$ROOK_DASHBOARD_ENABLED")
    ssl: $(bool_yaml "$ROOK_DASHBOARD_SSL")
  crashCollector:
    disable: false
  placement:
    all:
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          operator: Exists
          effect: NoSchedule
        - key: node-role.kubernetes.io/master
          operator: Exists
          effect: NoSchedule
YAML

  if ! is_true "$ROOK_ALLOW_MASTER_NODES"; then
    cat <<'YAML'
      nodeAffinity:
        requiredDuringSchedulingIgnoredDuringExecution:
          nodeSelectorTerms:
            - matchExpressions:
                - key: node-role.kubernetes.io/control-plane
                  operator: DoesNotExist
                - key: node-role.kubernetes.io/master
                  operator: DoesNotExist
YAML
  fi

  cat <<YAML
  storage:
    useAllNodes: $(bool_yaml "$ROOK_STORAGE_USE_ALL_NODES")
    useAllDevices: $(bool_yaml "$ROOK_STORAGE_USE_ALL_DEVICES")
YAML

  if ! is_true "$ROOK_STORAGE_USE_ALL_NODES"; then
    cat <<'YAML'
    nodes:
YAML
    render_storage_nodes
  fi

  cat <<YAML

cephBlockPools:
  - name: cola-rbd
    spec:
      failureDomain: host
      replicated:
        size: ${ROOK_REPLICATED_SIZE}
    storageClass:
      enabled: true
      name: ${ROOK_RBD_STORAGECLASS}
      isDefault: $(bool_yaml "$ROOK_RBD_DEFAULT_STORAGECLASS")
      reclaimPolicy: Retain
      allowVolumeExpansion: true
      volumeBindingMode: Immediate
      parameters:
        csi.storage.k8s.io/provisioner-secret-name: rook-csi-rbd-provisioner
        csi.storage.k8s.io/provisioner-secret-namespace: "{{ .Release.Namespace }}"
        csi.storage.k8s.io/controller-expand-secret-name: rook-csi-rbd-provisioner
        csi.storage.k8s.io/controller-expand-secret-namespace: "{{ .Release.Namespace }}"
        csi.storage.k8s.io/controller-publish-secret-name: rook-csi-rbd-provisioner
        csi.storage.k8s.io/controller-publish-secret-namespace: "{{ .Release.Namespace }}"
        csi.storage.k8s.io/node-stage-secret-name: rook-csi-rbd-node
        csi.storage.k8s.io/node-stage-secret-namespace: "{{ .Release.Namespace }}"
        imageFormat: "2"
        imageFeatures: layering
        csi.storage.k8s.io/fstype: ext4

cephFileSystems:
  - name: cola-cephfs
    spec:
      metadataPool:
        replicated:
          size: ${ROOK_REPLICATED_SIZE}
      dataPools:
        - name: replicated
          failureDomain: host
          replicated:
            size: ${ROOK_REPLICATED_SIZE}
      preserveFilesystemOnDelete: true
      metadataServer:
        activeCount: 1
        activeStandby: true
    storageClass:
      enabled: true
      name: ${ROOK_CEPHFS_STORAGECLASS}
      pool: replicated
      isDefault: $(bool_yaml "$ROOK_CEPHFS_DEFAULT_STORAGECLASS")
      reclaimPolicy: Retain
      allowVolumeExpansion: true
      volumeBindingMode: Immediate
      parameters:
        csi.storage.k8s.io/provisioner-secret-name: rook-csi-cephfs-provisioner
        csi.storage.k8s.io/provisioner-secret-namespace: "{{ .Release.Namespace }}"
        csi.storage.k8s.io/controller-expand-secret-name: rook-csi-cephfs-provisioner
        csi.storage.k8s.io/controller-expand-secret-namespace: "{{ .Release.Namespace }}"
        csi.storage.k8s.io/controller-publish-secret-name: rook-csi-cephfs-provisioner
        csi.storage.k8s.io/controller-publish-secret-namespace: "{{ .Release.Namespace }}"
        csi.storage.k8s.io/node-stage-secret-name: rook-csi-cephfs-node
        csi.storage.k8s.io/node-stage-secret-namespace: "{{ .Release.Namespace }}"
        csi.storage.k8s.io/fstype: ext4

cephObjectStores: []
YAML
}

render_training_pvc() {
  sed \
    -e "s|\${ROOK_TRAINING_PVC_NAME}|${ROOK_TRAINING_PVC_NAME}|g" \
    -e "s|\${ROOK_TRAINING_NAMESPACE}|${ROOK_TRAINING_NAMESPACE}|g" \
    -e "s|\${ROOK_CEPHFS_STORAGECLASS}|${ROOK_CEPHFS_STORAGECLASS}|g" \
    -e "s|\${ROOK_TRAINING_PVC_SIZE}|${ROOK_TRAINING_PVC_SIZE}|g" \
    "$SCRIPT_DIR/manifests/training-pvc.yaml.tpl"
}

connectivity_check() {
  log "检查集群连通性"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    kubectl_cmd get nodes
    return 0
  fi

  kubectl_cmd get nodes >/dev/null
}

install_operator() {
  log "添加 Helm 仓库"
  helm_cmd repo add "$ROOK_HELM_REPO_NAME" "$ROOK_HELM_REPO_URL" --force-update
  helm_cmd repo update "$ROOK_HELM_REPO_NAME"

  log "安装或升级 Rook-Ceph Operator"
  local args=(
    upgrade --install "$ROOK_OPERATOR_RELEASE" "$ROOK_OPERATOR_CHART"
    --namespace "$ROOK_CEPH_NAMESPACE"
    --create-namespace
    --wait
    --timeout "$ROOK_WAIT_TIMEOUT"
    --values "$ROOK_OPERATOR_VALUES"
  )

  if [[ -n "$ROOK_CHART_VERSION" ]]; then
    args+=(--version "$ROOK_CHART_VERSION")
  fi

  helm_cmd "${args[@]}"
}

install_cluster() {
  log "安装或升级 CephCluster、CephFS、RBD StorageClass"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry-run: render rook-ceph-cluster values"
    render_cluster_values
    helm_cmd upgrade --install "$ROOK_CLUSTER_RELEASE" "$ROOK_CLUSTER_CHART" \
      --namespace "$ROOK_CEPH_NAMESPACE" \
      --wait \
      --timeout "$ROOK_WAIT_TIMEOUT" \
      --values -
    return 0
  fi

  local values_file
  values_file="$(mktemp)"
  render_cluster_values >"$values_file"
  trap 'rm -f "$values_file"' RETURN

  local args=(
    upgrade --install "$ROOK_CLUSTER_RELEASE" "$ROOK_CLUSTER_CHART"
    --namespace "$ROOK_CEPH_NAMESPACE"
    --wait
    --timeout "$ROOK_WAIT_TIMEOUT"
    --values "$values_file"
  )

  if [[ -n "$ROOK_CHART_VERSION" ]]; then
    args+=(--version "$ROOK_CHART_VERSION")
  fi

  helm_cmd "${args[@]}"
}

apply_training_pvc() {
  if ! is_true "$ROOK_CREATE_TRAINING_PVC"; then
    return 0
  fi

  log "创建或更新训练平台共享 PVC: ${ROOK_TRAINING_NAMESPACE}/${ROOK_TRAINING_PVC_NAME}"
  kubectl_cmd create namespace "$ROOK_TRAINING_NAMESPACE" --dry-run=client -o yaml | apply_yaml "namespace $ROOK_TRAINING_NAMESPACE"
  render_training_pvc | apply_yaml "training PVC $ROOK_TRAINING_PVC_NAME"
}

status() {
  log "Kubernetes nodes"
  kubectl_cmd get nodes -o wide || true
  echo

  log "Rook Helm releases"
  helm_cmd status "$ROOK_OPERATOR_RELEASE" --namespace "$ROOK_CEPH_NAMESPACE" || true
  helm_cmd status "$ROOK_CLUSTER_RELEASE" --namespace "$ROOK_CEPH_NAMESPACE" || true
  echo

  log "Rook/Ceph pods"
  kubectl_cmd -n "$ROOK_CEPH_NAMESPACE" get pods -o wide || true
  echo

  log "Ceph custom resources"
  kubectl_cmd -n "$ROOK_CEPH_NAMESPACE" get cephcluster,cephblockpool,cephfilesystem || true
  echo

  log "StorageClasses"
  kubectl_cmd get storageclass "$ROOK_CEPHFS_STORAGECLASS" "$ROOK_RBD_STORAGECLASS" -o wide || true
  echo

  log "Training PVC"
  kubectl_cmd -n "$ROOK_TRAINING_NAMESPACE" get pvc "$ROOK_TRAINING_PVC_NAME" -o wide || true
}

uninstall() {
  log "卸载 Rook-Ceph cluster Helm release: ${ROOK_CEPH_NAMESPACE}/${ROOK_CLUSTER_RELEASE}"
  helm_cmd uninstall "$ROOK_CLUSTER_RELEASE" --namespace "$ROOK_CEPH_NAMESPACE" || true

  log "卸载 Rook-Ceph operator Helm release: ${ROOK_CEPH_NAMESPACE}/${ROOK_OPERATOR_RELEASE}"
  helm_cmd uninstall "$ROOK_OPERATOR_RELEASE" --namespace "$ROOK_CEPH_NAMESPACE" || true

  cat <<EOF

注意：
- uninstall 不会清理 OSD 磁盘数据。
- 如需重装并复用磁盘，请先确认 Ceph/Rook 清理流程。
- 不要直接格式化生产磁盘，除非已经确认数据不再需要。
EOF
}

main() {
  parse_args "$@"
  load_env_file
  set_defaults
  validate_inputs

  if [[ "$ACTION" == "render-values" ]]; then
    render_cluster_values
    return 0
  fi

  if [[ "$ACTION" == "render-training-pvc" ]]; then
    render_training_pvc
    return 0
  fi

  if [[ "$DRY_RUN" -eq 0 ]]; then
    require_cmd kubectl
    require_cmd helm
  fi
  resolve_kubeconfig

  case "$ACTION" in
    install)
      connectivity_check
      install_operator
      install_cluster
      apply_training_pvc
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
