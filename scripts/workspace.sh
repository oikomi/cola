#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/scripts/workspace/lib.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/workspace.sh <command> [options]

Commands:
  create    Create a workspace deployment
  delete    Delete a workspace deployment

Examples:
  ./scripts/workspace.sh create --name alice --gpu 1
  ./scripts/workspace.sh delete --name alice
EOF
}

create_usage() {
  cat <<'EOF'
Usage: ./scripts/workspace.sh create [options]

Options:
  --name <name>                 Workspace name, required
  --node <node>                 Pin workspace to a node
  --password <password>         Enable VNC password auth
  --image <image>               Override image ref
  --gpu <count>                 GPU count, default 0
  --node-port <port>            Use a fixed NodePort
  --resolution <WxHxD>          Default 1600x900x24
  --ingress-host <host>         Create an Ingress for the workspace
  --tls-secret <name>           TLS secret for Ingress
  --cpu-request <value>         Default 2
  --cpu-limit <value>           Default 4
  --memory-request <value>      Default 4Gi
  --memory-limit <value>        Default 8Gi
  --timezone <tz>               Default Asia/Shanghai
  --workspace-root <path>       Default /var/lib/remote-work/workspaces
  --rollout-timeout <duration>  Default 180s
  -h, --help                    Show help
EOF
}

delete_usage() {
  cat <<'EOF'
Usage: ./scripts/workspace.sh delete --name <name> [options]

Options:
  --name <name>      Workspace name, required
  --node <node>      Required with --purge-data
  --purge-data       Also remove host workspace data
  -h, --help         Show help
EOF
}

print_workspace_diagnostics() {
  local workspace_name="$1"

  echo
  echo "--- workspace deployment ---"
  run_cluster_kubectl -n "$(workspace_namespace)" get deployment "workspace-$workspace_name" -o wide || true
  echo
  echo "--- workspace pods ---"
  run_cluster_kubectl -n "$(workspace_namespace)" get pods -l "remote-work/name=$workspace_name" -o wide || true
  echo
  echo "--- workspace services ---"
  run_cluster_kubectl -n "$(workspace_namespace)" get svc "workspace-$workspace_name-svc" -o wide || true
  echo
  echo "--- recent namespace events ---"
  run_cluster_kubectl -n "$(workspace_namespace)" get events --sort-by=.lastTimestamp | tail -n 50 || true
  echo

  local pods
  pods="$(run_cluster_kubectl -n "$(workspace_namespace)" get pods -l "remote-work/name=$workspace_name" -o name 2>/dev/null || true)"
  if [[ -n "$pods" ]]; then
    echo "--- workspace pod describe ---"
    while IFS= read -r pod_name; do
      [[ -n "$pod_name" ]] || continue
      echo "### $pod_name ###"
      run_cluster_kubectl -n "$(workspace_namespace)" describe "$pod_name" || true
      echo
    done <<<"$pods"
  fi
}

