#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

require_cmd sudo
require_cmd tar
require_cmd node

KUBE_VERSION="$(kubernetes_version)"
BUNDLE_PATH=""
ASSET_ARCHIVE_PATH=""
NODE_NAME=""
NODE_IP=""
SSH_USER=""
SSH_PASSWORD=""
SSH_PORT="22"
ROLES=""
ARCH=""

download_with_fallback() {
  local target_file="$1"
  shift
  local url

  for url in "$@"; do
    echo "尝试下载: $url"
    if command -v curl >/dev/null 2>&1; then
      if curl -fL --retry 3 -o "${target_file}.part" "$url"; then
        mv -f "${target_file}.part" "$target_file"
        return 0
      fi
    else
      if wget -O "${target_file}.part" "$url"; then
        mv -f "${target_file}.part" "$target_file"
        return 0
      fi
    fi
  done

  rm -f "${target_file}.part"
  return 1
}

ensure_secondary_arch_host_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get -o DPkg::Lock::Timeout=300 update
    sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y \
      python3 python3-venv python3-pip curl wget ca-certificates gnupg \
      sshpass containerd runc nginx libnginx-mod-stream
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y \
      python3 python3-pip curl wget ca-certificates sshpass \
      containerd runc nginx
    return 0
  fi

  if command -v yum >/dev/null 2>&1; then
    sudo yum install -y \
      python3 python3-pip curl wget ca-certificates sshpass \
      containerd runc nginx
    return 0
  fi

  die "当前系统缺少受支持的包管理器，无法自动准备 secondary-arch 主机依赖。"
}

enable_system_nginx_stream_module() {
  local kube_lb_template
  kube_lb_template="/etc/kubeasz/roles/kube-lb/templates/kube-lb.conf.j2"

  if [[ ! -f /usr/lib/nginx/modules/ngx_stream_module.so ]]; then
    return 0
  fi

  if [[ ! -f "$kube_lb_template" ]]; then
    return 0
  fi

  if sudo grep -q '^load_module /usr/lib/nginx/modules/ngx_stream_module\.so;$' "$kube_lb_template"; then
    return 0
  fi

  sudo python3 - "$kube_lb_template" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
directive = "load_module /usr/lib/nginx/modules/ngx_stream_module.so;\n"
if not text.startswith(directive):
    path.write_text(directive + text)
PY
}

sync_root_kubeconfig_from_cluster_assets() {
  local source_kubeconfig
  local kubectl_bin
  local tmp_kubeconfig

  source_kubeconfig="$(cluster_kubeconfig_path)"
  [[ -f "$source_kubeconfig" ]] || die "找不到 cluster kubeconfig: $source_kubeconfig"

  kubectl_bin="$(kubectl_bin_path)"
  tmp_kubeconfig="$(mktemp)"

  sudo env KUBECONFIG="$source_kubeconfig" "$kubectl_bin" config view --raw --flatten > "$tmp_kubeconfig"
  sudo install -d -m 0700 /root/.kube
  sudo install -m 0600 "$tmp_kubeconfig" /root/.kube/config
  rm -f "$tmp_kubeconfig"
}

