#!/usr/bin/env bash

set -euo pipefail

export HOME="${HOME:-/home/worker}"

CONFIG_ROOT="/opt/remote-work/config"
BASHRC_PATH="$HOME/.bashrc"
PROFILE_MARKER="# cola-workspace-shell"

mkdir -p "$HOME/.config" "$HOME/.local/share"

if [[ -d "$CONFIG_ROOT/.config" ]]; then
  cp -R "$CONFIG_ROOT/.config/." "$HOME/.config/"
fi

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
  cd /workspace 2>/dev/null || true
fi
alias ll='ls -lah --color=auto'
PS1="\[\033[38;5;111m\]\u\[\033[0m\]@\[\033[38;5;223m\]${WORKSPACE_PROMPT_NAME}\[\033[0m\]:\[\033[38;5;117m\]\w\[\033[0m\]\\$ "
# /cola-workspace-shell
EOF

mkdir -p "$HOME/Desktop" "$HOME/.config/gtk-3.0" "$HOME/.config/xfce4/terminal"

