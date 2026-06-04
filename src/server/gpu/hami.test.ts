import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHamiGpuResources,
  buildHamiSchedulerSpec,
  buildNvidiaDirectRuntimeEnv,
  buildNvidiaDesktopRuntimeEnv,
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

void test("GPU desktop runtime env exposes NVIDIA graphics capabilities", () => {
  assert.deepEqual(
    buildNvidiaDesktopRuntimeEnv({
      gpuAllocationMode: "whole",
      gpuCount: 1,
      gpuMemoryGi: null,
    }),
    [
      { name: "NVIDIA_DRIVER_CAPABILITIES", value: "all" },
      {
        name: "VK_ICD_FILENAMES",
        value: "/etc/vulkan/icd.d/nvidia_icd.json",
      },
      {
        name: "VK_DRIVER_FILES",
        value: "/etc/vulkan/icd.d/nvidia_icd.json",
      },
    ],
  );
});

void test("direct NVIDIA runtime env exposes all runtime devices", () => {
  assert.deepEqual(
    buildNvidiaDirectRuntimeEnv({
      gpuAllocationMode: "whole",
      gpuCount: 1,
      gpuMemoryGi: null,
    }),
    [
      { name: "NVIDIA_VISIBLE_DEVICES", value: "all" },
      { name: "NVIDIA_DRIVER_CAPABILITIES", value: "all" },
      {
        name: "VK_ICD_FILENAMES",
        value: "/etc/vulkan/icd.d/nvidia_icd.json",
      },
      {
        name: "VK_DRIVER_FILES",
        value: "/etc/vulkan/icd.d/nvidia_icd.json",
      },
    ],
  );
});

void test("CPU desktop runtime env does not request NVIDIA capabilities", () => {
  assert.deepEqual(
    buildNvidiaDesktopRuntimeEnv({
      gpuAllocationMode: "whole",
      gpuCount: 0,
      gpuMemoryGi: null,
    }),
    [],
  );
});
