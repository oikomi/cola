import assert from "node:assert/strict";
import test from "node:test";

import { buildJupyterLabCommand } from "./jupyterlab-command.ts";
import { resolveJupyterLabWorkVolume } from "./jupyterlab-volume.ts";
import {
  buildWorkVolumeMounts,
  buildWorkVolumeWorkingDir,
  SHARED_STORAGE_MOUNT_PATH,
} from "./work-volume.ts";

function withEnv<T>(
  patch: Record<string, string | undefined>,
  callback: () => T,
) {
  const previous = new Map(
    Object.keys(patch).map((key) => [key, process.env[key]]),
  );

  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

void test("JupyterLab command allows root when FUSE mounting requires a root container", () => {
  const command = buildJupyterLabCommand({
    workdir: SHARED_STORAGE_MOUNT_PATH,
    port: 8888,
  });

  assert.match(command, /exec start-notebook\.py/);
  assert.match(command, /--allow-root/);
  assert.match(command, /--ServerApp\.root_dir="\/shared-dist-storage"/);
});

void test("JupyterLab mounts SMB automatically by default", () => {
  const workVolume = withEnv(
    {
      COLA_TRAINING_PVC_NAME: "cola-training-workspace",
      COLA_JUPYTERLAB_PVC_NAME: undefined,
      COLA_JUPYTERLAB_PVC_MOUNT_PATH: undefined,
      COLA_JUPYTERLAB_WORKDIR_MOUNT_PATH: undefined,
      COLA_TRAINING_WORKDIR_MOUNT_PATH: undefined,
      COLA_JUPYTERLAB_WORK_VOLUME_MOUNT_MODE: undefined,
      COLA_WORK_VOLUME_MOUNT_MODE: undefined,
      COLA_SEAWEEDFS_MOUNT_ENABLED: undefined,
      COLA_JUPYTERLAB_SEAWEEDFS_MOUNT_ENABLED: undefined,
    },
    () =>
      resolveJupyterLabWorkVolume({
        env: process.env,
        workdir: SHARED_STORAGE_MOUNT_PATH,
      }),
  );
  const { mode, volume, mountPath, initContainers } = workVolume;

  assert.equal(mode, "smb");
  assert.deepEqual(volume, {
    name: "jupyterlab-workdir",
  });
  assert.equal(mountPath, SHARED_STORAGE_MOUNT_PATH);
  assert.equal(
    buildWorkVolumeWorkingDir(workVolume),
    SHARED_STORAGE_MOUNT_PATH,
  );
  assert.equal(
    buildWorkVolumeMounts(workVolume)
      .map((mount) => mount.mountPath)
      .join(","),
    "/opt/cola-smb",
  );
  assert.equal(initContainers.length, 1);
  assert.equal(initContainers[0]?.name, "jupyterlab-workdir-smb-tools");
  assert.equal(initContainers[0]?.restartPolicy, undefined);
});

void test("JupyterLab does not inherit the training PVC when automatic mount is disabled", () => {
  const { volume, mountPath } = withEnv(
    {
      COLA_SEAWEEDFS_MOUNT_ENABLED: "false",
      COLA_TRAINING_PVC_NAME: "cola-training-workspace",
      COLA_JUPYTERLAB_PVC_NAME: undefined,
      COLA_JUPYTERLAB_PVC_MOUNT_PATH: undefined,
      COLA_JUPYTERLAB_WORKDIR_MOUNT_PATH: undefined,
      COLA_TRAINING_WORKDIR_MOUNT_PATH: undefined,
    },
    () =>
      resolveJupyterLabWorkVolume({
        env: process.env,
        workdir: SHARED_STORAGE_MOUNT_PATH,
      }),
  );

  assert.deepEqual(volume, {
    name: "jupyterlab-workdir",
    emptyDir: {},
  });
  assert.equal(mountPath, SHARED_STORAGE_MOUNT_PATH);
});

void test("JupyterLab uses a PVC only when explicitly configured", () => {
  const { volume, mountPath } = withEnv(
    {
      COLA_SEAWEEDFS_MOUNT_ENABLED: "false",
      COLA_TRAINING_PVC_NAME: undefined,
      COLA_JUPYTERLAB_PVC_NAME: "jupyterlab-workspace",
      COLA_JUPYTERLAB_PVC_MOUNT_PATH: "/workspace",
      COLA_JUPYTERLAB_WORKDIR_MOUNT_PATH: undefined,
      COLA_TRAINING_WORKDIR_MOUNT_PATH: undefined,
    },
    () =>
      resolveJupyterLabWorkVolume({
        env: process.env,
        workdir: "/home/jovyan/work",
      }),
  );

  assert.deepEqual(volume, {
    name: "jupyterlab-workdir",
    persistentVolumeClaim: {
      claimName: "jupyterlab-workspace",
    },
  });
  assert.equal(mountPath, "/workspace");
});

void test("JupyterLab can inherit the node mounted training filesystem", () => {
  const { volume, mountPath, mountPropagation } = withEnv(
    {
      COLA_SEAWEEDFS_MOUNT_ENABLED: "false",
      COLA_TRAINING_WORKDIR_HOST_PATH: "/mnt/cola-training",
      COLA_TRAINING_WORKDIR_MOUNT_PATH: "/workspace",
      COLA_JUPYTERLAB_WORKDIR_HOST_PATH: undefined,
      COLA_JUPYTERLAB_WORKDIR_MOUNT_PATH: undefined,
      COLA_JUPYTERLAB_PVC_NAME: undefined,
    },
    () =>
      resolveJupyterLabWorkVolume({
        env: process.env,
        workdir: "/home/jovyan/work",
      }),
  );

  assert.deepEqual(volume, {
    name: "jupyterlab-workdir",
    hostPath: {
      path: "/mnt/cola-training",
      type: "Directory",
    },
  });
  assert.equal(mountPath, "/workspace");
  assert.equal(mountPropagation, "HostToContainer");
});
