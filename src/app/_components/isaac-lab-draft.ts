import type { gpuAllocationModeValues } from "@/lib/gpu-allocation";

export type IsaacLabRunner = "direct" | "rsl-rl" | "skrl" | "custom";
export type IsaacLabDisplayMode = "headless" | "webrtc";
export type IsaacLabDraft = {
  name: string;
  image: string;
  runner: IsaacLabRunner;
  displayMode: IsaacLabDisplayMode;
  task: string;
  command: string;
  maxIterations: string;
  cpu: string;
  memoryGi: string;
  gpuAllocationMode: (typeof gpuAllocationModeValues)[number];
  gpuCount: string;
  gpuMemoryGi: string;
};

export const ISAAC_LAB_DEFAULT_DRAFT: IsaacLabDraft = {
  name: "",
  image: "",
  runner: "custom",
  displayMode: "webrtc",
  task: "Isaac-Velocity-Flat-G1-v0",
  command: "sleep 1000000000000000",
  maxIterations: "1000",
  cpu: "8",
  memoryGi: "48",
  gpuAllocationMode: "whole",
  gpuCount: "1",
  gpuMemoryGi: "",
};

export function shouldShowIsaacLabTrainingFields(runner: IsaacLabRunner) {
  return runner !== "custom";
}
