#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
K8S_DIR="$INFRA_DIR/k8s"
NAS_CONFIG="$K8S_DIR/cluster/nas.json"
SEAWEEDFS_DEPLOY="$SCRIPT_DIR/deploy.sh"

ACTION="install"
ENV_FILE=""
DRY_RUN=0
KUBECONFIG_PATH=""

usage() {
  cat <<'EOF'
Usage: ./nas.sh [install|preflight|deploy-k8s|deploy-nas|status|status-nas|render-env|render-volume-command|uninstall-nas] [options]

Deploy SeaweedFS with an external NAS volume server.

Actions:
  install                  Deploy K8s SeaweedFS, then prepare/start weed volume on NAS
  preflight                Check local tools, Kubernetes rendering, and NAS SSH/sudo basics
  deploy-k8s               Only deploy SeaweedFS master/filer/s3 in Kubernetes
  deploy-nas               Only prepare/start weed volume on NAS
  status                   Show Kubernetes status and NAS process/log status
  status-nas               Only show NAS process/log status
  render-env               Print derived SeaweedFS env from infra/k8s/cluster/nas.json
  render-volume-command    Print the NAS weed volume command
  uninstall-nas            Stop the NAS weed volume process; data is kept

Options:
  --env-file <path>        Optional overrides loaded after nas.json-derived env
  --kubeconfig <path>      Pass kubeconfig to deploy.sh
  --dry-run                Print planned local/remote commands without changing anything
  -h, --help               Show help
EOF
}

log() {
  echo "==> $*"
}

