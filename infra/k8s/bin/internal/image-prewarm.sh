#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

DRY_RUN=0
TARGET_ARCH=""
TARGET_NODES_CSV=""
GPU_ONLY=0

usage() {
  cat <<'EOF'
Usage: ./bin/cluster.sh image prewarm [options] <image-ref>...

Pre-pull images on the local Docker runtime and import them into Kubernetes
nodes' containerd k8s.io namespace. This is useful when nodes cannot pull
from Docker Hub directly because of registry DNS/TLS issues.

Options:
  --nodes <names>     Comma-separated target node names, default all configured nodes
  --arch <arch>       Limit target nodes to one architecture, e.g. amd64 or arm64
  --gpu-only          Target only nodes with the gpu role
  --dry-run           Print planned image/node/platform work without pulling or importing
  -h, --help          Show help

Examples:
  ./bin/cluster.sh image prewarm --dry-run vllm/vllm-openai:latest
  ./bin/cluster.sh image prewarm --gpu-only vllm/vllm-openai:latest amazon/aws-cli:2.17.50
EOF
}

trim_csv_spaces() {
  printf '%s\n' "$1" | tr -d '[:space:]'
}

node_has_gpu_role() {
  local node_name="$1"
  local roles
  roles="$(cluster_query nodeRoles "$node_name")"
  [[ ",$roles," == *",gpu,"* ]]
}

emit_configured_target_nodes() {
  local node_name

  if [[ -n "$TARGET_NODES_CSV" ]]; then
    IFS=',' read -r -a requested_nodes <<<"$TARGET_NODES_CSV"
    for node_name in "${requested_nodes[@]}"; do
      [[ -n "$node_name" ]] || continue
      cluster_query nodeIp "$node_name" >/dev/null
      printf '%s\n' "$node_name"
    done
    return 0
  fi

  cluster_query nodeNames
}

emit_target_nodes() {
  local node_name
  local node_arch_value
  local seen_nodes=$'\n'

  while IFS= read -r node_name; do
    [[ -n "$node_name" ]] || continue
    if [[ "$seen_nodes" == *$'\n'"$node_name"$'\n'* ]]; then
      continue
    fi
    seen_nodes+="$node_name"$'\n'

    node_arch_value="$(cluster_query nodeArch "$node_name")"
    if [[ -n "$TARGET_ARCH" && "$node_arch_value" != "$TARGET_ARCH" ]]; then
      continue
    fi
    if [[ "$GPU_ONLY" -eq 1 ]] && ! node_has_gpu_role "$node_name"; then
      continue
    fi

    printf '%s\n' "$node_name"
  done < <(emit_configured_target_nodes)
}

emit_unique_arches_for_nodes() {
  local node_name
  local node_arch_value
  local seen_arches=$'\n'

  for node_name in "$@"; do
    node_arch_value="$(cluster_query nodeArch "$node_name")"
    if [[ "$seen_arches" == *$'\n'"$node_arch_value"$'\n'* ]]; then
      continue
    fi
    seen_arches+="$node_arch_value"$'\n'
    printf '%s\n' "$node_arch_value"
  done
}

emit_nodes_for_arch() {
  local arch="$1"
  shift

  local node_name
  for node_name in "$@"; do
    if [[ "$(cluster_query nodeArch "$node_name")" == "$arch" ]]; then
      printf '%s\n' "$node_name"
    fi
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --nodes)
      TARGET_NODES_CSV="$(trim_csv_spaces "${2:-}")"
      [[ -n "$TARGET_NODES_CSV" ]] || die "--nodes 不能为空"
      shift 2
      ;;
    --arch)
      TARGET_ARCH="$(normalize_arch_sh "${2:-}")"
      [[ -n "$TARGET_ARCH" ]] || die "--arch 不能为空"
      shift 2
      ;;
    --gpu-only)
      GPU_ONLY=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    --*)
      die "未知参数: $1"
      ;;
    *)
      break
      ;;
  esac
done

[[ $# -gt 0 ]] || {
  usage >&2
  exit 1
}

IMAGES=("$@")
TARGET_NODES=()
while IFS= read -r node_name; do
  [[ -n "$node_name" ]] && TARGET_NODES+=("$node_name")
done < <(emit_target_nodes)

[[ "${#TARGET_NODES[@]}" -gt 0 ]] || die "没有匹配的目标节点。"

if [[ "$DRY_RUN" -eq 1 ]]; then
  print_step "Dry-run: 镜像预热计划"
  printf '目标节点: %s\n' "${TARGET_NODES[*]}"
else
  require_cmd docker
  require_any_cmd sshpass expect
  require_cmd scp
  require_cmd ssh
fi

ARCHES=()
while IFS= read -r arch; do
  [[ -n "$arch" ]] && ARCHES+=("$arch")
done < <(emit_unique_arches_for_nodes "${TARGET_NODES[@]}")

for arch in "${ARCHES[@]}"; do
  NODES_FOR_ARCH=()
  while IFS= read -r node_name; do
    [[ -n "$node_name" ]] && NODES_FOR_ARCH+=("$node_name")
  done < <(emit_nodes_for_arch "$arch" "${TARGET_NODES[@]}")

  [[ "${#NODES_FOR_ARCH[@]}" -gt 0 ]] || continue

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '平台: linux/%s\n' "$arch"
    printf '节点: %s\n' "${NODES_FOR_ARCH[*]}"
    printf '镜像:\n'
    for image_ref in "${IMAGES[@]}"; do
      printf '  - %s -> %s\n' "$image_ref" "$(canonical_k8s_image_ref "$image_ref")"
    done
    continue
  fi

  print_step "预热 ${#IMAGES[@]} 个镜像到 ${#NODES_FOR_ARCH[@]} 个 arch=$arch 节点"
  cache_and_distribute_image_archives_to_nodes \
    "linux/$arch" \
    "${NODES_FOR_ARCH[@]}" \
    -- \
    "${IMAGES[@]}"
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry-run 完成，未拉取或导入镜像。"
else
  echo "镜像预热完成。"
fi
