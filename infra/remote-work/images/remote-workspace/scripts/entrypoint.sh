#!/usr/bin/env bash

set -euo pipefail

export HOME=/home/worker
export DISPLAY="${DISPLAY:-:1}"
export RESOLUTION="${RESOLUTION:-1920x1080x24}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export VNC_PORT="${VNC_PORT:-5901}"

VNC_PASSWORD="${VNC_PASSWORD:-ChangeMe-123!}"

mkdir -p "$HOME/.vnc" /workspace
chown -R worker:worker "$HOME" /workspace

sudo -u worker x11vnc -storepasswd "$VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null

exec /usr/bin/supervisord -c /opt/remote-work/supervisord.conf