prepare_arm64_secondary_arch_runtime() {
  local workdir
  local crictl_ver
  local cni_ver="1.8.0"
  local cfssl_ver="1.6.5"
  local calico_ver
  local nginx_bin

  ensure_secondary_arch_host_packages
  patch_kubeasz_compatibility
  patch_kubeasz_registry_mirrors
  enable_system_nginx_stream_module

  sudo sed -i \
    "s#^SANDBOX_IMAGE:.*#SANDBOX_IMAGE: \"$(sandbox_image)\"#g" \
    "$(cluster_kubeasz_config_path)"

  workdir="$(mktemp -d)"
  trap "rm -rf '$workdir'" RETURN

  crictl_ver="v$(printf '%s' "${KUBE_VERSION#v}" | cut -d. -f1-2).0"
  calico_ver="$(kubeasz_config_value calico_ver)"
  [[ -n "$calico_ver" ]] || calico_ver="v3.28.4"

  if [[ -n "$ASSET_ARCHIVE_PATH" ]]; then
    [[ -f "$ASSET_ARCHIVE_PATH" ]] || die "找不到预下载 arm64 资产归档: $ASSET_ARCHIVE_PATH"
    print_step "使用预下载 arm64 资产归档"
    tar -xzf "$ASSET_ARCHIVE_PATH" -C "$workdir"
  else
    print_step "在 arm64 secondary-arch 主机上下载 Kubernetes 二进制"
    download_with_fallback \
      "$workdir/kubelet" \
      "https://dl.k8s.io/release/${KUBE_VERSION}/bin/linux/arm64/kubelet" \
      || die "下载 kubelet arm64 失败"
    download_with_fallback \
      "$workdir/kubectl" \
      "https://dl.k8s.io/release/${KUBE_VERSION}/bin/linux/arm64/kubectl" \
      || die "下载 kubectl arm64 失败"
    download_with_fallback \
      "$workdir/kube-proxy" \
      "https://dl.k8s.io/release/${KUBE_VERSION}/bin/linux/arm64/kube-proxy" \
      || die "下载 kube-proxy arm64 失败"
    download_with_fallback \
      "$workdir/crictl.tar.gz" \
      "https://github.com/kubernetes-sigs/cri-tools/releases/download/${crictl_ver}/crictl-${crictl_ver}-linux-arm64.tar.gz" \
      || die "下载 crictl arm64 失败"
    tar -xzf "$workdir/crictl.tar.gz" -C "$workdir"
    download_with_fallback \
      "$workdir/cni.tgz" \
      "https://github.com/containernetworking/plugins/releases/download/v${cni_ver}/cni-plugins-linux-arm64-v${cni_ver}.tgz" \
      "https://github.com/containernetworking/plugins/releases/download/${cni_ver}/cni-plugins-linux-arm64-${cni_ver}.tgz" \
      || die "下载 CNI plugins arm64 失败"
    mkdir -p "$workdir/cni-bin"
    tar -xzf "$workdir/cni.tgz" -C "$workdir/cni-bin"
    download_with_fallback \
      "$workdir/cfssl" \
      "https://github.com/cloudflare/cfssl/releases/download/v${cfssl_ver}/cfssl_${cfssl_ver}_linux_arm64" \
      || die "下载 cfssl arm64 失败"
    download_with_fallback \
      "$workdir/cfssljson" \
      "https://github.com/cloudflare/cfssl/releases/download/v${cfssl_ver}/cfssljson_${cfssl_ver}_linux_arm64" \
      || die "下载 cfssljson arm64 失败"
    download_with_fallback \
      "$workdir/calicoctl" \
      "https://github.com/projectcalico/calico/releases/download/${calico_ver}/calicoctl-linux-arm64" \
      || die "下载 calicoctl arm64 失败"
  fi

  [[ -f "$workdir/kubelet" ]] || die "arm64 资产缺少 kubelet"
  [[ -f "$workdir/kubectl" ]] || die "arm64 资产缺少 kubectl"
  [[ -f "$workdir/kube-proxy" ]] || die "arm64 资产缺少 kube-proxy"
  [[ -f "$workdir/crictl" ]] || die "arm64 资产缺少 crictl"
  [[ -f "$workdir/cfssl" ]] || die "arm64 资产缺少 cfssl"
  [[ -f "$workdir/cfssljson" ]] || die "arm64 资产缺少 cfssljson"
  [[ -f "$workdir/calicoctl" ]] || die "arm64 资产缺少 calicoctl"
  [[ -d "$workdir/cni-bin" ]] || die "arm64 资产缺少 cni-bin 目录"

  sudo mkdir -p \
    "$KUBEASZ_BASE_DIR/bin" \
    "$KUBEASZ_BASE_DIR/bin/cni-bin" \
    "$KUBEASZ_BASE_DIR/bin/containerd-bin"

  sudo install -m 0755 "$workdir/kubelet" "$KUBEASZ_BASE_DIR/bin/kubelet"
  sudo install -m 0755 "$workdir/kubectl" "$KUBEASZ_BASE_DIR/bin/kubectl"
  sudo install -m 0755 "$workdir/kube-proxy" "$KUBEASZ_BASE_DIR/bin/kube-proxy"
  sudo install -m 0755 "$workdir/crictl" "$KUBEASZ_BASE_DIR/bin/crictl"
  sudo install -m 0755 "$workdir/cfssl" "$KUBEASZ_BASE_DIR/bin/cfssl"
  sudo install -m 0755 "$workdir/cfssljson" "$KUBEASZ_BASE_DIR/bin/cfssljson"
  sudo install -m 0755 "$workdir/calicoctl" "$KUBEASZ_BASE_DIR/bin/calicoctl"
  find "$workdir/cni-bin" -maxdepth 1 -type f -exec sudo install -m 0755 {} "$KUBEASZ_BASE_DIR/bin/cni-bin/" \;

  for binary_name in containerd ctr runc containerd-shim-runc-v2; do
    command -v "$binary_name" >/dev/null 2>&1 || die "secondary-arch 主机缺少二进制: $binary_name"
    sudo install -m 0755 "$(command -v "$binary_name")" "$KUBEASZ_BASE_DIR/bin/containerd-bin/$binary_name"
  done

  nginx_bin="$(command -v nginx || true)"
  if [[ -z "$nginx_bin" && -x /usr/sbin/nginx ]]; then
    nginx_bin="/usr/sbin/nginx"
  fi
  [[ -n "$nginx_bin" ]] || die "secondary-arch 主机缺少 nginx，可执行 kube-lb 二进制无法准备。"
  sudo install -m 0755 "$nginx_bin" "$KUBEASZ_BASE_DIR/bin/nginx"
}

prepare_secondary_arch_runtime() {
  print_step "在当前架构上补齐 kubeasz 二进制与镜像缓存"
  if [[ "$(local_arch)" == "arm64" ]]; then
    prepare_arm64_secondary_arch_runtime
  else
    "$ROOT_DIR/bin/cluster.sh" cluster bootstrap
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle)
      BUNDLE_PATH="$2"
      shift 2
      ;;
    --asset-archive)
      ASSET_ARCHIVE_PATH="$2"
      shift 2
      ;;
    --name)
      NODE_NAME="$2"
      shift 2
      ;;
    --ip)
      NODE_IP="$2"
      shift 2
      ;;
    --ssh-user)
      SSH_USER="$2"
      shift 2
      ;;
    --ssh-password)
      SSH_PASSWORD="$2"
      shift 2
      ;;
    --ssh-port)
      SSH_PORT="$2"
      shift 2
      ;;
    --roles)
      ROLES="$2"
      shift 2
      ;;
    --arch)
      ARCH="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./bin/cluster.sh secondary-arch import --bundle /path/to/seed.tar.gz [node args]

