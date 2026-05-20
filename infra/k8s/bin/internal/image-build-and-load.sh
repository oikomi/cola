#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

IMAGE_NAME="remote-workspace"
IMAGE_TAG="$(date +%Y%m%d%H%M%S)"
KASMVNC_VERSION="1.4.0"
UBUNTU_VERSION="24.04.4"
BASE_IMAGE=""
OFFLINE_DEB_DIR=""
SKIP_PACKAGE_INSTALL="0"
SKIP_BROWSER_INSTALL="0"
UBUNTU_APT_URL="https://mirrors.cernet.edu.cn/ubuntu"
MOZILLA_APT_URL="https://mirrors.cernet.edu.cn/mozilla/apt"
MOZILLA_APT_FALLBACK_URL="https://mirrors.cernet.edu.cn/mozilla/apt"
TARGET_ARCH=""
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
WORKSPACE_IMAGE_CONTEXT_DIR="$REPO_ROOT/workloads/remote-workspace"
WORKSPACE_IMAGE_METADATA_DIR="$REPO_ROOT/runtime/workspace"
WORKSPACE_IMAGE_REF_PATH="$WORKSPACE_IMAGE_METADATA_DIR/latest-image.txt"

usage() {
  cat <<'EOF'
Usage: ./scripts/workspace-image.sh build-and-load [options]

Options:
  --image-name <name>     Image name, default remote-workspace
  --image-tag <tag>       Image tag, default current timestamp
  --ubuntu-version <ver>  Ubuntu base image version, default 24.04.4
  --base-image <ref>      Override Docker base image, default resolved from --ubuntu-version
  --offline-deb-dir <dir> Install .deb files from image context path without apt network access
  --skip-package-install  Reuse a base image that already contains desktop packages, Firefox and KasmVNC
  --skip-browser-install  Skip Firefox installation; intended for local desktop smoke tests only
  --ubuntu-apt-url <url>  Ubuntu APT mirror URL, default mirrors.cernet.edu.cn/ubuntu
  --mozilla-apt-url <url> Primary Mozilla APT repo URL, default mirrors.cernet.edu.cn/mozilla/apt
  --mozilla-apt-fallback-url <url>
                           Fallback Mozilla APT mirror, default CERNET
  --target-arch <arch>    Target node arch, default first configured node arch
  --kasmvnc-version <ver> KasmVNC release version, default 1.4.0
  -h, --help              Show help
EOF
}

build_workspace_image() {
  local image_ref="$1"
  local base_image
  local build_log
  local status

  base_image="$BASE_IMAGE"
  if [[ -z "$base_image" ]]; then
    base_image="$(base_image_for_ubuntu_version "$UBUNTU_VERSION")"
  fi

  build_log="$(mktemp)"
  trap 'rm -f "$build_log"' RETURN

  set +e
  docker build \
    --platform "$LOCAL_PLATFORM" \
    --build-arg BASE_IMAGE="$base_image" \
    --build-arg UBUNTU_VERSION="$UBUNTU_VERSION" \
    --build-arg KASMVNC_VERSION="$KASMVNC_VERSION" \
    --build-arg TARGETARCH="$LOCAL_ARCH" \
    --build-arg OFFLINE_DEB_DIR="$OFFLINE_DEB_DIR" \
    --build-arg SKIP_PACKAGE_INSTALL="$SKIP_PACKAGE_INSTALL" \
    --build-arg SKIP_BROWSER_INSTALL="$SKIP_BROWSER_INSTALL" \
    --build-arg UBUNTU_APT_URL="$UBUNTU_APT_URL" \
    --build-arg MOZILLA_APT_URL="$MOZILLA_APT_URL" \
    --build-arg MOZILLA_APT_FALLBACK_URL="$MOZILLA_APT_FALLBACK_URL" \
    -t "$image_ref" \
    "$WORKSPACE_IMAGE_CONTEXT_DIR" 2>&1 | tee "$build_log"
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
      --platform "$LOCAL_PLATFORM" \
      --build-arg BASE_IMAGE="$base_image" \
      --build-arg UBUNTU_VERSION="$UBUNTU_VERSION" \
      --build-arg KASMVNC_VERSION="$KASMVNC_VERSION" \
      --build-arg TARGETARCH="$LOCAL_ARCH" \
      --build-arg OFFLINE_DEB_DIR="$OFFLINE_DEB_DIR" \
      --build-arg SKIP_PACKAGE_INSTALL="$SKIP_PACKAGE_INSTALL" \
      --build-arg SKIP_BROWSER_INSTALL="$SKIP_BROWSER_INSTALL" \
      --build-arg UBUNTU_APT_URL="$UBUNTU_APT_URL" \
      --build-arg MOZILLA_APT_URL="$MOZILLA_APT_URL" \
      --build-arg MOZILLA_APT_FALLBACK_URL="$MOZILLA_APT_FALLBACK_URL" \
      -t "$image_ref" \
      "$WORKSPACE_IMAGE_CONTEXT_DIR"
    return 0
  fi

  return "$status"
}

