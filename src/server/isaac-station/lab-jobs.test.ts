import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIsaacLabGpuRuntimeSpec,
  parseIsaacLabGpuAllocation,
} from "./lab-gpu-runtime.ts";

const gpuSpec = {
  gpuAllocationMode: "whole" as const,
  gpuCount: 1,
  gpuMemoryGi: null,
};

void test("Isaac Lab defaults to NVIDIA direct runtime and bypasses HAMi", () => {
  const runtime = buildIsaacLabGpuRuntimeSpec({
    env: {},
    gpuSpec,
    nodeName: "node-01",
  });

  assert.equal(runtime.gpuRuntimeMode, "nvidia");
  assert.deepEqual(runtime.schedulerSpec, {});
  assert.deepEqual(runtime.nodeSpec, { nodeName: "node-01" });
  assert.deepEqual(runtime.podLabels, { "hami.io/webhook": "ignore" });
  assert.deepEqual(runtime.gpuResources, {});
  assert.equal(
    runtime.gpuEnv.find((entry) => entry.name === "NVIDIA_VISIBLE_DEVICES")
      ?.value,
    "all",
  );
});

void test("Isaac Lab can explicitly use HAMi runtime", () => {
  const runtime = buildIsaacLabGpuRuntimeSpec({
    env: { COLA_ISAAC_LAB_GPU_RUNTIME: "hami" },
    gpuSpec,
    nodeName: "node-01",
  });

  assert.equal(runtime.gpuRuntimeMode, "hami");
  assert.deepEqual(runtime.schedulerSpec, { schedulerName: "hami-scheduler" });
  assert.deepEqual(runtime.nodeSpec, {});
  assert.deepEqual(runtime.podLabels, {});
  assert.equal(runtime.gpuResources["nvidia.com/gpu"], "1");
  assert.equal(
    runtime.gpuEnv.some((entry) => entry.name === "NVIDIA_VISIBLE_DEVICES"),
    false,
  );
});

void test("Isaac Lab direct runtime keeps GPU allocation in annotations", () => {
  const gpu = parseIsaacLabGpuAllocation({
    annotations: {
      "cola.isaac/gpu-runtime": "nvidia",
      "cola.isaac/gpu-allocation-mode": "whole",
      "cola.isaac/gpu-count": "1",
    },
    resources: {
      cpu: "8",
      memory: "48Gi",
    },
  });

  assert.deepEqual(gpu, gpuSpec);
});
