#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_K8S_DIR="$REPO_ROOT/infra/k8s"
WORKSPACE_RUNTIME_DIR="$REPO_ROOT/runtime/workspace"
WORKSPACE_MANIFEST_DIR="$WORKSPACE_RUNTIME_DIR/manifests"
WORKSPACE_IMAGE_PATH="$WORKSPACE_RUNTIME_DIR/latest-image.txt"
WORKSPACE_IMAGE_CONTEXT_DIR="$REPO_ROOT/workloads/remote-workspace"
WORKSPACE_CLUSTER_QUERY_SCRIPT="$INFRA_K8S_DIR/bin/query-cluster.mjs"
WORKSPACE_NAMESPACE_MANIFEST="$INFRA_K8S_DIR/manifests/base/namespace.yaml"
KUBEASZ_BASE_DIR="/etc/kubeasz"

readonly SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o LogLevel=ERROR
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=8
  -o TCPKeepAlive=yes
)

die() {
  echo "ERROR: $*" >&2
  exit 1
}

print_step() {
  echo
  echo "==> $*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

invoking_user_name() {
  if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
    printf '%s\n' "$SUDO_USER"
    return 0
  fi

  id -un
}

discover_local_sudo_password() {
  local user_name
  user_name="$(invoking_user_name)"

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$INFRA_K8S_DIR/cluster/config.json" "$INFRA_K8S_DIR/cluster/nodes.json" "$user_name" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
nodes_path = Path(sys.argv[2])
user_name = sys.argv[3]

if not config_path.exists() or not nodes_path.exists():
    raise SystemExit(0)

config = json.loads(config_path.read_text())
nodes = json.loads(nodes_path.read_text())
controller_ip = config.get("controllerIp")
matches = [node for node in nodes if node.get("sshUser") == user_name]

if controller_ip:
    for node in matches:
        password = node.get("sshPassword")
        if node.get("ip") == controller_ip and isinstance(password, str):
            print(password)
            raise SystemExit(0)

if len(matches) == 1:
    password = matches[0].get("sshPassword")
    if isinstance(password, str):
        print(password)
PY
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    node --input-type=module - "$INFRA_K8S_DIR/cluster/config.json" "$INFRA_K8S_DIR/cluster/nodes.json" "$user_name" <<'EOF'
import fs from "node:fs";

const [configPath, nodesPath, userName] = process.argv.slice(2);
if (!fs.existsSync(configPath) || !fs.existsSync(nodesPath)) {
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const nodes = JSON.parse(fs.readFileSync(nodesPath, "utf8"));
const matches = nodes.filter((node) => node?.sshUser === userName);

if (config?.controllerIp) {
  const controllerNode = matches.find((node) => node?.ip === config.controllerIp);
  if (typeof controllerNode?.sshPassword === "string") {
    process.stdout.write(controllerNode.sshPassword);
    process.exit(0);
  }
}

if (matches.length === 1 && typeof matches[0]?.sshPassword === "string") {
  process.stdout.write(matches[0].sshPassword);
}
EOF
  fi
}

sudo_password_for_noninteractive() {
  if [[ -n "${REMOTE_WORK_SUDO_PASSWORD:-}" ]]; then
    printf '%s\n' "$REMOTE_WORK_SUDO_PASSWORD"
    return 0
  fi

  discover_local_sudo_password
}

sudo() {
  if [[ $# -gt 0 ]]; then
    case "$1" in
      -A|-n|-S|-V|-h|-K|-k|-l|-v|--help|--version|--remove-timestamp|--reset-timestamp|--validate)
        command sudo "$@"
        return
        ;;
    esac
  fi

  if command sudo -n true >/dev/null 2>&1; then
    command sudo "$@"
    return
  fi

  local sudo_password
  sudo_password="$(sudo_password_for_noninteractive)"
  [[ -n "$sudo_password" ]] || \
    die "当前命令需要 sudo，但当前环境无法交互输入密码。请设置 REMOTE_WORK_SUDO_PASSWORD 后重试。"

  REMOTE_WORK_SUDO_PASSWORD="$sudo_password" \
    SUDO_ASKPASS="$INFRA_K8S_DIR/bin/internal/sudo-askpass.sh" \
    command sudo -A "$@"
}

ensure_workspace_runtime_dirs() {
  mkdir -p "$WORKSPACE_RUNTIME_DIR" "$WORKSPACE_MANIFEST_DIR"
}

cluster_query() {
  node "$WORKSPACE_CLUSTER_QUERY_SCRIPT" "$@"
}

cluster_name() {
  cluster_query clusterName
}

workspace_namespace() {
  cluster_query workspaceNamespace
}

workspace_label_key() {
  cluster_query workspaceLabelKey
}

gpu_label_key() {
  cluster_query gpuLabelKey
}

first_master_name() {
  cluster_query firstMasterName
}

node_ip() {
  cluster_query nodeIp "$1"
}

node_user() {
  cluster_query nodeUser "$1"
}

node_password() {
  cluster_query nodePassword "$1"
}

node_port() {
  cluster_query nodePort "$1"
}

cluster_kubeconfig_path() {
  if [[ -n "${REMOTE_WORK_KUBECONFIG_PATH:-}" ]]; then
    printf '%s\n' "$REMOTE_WORK_KUBECONFIG_PATH"
    return 0
  fi

  if [[ -n "${WORKSPACE_KUBECONFIG:-}" ]]; then
    printf '%s\n' "$WORKSPACE_KUBECONFIG"
    return 0
  fi

  printf '%s\n' "$KUBEASZ_BASE_DIR/clusters/$(cluster_name)/kubectl.kubeconfig"
}

kubectl_bin_path() {
  if sudo test -x "$KUBEASZ_BASE_DIR/bin/kubectl"; then
    printf '%s\n' "$KUBEASZ_BASE_DIR/bin/kubectl"
    return 0
  fi

  command -v kubectl >/dev/null 2>&1 || \
    die "缺少 kubectl，且 /etc/kubeasz/bin/kubectl 不存在。"
  command -v kubectl
}

run_cluster_kubectl() {
  local kubeconfig
  local kubectl_bin
  kubeconfig="$(cluster_kubeconfig_path)"
  kubectl_bin="$(kubectl_bin_path)"
  sudo env KUBECONFIG="$kubeconfig" "$kubectl_bin" "$@"
}

json_read_props() {
  local json_input="$1"
  shift

  [[ $# -gt 0 ]] || return 0

  printf '%s' "$json_input" | node --input-type=module -e '
    let source = "";
    process.stdin.on("data", (chunk) => {
      source += chunk;
    });
    process.stdin.on("end", () => {
      const data = JSON.parse(source);
      for (const key of process.argv.slice(1)) {
        const value = data[key];
        if (value === true) {
          console.log("1");
        } else if (value === false || value == null) {
          console.log("");
        } else if (typeof value === "object") {
          console.log(JSON.stringify(value));
        } else {
          console.log(String(value));
        }
      }
    });
  ' "$@"
}

remote_scp() {
  local source_path="$1"
  local node_name="$2"
  local target_path="$3"
  local attempt

  for attempt in 1 2 3; do
    if sshpass -p "$(node_password "$node_name")" \
      scp "${SSH_OPTS[@]}" \
      -P "$(node_port "$node_name")" \
      "$source_path" \
      "$(node_user "$node_name")@$(node_ip "$node_name"):$target_path"; then
      return 0
    fi

    if [[ "$attempt" -lt 3 ]]; then
      echo "WARN: scp 到节点 $node_name 失败，准备第 $((attempt + 1)) 次重试。"
      sleep 2
    fi
  done

  die "向节点 $node_name 传输文件失败: $source_path -> $target_path"
}

remote_sudo_ssh() {
  local node_name="$1"
  shift

  sshpass -p "$(node_password "$node_name")" \
    ssh "${SSH_OPTS[@]}" \
    -p "$(node_port "$node_name")" \
    "$(node_user "$node_name")@$(node_ip "$node_name")" \
    "printf '%s\n' $(printf '%q' "$(node_password "$node_name")") | sudo -S -p '' bash -lc $(printf '%q' "$*")"
}

kubectl_remote() {
  local master
  master="$(first_master_name)"
  remote_sudo_ssh "$master" "/opt/kube/bin/kubectl --kubeconfig /root/.kube/config $*"
}

kubectl_apply_file() {
  local local_file="$1"
  local remote_file="/tmp/$(basename "$local_file").$$"
  local master

  master="$(first_master_name)"
  remote_scp "$local_file" "$master" "$remote_file"
  remote_sudo_ssh "$master" "/opt/kube/bin/kubectl --kubeconfig /root/.kube/config apply -f $remote_file && rm -f $remote_file"
}
