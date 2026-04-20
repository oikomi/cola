#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

require_cmd git
require_cmd node
require_cmd sudo
require_any_cmd curl wget

ensure_runtime_dirs

KUBEASZ_VERSION="$(cluster_query kubeaszVersion)"
KUBE_VERSION="$(kubernetes_version)"
KUBEASZ_REPO_URL="$(cluster_query kubeaszRepoUrl)"
CLUSTER_NAME="$(cluster_name)"
WITH_IMAGES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-images)
      WITH_IMAGES=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./bin/cluster.sh cluster bootstrap [--with-images]

Default behavior:
  - prepare kubeasz binaries and /etc/kubeasz cluster assets
  - skip pushing default images into the local registry

Optional:
  --with-images   also pre-pull default images and push them into the local registry
EOF
      exit 0
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

run_ezdown_download_all() {
  local kube_version="$1"
  local log_file="$RUNTIME_DIR/ezdown-${kube_version}.log"
  local status

  (
    cd "$KUBEASZ_DIR"
    set +e
    sudo ./ezdown -D -k "$kube_version" 2>&1 | tee "$log_file"
    status=${PIPESTATUS[0]}
    exit "$status"
  )
}

run_ezdown_bootstrap_only() {
  local kube_version="$1"
  local log_file="$RUNTIME_DIR/ezdown-bootstrap-${kube_version}.log"
  local status

  (
    cd "$KUBEASZ_DIR"
    set +e
    sudo bash -lc "
      set -euo pipefail
      EZDOWN_FUNCTIONS=\$(mktemp)
      sed '/^main \"\\\$@\"\$/d' ./ezdown > \"\$EZDOWN_FUNCTIONS\"
      # shellcheck source=/dev/null
      source \"\$EZDOWN_FUNCTIONS\"
      rm -f \"\$EZDOWN_FUNCTIONS\"
      BASE=/etc/kubeasz
      IMAGES=()
      imageDir=\$BASE/down
      ARCH=\$(uname -m)
      K8S_BIN_VER='${kube_version}'
      download_docker
      install_docker
      get_kubeasz
      get_k8s_bin
      get_ext_bin
    " 2>&1 | tee "$log_file"
    status=${PIPESTATUS[0]}
    exit "$status"
  )
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

prepare_kubeasz_docker_bundle() {
  local docker_ver
  local arch
  local cache_dir
  local bundle_file

  docker_ver="$(sed -n 's/^DOCKER_VER=//p' "$KUBEASZ_DIR/ezdown" | head -n 1)"
  [[ -n "$docker_ver" ]] || die "无法从 kubeasz ezdown 解析 DOCKER_VER"

  arch="$(uname -m)"
  cache_dir="$RUNTIME_DIR/cache"
  bundle_file="$cache_dir/docker-${docker_ver}-${arch}.tgz"

  mkdir -p "$cache_dir"

  if [[ ! -f "$bundle_file" ]]; then
    print_step "预下载 Docker 静态包，避免 ezdown 在镜像站 403 时中断"
    download_with_fallback \
      "$bundle_file" \
      "https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/static/stable/${arch}/docker-${docker_ver}.tgz" \
      "https://download.docker.com/linux/static/stable/${arch}/docker-${docker_ver}.tgz" \
      || die "下载 Docker 静态包失败，请检查网络或手动放置 docker-${docker_ver}.tgz"
  fi

  sudo mkdir -p "$KUBEASZ_BASE_DIR/down"
  sudo install -m 0644 "$bundle_file" "$KUBEASZ_BASE_DIR/down/docker-${docker_ver}.tgz"
}

init_cluster_dir_without_ansible() {
  print_step "初始化 kubeasz cluster 目录"

  if sudo test -d "$KUBEASZ_BASE_DIR/clusters/$CLUSTER_NAME"; then
    echo "复用现有 cluster 目录: $KUBEASZ_BASE_DIR/clusters/$CLUSTER_NAME"
    return 0
  fi

  sudo bash -s -- "$CLUSTER_NAME" "$KUBE_VERSION" <<'REMOTE_SCRIPT'
set -euo pipefail

cluster_name="$1"
kube_version="$2"
base_dir="/etc/kubeasz"

cd "$base_dir"
mkdir -p "clusters/$cluster_name"
cp example/hosts.multi-node "clusters/$cluster_name/hosts"
sed -i "s/_cluster_name_/$cluster_name/g" "clusters/$cluster_name/hosts"
cp example/config.yml "clusters/$cluster_name/config.yml"

eval "$(sed '/V.[rR]=.*\./!d' ezdown)"
k8s_ver="${kube_version#v}"
registry_mirror=true

grep registry-mirrors /etc/docker/daemon.json >/dev/null 2>&1 || registry_mirror=false

sed -i \
  -e "s/__k8s_ver__/${k8s_ver}/g" \
  -e "s/__flannel__/${flannelVer}/g" \
  -e "s/__calico__/${calicoVer}/g" \
  -e "s/__cilium__/${ciliumVer}/g" \
  -e "s/__kube_ovn__/${kubeOvnVer}/g" \
  -e "s/__kube_router__/${kubeRouterVer}/g" \
  -e "s/__coredns__/${corednsVer}/g" \
  -e "s/__pause__/${pauseVer}/g" \
  -e "s/__dns_node_cache__/${dnsNodeCacheVer}/g" \
  -e "s/__dashboard__/${dashboardVer}/g" \
  -e "s/__local_path_provisioner__/${localpathProvisionerVer}/g" \
  -e "s/__nfs_provisioner__/${nfsProvisionerVer}/g" \
  -e "s/__openebs_ver__/${openebsVer}/g" \
  -e "s/__prom_chart__/${promChartVer}/g" \
  -e "s/__minio_chart__/${minioOperatorVer}/g" \
  -e "s/__kubeapps_chart__/${kubeappsVer}/g" \
  -e "s/__kubeblocks_ver__/${kubeblocksVer}/g" \
  -e "s/__ingress_nginx_ver__/${ingressNginxVer}/g" \
  -e "s/__harbor__/${HARBOR_VER}/g" \
  -e "s/^ENABLE_MIRROR_REGISTRY.*$/ENABLE_MIRROR_REGISTRY: ${registry_mirror}/g" \
  -e "s/__metrics__/${metricsVer}/g" \
  "clusters/$cluster_name/config.yml"
REMOTE_SCRIPT
}

print_step "准备 kubeasz 目录"
if [[ ! -d "$KUBEASZ_DIR/.git" ]]; then
  git clone --depth 1 --branch "$KUBEASZ_VERSION" "$KUBEASZ_REPO_URL" "$KUBEASZ_DIR"
else
  echo "复用现有 kubeasz 目录: $KUBEASZ_DIR"
fi

chmod +x "$KUBEASZ_DIR/ezdown" "$KUBEASZ_DIR/ezctl"
prepare_kubeasz_docker_bundle

print_step "下载 kubeasz 依赖"
KUBEASZ_BUNDLED_KUBE_VERSION="$(kubeasz_bundled_kubernetes_version)"
if [[ "$WITH_IMAGES" -eq 1 ]]; then
  EZDOWN_RUNNER="run_ezdown_download_all"
  LOG_HINT="$RUNTIME_DIR/ezdown-${KUBE_VERSION}.log"
else
  EZDOWN_RUNNER="run_ezdown_bootstrap_only"
  LOG_HINT="$RUNTIME_DIR/ezdown-bootstrap-${KUBE_VERSION}.log"
fi

if ! "$EZDOWN_RUNNER" "$KUBE_VERSION"; then
  if [[ "$KUBE_VERSION" != "$KUBEASZ_BUNDLED_KUBE_VERSION" ]] && \
    grep -q "kubeasz-k8s-bin:${KUBE_VERSION}.*not found" "$LOG_HINT"; then
    echo
    echo "WARN: kubeasz 3.6.8 当前无法下载 Kubernetes 二进制镜像 ${KUBE_VERSION}。"
    echo "WARN: 自动回退到 kubeasz 自带版本 ${KUBEASZ_BUNDLED_KUBE_VERSION}。"
    echo "WARN: 建议把 cluster/config.json 中的 kubernetesVersion 改成 ${KUBEASZ_BUNDLED_KUBE_VERSION#v}。"
    if [[ "$WITH_IMAGES" -eq 1 ]]; then
      run_ezdown_download_all "$KUBEASZ_BUNDLED_KUBE_VERSION" || \
        die "回退到 kubeasz 自带 Kubernetes 版本 ${KUBEASZ_BUNDLED_KUBE_VERSION} 仍然失败，请检查 $RUNTIME_DIR/ezdown-${KUBEASZ_BUNDLED_KUBE_VERSION}.log"
    else
      run_ezdown_bootstrap_only "$KUBEASZ_BUNDLED_KUBE_VERSION" || \
        die "回退到 kubeasz 自带 Kubernetes 版本 ${KUBEASZ_BUNDLED_KUBE_VERSION} 仍然失败，请检查 $RUNTIME_DIR/ezdown-bootstrap-${KUBEASZ_BUNDLED_KUBE_VERSION}.log"
    fi
  else
    die "ezdown 执行失败，请检查日志: $LOG_HINT"
  fi
fi

init_cluster_dir_without_ansible
patch_kubeasz_compatibility

print_step "渲染并同步 inventory"
render_cluster_inventory
copy_hosts_into_kubeasz

echo "kubeasz 已准备完成。下一步执行: ./bin/cluster.sh cluster install"