warn() {
  echo "WARN: $*" >&2
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

print_failure_hint() {
  local step="$1"

  cat >&2 <<EOF

部署失败步骤: ${step}

建议排查：
  cd infra/seaweedfs
  ./nas.sh preflight ${ENV_FILE:+--env-file $(shell_quote "$ENV_FILE")}
  ./nas.sh status ${ENV_FILE:+--env-file $(shell_quote "$ENV_FILE")}
  ./nas.sh install --dry-run ${ENV_FILE:+--env-file $(shell_quote "$ENV_FILE")}

常用连通性检查：
  nc -vz 172.16.60.198 32333
  nc -vz ${NAS_IP:-<nas-ip>} ${SEAWEEDFS_EXTERNAL_VOLUME_PORT:-8080}
  nc -vz ${NAS_IP:-<nas-ip>} ${SEAWEEDFS_EXTERNAL_VOLUME_GRPC_PORT:-18080}
EOF
}

run_step() {
  local step="$1"
  shift

  log "$step"
  "$@" && return 0
  local status=$?
  echo "ERROR: ${step} 失败，退出码 ${status}" >&2
  print_failure_hint "$step"
  exit "$status"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

shell_quote() {
  printf '%q' "$1"
}

parse_args() {
  if [[ $# -gt 0 ]]; then
    case "$1" in
      install | preflight | deploy-k8s | deploy-nas | status | status-nas | render-env | render-volume-command | uninstall-nas)
        ACTION="$1"
        shift
        ;;
    esac
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env-file)
        ENV_FILE="$2"
        shift 2
        ;;
      --kubeconfig)
        KUBECONFIG_PATH="$2"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        die "未知参数: $1"
        ;;
    esac
  done
}

json_field() {
  local file="$1"
  local field="$2"

  python3 - "$file" "$field" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
field = sys.argv[2]
data = json.loads(path.read_text())
value = data.get(field)
if value is None:
    raise SystemExit(f"{path} 缺少字段: {field}")
print(value)
PY
}

load_config() {
  require_cmd python3
  [[ -f "$NAS_CONFIG" ]] || die "找不到 NAS 配置: $NAS_CONFIG"

  NAS_NAME="$(json_field "$NAS_CONFIG" name)"
  NAS_IP="$(json_field "$NAS_CONFIG" ip)"
  NAS_SSH_USER="$(json_field "$NAS_CONFIG" sshUser)"
  NAS_SSH_PASSWORD="$(json_field "$NAS_CONFIG" sshPassword)"
  NAS_SSH_PORT="$(json_field "$NAS_CONFIG" sshPort)"
  NAS_ARCH="$(json_field "$NAS_CONFIG" arch)"

  [[ "$NAS_ARCH" == "amd64" || "$NAS_ARCH" == "arm64" ]] || \
    die "infra/k8s/cluster/nas.json arch 只支持 amd64 或 arm64: $NAS_ARCH"
}

set_defaults() {
  SEAWEEDFS_NAS_ROOT="${SEAWEEDFS_NAS_ROOT:-/volume1/cola/seaweedfs}"
  SEAWEEDFS_NAS_BIN_DIR="${SEAWEEDFS_NAS_BIN_DIR:-${SEAWEEDFS_NAS_ROOT%/}/bin}"
  SEAWEEDFS_NAS_RUN_DIR="${SEAWEEDFS_NAS_RUN_DIR:-${SEAWEEDFS_NAS_ROOT%/}/run}"
  SEAWEEDFS_NAS_LOG_DIR="${SEAWEEDFS_NAS_LOG_DIR:-${SEAWEEDFS_NAS_ROOT%/}/logs}"
  SEAWEEDFS_NAS_VOLUME_DIR="${SEAWEEDFS_NAS_VOLUME_DIR:-${SEAWEEDFS_NAS_ROOT%/}/volume}"
  SEAWEEDFS_NAS_WEED_BIN="${SEAWEEDFS_NAS_WEED_BIN:-${SEAWEEDFS_NAS_BIN_DIR%/}/weed}"
  SEAWEEDFS_NAS_START_SCRIPT="${SEAWEEDFS_NAS_START_SCRIPT:-${SEAWEEDFS_NAS_BIN_DIR%/}/start-volume.sh}"
  SEAWEEDFS_NAS_PID_FILE="${SEAWEEDFS_NAS_PID_FILE:-${SEAWEEDFS_NAS_RUN_DIR%/}/weed-volume.pid}"
  SEAWEEDFS_NAS_LOG_FILE="${SEAWEEDFS_NAS_LOG_FILE:-${SEAWEEDFS_NAS_LOG_DIR%/}/weed-volume.log}"
  SEAWEEDFS_NAS_LOG_MARKER_FILE="${SEAWEEDFS_NAS_LOG_MARKER_FILE:-${SEAWEEDFS_NAS_RUN_DIR%/}/weed-volume.log.marker}"

  SEAWEEDFS_DOWNLOAD_BASE_URL="${SEAWEEDFS_DOWNLOAD_BASE_URL:-https://github.com/seaweedfs/seaweedfs/releases/download}"
  SEAWEEDFS_DOWNLOAD_VERSION="${SEAWEEDFS_DOWNLOAD_VERSION:-${SEAWEEDFS_IMAGE_TAG:-4.26}}"
  SEAWEEDFS_DOWNLOAD_URL="${SEAWEEDFS_DOWNLOAD_URL:-}"

  SEAWEEDFS_NAS_VOLUME_PORT="${SEAWEEDFS_NAS_VOLUME_PORT:-8080}"
  SEAWEEDFS_NAS_VOLUME_GRPC_PORT="${SEAWEEDFS_NAS_VOLUME_GRPC_PORT:-18080}"
  SEAWEEDFS_NAS_VOLUME_MAX="${SEAWEEDFS_NAS_VOLUME_MAX:-0}"
  SEAWEEDFS_NAS_VOLUME_MIN_FREE_SPACE="${SEAWEEDFS_NAS_VOLUME_MIN_FREE_SPACE:-100GiB}"
  SEAWEEDFS_NAS_VOLUME_DATA_CENTER="${SEAWEEDFS_NAS_VOLUME_DATA_CENTER:-xdream}"
  SEAWEEDFS_NAS_VOLUME_RACK="${SEAWEEDFS_NAS_VOLUME_RACK:-nas}"
  SEAWEEDFS_NAS_VOLUME_DISK="${SEAWEEDFS_NAS_VOLUME_DISK:-hdd}"
  SEAWEEDFS_NAS_VOLUME_INDEX="${SEAWEEDFS_NAS_VOLUME_INDEX:-leveldbMedium}"

  SEAWEEDFS_REPLICATION="${SEAWEEDFS_REPLICATION:-000}"
  if [[ "$SEAWEEDFS_REPLICATION" != "000" && "${SEAWEEDFS_ALLOW_SINGLE_NAS_REPLICATION:-false}" != "true" ]]; then
    die "当前 NAS 一键模式只有一个 external volume server，SEAWEEDFS_REPLICATION 必须为 000。请设置 SEAWEEDFS_REPLICATION=000；如你已手动扩展多个 volume server，可显式设置 SEAWEEDFS_ALLOW_SINGLE_NAS_REPLICATION=true。"
  fi

  if [[ -z "${SEAWEEDFS_ENABLE_SECURITY:-}" ]]; then
    SEAWEEDFS_ENABLE_SECURITY=false
  elif [[ "$SEAWEEDFS_ENABLE_SECURITY" != "false" && "$SEAWEEDFS_ENABLE_SECURITY" != "0" && "${SEAWEEDFS_ALLOW_EXTERNAL_SECURITY:-false}" != "true" ]]; then
    die "NAS external volume 模式暂不自动同步 SeaweedFS security 配置。请设置 SEAWEEDFS_ENABLE_SECURITY=false，或显式设置 SEAWEEDFS_ALLOW_EXTERNAL_SECURITY=true 后自行保证 K8s 和 NAS 使用同一套 security 配置。"
  fi
  SEAWEEDFS_VOLUME_MODE=external
  SEAWEEDFS_MASTER_NODEPORT_ENABLED=true
  SEAWEEDFS_EXTERNAL_VOLUME_IP="${SEAWEEDFS_EXTERNAL_VOLUME_IP:-$NAS_IP}"
  SEAWEEDFS_EXTERNAL_VOLUME_DIR="${SEAWEEDFS_EXTERNAL_VOLUME_DIR:-$SEAWEEDFS_NAS_VOLUME_DIR}"
  SEAWEEDFS_EXTERNAL_VOLUME_WEED_BIN="${SEAWEEDFS_EXTERNAL_VOLUME_WEED_BIN:-$SEAWEEDFS_NAS_WEED_BIN}"
  SEAWEEDFS_EXTERNAL_VOLUME_PORT="${SEAWEEDFS_EXTERNAL_VOLUME_PORT:-$SEAWEEDFS_NAS_VOLUME_PORT}"
  SEAWEEDFS_EXTERNAL_VOLUME_GRPC_PORT="${SEAWEEDFS_EXTERNAL_VOLUME_GRPC_PORT:-$SEAWEEDFS_NAS_VOLUME_GRPC_PORT}"
  SEAWEEDFS_EXTERNAL_VOLUME_MAX="${SEAWEEDFS_EXTERNAL_VOLUME_MAX:-$SEAWEEDFS_NAS_VOLUME_MAX}"
  SEAWEEDFS_EXTERNAL_VOLUME_MIN_FREE_SPACE="${SEAWEEDFS_EXTERNAL_VOLUME_MIN_FREE_SPACE:-$SEAWEEDFS_NAS_VOLUME_MIN_FREE_SPACE}"
  SEAWEEDFS_EXTERNAL_VOLUME_DATA_CENTER="${SEAWEEDFS_EXTERNAL_VOLUME_DATA_CENTER:-$SEAWEEDFS_NAS_VOLUME_DATA_CENTER}"
  SEAWEEDFS_EXTERNAL_VOLUME_RACK="${SEAWEEDFS_EXTERNAL_VOLUME_RACK:-$SEAWEEDFS_NAS_VOLUME_RACK}"
  SEAWEEDFS_EXTERNAL_VOLUME_DISK="${SEAWEEDFS_EXTERNAL_VOLUME_DISK:-$SEAWEEDFS_NAS_VOLUME_DISK}"
  SEAWEEDFS_EXTERNAL_VOLUME_INDEX="${SEAWEEDFS_EXTERNAL_VOLUME_INDEX:-$SEAWEEDFS_NAS_VOLUME_INDEX}"
}

load_env_overrides() {
  [[ -z "$ENV_FILE" ]] && return 0
  [[ -f "$ENV_FILE" ]] || die "找不到 env 文件: $ENV_FILE"

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

seaweedfs_env_exports() {
  cat <<EOF
SEAWEEDFS_VOLUME_MODE=$(shell_quote "$SEAWEEDFS_VOLUME_MODE")
SEAWEEDFS_ENABLE_SECURITY=$(shell_quote "$SEAWEEDFS_ENABLE_SECURITY")
SEAWEEDFS_EXTERNAL_VOLUME_IP=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_IP")
SEAWEEDFS_EXTERNAL_VOLUME_DIR=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_DIR")
SEAWEEDFS_EXTERNAL_VOLUME_WEED_BIN=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_WEED_BIN")
SEAWEEDFS_EXTERNAL_VOLUME_PORT=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_PORT")
SEAWEEDFS_EXTERNAL_VOLUME_GRPC_PORT=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_GRPC_PORT")
SEAWEEDFS_EXTERNAL_VOLUME_MAX=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_MAX")
SEAWEEDFS_EXTERNAL_VOLUME_MIN_FREE_SPACE=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_MIN_FREE_SPACE")
SEAWEEDFS_EXTERNAL_VOLUME_DATA_CENTER=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_DATA_CENTER")
SEAWEEDFS_EXTERNAL_VOLUME_RACK=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_RACK")
SEAWEEDFS_EXTERNAL_VOLUME_DISK=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_DISK")
SEAWEEDFS_EXTERNAL_VOLUME_INDEX=$(shell_quote "$SEAWEEDFS_EXTERNAL_VOLUME_INDEX")
SEAWEEDFS_REPLICATION=$(shell_quote "$SEAWEEDFS_REPLICATION")
SEAWEEDFS_MASTER_NODEPORT_ENABLED=$(shell_quote "${SEAWEEDFS_MASTER_NODEPORT_ENABLED:-true}")
SEAWEEDFS_MASTER_NODEPORT_SERVICE_NAME=$(shell_quote "${SEAWEEDFS_MASTER_NODEPORT_SERVICE_NAME:-seaweedfs-master-nodeport}")
SEAWEEDFS_MASTER_NODE_PORT=$(shell_quote "${SEAWEEDFS_MASTER_NODE_PORT:-32333}")
SEAWEEDFS_MASTER_GRPC_NODE_PORT=$(shell_quote "${SEAWEEDFS_MASTER_GRPC_NODE_PORT:-32334}")
SEAWEEDFS_VOLUME_SIZE_LIMIT_MB=$(shell_quote "${SEAWEEDFS_VOLUME_SIZE_LIMIT_MB:-30000}")
EOF
}

apply_seaweedfs_env() {
  set -a
  eval "$(seaweedfs_env_exports)"
  set +a
}

render_volume_command() {
  apply_seaweedfs_env
  SEAWEEDFS_SKIP_ENV_FILE=1 "$SEAWEEDFS_DEPLOY" render-external-volume-command
}

run_deploy() {
  local action="$1"
  shift || true

  local -a args=("$action")
  if [[ -n "$KUBECONFIG_PATH" ]]; then
    args+=(--kubeconfig "$KUBECONFIG_PATH")
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    args+=(--dry-run)
  fi
  args+=("$@")

  log "执行 SeaweedFS deploy.sh ${action}"
  apply_seaweedfs_env
  SEAWEEDFS_SKIP_ENV_FILE=1 "$SEAWEEDFS_DEPLOY" "${args[@]}"
}

run_deploy_k8s_core() {
  SEAWEEDFS_CREATE_BUCKET_JOB=0 run_deploy install
}

require_ssh_tools() {
  require_cmd ssh
  require_cmd sshpass
}

ssh_base() {
  local stderr_file
  local status

  stderr_file="$(mktemp)"
  sshpass -p "$NAS_SSH_PASSWORD" ssh \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    -p "$NAS_SSH_PORT" \
    "${NAS_SSH_USER}@${NAS_IP}" \
    "$@" \
    2>"$stderr_file" || status=$?

  sed '/^Could not chdir to home directory .*: No such file or directory$/d' "$stderr_file" >&2 || true
  rm -f "$stderr_file"
  return "${status:-0}"
}

remote_sudo() {
  local script="$1"

  ssh_base "printf '%s\n' $(shell_quote "$NAS_SSH_PASSWORD") | sudo -S -p '' bash -lc $(shell_quote "$script")"
}

run_or_print_remote_sudo() {
  local description="$1"
  local script="$2"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry-run NAS sudo: $description"
    printf '%s\n' "$script"
    return 0
  fi

  remote_sudo "$script"
}

preflight_local() {
  require_cmd python3
  require_cmd bash
  require_cmd nc

  if [[ "$DRY_RUN" -ne 1 ]]; then
    require_ssh_tools
  fi

  [[ -x "$SEAWEEDFS_DEPLOY" ]] || die "deploy.sh 不可执行: $SEAWEEDFS_DEPLOY"
  bash -n "$SEAWEEDFS_DEPLOY"
  bash -n "$0"
  render_volume_command >/dev/null
}

preflight_k8s() {
  run_deploy status
  run_deploy render-values >/dev/null
  run_deploy render-master-service >/dev/null
}

preflight_nas_script() {
  cat <<EOF
set -euo pipefail

echo "nas-host=\$(hostname 2>/dev/null || true)"
echo "user=\$(id -un)"
echo "arch=\$(uname -m)"
command -v sudo >/dev/null
command -v tar >/dev/null
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1 && [[ ! -x $(shell_quote "$SEAWEEDFS_NAS_WEED_BIN") ]]; then
  echo "NAS 缺少 curl/wget，且 $(shell_quote "$SEAWEEDFS_NAS_WEED_BIN") 不存在" >&2
  exit 1
fi
mkdir -p $(shell_quote "$SEAWEEDFS_NAS_VOLUME_DIR")
test -w $(shell_quote "$SEAWEEDFS_NAS_VOLUME_DIR")
df -h $(shell_quote "$SEAWEEDFS_NAS_VOLUME_DIR")
EOF
}

preflight_nas() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    run_or_print_remote_sudo "preflight NAS" "$(preflight_nas_script)"
    return 0
  fi

  require_ssh_tools
  ssh_base "true"
  remote_sudo "$(preflight_nas_script)"
}

preflight() {
  run_step "本地依赖检查" preflight_local
  run_step "Kubernetes 配置渲染检查" preflight_k8s
  run_step "NAS SSH/sudo/目录检查" preflight_nas
}

detect_asset_name() {
  case "$NAS_ARCH" in
    amd64)
      printf '%s\n' "linux_amd64.tar.gz"
      ;;
    arm64)
      printf '%s\n' "linux_arm64.tar.gz"
      ;;
    *)
      die "不支持的 NAS arch: $NAS_ARCH"
      ;;
  esac
}

