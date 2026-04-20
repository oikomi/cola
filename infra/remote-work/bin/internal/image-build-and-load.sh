#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

require_cmd docker
require_cmd node
require_cmd sshpass
require_cmd scp
require_cmd ssh

IMAGE_NAME="remote-workspace"
IMAGE_TAG="$(date +%Y%m%d%H%M%S)"
NOVNC_VERSION="v1.6.0"

build_workspace_image() {
  local image_ref="$1"
  local build_log
  local status

  build_log="$(mktemp)"
  trap 'rm -f "$build_log"' RETURN

  set +e
  docker build \
    --build-arg NOVNC_VERSION="$NOVNC_VERSION" \
    -t "$image_ref" \
    "$ROOT_DIR/images/remote-workspace" 2>&1 | tee "$build_log"
  status=${PIPESTATUS[0]}
  set -e

  if [[ "$status" -eq 0 ]]; then
    return 0
  fi

  if grep -Eq \
    "/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/|snapshot .* does not exist|failed to read dockerfile: snapshot .* not found|failed to solve: .*snapshot .* not found" \
    "$build_log"; then
    print_step "检测到 Docker BuildKit snapshot 状态异常，回退到 legacy builder 重试"
    DOCKER_BUILDKIT=0 docker build \
      --build-arg NOVNC_VERSION="$NOVNC_VERSION" \
      -t "$image_ref" \
      "$ROOT_DIR/images/remote-workspace"
    return 0
  fi

  return "$status"
}

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
build_workspace_image "$IMAGE_REF"

print_step "导出镜像"
docker save "$IMAGE_REF" | gzip > "$ARCHIVE_PATH"

mapfile -t TARGET_NODES < <(cluster_query nodeNamesByArch "$LOCAL_ARCH")
if [[ "${#TARGET_NODES[@]}" -eq 0 ]]; then
  die "没有找到 arch=$LOCAL_ARCH 的目标节点，无法分发镜像。"
fi

print_step "分发镜像到 ${#TARGET_NODES[@]} 个 arch=$LOCAL_ARCH 节点"
load_compressed_image_archive_into_nodes "$ARCHIVE_PATH" "${TARGET_NODES[@]}"

printf '%s\n' "$IMAGE_REF" > "$RUNTIME_DIR/latest-image.txt"

echo "镜像已导入 arch=$LOCAL_ARCH 的节点，默认镜像已写入 runtime/latest-image.txt"
