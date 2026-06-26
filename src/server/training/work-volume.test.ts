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
import { SEAWEEDFS_FUSE_IMAGE } from "../../lib/seaweedfs.ts";

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
  assert.equal(initContainers[0]?.image, SEAWEEDFS_FUSE_IMAGE);
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
  assert.deepEqual(buildWorkVolumeSecurityContext(workVolume)?.capabilities, {
    add: ["SYS_ADMIN"],
  });
  assert.deepEqual(
    buildWorkVolumeMounts(workVolume).map((mount) => mount.name),
    [
      "training-workdir-seaweedfs-cache",
      "training-workdir-fuse-device",
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
    ["/var/cache/seaweedfs", "/dev/fuse", "/opt/cola-seaweedfs"],
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
  assert.match(
    initContainers[0]?.args?.[0] ?? "",
    /\/opt\/cola-seaweedfs\/fusermount/,
  );
  assert.match(initContainers[0]?.args?.[0] ?? "", /ld-musl-x86_64\.so\.1/);
  assert.match(initContainers[0]?.args?.[0] ?? "", /\/usr\/bin\/fusermount/);
  assert.deepEqual(
    initContainers[0]?.volumeMounts?.map((mount) => mount.mountPath),
    ["/var/cache/seaweedfs", "/opt/cola-seaweedfs"],
  );
  assert.deepEqual(
    buildWorkVolumes(workVolume).map((volume) => volume.name),
    [
      "training-workdir-seaweedfs-cache",
      "training-workdir-fuse-device",
      "training-workdir-seaweedfs-tools",
    ],
  );
});

void test("SeaweedFS image can be overridden explicitly", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {
      COLA_SEAWEEDFS_IMAGE: "registry.local/seaweedfs:4.26",
    },
    volumeName: "training-workdir",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    hostPathEnvNames: ["COLA_TRAINING_WORKDIR_HOST_PATH"],
    hostPathMountPathEnvNames: ["COLA_TRAINING_WORKDIR_MOUNT_PATH"],
    pvcNameEnvNames: ["COLA_TRAINING_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_TRAINING_PVC_MOUNT_PATH"],
  });

  assert.equal(
    buildWorkVolumeInitContainers(workVolume)[0]?.image,
    "registry.local/seaweedfs:4.26",
  );
});

void test("work volume can mount SMB by default for selected workloads", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {},
    volumeName: "jupyterlab-workdir",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    defaultMountMode: "smb",
    hostPathEnvNames: ["COLA_JUPYTERLAB_WORKDIR_HOST_PATH"],
    hostPathMountPathEnvNames: ["COLA_JUPYTERLAB_WORKDIR_MOUNT_PATH"],
    pvcNameEnvNames: ["COLA_JUPYTERLAB_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_JUPYTERLAB_PVC_MOUNT_PATH"],
  });

  assert.equal(workVolume.mode, "smb");
  assert.deepEqual(workVolume.volume, {
    name: "jupyterlab-workdir",
  });
  assert.equal(workVolume.mountPath, SHARED_STORAGE_MOUNT_PATH);
  assert.equal(
    buildWorkVolumeWorkingDir(workVolume),
    SHARED_STORAGE_MOUNT_PATH,
  );
  assert.deepEqual(buildWorkVolumeMount(workVolume), {
    name: "jupyterlab-workdir-smb-tools",
    mountPath: "/opt/cola-smb",
    readOnly: true,
  });
  assert.equal(
    buildWorkVolumeEnv(workVolume).find(
      (entry) => entry.name === "COLA_SMB_SOURCE",
    )?.value,
    "//172.16.60.47/xdream",
  );
  assert.equal(
    buildWorkVolumeEnv(workVolume).find(
      (entry) => entry.name === "COLA_SMB_SUBPATH",
    )?.value,
    "cloud",
  );
  assert.equal(
    buildWorkVolumeEnv(workVolume).find(
      (entry) => entry.name === "COLA_SMB_USERNAME",
    )?.value,
    "xdream",
  );
  assert.equal(
    buildWorkVolumeEnv(workVolume).find(
      (entry) => entry.name === "COLA_SMB_PASSWORD",
    )?.value,
    "NAS-a1@123",
  );
  assert.equal(
    buildWorkVolumeEnv(workVolume).find(
      (entry) => entry.name === "COLA_SHARED_STORAGE_DIR",
    )?.value,
    SHARED_STORAGE_MOUNT_PATH,
  );
  assert.equal(buildWorkVolumeSecurityContext(workVolume)?.privileged, true);
  assert.deepEqual(buildWorkVolumeSecurityContext(workVolume)?.capabilities, {
    add: ["SYS_ADMIN"],
  });

  const initContainers = buildWorkVolumeInitContainers(workVolume);
  assert.equal(initContainers.length, 1);
  assert.equal(initContainers[0]?.name, "jupyterlab-workdir-smb-tools");
  assert.equal(initContainers[0]?.image, "ubuntu:22.04");
  assert.match(initContainers[0]?.args?.[0] ?? "", /apt-get install/);
  assert.match(initContainers[0]?.args?.[0] ?? "", /cifs-utils/);
  assert.match(initContainers[0]?.args?.[0] ?? "", /mount\.cifs/);
  assert.deepEqual(initContainers[0]?.volumeMounts, [
    {
      name: "jupyterlab-workdir-smb-tools",
      mountPath: "/opt/cola-smb",
    },
  ]);
  assert.deepEqual(buildWorkVolumes(workVolume), [
    {
      name: "jupyterlab-workdir-smb-tools",
      emptyDir: {},
    },
  ]);
  const smbCommand = buildWorkVolumeShellCommand(workVolume, "exec start");
  assert.match(
    smbCommand,
    /mount -t cifs "\$COLA_SMB_SOURCE" "\$cola_smb_mount_target"/,
  );
  assert.match(smbCommand, /mount --bind/);
  assert.equal(
    smbCommand.match(/chmod 0777 "\$COLA_SMB_MOUNT_DIR" \|\| true/g)?.length,
    2,
  );
  assert.match(smbCommand, /umask "\$cola_smb_previous_umask"/);
});

