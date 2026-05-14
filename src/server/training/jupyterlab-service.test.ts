import assert from "node:assert/strict";
import test from "node:test";

import { resolveJupyterLabWorkVolume } from "./jupyterlab-volume.ts";

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

void test("JupyterLab mounts SeaweedFS automatically by default", () => {
  const { mode, volume, mountPath, initContainers } = withEnv(
    {
      COLA_TRAINING_PVC_NAME: "cola-training-workspace",
      COLA_JUPYTERLAB_PVC_NAME: undefined,
      COLA_JUPYTERLAB_PVC_MOUNT_PATH: undefined,
      COLA_JUPYTERLAB_WORKDIR_MOUNT_PATH: undefined,
      COLA_TRAINING_WORKDIR_MOUNT_PATH: undefined,
      COLA_SEAWEEDFS_MOUNT_ENABLED: undefined,
    },
    () =>
      resolveJupyterLabWorkVolume({
        env: process.env,
        workdir: "/workspace",
      }),
  );

  assert.equal(mode, "seaweedfs");
  assert.deepEqual(volume, {
    name: "jupyterlab-workdir",
    emptyDir: {},
  });
  assert.equal(mountPath, "/workspace");
  assert.equal(initContainers.length, 1);
  assert.equal(initContainers[0]?.restartPolicy, "Always");
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
        workdir: "/workspace",
      }),
  );

  assert.deepEqual(volume, {
    name: "jupyterlab-workdir",
    emptyDir: {},
  });
  assert.equal(mountPath, "/workspace");
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
