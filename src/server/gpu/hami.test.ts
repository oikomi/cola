import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHamiGpuResources,
  buildHamiSchedulerSpec,
  normalizeGpuAllocation,
  parseGpuAllocationFromResources,
} from "./hami.ts";

void test("whole GPU mode only requests nvidia.com/gpu", () => {
  const spec = normalizeGpuAllocation({
    gpuAllocationMode: "whole",
    gpuCount: 2,
    gpuMemoryGi: null,
  });

  assert.deepEqual(buildHamiGpuResources(spec), {
    "nvidia.com/gpu": "2",
  });
});

void test("memory mode requests gpumem and round-trips back to Gi", () => {
  const spec = normalizeGpuAllocation({
    gpuAllocationMode: "memory",
    gpuCount: 1,
    gpuMemoryGi: 8,
  });

  assert.deepEqual(buildHamiGpuResources(spec), {
    "nvidia.com/gpu": "1",
    "nvidia.com/gpumem": "8192",
  });

  assert.deepEqual(
    parseGpuAllocationFromResources({
      "nvidia.com/gpu": "1",
      "nvidia.com/gpumem": "8192",
    }),
    {
      gpuAllocationMode: "memory",
      gpuCount: 1,
      gpuMemoryGi: 8,
    },
  );
});

void test("memory mode uses the HAMi scheduler", () => {
  assert.deepEqual(
    buildHamiSchedulerSpec({
      gpuAllocationMode: "memory",
      gpuCount: 1,
      gpuMemoryGi: 8,
    }),
    {
      schedulerName: "hami-scheduler",
    },
  );
});

void test("whole GPU mode uses the HAMi scheduler when GPU is requested", () => {
  assert.deepEqual(
    buildHamiSchedulerSpec({
      gpuAllocationMode: "whole",
      gpuCount: 1,
      gpuMemoryGi: null,
    }),
    {
      schedulerName: "hami-scheduler",
    },
  );
});

void test("whole GPU mode without GPU keeps the default scheduler", () => {
  assert.deepEqual(
    buildHamiSchedulerSpec({
      gpuAllocationMode: "whole",
      gpuCount: 0,
      gpuMemoryGi: null,
    }),
    {},
  );
});