void test("SMB work volume accepts a server-only smb URL and custom tools image", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {
      COLA_SMB_URL: "smb://10.0.0.8",
      COLA_SMB_SHARE_NAME: "shared",
      COLA_SMB_TOOLS_IMAGE: "registry.local/cifs-utils:latest",
      COLA_SMB_MOUNT_PRIVILEGED: "false",
    },
    volumeName: "workspace",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    defaultMountMode: "smb",
  });

  assert.equal(workVolume.mode, "smb");
  assert.equal(
    buildWorkVolumeEnv(workVolume).find(
      (entry) => entry.name === "COLA_SMB_SOURCE",
    )?.value,
    "//10.0.0.8/shared",
  );
  assert.equal(
    buildWorkVolumeInitContainers(workVolume)[0]?.image,
    "registry.local/cifs-utils:latest",
  );
  assert.equal(
    buildWorkVolumeSecurityContext(workVolume)?.privileged,
    undefined,
  );
});

void test("SMB work volume accepts a share subpath", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {
      COLA_SMB_URL: "smb://10.0.0.8/shared/project/data",
      COLA_SMB_USERNAME: "project-user",
      COLA_SMB_SHARE_MOUNT_DIR: "/mnt/smb-share",
    },
    volumeName: "workspace",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    defaultMountMode: "smb",
  });
  const env = buildWorkVolumeEnv(workVolume);

  assert.equal(workVolume.mode, "smb");
  assert.equal(
    env.find((entry) => entry.name === "COLA_SMB_SOURCE")?.value,
    "//10.0.0.8/shared",
  );
  assert.equal(
    env.find((entry) => entry.name === "COLA_SMB_SUBPATH")?.value,
    "project/data",
  );
  assert.equal(
    env.find((entry) => entry.name === "COLA_SMB_URL")?.value,
    "smb://10.0.0.8/shared/project/data",
  );
  assert.equal(
    env.find((entry) => entry.name === "COLA_SMB_SHARE_MOUNT_DIR")?.value,
    "/mnt/smb-share",
  );
});

void test("SMB work volume rejects parent-directory subpaths", () => {
  assert.throws(
    () =>
      resolveKubernetesWorkVolume({
        env: {
          COLA_SMB_URL: "smb://10.0.0.8/shared/../private",
        },
        volumeName: "workspace",
        defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
        defaultMountMode: "smb",
      }),
    /不支持的 SMB 子目录/,
  );
});

void test("work volume mount mode can force SeaweedFS over an SMB default", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {
      COLA_WORK_VOLUME_MOUNT_MODE: "seaweedfs",
    },
    volumeName: "workspace",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    defaultMountMode: "smb",
  });

  assert.equal(workVolume.mode, "seaweedfs");
});

void test("SeaweedFS FUSE work volume can opt into privileged mode", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {
      COLA_SEAWEEDFS_MOUNT_PRIVILEGED: "true",
    },
    volumeName: "training-workdir",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    hostPathEnvNames: ["COLA_TRAINING_WORKDIR_HOST_PATH"],
    hostPathMountPathEnvNames: ["COLA_TRAINING_WORKDIR_MOUNT_PATH"],
    pvcNameEnvNames: ["COLA_TRAINING_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_TRAINING_PVC_MOUNT_PATH"],
  });

  assert.equal(buildWorkVolumeSecurityContext(workVolume)?.privileged, true);
});

void test("SeaweedFS FUSE work volume can opt out of privileged mode", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {
      COLA_SEAWEEDFS_MOUNT_PRIVILEGED: "false",
    },
    volumeName: "training-workdir",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    hostPathEnvNames: ["COLA_TRAINING_WORKDIR_HOST_PATH"],
    hostPathMountPathEnvNames: ["COLA_TRAINING_WORKDIR_MOUNT_PATH"],
    pvcNameEnvNames: ["COLA_TRAINING_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_TRAINING_PVC_MOUNT_PATH"],
  });

  assert.equal(
    buildWorkVolumeSecurityContext(workVolume)?.privileged,
    undefined,
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

void test("work volume can create an explicit hostPath directory when requested", () => {
  const workVolume = resolveKubernetesWorkVolume({
    env: {
      COLA_SEAWEEDFS_MOUNT_ENABLED: "false",
      COLA_TRAINING_WORKDIR_HOST_PATH: "/var/lib/remote-work/isaac-station",
    },
    volumeName: "isaac-workspace",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    hostPathEnvNames: ["COLA_TRAINING_WORKDIR_HOST_PATH"],
    hostPathType: "DirectoryOrCreate",
    hostPathMountPathEnvNames: ["COLA_TRAINING_WORKDIR_MOUNT_PATH"],
    pvcNameEnvNames: ["COLA_TRAINING_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_TRAINING_PVC_MOUNT_PATH"],
  });

  assert.equal(workVolume.mode, "hostPath");
  assert.deepEqual(workVolume.volume, {
    name: "isaac-workspace",
    hostPath: {
      path: "/var/lib/remote-work/isaac-station",
      type: "DirectoryOrCreate",
    },
  });
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
