#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

REGISTRY_TOOL="$ROOT_DIR/bin/registry-cache.mjs"
REGISTRY_RENDER_DIR="$GENERATED_DIR/registry-mirrors"
ACTION="${1:-}"
DRY_RUN=0
SKIP_HARBOR=0
SKIP_NODES=0
TARGET_NODES_CSV=""
HARBOR_USERNAME="${COLA_HARBOR_USERNAME:-admin}"

usage() {
  cat <<'EOF'
Usage: ./bin/cluster.sh registry <configure|status> [options]

Actions:
  configure        Reconcile Harbor proxy projects and install containerd hosts.toml files
  status           Check Harbor proxy projects and compare node-side hosts.toml files

Options:
  --nodes <names>  Comma-separated node names, default all nodes from cluster/nodes.json
  --username <u>   Harbor administrator username, default admin
  --skip-harbor    Do not reconcile or check Harbor API resources
  --skip-nodes     Do not configure or check cluster nodes
  --dry-run        Show planned Harbor and node changes without writing
  -h, --help       Show help

Credentials:
  Set COLA_HARBOR_PASSWORD in the environment. The password is never read from
  cluster/config.json and is never written to generated files.
EOF
}

[[ -n "$ACTION" ]] || {
  usage >&2
  exit 1
}
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --nodes)
      TARGET_NODES_CSV="${2:-}"
      [[ -n "$TARGET_NODES_CSV" ]] || die "--nodes 不能为空"
      shift 2
      ;;
    --username)
      HARBOR_USERNAME="${2:-}"
      [[ -n "$HARBOR_USERNAME" ]] || die "--username 不能为空"
      shift 2
      ;;
    --skip-harbor)
      SKIP_HARBOR=1
      shift
      ;;
    --skip-nodes)
      SKIP_NODES=1
      shift
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

if [[ "$ACTION" != "configure" && "$ACTION" != "status" ]]; then
  die "未知 registry action: $ACTION"
fi
if [[ "$ACTION" == "status" && "$DRY_RUN" -eq 1 ]]; then
  die "registry status 不支持 --dry-run"
fi

require_cmd node
ensure_runtime_dirs

TARGET_NODES=()
resolve_target_nodes() {
  local node_name
  local seen_nodes=$'\n'
  local -a requested_nodes=()

  if [[ -n "$TARGET_NODES_CSV" ]]; then
    IFS=',' read -r -a requested_nodes <<<"$TARGET_NODES_CSV"
  else
    while IFS= read -r node_name; do
      [[ -n "$node_name" ]] && requested_nodes+=("$node_name")
    done < <(cluster_query nodeNames)
  fi

  for node_name in "${requested_nodes[@]}"; do
    node_name="${node_name//[[:space:]]/}"
    [[ -n "$node_name" ]] || continue
    if [[ "$seen_nodes" == *$'\n'"$node_name"$'\n'* ]]; then
      continue
    fi
    cluster_query nodeIp "$node_name" >/dev/null
    seen_nodes+="$node_name"$'\n'
    TARGET_NODES+=("$node_name")
  done

  [[ "${#TARGET_NODES[@]}" -gt 0 ]] || die "没有匹配的目标节点。"
}

read_harbor_password() {
  if [[ -n "${COLA_HARBOR_PASSWORD:-}" ]]; then
    return 0
  fi
  if [[ -t 0 ]]; then
    read -r -s -p "Harbor password for $HARBOR_USERNAME: " COLA_HARBOR_PASSWORD
    echo
    export COLA_HARBOR_PASSWORD
  fi
  [[ -n "${COLA_HARBOR_PASSWORD:-}" ]] || \
    die "缺少 COLA_HARBOR_PASSWORD，无法修改 Harbor 配置。"
}

render_registry_files() {
  node "$REGISTRY_TOOL" render --out "$REGISTRY_RENDER_DIR"
}

preflight_node() {
  local node_name="$1"

  remote_sudo_ssh_retry "$node_name" '
set -euo pipefail
test -S /run/containerd/containerd.sock
systemctl is-active --quiet containerd
grep -Eq '\''config_path[[:space:]]*=[[:space:]]*"/etc/containerd/certs.d"'\'' /etc/containerd/config.toml
' >/dev/null || die "节点 $node_name 的 containerd 未运行，或未启用 /etc/containerd/certs.d。"
}

remote_registry_file() {
  local registry="$1"
  printf '%s\n' "/etc/containerd/certs.d/$registry/hosts.toml"
}

node_registry_file_matches() {
  local node_name="$1"
  local registry="$2"
  local local_file="$REGISTRY_RENDER_DIR/$registry/hosts.toml"
  local remote_file
  local expected
  local actual

  remote_file="$(remote_registry_file "$registry")"
  expected="$(<"$local_file")"
  actual="$(
    remote_sudo_ssh_retry "$node_name" \
      "if [[ -f $(printf '%q' "$remote_file") ]]; then cat $(printf '%q' "$remote_file"); fi" || true
  )"
  [[ "$actual" == "$expected" ]]
}

