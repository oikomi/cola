#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/runtime"
GENERATED_DIR="$RUNTIME_DIR/generated"
WORKSPACE_DIR="$RUNTIME_DIR/workspaces"
KUBEASZ_DIR="$RUNTIME_DIR/kubeasz"
KUBEASZ_BASE_DIR="/etc/kubeasz"
ANSIBLE_VENV_DIR="$RUNTIME_DIR/ansible-venv"
ANSIBLE_BIN_DIR="$ANSIBLE_VENV_DIR/bin"
HELM_RUNTIME_DIR="$RUNTIME_DIR/helm"
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

normalize_arch_sh() {
  case "$1" in
    x86_64|amd64|x64)
      printf '%s\n' "amd64"
      ;;
    aarch64|arm64)
      printf '%s\n' "arm64"
      ;;
    *)
      printf '%s\n' "$1"
      ;;
  esac
}

install_python_venv_support() {
  require_cmd python3
  require_cmd sudo
  require_any_cmd apt-get dnf yum

  if command -v apt-get >/dev/null 2>&1; then
    local py_venv_pkg
    local py_minor_pkg
    py_minor_pkg="$(
      python3 - <<'PY'
import sys
print(f"python{sys.version_info.major}.{sys.version_info.minor}-venv")
PY
    )"
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv python3-pip || \
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "$py_minor_pkg" python3-pip
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y python3 python3-pip
  else
    sudo yum install -y python3 python3-pip
  fi
}

ensure_ansible_available() {
  require_cmd python3
  require_cmd sudo

  local need_install=1
  if [[ -x "$ANSIBLE_BIN_DIR/ansible-playbook" ]]; then
    if "$ANSIBLE_BIN_DIR/python" - <<'PY' >/dev/null 2>&1
from importlib import metadata
from packaging.version import Version
version = metadata.version("ansible-core")
raise SystemExit(0 if Version(version) >= Version("2.16.0") else 1)
PY
    then
      need_install=0
    fi
  fi

  if [[ "$need_install" -eq 0 ]]; then
    return 0
  fi

  print_step "准备独立的 Ansible 运行时"

  rm -rf "$ANSIBLE_VENV_DIR"

  if ! python3 -m venv "$ANSIBLE_VENV_DIR" >/dev/null 2>&1; then
    print_step "当前 Python 缺少 venv/ensurepip，开始补装依赖"
    install_python_venv_support
    rm -rf "$ANSIBLE_VENV_DIR"
    python3 -m venv "$ANSIBLE_VENV_DIR" || \
      die "创建虚拟环境失败，请先确认本机 Python 支持 venv 和 ensurepip。"
  fi

  "$ANSIBLE_BIN_DIR/pip" install --upgrade pip setuptools wheel
  "$ANSIBLE_BIN_DIR/pip" install "ansible>=9,<11" netaddr jmespath packaging

  [[ -x "$ANSIBLE_BIN_DIR/ansible-playbook" ]] || \
    die "独立 Ansible 运行时准备失败，未找到 $ANSIBLE_BIN_DIR/ansible-playbook"
}

ansible_env_path() {
  printf '%s\n' "$ANSIBLE_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
}

run_kubeasz_ezctl() {
  ensure_ansible_available
  patch_kubeasz_compatibility
  sudo env PATH="$(ansible_env_path)" "$KUBEASZ_DIR/ezctl" "$@"
}

run_ansible_ad_hoc() {
  ensure_ansible_available
  patch_kubeasz_compatibility
  sudo env PATH="$(ansible_env_path)" "$ANSIBLE_BIN_DIR/ansible" "$@"
}

patch_kubeasz_compatibility() {
  sudo python3 - <<'PY'
from pathlib import Path

task_file = Path("/etc/kubeasz/roles/prepare/tasks/main.yml")
if not task_file.exists():
    raise SystemExit(0)

text = task_file.read_text()
updated = text
updated = updated.replace(
    '      when: "inventory_hostname == ansible_env.SSH_CLIENT.split(\' \')[0]"',
    '      when: "local_registry_host is defined and local_registry_host != \'\' and inventory_hostname == local_registry_host"',
)
updated = updated.replace(
    '        line: "{{ ansible_env.SSH_CLIENT.split(\' \')[0] }}    easzlab.io.local"',
    '        line: "{{ local_registry_host }}    easzlab.io.local"',
)

if updated != text:
    task_file.write_text(updated)
PY
}

cluster_query() {
  node "$QUERY_SCRIPT" "$@"
}

ensure_runtime_dirs() {
  mkdir -p "$GENERATED_DIR" "$WORKSPACE_DIR"
}

cluster_kubeconfig_path() {
  printf '%s\n' "$KUBEASZ_BASE_DIR/clusters/$(cluster_name)/kubectl.kubeconfig"
}

