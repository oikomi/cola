import type { GpuAllocationSpec } from "../../lib/gpu-allocation.ts";
import {
  buildHamiGpuResources,
  buildHamiSchedulerSpec,
  buildNvidiaDesktopRuntimeEnv,
  buildNvidiaDirectRuntimeEnv,
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
    podLabels: usesNvidiaDirectRuntime
      ? { [HAMI_WEBHOOK_LABEL_KEY]: HAMI_WEBHOOK_IGNORE_VALUE }
      : {},
    nodeSpec:
      usesNvidiaDirectRuntime && input.nodeName
        ? { nodeName: input.nodeName }
        : {},
  };
}
