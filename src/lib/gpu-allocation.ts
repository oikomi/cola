export const gpuAllocationModeValues = ["whole", "memory"] as const;

export type GpuAllocationMode = (typeof gpuAllocationModeValues)[number];

export const gpuAllocationModeLabels: Record<GpuAllocationMode, string> = {
  whole: "整卡",
  memory: "显存",
};

export const MAX_GPU_COUNT = 16;
export const MAX_GPU_MEMORY_GI = 1024;

export type GpuAllocationSpec = {
  gpuAllocationMode: GpuAllocationMode;
  gpuCount: number;
  gpuMemoryGi: number | null;
};

export function usesGpuAcceleration(spec: GpuAllocationSpec) {
  return spec.gpuAllocationMode === "memory" || spec.gpuCount > 0;
}

export function formatGpuAllocationLabel(spec: GpuAllocationSpec) {
  if (spec.gpuAllocationMode === "memory") {
    return `${spec.gpuCount} GPU 份额 · ${spec.gpuMemoryGi ?? 0} Gi/份额`;
  }

  return `${spec.gpuCount} GPU`;
}

export function formatDistributedGpuAllocationLabel(
  nodeCount: number,
  spec: GpuAllocationSpec,
) {
  return `${nodeCount} 节点 x ${formatGpuAllocationLabel(spec)}`;
}

export function totalRequestedGpuMemoryGi(spec: GpuAllocationSpec) {
  if (spec.gpuAllocationMode !== "memory" || !spec.gpuMemoryGi) {
    return 0;
  }

  return spec.gpuCount * spec.gpuMemoryGi;
}
