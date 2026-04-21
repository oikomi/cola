#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

require_cmd node
require_cmd sshpass
require_cmd ssh
require_cmd scp

TARGET_NODE=""
SKIP_MANIFESTS=0
AUTO_DISCOVERED=0
ROLLOUT_TIMEOUT="300s"
NVIDIA_DEVICE_PLUGIN_SOURCE_IMAGE="nvcr.io/nvidia/k8s-device-plugin:v0.17.0"
NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE="easzlab.io.local:5000/nvidia/k8s-device-plugin:v0.17.0"
NVIDIA_DEVICE_PLUGIN_IMAGE="$NVIDIA_DEVICE_PLUGIN_SOURCE_IMAGE"

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

mirror_nvidia_device_plugin_image() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "WARN: 当前主机未安装 docker，nvidia-device-plugin 将继续使用上游镜像。"
    return 0
  fi

  if ! sudo test -f /etc/docker/daemon.json || \
    ! sudo grep -q 'easzlab\.io\.local:5000' /etc/docker/daemon.json; then
    echo "WARN: 本机 Docker 未将 easzlab.io.local:5000 配置为 insecure registry，跳过本地镜像同步。"
    return 0
  fi

  if docker manifest inspect --insecure "$NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE" >/dev/null 2>&1; then
    NVIDIA_DEVICE_PLUGIN_IMAGE="$NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE"
    return 0
  fi

  local local_amd64_image
  local local_arm64_image
  local image_repo
  local image_tag
  image_tag="${NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE##*:}"
  image_repo="${NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE%:*}"
  local_amd64_image="${image_repo}-amd64:${image_tag}"
  local_arm64_image="${image_repo}-arm64:${image_tag}"

  print_step "同步 NVIDIA device plugin 镜像到本地 registry"
  if docker pull --platform linux/amd64 "$NVIDIA_DEVICE_PLUGIN_SOURCE_IMAGE" && \
    docker tag "$NVIDIA_DEVICE_PLUGIN_SOURCE_IMAGE" "$local_amd64_image" && \
    docker push "$local_amd64_image" && \
    docker pull --platform linux/arm64 "$NVIDIA_DEVICE_PLUGIN_SOURCE_IMAGE" && \
    docker tag "$NVIDIA_DEVICE_PLUGIN_SOURCE_IMAGE" "$local_arm64_image" && \
    docker push "$local_arm64_image" && \
    docker manifest rm "$NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE" >/dev/null 2>&1 || true
  then
    if docker manifest create --insecure "$NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE" "$local_amd64_image" "$local_arm64_image" && \
      docker manifest annotate "$NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE" "$local_amd64_image" --os linux --arch amd64 && \
      docker manifest annotate "$NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE" "$local_arm64_image" --os linux --arch arm64 && \
      docker manifest push --insecure --purge "$NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE"; then
      NVIDIA_DEVICE_PLUGIN_IMAGE="$NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE"
      return 0
    fi
  fi

  if docker manifest inspect --insecure "$NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE" >/dev/null 2>&1; then
    NVIDIA_DEVICE_PLUGIN_IMAGE="$NVIDIA_DEVICE_PLUGIN_LOCAL_IMAGE"
    return 0
  fi

  echo "WARN: 无法将 NVIDIA device plugin 镜像同步到本地 registry，回退到上游镜像。"
  return 0
}

prepull_nvidia_device_plugin_image() {
  local node_name

  for node_name in "${GPU_NODES[@]}"; do
    print_step "在节点 $node_name 上预拉 NVIDIA device plugin 镜像"
    if ! remote_pull_k8s_image \
      "$node_name" \
      "$NVIDIA_DEVICE_PLUGIN_IMAGE" \
      "linux/$(node_arch "$node_name")"
    then
      echo "WARN: 节点 $node_name 预拉镜像失败，继续依赖 kubelet 自行拉取。"
    fi
  done
}

apply_nvidia_device_plugin_manifest() {
  local rendered_manifest
  rendered_manifest="$(mktemp)"

  sed \
    "s#${NVIDIA_DEVICE_PLUGIN_SOURCE_IMAGE}#${NVIDIA_DEVICE_PLUGIN_IMAGE}#g" \
    "$ROOT_DIR/manifests/gpu/nvidia-device-plugin.yaml" > "$rendered_manifest"

  kubectl_apply_file "$rendered_manifest"
  rm -f "$rendered_manifest"
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
python3 - <<'PY'
from pathlib import Path

config = Path("/etc/containerd/config.toml")
if not config.exists():
    raise SystemExit(0)

text = config.read_text()
target = "imports = [\"/etc/containerd/conf.d/*.toml\"]"

if target in text:
    raise SystemExit(0)

lines = text.splitlines()
for index, line in enumerate(lines):
    if line.startswith("imports ="):
        lines[index] = target
        break
else:
    insert_at = 1 if lines and lines[0].startswith("version =") else 0
    lines.insert(insert_at, target)

config.write_text("\n".join(lines) + "\n")
PY
systemctl restart containerd
'
done

ensure_mixed_arch_cluster_components_ready 600

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
  mirror_nvidia_device_plugin_image
  prepull_nvidia_device_plugin_image
  print_step "应用 GPU 相关 Kubernetes 清单"
  kubectl_apply_file "$ROOT_DIR/manifests/base/namespace.yaml"
  kubectl_apply_file "$ROOT_DIR/manifests/gpu/nvidia-runtimeclass.yaml"
  apply_nvidia_device_plugin_manifest
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

echo "GPU 能力已启用。下一步执行: ./bin/cluster.sh image build-and-load"
