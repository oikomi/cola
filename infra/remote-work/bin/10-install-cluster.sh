#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo
require_cmd node
ensure_ansible_available

CLUSTER_NAME="$(cluster_name)"

[[ -x "$KUBEASZ_DIR/ezctl" ]] || die "kubeasz 尚未准备好，请先执行 ./bin/00-bootstrap-kubeasz.sh"

print_step "重新渲染 inventory"
render_cluster_inventory
copy_hosts_into_kubeasz

print_step "开始安装 Kubernetes 集群"
(
  cd "$KUBEASZ_DIR"
  run_kubeasz_ezctl setup "$CLUSTER_NAME" all
)

echo "集群安装完成。下一步执行: ./bin/20-enable-gpu.sh"
