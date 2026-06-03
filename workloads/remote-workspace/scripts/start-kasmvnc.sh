#!/usr/bin/env bash

set -euo pipefail

export HOME="${HOME:-/home/worker}"
export DISPLAY="${DISPLAY:-:1}"
export KASMVNC_PORT="${KASMVNC_PORT:-6080}"
export KASMVNC_GEOMETRY="${KASMVNC_GEOMETRY:-1600x900}"
export KASMVNC_DEPTH="${KASMVNC_DEPTH:-24}"
export VNC_DISABLE_PASSWORD="${VNC_DISABLE_PASSWORD:-0}"
export KASMVNC_SEND_CUT_TEXT="${KASMVNC_SEND_CUT_TEXT:-1}"
export KASMVNC_ACCEPT_CUT_TEXT="${KASMVNC_ACCEPT_CUT_TEXT:-1}"

display_number="${DISPLAY#:}"
session_pid=""
vnc_pid=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if [[ -n "$session_pid" ]] && kill -0 "$session_pid" 2>/dev/null; then
    kill "$session_pid" 2>/dev/null || true
  fi

  if [[ -n "$vnc_pid" ]] && kill -0 "$vnc_pid" 2>/dev/null; then
    kill "$vnc_pid" 2>/dev/null || true
  fi

  wait "$session_pid" 2>/dev/null || true
  wait "$vnc_pid" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT INT TERM

cleanup_desktop_session() {
  local patterns=(
    "gnome-session"
    "gnome-shell"
    "mutter"
    "gjs"
    "xdg-desktop-portal"
    "ibus-daemon"
    "dbus-daemon"
    "dbus-run-session"
  )

  for pattern in "${patterns[@]}"; do
    pkill -u "$(id -u)" -f "$pattern" 2>/dev/null || true
  done
}

rm -f "/tmp/.X${display_number}-lock" "/tmp/.X11-unix/X${display_number}" 2>/dev/null || true
cleanup_desktop_session
mkdir -p "$HOME/.vnc" /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix 2>/dev/null || true

auth_args=()
if [[ "$VNC_DISABLE_PASSWORD" = "1" ]]; then
  auth_args=(-disableBasicAuth -SecurityTypes None)
else
  auth_args=(-KasmPasswordFile "$HOME/.kasmpasswd")
fi

Xvnc "$DISPLAY" \
  -geometry "$KASMVNC_GEOMETRY" \
  -depth "$KASMVNC_DEPTH" \
  -interface 0.0.0.0 \
  -websocketPort "$KASMVNC_PORT" \
  -httpd /usr/share/kasmvnc/www \
  -AcceptSetDesktopSize \
  -SendCutText="$KASMVNC_SEND_CUT_TEXT" \
  -AcceptCutText="$KASMVNC_ACCEPT_CUT_TEXT" \
  -DisconnectClients=1 \
  "${auth_args[@]}" &
vnc_pid=$!

for _ in $(seq 1 100); do
  if ! kill -0 "$vnc_pid" 2>/dev/null; then
    wait "$vnc_pid"
  fi

  if [[ -S "/tmp/.X11-unix/X${display_number}" ]]; then
    break
  fi

  sleep 0.1
done

if [[ ! -S "/tmp/.X11-unix/X${display_number}" ]]; then
  echo "Timed out waiting for Xvnc display socket $DISPLAY" >&2
  exit 1
fi

/opt/remote-work/start-ubuntu-session.sh &
session_pid=$!

wait -n "$vnc_pid" "$session_pid"
