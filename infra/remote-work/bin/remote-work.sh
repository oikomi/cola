#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "WARN: ./bin/remote-work.sh 已重命名为 ./bin/cluster.sh" >&2
exec "$SCRIPT_DIR/cluster.sh" "$@"
