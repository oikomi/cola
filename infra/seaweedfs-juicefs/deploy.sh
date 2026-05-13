#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
K8S_DIR="$INFRA_DIR/k8s"
CLUSTER_CONFIG="$K8S_DIR/cluster/config.json"
DEFAULT_ENV_FILE="$SCRIPT_DIR/seaweedfs-juicefs.env"

ACTION="install"
ENV_FILE=""
DRY_RUN=0
KUBECONFIG_PATH="${KUBECONFIG:-}"

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [install|seaweedfs|juicefs|pvc|status|render-seaweedfs-values|render-juicefs-secret|render-storageclass|render-training-pvc|uninstall] [options]

Deploy a complete SeaweedFS + JuiceFS stack:
  SeaweedFS S3 backend + JuiceFS metadata Redis + JuiceFS CSI + StorageClass + optional training PVC.

Actions:
  install                    Install/upgrade the full stack; default action
  seaweedfs                  Install/upgrade only SeaweedFS
  juicefs                    Install/upgrade metadata Redis + JuiceFS CSI + StorageClass
  pvc                        Create/update only the training workspace PVC
  status                     Show Kubernetes resources
  render-seaweedfs-values    Print generated SeaweedFS Helm values
  render-juicefs-secret      Print generated JuiceFS Secret YAML
  render-storageclass        Print generated JuiceFS StorageClass YAML
  render-training-pvc        Print generated training PVC YAML
  uninstall                  Remove Helm releases only; does not wipe node data

