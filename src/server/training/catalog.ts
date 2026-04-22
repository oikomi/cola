import type { priorityValues } from "@/server/office/catalog";

export const trainingJobTypeValues = [
  "sft",
  "dpo",
  "lora",
  "pretrain",
] as const;

export const trainingK8sSupportedJobTypes = [
  "sft",
  "lora",
  "pretrain",
] as const;

export const trainingJobStatusValues = [
  "draft",
  "running",
  "stopped",
  "completed",
  "failed",
] as const;

export const trainingConfigSourceValues = [
  "manual",
  "unsloth_studio",
] as const;

export const trainingLauncherTypeValues = ["python", "torchrun"] as const;

export const trainingDistributedBackendValues = ["none", "deepspeed"] as const;

export const trainingPrecisionValues = ["auto", "fp16", "bf16"] as const;

export type TrainingJobType = (typeof trainingJobTypeValues)[number];
export type TrainingJobStatus = (typeof trainingJobStatusValues)[number];
export type TrainingJobPriority = (typeof priorityValues)[number];
export type TrainingConfigSource = (typeof trainingConfigSourceValues)[number];
export type TrainingLauncherType = (typeof trainingLauncherTypeValues)[number];
export type TrainingDistributedBackend =
  (typeof trainingDistributedBackendValues)[number];
export type TrainingPrecision = (typeof trainingPrecisionValues)[number];

export const trainingJobTypeLabels: Record<TrainingJobType, string> = {
  sft: "SFT",
  dpo: "DPO",
  lora: "LoRA",
  pretrain: "Pre-train",
};

export const trainingJobStatusLabels: Record<TrainingJobStatus, string> = {
  draft: "草稿",
  running: "运行中",
  stopped: "已停止",
  completed: "已完成",
  failed: "失败",
};

export const trainingConfigSourceLabels: Record<TrainingConfigSource, string> = {
  manual: "手动配置",
  unsloth_studio: "Unsloth Studio",
};

export const trainingLauncherTypeLabels: Record<TrainingLauncherType, string> = {
  python: "Python",
  torchrun: "torchrun",
};

export const trainingDistributedBackendLabels: Record<
  TrainingDistributedBackend,
  string
> = {
  none: "None",
  deepspeed: "DeepSpeed",
};

export const trainingPrecisionLabels: Record<TrainingPrecision, string> = {
  auto: "Auto",
  fp16: "FP16",
  bf16: "BF16",
};
