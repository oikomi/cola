#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
K8S_DIR="$INFRA_DIR/k8s"
CLUSTER_CONFIG="$K8S_DIR/cluster/config.json"
DEFAULT_ENV_FILE="$SCRIPT_DIR/seaweedfs.env"
KUBEASZ_BASE_DIR="${KUBEASZ_BASE_DIR:-/etc/kubeasz}"

ACTION="install"
ENV_FILE=""
DRY_RUN=0
KUBECONFIG_PATH="${KUBECONFIG:-}"
KUBECTL_BIN=""
HELM_BIN=""

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [install|status|smoke-test|render-values|render-s3-service|render-admin-service|render-bucket-job|render-smoke-test|uninstall] [options]

Deploy SeaweedFS as a lightweight distributed S3-compatible object store.

Actions:
  install                 Install/upgrade SeaweedFS; default action
  status                  Show Helm release and Kubernetes resources
  smoke-test              Run an in-cluster S3 upload/download smoke test
  render-values           Print generated SeaweedFS Helm values
  render-s3-service       Print the SeaweedFS S3 LAN NodePort Service YAML
  render-admin-service    Print the SeaweedFS Admin UI NodePort Service YAML
  render-bucket-job       Print bucket initialization Job YAML
  render-smoke-test       Print the S3 smoke test Job YAML
  uninstall               Remove the Helm release and helper Services/Jobs