Options:
  --env-file <path>          Load settings from a local env file
  --kubeconfig <path>        Override kubeconfig path
  --dry-run                  Print actions without applying cluster changes
  -h, --help                 Show help
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
      install | seaweedfs | juicefs | pvc | status | render-seaweedfs-values | render-juicefs-secret | render-storageclass | render-training-pvc | uninstall)
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
  STORAGE_NAMESPACE="${STORAGE_NAMESPACE:-storage}"

  SEAWEEDFS_VOLUME_NODES="${SEAWEEDFS_VOLUME_NODES:-[]}"
  SEAWEEDFS_RELEASE="${SEAWEEDFS_RELEASE:-seaweedfs}"
  SEAWEEDFS_HELM_REPO_NAME="${SEAWEEDFS_HELM_REPO_NAME:-seaweedfs}"
  SEAWEEDFS_HELM_REPO_URL="${SEAWEEDFS_HELM_REPO_URL:-https://seaweedfs.github.io/seaweedfs/helm}"
  SEAWEEDFS_CHART="${SEAWEEDFS_CHART:-${SEAWEEDFS_HELM_REPO_NAME}/seaweedfs}"
  SEAWEEDFS_CHART_VERSION="${SEAWEEDFS_CHART_VERSION:-}"
  SEAWEEDFS_WAIT_TIMEOUT="${SEAWEEDFS_WAIT_TIMEOUT:-600s}"
  SEAWEEDFS_DATA_ROOT="${SEAWEEDFS_DATA_ROOT:-/var/lib/cola/seaweedfs}"
  SEAWEEDFS_REPLICATION="${SEAWEEDFS_REPLICATION:-001}"
  SEAWEEDFS_MASTER_REPLICAS="${SEAWEEDFS_MASTER_REPLICAS:-1}"
  SEAWEEDFS_FILER_REPLICAS="${SEAWEEDFS_FILER_REPLICAS:-1}"
  SEAWEEDFS_S3_REPLICAS="${SEAWEEDFS_S3_REPLICAS:-1}"
  SEAWEEDFS_VOLUME_MAX="${SEAWEEDFS_VOLUME_MAX:-100}"
  SEAWEEDFS_S3_SERVICE_NAME="${SEAWEEDFS_S3_SERVICE_NAME:-seaweedfs-s3}"
  SEAWEEDFS_S3_PORT="${SEAWEEDFS_S3_PORT:-8333}"
  SEAWEEDFS_S3_BUCKET="${SEAWEEDFS_S3_BUCKET:-cola-juicefs}"
  SEAWEEDFS_S3_ACCESS_KEY="${SEAWEEDFS_S3_ACCESS_KEY:-seaweedfs}"
  SEAWEEDFS_S3_SECRET_KEY="${SEAWEEDFS_S3_SECRET_KEY:-seaweedfs-secret}"

  JUICEFS_METADATA_REDIS_NAME="${JUICEFS_METADATA_REDIS_NAME:-juicefs-redis}"
  JUICEFS_METADATA_REDIS_NODE_NAME="${JUICEFS_METADATA_REDIS_NODE_NAME:-node-01}"
  JUICEFS_METADATA_REDIS_ROOT="${JUICEFS_METADATA_REDIS_ROOT:-/var/lib/cola/juicefs}"
  JUICEFS_METADATA_REDIS_IMAGE="${JUICEFS_METADATA_REDIS_IMAGE:-redis:7-alpine}"

  JUICEFS_RELEASE="${JUICEFS_RELEASE:-juicefs-csi-driver}"
  JUICEFS_REPO_NAME="${JUICEFS_REPO_NAME:-juicefs}"
  JUICEFS_REPO_URL="${JUICEFS_REPO_URL:-https://juicedata.github.io/charts/}"
  JUICEFS_CHART_REF="${JUICEFS_CHART_REF:-${JUICEFS_REPO_NAME}/juicefs-csi-driver}"
  JUICEFS_CHART_VERSION="${JUICEFS_CHART_VERSION:-}"
  JUICEFS_HELM_VALUES="${JUICEFS_HELM_VALUES:-../juicefs/values.yaml}"
  JUICEFS_WAIT_TIMEOUT="${JUICEFS_WAIT_TIMEOUT:-600s}"

  JUICEFS_SECRET_NAMESPACE="${JUICEFS_SECRET_NAMESPACE:-kube-system}"
  JUICEFS_SECRET_NAME="${JUICEFS_SECRET_NAME:-juicefs-secret}"
  JUICEFS_NAME="${JUICEFS_NAME:-cola-juicefs}"
  JUICEFS_STORAGECLASS_NAME="${JUICEFS_STORAGECLASS_NAME:-juicefs-sc}"
  JUICEFS_SET_DEFAULT_STORAGECLASS="${JUICEFS_SET_DEFAULT_STORAGECLASS:-0}"
  JUICEFS_RECLAIM_POLICY="${JUICEFS_RECLAIM_POLICY:-Retain}"
  JUICEFS_ALLOW_VOLUME_EXPANSION="${JUICEFS_ALLOW_VOLUME_EXPANSION:-true}"
  JUICEFS_FORMAT_OPTIONS="${JUICEFS_FORMAT_OPTIONS:-}"
  JUICEFS_MOUNT_OPTIONS="${JUICEFS_MOUNT_OPTIONS:-}"

  CREATE_TRAINING_PVC="${CREATE_TRAINING_PVC:-1}"
  TRAINING_NAMESPACE="${TRAINING_NAMESPACE:-remote-work}"
  TRAINING_PVC_NAME="${TRAINING_PVC_NAME:-cola-training-workspace}"
  TRAINING_PVC_SIZE="${TRAINING_PVC_SIZE:-500Gi}"
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
    python3 - "$SEAWEEDFS_VOLUME_NODES" <<'PY'
import json
import sys

raw = sys.argv[1]
try:
    nodes = json.loads(raw)
except json.JSONDecodeError as exc:
    raise SystemExit(f"SEAWEEDFS_VOLUME_NODES 不是合法 JSON: {exc}")

if not isinstance(nodes, list):
    raise SystemExit("SEAWEEDFS_VOLUME_NODES 必须是 JSON array")

for index, node in enumerate(nodes):
    if not isinstance(node, dict) or not node.get("name"):
        raise SystemExit(f"SEAWEEDFS_VOLUME_NODES[{index}] 必须包含 name")
    if not node.get("path"):
        raise SystemExit(f"SEAWEEDFS_VOLUME_NODES[{index}] 必须包含 path")
PY
    return 0
  fi

  node --input-type=module - "$SEAWEEDFS_VOLUME_NODES" <<'EOF'