download_url() {
  if [[ -n "$SEAWEEDFS_DOWNLOAD_URL" ]]; then
    printf '%s\n' "$SEAWEEDFS_DOWNLOAD_URL"
    return 0
  fi

  printf '%s/%s/%s\n' \
    "${SEAWEEDFS_DOWNLOAD_BASE_URL%/}" \
    "$SEAWEEDFS_DOWNLOAD_VERSION" \
    "$(detect_asset_name)"
}

prepare_nas_script() {
  local url
  url="$(download_url)"

  cat <<EOF
set -euo pipefail

mkdir -p $(shell_quote "$SEAWEEDFS_NAS_BIN_DIR") $(shell_quote "$SEAWEEDFS_NAS_RUN_DIR") $(shell_quote "$SEAWEEDFS_NAS_LOG_DIR") $(shell_quote "$SEAWEEDFS_NAS_VOLUME_DIR")

install_weed=0
if [[ ! -x $(shell_quote "$SEAWEEDFS_NAS_WEED_BIN") ]]; then
  install_weed=1
else
  current_version="\$($(shell_quote "$SEAWEEDFS_NAS_WEED_BIN") version 2>/dev/null | awk '{print \$3}' | head -n 1 || true)"
  if [[ "\$current_version" != $(shell_quote "$SEAWEEDFS_DOWNLOAD_VERSION") ]]; then
    echo "SeaweedFS weed version mismatch: current=\${current_version:-unknown}, target=$(shell_quote "$SEAWEEDFS_DOWNLOAD_VERSION")"
    install_weed=1
  fi
fi

if [[ "\$install_weed" -eq 1 ]]; then
  tmp_dir="\$(mktemp -d)"
  cleanup() { rm -rf "\$tmp_dir"; }
  trap cleanup EXIT
  archive="\$tmp_dir/seaweedfs.tar.gz"
  download_ok=0
  if command -v curl >/dev/null 2>&1; then
    if curl --http1.1 --retry 5 --retry-delay 2 --retry-all-errors -fL $(shell_quote "$url") -o "\$archive"; then
      download_ok=1
    fi
  fi
  if [[ "\$download_ok" -ne 1 ]] && command -v wget >/dev/null 2>&1; then
    if wget --tries=5 --waitretry=2 -O "\$archive" $(shell_quote "$url"); then
      download_ok=1
    fi
  fi
  if [[ "\$download_ok" -ne 1 ]]; then
    echo "NAS 缺少 curl/wget，无法下载 SeaweedFS: $url" >&2
    exit 1
  fi
  [[ -s "\$archive" ]] || { echo "SeaweedFS 下载文件为空: $url" >&2; exit 1; }
  tar -xzf "\$archive" -C "\$tmp_dir"
  weed_path="\$(find "\$tmp_dir" -type f -name weed | head -n 1)"
  [[ -n "\$weed_path" ]] || { echo "SeaweedFS archive 中没有找到 weed 二进制" >&2; exit 1; }
  install -m 0755 "\$weed_path" $(shell_quote "$SEAWEEDFS_NAS_WEED_BIN")
fi

cat > $(shell_quote "$SEAWEEDFS_NAS_START_SCRIPT") <<'SH'
$(render_volume_command)
SH
chmod 0755 $(shell_quote "$SEAWEEDFS_NAS_START_SCRIPT")
EOF
}

