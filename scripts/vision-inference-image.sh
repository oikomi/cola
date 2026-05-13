#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_BUILD_SCRIPT="$REPO_ROOT/infra/k8s/bin/lib.sh"
DOCKERFILE_PATH="$REPO_ROOT/docker/vision-inference.Dockerfile"
IMAGE_NAME="cola-vision-tensorrt"
IMAGE_TAG="local"
TENSORRT_BASE_IMAGE="nvcr.io/nvidia/tensorrt:24.07-py3"
PIP_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"
PIP_TRUSTED_HOST="pypi.tuna.tsinghua.edu.cn"
DOCKER_BUILD_NETWORK="host"
DOCKER_BUILD_NO_CACHE=0
RUNTIME_DIR="$REPO_ROOT/runtime"

usage() {
  cat <<'EOF'
Usage: ./scripts/vision-inference-image.sh [build-and-load|load] [options]

Commands:
  build-and-load          Build the image, export it, and load it into cluster nodes
  load                    Load an existing image archive into cluster nodes

Options:
  --image-name <name>   Image name, default cola-vision-tensorrt
  --image-tag <tag>     Image tag, default local
  --base-image <ref>    TensorRT base image, default nvcr.io/nvidia/tensorrt:24.07-py3
  --pip-index-url <url> Python package index, default Tsinghua PyPI mirror
  --pip-trusted-host <host>
                        Trusted host for the configured pip index
  --build-network <mode>
                        Docker build network mode, default host
  --no-cache           Build the image without Docker layer cache
  --archive <path>      Image archive path for load, default runtime/<image>_<tag>.tar.gz
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
    --base-image)
      TENSORRT_BASE_IMAGE="$2"
      shift 2
      ;;
    --pip-index-url)
      PIP_INDEX_URL="$2"
      shift 2
      ;;
    --pip-trusted-host)
      PIP_TRUSTED_HOST="$2"
      shift 2
      ;;
    --build-network)
      DOCKER_BUILD_NETWORK="$2"
      shift 2
      ;;
    --no-cache)
      DOCKER_BUILD_NO_CACHE=1
      shift
      ;;
    --archive)
      ARCHIVE_PATH="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$cmd" != "build-and-load" && "$cmd" != "load" ]]; then
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
ARCHIVE_PATH="${ARCHIVE_PATH:-$RUNTIME_DIR/${IMAGE_NAME//\//-}_${IMAGE_TAG}.tar.gz}"
LOCAL_ARCH="$(local_arch)"
LOCAL_PLATFORM="linux/$LOCAL_ARCH"

if [[ "$cmd" == "build-and-load" ]]; then
  print_step "构建视觉推理镜像 $IMAGE_REF"
  BUILD_ARGS=()
  if [[ "$DOCKER_BUILD_NO_CACHE" == "1" ]]; then
    BUILD_ARGS+=(--no-cache)
  fi
  docker build \
    -f "$DOCKERFILE_PATH" \
    --network "$DOCKER_BUILD_NETWORK" \
    "${BUILD_ARGS[@]}" \
    --build-arg "TENSORRT_BASE_IMAGE=$TENSORRT_BASE_IMAGE" \
    --build-arg "PIP_INDEX_URL=$PIP_INDEX_URL" \
    --build-arg "PIP_TRUSTED_HOST=$PIP_TRUSTED_HOST" \
    -t "$IMAGE_REF" \
    "$REPO_ROOT"

  print_step "导出视觉推理镜像"
  docker image save --platform "$LOCAL_PLATFORM" "$IMAGE_REF" | gzip > "$ARCHIVE_PATH"
fi

[[ -f "$ARCHIVE_PATH" ]] || die "找不到镜像归档: $ARCHIVE_PATH。请先执行 build-and-load，或通过 --archive 指定归档。"

mapfile -t TARGET_NODES < <(cluster_query nodeNamesByArch "$LOCAL_ARCH")
if [[ "${#TARGET_NODES[@]}" -eq 0 ]]; then
  die "没有找到 arch=$LOCAL_ARCH 的目标节点，无法分发视觉推理镜像。"
fi

print_step "分发视觉推理镜像到 ${#TARGET_NODES[@]} 个 arch=$LOCAL_ARCH 节点"
load_compressed_image_archive_into_nodes "$ARCHIVE_PATH" --image-ref "$IMAGE_REF" -- "${TARGET_NODES[@]}"

echo "视觉推理镜像已导入集群节点: $IMAGE_REF"