const nodes = JSON.parse(process.argv[2]);
if (!Array.isArray(nodes)) throw new Error("SEAWEEDFS_VOLUME_NODES 必须是 JSON array");
nodes.forEach((node, index) => {
  if (!node || typeof node !== "object" || !node.name) {
    throw new Error(`SEAWEEDFS_VOLUME_NODES[${index}] 必须包含 name`);
  }
  if (!node.path) {
    throw new Error(`SEAWEEDFS_VOLUME_NODES[${index}] 必须包含 path`);
  }
});
EOF
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
  [[ -n "$STORAGE_NAMESPACE" ]] || die "STORAGE_NAMESPACE 不能为空"
  [[ -n "$SEAWEEDFS_S3_BUCKET" ]] || die "SEAWEEDFS_S3_BUCKET 不能为空"
  [[ -n "$SEAWEEDFS_S3_ACCESS_KEY" ]] || die "SEAWEEDFS_S3_ACCESS_KEY 不能为空"
  [[ -n "$SEAWEEDFS_S3_SECRET_KEY" ]] || die "SEAWEEDFS_S3_SECRET_KEY 不能为空"
  [[ -n "$JUICEFS_METADATA_REDIS_NAME" ]] || die "JUICEFS_METADATA_REDIS_NAME 不能为空"
  [[ -n "$JUICEFS_METADATA_REDIS_NODE_NAME" ]] || die "JUICEFS_METADATA_REDIS_NODE_NAME 不能为空"
  [[ -n "$JUICEFS_NAME" ]] || die "JUICEFS_NAME 不能为空"
  [[ -n "$JUICEFS_STORAGECLASS_NAME" ]] || die "JUICEFS_STORAGECLASS_NAME 不能为空"

  validate_json_nodes

  local node_count
  node_count="$(json_array_length "$SEAWEEDFS_VOLUME_NODES")"
  if [[ "$node_count" -eq 0 ]]; then
    die "SEAWEEDFS_VOLUME_NODES 不能为空。至少配置一个 volume 节点。"
  fi

  if [[ "$node_count" -lt 3 ]]; then
    warn "当前只有 ${node_count} 个 SeaweedFS volume 节点。可以测试，但不是生产级分布式存储。"
  fi
}

render_volume_affinity_values() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$SEAWEEDFS_VOLUME_NODES" <<'PY'
import json
import sys

for node in json.loads(sys.argv[1]):
    print(f"                  - {node['name']}")
PY
    return 0
  fi

  node --input-type=module - "$SEAWEEDFS_VOLUME_NODES" <<'EOF'
for (const node of JSON.parse(process.argv[2])) {
  console.log(`                  - ${node.name}`);
}
EOF
}

first_volume_path() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$SEAWEEDFS_VOLUME_NODES" <<'PY'
import json
import sys

nodes = json.loads(sys.argv[1])
print(nodes[0]["path"])
PY
    return 0
  fi

  node --input-type=module - "$SEAWEEDFS_VOLUME_NODES" <<'EOF'
const nodes = JSON.parse(process.argv[2]);
process.stdout.write(nodes[0].path);
EOF
}

juicefs_metaurl() {
  echo "redis://${JUICEFS_METADATA_REDIS_NAME}.${STORAGE_NAMESPACE}.svc.cluster.local:6379/1"
}

juicefs_bucket_url() {
  echo "http://${SEAWEEDFS_S3_SERVICE_NAME}.${STORAGE_NAMESPACE}.svc.cluster.local:${SEAWEEDFS_S3_PORT}/${SEAWEEDFS_S3_BUCKET}"
}