Options:
  --env-file <path>       Load SeaweedFS settings from a local env file
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
      install | status | smoke-test | render-values | render-s3-service | render-admin-service | render-bucket-job | render-smoke-test | uninstall)
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
  SEAWEEDFS_NAMESPACE="${SEAWEEDFS_NAMESPACE:-storage}"
  SEAWEEDFS_RELEASE="${SEAWEEDFS_RELEASE:-seaweedfs}"
  SEAWEEDFS_HELM_REPO_NAME="${SEAWEEDFS_HELM_REPO_NAME:-seaweedfs}"
  SEAWEEDFS_HELM_REPO_URL="${SEAWEEDFS_HELM_REPO_URL:-https://seaweedfs.github.io/seaweedfs/helm}"
  SEAWEEDFS_CHART="${SEAWEEDFS_CHART:-${SEAWEEDFS_HELM_REPO_NAME}/seaweedfs}"
  SEAWEEDFS_CHART_VERSION="${SEAWEEDFS_CHART_VERSION:-}"
  SEAWEEDFS_WAIT_TIMEOUT="${SEAWEEDFS_WAIT_TIMEOUT:-600s}"

  SEAWEEDFS_DATA_ROOT="${SEAWEEDFS_DATA_ROOT:-/var/lib/cola/seaweedfs}"
  SEAWEEDFS_VOLUME_NODES="${SEAWEEDFS_VOLUME_NODES:-[]}"
  SEAWEEDFS_REPLICATION="${SEAWEEDFS_REPLICATION:-001}"
  SEAWEEDFS_MASTER_REPLICAS="${SEAWEEDFS_MASTER_REPLICAS:-1}"
  SEAWEEDFS_FILER_REPLICAS="${SEAWEEDFS_FILER_REPLICAS:-1}"
  SEAWEEDFS_S3_REPLICAS="${SEAWEEDFS_S3_REPLICAS:-1}"
  SEAWEEDFS_VOLUME_MAX="${SEAWEEDFS_VOLUME_MAX:-100}"

  SEAWEEDFS_S3_ENABLED="${SEAWEEDFS_S3_ENABLED:-true}"
  SEAWEEDFS_S3_SERVICE_NAME="${SEAWEEDFS_S3_SERVICE_NAME:-seaweedfs-s3}"
  SEAWEEDFS_S3_PORT="${SEAWEEDFS_S3_PORT:-8333}"
  SEAWEEDFS_S3_NODEPORT_ENABLED="${SEAWEEDFS_S3_NODEPORT_ENABLED:-true}"
  SEAWEEDFS_S3_NODEPORT_SERVICE_NAME="${SEAWEEDFS_S3_NODEPORT_SERVICE_NAME:-seaweedfs-s3-nodeport}"
  SEAWEEDFS_S3_NODE_PORT="${SEAWEEDFS_S3_NODE_PORT:-32247}"
  SEAWEEDFS_S3_BUCKET="${SEAWEEDFS_S3_BUCKET:-cola-training}"
  SEAWEEDFS_S3_ACCESS_KEY="${SEAWEEDFS_S3_ACCESS_KEY:-seaweedfs}"
  SEAWEEDFS_S3_SECRET_KEY="${SEAWEEDFS_S3_SECRET_KEY:-seaweedfs-secret}"
  SEAWEEDFS_ADMIN_ENABLED="${SEAWEEDFS_ADMIN_ENABLED:-true}"
  SEAWEEDFS_ADMIN_SERVICE_NAME="${SEAWEEDFS_ADMIN_SERVICE_NAME:-seaweedfs-admin-ui}"
  SEAWEEDFS_ADMIN_USER="${SEAWEEDFS_ADMIN_USER:-admin}"
  SEAWEEDFS_ADMIN_PASSWORD="${SEAWEEDFS_ADMIN_PASSWORD:-change-me-before-deploy}"
  SEAWEEDFS_ADMIN_NODE_PORT="${SEAWEEDFS_ADMIN_NODE_PORT:-32246}"
  SEAWEEDFS_ADMIN_TARGET_PORT="${SEAWEEDFS_ADMIN_TARGET_PORT:-23646}"
  SEAWEEDFS_ADMIN_GRPC_PORT="${SEAWEEDFS_ADMIN_GRPC_PORT:-33646}"
  SEAWEEDFS_CREATE_BUCKET_JOB="${SEAWEEDFS_CREATE_BUCKET_JOB:-1}"
  SEAWEEDFS_BUCKET_JOB_IMAGE="${SEAWEEDFS_BUCKET_JOB_IMAGE:-amazon/aws-cli:2.17.50}"
  SEAWEEDFS_SMOKE_TEST_JOB="${SEAWEEDFS_SMOKE_TEST_JOB:-${SEAWEEDFS_RELEASE}-s3-smoke-test}"
  SEAWEEDFS_SMOKE_TEST_IMAGE="${SEAWEEDFS_SMOKE_TEST_IMAGE:-amazon/aws-cli:2.17.50}"
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
  [[ -n "$SEAWEEDFS_NAMESPACE" ]] || die "SEAWEEDFS_NAMESPACE 不能为空"
  [[ -n "$SEAWEEDFS_RELEASE" ]] || die "SEAWEEDFS_RELEASE 不能为空"
  [[ -n "$SEAWEEDFS_S3_BUCKET" ]] || die "SEAWEEDFS_S3_BUCKET 不能为空"
  [[ -n "$SEAWEEDFS_S3_ACCESS_KEY" ]] || die "SEAWEEDFS_S3_ACCESS_KEY 不能为空"
  [[ -n "$SEAWEEDFS_S3_SECRET_KEY" ]] || die "SEAWEEDFS_S3_SECRET_KEY 不能为空"

  if [[ "$SEAWEEDFS_S3_ACCESS_KEY" == "seaweedfs" && "$SEAWEEDFS_S3_SECRET_KEY" == "seaweedfs-secret" ]]; then
    warn "SEAWEEDFS_S3_ACCESS_KEY / SEAWEEDFS_S3_SECRET_KEY 仍是示例值。正式部署前必须修改。"
  fi

  if ! [[ "$SEAWEEDFS_S3_PORT" =~ ^[0-9]+$ ]] || [[ "$SEAWEEDFS_S3_PORT" -lt 1 ]] || [[ "$SEAWEEDFS_S3_PORT" -gt 65535 ]]; then
    die "SEAWEEDFS_S3_PORT 必须是 1-65535 之间的整数"
  fi

  if is_true "$SEAWEEDFS_S3_NODEPORT_ENABLED"; then
    [[ -n "$SEAWEEDFS_S3_NODEPORT_SERVICE_NAME" ]] || die "SEAWEEDFS_S3_NODEPORT_SERVICE_NAME 不能为空"

    if ! [[ "$SEAWEEDFS_S3_NODE_PORT" =~ ^[0-9]+$ ]] || [[ "$SEAWEEDFS_S3_NODE_PORT" -lt 30000 ]] || [[ "$SEAWEEDFS_S3_NODE_PORT" -gt 32767 ]]; then
      die "SEAWEEDFS_S3_NODE_PORT 必须是 30000-32767 之间的整数"
    fi
  fi

  validate_json_nodes

  local node_count
  node_count="$(json_array_length "$SEAWEEDFS_VOLUME_NODES")"
  if [[ "$node_count" -eq 0 ]]; then
    die "SEAWEEDFS_VOLUME_NODES 不能为空。至少配置一个 volume 节点。"
  fi

  if [[ "$node_count" -lt 3 ]]; then
    warn "当前只有 ${node_count} 个 SeaweedFS volume 节点。可以测试，但不是生产级分布式存储。"
  fi

  if is_true "$SEAWEEDFS_ADMIN_ENABLED"; then
    [[ -n "$SEAWEEDFS_ADMIN_SERVICE_NAME" ]] || die "SEAWEEDFS_ADMIN_SERVICE_NAME 不能为空"
    [[ -n "$SEAWEEDFS_ADMIN_USER" ]] || die "SEAWEEDFS_ADMIN_USER 不能为空"
    [[ -n "$SEAWEEDFS_ADMIN_PASSWORD" ]] || die "SEAWEEDFS_ADMIN_PASSWORD 不能为空；为空会关闭 Admin UI 认证"

    if [[ "$SEAWEEDFS_ADMIN_PASSWORD" == "change-me-before-deploy" || "$SEAWEEDFS_ADMIN_PASSWORD" == "123456" ]]; then
      warn "SEAWEEDFS_ADMIN_PASSWORD 仍是示例值。正式部署前必须修改。"
    fi

    if ! [[ "$SEAWEEDFS_ADMIN_NODE_PORT" =~ ^[0-9]+$ ]] || [[ "$SEAWEEDFS_ADMIN_NODE_PORT" -lt 30000 ]] || [[ "$SEAWEEDFS_ADMIN_NODE_PORT" -gt 32767 ]]; then
      die "SEAWEEDFS_ADMIN_NODE_PORT 必须是 30000-32767 之间的整数"
    fi

    if ! [[ "$SEAWEEDFS_ADMIN_TARGET_PORT" =~ ^[0-9]+$ ]] || [[ "$SEAWEEDFS_ADMIN_TARGET_PORT" -lt 1 ]] || [[ "$SEAWEEDFS_ADMIN_TARGET_PORT" -gt 65535 ]]; then
      die "SEAWEEDFS_ADMIN_TARGET_PORT 必须是 1-65535 之间的整数"
    fi

    if ! [[ "$SEAWEEDFS_ADMIN_GRPC_PORT" =~ ^[0-9]+$ ]] || [[ "$SEAWEEDFS_ADMIN_GRPC_PORT" -lt 1 ]] || [[ "$SEAWEEDFS_ADMIN_GRPC_PORT" -gt 65535 ]]; then
      die "SEAWEEDFS_ADMIN_GRPC_PORT 必须是 1-65535 之间的整数"
    fi
  fi
}

