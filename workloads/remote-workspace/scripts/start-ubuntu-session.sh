#!/usr/bin/env bash

set -euo pipefail

export HOME="${HOME:-/home/worker}"
export DISPLAY="${DISPLAY:-:1}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-worker}"
export XDG_SESSION_TYPE=x11
export XDG_SESSION_DESKTOP=ubuntu
export XDG_CURRENT_DESKTOP=ubuntu:GNOME
export GNOME_SHELL_SESSION_MODE=ubuntu
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
export NO_AT_BRIDGE="${NO_AT_BRIDGE:-1}"

mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

exec dbus-run-session -- bash -lc '
  set -euo pipefail
  apply_gnome_settings() {
    local wallpaper_uri="file:///usr/share/backgrounds/warty-final-ubuntu.png"
    local favorite_apps="['\''org.gnome.Terminal.desktop'\'', '\''org.gnome.Nautilus.desktop'\'']"

    gsettings set org.gnome.desktop.interface gtk-theme Yaru || true
    gsettings set org.gnome.desktop.interface icon-theme Yaru || true
    gsettings set org.gnome.desktop.interface cursor-theme Yaru || true
    gsettings set org.gnome.desktop.interface color-scheme prefer-light || true
    gsettings set org.gnome.desktop.screensaver lock-enabled false || true
    gsettings set org.gnome.desktop.session idle-delay uint32 0 || true

    if [[ -f /usr/share/backgrounds/warty-final-ubuntu.png ]]; then
      gsettings set org.gnome.desktop.background picture-uri "$wallpaper_uri" || true
      gsettings set org.gnome.desktop.background picture-uri-dark "$wallpaper_uri" || true
    fi

    if command -v firefox >/dev/null 2>&1; then
      favorite_apps="['\''firefox-workspace.desktop'\'', '\''org.gnome.Terminal.desktop'\'', '\''org.gnome.Nautilus.desktop'\'']"
    fi

    gsettings set org.gnome.shell favorite-apps "$favorite_apps" || true
    gsettings set org.gnome.shell enabled-extensions \
      "['\''ubuntu-dock@ubuntu.com'\'', '\''ubuntu-appindicators@ubuntu.com'\'', '\''ding@rastersoft.com'\'']" || true
    gsettings set org.gnome.shell.extensions.dash-to-dock dock-position LEFT || true
    gsettings set org.gnome.shell.extensions.dash-to-dock extend-height true || true
  }

  apply_gnome_settings
  exec gnome-session --session=cola-ubuntu
'