current_log_script() {
  cat <<'EOF'
print_current_log() {
  if [[ ! -f "$log_file" ]]; then
    echo "weed volume log file not found: $log_file"
    return 0
  fi

  marker=""
  if [[ -s "$marker_file" ]]; then
    marker="$(cat "$marker_file" 2>/dev/null || true)"
  fi

  if [[ -n "$marker" ]] && grep -Fqx "$marker" "$log_file" 2>/dev/null; then
    awk -v marker="$marker" '
      $0 == marker { found = 1; count = 0 }
      found {
        lines[++count] = $0
        if (count > 80) delete lines[count - 80]
      }
      END {
        first = count > 80 ? count - 79 : 1
        for (i = first; i <= count; i++) {
          if (i in lines) print lines[i]
        }
      }
    ' "$log_file"
    return 0
  fi

  awk '
    /Start Seaweed volume server / { count = 0 }
    {
      lines[++count] = $0
      if (count > 80) delete lines[count - 80]
    }
    END {
      first = count > 80 ? count - 79 : 1
      for (i = first; i <= count; i++) {
        if (i in lines) print lines[i]
      }
    }
  ' "$log_file"
}
EOF
}

start_nas_script() {
  cat <<EOF
set -euo pipefail

pid_file=$(shell_quote "$SEAWEEDFS_NAS_PID_FILE")
log_file=$(shell_quote "$SEAWEEDFS_NAS_LOG_FILE")
marker_file=$(shell_quote "$SEAWEEDFS_NAS_LOG_MARKER_FILE")
start_script=$(shell_quote "$SEAWEEDFS_NAS_START_SCRIPT")

[[ -x "\$start_script" ]] || { echo "NAS start script not found or not executable: \$start_script" >&2; exit 1; }
mkdir -p "\$(dirname "\$pid_file")" "\$(dirname "\$log_file")" "\$(dirname "\$marker_file")"

$(current_log_script)

if [[ -f "\$pid_file" ]]; then
  old_pid="\$(cat "\$pid_file" 2>/dev/null || true)"
  if [[ -n "\$old_pid" ]] && kill -0 "\$old_pid" >/dev/null 2>&1; then
    kill "\$old_pid" || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "\$old_pid" >/dev/null 2>&1 || break
      sleep 1
    done
    if kill -0 "\$old_pid" >/dev/null 2>&1; then
      echo "旧 weed volume 进程未退出，拒绝启动第二个进程: \$old_pid" >&2
      exit 1
    fi
  fi
fi

start_marker="===== seaweedfs volume start \$(date '+%Y-%m-%dT%H:%M:%S%z') ====="
printf '\\n%s\\n' "\$start_marker" >>"\$log_file"
printf '%s\\n' "\$start_marker" >"\$marker_file"
nohup "\$start_script" >>"\$log_file" 2>&1 &
new_pid="\$!"
echo "\$new_pid" >"\$pid_file"
sleep 2
cat "\$pid_file"
print_current_log || true
if ! kill -0 "\$new_pid" >/dev/null 2>&1; then
  echo "weed volume 启动后未保持运行: \$new_pid" >&2
  exit 1
fi
EOF
}

