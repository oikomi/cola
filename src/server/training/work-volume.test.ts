import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkVolumeEnv,
  buildWorkVolumeInitContainers,
  buildWorkVolumeMount,
  buildWorkVolumeMounts,
  buildWorkVolumeSecurityContext,
  buildWorkVolumeShellCommand,
  buildWorkVolumeWorkingDir,
  buildWorkVolumes,
  resolveKubernetesWorkVolume,
  SHARED_STORAGE_MOUNT_PATH,
} from "./work-volume.ts";

void test("work volume mounts SeaweedFS FUSE automatically by default", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {},
    volumeName: "training-workdir",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    hostPathEnvNames: ["COLA_TRAINING_WORKDIR_HOST_PATH"],
    hostPathMountPathEnvNames: ["COLA_TRAINING_WORKDIR_MOUNT_PATH"],
    pvcNameEnvNames: ["COLA_TRAINING_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_TRAINING_PVC_MOUNT_PATH"],
  });

  assert.equal(workVolume.mode, "seaweedfs");
  assert.deepEqual(workVolume.volume, {
    name: "training-workdir",
  });
  assert.equal(workVolume.mountPath, SHARED_STORAGE_MOUNT_PATH);
  assert.deepEqual(buildWorkVolumeMount(workVolume), {
    name: "training-workdir-seaweedfs-cache",
    mountPath: "/var/cache/seaweedfs",
  });

  const initContainers = buildWorkVolumeInitContainers(workVolume);
  assert.equal(initContainers.length, 1);
  assert.equal(initContainers[0]?.name, "training-workdir-seaweedfs-tools");
  assert.equal(initContainers[0]?.restartPolicy, undefined);
  assert.equal(
    initContainers[0]?.env?.find(
      (entry) => entry.name === "COLA_SEAWEEDFS_MOUNT_DIR",
    )?.value,
    SHARED_STORAGE_MOUNT_PATH,
  );
  assert.equal(initContainers[0]?.securityContext, undefined);
  assert.deepEqual(
    initContainers[0]?.volumeMounts?.map((mount) => mount.name),
    ["training-workdir-seaweedfs-cache", "training-workdir-seaweedfs-tools"],
  );
  assert.equal(
    buildWorkVolumeEnv(workVolume).find(
      (entry) => entry.name === "COLA_SHARED_STORAGE_DIR",
    )?.value,
    SHARED_STORAGE_MOUNT_PATH,
  );
  assert.equal(
    buildWorkVolumeEnv(workVolume).find(
      (entry) => entry.name === "COLA_SEAWEEDFS_MOUNT_DIR",
    )?.value,
    SHARED_STORAGE_MOUNT_PATH,
  );
  assert.equal(
    buildWorkVolumeEnv(workVolume).find(
      (entry) => entry.name === "COLA_SEAWEEDFS_FILER",
    )?.value,
    "seaweedfs-filer.storage.svc.cluster.local:8888",
  );
  assert.equal(
    buildWorkVolumeEnv(workVolume).find(
      (entry) => entry.name === "COLA_SEAWEEDFS_FILER_PATH",
    )?.value,
    "/buckets/xdream",
  );
  assert.equal(buildWorkVolumeSecurityContext(workVolume)?.privileged, true);
  assert.deepEqual(
    buildWorkVolumeMounts(workVolume).map((mount) => mount.name),
    [
      "training-workdir-seaweedfs-cache",
      "training-workdir-fuse-device",
      "training-workdir-fusermount",
      "training-workdir-seaweedfs-tools",
    ],
  );
  assert.equal(buildWorkVolumeWorkingDir(workVolume), "/");
  assert.equal(
    buildWorkVolumeMounts(workVolume).some(
      (mount) => mount.mountPath === SHARED_STORAGE_MOUNT_PATH,
    ),
    false,
  );
  assert.deepEqual(
    buildWorkVolumeMounts(workVolume).map((mount) => mount.mountPath),
    [
      "/var/cache/seaweedfs",
      "/dev/fuse",
      "/bin/fusermount",
      "/opt/cola-seaweedfs",
    ],
  );
  assert.match(
    buildWorkVolumeShellCommand(workVolume, "exec train"),
    /mount-workdir\.sh/,
  );
  assert.match(
    initContainers[0]?.args?.[0] ?? "",
    /chown -R "\$COLA_SEAWEEDFS_MOUNT_UID:[^"]+" "\$COLA_SEAWEEDFS_CACHE_DIR"/,
  );
  assert.match(initContainers[0]?.args?.[0] ?? "", /-nonempty/);
  assert.deepEqual(
    initContainers[0]?.volumeMounts?.map((mount) => mount.mountPath),
    ["/var/cache/seaweedfs", "/opt/cola-seaweedfs"],
  );
  assert.deepEqual(
    buildWorkVolumes(workVolume).map((volume) => volume.name),
    [
      "training-workdir-seaweedfs-cache",
      "training-workdir-fuse-device",
      "training-workdir-fusermount",
      "training-workdir-seaweedfs-tools",
    ],
  );
  assert.deepEqual(
    buildWorkVolumes(workVolume).find(
      (volume) => volume.name === "training-workdir-fusermount",
    )?.hostPath,
    {
      path: "/bin/fusermount3",
      type: "File",
    },
  );
});

