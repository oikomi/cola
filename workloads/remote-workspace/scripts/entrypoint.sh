#!/usr/bin/env bash

set -euo pipefail

export HOME=/home/worker
export DISPLAY="${DISPLAY:-:1}"
export RESOLUTION="${RESOLUTION:-1600x900x24}"
export KASMVNC_PORT="${KASMVNC_PORT:-6080}"
export VNC_DISABLE_PASSWORD="${VNC_DISABLE_PASSWORD:-0}"
export KASMVNC_USER="${KASMVNC_USER:-worker}"
export WORKSPACE_NAME="${WORKSPACE_NAME:-workspace}"
export COLA_SHARED_STORAGE_DIR="${COLA_SHARED_STORAGE_DIR:-/shared-dist-storage}"

VNC_PASSWORD="${VNC_PASSWORD:-ChangeMe-123!}"
if [[ "${#VNC_PASSWORD}" -lt 6 ]]; then
  echo "VNC_PASSWORD must be at least 6 characters for KasmVNC." >&2
  exit 1
fi

if [[ "$RESOLUTION" =~ ^([0-9]+x[0-9]+)(x([0-9]+))?$ ]]; then
  KASMVNC_GEOMETRY="${BASH_REMATCH[1]}"
  KASMVNC_DEPTH="${BASH_REMATCH[3]:-24}"
else
  KASMVNC_GEOMETRY="1600x900"
  KASMVNC_DEPTH="24"
fi
export KASMVNC_GEOMETRY
export KASMVNC_DEPTH

mkdir -p "$HOME/.vnc" "$COLA_SHARED_STORAGE_DIR"
cat >"$HOME/.vnc/kasmvnc.yaml" <<EOF
network:
  protocol: http
  interface: 0.0.0.0
  websocket_port: ${KASMVNC_PORT}
  use_ipv4: true
  use_ipv6: false
  ssl:
    require_ssl: false
server:
  advanced:
    kasm_password_file: ${HOME}/.kasmpasswd
command_line:
  prompt: false
EOF
mkdir -p "$HOME/.config" "$HOME/.local/share"
if [[ ! -s /etc/machine-id ]]; then
  dbus-uuidgen >/etc/machine-id 2>/dev/null || true
fi

if [[ ! -d /run/systemd/system ]]; then
  rm -rf /run/systemd/seats
fi

chown -R worker:worker "$HOME"
chown worker:worker "$COLA_SHARED_STORAGE_DIR" 2>/dev/null || true

/opt/remote-work/setup-home.sh
chown -R worker:worker "$HOME"
chown worker:worker "$COLA_SHARED_STORAGE_DIR" 2>/dev/null || true

printf '%s\n%s\n' "$VNC_PASSWORD" "$VNC_PASSWORD" \
  | sudo -H -u worker vncpasswd -u "$KASMVNC_USER" -w >/dev/null

exec /usr/bin/supervisord -c /opt/remote-work/supervisord.conf