status_nas_script() {
  cat <<EOF
set -euo pipefail

pid_file=$(shell_quote "$SEAWEEDFS_NAS_PID_FILE")
log_file=$(shell_quote "$SEAWEEDFS_NAS_LOG_FILE")
marker_file=$(shell_quote "$SEAWEEDFS_NAS_LOG_MARKER_FILE")
status=0

$(current_log_script)

if [[ -f "\$pid_file" ]]; then
  pid="\$(cat "\$pid_file" 2>/dev/null || true)"
  if [[ -n "\$pid" ]] && kill -0 "\$pid" >/dev/null 2>&1; then
    echo "weed volume running: \$pid"
  else
    echo "weed volume pid file exists but process is not running: \${pid:-empty}"
    status=1
  fi
else
  echo "weed volume pid file not found"
  status=1
fi

df -h $(shell_quote "$SEAWEEDFS_NAS_VOLUME_DIR") || true
print_current_log || true
exit "\$status"
EOF
}

stop_nas_script() {
  cat <<EOF
set -euo pipefail

pid_file=$(shell_quote "$SEAWEEDFS_NAS_PID_FILE")
if [[ -f "\$pid_file" ]]; then
  pid="\$(cat "\$pid_file" 2>/dev/null || true)"
  if [[ -n "\$pid" ]] && kill -0 "\$pid" >/dev/null 2>&1; then
    kill "\$pid"
  fi
  rm -f "\$pid_file"
fi
EOF
}

