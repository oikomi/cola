#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd node
require_cmd sshpass
require_cmd scp
require_cmd ssh

NAME=""
NODE_NAME=""
PASSWORD=""
IMAGE=""
GPU_COUNT="0"
NODE_PORT=""
RESOLUTION="1920x1080x24"
INGRESS_HOST=""
TLS_SECRET=""
CPU_REQUEST="2"
CPU_LIMIT="4"
MEMORY_REQUEST="4Gi"
MEMORY_LIMIT="8Gi"
TIMEZONE="Asia/Shanghai"
WORKSPACE_ROOT="/var/lib/remote-work/workspaces"

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
    --password)
      PASSWORD="$2"
      shift 2
      ;;
    --image)
      IMAGE="$2"
      shift 2
      ;;
    --gpu)
      GPU_COUNT="$2"
      shift 2
      ;;
    --node-port)
      NODE_PORT="$2"
      shift 2
      ;;
    --resolution)
      RESOLUTION="$2"
      shift 2
      ;;
    --ingress-host)
      INGRESS_HOST="$2"
      shift 2
      ;;
    --tls-secret)
      TLS_SECRET="$2"
      shift 2
      ;;
    --cpu-request)
      CPU_REQUEST="$2"
      shift 2
      ;;
    --cpu-limit)
      CPU_LIMIT="$2"
      shift 2
      ;;
    --memory-request)
      MEMORY_REQUEST="$2"
      shift 2
      ;;
    --memory-limit)
      MEMORY_LIMIT="$2"
      shift 2
      ;;
    --timezone)
      TIMEZONE="$2"
      shift 2
      ;;
    --workspace-root)
      WORKSPACE_ROOT="$2"
      shift 2
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

[[ -n "$NAME" ]] || die "--name 必填"
[[ -n "$NODE_NAME" ]] || die "--node 必填"
[[ -n "$PASSWORD" ]] || die "--password 必填"

if [[ -z "$IMAGE" ]]; then
  [[ -f "$RUNTIME_DIR/latest-image.txt" ]] || \
    die "未指定 --image，且 runtime/latest-image.txt 不存在，请先执行 ./bin/30-build-and-load-image.sh"
  IMAGE="$(tr -d '\n' < "$RUNTIME_DIR/latest-image.txt")"
fi

if [[ -z "$NODE_PORT" ]]; then
  print_step "自动分配 NodePort"
  USED_PORTS="$(
    remote_ssh "$(first_master_name)" \
      "sudo KUBECONFIG=/etc/kubernetes/admin.conf kubectl get svc -n $(workspace_namespace) -o json 2>/dev/null || true" \
      | node --input-type=module -e '
        let source = "";
        process.stdin.on("data", (chunk) => { source += chunk; });
        process.stdin.on("end", () => {
          if (!source.trim()) {
            process.exit(0);
          }
          const data = JSON.parse(source);
          for (const item of data.items ?? []) {
            for (const port of item.spec?.ports ?? []) {
              if (port.nodePort) {
                console.log(port.nodePort);
              }
            }
          }
        });
      '
  )"

  for candidate in $(seq 32080 32760); do
    if ! grep -qx "$candidate" <<<"$USED_PORTS"; then
      NODE_PORT="$candidate"
      break
    fi
  done

  [[ -n "$NODE_PORT" ]] || die "无法自动分配 NodePort，请手动传 --node-port"
fi

print_step "确保 namespace 存在"
kubectl_apply_file "$ROOT_DIR/manifests/base/namespace.yaml"

render_cmd=(
  node "$ROOT_DIR/bin/render-workspace.mjs"
  --name "$NAME"
  --node "$NODE_NAME"
  --password "$PASSWORD"
  --image "$IMAGE"
  --gpu "$GPU_COUNT"
  --node-port "$NODE_PORT"
  --resolution "$RESOLUTION"
  --cpu-request "$CPU_REQUEST"
  --cpu-limit "$CPU_LIMIT"
  --memory-request "$MEMORY_REQUEST"
  --memory-limit "$MEMORY_LIMIT"
  --timezone "$TIMEZONE"
  --workspace-root "$WORKSPACE_ROOT"
)

if [[ -n "$INGRESS_HOST" ]]; then
  render_cmd+=(--ingress-host "$INGRESS_HOST")
fi

if [[ -n "$TLS_SECRET" ]]; then
  render_cmd+=(--tls-secret "$TLS_SECRET")
fi

MANIFEST_PATH="$("${render_cmd[@]}")"

print_step "应用工作区清单"
kubectl_apply_file "$MANIFEST_PATH"
kubectl_remote "rollout status deployment/workspace-$NAME -n $(workspace_namespace) --timeout=180s"

NODE_IP="$(node_ip "$NODE_NAME")"
if [[ -n "$INGRESS_HOST" ]]; then
  if [[ -n "$TLS_SECRET" ]]; then
    ACCESS_URL="https://$INGRESS_HOST/"
  else
    ACCESS_URL="http://$INGRESS_HOST/"
  fi
else
  ACCESS_URL="http://${NODE_IP}:${NODE_PORT}/vnc.html?autoconnect=1&resize=remote"
fi

echo
echo "Workspace: $NAME"
echo "Node:      $NODE_NAME ($NODE_IP)"
echo "Image:     $IMAGE"
echo "URL:       $ACCESS_URL"
