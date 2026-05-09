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

void test("JupyterLab does not inherit the training PVC by default", () => {
  const { volume, mountPath } = withEnv(
    {
      COLA_TRAINING_PVC_NAME: "cola-training-workspace",
      COLA_JUPYTERLAB_PVC_NAME: undefined,
      COLA_JUPYTERLAB_PVC_MOUNT_PATH: undefined,
    },
    () =>
      resolveJupyterLabWorkVolume({
        env: process.env,
        workdir: "/home/jovyan/work",
      }),
  );

  assert.deepEqual(volume, {
    name: "jupyterlab-workdir",
    emptyDir: {},
  });
  assert.equal(mountPath, "/home/jovyan/work");
});

void test("JupyterLab uses a PVC only when explicitly configured", () => {
  const { volume, mountPath } = withEnv(
    {
      COLA_TRAINING_PVC_NAME: undefined,
      COLA_JUPYTERLAB_PVC_NAME: "jupyterlab-workspace",
      COLA_JUPYTERLAB_PVC_MOUNT_PATH: "/workspace",
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
