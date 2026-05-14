type WorkVolumeEnv = Readonly<Record<string, string | undefined>>;

type WorkVolume = {
  name: string;
  persistentVolumeClaim?: {
    claimName: string;
  };
  hostPath?: {
    path: string;
    type?: "Directory" | "DirectoryOrCreate" | "CharDevice";
  };
  emptyDir?: Record<string, never>;
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

type WorkVolumeMode = "seaweedfs" | "hostPath" | "pvc" | "emptyDir";

type WorkVolumeSource = {
  mode: WorkVolumeMode;
  volume: WorkVolume;
  volumes: WorkVolume[];
  mountPath: string;
  mountPropagation?: "HostToContainer";
  initContainers: WorkContainer[];
  containerVolumeMounts: WorkVolumeMount[];
  containerEnv: Array<{ name: string; value: string }>;
  containerSecurityContext?: WorkContainer["securityContext"];
  shellPrefix: string | null;
};

const DEFAULT_SEAWEEDFS_IMAGE = "chrislusf/seaweedfs:4.23";
const DEFAULT_SEAWEEDFS_FILER =
  "seaweedfs-filer.storage.svc.cluster.local:8888";
const DEFAULT_SEAWEEDFS_FILER_PATH = "/buckets/cola-training";
const DEFAULT_SEAWEEDFS_CACHE_DIR = "/var/cache/seaweedfs";
const SEAWEEDFS_TOOLS_DIR = "/opt/cola-seaweedfs";
export const SHARED_STORAGE_MOUNT_PATH = "/shared-dist-storage";
const SEAWEEDFS_MOUNT_SUBDIR = ".seaweedfs";

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

function joinPosixPath(base: string, child: string) {
  return `${base.replace(/\/+$/g, "")}/${child.replace(/^\/+/g, "")}`;
}

function buildSeaweedfsInstallCommand() {
  return `set -eu
mkdir -p "${SEAWEEDFS_TOOLS_DIR}"
cp "$(command -v weed)" "${SEAWEEDFS_TOOLS_DIR}/weed"
chmod 0755 "${SEAWEEDFS_TOOLS_DIR}/weed"

mkdir -p "$COLA_SEAWEEDFS_MOUNT_DIR" "$COLA_SEAWEEDFS_CACHE_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R "$COLA_SEAWEEDFS_MOUNT_UID:\${COLA_SEAWEEDFS_MOUNT_GID:-$COLA_SEAWEEDFS_MOUNT_UID}" "$COLA_SEAWEEDFS_MOUNT_DIR" "$COLA_SEAWEEDFS_CACHE_DIR"
fi
chmod 0777 "$COLA_SEAWEEDFS_MOUNT_DIR" "$COLA_SEAWEEDFS_CACHE_DIR" || true

cat > "${SEAWEEDFS_TOOLS_DIR}/mount-workdir.sh" <<'SH'
#!/bin/sh
set -eu
mkdir -p "$COLA_SEAWEEDFS_MOUNT_DIR" "$COLA_SEAWEEDFS_CACHE_DIR"

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
  const mountSubdir =
    firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_SUBDIR"]) ??
    SEAWEEDFS_MOUNT_SUBDIR;
  const mountPath = joinPosixPath(input.mountPath, mountSubdir);
  const containerEnv = buildSeaweedfsEnv({
    env: input.env,
    mountPath,
    cacheDir,
  });
  const containerSecurityContext = {
    privileged: isEnabled(
      firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_PRIVILEGED"]),
      true,
    ),
    allowPrivilegeEscalation: true,
    capabilities: {
      add: ["SYS_ADMIN"],
    },
  } satisfies WorkContainer["securityContext"];

  const volume = {
    name: input.volumeName,
    emptyDir: {},
  } satisfies WorkVolume;

  return {
    mode: "seaweedfs",
    volume,
    volumes: [
      volume,
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
    mountPath,
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
            name: input.volumeName,
            mountPath: input.mountPath,
          },
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
        name: input.volumeName,
        mountPath: input.mountPath,
      },
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

function resolveLegacyWorkVolume(input: {
  env: WorkVolumeEnv;
  volumeName: string;
  mountPath: string;
  hostPathEnvNames?: string[];
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
        type: "Directory",
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
  seaweedfsEnabledEnvNames?: string[];
  mountPathEnvNames?: string[];
  hostPathEnvNames?: string[];
  hostPathMountPathEnvNames?: string[];
  pvcNameEnvNames?: string[];
  pvcMountPathEnvNames?: string[];
  fallbackHostPath?: {
    path: string;
    type: "Directory" | "DirectoryOrCreate";
  };
}): WorkVolumeSource {
  const mountPath = resolveMountPath(input);
  const seaweedfsEnabled = isEnabled(
    firstEnvValue(input.env, [
      ...(input.seaweedfsEnabledEnvNames ?? []),
      "COLA_SEAWEEDFS_MOUNT_ENABLED",
    ]),
    true,
  );

  if (seaweedfsEnabled) {
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
