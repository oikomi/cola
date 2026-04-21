#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

require_cmd sudo
require_cmd node
require_cmd ssh
require_cmd sshpass
ensure_ansible_available

CLUSTER_NAME="$(cluster_name)"

if ! kubeasz_ezctl_path >/dev/null 2>&1; then
  die "kubeasz 尚未准备好，请先执行 ./bin/cluster.sh cluster bootstrap"
fi
BOOTSTRAP_HOSTS="$GENERATED_DIR/hosts-bootstrap"
BOOTSTRAP_SUMMARY="$GENERATED_DIR/cluster-summary-bootstrap.json"
BOOTSTRAP_NODE_LIST=()

build_bootstrap_node_list() {
  local local_arch_norm
  local observed_arch
  local declared_arch
  local node_name

  local_arch_norm="$(normalize_arch_sh "$(local_arch)")"
  mapfile -t ALL_NODES < <(cluster_query nodeNames)

  print_step "探测节点真实架构并选择 bootstrap 节点"
  for node_name in "${ALL_NODES[@]}"; do
    declared_arch="$(normalize_arch_sh "$(node_arch "$node_name")")"
    observed_arch="$(probe_remote_node_arch "$node_name")"

    if [[ "$declared_arch" != "$observed_arch" ]]; then
      echo "WARN: 节点 $node_name 的声明架构是 $declared_arch，但远端实际是 $observed_arch。bootstrap 将以远端探测结果为准。"
    fi

    if [[ "$observed_arch" == "$local_arch_norm" ]]; then
      BOOTSTRAP_NODE_LIST+=("$node_name")
      echo "include: $node_name ($observed_arch)"
    else
      echo "skip:    $node_name ($observed_arch)"
    fi
  done

  [[ "${#BOOTSTRAP_NODE_LIST[@]}" -gt 0 ]] || \
    die "未找到与当前部署机同架构的 bootstrap 节点。"
}

print_step "重新渲染 inventory"
build_bootstrap_node_list
render_cluster_inventory \
  --mode bootstrap \
  --target-arch "$(local_arch)" \
  --include-nodes "$(IFS=,; echo "${BOOTSTRAP_NODE_LIST[*]}")" \
  --out "$BOOTSTRAP_HOSTS"
copy_hosts_file_into_kubeasz "$BOOTSTRAP_HOSTS"

if [[ -f "$BOOTSTRAP_SUMMARY" ]]; then
  SUMMARY_TEXT="$(
    node --input-type=module -e '
      import fs from "node:fs";
      const file = process.argv[1];
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const included = (data.includedNodes ?? []).map((node) => node.name).join(", ");
      const skipped = (data.skippedNodes ?? []).map((node) => `${node.name}:${node.arch}`).join(", ");
      console.log(`本轮 bootstrap 使用节点: ${included || "none"}`);
      if (skipped) {
        console.log(`以下异构节点已跳过，需二阶段接入: ${skipped}`);
      }
    ' "$BOOTSTRAP_SUMMARY"
  )"
  printf '%s\n' "$SUMMARY_TEXT"
fi

print_step "开始安装 Kubernetes 集群"
(
  cd "$KUBEASZ_DIR"
  run_kubeasz_ezctl setup "$CLUSTER_NAME" all
)

print_step "同步用户可读 kubeconfig"
sync_user_kubeconfig

if cluster_has_mixed_arch_nodes_configured; then
  print_step "自动接力 secondary-arch worker 节点"
  bash "$ROOT_DIR/bin/internal/cluster-auto-secondary-arch.sh"
  ensure_mixed_arch_cluster_components_ready 600
fi

echo "集群安装完成。下一步执行: ./bin/cluster.sh gpu enable"
