#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
TEMPLATE_FILE="$ROOT_DIR/docker/runner-dashboard-proxy.Caddyfile.example"
TARGET_FILE="$ROOT_DIR/docker/runner-dashboard-proxy.Caddyfile"

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <openclaw_domain> <hermes_domain> <cola_origin>"
  echo "Example: $0 openclaw.example.com hermes.example.com https://cola.example.com"
  exit 1
fi

OPENCLAW_DOMAIN="$1"
HERMES_DOMAIN="$2"
COLA_ORIGIN="$3"

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Missing template file: $TEMPLATE_FILE" >&2
  exit 1
fi

cp "$TEMPLATE_FILE" "$TARGET_FILE"

python3 - "$TARGET_FILE" "$OPENCLAW_DOMAIN" "$HERMES_DOMAIN" <<'PY'
import pathlib
import sys

target = pathlib.Path(sys.argv[1])
openclaw = sys.argv[2]
hermes = sys.argv[3]
content = target.read_text()
content = content.replace("openclaw.example.com", openclaw)
content = content.replace("hermes.example.com", hermes)
target.write_text(content)
PY

python3 - "$ENV_FILE" "$OPENCLAW_DOMAIN" "$HERMES_DOMAIN" "$COLA_ORIGIN" <<'PY'
import pathlib
import re
import sys

env_path = pathlib.Path(sys.argv[1])
openclaw = sys.argv[2]
hermes = sys.argv[3]
cola_origin = sys.argv[4]

existing = env_path.read_text() if env_path.exists() else ""

updates = {
    "COLA_DASHBOARD_BIND_HOST": '"0.0.0.0"',
    "COLA_OPENCLAW_DASHBOARD_PUBLIC_HOST": f'"{openclaw}"',
    "COLA_HERMES_DASHBOARD_PUBLIC_HOST": f'"{hermes}"',
    "COLA_DASHBOARD_ALLOWED_ORIGINS": f'"{cola_origin},https://{openclaw}"',
    "NEXT_PUBLIC_OPENCLAW_NATIVE_URL": f'"https://{openclaw}/"',
    "NEXT_PUBLIC_HERMES_NATIVE_URL": f'"https://{hermes}/"',
}

for key, value in updates.items():
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    line = f"{key}={value}"
    if pattern.search(existing):
      existing = pattern.sub(line, existing)
    else:
      if existing and not existing.endswith("\n"):
        existing += "\n"
      existing += line + "\n"

env_path.write_text(existing)
PY

cat <<EOF
Generated:
  $TARGET_FILE

Updated:
  $ENV_FILE

Next steps:
  1. Ensure DNS for $OPENCLAW_DOMAIN and $HERMES_DOMAIN points to this host.
  2. Start proxy:
     docker compose -f docker/runner-dashboard-proxy.compose.yml up -d
  3. Restart Cola:
     ./restart.sh -f
  4. Recreate runner personas so they pick up the new dashboard settings.
EOF
