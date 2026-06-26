import { SEAWEEDFS_FUSE_IMAGE } from "../../lib/seaweedfs.ts";

type WorkVolumeEnv = Readonly<Record<string, string | undefined>>;

type WorkVolume = {
  name: string;
  persistentVolumeClaim?: {
    claimName: string;
  };
  hostPath?: {
    path: string;
    type?: "Directory" | "DirectoryOrCreate" | "CharDevice" | "File";
  };
  emptyDir?: Record<string, never>;
};

type VirtualWorkVolume = {
  name: string;
};

type WorkVolumeMount = {
  name: string;
  mountPath: string;
  readOnly?: boolean;
  mountPropagation?: "HostToContainer" | "Bidirectional";
};

type WorkContainer = {
  name: string;
  image: string;
  imagePullPolicy?: string;
  restartPolicy?: "Always";
  command?: string[];
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  volumeMounts?: WorkVolumeMount[];
  securityContext?: {
    runAsUser?: number;
    runAsGroup?: number;
    privileged?: boolean;
    allowPrivilegeEscalation?: boolean;
    capabilities?: {
      add: string[];
    };
  };
  startupProbe?: {
    exec: {
      command: string[];
    };
    failureThreshold: number;
    periodSeconds: number;
    timeoutSeconds: number;
  };
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
};

type WorkVolumeMode = "seaweedfs" | "smb" | "hostPath" | "pvc" | "emptyDir";

type WorkVolumeSource = {
  mode: WorkVolumeMode;
  volume: WorkVolume | VirtualWorkVolume;
  volumes: WorkVolume[];
  mountPath: string;
  mountPropagation?: "HostToContainer";
  initContainers: WorkContainer[];
  containerVolumeMounts: WorkVolumeMount[];
  containerEnv: Array<{ name: string; value: string }>;
  containerSecurityContext?: WorkContainer["securityContext"];
  shellPrefix: string | null;
};

type WorkVolumeMountMode = "seaweedfs" | "smb";

const DEFAULT_SEAWEEDFS_IMAGE = SEAWEEDFS_FUSE_IMAGE;
const DEFAULT_SEAWEEDFS_FILER =
  "seaweedfs-filer.storage.svc.cluster.local:8888";
const DEFAULT_SEAWEEDFS_FILER_PATH = "/buckets/xdream";
const DEFAULT_SEAWEEDFS_CACHE_DIR = "/var/cache/seaweedfs";
const SEAWEEDFS_TOOLS_DIR = "/opt/cola-seaweedfs";
const DEFAULT_SMB_TOOLS_IMAGE = "ubuntu:22.04";
const DEFAULT_SMB_SERVER = "172.16.60.47";
const DEFAULT_SMB_SHARE_NAME = "xdream";
const DEFAULT_SMB_SUBPATH = "cloud";
const DEFAULT_SMB_URL = `smb://${DEFAULT_SMB_SERVER}/${DEFAULT_SMB_SHARE_NAME}/${DEFAULT_SMB_SUBPATH}`;
const DEFAULT_SMB_USERNAME = "xdream";
const DEFAULT_SMB_PASSWORD = "NAS-a1@123";
const DEFAULT_SMB_MOUNT_OPTIONS =
  "vers=3.0,iocharset=utf8,uid=1000,gid=1000,file_mode=0777,dir_mode=0777,noperm";
const SMB_TOOLS_DIR = "/opt/cola-smb";
const SMB_CREDENTIALS_DIR = "/run/cola-smb";
const SMB_CREDENTIALS_PATH = `${SMB_CREDENTIALS_DIR}/credentials`;
const DEFAULT_SMB_SHARE_MOUNT_DIR = "/run/cola-smb/share";
export const SHARED_STORAGE_MOUNT_PATH = "/shared-dist-storage";

function firstEnvValue(env: WorkVolumeEnv, names: string[]) {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }

  return null;
}

