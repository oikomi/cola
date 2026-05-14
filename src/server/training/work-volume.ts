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
};

const DEFAULT_SEAWEEDFS_IMAGE = "chrislusf/seaweedfs:4.23";
const DEFAULT_SEAWEEDFS_FILER =
  "seaweedfs-filer.storage.svc.cluster.local:8888";
const DEFAULT_SEAWEEDFS_FILER_PATH = "/buckets/cola-training";
const DEFAULT_SEAWEEDFS_CACHE_DIR = "/var/cache/seaweedfs";

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

function buildSeaweedfsMountCommand() {
  return `set -eu
mkdir -p "$COLA_SEAWEEDFS_MOUNT_DIR" "$COLA_SEAWEEDFS_CACHE_DIR"

extra_args=""
if [ -n "\${COLA_SEAWEEDFS_ALLOW_OTHERS:-}" ]; then
  mkdir -p /etc
  touch /etc/fuse.conf
  if ! grep -qs "^user_allow_other" /etc/fuse.conf; then
    echo user_allow_other >> /etc/fuse.conf
  fi
  extra_args="$extra_args -allowOthers=$COLA_SEAWEEDFS_ALLOW_OTHERS"
fi
if [ -n "\${COLA_SEAWEEDFS_MOUNT_UID:-}" ]; then
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

exec weed mount \\
  -filer="$COLA_SEAWEEDFS_FILER" \\
  -dir="$COLA_SEAWEEDFS_MOUNT_DIR" \\
  -filer.path="$COLA_SEAWEEDFS_FILER_PATH" \\
  -cacheDir="$COLA_SEAWEEDFS_CACHE_DIR" \\
  -cacheCapacityMB="$COLA_SEAWEEDFS_CACHE_CAPACITY_MB" \\
  -chunkSizeLimitMB="$COLA_SEAWEEDFS_CHUNK_SIZE_LIMIT_MB" \\
  $extra_args`;
}

function resolveSeaweedfsWorkVolume(input: {
  env: WorkVolumeEnv;
  volumeName: string;
  mountPath: string;
}): WorkVolumeSource {
  const cacheVolumeName = volumeName(input.volumeName, "seaweedfs-cache");
  const fuseVolumeName = volumeName(input.volumeName, "fuse-device");
  const mountContainerName = volumeName(input.volumeName, "seaweedfs-mount");
  const cacheDir =
    firstEnvValue(input.env, ["COLA_SEAWEEDFS_CACHE_DIR"]) ??
    DEFAULT_SEAWEEDFS_CACHE_DIR;

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
    ],
    mountPath: input.mountPath,
    mountPropagation: "HostToContainer",
    initContainers: [
      {
        name: mountContainerName,
        image:
          firstEnvValue(input.env, ["COLA_SEAWEEDFS_IMAGE"]) ??
          DEFAULT_SEAWEEDFS_IMAGE,
        imagePullPolicy:
          firstEnvValue(input.env, ["COLA_SEAWEEDFS_IMAGE_PULL_POLICY"]) ??
          "IfNotPresent",
        restartPolicy: "Always",
        command: ["sh", "-lc"],
        args: [buildSeaweedfsMountCommand()],
        env: [
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
            value: cacheDir,
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
              firstEnvValue(input.env, [
                "COLA_SEAWEEDFS_CHUNK_SIZE_LIMIT_MB",
              ]) ?? "32",
          },
          {
            name: "COLA_SEAWEEDFS_ALLOW_OTHERS",
            value:
              firstEnvValue(input.env, ["COLA_SEAWEEDFS_ALLOW_OTHERS"]) ??
              "true",
          },
          {
            name: "COLA_SEAWEEDFS_MOUNT_UID",
            value:
              firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_UID"]) ?? "1000",
          },
          {
            name: "COLA_SEAWEEDFS_MOUNT_GID",
            value:
              firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_GID"]) ?? "1000",
          },
          {
            name: "COLA_SEAWEEDFS_MOUNT_UMASK",
            value:
              firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_UMASK"]) ?? "000",
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
              firstEnvValue(input.env, [
                "COLA_SEAWEEDFS_VOLUME_SERVER_ACCESS",
              ]) ?? "",
          },
        ],
        volumeMounts: [
          {
            name: input.volumeName,
            mountPath: input.mountPath,
            mountPropagation: "Bidirectional",
          },
          {
            name: cacheVolumeName,
            mountPath: cacheDir,
          },
          {
            name: fuseVolumeName,
            mountPath: "/dev/fuse",
          },
        ],
        securityContext: {
          privileged: isEnabled(
            firstEnvValue(input.env, ["COLA_SEAWEEDFS_MOUNT_PRIVILEGED"]),
            true,
          ),
          allowPrivilegeEscalation: true,
          capabilities: {
            add: ["SYS_ADMIN"],
          },
        },
        startupProbe: {
          exec: {
            command: [
              "sh",
              "-lc",
              'grep -qs " ${COLA_SEAWEEDFS_MOUNT_DIR} " /proc/mounts',
            ],
          },
          failureThreshold: Number(
            firstEnvValue(input.env, [
              "COLA_SEAWEEDFS_MOUNT_STARTUP_FAILURE_THRESHOLD",
            ]) ?? "60",
          ),
          periodSeconds: Number(
            firstEnvValue(input.env, [
              "COLA_SEAWEEDFS_MOUNT_STARTUP_PERIOD_SECONDS",
            ]) ?? "1",
          ),
          timeoutSeconds: Number(
            firstEnvValue(input.env, [
              "COLA_SEAWEEDFS_MOUNT_STARTUP_TIMEOUT_SECONDS",
            ]) ?? "1",
          ),
        },
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
  return {
    name: workVolume.volume.name,
    mountPath: workVolume.mountPath,
    ...(workVolume.mountPropagation
      ? { mountPropagation: workVolume.mountPropagation }
      : {}),
  };
}

export function buildWorkVolumes(workVolume: WorkVolumeSource) {
  return workVolume.volumes;
}

export function buildWorkVolumeInitContainers(workVolume: WorkVolumeSource) {
  return workVolume.initContainers;
}