render_volume_affinity() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$SEAWEEDFS_VOLUME_NODES" <<'PY'
import json
import sys

nodes = json.loads(sys.argv[1])
for node in nodes:
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

render_volume_hostpaths() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$SEAWEEDFS_VOLUME_NODES" <<'PY'
import json
import sys

nodes = json.loads(sys.argv[1])
first = nodes[0]
print(first["path"])
PY
    return 0
  fi

  node --input-type=module - "$SEAWEEDFS_VOLUME_NODES" <<'EOF'
const nodes = JSON.parse(process.argv[2]);
process.stdout.write(nodes[0].path);
EOF
}

render_values() {
  local volume_path
  volume_path="$(render_volume_hostpaths)"

  cat <<YAML
seaweedfs:
  enableSecurity: true
  monitoring:
    enabled: false
  enableReplication: true
  replicationPlacement: "${SEAWEEDFS_REPLICATION}"

admin:
  enabled: $(if is_true "$SEAWEEDFS_ADMIN_ENABLED"; then echo true; else echo false; fi)
  port: ${SEAWEEDFS_ADMIN_TARGET_PORT}
  grpcPort: ${SEAWEEDFS_ADMIN_GRPC_PORT}
  adminUser: $(yaml_quote "$SEAWEEDFS_ADMIN_USER")
  adminPassword: $(yaml_quote "$SEAWEEDFS_ADMIN_PASSWORD")
  data:
    type: hostPath
    hostPathPrefix: ${SEAWEEDFS_DATA_ROOT%/}/admin
  logs:
    type: hostPath
    hostPathPrefix: ${SEAWEEDFS_DATA_ROOT%/}/admin-logs

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
$(render_volume_affinity)

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
  enabled: $(if is_true "$SEAWEEDFS_S3_ENABLED"; then echo true; else echo false; fi)
  replicas: ${SEAWEEDFS_S3_REPLICAS}
  port: ${SEAWEEDFS_S3_PORT}
  allowEmptyFolder: true
  enableAuth: true
  credentials:
    admin:
      accessKey: $(yaml_quote "$SEAWEEDFS_S3_ACCESS_KEY")
      secretKey: $(yaml_quote "$SEAWEEDFS_S3_SECRET_KEY")
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

render_admin_service() {
  cat <<YAML
apiVersion: v1
kind: Service
metadata:
  name: ${SEAWEEDFS_ADMIN_SERVICE_NAME}
  namespace: ${SEAWEEDFS_NAMESPACE}
  labels:
    app.kubernetes.io/name: seaweedfs-admin
    app.kubernetes.io/instance: ${SEAWEEDFS_RELEASE}
    app.kubernetes.io/part-of: seaweedfs
spec:
  type: NodePort
  selector:
    app.kubernetes.io/name: seaweedfs
    app.kubernetes.io/instance: ${SEAWEEDFS_RELEASE}
    app.kubernetes.io/component: admin
  ports:
    - name: http
      protocol: TCP
      port: ${SEAWEEDFS_ADMIN_TARGET_PORT}
      targetPort: ${SEAWEEDFS_ADMIN_TARGET_PORT}
      nodePort: ${SEAWEEDFS_ADMIN_NODE_PORT}
YAML
}

render_s3_service() {
  cat <<YAML
apiVersion: v1
kind: Service
metadata:
  name: ${SEAWEEDFS_S3_NODEPORT_SERVICE_NAME}
  namespace: ${SEAWEEDFS_NAMESPACE}
  labels:
    app.kubernetes.io/name: seaweedfs-s3
    app.kubernetes.io/instance: ${SEAWEEDFS_RELEASE}
    app.kubernetes.io/part-of: seaweedfs
spec:
  type: NodePort
  selector:
    app.kubernetes.io/name: seaweedfs
    app.kubernetes.io/instance: ${SEAWEEDFS_RELEASE}
    app.kubernetes.io/component: s3
  ports:
    - name: swfs-s3
      protocol: TCP
      port: ${SEAWEEDFS_S3_PORT}
      targetPort: ${SEAWEEDFS_S3_PORT}
      nodePort: ${SEAWEEDFS_S3_NODE_PORT}
YAML
}

render_bucket_job() {
  cat <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: ${SEAWEEDFS_RELEASE}-bucket-init
  namespace: ${SEAWEEDFS_NAMESPACE}
  labels:
    app.kubernetes.io/name: seaweedfs-bucket-init
    app.kubernetes.io/part-of: seaweedfs
spec:
  backoffLimit: 10
  template:
    metadata:
      labels:
        app.kubernetes.io/name: seaweedfs-bucket-init
        app.kubernetes.io/part-of: seaweedfs
    spec:
      restartPolicy: OnFailure
      containers:
        - name: create-bucket
          image: ${SEAWEEDFS_BUCKET_JOB_IMAGE}
          imagePullPolicy: IfNotPresent
          env:
            - name: AWS_ACCESS_KEY_ID
              value: $(yaml_quote "$SEAWEEDFS_S3_ACCESS_KEY")
            - name: AWS_SECRET_ACCESS_KEY
              value: $(yaml_quote "$SEAWEEDFS_S3_SECRET_KEY")
            - name: AWS_DEFAULT_REGION
              value: us-east-1
          command: ["/bin/sh", "-lc"]
          args:
            - |
              until aws --endpoint-url "http://${SEAWEEDFS_S3_SERVICE_NAME}.${SEAWEEDFS_NAMESPACE}.svc.cluster.local:${SEAWEEDFS_S3_PORT}" s3 ls >/dev/null 2>&1; do
                sleep 2
              done
              aws --endpoint-url "http://${SEAWEEDFS_S3_SERVICE_NAME}.${SEAWEEDFS_NAMESPACE}.svc.cluster.local:${SEAWEEDFS_S3_PORT}" s3 mb "s3://${SEAWEEDFS_S3_BUCKET}" || true
YAML
}

render_smoke_test_job() {
  cat <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: ${SEAWEEDFS_SMOKE_TEST_JOB}
  namespace: ${SEAWEEDFS_NAMESPACE}
  labels:
    app.kubernetes.io/name: seaweedfs-s3-smoke-test
    app.kubernetes.io/part-of: seaweedfs
spec:
  backoffLimit: 2
  template:
    metadata:
      labels:
        app.kubernetes.io/name: seaweedfs-s3-smoke-test
        app.kubernetes.io/part-of: seaweedfs
    spec:
      restartPolicy: Never
      containers:
        - name: smoke-test
          image: ${SEAWEEDFS_SMOKE_TEST_IMAGE}
          imagePullPolicy: IfNotPresent
          env:
            - name: AWS_ACCESS_KEY_ID
              value: $(yaml_quote "$SEAWEEDFS_S3_ACCESS_KEY")
            - name: AWS_SECRET_ACCESS_KEY
              value: $(yaml_quote "$SEAWEEDFS_S3_SECRET_KEY")
            - name: AWS_DEFAULT_REGION
              value: us-east-1
          command: ["/bin/sh", "-lc"]
          args:
            - |
              set -eu
              endpoint="http://${SEAWEEDFS_S3_SERVICE_NAME}.${SEAWEEDFS_NAMESPACE}.svc.cluster.local:${SEAWEEDFS_S3_PORT}"
              bucket="${SEAWEEDFS_S3_BUCKET}"
              echo "endpoint=\${endpoint}"
              echo "bucket=\${bucket}"
              aws --endpoint-url "\${endpoint}" s3 ls "s3://\${bucket}" >/dev/null
              echo "cola seaweedfs smoke test" > /tmp/seaweedfs-smoke.txt
              aws --endpoint-url "\${endpoint}" s3 cp /tmp/seaweedfs-smoke.txt "s3://\${bucket}/_smoke/seaweedfs-smoke.txt"
              aws --endpoint-url "\${endpoint}" s3 cp "s3://\${bucket}/_smoke/seaweedfs-smoke.txt" /tmp/seaweedfs-smoke.downloaded.txt
              cmp /tmp/seaweedfs-smoke.txt /tmp/seaweedfs-smoke.downloaded.txt
              aws --endpoint-url "\${endpoint}" s3 ls "s3://\${bucket}/_smoke/"
YAML
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
  log "添加 Helm 仓库"
  helm_cmd repo add "$SEAWEEDFS_HELM_REPO_NAME" "$SEAWEEDFS_HELM_REPO_URL" --force-update
  helm_cmd repo update "$SEAWEEDFS_HELM_REPO_NAME"

  log "安装或升级 SeaweedFS"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry-run: render SeaweedFS Helm values"
    render_values
    helm_cmd upgrade --install "$SEAWEEDFS_RELEASE" "$SEAWEEDFS_CHART" \
      --namespace "$SEAWEEDFS_NAMESPACE" \
      --create-namespace \
      --wait \
      --timeout "$SEAWEEDFS_WAIT_TIMEOUT" \
      --values -
    return 0
  fi

  local values_file
  values_file="$(mktemp)"
  render_values >"$values_file"
  trap 'rm -f "$values_file"' RETURN

  local args=(
    upgrade --install "$SEAWEEDFS_RELEASE" "$SEAWEEDFS_CHART"
    --namespace "$SEAWEEDFS_NAMESPACE"
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

apply_bucket_job() {
  if ! is_true "$SEAWEEDFS_CREATE_BUCKET_JOB"; then
    return 0
  fi

  log "创建或更新 SeaweedFS S3 bucket 初始化 Job: ${SEAWEEDFS_S3_BUCKET}"
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" delete job "${SEAWEEDFS_RELEASE}-bucket-init" --ignore-not-found
  render_bucket_job | apply_yaml "SeaweedFS bucket init Job"
}

apply_admin_service() {
  if ! is_true "$SEAWEEDFS_ADMIN_ENABLED"; then
    return 0
  fi

  log "创建或更新 SeaweedFS Admin UI NodePort Service: ${SEAWEEDFS_ADMIN_SERVICE_NAME}:${SEAWEEDFS_ADMIN_NODE_PORT}"
  render_admin_service | apply_yaml "SeaweedFS Admin UI NodePort Service"
}

apply_s3_service() {
  if ! is_true "$SEAWEEDFS_S3_NODEPORT_ENABLED"; then
    return 0
  fi

  log "创建或更新 SeaweedFS S3 LAN NodePort Service: ${SEAWEEDFS_S3_NODEPORT_SERVICE_NAME}:${SEAWEEDFS_S3_NODE_PORT}"
  render_s3_service | apply_yaml "SeaweedFS S3 LAN NodePort Service"
}

wait_for_bucket_job() {
  if ! is_true "$SEAWEEDFS_CREATE_BUCKET_JOB"; then
    return 0
  fi

  log "等待 bucket 初始化 Job 完成"
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" wait --for=condition=complete "job/${SEAWEEDFS_RELEASE}-bucket-init" --timeout="$SEAWEEDFS_WAIT_TIMEOUT"
}

run_smoke_test() {
  log "运行 SeaweedFS S3 smoke test: ${SEAWEEDFS_SMOKE_TEST_JOB}"
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" delete job "$SEAWEEDFS_SMOKE_TEST_JOB" --ignore-not-found
  render_smoke_test_job | apply_yaml "SeaweedFS S3 smoke test Job"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" wait --for=condition=complete "job/${SEAWEEDFS_SMOKE_TEST_JOB}" --timeout="$SEAWEEDFS_WAIT_TIMEOUT"
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" logs "job/${SEAWEEDFS_SMOKE_TEST_JOB}"
}

status() {
  log "SeaweedFS Helm release"
  helm_cmd status "$SEAWEEDFS_RELEASE" --namespace "$SEAWEEDFS_NAMESPACE" || true
  echo

  log "SeaweedFS pods"
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" get pods -l app.kubernetes.io/instance="$SEAWEEDFS_RELEASE" -o wide || true
  echo

  log "SeaweedFS services"
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" get svc -l app.kubernetes.io/instance="$SEAWEEDFS_RELEASE" -o wide || true
  echo

  log "SeaweedFS Admin UI"
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" get svc "$SEAWEEDFS_ADMIN_SERVICE_NAME" -o wide || true
  echo

  log "SeaweedFS S3 LAN NodePort"
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" get svc "$SEAWEEDFS_S3_NODEPORT_SERVICE_NAME" -o wide || true
  echo

  log "Bucket init job"
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" get job "${SEAWEEDFS_RELEASE}-bucket-init" -o wide || true
  echo

  log "S3 endpoint"
  local controller_ip
  controller_ip="$(json_field controllerIp)"
  cat <<EOF
Internal endpoint: http://${SEAWEEDFS_S3_SERVICE_NAME}.${SEAWEEDFS_NAMESPACE}.svc.cluster.local:${SEAWEEDFS_S3_PORT}
LAN endpoint: $(if is_true "$SEAWEEDFS_S3_NODEPORT_ENABLED"; then echo "http://${controller_ip}:${SEAWEEDFS_S3_NODE_PORT}"; else echo "disabled"; fi)
Bucket: ${SEAWEEDFS_S3_BUCKET}
AWS_ACCESS_KEY_ID: ${SEAWEEDFS_S3_ACCESS_KEY}
AWS_SECRET_ACCESS_KEY: <redacted>
Admin UI: http://${controller_ip}:${SEAWEEDFS_ADMIN_NODE_PORT}
Admin UI user: ${SEAWEEDFS_ADMIN_USER}
EOF
}

uninstall() {
  log "卸载 SeaweedFS Helm release: ${SEAWEEDFS_NAMESPACE}/${SEAWEEDFS_RELEASE}"
  helm_cmd uninstall "$SEAWEEDFS_RELEASE" --namespace "$SEAWEEDFS_NAMESPACE" || true
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" delete svc "$SEAWEEDFS_ADMIN_SERVICE_NAME" "$SEAWEEDFS_S3_NODEPORT_SERVICE_NAME" --ignore-not-found || true
  kubectl_cmd -n "$SEAWEEDFS_NAMESPACE" delete job "${SEAWEEDFS_RELEASE}-bucket-init" "$SEAWEEDFS_SMOKE_TEST_JOB" --ignore-not-found || true

  cat <<EOF

注意：
- uninstall 不会删除节点上的 hostPath 数据目录。
- 当前数据目录根路径: ${SEAWEEDFS_DATA_ROOT}
- 删除这些目录前请确认训练数据、模型文件和对象存储数据不再需要。
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
    render-s3-service)
      render_s3_service
      return 0
      ;;
    render-admin-service)
      render_admin_service
      return 0
      ;;
    render-bucket-job)
      render_bucket_job
      return 0
      ;;
    render-smoke-test)
      render_smoke_test_job
      return 0
      ;;
  esac

  resolve_kubeconfig
  resolve_cluster_bins

  case "$ACTION" in
    install)
      connectivity_check
      install_chart
      apply_s3_service
      apply_admin_service
      apply_bucket_job
      wait_for_bucket_job
      status
      ;;
    smoke-test)
      connectivity_check
      run_smoke_test
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
