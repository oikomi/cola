#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd node
require_cmd sudo
ensure_ansible_available

NAME=""
IP=""
SSH_USER=""
SSH_PASSWORD=""
SSH_PORT="22"
ROLES=""

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
    *)
      die "未知参数: $1"
      ;;
  esac
done

for value_name in NAME IP SSH_USER SSH_PASSWORD ROLES; do
  [[ -n "${!value_name}" ]] || die "缺少必要参数: ${value_name}"
done

if [[ ",$ROLES," == *",master,"* || ",$ROLES," == *",etcd,"* ]]; then
  die "当前脚本只支持扩容 worker / worker,gpu 节点，不支持直接扩容 master/etcd。"
fi

if [[ ",$ROLES," != *",worker,"* ]]; then
  die "--roles 至少需要包含 worker"
fi

[[ -x "$KUBEASZ_DIR/ezctl" ]] || die "kubeasz 尚未准备好，请先执行 ./bin/00-bootstrap-kubeasz.sh"

print_step "通过 kubeasz 加入 worker 节点"
(
  cd "$KUBEASZ_DIR"
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
  --roles "$ROLES"

render_cluster_inventory
copy_hosts_into_kubeasz

kubectl_remote "label node $NAME $(workspace_label_key)=true --overwrite"

if [[ ",$ROLES," == *",gpu,"* ]]; then
  print_step "为新增 GPU 节点启用 NVIDIA runtime"
  "$ROOT_DIR/bin/20-enable-gpu.sh" --node "$NAME" --skip-manifests
  kubectl_remote "label node $NAME $(gpu_label_key)=true --overwrite"
fi

echo "节点 $NAME ($IP) 已加入集群。"
