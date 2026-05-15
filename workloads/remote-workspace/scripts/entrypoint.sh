#!/usr/bin/env bash

set -euo pipefail

export HOME=/home/worker
export DISPLAY="${DISPLAY:-:1}"
export RESOLUTION="${RESOLUTION:-1600x900x24}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export VNC_PORT="${VNC_PORT:-5901}"
export VNC_DISABLE_PASSWORD="${VNC_DISABLE_PASSWORD:-0}"
export WORKSPACE_NAME="${WORKSPACE_NAME:-workspace}"
export COLA_SHARED_STORAGE_DIR="${COLA_SHARED_STORAGE_DIR:-/shared-dist-storage}"

VNC_PASSWORD="${VNC_PASSWORD:-ChangeMe-123!}"

mkdir -p "$HOME/.vnc" "$COLA_SHARED_STORAGE_DIR"
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

if [[ "$VNC_DISABLE_PASSWORD" != "1" ]]; then
  sudo -u worker x11vnc -storepasswd "$VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null
fi

exec /usr/bin/supervisord -c /opt/remote-work/supervisord.conf