void test("work volume can use a node mounted SeaweedFS FUSE hostPath when automatic mount is disabled", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {
      COLA_SEAWEEDFS_MOUNT_ENABLED: "false",
      COLA_TRAINING_WORKDIR_HOST_PATH: "/mnt/cola-training",
      COLA_TRAINING_WORKDIR_MOUNT_PATH: "/workspace",
      COLA_TRAINING_PVC_NAME: "ignored-when-hostpath-is-set",
    },
    volumeName: "training-workdir",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    hostPathEnvNames: ["COLA_TRAINING_WORKDIR_HOST_PATH"],
    hostPathMountPathEnvNames: ["COLA_TRAINING_WORKDIR_MOUNT_PATH"],
    pvcNameEnvNames: ["COLA_TRAINING_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_TRAINING_PVC_MOUNT_PATH"],
  });

  assert.equal(workVolume.mode, "hostPath");
  assert.deepEqual(workVolume.volume, {
    name: "training-workdir",
    hostPath: {
      path: "/mnt/cola-training",
      type: "Directory",
    },
  });
  assert.equal(workVolume.mountPath, "/workspace");
  assert.equal(buildWorkVolumeWorkingDir(workVolume), "/workspace");
  assert.equal(workVolume.mountPropagation, "HostToContainer");
  assert.deepEqual(buildWorkVolumeMount(workVolume), {
    name: "training-workdir",
    mountPath: "/workspace",
    mountPropagation: "HostToContainer",
  });
  assert.deepEqual(buildWorkVolumeInitContainers(workVolume), []);
});

void test("work volume falls back to PVC before emptyDir when automatic mount is disabled", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {
      COLA_SEAWEEDFS_MOUNT_ENABLED: "false",
      COLA_TRAINING_PVC_NAME: "cola-training-workspace",
      COLA_TRAINING_PVC_MOUNT_PATH: "/workspace",
    },
    volumeName: "training-workdir",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    hostPathEnvNames: ["COLA_TRAINING_WORKDIR_HOST_PATH"],
    hostPathMountPathEnvNames: ["COLA_TRAINING_WORKDIR_MOUNT_PATH"],
    pvcNameEnvNames: ["COLA_TRAINING_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_TRAINING_PVC_MOUNT_PATH"],
  });

  assert.equal(workVolume.mode, "pvc");
  assert.deepEqual(workVolume.volume, {
    name: "training-workdir",
    persistentVolumeClaim: {
      claimName: "cola-training-workspace",
    },
  });
  assert.equal(workVolume.mountPath, "/workspace");
  assert.equal(workVolume.mountPropagation, undefined);
});

void test("work volume uses emptyDir when automatic mount is disabled and no persistent source is configured", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {
      COLA_SEAWEEDFS_MOUNT_ENABLED: "false",
    },
    volumeName: "training-workdir",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    hostPathEnvNames: ["COLA_TRAINING_WORKDIR_HOST_PATH"],
    hostPathMountPathEnvNames: ["COLA_TRAINING_WORKDIR_MOUNT_PATH"],
    pvcNameEnvNames: ["COLA_TRAINING_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_TRAINING_PVC_MOUNT_PATH"],
  });

  assert.equal(workVolume.mode, "emptyDir");
  assert.deepEqual(workVolume.volume, {
    name: "training-workdir",
    emptyDir: {},
  });
  assert.equal(workVolume.mountPath, SHARED_STORAGE_MOUNT_PATH);
});
