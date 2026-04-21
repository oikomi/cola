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
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=8
  -o TCPKeepAlive=yes
)

die() {
  echo "ERROR: $*" >&2
  exit 1
}

discover_local_sudo_password() {
  local user_name
  user_name="$(invoking_user_name)"

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$ROOT_DIR/cluster/config.json" "$ROOT_DIR/cluster/nodes.json" "$user_name" <<'PY'
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
    node --input-type=module - "$ROOT_DIR/cluster/config.json" "$ROOT_DIR/cluster/nodes.json" "$user_name" <<'EOF'
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
    return 0
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
    SUDO_ASKPASS="$ROOT_DIR/bin/internal/sudo-askpass.sh" \
    command sudo -A "$@"
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

ensure_runtime_tree_writable() {
  local user_name
  local group_name
  local ownership_mismatch=0

  user_name="$(invoking_user_name)"
  group_name="$(invoking_user_group)"

  if [[ ! -e "$RUNTIME_DIR" ]]; then
    mkdir -p "$RUNTIME_DIR"
  fi

  if [[ ! -w "$RUNTIME_DIR" ]]; then
    ownership_mismatch=1
  elif [[ -n "$(find "$RUNTIME_DIR" -mindepth 1 \( ! -user "$user_name" -o ! -group "$group_name" \) -print -quit 2>/dev/null)" ]]; then
    ownership_mismatch=1
  fi

  if [[ "$ownership_mismatch" -eq 0 ]]; then
    return 0
  fi

  command -v sudo >/dev/null 2>&1 || \
    die "runtime 目录当前不可写，且缺少 sudo，无法自动修复权限: $RUNTIME_DIR"

  print_step "修复 runtime 目录权限"
  sudo mkdir -p "$RUNTIME_DIR"
  sudo chown -R "$user_name:$group_name" "$RUNTIME_DIR"
  sudo chmod -R u+rwX "$RUNTIME_DIR"
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
    sudo apt-get -o DPkg::Lock::Timeout=300 update
    sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y python3-venv python3-pip || \
      sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y "$py_minor_pkg" python3-pip
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y python3 python3-pip
  else
    sudo yum install -y python3 python3-pip
  fi
}

ensure_ansible_available() {
  require_cmd python3
  require_cmd sudo
  ensure_runtime_dirs

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

kubeasz_ezctl_path() {
  if [[ -x "$KUBEASZ_DIR/ezctl" ]]; then
    printf '%s\n' "$KUBEASZ_DIR/ezctl"
    return 0
  fi

  if sudo test -x "$KUBEASZ_BASE_DIR/ezctl"; then
    printf '%s\n' "$KUBEASZ_BASE_DIR/ezctl"
    return 0
  fi

  return 1
}

run_kubeasz_ezctl() {
  local ezctl_path
  ensure_ansible_available
  patch_kubeasz_compatibility
  ezctl_path="$(kubeasz_ezctl_path)" || die "kubeasz 尚未准备好，请先执行 ./bin/cluster.sh cluster bootstrap"
  sudo env PATH="$(ansible_env_path)" "$ezctl_path" "$@"
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
  ensure_runtime_tree_writable
  mkdir -p "$GENERATED_DIR" "$WORKSPACE_DIR"
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

load_compressed_image_archive_into_nodes() {
  local archive_path="$1"
  shift

  [[ -f "$archive_path" ]] || die "找不到镜像归档: $archive_path"
  [[ $# -gt 0 ]] || die "未提供目标节点，无法导入镜像归档。"

  local archive_name
  local node_name

  archive_name="$(basename "$archive_path")"

  for node_name in "$@"; do
    remote_scp "$archive_path" "$node_name" "/tmp/$archive_name"
    remote_sudo_ssh "$node_name" \
      "gzip -dc /tmp/$archive_name | ctr -n k8s.io images import - && rm -f /tmp/$archive_name"
  done
}

cluster_kubeconfig_path() {
  printf '%s\n' "$KUBEASZ_BASE_DIR/clusters/$(cluster_name)/kubectl.kubeconfig"
}

cluster_kubeasz_config_path() {
  printf '%s\n' "$KUBEASZ_BASE_DIR/clusters/$(cluster_name)/config.yml"
}

invoking_user_name() {
  if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
    printf '%s\n' "$SUDO_USER"
    return 0
  fi

  id -un
}

invoking_user_group() {
  local user_name
  user_name="$(invoking_user_name)"
  id -gn "$user_name"
}

invoking_user_home_dir() {
  local user_name
  user_name="$(invoking_user_name)"

  python3 - "$user_name" <<'PY'
import pwd
import sys

print(pwd.getpwnam(sys.argv[1]).pw_dir)
PY
}

user_kubeconfig_path() {
  local home_dir
  home_dir="$(invoking_user_home_dir)"
  printf '%s\n' "$home_dir/.kube/$(cluster_name).config"
}

sync_user_kubeconfig() {
  local source_kubeconfig
  local user_name
  local group_name
  local target_kubeconfig
  local target_dir
  local tmp_kubeconfig
  local kubectl_bin

  source_kubeconfig="$(cluster_kubeconfig_path)"
  if ! sudo test -f "$source_kubeconfig"; then
    echo "WARN: kubeconfig 尚未生成，跳过用户态 kubeconfig 同步。"
    return 0
  fi

  user_name="$(invoking_user_name)"
  group_name="$(invoking_user_group)"
  target_kubeconfig="$(user_kubeconfig_path)"
  target_dir="$(dirname "$target_kubeconfig")"
  kubectl_bin="$(kubectl_bin_path)"
  tmp_kubeconfig="$(mktemp)"

  sudo env KUBECONFIG="$source_kubeconfig" "$kubectl_bin" config view --raw --flatten > "$tmp_kubeconfig"
  sudo install -d -o "$user_name" -g "$group_name" -m 0700 "$target_dir"
  sudo install -o "$user_name" -g "$group_name" -m 0600 "$tmp_kubeconfig" "$target_kubeconfig"
  rm -f "$tmp_kubeconfig"

  sudo chgrp "$group_name" "$source_kubeconfig"
  sudo chmod 0640 "$source_kubeconfig"

  echo "已同步用户 kubeconfig: $target_kubeconfig"
  echo "已允许当前用户组读取: $source_kubeconfig"
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
  ensure_runtime_dirs
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

cluster_proxy_mode() {
  local mode
  mode="$(cluster_query proxyMode || true)"
  if [[ -n "$mode" ]]; then
    printf '%s\n' "$mode"
    return 0
  fi

  local configured_archs
  configured_archs="$(
    node --input-type=module -e '
      import fs from "node:fs";
      const nodes = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const normalize = (value) => {
        switch (value) {
          case "x86_64":
          case "amd64":
          case "x64":
            return "amd64";
          case "aarch64":
          case "arm64":
            return "arm64";
          default:
            return value;
        }
      };
      const arches = new Set(nodes.map((node) => normalize(node.arch)));
      process.stdout.write(String(arches.size));
    ' "$ROOT_DIR/cluster/nodes.json"
  )"

  if [[ "$configured_archs" -gt 1 ]]; then
    printf '%s\n' "iptables"
  else
    printf '%s\n' "ipvs"
  fi
}

sandbox_image() {
  local image
  image="$(cluster_query sandboxImage || true)"
  if [[ -n "$image" ]]; then
    printf '%s\n' "$image"
  else
    printf '%s\n' "registry.k8s.io/pause:3.10"
  fi
}

configured_arch_count() {
  node --input-type=module -e '
    import fs from "node:fs";
    const nodes = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const normalize = (value) => {
      switch (value) {
        case "x86_64":
        case "amd64":
        case "x64":
          return "amd64";
        case "aarch64":
        case "arm64":
          return "arm64";
        default:
          return value;
      }
    };
    console.log(new Set(nodes.map((node) => normalize(node.arch))).size);
  ' "$ROOT_DIR/cluster/nodes.json"
}

cluster_has_mixed_arch_nodes_configured() {
  [[ "$(configured_arch_count)" -gt 1 ]]
}

kubeasz_config_value() {
  local key="$1"
  local file
  file="$(cluster_kubeasz_config_path)"

  sudo sed -n "s/^${key}: \"\\(.*\\)\"/\\1/p" "$file" | head -n 1
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

kubectl_remote() {
  local master
  master="$(first_master_name)"
  remote_sudo_ssh "$master" "/opt/kube/bin/kubectl --kubeconfig /root/.kube/config $*"
}

wait_for_cluster_node_ready() {
  local node_name="$1"
  local timeout_seconds="${2:-300}"
  local deadline
  local status
  local jsonpath

  jsonpath="{.status.conditions[?(@.type=='Ready')].status}"
  deadline=$((SECONDS + timeout_seconds))
  while (( SECONDS < deadline )); do
    status="$(run_cluster_kubectl get node "$node_name" -o "jsonpath=${jsonpath}" 2>/dev/null || true)"
    if [[ "$status" == "True" ]]; then
      return 0
    fi
    sleep 5
  done

  return 1
}

reconcile_mixed_arch_cluster_components() {
  cluster_has_mixed_arch_nodes_configured || return 0

  local calico_ver
  local dns_node_cache_ver
  local coredns_ver
  local coredns_tag
  local metrics_ver
  local node_name

  calico_ver="$(kubeasz_config_value calico_ver)"
  dns_node_cache_ver="$(kubeasz_config_value dnsNodeCacheVer || true)"
  coredns_ver="$(kubeasz_config_value corednsVer || true)"
  coredns_tag="$coredns_ver"
  if [[ -n "$coredns_tag" && "$coredns_tag" != v* ]]; then
    coredns_tag="v${coredns_tag}"
  fi
  metrics_ver="$(kubeasz_config_value metricsVer || true)"
  [[ -n "$calico_ver" ]] || return 0

  while IFS= read -r node_name; do
    [[ -n "$node_name" ]] || continue
    if [[ "$(node_arch "$node_name")" == "$(local_arch)" ]]; then
      continue
    fi

    if ! kubectl_remote "get node $node_name >/dev/null 2>&1"; then
      continue
    fi

    echo "Preparing multi-arch Calico images on $node_name ..."
    remote_sudo_ssh "$node_name" \
      "ctr -n k8s.io images rm docker.io/calico/cni:${calico_ver} docker.io/calico/node:${calico_ver} easzlab.io.local:5000/easzlab/cni:${calico_ver} easzlab.io.local:5000/easzlab/node:${calico_ver} >/dev/null 2>&1 || true"
    remote_sudo_ssh "$node_name" \
      "ctr -n k8s.io images pull docker.io/calico/cni:${calico_ver}"
    remote_sudo_ssh "$node_name" \
      "ctr -n k8s.io images pull docker.io/calico/node:${calico_ver}"

    if [[ -n "$dns_node_cache_ver" ]]; then
      remote_sudo_ssh "$node_name" \
        "ctr -n k8s.io images rm registry.k8s.io/dns/k8s-dns-node-cache:${dns_node_cache_ver} easzlab.io.local:5000/easzlab/k8s-dns-node-cache:${dns_node_cache_ver} >/dev/null 2>&1 || true"
      remote_sudo_ssh "$node_name" \
        "ctr -n k8s.io images pull registry.k8s.io/dns/k8s-dns-node-cache:${dns_node_cache_ver}"
    fi
  done < <(cluster_query nodeNames)

  if kubectl_remote "get ds calico-node -n kube-system >/dev/null 2>&1"; then
    kubectl_remote \
      "set image ds/calico-node -n kube-system install-cni=docker.io/calico/cni:${calico_ver} mount-bpffs=docker.io/calico/node:${calico_ver} calico-node=docker.io/calico/node:${calico_ver} >/dev/null"
  fi

  if [[ -n "$dns_node_cache_ver" ]] && kubectl_remote "get ds node-local-dns -n kube-system >/dev/null 2>&1"; then
    kubectl_remote \
      "set image ds/node-local-dns -n kube-system node-cache=registry.k8s.io/dns/k8s-dns-node-cache:${dns_node_cache_ver} >/dev/null"
  fi

  if [[ -n "$coredns_tag" ]] && kubectl_remote "get deploy coredns -n kube-system >/dev/null 2>&1"; then
    kubectl_remote \
      "set image deploy/coredns -n kube-system coredns=registry.k8s.io/coredns/coredns:${coredns_tag} >/dev/null"
  fi

  if [[ -n "$metrics_ver" ]] && kubectl_remote "get deploy metrics-server -n kube-system >/dev/null 2>&1"; then
    kubectl_remote \
      "set image deploy/metrics-server -n kube-system metrics-server=registry.k8s.io/metrics-server/metrics-server:${metrics_ver} >/dev/null"
  fi
}

ensure_mixed_arch_cluster_components_ready() {
  local timeout_seconds="${1:-600}"
  local node_name

  cluster_has_mixed_arch_nodes_configured || return 0

  print_step "调整 mixed-arch 集群系统组件镜像"
  reconcile_mixed_arch_cluster_components

  while IFS= read -r node_name; do
    [[ -n "$node_name" ]] || continue
    if [[ "$(node_arch "$node_name")" == "$(local_arch)" ]]; then
      continue
    fi

    if ! run_cluster_kubectl get node "$node_name" >/dev/null 2>&1; then
      continue
    fi

    echo "等待异构节点 $node_name 恢复 Ready ..."
    wait_for_cluster_node_ready "$node_name" "$timeout_seconds" || \
      die "异构节点 $node_name 在 mixed-arch 系统组件调整后仍未恢复 Ready。"
  done < <(cluster_query nodeNames)

  if run_cluster_kubectl get daemonset node-local-dns -n kube-system >/dev/null 2>&1; then
    echo "等待 node-local-dns DaemonSet 完成 rollout ..."
    run_cluster_kubectl rollout status daemonset/node-local-dns -n kube-system --timeout="${timeout_seconds}s" >/dev/null || \
      die "node-local-dns 在 mixed-arch 系统组件调整后仍未完成 rollout。"
  fi

  if run_cluster_kubectl get deployment coredns -n kube-system >/dev/null 2>&1; then
    echo "等待 coredns Deployment 完成 rollout ..."
    run_cluster_kubectl rollout status deployment/coredns -n kube-system --timeout="${timeout_seconds}s" >/dev/null || \
      die "coredns 在 mixed-arch 系统组件调整后仍未完成 rollout。"
  fi

  if run_cluster_kubectl get deployment metrics-server -n kube-system >/dev/null 2>&1; then
    echo "等待 metrics-server Deployment 完成 rollout ..."
    run_cluster_kubectl rollout status deployment/metrics-server -n kube-system --timeout="${timeout_seconds}s" >/dev/null || \
      die "metrics-server 在 mixed-arch 系统组件调整后仍未完成 rollout。"
  fi
}

kubectl_apply_file() {
  local local_file="$1"
  local remote_file="/tmp/$(basename "$local_file").$$"
  local master

  master="$(first_master_name)"
  remote_scp "$local_file" "$master" "$remote_file"
  remote_sudo_ssh "$master" "/opt/kube/bin/kubectl --kubeconfig /root/.kube/config apply -f $remote_file && rm -f $remote_file"
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
