#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo
require_cmd node

DESTROY_CLUSTER=1
PURGE_REMOTE_DATA=0
PURGE_LOCAL_CACHE=1
AUTO_YES=0

usage() {
  cat <<'EOF'
Usage: ./bin/99-clean-all.sh [options]

Destroy the current remote-work deployment and clean local state.
By default it will:
  1. destroy the kubeasz cluster for the current clusterName
  2. remove local runtime files under infra/remote-work/runtime
  3. remove local /etc/kubeasz cluster config for the current cluster

Options:
  --purge-remote-data      Also remove /var/lib/remote-work/workspaces on every node
  --keep-local-cache       Keep infra/remote-work/runtime and cache files
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

print_step "准备清理 remote-work 部署"
echo "Cluster: $CLUSTER_NAME"
echo "Destroy cluster: $DESTROY_CLUSTER"
echo "Purge remote data: $PURGE_REMOTE_DATA"
echo "Purge local cache: $PURGE_LOCAL_CACHE"

if [[ "$AUTO_YES" -ne 1 ]]; then
  confirm_or_exit "这会销毁当前 remote-work 集群与相关状态，是否继续？"
fi

if [[ "$DESTROY_CLUSTER" -eq 1 ]]; then
  if [[ -x "$KUBEASZ_DIR/ezctl" ]] && cluster_exists_in_kubeasz; then
    ensure_ansible_available
    print_step "通过 kubeasz 销毁集群"
    (
      cd "$KUBEASZ_DIR"
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
    remote_ssh "$node_name" "sudo rm -rf /var/lib/remote-work/workspaces"
  done
fi

print_step "清理 /etc/kubeasz 中当前 cluster 的本地配置"
sudo rm -rf "$KUBEASZ_BASE_DIR/clusters/$CLUSTER_NAME"

if [[ "$PURGE_LOCAL_CACHE" -eq 1 ]]; then
  print_step "清理 infra/remote-work/runtime"
  rm -rf "$RUNTIME_DIR"
fi

echo "remote-work 清理完成。"
