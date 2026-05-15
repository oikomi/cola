#!/usr/bin/env bash

set -euo pipefail

export HOME="${HOME:-/home/worker}"
export COLA_SHARED_STORAGE_DIR="${COLA_SHARED_STORAGE_DIR:-/shared-dist-storage}"

CONFIG_ROOT="/opt/remote-work/config"
BASHRC_PATH="$HOME/.bashrc"
PROFILE_MARKER="# cola-workspace-shell"

mkdir -p "$HOME/.config" "$HOME/.local/share"

if [[ -d "$CONFIG_ROOT/.config" ]]; then
  cp -R "$CONFIG_ROOT/.config/." "$HOME/.config/"
fi

if [[ -d "$CONFIG_ROOT/.local" ]]; then
  mkdir -p "$HOME/.local"
  cp -R "$CONFIG_ROOT/.local/." "$HOME/.local/"
fi

if [[ -d "$CONFIG_ROOT/Desktop" ]]; then
  mkdir -p "$HOME/Desktop"
  cp -R "$CONFIG_ROOT/Desktop/." "$HOME/Desktop/"
fi

rm -f \
  "$HOME/Desktop/Google Chrome.desktop" \
  "$HOME/.local/share/applications/google-chrome-workspace.desktop" \
  "$HOME/.local/share/xfce4/helpers/google-chrome-workspace.desktop"

if [[ -f "$BASHRC_PATH" ]]; then
  awk -v marker="$PROFILE_MARKER" '
    $0 == marker { skip=1; next }
    skip && $0 == "# /cola-workspace-shell" { skip=0; next }
    !skip { print }
  ' "$BASHRC_PATH" >"$BASHRC_PATH.tmp"
  mv "$BASHRC_PATH.tmp" "$BASHRC_PATH"
else
  touch "$BASHRC_PATH"
fi

cat >>"$BASHRC_PATH" <<'EOF'
# cola-workspace-shell
export WORKSPACE_PROMPT_NAME="${WORKSPACE_NAME:-workspace}"
if [[ $- == *i* ]] && [[ "$PWD" == "$HOME" || "$PWD" == "$HOME/Desktop" ]]; then
  cd "${COLA_SHARED_STORAGE_DIR:-/shared-dist-storage}" 2>/dev/null || true
fi
alias ll='ls -lah --color=auto'
PS1="\[\033[38;5;111m\]\u\[\033[0m\]@\[\033[38;5;223m\]${WORKSPACE_PROMPT_NAME}\[\033[0m\]:\[\033[38;5;117m\]\w\[\033[0m\]\\$ "
# /cola-workspace-shell
EOF

mkdir -p \
  "$HOME/Desktop" \
  "$HOME/Downloads" \
  "$HOME/.config/gtk-3.0" \
  "$HOME/.config/xfce4" \
  "$HOME/.config/xfce4/terminal" \
  "$HOME/.local/share/applications" \
  "$HOME/.local/share/xfce4/helpers"

if [[ -d "$HOME/Desktop" ]]; then
  find "$HOME/Desktop" -maxdepth 1 -type f -name "*.desktop" -exec chmod +x {} +
fi

cat >"$HOME/.config/xfce4/helpers.rc" <<'EOF'
WebBrowser=firefox-workspace
FileManager=Thunar
TerminalEmulator=xfce4-terminal
EOF

if command -v xdg-settings >/dev/null 2>&1; then
  xdg-settings set default-web-browser firefox-workspace.desktop >/dev/null 2>&1 || true
fi

if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default firefox-workspace.desktop x-scheme-handler/http >/dev/null 2>&1 || true
  xdg-mime default firefox-workspace.desktop x-scheme-handler/https >/dev/null 2>&1 || true
  xdg-mime default firefox-workspace.desktop text/html >/dev/null 2>&1 || true
fi

if command -v xfconf-query >/dev/null 2>&1; then
  for monitor_name in monitor0 monitorscreen; do
    wallpaper="/usr/share/backgrounds/warty-final-ubuntu.png"
    if [[ ! -f "$wallpaper" ]]; then
      wallpaper="/opt/remote-work/assets/workspace-wallpaper.svg"
    fi
    xfconf-query -c xfce4-desktop \
      -p "/backdrop/screen0/${monitor_name}/workspace0/color-style" \
      -n -t int -s 0 >/dev/null 2>&1 || true
    xfconf-query -c xfce4-desktop \
      -p "/backdrop/screen0/${monitor_name}/workspace0/image-show" \
      -n -t bool -s true >/dev/null 2>&1 || true
    xfconf-query -c xfce4-desktop \
      -p "/backdrop/screen0/${monitor_name}/workspace0/image-style" \
      -n -t int -s 5 >/dev/null 2>&1 || true
    xfconf-query -c xfce4-desktop \
      -p "/backdrop/screen0/${monitor_name}/workspace0/image-path" \
      -n -t string -s "$(dirname "$wallpaper")" >/dev/null 2>&1 || true
    xfconf-query -c xfce4-desktop \
      -p "/backdrop/screen0/${monitor_name}/workspace0/image-filename" \
      -n -t string -s "$wallpaper" >/dev/null 2>&1 || true
    xfconf-query -c xfce4-desktop \
      -p "/backdrop/screen0/${monitor_name}/workspace0/last-image" \
      -n -t string -s "$wallpaper" >/dev/null 2>&1 || true
  done
fi
