#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage: ./bin/cluster.sh <group> <action> [options]

Groups and actions:
  cluster bootstrap        Prepare kubeasz assets and render inventory
  cluster install          Install the current cluster
  cluster add-node         Add a worker or worker,gpu node
  cluster clean            Destroy the cluster and clean runtime state

  gpu enable               Enable NVIDIA runtime and device plugin
  image build-and-load     Build and load the workspace image

  secondary-arch export    Export a kubeasz bundle for another architecture
  secondary-arch import    Import the bundle and optionally add a node

  stack up                 Run the default infra bring-up flow

  dashboard deploy         Install Kubernetes Dashboard
  dashboard token          Print the Dashboard admin token
  dashboard port-forward   Start or control Dashboard port-forward
  dashboard prepull-images Pre-pull Dashboard images to cluster nodes

Examples:
  ./bin/cluster.sh cluster bootstrap
  ./bin/cluster.sh cluster install
  ./bin/cluster.sh gpu enable
  ./bin/cluster.sh image build-and-load
  ./bin/cluster.sh stack up
  ./bin/cluster.sh dashboard port-forward --status
EOF
}

[[ $# -ge 1 ]] || {
  usage
  exit 1
}

case "${1:-}" in
  -h|--help|help)
    usage
    exit 0
    ;;
esac

GROUP="${1:-}"
ACTION="${2:-}"

[[ -n "$GROUP" && -n "$ACTION" ]] || {
  usage
  exit 1
}

shift 2

case "$GROUP:$ACTION" in
  cluster:bootstrap)
    exec "$SCRIPT_DIR/internal/cluster-bootstrap.sh" "$@"
    ;;
  cluster:install)
    exec "$SCRIPT_DIR/internal/cluster-install.sh" "$@"
    ;;
  cluster:add-node)
    exec "$SCRIPT_DIR/internal/cluster-add-node.sh" "$@"
    ;;
  cluster:clean)
    exec "$SCRIPT_DIR/internal/cluster-clean.sh" "$@"
    ;;
  gpu:enable)
    exec "$SCRIPT_DIR/internal/gpu-enable.sh" "$@"
    ;;
  image:build-and-load)
    exec "$SCRIPT_DIR/internal/image-build-and-load.sh" "$@"
    ;;
  workspace:create)
    echo "WARN: workspace 生命周期已迁移到 ./scripts/workspace.sh" >&2
    exec "$REPO_ROOT/scripts/workspace.sh" create "$@"
    ;;
  workspace:delete)
    echo "WARN: workspace 生命周期已迁移到 ./scripts/workspace.sh" >&2
    exec "$REPO_ROOT/scripts/workspace.sh" delete "$@"
    ;;
  secondary-arch:export)
    exec "$SCRIPT_DIR/internal/secondary-arch-export.sh" "$@"
    ;;
  secondary-arch:import)
    exec "$SCRIPT_DIR/internal/secondary-arch-import.sh" "$@"
    ;;
  stack:up)
    exec "$SCRIPT_DIR/internal/stack-up.sh" "$@"
    ;;
  dashboard:deploy)
    exec "$SCRIPT_DIR/internal/dashboard-deploy.sh" "$@"
    ;;
  dashboard:token)
    exec "$SCRIPT_DIR/internal/dashboard-token.sh" "$@"
    ;;
  dashboard:port-forward)
    exec "$SCRIPT_DIR/internal/dashboard-port-forward.sh" "$@"
    ;;
  dashboard:prepull-images)
    exec "$SCRIPT_DIR/internal/dashboard-prepull-images.sh" "$@"
    ;;
  *)
    echo "未知命令: $GROUP $ACTION" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