render_seaweedfs_values() {
  local volume_path
  volume_path="$(first_volume_path)"

  cat <<YAML
seaweedfs:
  enableSecurity: true
  monitoring:
    enabled: false
  enableReplication: true
  replicationPlacement: "${SEAWEEDFS_REPLICATION}"

master:
  enabled: true
  replicas: ${SEAWEEDFS_MASTER_REPLICAS}
  volumeSizeLimitMB: 30000
  defaultReplication: "${SEAWEEDFS_REPLICATION}"
  data:
    type: hostPath
    hostPathPrefix: ${SEAWEEDFS_DATA_ROOT%/}/master
  logs:
    type: hostPath
    hostPathPrefix: ${SEAWEEDFS_DATA_ROOT%/}/master-logs

volume:
  enabled: true
  replicas: $(json_array_length "$SEAWEEDFS_VOLUME_NODES")
  dataDirs:
    - name: data
      type: hostPath
      hostPathPrefix: ${volume_path}
      maxVolumes: ${SEAWEEDFS_VOLUME_MAX}
  rack: default
  nodeSelector: {}
  affinity: |
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: kubernetes.io/hostname
                operator: In
                values:
$(render_volume_affinity_values)

filer:
  enabled: true
  replicas: ${SEAWEEDFS_FILER_REPLICAS}
  defaultReplicaPlacement: "${SEAWEEDFS_REPLICATION}"
  data:
    type: hostPath
    hostPathPrefix: ${SEAWEEDFS_DATA_ROOT%/}/filer
  logs:
    type: hostPath
    hostPathPrefix: ${SEAWEEDFS_DATA_ROOT%/}/filer-logs

s3:
  enabled: true
  replicas: ${SEAWEEDFS_S3_REPLICAS}
  port: ${SEAWEEDFS_S3_PORT}
  allowEmptyFolder: true
  enableAuth: true
  credentials:
    admin:
      accessKey: ${SEAWEEDFS_S3_ACCESS_KEY}
      secretKey: ${SEAWEEDFS_S3_SECRET_KEY}
  createBuckets:
    - name: ${SEAWEEDFS_S3_BUCKET}
      anonymousRead: false
  logs:
    type: hostPath
    hostPathPrefix: ${SEAWEEDFS_DATA_ROOT%/}/s3-logs

ingress:
  enabled: false
YAML
}

render_metadata_redis() {
  local redis_dir="${JUICEFS_METADATA_REDIS_ROOT%/}/redis"

  cat <<YAML
apiVersion: v1
kind: Namespace
metadata:
  name: ${STORAGE_NAMESPACE}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${JUICEFS_METADATA_REDIS_NAME}
  namespace: ${STORAGE_NAMESPACE}
  labels:
    app.kubernetes.io/name: ${JUICEFS_METADATA_REDIS_NAME}
    app.kubernetes.io/part-of: seaweedfs-juicefs
    app.kubernetes.io/component: juicefs-metadata
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${JUICEFS_METADATA_REDIS_NAME}
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${JUICEFS_METADATA_REDIS_NAME}
        app.kubernetes.io/part-of: seaweedfs-juicefs
        app.kubernetes.io/component: juicefs-metadata
    spec:
      nodeSelector:
        kubernetes.io/hostname: ${JUICEFS_METADATA_REDIS_NODE_NAME}
      containers:
        - name: redis
          image: ${JUICEFS_METADATA_REDIS_IMAGE}
          imagePullPolicy: IfNotPresent
          args: ["redis-server", "--appendonly", "yes", "--dir", "/data"]
          ports:
            - name: redis
              containerPort: 6379
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          hostPath:
            path: ${redis_dir}
            type: DirectoryOrCreate
---
apiVersion: v1
kind: Service
metadata:
  name: ${JUICEFS_METADATA_REDIS_NAME}
  namespace: ${STORAGE_NAMESPACE}
spec:
  selector:
    app.kubernetes.io/name: ${JUICEFS_METADATA_REDIS_NAME}
  ports:
    - name: redis
      port: 6379
      targetPort: redis
YAML
}

