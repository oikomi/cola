import {
  MAX_GPU_COUNT,
  MAX_GPU_MEMORY_GI,
  type GpuAllocationMode,
  type GpuAllocationSpec,
} from "../../lib/gpu-allocation.ts";

export const HAMI_GPU_RESOURCE_NAME = "nvidia.com/gpu";
export const HAMI_GPU_MEMORY_RESOURCE_NAME = "nvidia.com/gpumem";
const GPU_MEMORY_GI_IN_MIB = 1024;

type NormalizeGpuAllocationOptions = {
  minGpuCount?: number;
  maxGpuCount?: number;
  maxGpuMemoryGi?: number;
};

function normalizeInteger(value: number, message: string) {
  if (!Number.isInteger(value)) {
    throw new Error(message);
  }

  return value;
}

export function normalizeGpuAllocation(
  spec: GpuAllocationSpec,
  options: NormalizeGpuAllocationOptions = {},
) {
  const minGpuCount =
    options.minGpuCount ?? (spec.gpuAllocationMode === "memory" ? 1 : 0);
  const maxGpuCount = options.maxGpuCount ?? MAX_GPU_COUNT;
  const maxGpuMemoryGi = options.maxGpuMemoryGi ?? MAX_GPU_MEMORY_GI;
  const gpuCount = normalizeInteger(
    spec.gpuCount,
    `GPU 数量必须是 ${minGpuCount} 到 ${maxGpuCount} 之间的整数。`,
  );

  if (gpuCount < minGpuCount || gpuCount > maxGpuCount) {
    throw new Error(`GPU 数量必须是 ${minGpuCount} 到 ${maxGpuCount} 之间的整数。`);
  }

  if (spec.gpuAllocationMode === "whole") {
    return {
      gpuAllocationMode: "whole" as const,
      gpuCount,
      gpuMemoryGi: null,
    };
  }

  const rawGpuMemoryGi = normalizeInteger(
    spec.gpuMemoryGi ?? Number.NaN,
    `显存大小必须是 1 到 ${maxGpuMemoryGi} 之间的整数 Gi。`,
  );

  if (rawGpuMemoryGi < 1 || rawGpuMemoryGi > maxGpuMemoryGi) {
    throw new Error(`显存大小必须是 1 到 ${maxGpuMemoryGi} 之间的整数 Gi。`);
  }

  return {
    gpuAllocationMode: "memory" as const,
    gpuCount,
    gpuMemoryGi: rawGpuMemoryGi,
  };
}

export function buildHamiGpuResources(spec: GpuAllocationSpec) {
  const resources: Record<string, string> = {};

  if (spec.gpuAllocationMode === "whole") {
    if (spec.gpuCount > 0) {
      resources[HAMI_GPU_RESOURCE_NAME] = `${spec.gpuCount}`;
    }

    return resources;
  }

  resources[HAMI_GPU_RESOURCE_NAME] = `${spec.gpuCount}`;
  resources[HAMI_GPU_MEMORY_RESOURCE_NAME] = `${(spec.gpuMemoryGi ?? 0) * GPU_MEMORY_GI_IN_MIB}`;
  return resources;
}

function parseIntegerResource(
  value: string | number | null | undefined,
  fallback = 0,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

export function parseGpuAllocationFromResources(
  resources:
    | Record<string, string | number | null | undefined>
    | null
    | undefined,
) {
  const gpuCount = parseIntegerResource(resources?.[HAMI_GPU_RESOURCE_NAME], 0);
  const gpuMemoryMi = parseIntegerResource(
    resources?.[HAMI_GPU_MEMORY_RESOURCE_NAME],
    0,
  );

  if (gpuMemoryMi > 0) {
    return {
      gpuAllocationMode: "memory" as GpuAllocationMode,
      gpuCount,
      gpuMemoryGi: Math.max(1, Math.round(gpuMemoryMi / GPU_MEMORY_GI_IN_MIB)),
    };
  }

  return {
    gpuAllocationMode: "whole" as GpuAllocationMode,
    gpuCount,
    gpuMemoryGi: null,
  };
}
