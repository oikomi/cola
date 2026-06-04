import type { GpuAllocationSpec } from "../../lib/gpu-allocation.ts";
import {
  buildHamiGpuResources,
  buildHamiSchedulerSpec,
  buildNvidiaDesktopRuntimeEnv,
  buildNvidiaDirectRuntimeEnv,
  parseGpuAllocationFromResources,
} from "../gpu/hami.ts";

export const HAMI_WEBHOOK_LABEL_KEY = "hami.io/webhook";
export const HAMI_WEBHOOK_IGNORE_VALUE = "ignore";

export type IsaacLabGpuRuntimeMode = "hami" | "nvidia";

type RuntimeEnv = Record<string, string | undefined>;

export function resolveIsaacLabGpuRuntimeMode(
  env: RuntimeEnv = process.env,
): IsaacLabGpuRuntimeMode {
  const configured =
    env.COLA_ISAAC_LAB_GPU_RUNTIME?.trim() ??
    env.COLA_TRAINING_GPU_RUNTIME?.trim();
  return configured === "hami" ? "hami" : "nvidia";
}

export function buildIsaacLabGpuRuntimeSpec(input: {
  env?: RuntimeEnv;
  gpuSpec: GpuAllocationSpec;
  nodeName?: string | null;
}) {
  const gpuRuntimeMode = resolveIsaacLabGpuRuntimeMode(input.env);
  const usesNvidiaDirectRuntime = gpuRuntimeMode === "nvidia";
  const podLabels: Record<string, string> = usesNvidiaDirectRuntime
    ? { [HAMI_WEBHOOK_LABEL_KEY]: HAMI_WEBHOOK_IGNORE_VALUE }
    : {};

  return {
    gpuRuntimeMode,
    gpuResources: usesNvidiaDirectRuntime
      ? {}
      : buildHamiGpuResources(input.gpuSpec),
    gpuEnv: usesNvidiaDirectRuntime
      ? buildNvidiaDirectRuntimeEnv(input.gpuSpec)
      : buildNvidiaDesktopRuntimeEnv(input.gpuSpec),
    schedulerSpec:
      gpuRuntimeMode === "hami" ? buildHamiSchedulerSpec(input.gpuSpec) : {},
    podLabels,
    nodeSpec:
      usesNvidiaDirectRuntime && input.nodeName
        ? { nodeName: input.nodeName }
        : {},
  };
}

function parseOptionalPositiveIntAnnotation(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseIsaacLabGpuAllocation(input: {
  annotations?: Record<string, string> | null;
  resources:
    | Record<string, string | number | null | undefined>
    | null
    | undefined;
}): GpuAllocationSpec {
  const gpuCount = parseOptionalPositiveIntAnnotation(
    input.annotations?.["cola.isaac/gpu-count"],
  );
  const gpuMemoryGi = parseOptionalPositiveIntAnnotation(
    input.annotations?.["cola.isaac/gpu-memory-gi"],
  );
  const mode = input.annotations?.["cola.isaac/gpu-allocation-mode"];

  if (gpuCount) {
    return {
      gpuAllocationMode: mode === "memory" ? ("memory" as const) : "whole",
      gpuCount,
      gpuMemoryGi: mode === "memory" ? gpuMemoryGi : null,
    };
  }

  return parseGpuAllocationFromResources(input.resources);
}