render_juicefs_secret() {
  cat <<YAML
apiVersion: v1
kind: Secret
metadata:
  name: ${JUICEFS_SECRET_NAME}
  namespace: ${JUICEFS_SECRET_NAMESPACE}
  labels:
    juicefs.com/validate-secret: "true"
type: Opaque
stringData:
  name: ${JUICEFS_NAME}
  metaurl: $(juicefs_metaurl)
  storage: s3
  bucket: $(juicefs_bucket_url)
  access-key: ${SEAWEEDFS_S3_ACCESS_KEY}
  secret-key: ${SEAWEEDFS_S3_SECRET_KEY}
YAML

  if [[ -n "$JUICEFS_FORMAT_OPTIONS" ]]; then
    printf '  format-options: %s\n' "$JUICEFS_FORMAT_OPTIONS"
  fi
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

render_training_pvc() {
  sed \
    -e "s|\${TRAINING_PVC_NAME}|${TRAINING_PVC_NAME}|g" \
    -e "s|\${TRAINING_NAMESPACE}|${TRAINING_NAMESPACE}|g" \
    -e "s|\${JUICEFS_STORAGECLASS_NAME}|${JUICEFS_STORAGECLASS_NAME}|g" \
    -e "s|\${TRAINING_PVC_SIZE}|${TRAINING_PVC_SIZE}|g" \
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

install_seaweedfs() {
  log "添加 SeaweedFS Helm 仓库"
  helm_cmd repo add "$SEAWEEDFS_HELM_REPO_NAME" "$SEAWEEDFS_HELM_REPO_URL" --force-update
  helm_cmd repo update "$SEAWEEDFS_HELM_REPO_NAME"

  log "安装或升级 SeaweedFS"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry-run: render SeaweedFS Helm values"
    render_seaweedfs_values
    helm_cmd upgrade --install "$SEAWEEDFS_RELEASE" "$SEAWEEDFS_CHART" \
      --namespace "$STORAGE_NAMESPACE" \
      --create-namespace \
      --wait \
      --timeout "$SEAWEEDFS_WAIT_TIMEOUT" \
      --values -
    return 0
  fi

  local values_file
  values_file="$(mktemp)"
  render_seaweedfs_values >"$values_file"
  trap 'rm -f "$values_file"' RETURN

  local args=(
    upgrade --install "$SEAWEEDFS_RELEASE" "$SEAWEEDFS_CHART"
    --namespace "$STORAGE_NAMESPACE"
    --create-namespace
    --wait
    --timeout "$SEAWEEDFS_WAIT_TIMEOUT"
    --values "$values_file"
  )

  if [[ -n "$SEAWEEDFS_CHART_VERSION" ]]; then
    args+=(--version "$SEAWEEDFS_CHART_VERSION")
  fi

  helm_cmd "${args[@]}"
}

apply_metadata_redis() {
  log "创建或更新 JuiceFS metadata Redis"
  render_metadata_redis | apply_yaml "JuiceFS metadata Redis"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  kubectl_cmd -n "$STORAGE_NAMESPACE" rollout status "deployment/${JUICEFS_METADATA_REDIS_NAME}" --timeout="$JUICEFS_WAIT_TIMEOUT"
}

install_juicefs_driver() {
  log "添加 JuiceFS Helm 仓库"
  helm_cmd repo add "$JUICEFS_REPO_NAME" "$JUICEFS_REPO_URL" --force-update
  helm_cmd repo update "$JUICEFS_REPO_NAME"

  local helm_values_path="$JUICEFS_HELM_VALUES"
  if [[ "$helm_values_path" != /* ]]; then
    helm_values_path="$SCRIPT_DIR/$helm_values_path"
  fi

  local args=(
    upgrade --install "$JUICEFS_RELEASE" "$JUICEFS_CHART_REF"
    --namespace kube-system
    --create-namespace
    --wait
    --timeout "$JUICEFS_WAIT_TIMEOUT"
  )

  if [[ -f "$helm_values_path" ]]; then
    args+=(--values "$helm_values_path")
  else
    warn "找不到 JuiceFS Helm values 文件，跳过: $helm_values_path"
  fi

  if [[ -n "$JUICEFS_CHART_VERSION" ]]; then
    args+=(--version "$JUICEFS_CHART_VERSION")
  fi

  log "安装或升级 JuiceFS CSI Driver"
  helm_cmd "${args[@]}"
}

apply_namespace() {
  local namespace="$1"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN kubectl create namespace $namespace --dry-run=client -o yaml | kubectl apply -f -"
    return 0
  fi

  KUBECONFIG="$KUBECONFIG_PATH" kubectl create namespace "$namespace" --dry-run=client -o yaml | \
    KUBECONFIG="$KUBECONFIG_PATH" kubectl apply -f -
}

apply_juicefs_secret() {
  log "创建或更新 JuiceFS Secret: ${JUICEFS_SECRET_NAMESPACE}/${JUICEFS_SECRET_NAME}"
  apply_namespace "$JUICEFS_SECRET_NAMESPACE"
  render_juicefs_secret | apply_yaml "JuiceFS Secret $JUICEFS_SECRET_NAME"
}

apply_storageclass() {
  log "创建或更新 JuiceFS StorageClass: ${JUICEFS_STORAGECLASS_NAME}"
  render_storageclass | apply_yaml "JuiceFS StorageClass $JUICEFS_STORAGECLASS_NAME"
}

install_juicefs() {
  apply_metadata_redis
  install_juicefs_driver
  apply_juicefs_secret
  apply_storageclass
}

apply_training_pvc() {
  if ! is_true "$CREATE_TRAINING_PVC"; then
    warn "CREATE_TRAINING_PVC=0，跳过训练平台 PVC。"
    return 0
  fi

  log "创建或更新训练平台共享 PVC: ${TRAINING_NAMESPACE}/${TRAINING_PVC_NAME}"
  apply_namespace "$TRAINING_NAMESPACE"
  render_training_pvc | apply_yaml "training PVC $TRAINING_PVC_NAME"
}

status() {
  log "SeaweedFS Helm release"
  helm_cmd status "$SEAWEEDFS_RELEASE" --namespace "$STORAGE_NAMESPACE" || true
  echo

  log "SeaweedFS pods"
  kubectl_cmd -n "$STORAGE_NAMESPACE" get pods -l app.kubernetes.io/instance="$SEAWEEDFS_RELEASE" -o wide || true
  echo

  log "SeaweedFS services"
  kubectl_cmd -n "$STORAGE_NAMESPACE" get svc -l app.kubernetes.io/instance="$SEAWEEDFS_RELEASE" -o wide || true
  echo

  log "JuiceFS metadata Redis"
  kubectl_cmd -n "$STORAGE_NAMESPACE" get deployment,svc,pods -l app.kubernetes.io/component=juicefs-metadata -o wide || true
  echo

  log "JuiceFS Helm release"
  helm_cmd status "$JUICEFS_RELEASE" --namespace kube-system || true
  echo

  log "JuiceFS CSI Pods"
  kubectl_cmd -n kube-system get pods -l app.kubernetes.io/name=juicefs-csi-driver -o wide || true
  echo

  log "JuiceFS StorageClass"
  kubectl_cmd get storageclass "$JUICEFS_STORAGECLASS_NAME" -o wide || true
  echo

  log "Training PVC"
  kubectl_cmd -n "$TRAINING_NAMESPACE" get pvc "$TRAINING_PVC_NAME" -o wide || true
}

uninstall() {
  log "卸载 JuiceFS CSI Driver Helm release"
  helm_cmd uninstall "$JUICEFS_RELEASE" --namespace kube-system || true

  log "卸载 SeaweedFS Helm release"
  helm_cmd uninstall "$SEAWEEDFS_RELEASE" --namespace "$STORAGE_NAMESPACE" || true

  cat <<EOF

注意：
- uninstall 不会删除 JuiceFS Secret、StorageClass、PVC。
- uninstall 不会删除节点上的 hostPath 数据。
- SeaweedFS 数据目录: ${SEAWEEDFS_DATA_ROOT}
- JuiceFS metadata Redis 数据目录: ${JUICEFS_METADATA_REDIS_ROOT}
EOF
}

main() {
  parse_args "$@"
  load_env_file
  set_defaults
  validate_inputs

  case "$ACTION" in
    render-seaweedfs-values)
      render_seaweedfs_values
      return 0
      ;;
    render-juicefs-secret)
      render_juicefs_secret
      return 0
      ;;
    render-storageclass)
      render_storageclass
      return 0
      ;;
    render-training-pvc)
      render_training_pvc
      return 0
      ;;
  esac

  if [[ "$DRY_RUN" -eq 0 ]]; then
    require_cmd kubectl
    require_cmd helm
  fi
  resolve_kubeconfig

  case "$ACTION" in
    install)
      connectivity_check
      install_seaweedfs
      install_juicefs
      apply_training_pvc
      status
      ;;
    seaweedfs)
      connectivity_check
      install_seaweedfs
      ;;
    juicefs)
      connectivity_check
      install_juicefs
      ;;
    pvc)
      connectivity_check
      apply_training_pvc
      ;;
    status)
      status
      ;;
    uninstall)
      uninstall
      ;;
    *)
      die "未知动作: $ACTION"
      ;;
  esac
}

main "$@"
