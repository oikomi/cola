#!/usr/bin/env bash
# Use this script to start a docker container for a local development database

# TO RUN ON WINDOWS:
# 1. Install WSL (Windows Subsystem for Linux) - https://learn.microsoft.com/en-us/windows/wsl/install
# 2. Install Docker Desktop or Podman Deskop
# - Docker Desktop for Windows - https://docs.docker.com/docker-for-windows/install/
# - Podman Desktop - https://podman.io/getting-started/installation
# 3. Open WSL - `wsl`
# 4. Run this script - `./start-database.sh`

# On Linux and macOS you can run this script directly - `./start-database.sh`

# import env variables from .env
set -a
source .env

NON_INTERACTIVE="${NON_INTERACTIVE:-0}"

DB_PASSWORD=$(echo "$DATABASE_URL" | awk -F':' '{print $3}' | awk -F'@' '{print $1}')
DB_PORT=$(echo "$DATABASE_URL" | awk -F':' '{print $4}' | awk -F'\/' '{print $1}')
DB_NAME=$(echo "$DATABASE_URL" | awk -F'/' '{print $4}')
DB_CONTAINER_NAME="$DB_NAME-postgres"
DB_VOLUME_NAME="${DB_VOLUME_NAME:-${DB_NAME}-postgres-data}"
DB_IMAGE="${DB_IMAGE:-docker.io/postgres}"

if ! [ -x "$(command -v docker)" ] && ! [ -x "$(command -v podman)" ]; then
  echo -e "Docker or Podman is not installed. Please install docker or podman and try again.\nDocker install guide: https://docs.docker.com/engine/install/\nPodman install guide: https://podman.io/getting-started/installation"
  exit 1
fi

# determine which docker command to use
if [ -x "$(command -v docker)" ]; then
  DOCKER_CMD="docker"
elif [ -x "$(command -v podman)" ]; then
  DOCKER_CMD="podman"
fi

if ! $DOCKER_CMD info > /dev/null 2>&1; then
  echo "$DOCKER_CMD daemon is not running. Please start $DOCKER_CMD and try again."
  exit 1
fi

if ! $DOCKER_CMD volume inspect "$DB_VOLUME_NAME" >/dev/null 2>&1; then
  $DOCKER_CMD volume create "$DB_VOLUME_NAME" >/dev/null
  echo "Created database volume '$DB_VOLUME_NAME'"
fi

get_db_volume_name_for_destination() {
  local destination="$1"
  $DOCKER_CMD inspect "$DB_CONTAINER_NAME" --format "{{range .Mounts}}{{if eq .Type \"volume\"}}{{if eq .Destination \"$destination\"}}{{printf \"%s\\n\" .Name}}{{end}}{{end}}{{end}}" 2>/dev/null | head -n 1
}

container_exists() {
  [ "$($DOCKER_CMD ps -q -a -f name=^/${DB_CONTAINER_NAME}$)" ]
}

container_running() {
  [ "$($DOCKER_CMD ps -q -f name=^/${DB_CONTAINER_NAME}$)" ]
}

migrate_legacy_db_volume_if_needed() {
  container_exists || return 0

  local pg_root_volume=""
  local pg_data_volume=""
  pg_root_volume="$(get_db_volume_name_for_destination "/var/lib/postgresql")"
  pg_data_volume="$(get_db_volume_name_for_destination "/var/lib/postgresql/data")"

  if [[ -z "$pg_root_volume" && -z "$pg_data_volume" ]]; then
    return 0
  fi

  local source_volume=""
  if [[ -n "$pg_root_volume" && "$pg_root_volume" != "$DB_VOLUME_NAME" ]]; then
    source_volume="$pg_root_volume"
  elif [[ -n "$pg_data_volume" && "$pg_data_volume" != "$DB_VOLUME_NAME" ]]; then
    source_volume="$pg_data_volume"
  fi

  local legacy_layout=0
  if [[ -n "$pg_data_volume" ]]; then
    legacy_layout=1
  fi

  if [[ -z "$source_volume" && "$legacy_layout" -eq 0 ]]; then
    return 0
  fi

  if [[ -n "$source_volume" ]]; then
    echo "Migrating database data from volume '$source_volume' to '$DB_VOLUME_NAME'..."
  else
    echo "Recreating database container to remove legacy postgres mount layout..."
  fi

  if container_running; then
    $DOCKER_CMD stop "$DB_CONTAINER_NAME" >/dev/null
  fi

  if [[ -n "$source_volume" ]]; then
    $DOCKER_CMD run --rm \
      -v "$source_volume":/from \
      -v "$DB_VOLUME_NAME":/to \
      "$DB_IMAGE" \
      sh -lc 'mkdir -p /to && if [ -z "$(ls -A /to 2>/dev/null)" ]; then cp -a /from/. /to/; else cp -an /from/. /to/; fi' >/dev/null
  fi

  $DOCKER_CMD rm -f "$DB_CONTAINER_NAME" >/dev/null
  echo "Database container migration completed."
}

migrate_legacy_db_volume_if_needed

if container_running; then
  echo "Database container '$DB_CONTAINER_NAME' already running"
  exit 0
fi

if container_exists; then
  $DOCKER_CMD start "$DB_CONTAINER_NAME"
  echo "Existing database container '$DB_CONTAINER_NAME' started"
  exit 0
fi

if command -v nc >/dev/null 2>&1; then
  if nc -z localhost "$DB_PORT" 2>/dev/null; then
    echo "Port $DB_PORT is already in use."
    exit 1
  fi
else
  echo "Warning: Unable to check if port $DB_PORT is already in use (netcat not installed)"
  if [[ "$NON_INTERACTIVE" == "1" ]]; then
    echo "NON_INTERACTIVE=1, continuing without port preflight confirmation."
  else
    read -p "Do you want to continue anyway? [y/N]: " -r REPLY
    if ! [[ $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborting."
      exit 1
    fi
  fi
fi

if [ "$DB_PASSWORD" = "password" ]; then
  echo "You are using the default database password"
  if [[ "$NON_INTERACTIVE" == "1" ]]; then
    echo "NON_INTERACTIVE=1, keeping the default local development password."
  else
    read -p "Should we generate a random password for you? [y/N]: " -r REPLY
    if ! [[ $REPLY =~ ^[Yy]$ ]]; then
      echo "Please change the default password in the .env file and try again"
      exit 1
    fi
    # Generate a random URL-safe password
    DB_PASSWORD=$(openssl rand -base64 12 | tr '+/' '-_')
    if [[ "$(uname)" == "Darwin" ]]; then
      # macOS requires an empty string to be passed with the `i` flag
      sed -i '' "s#:password@#:$DB_PASSWORD@#" .env
    else
      sed -i "s#:password@#:$DB_PASSWORD@#" .env
    fi
  fi
fi

$DOCKER_CMD run -d \
  --name $DB_CONTAINER_NAME \
  -e POSTGRES_USER="postgres" \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  -v "$DB_VOLUME_NAME":/var/lib/postgresql \
  -p "$DB_PORT":5432 \
  "$DB_IMAGE" && echo "Database container '$DB_CONTAINER_NAME' was successfully created"
