#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd git
require_cmd node
require_cmd ansible-playbook
require_cmd sshpass
require_cmd rsync

ensure_runtime_dirs

KUBEASZ_VERSION="$(cluster_query kubeaszVersion)"
KUBE_VERSION="$(cluster_query kubernetesVersion)"
KUBEASZ_REPO_URL="$(cluster_query kubeaszRepoUrl)"
CLUSTER_NAME="$(cluster_name)"

print_step "准备 kubeasz 目录"
if [[ ! -d "$KUBEASZ_DIR/.git" ]]; then
  git clone --depth 1 --branch "$KUBEASZ_VERSION" "$KUBEASZ_REPO_URL" "$KUBEASZ_DIR"
else
  echo "复用现有 kubeasz 目录: $KUBEASZ_DIR"
fi

chmod +x "$KUBEASZ_DIR/ezdown" "$KUBEASZ_DIR/ezctl"

print_step "下载 kubeasz 依赖"
(
  cd "$KUBEASZ_DIR"
  ./ezdown -D -k "$KUBE_VERSION"
)

print_step "初始化 kubeasz cluster 目录"
if [[ ! -d "$KUBEASZ_DIR/clusters/$CLUSTER_NAME" ]]; then
  (
    cd "$KUBEASZ_DIR"
    ./ezctl new "$CLUSTER_NAME"
  )
fi

print_step "渲染并同步 inventory"
render_cluster_inventory
copy_hosts_into_kubeasz

echo "kubeasz 已准备完成。下一步执行: ./bin/10-install-cluster.sh"

