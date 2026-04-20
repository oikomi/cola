import type { priorityValues } from "@/server/office/catalog";

export const trainingJobTypeValues = [
  "sft",
  "dpo",
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

export type TrainingJobType = (typeof trainingJobTypeValues)[number];
export type TrainingJobStatus = (typeof trainingJobStatusValues)[number];
export type TrainingJobPriority = (typeof priorityValues)[number];

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
