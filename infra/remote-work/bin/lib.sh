#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/runtime"
GENERATED_DIR="$RUNTIME_DIR/generated"
WORKSPACE_DIR="$RUNTIME_DIR/workspaces"
KUBEASZ_DIR="$RUNTIME_DIR/kubeasz"
KUBEASZ_BASE_DIR="/etc/kubeasz"
QUERY_SCRIPT="$ROOT_DIR/bin/query-cluster.mjs"
RENDER_CLUSTER_SCRIPT="$ROOT_DIR/bin/render-cluster.mjs"

readonly SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o LogLevel=ERROR
)

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

require_any_cmd() {
  local found=1
  for cmd in "$@"; do
    if command -v "$cmd" >/dev/null 2>&1; then
      found=0
      break
    fi
  done
  [[ "$found" -eq 0 ]] || die "缺少命令，至少需要其一: $*"
}

cluster_query() {
  node "$QUERY_SCRIPT" "$@"
}

ensure_runtime_dirs() {
  mkdir -p "$GENERATED_DIR" "$WORKSPACE_DIR"
}

cluster_name() {
  cluster_query clusterName
}

kubernetes_version() {
  local version
  version="$(cluster_query kubernetesVersion)"
  if [[ "$version" == v* ]]; then
    printf '%s\n' "$version"
  else
    printf 'v%s\n' "$version"
  fi
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

node_roles() {
  cluster_query nodeRoles "$1"
}

node_has_role() {
  local node_name="$1"
  local target_role="$2"
  local roles
  roles="$(node_roles "$node_name")"
  [[ ",$roles," == *",$target_role,"* ]]
}

remote_ssh() {
  local node_name="$1"
  shift

  sshpass -p "$(node_password "$node_name")" \
    ssh "${SSH_OPTS[@]}" \
    -p "$(node_port "$node_name")" \
    "$(node_user "$node_name")@$(node_ip "$node_name")" \
    "$@"
}

remote_scp() {
  local source_path="$1"
  local node_name="$2"
  local target_path="$3"

  sshpass -p "$(node_password "$node_name")" \
    scp "${SSH_OPTS[@]}" \
    -P "$(node_port "$node_name")" \
    "$source_path" \
    "$(node_user "$node_name")@$(node_ip "$node_name"):$target_path"
}

kubectl_remote() {
  local master
  master="$(first_master_name)"
  remote_ssh "$master" "sudo KUBECONFIG=/etc/kubernetes/admin.conf kubectl $*"
}

kubectl_apply_file() {
  local local_file="$1"
  local remote_file="/tmp/$(basename "$local_file").$$"
  local master

  master="$(first_master_name)"
  remote_scp "$local_file" "$master" "$remote_file"
  remote_ssh "$master" "sudo KUBECONFIG=/etc/kubernetes/admin.conf kubectl apply -f $remote_file && rm -f $remote_file"
}

render_cluster_inventory() {
  ensure_runtime_dirs
  node "$RENDER_CLUSTER_SCRIPT"
}

copy_hosts_into_kubeasz() {
  local target_dir="$KUBEASZ_BASE_DIR/clusters/$(cluster_name)"
  sudo mkdir -p "$target_dir"
  sudo install -m 0644 "$GENERATED_DIR/hosts" "$target_dir/hosts"
}

print_step() {
  echo
  echo "==> $*"
}