workspace_create() {
  case "${1:-}" in
    -h|--help)
      create_usage
      exit 0
      ;;
  esac

  require_cmd node
  require_cmd sudo
  require_cmd sshpass
  require_cmd scp
  require_cmd ssh

  local name=""
  local node_name=""
  local password=""
  local image=""
  local gpu_count="0"
  local node_port=""
  local resolution="1600x900x24"
  local ingress_host=""
  local tls_secret=""
  local cpu_request="2"
  local cpu_limit="4"
  local memory_request="4Gi"
  local memory_limit="8Gi"
  local timezone="Asia/Shanghai"
  local workspace_root="/var/lib/remote-work/workspaces"
  local rollout_timeout="180s"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name)
        name="$2"
        shift 2
        ;;
      --node)
        node_name="$2"
        shift 2
        ;;
      --password)
        password="$2"
        shift 2
        ;;
      --image)
        image="$2"
        shift 2
        ;;
      --gpu)
        gpu_count="$2"
        shift 2
        ;;
      --node-port)
        node_port="$2"
        shift 2
        ;;
      --resolution)
        resolution="$2"
        shift 2
        ;;
      --ingress-host)
        ingress_host="$2"
        shift 2
        ;;
      --tls-secret)
        tls_secret="$2"
        shift 2
        ;;
      --cpu-request)
        cpu_request="$2"
        shift 2
        ;;
      --cpu-limit)
        cpu_limit="$2"
        shift 2
        ;;
      --memory-request)
        memory_request="$2"
        shift 2
        ;;
      --memory-limit)
        memory_limit="$2"
        shift 2
        ;;
      --timezone)
        timezone="$2"
        shift 2
        ;;
      --workspace-root)
        workspace_root="$2"
        shift 2
        ;;
      --rollout-timeout)
        rollout_timeout="$2"
        shift 2
        ;;
      -h|--help)
        create_usage
        exit 0
        ;;
      *)
        die "未知参数: $1"
        ;;
    esac
  done

  [[ -n "$name" ]] || die "--name 必填"
  ensure_workspace_runtime_dirs
  if [[ -z "$image" ]]; then
    [[ -f "$WORKSPACE_IMAGE_PATH" ]] || \
      die "未指定 --image，且 runtime/workspace/latest-image.txt 不存在，请先执行 ./scripts/workspace-image.sh build-and-load"
    image="$(tr -d '\n' < "$WORKSPACE_IMAGE_PATH")"
  fi

  print_step "选择目标节点"
  local cluster_nodes_json
  local deployments_json
  local services_json
  cluster_nodes_json="$(mktemp)"
  deployments_json="$(mktemp)"
  services_json="$(mktemp)"

  cleanup_selection_temp() {
    rm -f "$cluster_nodes_json" "$deployments_json" "$services_json"
  }
  trap cleanup_selection_temp EXIT

  run_cluster_kubectl get nodes -o json > "$cluster_nodes_json"
  if run_cluster_kubectl get namespace "$(workspace_namespace)" >/dev/null 2>&1; then
    run_cluster_kubectl get deployments -n "$(workspace_namespace)" -o json > "$deployments_json"
    run_cluster_kubectl get svc -n "$(workspace_namespace)" -o json > "$services_json"
  else
    printf '%s\n' '{"items":[]}' > "$deployments_json"
    printf '%s\n' '{"items":[]}' > "$services_json"
  fi

  local -a prepare_cmd=(
    node "$REPO_ROOT/scripts/workspace/prepare-workspace.mjs"
    --cluster-nodes-json "$cluster_nodes_json"
    --deployments-json "$deployments_json"
    --services-json "$services_json"
    --gpu "$gpu_count"
    --gpu-label-key "$(gpu_label_key)"
    --workspace-label-key "$(workspace_label_key)"
    --name "$name"
    --image "$image"
    --resolution "$resolution"
    --cpu-request "$cpu_request"
    --cpu-limit "$cpu_limit"
    --memory-request "$memory_request"
    --memory-limit "$memory_limit"
    --timezone "$timezone"
    --workspace-root "$workspace_root"
  )

  if [[ -n "$node_name" ]]; then
    prepare_cmd+=(--requested-node "$node_name")
  fi

  if [[ -n "$password" ]]; then
    prepare_cmd+=(--password "$password")
  else
    prepare_cmd+=(--disable-password "1")
  fi

  if [[ -n "$node_port" ]]; then
    prepare_cmd+=(--node-port "$node_port")
  fi

  if [[ -n "$ingress_host" ]]; then
    prepare_cmd+=(--ingress-host "$ingress_host")
  fi

  if [[ -n "$tls_secret" ]]; then
    prepare_cmd+=(--tls-secret "$tls_secret")
  fi

  local prepare_json
  prepare_json="$("${prepare_cmd[@]}")"

  local -a prepare_fields
  mapfile -t prepare_fields < <(
    json_read_props \
      "$prepare_json" \
      reason \
      nodeName \
      nodePort \
      manifestPath \
      nodeIp \
      accessUrl
  )

  local selection_reason="${prepare_fields[0]}"
  node_name="${prepare_fields[1]}"
  node_port="${prepare_fields[2]}"
  local manifest_path="${prepare_fields[3]}"
  local node_ip="${prepare_fields[4]}"
  local access_url="${prepare_fields[5]}"
  printf '%s\n' "$selection_reason"

  print_step "确保 namespace 存在"
  kubectl_apply_file "$WORKSPACE_NAMESPACE_MANIFEST"

  print_step "应用工作区清单"
  kubectl_apply_file "$manifest_path"
  if ! run_cluster_kubectl -n "$(workspace_namespace)" rollout status "deployment/workspace-$name" --timeout="$rollout_timeout"; then
    print_step "workspace rollout 超时，输出诊断信息"
    print_workspace_diagnostics "$name"
    die "workspace-$name 在 $rollout_timeout 内未就绪。"
  fi

  echo
  echo "Workspace: $name"
  echo "Node:      $node_name ($node_ip)"
  echo "Image:     $image"
  echo "URL:       $access_url"
}

workspace_delete() {
  case "${1:-}" in
    -h|--help)
      delete_usage
      exit 0
      ;;
  esac

  require_cmd sshpass
  require_cmd ssh

  local name=""
  local node_name=""
  local purge_data=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name)
        name="$2"
        shift 2
        ;;
      --node)
        node_name="$2"
        shift 2
        ;;
      --purge-data)
        purge_data=1
        shift
        ;;
      -h|--help)
        delete_usage
        exit 0
        ;;
      *)
        die "未知参数: $1"
        ;;
    esac
  done

  [[ -n "$name" ]] || die "--name 必填"

  print_step "删除 Kubernetes 资源"
  kubectl_remote "delete deployment workspace-$name -n $(workspace_namespace) --ignore-not-found"
  kubectl_remote "delete service workspace-$name-svc -n $(workspace_namespace) --ignore-not-found"
  kubectl_remote "delete secret workspace-$name-secret -n $(workspace_namespace) --ignore-not-found"
  kubectl_remote "delete ingress workspace-$name-ing -n $(workspace_namespace) --ignore-not-found"

  if [[ "$purge_data" -eq 1 ]]; then
    [[ -n "$node_name" ]] || die "使用 --purge-data 时必须同时传 --node"
    print_step "清理宿主机目录"
    remote_sudo_ssh "$node_name" "rm -rf /var/lib/remote-work/workspaces/$name"
  fi

  echo "工作区 $name 已删除。"
}

COMMAND="${1:-}"
case "$COMMAND" in
  create)
    shift
    workspace_create "$@"
    ;;
  delete)
    shift
    workspace_delete "$@"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "未知命令: $COMMAND" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
