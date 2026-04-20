#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sshpass
require_cmd ssh

NAME=""
NODE_NAME=""
PURGE_DATA=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      NAME="$2"
      shift 2
      ;;
    --node)
      NODE_NAME="$2"
      shift 2
      ;;
    --purge-data)
      PURGE_DATA=1
      shift
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

[[ -n "$NAME" ]] || die "--name 必填"

print_step "删除 Kubernetes 资源"
kubectl_remote "delete deployment workspace-$NAME -n $(workspace_namespace) --ignore-not-found"
kubectl_remote "delete service workspace-$NAME-svc -n $(workspace_namespace) --ignore-not-found"
kubectl_remote "delete secret workspace-$NAME-secret -n $(workspace_namespace) --ignore-not-found"
kubectl_remote "delete ingress workspace-$NAME-ing -n $(workspace_namespace) --ignore-not-found"

if [[ "$PURGE_DATA" -eq 1 ]]; then
  [[ -n "$NODE_NAME" ]] || die "使用 --purge-data 时必须同时传 --node"
  print_step "清理宿主机目录"
  remote_ssh "$NODE_NAME" "sudo rm -rf /var/lib/remote-work/workspaces/$NAME"
fi

echo "工作区 $NAME 已删除。"

