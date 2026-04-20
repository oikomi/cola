#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo
require_cmd tar

OUTPUT_PATH="$RUNTIME_DIR/secondary-arch/$(cluster_name)-kubeasz-seed.tar.gz"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_PATH="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./bin/70-export-secondary-arch-bundle.sh [--output /path/to/bundle.tar.gz]

Create a kubeasz seed bundle for a secondary-architecture deployment host.
The bundle contains /etc/kubeasz except arch-specific bin/down payloads.
EOF
      exit 0
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

cluster_exists_in_kubeasz || die "未找到 /etc/kubeasz/clusters/$(cluster_name)，请先完成主架构集群初始化。"

mkdir -p "$(dirname "$OUTPUT_PATH")"

print_step "导出 secondary-arch kubeasz bundle"
sudo tar \
  --exclude="/etc/kubeasz/bin" \
  --exclude="/etc/kubeasz/down" \
  -czf "$OUTPUT_PATH" \
  -C / etc/kubeasz

echo "Bundle created at: $OUTPUT_PATH"
echo "把这个文件复制到次级架构部署机后，可执行:"
echo "./bin/71-import-secondary-arch-bundle.sh --bundle $OUTPUT_PATH"

