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
  4. image build-and-load
  5. dashboard deploy
  6. dashboard port-forward

Options:
  --with-images              Pass through to 'cluster bootstrap --with-images'
  --skip-dashboard           Skip dashboard deploy and port-forward
  --skip-port-forward        Deploy dashboard but do not start port-forward
  --port-forward-foreground  Run dashboard port-forward in foreground
  --image-name <name>        Pass through to 'image build-and-load'
  --image-tag <tag>          Pass through to 'image build-and-load'
  --novnc-version <ver>      Pass through to 'image build-and-load'
  -h, --help                 Show help
EOF
}

print_step() {
  echo
  echo "==> $*"
}

run_subcommand() {
  local title="$1"
  shift
  print_step "$title"
  "$ENTRYPOINT" "$@"
}

run_subcommand_or_exit() {
  local title="$1"
  local failure_hint="$2"
  shift 2

  if ! run_subcommand "$title" "$@"; then
    echo >&2
    echo "ERROR: 步骤失败: $title" >&2
    echo "ERROR: 因此未继续执行: $failure_hint" >&2
    exit 1
  fi
}

WITH_IMAGES=0
SKIP_DASHBOARD=0
SKIP_PORT_FORWARD=0
PORT_FORWARD_FOREGROUND=0
IMAGE_NAME=""
IMAGE_TAG=""
NOVNC_VERSION=""

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
image_args=(image build-and-load)
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

if [[ "$PORT_FORWARD_FOREGROUND" -eq 1 ]]; then
  dashboard_port_forward_args+=(--foreground)
fi

run_subcommand_or_exit \
  "Bootstrap cluster assets" \
  "cluster install、gpu enable、image build-and-load、dashboard deploy、dashboard port-forward" \
  "${bootstrap_args[@]}"
run_subcommand_or_exit \
  "Install cluster" \
  "gpu enable、image build-and-load、dashboard deploy、dashboard port-forward" \
  cluster install
run_subcommand_or_exit \
  "Enable GPU support" \
  "image build-and-load、dashboard deploy、dashboard port-forward" \
  gpu enable
run_subcommand_or_exit \
  "Build and distribute workspace image" \
  "dashboard deploy、dashboard port-forward" \
  "${image_args[@]}"

if [[ "$SKIP_DASHBOARD" -eq 1 ]]; then
  print_step "Skip dashboard setup"
  echo "已跳过 dashboard deploy 和 port-forward。"
  exit 0
fi

run_subcommand_or_exit \
  "Deploy Kubernetes Dashboard" \
  "dashboard port-forward" \
  dashboard deploy

if [[ "$SKIP_PORT_FORWARD" -eq 1 ]]; then
  print_step "Skip dashboard port-forward"
  echo "Dashboard 已部署，未启动 port-forward。"
  exit 0
fi

run_subcommand_or_exit \
  "Start dashboard port-forward" \
  "无后续步骤" \
  "${dashboard_port_forward_args[@]}"