function isEnabled(value: string | null, defaultValue: boolean) {
  if (value === null) return defaultValue;

  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function resolveMountPath(input: {
  env: WorkVolumeEnv;
  defaultMountPath: string;
  mountPathEnvNames?: string[];
  hostPathMountPathEnvNames?: string[];
  pvcMountPathEnvNames?: string[];
}) {
  return (
    firstEnvValue(input.env, [
      ...(input.mountPathEnvNames ?? []),
      ...(input.hostPathMountPathEnvNames ?? []),
      ...(input.pvcMountPathEnvNames ?? []),
    ]) ?? input.defaultMountPath
  );
}

function volumeName(base: string, suffix: string) {
  return `${base}-${suffix}`.slice(0, 63).replace(/-+$/g, "");
}

function normalizeSmbSource(value: string, defaultShareName: string) {
  const source = value.replace(/^smb:\/\//i, "//");
  const withoutPrefix = source.startsWith("//") ? source.slice(2) : source;
  if (withoutPrefix.includes("/")) return source;

  return `//${withoutPrefix}/${defaultShareName}`;
}

function resolveSmbTarget(env: WorkVolumeEnv) {
  const shareName =
    firstEnvValue(env, ["COLA_SMB_SHARE_NAME"]) ?? DEFAULT_SMB_SHARE_NAME;
  const configuredSource =
    firstEnvValue(env, ["COLA_SMB_URL", "COLA_SMB_SOURCE", "COLA_SMB_SHARE"]) ??
    DEFAULT_SMB_URL;
  const normalizedSource = normalizeSmbSource(configuredSource, shareName);
  const match = /^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(normalizedSource);

  if (!match) {
    return {
      source: normalizedSource,
      subPath: "",
      url: configuredSource,
    };
  }

  const [, server, share, rawSubPath = ""] = match;
  const subPathParts = rawSubPath
    .split("/")
    .filter((part) => part.length > 0 && part !== ".");
  if (subPathParts.some((part) => part === "..")) {
    throw new Error(`不支持的 SMB 子目录：${rawSubPath}。`);
  }
  const subPath = subPathParts.join("/");

  return {
    source: `//${server}/${share}`,
    subPath,
    url: configuredSource,
  };
}

function resolveWorkVolumeMountMode(input: {
  env: WorkVolumeEnv;
  mountModeEnvNames?: string[];
  seaweedfsEnabledEnvNames?: string[];
  defaultMountMode?: WorkVolumeMountMode;
}) {
  const configuredMode = firstEnvValue(input.env, [
    ...(input.mountModeEnvNames ?? []),
    "COLA_WORK_VOLUME_MOUNT_MODE",
  ]);
  if (configuredMode) {
    const normalized = configuredMode.toLowerCase();
    if (normalized === "smb" || normalized === "cifs") return "smb";
    if (normalized === "seaweedfs" || normalized === "fuse") {
      return "seaweedfs";
    }
    if (normalized === "legacy" || normalized === "hostpath") return null;

    throw new Error(
      `不支持的工作目录挂载模式：${configuredMode}。可选值：smb、seaweedfs、legacy。`,
    );
  }

  const seaweedfsConfigured = firstEnvValue(input.env, [
    ...(input.seaweedfsEnabledEnvNames ?? []),
    "COLA_SEAWEEDFS_MOUNT_ENABLED",
  ]);
  if (seaweedfsConfigured !== null) {
    if (isEnabled(seaweedfsConfigured, true)) return "seaweedfs";

    return input.defaultMountMode === "smb" ? "smb" : null;
  }

  return input.defaultMountMode ?? "seaweedfs";
}

function buildSeaweedfsInstallCommand() {
  return `set -eu
mkdir -p "${SEAWEEDFS_TOOLS_DIR}"
cp "$(command -v weed)" "${SEAWEEDFS_TOOLS_DIR}/weed"
chmod 0755 "${SEAWEEDFS_TOOLS_DIR}/weed"
for cola_fusermount_path in /bin/fusermount /usr/bin/fusermount /bin/fusermount3 /usr/bin/fusermount3; do
  if [ -x "$cola_fusermount_path" ]; then
    cp "$cola_fusermount_path" "${SEAWEEDFS_TOOLS_DIR}/fusermount"
    chmod 0755 "${SEAWEEDFS_TOOLS_DIR}/fusermount"
    break
  fi
done
if [ -e /lib/ld-musl-x86_64.so.1 ]; then
  cp /lib/ld-musl-x86_64.so.1 "${SEAWEEDFS_TOOLS_DIR}/ld-musl-x86_64.so.1"
  chmod 0755 "${SEAWEEDFS_TOOLS_DIR}/ld-musl-x86_64.so.1"
fi

mkdir -p "$COLA_SEAWEEDFS_CACHE_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R "$COLA_SEAWEEDFS_MOUNT_UID:\${COLA_SEAWEEDFS_MOUNT_GID:-$COLA_SEAWEEDFS_MOUNT_UID}" "$COLA_SEAWEEDFS_CACHE_DIR"
fi
chmod 0777 "$COLA_SEAWEEDFS_CACHE_DIR" || true

cat > "${SEAWEEDFS_TOOLS_DIR}/mount-workdir.sh" <<'SH'
#!/bin/sh
set -eu
mkdir -p "$COLA_SEAWEEDFS_MOUNT_DIR" "$COLA_SEAWEEDFS_CACHE_DIR"
if [ -x "${SEAWEEDFS_TOOLS_DIR}/fusermount" ]; then
  mkdir -p /bin /usr/bin
  cp "${SEAWEEDFS_TOOLS_DIR}/fusermount" /bin/fusermount
  cp "${SEAWEEDFS_TOOLS_DIR}/fusermount" /usr/bin/fusermount
  chmod 0755 /bin/fusermount /usr/bin/fusermount
fi
if [ -e "${SEAWEEDFS_TOOLS_DIR}/ld-musl-x86_64.so.1" ]; then
  cp "${SEAWEEDFS_TOOLS_DIR}/ld-musl-x86_64.so.1" /lib/ld-musl-x86_64.so.1
  chmod 0755 /lib/ld-musl-x86_64.so.1
fi

extra_args=""
if [ -n "\${COLA_SEAWEEDFS_ALLOW_OTHERS:-}" ]; then
  if [ "$(id -u)" = "0" ]; then
    mkdir -p /etc
    touch /etc/fuse.conf
    if ! grep -qs "^user_allow_other" /etc/fuse.conf; then
      echo user_allow_other >> /etc/fuse.conf
    fi
    extra_args="$extra_args -allowOthers=$COLA_SEAWEEDFS_ALLOW_OTHERS"
  elif grep -qs "^user_allow_other" /etc/fuse.conf 2>/dev/null; then
    extra_args="$extra_args -allowOthers=$COLA_SEAWEEDFS_ALLOW_OTHERS"
  else
    echo "COLA_SEAWEEDFS_ALLOW_OTHERS requested but /etc/fuse.conf does not allow it; continuing without allow_other" >&2
  fi
fi
if [ "$(id -u)" = "0" ] && [ -n "\${COLA_SEAWEEDFS_MOUNT_UID:-}" ]; then
  chown -R "$COLA_SEAWEEDFS_MOUNT_UID:\${COLA_SEAWEEDFS_MOUNT_GID:-$COLA_SEAWEEDFS_MOUNT_UID}" "$COLA_SEAWEEDFS_MOUNT_DIR" "$COLA_SEAWEEDFS_CACHE_DIR"
fi
if [ -n "\${COLA_SEAWEEDFS_MOUNT_UMASK:-}" ]; then
  extra_args="$extra_args -umask=$COLA_SEAWEEDFS_MOUNT_UMASK"
fi
if [ -n "\${COLA_SEAWEEDFS_MAP_UID:-}" ]; then
  extra_args="$extra_args -map.uid=$COLA_SEAWEEDFS_MAP_UID"
fi
if [ -n "\${COLA_SEAWEEDFS_MAP_GID:-}" ]; then
  extra_args="$extra_args -map.gid=$COLA_SEAWEEDFS_MAP_GID"
fi
if [ -n "\${COLA_SEAWEEDFS_VOLUME_SERVER_ACCESS:-}" ]; then
  extra_args="$extra_args -volumeServerAccess=$COLA_SEAWEEDFS_VOLUME_SERVER_ACCESS"
fi

exec "${SEAWEEDFS_TOOLS_DIR}/weed" mount \\
  -filer="$COLA_SEAWEEDFS_FILER" \\
  -dir="$COLA_SEAWEEDFS_MOUNT_DIR" \\
  -filer.path="$COLA_SEAWEEDFS_FILER_PATH" \\
  -cacheDir="$COLA_SEAWEEDFS_CACHE_DIR" \\
  -cacheCapacityMB="$COLA_SEAWEEDFS_CACHE_CAPACITY_MB" \\
  -chunkSizeLimitMB="$COLA_SEAWEEDFS_CHUNK_SIZE_LIMIT_MB" \\
  -nonempty \\
  $extra_args
SH
chmod 0755 "${SEAWEEDFS_TOOLS_DIR}/mount-workdir.sh"`;
}

function buildSeaweedfsShellPrefix() {
  return `if [ -x "${SEAWEEDFS_TOOLS_DIR}/mount-workdir.sh" ]; then
  "${SEAWEEDFS_TOOLS_DIR}/mount-workdir.sh" &
  cola_seaweedfs_mount_pid=$!
  cola_seaweedfs_waited=0
  cola_seaweedfs_timeout="\${COLA_SEAWEEDFS_MOUNT_READY_TIMEOUT_SECONDS:-60}"
  while [ "$cola_seaweedfs_waited" -lt "$cola_seaweedfs_timeout" ]; do
    if grep -qs " $COLA_SEAWEEDFS_MOUNT_DIR fuse.seaweedfs " /proc/mounts || grep -qs " $COLA_SEAWEEDFS_MOUNT_DIR fuse " /proc/mounts; then
      break
    fi
    if ! kill -0 "$cola_seaweedfs_mount_pid" 2>/dev/null; then
      echo "SeaweedFS mount process exited before $COLA_SEAWEEDFS_MOUNT_DIR became ready" >&2
      exit 1
    fi
    cola_seaweedfs_waited=$((cola_seaweedfs_waited + 1))
    sleep 1
  done
  if ! grep -qs " $COLA_SEAWEEDFS_MOUNT_DIR fuse.seaweedfs " /proc/mounts && ! grep -qs " $COLA_SEAWEEDFS_MOUNT_DIR fuse " /proc/mounts; then
    echo "Timed out waiting for SeaweedFS mount at $COLA_SEAWEEDFS_MOUNT_DIR" >&2
    cat /proc/mounts >&2
    kill "$cola_seaweedfs_mount_pid" 2>/dev/null || true
    exit 1
  fi
fi`;
}

function buildSeaweedfsEnv(input: {
  env: WorkVolumeEnv;
  mountPath: string;
  cacheDir: string;
}) {
  return [
    {
      name: "COLA_SHARED_STORAGE_DIR",
      value: input.mountPath,
    },
    {
      name: "COLA_SEAWEEDFS_FILER",
      value:
        firstEnvValue(input.env, ["COLA_SEAWEEDFS_FILER"]) ??
        DEFAULT_SEAWEEDFS_FILER,
    },
    {
      name: "COLA_SEAWEEDFS_FILER_PATH",
      value:
        firstEnvValue(input.env, ["COLA_SEAWEEDFS_FILER_PATH"]) ??
        DEFAULT_SEAWEEDFS_FILER_PATH,
    },
    {
      name: "COLA_SEAWEEDFS_MOUNT_DIR",
      value: input.mountPath,
    },
    {
      name: "COLA_SEAWEEDFS_CACHE_DIR",
      value: input.cacheDir,
    },
    {
      name: "COLA_SEAWEEDFS_CACHE_CAPACITY_MB",
      value:
        firstEnvValue(input.env, ["COLA_SEAWEEDFS_CACHE_CAPACITY_MB"]) ??
        "4096",
    },
    {
      name: "COLA_SEAWEEDFS_CHUNK_SIZE_LIMIT_MB",
      value:
        firstEnvValue(input.env, ["COLA_SEAWEEDFS_CHUNK_SIZE_LIMIT_MB"]) ??
        "32",
    },
    {
      name: "COLA_SEAWEEDFS_ALLOW_OTHERS",
      value:
        firstEnvValue(input.env, ["COLA_SEAWEEDFS_ALLOW_OTHERS"]) ?? "true",
    },
    {
      name: "COLA_SEAWEEDFS_MOUNT_UID",
      value: firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_UID"]) ?? "1000",
    },
    {
      name: "COLA_SEAWEEDFS_MOUNT_GID",
      value: firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_GID"]) ?? "1000",
    },
    {
      name: "COLA_SEAWEEDFS_MOUNT_UMASK",
      value: firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_UMASK"]) ?? "000",
    },
    {
      name: "COLA_SEAWEEDFS_MAP_UID",
      value: firstEnvValue(input.env, ["COLA_SEAWEEDFS_MAP_UID"]) ?? "",
    },
    {
      name: "COLA_SEAWEEDFS_MAP_GID",
      value: firstEnvValue(input.env, ["COLA_SEAWEEDFS_MAP_GID"]) ?? "",
    },
    {
      name: "COLA_SEAWEEDFS_VOLUME_SERVER_ACCESS",
      value:
        firstEnvValue(input.env, ["COLA_SEAWEEDFS_VOLUME_SERVER_ACCESS"]) ?? "",
    },
    {
      name: "COLA_SEAWEEDFS_MOUNT_READY_TIMEOUT_SECONDS",
      value:
        firstEnvValue(input.env, [
          "COLA_SEAWEEDFS_MOUNT_READY_TIMEOUT_SECONDS",
        ]) ?? "60",
    },
  ];
}

function resolveSeaweedfsWorkVolume(input: {
  env: WorkVolumeEnv;
  volumeName: string;
  mountPath: string;
}): WorkVolumeSource {
  const cacheVolumeName = volumeName(input.volumeName, "seaweedfs-cache");
  const fuseVolumeName = volumeName(input.volumeName, "fuse-device");
  const toolsVolumeName = volumeName(input.volumeName, "seaweedfs-tools");
  const installContainerName = volumeName(input.volumeName, "seaweedfs-tools");
  const cacheDir =
    firstEnvValue(input.env, ["COLA_SEAWEEDFS_CACHE_DIR"]) ??
    DEFAULT_SEAWEEDFS_CACHE_DIR;
  const runMountAsRoot = isEnabled(
    firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_RUN_AS_ROOT"]),
    true,
  );
  const containerEnv = buildSeaweedfsEnv({
    env: input.env,
    mountPath: input.mountPath,
    cacheDir,
  });
  const privileged = isEnabled(
    firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_PRIVILEGED"]),
    true,
  );
  const containerSecurityContext = {
    runAsUser: runMountAsRoot ? 0 : undefined,
    runAsGroup: runMountAsRoot ? 0 : undefined,
    ...(privileged ? { privileged } : {}),
    allowPrivilegeEscalation: true,
    capabilities: {
      add: ["SYS_ADMIN"],
    },
  } satisfies WorkContainer["securityContext"];

  const volume = {
    name: input.volumeName,
  } satisfies VirtualWorkVolume;

  return {
    mode: "seaweedfs",
    volume,
    volumes: [
      {
        name: cacheVolumeName,
        emptyDir: {},
      },
      {
        name: fuseVolumeName,
        hostPath: {
          path: "/dev/fuse",
          type: "CharDevice",
        },
      },
      {
        name: toolsVolumeName,
        emptyDir: {},
      },
    ],
    mountPath: input.mountPath,
    initContainers: [
      {
        name: installContainerName,
        image:
          firstEnvValue(input.env, ["COLA_SEAWEEDFS_IMAGE"]) ??
          DEFAULT_SEAWEEDFS_IMAGE,
        imagePullPolicy:
          firstEnvValue(input.env, ["COLA_SEAWEEDFS_IMAGE_PULL_POLICY"]) ??
          "IfNotPresent",
        command: ["sh", "-lc"],
        args: [buildSeaweedfsInstallCommand()],
        env: containerEnv,
        volumeMounts: [
          {
            name: cacheVolumeName,
            mountPath: cacheDir,
          },
          {
            name: toolsVolumeName,
            mountPath: SEAWEEDFS_TOOLS_DIR,
          },
        ],
        resources: {
          requests: {
            cpu:
              firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_CPU_REQUEST"]) ??
              "50m",
            memory:
              firstEnvValue(input.env, [
                "COLA_SEAWEEDFS_MOUNT_MEMORY_REQUEST",
              ]) ?? "128Mi",
          },
          limits: {
            cpu:
              firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_CPU_LIMIT"]) ??
              "500m",
            memory:
              firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_MEMORY_LIMIT"]) ??
              "512Mi",
          },
        },
      },
    ],
    containerVolumeMounts: [
      {
        name: cacheVolumeName,
        mountPath: cacheDir,
      },
      {
        name: fuseVolumeName,
        mountPath: "/dev/fuse",
      },
      {
        name: toolsVolumeName,
        mountPath: SEAWEEDFS_TOOLS_DIR,
        readOnly: true,
      },
    ],
    containerEnv,
    containerSecurityContext,
    shellPrefix: buildSeaweedfsShellPrefix(),
  };
}

function buildSmbInstallCommand() {
  return `set -eu
mkdir -p "${SMB_TOOLS_DIR}"
copy_mount_cifs() {
  cola_mount_cifs_path="$1"
  mkdir -p "${SMB_TOOLS_DIR}/lib"
  cp "$cola_mount_cifs_path" "${SMB_TOOLS_DIR}/mount.cifs"
  chmod 0755 "${SMB_TOOLS_DIR}/mount.cifs"
  if command -v ldd >/dev/null 2>&1; then
    ldd "$cola_mount_cifs_path" | awk '/=> \\/.*\\// { print $3 } /^\\// { print $1 }' | while IFS= read -r cola_lib_path; do
      [ -r "$cola_lib_path" ] || continue
      cp -L "$cola_lib_path" "${SMB_TOOLS_DIR}/lib/"
    done
  fi
}
for cola_mount_cifs_path in /sbin/mount.cifs /usr/sbin/mount.cifs /bin/mount.cifs /usr/bin/mount.cifs; do
  if [ -x "$cola_mount_cifs_path" ]; then
    copy_mount_cifs "$cola_mount_cifs_path"
    exit 0
  fi
done
if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends cifs-utils
  rm -rf /var/lib/apt/lists/*
  copy_mount_cifs "$(command -v mount.cifs)"
  exit 0
fi
echo "mount.cifs not found in SMB tools image. Use COLA_SMB_TOOLS_IMAGE with cifs-utils installed." >&2
exit 1`;
}

function buildSmbShellPrefix() {
  return `mkdir -p "$COLA_SMB_MOUNT_DIR" "\${COLA_SMB_SHARE_MOUNT_DIR:-${DEFAULT_SMB_SHARE_MOUNT_DIR}}" "${SMB_CREDENTIALS_DIR}"
chmod 0777 "$COLA_SMB_MOUNT_DIR" || true
if grep -qs " $COLA_SMB_MOUNT_DIR cifs " /proc/mounts; then
  :
else
  cola_smb_mount_target="$COLA_SMB_MOUNT_DIR"
  if [ -n "\${COLA_SMB_SUBPATH:-}" ]; then
    cola_smb_mount_target="\${COLA_SMB_SHARE_MOUNT_DIR:-${DEFAULT_SMB_SHARE_MOUNT_DIR}}"
  fi
  if [ ! -x "${SMB_TOOLS_DIR}/mount.cifs" ] && ! command -v mount.cifs >/dev/null 2>&1; then
    echo "mount.cifs is not available; install cifs-utils in the workload image or configure COLA_SMB_TOOLS_IMAGE." >&2
    exit 1
  fi
  cola_smb_previous_umask="$(umask)"
  umask 077
  {
    printf 'username=%s\\n' "$COLA_SMB_USERNAME"
    printf 'password=%s\\n' "$COLA_SMB_PASSWORD"
    if [ -n "\${COLA_SMB_DOMAIN:-}" ]; then
      printf 'domain=%s\\n' "$COLA_SMB_DOMAIN"
    fi
  } > "${SMB_CREDENTIALS_PATH}"
  umask "$cola_smb_previous_umask"
  chmod 0600 "${SMB_CREDENTIALS_PATH}"
  if grep -qs " $cola_smb_mount_target cifs " /proc/mounts; then
    :
  elif [ -x "${SMB_TOOLS_DIR}/mount.cifs" ]; then
    LD_LIBRARY_PATH="${SMB_TOOLS_DIR}/lib:\${LD_LIBRARY_PATH:-}" "${SMB_TOOLS_DIR}/mount.cifs" "$COLA_SMB_SOURCE" "$cola_smb_mount_target" -o "credentials=${SMB_CREDENTIALS_PATH},$COLA_SMB_MOUNT_OPTIONS"
  else
    mount -t cifs "$COLA_SMB_SOURCE" "$cola_smb_mount_target" -o "credentials=${SMB_CREDENTIALS_PATH},$COLA_SMB_MOUNT_OPTIONS"
  fi
  if [ -n "\${COLA_SMB_SUBPATH:-}" ]; then
    mkdir -p "$cola_smb_mount_target/$COLA_SMB_SUBPATH"
    mount --bind "$cola_smb_mount_target/$COLA_SMB_SUBPATH" "$COLA_SMB_MOUNT_DIR"
  fi
  chmod 0777 "$COLA_SMB_MOUNT_DIR" || true
fi`;
}

function buildSmbEnv(input: {
  env: WorkVolumeEnv;
  mountPath: string;
  source: string;
  subPath: string;
  url: string;
}) {
  return [
    {
      name: "COLA_SHARED_STORAGE_DIR",
      value: input.mountPath,
    },
    {
      name: "COLA_SMB_SOURCE",
      value: input.source,
    },
    {
      name: "COLA_SMB_SUBPATH",
      value: input.subPath,
    },
    {
      name: "COLA_SMB_URL",
      value: input.url,
    },
    {
      name: "COLA_SMB_USERNAME",
      value:
        firstEnvValue(input.env, ["COLA_SMB_USERNAME"]) ?? DEFAULT_SMB_USERNAME,
    },
    {
      name: "COLA_SMB_PASSWORD",
      value:
        firstEnvValue(input.env, ["COLA_SMB_PASSWORD"]) ?? DEFAULT_SMB_PASSWORD,
    },
    {
      name: "COLA_SMB_DOMAIN",
      value: firstEnvValue(input.env, ["COLA_SMB_DOMAIN"]) ?? "",
    },
    {
      name: "COLA_SMB_MOUNT_DIR",
      value: input.mountPath,
    },
    {
      name: "COLA_SMB_SHARE_MOUNT_DIR",
      value:
        firstEnvValue(input.env, ["COLA_SMB_SHARE_MOUNT_DIR"]) ??
        DEFAULT_SMB_SHARE_MOUNT_DIR,
    },
    {
      name: "COLA_SMB_MOUNT_OPTIONS",
      value:
        firstEnvValue(input.env, ["COLA_SMB_MOUNT_OPTIONS"]) ??
        DEFAULT_SMB_MOUNT_OPTIONS,
    },
  ];
}

function resolveSmbWorkVolume(input: {
  env: WorkVolumeEnv;
  volumeName: string;
  mountPath: string;
}): WorkVolumeSource {
  const toolsVolumeName = volumeName(input.volumeName, "smb-tools");
  const installContainerName = volumeName(input.volumeName, "smb-tools");
  const target = resolveSmbTarget(input.env);
  const containerEnv = buildSmbEnv({
    env: input.env,
    mountPath: input.mountPath,
    source: target.source,
    subPath: target.subPath,
    url: target.url,
  });
  const privileged = isEnabled(
    firstEnvValue(input.env, ["COLA_SMB_MOUNT_PRIVILEGED"]),
    true,
  );
  const runMountAsRoot = isEnabled(
    firstEnvValue(input.env, ["COLA_SMB_MOUNT_RUN_AS_ROOT"]),
    true,
  );
  const containerSecurityContext = {
    runAsUser: runMountAsRoot ? 0 : undefined,
    runAsGroup: runMountAsRoot ? 0 : undefined,
    ...(privileged ? { privileged } : {}),
    allowPrivilegeEscalation: true,
    capabilities: {
      add: ["SYS_ADMIN"],
    },
  } satisfies WorkContainer["securityContext"];
  const volume = {
    name: input.volumeName,
  } satisfies VirtualWorkVolume;

  return {
    mode: "smb",
    volume,
    volumes: [
      {
        name: toolsVolumeName,
        emptyDir: {},
      },
    ],
    mountPath: input.mountPath,
    initContainers: [
      {
        name: installContainerName,
        image:
          firstEnvValue(input.env, ["COLA_SMB_TOOLS_IMAGE"]) ??
          DEFAULT_SMB_TOOLS_IMAGE,
        imagePullPolicy:
          firstEnvValue(input.env, ["COLA_SMB_TOOLS_IMAGE_PULL_POLICY"]) ??
          "IfNotPresent",
        command: ["sh", "-lc"],
        args: [buildSmbInstallCommand()],
        env: containerEnv,
        volumeMounts: [
          {
            name: toolsVolumeName,
            mountPath: SMB_TOOLS_DIR,
          },
        ],
        resources: {
          requests: {
            cpu:
              firstEnvValue(input.env, ["COLA_SMB_MOUNT_CPU_REQUEST"]) ?? "25m",
            memory:
              firstEnvValue(input.env, ["COLA_SMB_MOUNT_MEMORY_REQUEST"]) ??
              "64Mi",
          },
          limits: {
            cpu:
              firstEnvValue(input.env, ["COLA_SMB_MOUNT_CPU_LIMIT"]) ?? "250m",
            memory:
              firstEnvValue(input.env, ["COLA_SMB_MOUNT_MEMORY_LIMIT"]) ??
              "256Mi",
          },
        },
      },
    ],
    containerVolumeMounts: [
      {
        name: toolsVolumeName,
        mountPath: SMB_TOOLS_DIR,
        readOnly: true,
      },
    ],
    containerEnv,
    containerSecurityContext,
    shellPrefix: buildSmbShellPrefix(),
  };
}

function resolveLegacyWorkVolume(input: {
  env: WorkVolumeEnv;
  volumeName: string;
  mountPath: string;
  hostPathEnvNames?: string[];
  hostPathType?: "Directory" | "DirectoryOrCreate";
  pvcNameEnvNames?: string[];
  fallbackHostPath?: {
    path: string;
    type: "Directory" | "DirectoryOrCreate";
  };
}): WorkVolumeSource {
  const hostPath = firstEnvValue(input.env, input.hostPathEnvNames ?? []);
  if (hostPath) {
    const volume = {
      name: input.volumeName,
      hostPath: {
        path: hostPath,
        type: input.hostPathType ?? "Directory",
      },
    } satisfies WorkVolume;

    return {
      mode: "hostPath",
      volume,
      volumes: [volume],
      mountPath: input.mountPath,
      mountPropagation: "HostToContainer",
      initContainers: [],
      containerVolumeMounts: [
        {
          name: volume.name,
          mountPath: input.mountPath,
          mountPropagation: "HostToContainer",
        },
      ],
      containerEnv: [
        {
          name: "COLA_SHARED_STORAGE_DIR",
          value: input.mountPath,
        },
      ],
      shellPrefix: null,
    };
  }

  const pvcName = firstEnvValue(input.env, input.pvcNameEnvNames ?? []);
  if (pvcName) {
    const volume = {
      name: input.volumeName,
      persistentVolumeClaim: {
        claimName: pvcName,
      },
    } satisfies WorkVolume;

    return {
      mode: "pvc",
      volume,
      volumes: [volume],
      mountPath: input.mountPath,
      initContainers: [],
      containerVolumeMounts: [
        {
          name: volume.name,
          mountPath: input.mountPath,
        },
      ],
      containerEnv: [
        {
          name: "COLA_SHARED_STORAGE_DIR",
          value: input.mountPath,
        },
      ],
      shellPrefix: null,
    };
  }

  if (input.fallbackHostPath) {
    const volume = {
      name: input.volumeName,
      hostPath: input.fallbackHostPath,
    } satisfies WorkVolume;

    return {
      mode: "hostPath",
      volume,
      volumes: [volume],
      mountPath: input.mountPath,
      mountPropagation: "HostToContainer",
      initContainers: [],
      containerVolumeMounts: [
        {
          name: volume.name,
          mountPath: input.mountPath,
          mountPropagation: "HostToContainer",
        },
      ],
      containerEnv: [
        {
          name: "COLA_SHARED_STORAGE_DIR",
          value: input.mountPath,
        },
      ],
      shellPrefix: null,
    };
  }

  const volume = {
    name: input.volumeName,
    emptyDir: {},
  } satisfies WorkVolume;

  return {
    mode: "emptyDir",
    volume,
    volumes: [volume],
    mountPath: input.mountPath,
    initContainers: [],
    containerVolumeMounts: [
      {
        name: volume.name,
        mountPath: input.mountPath,
      },
    ],
    containerEnv: [
      {
        name: "COLA_SHARED_STORAGE_DIR",
        value: input.mountPath,
      },
    ],
    shellPrefix: null,
  };
}

export function resolveKubernetesWorkVolume(input: {
  env: WorkVolumeEnv;
  volumeName: string;
  defaultMountPath: string;
  defaultMountMode?: WorkVolumeMountMode;
  mountModeEnvNames?: string[];
  seaweedfsEnabledEnvNames?: string[];
  mountPathEnvNames?: string[];
  hostPathEnvNames?: string[];
  hostPathType?: "Directory" | "DirectoryOrCreate";
  hostPathMountPathEnvNames?: string[];
  pvcNameEnvNames?: string[];
  pvcMountPathEnvNames?: string[];
  fallbackHostPath?: {
    path: string;
    type: "Directory" | "DirectoryOrCreate";
  };
}): WorkVolumeSource {
  const mountPath = resolveMountPath(input);
  const mountMode = resolveWorkVolumeMountMode(input);

  if (mountMode === "smb") {
    return resolveSmbWorkVolume({
      env: input.env,
      volumeName: input.volumeName,
      mountPath,
    });
  }

  if (mountMode === "seaweedfs") {
    return resolveSeaweedfsWorkVolume({
      env: input.env,
      volumeName: input.volumeName,
      mountPath,
    });
  }

  return resolveLegacyWorkVolume({
    env: input.env,
    volumeName: input.volumeName,
    mountPath,
    hostPathEnvNames: input.hostPathEnvNames,
    hostPathType: input.hostPathType,
    pvcNameEnvNames: input.pvcNameEnvNames,
    fallbackHostPath: input.fallbackHostPath,
  });
}

export function buildWorkVolumeMount(workVolume: WorkVolumeSource) {
  return workVolume.containerVolumeMounts[0]!;
}

export function buildWorkVolumeMounts(workVolume: WorkVolumeSource) {
  return workVolume.containerVolumeMounts;
}

export function buildWorkVolumes(workVolume: WorkVolumeSource) {
  return workVolume.volumes;
}

export function buildWorkVolumeInitContainers(workVolume: WorkVolumeSource) {
  return workVolume.initContainers;
}

export function buildWorkVolumeEnv(workVolume: WorkVolumeSource) {
  return workVolume.containerEnv;
}

export function buildWorkVolumeSecurityContext(workVolume: WorkVolumeSource) {
  return workVolume.containerSecurityContext;
}

export function buildWorkVolumeShellCommand(
  workVolume: WorkVolumeSource,
  command: string,
) {
  return workVolume.shellPrefix
    ? `${workVolume.shellPrefix}\n\n${command}`
    : command;
}

export function buildWorkVolumeWorkingDir(workVolume: WorkVolumeSource) {
  return workVolume.mode === "seaweedfs" ? "/" : workVolume.mountPath;
}
