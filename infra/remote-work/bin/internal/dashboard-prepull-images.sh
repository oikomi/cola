#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

require_cmd docker
require_cmd node
require_cmd sshpass
require_cmd scp
require_cmd ssh
require_cmd sudo

TAG_SET="${1:-7.14.0}"
RUNTIME_DIR_IMAGES="$RUNTIME_DIR/dashboard-images"
mkdir -p "$RUNTIME_DIR_IMAGES"

LOCAL_ARCH="$(local_arch)"
mapfile -t TARGET_NODES < <(cluster_query nodeNamesByArch "$LOCAL_ARCH")

if [[ "${#TARGET_NODES[@]}" -eq 0 ]]; then
  die "没有找到 arch=$LOCAL_ARCH 的目标节点，无法分发 Dashboard 镜像。"
fi

IMAGES=(
  "docker.io/kubernetesui/dashboard-api:1.14.0"
  "docker.io/kubernetesui/dashboard-auth:1.4.0"
  "docker.io/kubernetesui/dashboard-web:1.7.0"
  "docker.io/kubernetesui/dashboard-metrics-scraper:1.2.2"
  "docker.io/library/kong:3.9"
)

for image_ref in "${IMAGES[@]}"; do
  image_file="$RUNTIME_DIR_IMAGES/${image_ref//\//_}"
  image_file="${image_file//:/_}.tar.gz"

  print_step "准备镜像 $image_ref"
  docker pull "$image_ref"
  docker save "$image_ref" | gzip > "$image_file"

  print_step "分发 $image_ref 到 ${#TARGET_NODES[@]} 个节点"
  load_compressed_image_archive_into_nodes "$image_file" "${TARGET_NODES[@]}"
done

if sudo test -f "$(cluster_kubeconfig_path)"; then
  print_step "重启 Kubernetes Dashboard Pod 以重新拉起容器"
  run_cluster_kubectl -n kubernetes-dashboard delete pod --all --ignore-not-found || true
fi

echo "Dashboard 相关镜像已导入 arch=$LOCAL_ARCH 的节点。"
