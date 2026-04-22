#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

require_cmd node
require_cmd sudo
require_cmd ssh
require_cmd sshpass
require_cmd tar
ensure_runtime_dirs

cluster_exists_in_kubeasz || die "未找到 /etc/kubeasz/clusters/$(cluster_name)，请先完成主架构集群初始化。"
KUBE_VERSION="$(kubernetes_version)"

BUNDLE_PATH="$RUNTIME_DIR/secondary-arch/$(cluster_name)-kubeasz-seed.tar.gz"
REPO_ARCHIVE_PATH=""
ASSET_ARCHIVE_PATH=""
SECONDARY_ARCH_CANDIDATES=()

cleanup() {
  if [[ -n "$REPO_ARCHIVE_PATH" && -f "$REPO_ARCHIVE_PATH" ]]; then
    rm -f "$REPO_ARCHIVE_PATH"
  fi
}

trap cleanup EXIT

build_secondary_arch_candidate_list() {
  local local_arch_norm
  local observed_arch
  local node_name

  local_arch_norm="$(normalize_arch_sh "$(local_arch)")"
  mapfile -t ALL_NODES < <(cluster_query nodeNames)

  for node_name in "${ALL_NODES[@]}"; do
    observed_arch="$(probe_remote_node_arch "$node_name")"
    if [[ "$observed_arch" == "$local_arch_norm" ]]; then
      continue
    fi

    if node_has_role "$node_name" master || node_has_role "$node_name" etcd; then
      echo "WARN: 异构节点 $node_name 包含 master/etcd 角色，当前自动接力仅支持 worker / worker,gpu，已跳过。"
      continue
    fi

    if ! node_has_role "$node_name" worker; then
      echo "WARN: 异构节点 $node_name 不包含 worker 角色，已跳过。"
      continue
    fi

    if kubectl_remote "get node $node_name >/dev/null 2>&1"; then
      echo "skip:    $node_name 已在集群中，跳过 secondary-arch 自动接力。"
      continue
    fi

    SECONDARY_ARCH_CANDIDATES+=("$node_name")
  done
}

export_secondary_arch_bundle() {
  mkdir -p "$(dirname "$BUNDLE_PATH")"

  print_step "导出 secondary-arch kubeasz bundle"
  sudo tar \
    --exclude="etc/kubeasz/bin" \
    --exclude="etc/kubeasz/bin/*" \
    --exclude="etc/kubeasz/down" \
    --exclude="etc/kubeasz/down/*" \
    -czf "$BUNDLE_PATH" \
    -C / etc/kubeasz
}

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

