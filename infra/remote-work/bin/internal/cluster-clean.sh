#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

require_cmd sudo
require_cmd node

DESTROY_CLUSTER=1
PURGE_REMOTE_DATA=0
PURGE_LOCAL_CACHE=0
AUTO_YES=0

usage() {
  cat <<'EOF'
Usage: ./bin/cluster.sh cluster clean [options]

Destroy the current remote-work deployment and clean local state.
By default it will:
  1. destroy the kubeasz cluster for the current clusterName
  2. remove local runtime state under infra/remote-work/runtime
  3. keep local image archives and secondary-arch asset bundles for reuse
  4. remove local /etc/kubeasz cluster config for the current cluster

Options:
  --purge-remote-data      Also remove /var/lib/remote-work/workspaces on every node
  --purge-local-cache      Also remove local image archives and secondary-arch asset bundles
  --keep-local-cache       Backward-compatible alias; local cache is now kept by default
  --skip-destroy-cluster   Skip 'ezctl destroy', only clean local state
  --yes                    Do not ask for interactive confirmation
  -h, --help               Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-remote-data)
      PURGE_REMOTE_DATA=1
      shift
      ;;
    --purge-local-cache)
      PURGE_LOCAL_CACHE=1
      shift
      ;;
    --keep-local-cache)
      PURGE_LOCAL_CACHE=0
      shift
      ;;
    --skip-destroy-cluster)
      DESTROY_CLUSTER=0
      shift
      ;;
    --yes)
      AUTO_YES=1
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

ensure_runtime_dirs

CLUSTER_NAME="$(cluster_name)"

cleanup_local_secondary_arch_cache() {
  local secondary_arch_dir="$RUNTIME_DIR/secondary-arch"
  local path

  [[ -d "$secondary_arch_dir" ]] || return 0

  while IFS= read -r -d '' path; do
    sudo rm -rf "$path"
  done < <(
    find "$secondary_arch_dir" -mindepth 1 -maxdepth 1 \
      \( -type d -o -name '*.part' -o -name 'repo-sync.*.tar.gz' \) \
      -print0
  )
}

cleanup_local_runtime_state_preserving_cache() {
  local path

  [[ -d "$RUNTIME_DIR" ]] || return 0

  print_step "清理 infra/remote-work/runtime 运行态，保留本地镜像/资产缓存"
  while IFS= read -r -d '' path; do
    sudo rm -rf "$path"
  done < <(
    find "$RUNTIME_DIR" -mindepth 1 -maxdepth 1 \
      ! -name cache \
      ! -name secondary-arch \
      -print0
  )

  cleanup_local_secondary_arch_cache
}

cleanup_remote_secondary_arch_staging() {
  if ! command -v sshpass >/dev/null 2>&1 || ! command -v ssh >/dev/null 2>&1; then
    echo "WARN: 当前主机缺少 sshpass/ssh，跳过 secondary-arch staging 清理。"
    return 0
  fi

  print_step "清理各节点上的 secondary-arch staging 目录"
  mapfile -t ALL_NODES < <(cluster_query nodeNames)
  for node_name in "${ALL_NODES[@]}"; do
    local remote_home
    local staging_dir

    remote_home="$(remote_ssh "$node_name" 'printf %s "$HOME"' 2>/dev/null | tail -n 1 || true)"
    if [[ -z "$remote_home" ]]; then
      echo "WARN: 无法获取节点 $node_name 的 HOME，跳过 secondary-arch staging 清理。"
      continue
    fi

    staging_dir="$remote_home/.remote-work-secondary-arch/$CLUSTER_NAME"
    echo "Cleaning secondary-arch staging on $node_name ..."
    remote_sudo_ssh "$node_name" "rm -rf $(printf '%q' "$staging_dir")"
  done
}

print_step "准备清理 remote-work 部署"
echo "Cluster: $CLUSTER_NAME"
echo "Destroy cluster: $DESTROY_CLUSTER"
echo "Purge remote data: $PURGE_REMOTE_DATA"
echo "Purge local cache: $PURGE_LOCAL_CACHE"

if [[ "$AUTO_YES" -ne 1 ]]; then
  confirm_or_exit "这会销毁当前 remote-work 集群与相关状态，是否继续？"
fi

if [[ "$DESTROY_CLUSTER" -eq 1 ]]; then
  if kubeasz_ezctl_path >/dev/null 2>&1 && cluster_exists_in_kubeasz; then
    ensure_ansible_available
    print_step "刷新 kubeasz inventory，确保 mixed-arch 节点被纳入 destroy"
    render_cluster_inventory --mode full --out "$GENERATED_DIR/hosts"
    copy_hosts_into_kubeasz
    print_step "通过 kubeasz 销毁集群"
    (
      cd "$KUBEASZ_DIR" 2>/dev/null || cd "$KUBEASZ_BASE_DIR"
      run_kubeasz_ezctl destroy "$CLUSTER_NAME"
    )
  else
    echo "未检测到可销毁的 kubeasz cluster，跳过集群销毁。"
  fi
fi

if [[ "$PURGE_REMOTE_DATA" -eq 1 ]]; then
  require_cmd sshpass
  require_cmd ssh
  print_step "清理所有节点上的远端工作区目录"
  mapfile -t ALL_NODES < <(cluster_query nodeNames)
  for node_name in "${ALL_NODES[@]}"; do
    echo "Cleaning remote workspace data on $node_name ..."
    remote_sudo_ssh "$node_name" "rm -rf /var/lib/remote-work/workspaces"
  done
fi

cleanup_remote_secondary_arch_staging

print_step "清理 /etc/kubeasz 中当前 cluster 的本地配置"
sudo rm -rf "$KUBEASZ_BASE_DIR/clusters/$CLUSTER_NAME"

if [[ "$PURGE_LOCAL_CACHE" -eq 1 ]]; then
  print_step "清理 infra/remote-work/runtime"
  sudo rm -rf "$RUNTIME_DIR"
else
  cleanup_local_runtime_state_preserving_cache
fi

echo "remote-work 清理完成。"
