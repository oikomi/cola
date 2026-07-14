#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_BUILD_LIB="$REPO_ROOT/infra/k8s/bin/lib.sh"
DOCKERFILE_PATH="$REPO_ROOT/docker/sam2-inference.Dockerfile"
IMAGE_NAME="cola-sam2"
IMAGE_TAG="local"
BASE_IMAGE="pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime"
SAM2_GIT_URL="https://github.com/facebookresearch/sam2.git"
SAM2_GIT_REF="2b90b9f5ceec907a1c18123530e92e794ad901a4"
PIP_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"
PIP_TRUSTED_HOST="pypi.tuna.tsinghua.edu.cn"
APT_MIRROR="https://mirrors.tuna.tsinghua.edu.cn/ubuntu"
DOCKER_BUILD_NETWORK="host"
DOCKER_BUILD_NO_CACHE=0
TARGET_ARCH=""
RUNTIME_DIR="$REPO_ROOT/runtime"

usage() {
  cat <<'EOF'
Usage: ./scripts/sam2-inference-image.sh [build|build-and-load|load] [options]

Commands:
  build                   Build the SAM 2 image locally
  build-and-load          Build, export, and load the image into matching cluster nodes
  load                    Load an existing image archive into matching cluster nodes

Options:
  --image-name <name>     Image name, default cola-sam2
  --image-tag <tag>       Image tag, default local
  --base-image <ref>      PyTorch CUDA base image
  --sam2-git-url <url>    facebookresearch/sam2 Git repository or mirror
  --sam2-git-ref <ref>    Pinned facebookresearch/sam2 commit
  --target-arch <arch>    Target architecture; defaults to the first configured GPU node
  --pip-index-url <url>   Python package index, default Tsinghua PyPI mirror
  --pip-trusted-host <host>
                          Trusted host for the configured pip index
  --apt-mirror <url>      Ubuntu package mirror, default Tsinghua mirror
  --build-network <mode>  Docker build network mode, default host
  --no-cache              Build without Docker layer cache
  --archive <path>        Image archive for load/build-and-load
  -h, --help              Show help
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
      BASE_IMAGE="$2"
      shift 2
      ;;
    --sam2-git-url)
      SAM2_GIT_URL="$2"
      shift 2
      ;;
    --sam2-git-ref)
      SAM2_GIT_REF="$2"
      shift 2
      ;;
    --target-arch)
      TARGET_ARCH="$2"
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
    --apt-mirror)
      APT_MIRROR="$2"
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

if [[ "$cmd" != "build" && "$cmd" != "build-and-load" && "$cmd" != "load" ]]; then
  echo "Unknown command: $cmd" >&2
  usage >&2
  exit 1
fi

source "$IMAGE_BUILD_LIB"

require_cmd docker
[[ -f "$DOCKERFILE_PATH" ]] || die "找不到 Dockerfile: $DOCKERFILE_PATH"
ensure_runtime_dirs

if [[ -z "$TARGET_ARCH" ]]; then
  FIRST_GPU_NODE="$(cluster_query gpuNodeNames | head -n 1)"
  [[ -n "$FIRST_GPU_NODE" ]] || die "infra/k8s/cluster/nodes.json 中没有 GPU 节点。"
  TARGET_ARCH="$(cluster_query nodeArch "$FIRST_GPU_NODE")"
fi

if [[ "$TARGET_ARCH" != "amd64" && "$TARGET_ARCH" != "arm64" ]]; then
  die "不支持的目标架构: $TARGET_ARCH"
fi

IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
ARCHIVE_PATH="${ARCHIVE_PATH:-$RUNTIME_DIR/${IMAGE_NAME//\//-}_${IMAGE_TAG}_${TARGET_ARCH}.tar.gz}"
TARGET_PLATFORM="linux/$TARGET_ARCH"

if [[ "$cmd" == "build" || "$cmd" == "build-and-load" ]]; then
  print_step "构建 SAM 2 推理镜像 $IMAGE_REF ($TARGET_PLATFORM)"
  BUILD_ARGS=()
  if [[ "$DOCKER_BUILD_NO_CACHE" == "1" ]]; then
    BUILD_ARGS+=(--no-cache)
  fi
  docker build \
    --platform "$TARGET_PLATFORM" \
    -f "$DOCKERFILE_PATH" \
    --network "$DOCKER_BUILD_NETWORK" \
    "${BUILD_ARGS[@]}" \
    --build-arg "BASE_IMAGE=$BASE_IMAGE" \
    --build-arg "SAM2_GIT_URL=$SAM2_GIT_URL" \
    --build-arg "SAM2_GIT_REF=$SAM2_GIT_REF" \
    --build-arg "PIP_INDEX_URL=$PIP_INDEX_URL" \
    --build-arg "PIP_TRUSTED_HOST=$PIP_TRUSTED_HOST" \
    --build-arg "APT_MIRROR=$APT_MIRROR" \
    -t "$IMAGE_REF" \
    "$REPO_ROOT"
fi

if [[ "$cmd" == "build" ]]; then
  echo "SAM 2 推理镜像已构建: $IMAGE_REF ($TARGET_PLATFORM)"
  exit 0
fi

require_cmd sshpass
require_cmd scp
require_cmd ssh

if [[ "$cmd" == "build-and-load" ]]; then
  print_step "导出 SAM 2 推理镜像"
  docker image save --platform "$TARGET_PLATFORM" "$IMAGE_REF" | gzip > "$ARCHIVE_PATH"
fi

[[ -f "$ARCHIVE_PATH" ]] || die "找不到镜像归档: $ARCHIVE_PATH。请先执行 build-and-load，或通过 --archive 指定归档。"

TARGET_NODES=()
while IFS= read -r node_name; do
  [[ -n "$node_name" ]] && TARGET_NODES+=("$node_name")
done < <(cluster_query nodeNamesByArch "$TARGET_ARCH")

if [[ "${#TARGET_NODES[@]}" -eq 0 ]]; then
  die "infra/k8s/cluster/nodes.json 中没有 arch=$TARGET_ARCH 的目标节点。"
fi

print_step "分发 SAM 2 推理镜像到 ${#TARGET_NODES[@]} 个 arch=$TARGET_ARCH 节点"
load_compressed_image_archive_into_nodes "$ARCHIVE_PATH" --image-ref "$IMAGE_REF" -- "${TARGET_NODES[@]}"

echo "SAM 2 推理镜像已导入集群节点: $IMAGE_REF"
