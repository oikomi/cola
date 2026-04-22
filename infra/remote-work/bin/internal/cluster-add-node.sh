#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

usage() {
  cat <<'EOF'
Usage: ./bin/cluster.sh cluster add-node [options]

Options:
  --name <name>              Node name, required
  --ip <ip>                  Node IP, required
  --ssh-user <user>          SSH user, required
  --ssh-password <password>  SSH password, required
  --ssh-port <port>          SSH port, default 22
  --roles <roles>            worker or worker,gpu
  --arch <arch>              Default local arch
  -h, --help                 Show help
EOF
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

require_cmd node
require_cmd sudo
ensure_ansible_available

NAME=""
IP=""
SSH_USER=""
SSH_PASSWORD=""
SSH_PORT="22"
ROLES=""
ARCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      NAME="$2"
      shift 2
      ;;
    --ip)
      IP="$2"
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
      usage
      exit 0
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

for value_name in NAME IP SSH_USER SSH_PASSWORD ROLES; do
  [[ -n "${!value_name}" ]] || die "缺少必要参数: ${value_name}"
done

if [[ -z "$ARCH" ]]; then
  ARCH="$(local_arch)"
fi

if [[ "$ARCH" != "$(local_arch)" ]]; then
  die "当前部署机架构是 $(local_arch)，但你要添加的节点声明为 $ARCH。请在同架构部署机上执行 ./bin/cluster.sh cluster add-node，或先用 ./bin/cluster.sh secondary-arch export 在目标架构部署机上继续。"
fi

if [[ ",$ROLES," == *",master,"* || ",$ROLES," == *",etcd,"* ]]; then
  die "当前脚本只支持扩容 worker / worker,gpu 节点，不支持直接扩容 master/etcd。"
fi

if [[ ",$ROLES," != *",worker,"* ]]; then
  die "--roles 至少需要包含 worker"
fi

if ! kubeasz_ezctl_path >/dev/null 2>&1; then
  die "kubeasz 尚未准备好，请先执行 ./bin/cluster.sh cluster bootstrap"
fi

print_step "通过 kubeasz 加入 worker 节点"
(
  cd "$KUBEASZ_DIR" 2>/dev/null || cd "$KUBEASZ_BASE_DIR"
  run_kubeasz_ezctl add-node "$(cluster_name)" "$IP" \
    "ansible_user=$SSH_USER" \
    "ansible_ssh_pass=$SSH_PASSWORD" \
    "ansible_ssh_port=$SSH_PORT" \
    "ansible_become=true" \
    "ansible_become_method=sudo" \
    "ansible_become_user=root" \
    "ansible_become_pass=$SSH_PASSWORD" \
    "ansible_python_interpreter=/usr/bin/python3" \
    "k8s_nodename=$NAME"
)

print_step "更新本地节点清单"
node "$ROOT_DIR/bin/update-node-list.mjs" \
  --name "$NAME" \
  --ip "$IP" \
  --ssh-user "$SSH_USER" \
  --ssh-password "$SSH_PASSWORD" \
  --ssh-port "$SSH_PORT" \
  --roles "$ROLES" \
  --arch "$ARCH"

render_cluster_inventory --mode full --out "$GENERATED_DIR/hosts"
copy_hosts_into_kubeasz

best_effort_prewarm_cluster_system_images_on_node "$NAME" "$ARCH"

if cluster_has_mixed_arch_nodes_configured; then
  print_step "调整 mixed-arch 集群系统组件镜像"
  reconcile_mixed_arch_cluster_components
  print_step "等待节点 $NAME 达到稳定 Ready"
  wait_for_cluster_node_ready "$NAME" 600 || \
    die "节点 $NAME 在 mixed-arch 组件调整后未恢复到 Ready。"
fi

kubectl_remote "label node $NAME $(workspace_label_key)=true --overwrite"

if [[ ",$ROLES," == *",gpu,"* ]]; then
  print_step "为新增 GPU 节点启用 NVIDIA runtime"
  "$ROOT_DIR/bin/cluster.sh" gpu enable --node "$NAME" --skip-manifests
  kubectl_remote "label node $NAME $(gpu_label_key)=true --overwrite"
  wait_for_cluster_node_ready "$NAME" 300 || \
    die "GPU runtime 启用后，节点 $NAME 未恢复到 Ready。"
fi

echo "节点 $NAME ($IP) 已加入集群。"
