#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd docker
require_cmd node
require_cmd sshpass
require_cmd scp
require_cmd ssh

IMAGE_NAME="remote-workspace"
IMAGE_TAG="$(date +%Y%m%d%H%M%S)"
NOVNC_VERSION="v1.6.0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-name)
      IMAGE_NAME="$2"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --novnc-version)
      NOVNC_VERSION="$2"
      shift 2
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

ensure_runtime_dirs

IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
ARCHIVE_PATH="$RUNTIME_DIR/${IMAGE_NAME//\//-}_${IMAGE_TAG}.tar.gz"
LOCAL_ARCH="$(local_arch)"

print_step "构建镜像 $IMAGE_REF"
docker build \
  --build-arg NOVNC_VERSION="$NOVNC_VERSION" \
  -t "$IMAGE_REF" \
  "$ROOT_DIR/images/remote-workspace"

print_step "导出镜像"
docker save "$IMAGE_REF" | gzip > "$ARCHIVE_PATH"

mapfile -t TARGET_NODES < <(cluster_query nodeNamesByArch "$LOCAL_ARCH")
if [[ "${#TARGET_NODES[@]}" -eq 0 ]]; then
  die "没有找到 arch=$LOCAL_ARCH 的目标节点，无法分发镜像。"
fi

for node_name in "${TARGET_NODES[@]}"; do
  print_step "分发镜像到 $node_name"
  remote_scp "$ARCHIVE_PATH" "$node_name" "/tmp/$(basename "$ARCHIVE_PATH")"
  remote_ssh "$node_name" \
    "gzip -dc /tmp/$(basename "$ARCHIVE_PATH") | sudo ctr -n k8s.io images import - && rm -f /tmp/$(basename "$ARCHIVE_PATH")"
done

printf '%s\n' "$IMAGE_REF" > "$RUNTIME_DIR/latest-image.txt"

echo "镜像已导入 arch=$LOCAL_ARCH 的节点，默认镜像已写入 runtime/latest-image.txt"
