#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_BUILD_SCRIPT="$REPO_ROOT/infra/k8s/bin/internal/image-build-and-load.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/workspace-image.sh <command> [options]

Commands:
  build-and-load    Build the remote workspace image and distribute it to cluster nodes

Examples:
  ./scripts/workspace-image.sh build-and-load
  ./scripts/workspace-image.sh build-and-load --image-tag dev
  ./scripts/workspace-image.sh build-and-load --novnc-version v1.6.0
EOF
}

COMMAND="${1:-}"
case "$COMMAND" in
  build-and-load)
    shift
    exec "$IMAGE_BUILD_SCRIPT" "$@"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "未知命令: $COMMAND" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
