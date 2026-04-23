#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_BUILD_SCRIPT="$REPO_ROOT/infra/k8s/bin/lib.sh"
DOCKERFILE_PATH="$REPO_ROOT/docker/training-deepspeed.Dockerfile"
IMAGE_NAME="cola-training-deepspeed"
IMAGE_TAG="local"
RUNTIME_DIR="$REPO_ROOT/runtime"

usage() {
  cat <<'EOF'
Usage: ./scripts/training-image.sh build-and-load [options]

Options:
  --image-name <name>   Image name, default cola-training-deepspeed
  --image-tag <tag>     Image tag, default local
  -h, --help            Show help
EOF
}

cmd="${1:-}"
if [[ -z "$cmd" || "$cmd" == "-h" || "$cmd" == "--help" ]]; then
  usage
  exit 0
fi
shift

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
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$cmd" != "build-and-load" ]]; then
  echo "Unknown command: $cmd" >&2
  usage >&2
  exit 1
fi

source "$IMAGE_BUILD_SCRIPT"

require_cmd docker
require_cmd sshpass
require_cmd scp
require_cmd ssh

[[ -f "$DOCKERFILE_PATH" ]] || die "找不到 Dockerfile: $DOCKERFILE_PATH"

ensure_runtime_dirs

IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
ARCHIVE_PATH="$RUNTIME_DIR/${IMAGE_NAME//\//-}_${IMAGE_TAG}.tar.gz"
LOCAL_ARCH="$(local_arch)"
LOCAL_PLATFORM="linux/$LOCAL_ARCH"

print_step "构建训练镜像 $IMAGE_REF"
docker build \
  -f "$DOCKERFILE_PATH" \
  -t "$IMAGE_REF" \
  "$REPO_ROOT"

print_step "导出训练镜像"
docker image save --platform "$LOCAL_PLATFORM" "$IMAGE_REF" | gzip > "$ARCHIVE_PATH"

mapfile -t TARGET_NODES < <(cluster_query nodeNamesByArch "$LOCAL_ARCH")
if [[ "${#TARGET_NODES[@]}" -eq 0 ]]; then
  die "没有找到 arch=$LOCAL_ARCH 的目标节点，无法分发训练镜像。"
fi

print_step "分发训练镜像到 ${#TARGET_NODES[@]} 个 arch=$LOCAL_ARCH 节点"
load_compressed_image_archive_into_nodes "$ARCHIVE_PATH" "${TARGET_NODES[@]}"

echo "训练镜像已导入集群节点: $IMAGE_REF"