prepare_local_arm64_asset_archive() {
  local workdir
  local crictl_ver
  local cni_ver="1.8.0"
  local cfssl_ver="1.6.5"
  local calico_ver
  local calico_tag

  workdir="$(mktemp -d)"
  crictl_ver="v$(printf '%s' "${KUBE_VERSION#v}" | cut -d. -f1-2).0"
  calico_ver="$(kubeasz_config_value calico_ver)"
  [[ -n "$calico_ver" ]] || calico_ver="v3.28.4"
  calico_tag="${calico_ver//\//-}"
  ASSET_ARCHIVE_PATH="$RUNTIME_DIR/secondary-arch/arm64-assets-$(cluster_name)-${KUBE_VERSION}-${calico_tag}.tar.gz"

  if [[ -f "$ASSET_ARCHIVE_PATH" ]]; then
    rm -rf "$workdir"
    return 0
  fi

  print_step "在控制机预下载 arm64 secondary-arch 资产"
  download_with_fallback \
    "$workdir/kubelet" \
    "https://dl.k8s.io/release/${KUBE_VERSION}/bin/linux/arm64/kubelet" \
    || die "控制机下载 kubelet arm64 失败"
  download_with_fallback \
    "$workdir/kubectl" \
    "https://dl.k8s.io/release/${KUBE_VERSION}/bin/linux/arm64/kubectl" \
    || die "控制机下载 kubectl arm64 失败"
  download_with_fallback \
    "$workdir/kube-proxy" \
    "https://dl.k8s.io/release/${KUBE_VERSION}/bin/linux/arm64/kube-proxy" \
    || die "控制机下载 kube-proxy arm64 失败"
  download_with_fallback \
    "$workdir/crictl.tar.gz" \
    "https://github.com/kubernetes-sigs/cri-tools/releases/download/${crictl_ver}/crictl-${crictl_ver}-linux-arm64.tar.gz" \
    || die "控制机下载 crictl arm64 失败"
  tar -xzf "$workdir/crictl.tar.gz" -C "$workdir"
  download_with_fallback \
    "$workdir/cni.tgz" \
    "https://github.com/containernetworking/plugins/releases/download/v${cni_ver}/cni-plugins-linux-arm64-v${cni_ver}.tgz" \
    "https://github.com/containernetworking/plugins/releases/download/${cni_ver}/cni-plugins-linux-arm64-${cni_ver}.tgz" \
    || die "控制机下载 CNI plugins arm64 失败"
  mkdir -p "$workdir/cni-bin"
  tar -xzf "$workdir/cni.tgz" -C "$workdir/cni-bin"
  download_with_fallback \
    "$workdir/cfssl" \
    "https://github.com/cloudflare/cfssl/releases/download/v${cfssl_ver}/cfssl_${cfssl_ver}_linux_arm64" \
    || die "控制机下载 cfssl arm64 失败"
  download_with_fallback \
    "$workdir/cfssljson" \
    "https://github.com/cloudflare/cfssl/releases/download/v${cfssl_ver}/cfssljson_${cfssl_ver}_linux_arm64" \
    || die "控制机下载 cfssljson arm64 失败"
  download_with_fallback \
    "$workdir/calicoctl" \
    "https://github.com/projectcalico/calico/releases/download/${calico_ver}/calicoctl-linux-arm64" \
    || die "控制机下载 calicoctl arm64 失败"

  tar -czf "$ASSET_ARCHIVE_PATH" -C "$workdir" .
  rm -rf "$workdir"
}

build_repo_archive() {
  local repo_parent
  local repo_name

  repo_parent="$(dirname "$ROOT_DIR")"
  repo_name="$(basename "$ROOT_DIR")"
  REPO_ARCHIVE_PATH="$(mktemp "$RUNTIME_DIR/secondary-arch/repo-sync.XXXXXX.tar.gz")"

  tar -czf "$REPO_ARCHIVE_PATH" \
    --exclude="$repo_name/.git" \
    --exclude="$repo_name/.codex" \
    --exclude="$repo_name/runtime" \
    -C "$repo_parent" \
    "$repo_name"
}

ensure_remote_secondary_arch_prerequisites() {
  local node_name="$1"

  print_step "在 $node_name 上准备 secondary-arch 接力依赖"
  remote_sudo_ssh "$node_name" '
set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  apt-get -o DPkg::Lock::Timeout=300 update
  DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y \
    git nodejs npm sshpass python3 python3-venv python3-pip \
    curl wget ca-certificates gnupg tar
  exit 0
fi

if command -v dnf >/dev/null 2>&1; then
  dnf install -y \
    git nodejs npm sshpass python3 python3-pip \
    curl wget ca-certificates tar
  exit 0
fi

if command -v yum >/dev/null 2>&1; then
  yum install -y \
    git nodejs npm sshpass python3 python3-pip \
    curl wget ca-certificates tar
  exit 0
fi

echo "当前系统缺少受支持的包管理器，无法自动准备 secondary-arch 接力依赖。" >&2
exit 1
'
}

sync_repo_and_bundle_to_node() {
  local node_name="$1"
  local remote_base="$2"
  local remote_repo="$remote_base/$(basename "$ROOT_DIR")"
  local bundle_name
  local archive_name
  local asset_archive_name

  bundle_name="$(basename "$BUNDLE_PATH")"
  archive_name="$(basename "$REPO_ARCHIVE_PATH")"
  asset_archive_name="$(basename "$ASSET_ARCHIVE_PATH")"

  remote_ssh "$node_name" "mkdir -p $(printf '%q' "$remote_base")"
  remote_scp "$BUNDLE_PATH" "$node_name" "$remote_base/$bundle_name"
  remote_scp "$REPO_ARCHIVE_PATH" "$node_name" "$remote_base/$archive_name"
  remote_scp "$ASSET_ARCHIVE_PATH" "$node_name" "$remote_base/$asset_archive_name"
  remote_sudo_ssh "$node_name" "rm -rf $(printf '%q' "$remote_repo")"
  remote_ssh "$node_name" "tar -xzf $(printf '%q' "$remote_base/$archive_name") -C $(printf '%q' "$remote_base")"
}

run_remote_secondary_arch_import() {
  local node_name="$1"
  local remote_base="$2"
  local remote_repo="$remote_base/$(basename "$ROOT_DIR")"
  local bundle_path="$remote_base/$(basename "$BUNDLE_PATH")"
  local asset_archive_path="$remote_base/$(basename "$ASSET_ARCHIVE_PATH")"
  local roles

  roles="$(node_roles "$node_name")"

  print_step "在 $node_name 上执行 secondary-arch import"
  remote_sudo_ssh "$node_name" \
    "cd $(printf '%q' "$remote_repo") && ./bin/cluster.sh secondary-arch import --bundle $(printf '%q' "$bundle_path") --asset-archive $(printf '%q' "$asset_archive_path") --name $(printf '%q' "$node_name") --ip $(printf '%q' "$(node_ip "$node_name")") --ssh-user $(printf '%q' "$(node_user "$node_name")") --ssh-password $(printf '%q' "$(node_password "$node_name")") --ssh-port $(printf '%q' "$(node_port "$node_name")") --roles $(printf '%q' "$roles") --arch $(printf '%q' "$(node_arch "$node_name")")"
}

refresh_local_inventory_after_secondary_arch_join() {
  print_step "刷新本地 kubeasz inventory"
  render_cluster_inventory --mode full --out "$GENERATED_DIR/hosts"
  copy_hosts_into_kubeasz
}

build_secondary_arch_candidate_list

if [[ "${#SECONDARY_ARCH_CANDIDATES[@]}" -eq 0 ]]; then
  echo "未检测到需要自动接力的异构 worker 节点。"
  exit 0
fi

export_secondary_arch_bundle
build_repo_archive
prepare_local_arm64_asset_archive

for node_name in "${SECONDARY_ARCH_CANDIDATES[@]}"; do
  remote_home="$(remote_ssh "$node_name" 'printf %s "$HOME"' | tail -n 1)"
  [[ -n "$remote_home" ]] || die "无法获取节点 $node_name 的 HOME 路径。"
  remote_base="$remote_home/.remote-work-secondary-arch/$(cluster_name)"

  ensure_remote_secondary_arch_prerequisites "$node_name"
  sync_repo_and_bundle_to_node "$node_name" "$remote_base"
  run_remote_secondary_arch_import "$node_name" "$remote_base"
  refresh_local_inventory_after_secondary_arch_join
done

echo "secondary-arch 节点已自动接力完成。"
