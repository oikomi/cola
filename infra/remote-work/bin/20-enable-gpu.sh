#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd node
require_cmd sshpass
require_cmd ssh
require_cmd scp

TARGET_NODE=""
SKIP_MANIFESTS=0
AUTO_DISCOVERED=0
ROLLOUT_TIMEOUT="300s"

print_gpu_diagnostics() {
  echo
  echo "--- nvidia-device-plugin pods ---"
  kubectl_remote "get pods -n kube-system -l app.kubernetes.io/name=nvidia-device-plugin -o wide || true"
  echo
  echo "--- nvidia-device-plugin daemonset ---"
  kubectl_remote "describe ds nvidia-device-plugin-daemonset -n kube-system || true"
  echo
  echo "--- recent kube-system events ---"
  kubectl_remote "get events -n kube-system --sort-by=.lastTimestamp | tail -n 50 || true"
  echo
  echo "--- nvidia-device-plugin pod describe ---"
  PODS="$(kubectl_remote "get pods -n kube-system -l app.kubernetes.io/name=nvidia-device-plugin -o name || true")"
  if [[ -n "$PODS" ]]; then
    while IFS= read -r pod_name; do
      [[ -n "$pod_name" ]] || continue
      echo "### $pod_name ###"
      kubectl_remote "describe -n kube-system $pod_name || true"
      echo
    done <<<"$PODS"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node)
      TARGET_NODE="$2"
      shift 2
      ;;
    --skip-manifests)
      SKIP_MANIFESTS=1
      shift
      ;;
    --rollout-timeout)
      ROLLOUT_TIMEOUT="$2"
      shift 2
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

mapfile -t GPU_NODES < <(
  if [[ -n "$TARGET_NODE" ]]; then
    printf '%s\n' "$TARGET_NODE"
  else
    cluster_query gpuNodeNames
  fi
)

if [[ "${#GPU_NODES[@]}" -eq 0 ]]; then
  print_step "cluster/nodes.json 未显式标记 gpu 角色，开始自动探测"
  mapfile -t ALL_NODES < <(cluster_query nodeNames)
  for node_name in "${ALL_NODES[@]}"; do
    if remote_ssh "$node_name" "command -v nvidia-smi >/dev/null 2>&1"; then
      GPU_NODES+=("$node_name")
    fi
  done
  AUTO_DISCOVERED=1
fi

if [[ "${#GPU_NODES[@]}" -eq 0 ]]; then
  echo "没有检测到可用 GPU 节点，跳过。"
  exit 0
fi

for node_name in "${GPU_NODES[@]}"; do
  print_step "在节点 $node_name 上安装 NVIDIA container runtime"

  remote_ssh "$node_name" "command -v nvidia-smi >/dev/null 2>&1" || \
    die "节点 $node_name 上未检测到 nvidia-smi，请先安装 NVIDIA 驱动。"

  remote_sudo_ssh "$node_name" '
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "curl 未安装，无法继续。" >&2
  exit 1
fi

source /etc/os-release

if [[ "$ID" == "ubuntu" || "$ID" == "debian" ]]; then
  apt-get update
  apt-get install -y curl gnupg ca-certificates
  rm -f /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
    gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
    sed '"'"'s#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#'"'"' | \
    tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
  apt-get update
  apt-get install -y nvidia-container-toolkit
elif [[ "${ID_LIKE:-}" == *"rhel"* || "$ID" == "centos" || "$ID" == "rocky" || "$ID" == "almalinux" ]]; then
  if command -v dnf >/dev/null 2>&1; then
    PKG_MGR="dnf"
  else
    PKG_MGR="yum"
  fi
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo | \
    tee /etc/yum.repos.d/nvidia-container-toolkit.repo >/dev/null
  "$PKG_MGR" install -y nvidia-container-toolkit
else
  echo "当前系统 $ID 不在此脚本的自动安装覆盖范围内。" >&2
  exit 1
fi

nvidia-ctk runtime configure --runtime=containerd
systemctl restart containerd
'
done

print_step "给节点打标签"
mapfile -t ALL_NODES < <(cluster_query nodeNames)
for node_name in "${ALL_NODES[@]}"; do
  if kubectl_remote "get node $node_name >/dev/null 2>&1"; then
    kubectl_remote "label node $node_name $(workspace_label_key)=true --overwrite"
    if printf '%s\n' "${GPU_NODES[@]}" | grep -qx "$node_name"; then
      kubectl_remote "label node $node_name $(gpu_label_key)=true --overwrite"
    fi
  else
    echo "节点 $node_name 还未加入 Kubernetes，先跳过标签。"
  fi
done

if [[ "$SKIP_MANIFESTS" -eq 0 ]]; then
  print_step "应用 GPU 相关 Kubernetes 清单"
  kubectl_apply_file "$ROOT_DIR/manifests/base/namespace.yaml"
  kubectl_apply_file "$ROOT_DIR/manifests/gpu/nvidia-runtimeclass.yaml"
  kubectl_apply_file "$ROOT_DIR/manifests/gpu/nvidia-device-plugin.yaml"
  if ! kubectl_remote "rollout status daemonset/nvidia-device-plugin-daemonset -n kube-system --timeout=$ROLLOUT_TIMEOUT"; then
    print_step "nvidia-device-plugin 启动超时，输出诊断信息"
    print_gpu_diagnostics
    die "nvidia-device-plugin-daemonset 在 $ROLLOUT_TIMEOUT 内未就绪。"
  fi
fi

if [[ "$AUTO_DISCOVERED" -eq 1 ]]; then
  echo
  echo "已根据 nvidia-smi 自动识别 GPU 节点：$(printf '%s ' "${GPU_NODES[@]}")"
  echo "建议后续把这些节点在 cluster/nodes.json 中补上 gpu 角色。"
fi

echo "GPU 能力已启用。下一步执行: ./bin/30-build-and-load-image.sh"