kubectl_bin_path() {
  if sudo test -x "$KUBEASZ_BASE_DIR/bin/kubectl"; then
    printf '%s\n' "$KUBEASZ_BASE_DIR/bin/kubectl"
    return 0
  fi
  command -v kubectl >/dev/null 2>&1 || die "缺少 kubectl，且 /etc/kubeasz/bin/kubectl 不存在。"
  command -v kubectl
}

helm_bin_path() {
  if sudo test -x "$KUBEASZ_BASE_DIR/bin/helm"; then
    printf '%s\n' "$KUBEASZ_BASE_DIR/bin/helm"
    return 0
  fi
  command -v helm >/dev/null 2>&1 || die "缺少 helm，且 /etc/kubeasz/bin/helm 不存在。"
  command -v helm
}

ensure_helm_runtime_dirs() {
  mkdir -p "$HELM_RUNTIME_DIR/config" "$HELM_RUNTIME_DIR/cache" "$HELM_RUNTIME_DIR/data"
}

run_cluster_kubectl() {
  local kubeconfig
  local kubectl_bin
  kubeconfig="$(cluster_kubeconfig_path)"
  kubectl_bin="$(kubectl_bin_path)"
  sudo env KUBECONFIG="$kubeconfig" "$kubectl_bin" "$@"
}

run_cluster_helm() {
  local kubeconfig
  local helm_bin
  kubeconfig="$(cluster_kubeconfig_path)"
  helm_bin="$(helm_bin_path)"
  ensure_helm_runtime_dirs
  sudo env \
    KUBECONFIG="$kubeconfig" \
    HELM_CONFIG_HOME="$HELM_RUNTIME_DIR/config" \
    HELM_CACHE_HOME="$HELM_RUNTIME_DIR/cache" \
    HELM_DATA_HOME="$HELM_RUNTIME_DIR/data" \
    "$helm_bin" "$@"
}

cluster_name() {
  cluster_query clusterName
}

local_arch() {
  cluster_query localArch
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

kubeasz_bundled_kubernetes_version() {
  [[ -f "$KUBEASZ_DIR/ezdown" ]] || die "找不到 $KUBEASZ_DIR/ezdown，无法解析 kubeasz 自带 Kubernetes 版本"
  local version
  version="$(sed -n 's/^K8S_BIN_VER=//p' "$KUBEASZ_DIR/ezdown" | head -n 1)"
  [[ -n "$version" ]] || die "无法从 $KUBEASZ_DIR/ezdown 解析 K8S_BIN_VER"
  printf '%s\n' "$version"
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

node_arch() {
  cluster_query nodeArch "$1"
}

node_has_role() {
  local node_name="$1"
  local target_role="$2"
  local roles
  roles="$(node_roles "$node_name")"
  [[ ",$roles," == *",$target_role,"* ]]
}

probe_remote_node_arch() {
  local node_name="$1"
  local raw
  raw="$(remote_ssh "$node_name" "uname -m" | tr -d '\r' | tail -n 1)"
  [[ -n "$raw" ]] || die "无法探测节点 $node_name 的架构。"
  normalize_arch_sh "$raw"
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

remote_sudo_ssh() {
  local node_name="$1"
  shift

  sshpass -p "$(node_password "$node_name")" \
    ssh "${SSH_OPTS[@]}" \
    -p "$(node_port "$node_name")" \
    "$(node_user "$node_name")@$(node_ip "$node_name")" \
    "printf '%s\n' $(printf '%q' "$(node_password "$node_name")") | sudo -S -p '' bash -lc $(printf '%q' "$*")"
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
  remote_sudo_ssh "$master" "KUBECONFIG=/etc/kubernetes/admin.conf kubectl $*"
}

kubectl_apply_file() {
  local local_file="$1"
  local remote_file="/tmp/$(basename "$local_file").$$"
  local master

  master="$(first_master_name)"
  remote_scp "$local_file" "$master" "$remote_file"
  remote_sudo_ssh "$master" "KUBECONFIG=/etc/kubernetes/admin.conf kubectl apply -f $remote_file && rm -f $remote_file"
}

render_cluster_inventory() {
  ensure_runtime_dirs
  node "$RENDER_CLUSTER_SCRIPT" "$@"
}

cluster_exists_in_kubeasz() {
  sudo test -d "$KUBEASZ_BASE_DIR/clusters/$(cluster_name)"
}

confirm_or_exit() {
  local prompt="$1"
  local answer

  read -r -p "$prompt [y/N]: " answer
  case "$answer" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      die "已取消。"
      ;;
  esac
}

copy_hosts_into_kubeasz() {
  copy_hosts_file_into_kubeasz "$GENERATED_DIR/hosts"
}

copy_hosts_file_into_kubeasz() {
  local source_file="$1"
  local target_dir="$KUBEASZ_BASE_DIR/clusters/$(cluster_name)"
  sudo mkdir -p "$target_dir"
  sudo install -m 0644 "$source_file" "$target_dir/hosts"
}

print_step() {
  echo
  echo "==> $*"
}