install_registry_file() {
  local node_name="$1"
  local registry="$2"
  local local_file="$REGISTRY_RENDER_DIR/$registry/hosts.toml"
  local remote_file
  local remote_dir
  local remote_staged_file
  local remote_temp

  remote_file="$(remote_registry_file "$registry")"
  remote_dir="$(dirname "$remote_file")"
  remote_staged_file="$remote_file.cola-new-$$"
  remote_temp="/tmp/cola-registry-${registry//[^a-zA-Z0-9]/-}-$$.toml"

  remote_scp "$local_file" "$node_name" "$remote_temp"
  remote_sudo_ssh_retry "$node_name" "
set -euo pipefail
install -d -m 0755 $(printf '%q' "$remote_dir")
install -m 0644 $(printf '%q' "$remote_temp") $(printf '%q' "$remote_staged_file")
mv -f $(printf '%q' "$remote_staged_file") $(printf '%q' "$remote_file")
rm -f $(printf '%q' "$remote_temp")
systemctl is-active --quiet containerd
"
}

configure_nodes() {
  local node_name
  local registry
  local changed

  resolve_target_nodes
  require_any_cmd sshpass expect
  require_cmd ssh
  require_cmd scp

  for node_name in "${TARGET_NODES[@]}"; do
    preflight_node "$node_name"
  done

  for node_name in "${TARGET_NODES[@]}"; do
    changed=0
    for registry in "${MANAGED_REGISTRIES[@]}"; do
      if node_registry_file_matches "$node_name" "$registry"; then
        echo "ok: $node_name $registry"
        continue
      fi

      changed=$((changed + 1))
      if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "[dry-run] 将更新: $node_name $(remote_registry_file "$registry")"
      else
        install_registry_file "$node_name" "$registry"
        node_registry_file_matches "$node_name" "$registry" || \
          die "节点 $node_name 的 $registry hosts.toml 写入后校验失败。"
        echo "updated: $node_name $registry"
      fi
    done

    if [[ "$changed" -eq 0 ]]; then
      echo "节点 $node_name 的 registry 配置已经是最新状态。"
    elif [[ "$DRY_RUN" -eq 0 ]]; then
      echo "节点 $node_name 已更新 $changed 个 registry 配置；containerd 无需重启。"
    fi
  done
}

check_nodes() {
  local node_name
  local registry
  local failed=0

  resolve_target_nodes
  require_any_cmd sshpass expect
  require_cmd ssh

  for node_name in "${TARGET_NODES[@]}"; do
    if ! preflight_node "$node_name"; then
      failed=1
      continue
    fi
    for registry in "${MANAGED_REGISTRIES[@]}"; do
      if node_registry_file_matches "$node_name" "$registry"; then
        echo "ok: $node_name $registry"
      else
        echo "drift: $node_name $registry" >&2
        failed=1
      fi
    done
  done

  return "$failed"
}

render_registry_files
MANAGED_REGISTRIES=()
while IFS= read -r registry; do
  [[ -n "$registry" ]] && MANAGED_REGISTRIES+=("$registry")
done < "$REGISTRY_RENDER_DIR/.managed-registries"
[[ "${#MANAGED_REGISTRIES[@]}" -gt 0 ]] || die "没有生成任何 registry hosts 配置。"

case "$ACTION" in
  configure)
    if [[ "$SKIP_HARBOR" -eq 0 ]]; then
      read_harbor_password
      print_step "配置 Harbor 代理缓存"
      if [[ "$DRY_RUN" -eq 1 ]]; then
        COLA_HARBOR_USERNAME="$HARBOR_USERNAME" \
          node "$REGISTRY_TOOL" reconcile --dry-run
      else
        COLA_HARBOR_USERNAME="$HARBOR_USERNAME" \
          node "$REGISTRY_TOOL" reconcile
      fi
    fi
    if [[ "$SKIP_NODES" -eq 0 ]]; then
      print_step "配置 containerd 镜像源"
      configure_nodes
    fi
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "Dry-run 完成，未修改 Harbor 或节点配置。"
    else
      echo "Harbor 镜像代理与节点 containerd 配置完成。"
    fi
    ;;
  status)
    failed=0
    if [[ "$SKIP_HARBOR" -eq 0 ]]; then
      print_step "检查 Harbor 代理缓存"
      if ! COLA_HARBOR_USERNAME="$HARBOR_USERNAME" \
        node "$REGISTRY_TOOL" status; then
        failed=1
      fi
    fi
    if [[ "$SKIP_NODES" -eq 0 ]]; then
      print_step "检查 containerd 镜像源"
      if ! check_nodes; then
        failed=1
      fi
    fi
    [[ "$failed" -eq 0 ]] || die "Registry 状态检查失败。"
    echo "Harbor 代理缓存与节点 containerd 配置一致。"
    ;;
esac
