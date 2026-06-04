import assert from "node:assert/strict";
import test from "node:test";

import { __testables } from "./lab-jobs.ts";

function withEnv<T>(updates: Record<string, string | undefined>, run: () => T) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(updates)) {
    previous.set(key, process.env[key]);
    const value = updates[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
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

function buildBaseJob() {
  return __testables.buildLabJob({
    name: "direct",
    image: "nvcr.io/nvidia/isaac-lab:2.2.0",
    runner: "rsl-rl",
    displayMode: "headless",
    task: "Isaac-Velocity-Flat-G1-v0",
    command: null,
    maxIterations: 100,
    cpu: "8",
    memory: "48Gi",
    gpuAllocationMode: "whole",
    gpuCount: 1,
    gpuMemoryGi: null,
    nodeName: "node-01",
    ownerUserId: "user-1",
  });
}

void test("Isaac Lab defaults to NVIDIA direct runtime and bypasses HAMi", () => {
  const job = withEnv(
    {
      COLA_ISAAC_LAB_GPU_RUNTIME: undefined,
      COLA_TRAINING_GPU_RUNTIME: undefined,
    },
    buildBaseJob,
  );
  const podSpec = job.spec?.template.spec;
  const template = job.spec?.template;
  const container = podSpec?.containers?.[0];

  assert.equal(podSpec?.runtimeClassName, "nvidia");
  assert.equal(podSpec?.nodeName, "node-01");
  assert.equal(podSpec?.schedulerName, undefined);
  assert.equal(template?.metadata?.labels?.["hami.io/webhook"], "ignore");
  assert.deepEqual(container?.resources?.limits, {
    cpu: "8",
    memory: "48Gi",
  });
  assert.deepEqual(container?.resources?.requests, {
    cpu: "8",
    memory: "48Gi",
  });
  assert.equal(
    container?.env?.find((entry) => entry.name === "NVIDIA_VISIBLE_DEVICES")
      ?.value,
    "all",
  );
  assert.equal(
    job.metadata?.annotations?.["cola.isaac/gpu-runtime"],
    "nvidia",
  );
});

void test("Isaac Lab can explicitly use HAMi runtime", () => {
  const job = withEnv({ COLA_ISAAC_LAB_GPU_RUNTIME: "hami" }, buildBaseJob);
  const podSpec = job.spec?.template.spec;
  const template = job.spec?.template;
  const container = podSpec?.containers?.[0];

  assert.equal(podSpec?.schedulerName, "hami-scheduler");
  assert.equal(podSpec?.nodeName, undefined);
  assert.equal(template?.metadata?.labels?.["hami.io/webhook"], undefined);
  assert.equal(container?.resources?.limits?.["nvidia.com/gpu"], "1");
  assert.equal(
    container?.env?.some((entry) => entry.name === "NVIDIA_VISIBLE_DEVICES"),
    false,
  );
  assert.equal(job.metadata?.annotations?.["cola.isaac/gpu-runtime"], "hami");
});

void test("Isaac Lab list keeps GPU spec from annotations when resources are direct", () => {
  assert.deepEqual(
    __testables.parseLabGpuAllocation({
      annotations: {
        "cola.isaac/gpu-allocation-mode": "whole",
        "cola.isaac/gpu-count": "2",
      },
      resources: { cpu: "8", memory: "48Gi" },
    }),
    {
      gpuAllocationMode: "whole",
      gpuCount: 2,
      gpuMemoryGi: null,
    },
  );
});
