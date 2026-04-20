#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo
require_cmd node
ensure_ansible_available

CLUSTER_NAME="$(cluster_name)"

[[ -x "$KUBEASZ_DIR/ezctl" ]] || die "kubeasz 尚未准备好，请先执行 ./bin/00-bootstrap-kubeasz.sh"
BOOTSTRAP_HOSTS="$GENERATED_DIR/hosts-bootstrap"
BOOTSTRAP_SUMMARY="$GENERATED_DIR/cluster-summary-bootstrap.json"

print_step "重新渲染 inventory"
render_cluster_inventory --mode bootstrap --target-arch "$(local_arch)" --out "$BOOTSTRAP_HOSTS"
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

echo "集群安装完成。下一步执行: ./bin/20-enable-gpu.sh"