base_image_for_ubuntu_version() {
  case "$1" in
    24.04.4)
      printf '%s\n' "ubuntu:noble-20260410"
      ;;
    24.04|noble)
      printf '%s\n' "ubuntu:24.04"
      ;;
    *)
      printf '%s\n' "$1"
      ;;
  esac
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
    --kasmvnc-version)
      KASMVNC_VERSION="${2#v}"
      shift 2
      ;;
    --novnc-version)
      echo "ERROR: --novnc-version 已废弃；当前工作区镜像使用 KasmVNC，请改用 --kasmvnc-version。" >&2
      exit 1
      ;;
    --ubuntu-version)
      UBUNTU_VERSION="$2"
      shift 2
      ;;
    --base-image)
      BASE_IMAGE="$2"
      shift 2
      ;;
    --offline-deb-dir)
      OFFLINE_DEB_DIR="$2"
      shift 2
      ;;
    --skip-package-install)
      SKIP_PACKAGE_INSTALL="1"
      shift
      ;;
    --skip-browser-install)
      SKIP_BROWSER_INSTALL="1"
      shift
      ;;
    --ubuntu-apt-url)
      UBUNTU_APT_URL="$2"
      shift 2
      ;;
    --mozilla-apt-url)
      MOZILLA_APT_URL="$2"
      shift 2
      ;;
    --mozilla-apt-fallback-url)
      MOZILLA_APT_FALLBACK_URL="$2"
      shift 2
      ;;
    --target-arch)
      TARGET_ARCH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

require_cmd docker
require_cmd node
require_any_cmd sshpass expect
require_cmd scp
require_cmd ssh

ensure_runtime_dirs
[[ -d "$WORKSPACE_IMAGE_CONTEXT_DIR" ]] || \
  die "找不到工作区镜像上下文目录: $WORKSPACE_IMAGE_CONTEXT_DIR"

IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
CANONICAL_IMAGE_REF="$(canonical_k8s_image_ref "$IMAGE_REF")"
ARCHIVE_PATH="$RUNTIME_DIR/${IMAGE_NAME//\//-}_${IMAGE_TAG}.tar.gz"
if [[ -z "$TARGET_ARCH" ]]; then
  TARGET_ARCH="$(cluster_query nodeArch "$(cluster_query nodeNames | head -n 1)")"
fi

LOCAL_ARCH="$TARGET_ARCH"
LOCAL_PLATFORM="linux/$LOCAL_ARCH"

print_step "构建镜像 $IMAGE_REF"
build_workspace_image "$IMAGE_REF"

print_step "导出镜像"
docker image save --platform "$LOCAL_PLATFORM" "$IMAGE_REF" | gzip > "$ARCHIVE_PATH"

TARGET_NODES=()
while IFS= read -r node_name; do
  [[ -n "$node_name" ]] && TARGET_NODES+=("$node_name")
done < <(cluster_query nodeNamesByArch "$LOCAL_ARCH")
if [[ "${#TARGET_NODES[@]}" -eq 0 ]]; then
  die "没有找到 arch=$LOCAL_ARCH 的目标节点，无法分发镜像。"
fi

print_step "分发镜像到 ${#TARGET_NODES[@]} 个 arch=$LOCAL_ARCH 节点"
load_compressed_image_archive_into_nodes "$ARCHIVE_PATH" --image-ref "$CANONICAL_IMAGE_REF" -- "${TARGET_NODES[@]}"

mkdir -p "$WORKSPACE_IMAGE_METADATA_DIR"
printf '%s\n' "$CANONICAL_IMAGE_REF" > "$WORKSPACE_IMAGE_REF_PATH"

echo "镜像已导入 arch=$LOCAL_ARCH 的节点，默认镜像已写入 runtime/workspace/latest-image.txt"
