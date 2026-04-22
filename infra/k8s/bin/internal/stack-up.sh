#!/usr/bin/env bash

set -euo pipefail

BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRYPOINT="$BIN_DIR/cluster.sh"

usage() {
  cat <<'EOF'
Usage: ./bin/cluster.sh stack up [options]

Run the default bring-up flow in order:
  1. cluster bootstrap
  2. cluster install
  3. gpu enable
  4. dashboard deploy
  5. dashboard port-forward

Options:
  --with-images              Pass through to 'cluster bootstrap --with-images'
  --with-workspace-image     Also run './scripts/workspace-image.sh build-and-load'
  --skip-dashboard           Skip dashboard deploy and port-forward
  --skip-port-forward        Deploy dashboard but do not start port-forward
  --port-forward-foreground  Run dashboard port-forward in foreground
  --image-name <name>        Pass through to 'workspace-image.sh build-and-load'
  --image-tag <tag>          Pass through to 'workspace-image.sh build-and-load'
  --novnc-version <ver>      Pass through to 'workspace-image.sh build-and-load'
  -h, --help                 Show help
EOF
}

print_step() {
  echo
  echo "==> $*"
}

run_command() {
  local title="$1"
  shift
  print_step "$title"
  "$@"
}

run_command_or_exit() {
  local title="$1"
  local failure_hint="$2"
  shift 2

  if ! run_command "$title" "$@"; then
    echo >&2
    echo "ERROR: 步骤失败: $title" >&2
    echo "ERROR: 因此未继续执行: $failure_hint" >&2
    exit 1
  fi
}

WITH_IMAGES=0
WITH_WORKSPACE_IMAGE=0
SKIP_DASHBOARD=0
SKIP_PORT_FORWARD=0
PORT_FORWARD_FOREGROUND=0
IMAGE_NAME=""
IMAGE_TAG=""
NOVNC_VERSION=""
WORKSPACE_IMAGE_ENTRYPOINT="$BIN_DIR/../../../scripts/workspace-image.sh"

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-images)
      WITH_IMAGES=1
      shift
      ;;
    --with-workspace-image)
      WITH_WORKSPACE_IMAGE=1
      shift
      ;;
    --skip-dashboard)
      SKIP_DASHBOARD=1
      shift
      ;;
    --skip-port-forward)
      SKIP_PORT_FORWARD=1
      shift
      ;;
    --port-forward-foreground)
      PORT_FORWARD_FOREGROUND=1
      shift
      ;;
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
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      echo >&2
      usage >&2
      exit 1
      ;;
  esac
done

bootstrap_args=(cluster bootstrap)
image_args=(build-and-load)
dashboard_port_forward_args=(dashboard port-forward)

if [[ "$WITH_IMAGES" -eq 1 ]]; then
  bootstrap_args+=(--with-images)
fi

if [[ -n "$IMAGE_NAME" ]]; then
  image_args+=(--image-name "$IMAGE_NAME")
fi

if [[ -n "$IMAGE_TAG" ]]; then
  image_args+=(--image-tag "$IMAGE_TAG")
fi

if [[ -n "$NOVNC_VERSION" ]]; then
  image_args+=(--novnc-version "$NOVNC_VERSION")
fi

if [[ "$WITH_WORKSPACE_IMAGE" -ne 1 ]] && [[ "${#image_args[@]}" -gt 1 ]]; then
  echo "ERROR: --image-name/--image-tag/--novnc-version 只能与 --with-workspace-image 一起使用。" >&2
  exit 1
fi

if [[ "$PORT_FORWARD_FOREGROUND" -eq 1 ]]; then
  dashboard_port_forward_args+=(--foreground)
fi

run_command_or_exit \
  "Bootstrap cluster assets" \
  "cluster install、gpu enable、dashboard deploy、dashboard port-forward" \
  "$ENTRYPOINT" \
  "${bootstrap_args[@]}"
run_command_or_exit \
  "Install cluster" \
  "gpu enable、dashboard deploy、dashboard port-forward" \
  "$ENTRYPOINT" \
  cluster install
run_command_or_exit \
  "Enable GPU support" \
  "dashboard deploy、dashboard port-forward" \
  "$ENTRYPOINT" \
  gpu enable

if [[ "$WITH_WORKSPACE_IMAGE" -eq 1 ]]; then
  if ! run_command "Build and distribute workspace image" "$WORKSPACE_IMAGE_ENTRYPOINT" "${image_args[@]}"; then
    echo >&2
    echo "ERROR: 步骤失败: Build and distribute workspace image" >&2
    echo "ERROR: 因此未继续执行: dashboard deploy、dashboard port-forward" >&2
    exit 1
  fi
fi

if [[ "$SKIP_DASHBOARD" -eq 1 ]]; then
  print_step "Skip dashboard setup"
  echo "已跳过 dashboard deploy 和 port-forward。"
  exit 0
fi

run_command_or_exit \
  "Deploy Kubernetes Dashboard" \
  "dashboard port-forward" \
  "$ENTRYPOINT" \
  dashboard deploy

if [[ "$SKIP_PORT_FORWARD" -eq 1 ]]; then
  print_step "Skip dashboard port-forward"
  echo "Dashboard 已部署，未启动 port-forward。"
  exit 0
fi

run_command_or_exit \
  "Start dashboard port-forward" \
  "无后续步骤" \
  "$ENTRYPOINT" \
  "${dashboard_port_forward_args[@]}"
