#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd sudo
require_cmd tar
require_cmd node

BUNDLE_PATH=""
NODE_NAME=""
NODE_IP=""
SSH_USER=""
SSH_PASSWORD=""
SSH_PORT="22"
ROLES=""
ARCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle)
      BUNDLE_PATH="$2"
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
Usage: ./bin/71-import-secondary-arch-bundle.sh --bundle /path/to/seed.tar.gz [node args]

Restore the kubeasz seed bundle on a secondary-architecture deployment host,
bootstrap local-arch binaries via 00-bootstrap-kubeasz.sh, and optionally add
the listed node immediately using 60-add-node.sh.
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

print_step "在当前架构上补齐 kubeasz 二进制与镜像缓存"
"$ROOT_DIR/bin/00-bootstrap-kubeasz.sh"

if [[ -n "$NODE_NAME" || -n "$NODE_IP" || -n "$SSH_USER" || -n "$SSH_PASSWORD" || -n "$ROLES" ]]; then
  for value_name in NODE_NAME NODE_IP SSH_USER SSH_PASSWORD ROLES; do
    [[ -n "${!value_name}" ]] || die "如果要自动 add-node，必须同时提供 name/ip/ssh-user/ssh-password/roles"
  done

  if [[ -z "$ARCH" ]]; then
    ARCH="$(local_arch)"
  fi

  print_step "在次级架构部署机上执行 add-node"
  "$ROOT_DIR/bin/60-add-node.sh" \
    --name "$NODE_NAME" \
    --ip "$NODE_IP" \
    --ssh-user "$SSH_USER" \
    --ssh-password "$SSH_PASSWORD" \
    --ssh-port "$SSH_PORT" \
    --roles "$ROLES" \
    --arch "$ARCH"
fi

echo "secondary-arch 部署机已准备完成。"