deploy_nas() {
  if [[ "$DRY_RUN" -ne 1 ]]; then
    require_ssh_tools
  fi
  run_or_print_remote_sudo "prepare weed binary and start script" "$(prepare_nas_script)" || return
  run_or_print_remote_sudo "start weed volume" "$(start_nas_script)" || return
}

status_nas() {
  if [[ "$DRY_RUN" -ne 1 ]]; then
    require_ssh_tools
  fi
  log "查看 NAS ${NAS_NAME} (${NAS_IP}) SeaweedFS 状态"
  run_or_print_remote_sudo "status weed volume" "$(status_nas_script)"
}

uninstall_nas() {
  if [[ "$DRY_RUN" -ne 1 ]]; then
    require_ssh_tools
  fi
  log "停止 NAS ${NAS_NAME} (${NAS_IP}) 上的 weed volume，保留数据目录"
  run_or_print_remote_sudo "stop weed volume" "$(stop_nas_script)"
}

one_key_install() {
  run_step "一键部署前置检查" preflight
  run_step "部署 Kubernetes SeaweedFS core" run_deploy_k8s_core
  run_step "部署并启动 NAS weed volume" deploy_nas
  run_step "初始化 SeaweedFS S3 bucket" run_deploy bucket-init
  run_step "运行 SeaweedFS smoke test" run_deploy smoke-test
  run_step "检查 NAS weed volume 状态" status_nas
  log "SeaweedFS NAS external volume 一键部署完成"
}

main() {
  parse_args "$@"
  load_config
  load_env_overrides
  set_defaults

  case "$ACTION" in
    render-env)
      seaweedfs_env_exports
      ;;
    render-volume-command)
      render_volume_command
      ;;
    preflight)
      preflight
      ;;
    deploy-k8s)
      run_step "部署 Kubernetes SeaweedFS" run_deploy install
      ;;
    deploy-nas)
      run_step "部署并启动 NAS weed volume" deploy_nas
      ;;
    install)
      one_key_install
      ;;
    status)
      run_step "检查 Kubernetes SeaweedFS 状态" run_deploy status
      run_step "检查 NAS weed volume 状态" status_nas
      ;;
    status-nas)
      run_step "检查 NAS weed volume 状态" status_nas
      ;;
    uninstall-nas)
      run_step "停止 NAS weed volume" uninstall_nas
      ;;
    *)
      die "未知 action: $ACTION"
      ;;
  esac
}

main "$@"