Restore the kubeasz seed bundle on a secondary-architecture deployment host,
prepare local-arch binaries and runtime prerequisites, and optionally add
the listed node immediately using 'cluster add-node'.

Optional:
  --asset-archive /path/to/assets.tar.gz
      Use a pre-fetched arm64 asset archive prepared on another host instead
      of downloading Kubernetes/cni/cfssl artifacts again on this machine.
EOF
      exit 0
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

[[ -n "$BUNDLE_PATH" ]] || die "--bundle 必填"
[[ -f "$BUNDLE_PATH" ]] || die "找不到 bundle: $BUNDLE_PATH"

print_step "导入 secondary-arch kubeasz bundle"
sudo tar -xzf "$BUNDLE_PATH" -C /

prepare_secondary_arch_runtime
print_step "刷新当前节点 root kubeconfig"
sync_root_kubeconfig_from_cluster_assets

if [[ -n "$NODE_NAME" || -n "$NODE_IP" || -n "$SSH_USER" || -n "$SSH_PASSWORD" || -n "$ROLES" ]]; then
  for value_name in NODE_NAME NODE_IP SSH_USER SSH_PASSWORD ROLES; do
    [[ -n "${!value_name}" ]] || die "如果要自动 add-node，必须同时提供 name/ip/ssh-user/ssh-password/roles"
  done

  if [[ -z "$ARCH" ]]; then
    ARCH="$(local_arch)"
  fi

  print_step "在次级架构部署机上执行 add-node"
  "$ROOT_DIR/bin/cluster.sh" cluster add-node \
    --name "$NODE_NAME" \
    --ip "$NODE_IP" \
    --ssh-user "$SSH_USER" \
    --ssh-password "$SSH_PASSWORD" \
    --ssh-port "$SSH_PORT" \
    --roles "$ROLES" \
    --arch "$ARCH"
fi

echo "secondary-arch 部署机已准备完成。"
