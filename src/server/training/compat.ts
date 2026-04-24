import { db } from "@/server/db";
import type { trainingJobs } from "@/server/db/schema";

type OptionalRuntimeColumn =
  | "datasetSplit"
  | "datasetTextField"
  | "gpuAllocationMode"
  | "nodeCount"
  | "gpusPerNode"
  | "gpuMemoryGi"
  | "configSource"
  | "launcherType"
  | "distributedBackend"
  | "deepspeedStage"
  | "precision"
  | "loadIn4bit"
  | "studioConfigSnapshot"
  | "trainingConfigSnapshot"
  | "runtimeNamespace"
  | "runtimeKind"
  | "runtimeJobName"
  | "runtimeServiceName"
  | "runtimeLeaderPodName"
  | "runtimeImage"
  | "artifactPath";

export type TrainingRuntimeColumnSupport = Record<OptionalRuntimeColumn, boolean>;

type PartialTrainingJobRecord = Omit<
  typeof trainingJobs.$inferSelect,
  OptionalRuntimeColumn
> &
  Partial<Pick<typeof trainingJobs.$inferSelect, OptionalRuntimeColumn>>;

const DEFAULT_COLUMN_SUPPORT: TrainingRuntimeColumnSupport = {
  datasetSplit: true,
  datasetTextField: true,
  gpuAllocationMode: true,
  nodeCount: true,
  gpusPerNode: true,
  gpuMemoryGi: true,
  configSource: true,
  launcherType: true,
  distributedBackend: true,
  deepspeedStage: true,
  precision: true,
  loadIn4bit: true,
  studioConfigSnapshot: true,
  trainingConfigSnapshot: true,
  runtimeNamespace: true,
  runtimeKind: true,
  runtimeJobName: true,
  runtimeServiceName: true,
  runtimeLeaderPodName: true,
  runtimeImage: true,
  artifactPath: true,
};

let cachedColumnSupport:
  | {
      expiresAt: number;
      value: TrainingRuntimeColumnSupport;
    }
  | null = null;

export async function getTrainingRuntimeColumnSupport() {
  const now = Date.now();
  if (cachedColumnSupport && cachedColumnSupport.expiresAt > now) {
    return cachedColumnSupport.value;
  }

  try {
    const rows = await db.$client<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'cola_training_job'
        and column_name in (
          'datasetSplit',
          'datasetTextField',
          'gpuAllocationMode',
          'nodeCount',
          'gpusPerNode',
          'gpuMemoryGi',
          'configSource',
          'launcherType',
          'distributedBackend',
          'deepspeedStage',
          'precision',
          'loadIn4bit',
          'studioConfigSnapshot',
          'trainingConfigSnapshot',
          'runtimeNamespace',
          'runtimeKind',
          'runtimeJobName',
          'runtimeServiceName',
          'runtimeLeaderPodName',
          'runtimeImage',
          'artifactPath'
        )
    `;

    const availableColumns = new Set(rows.map((row) => row.column_name));
    const value: TrainingRuntimeColumnSupport = {
      datasetSplit: availableColumns.has("datasetSplit"),
      datasetTextField: availableColumns.has("datasetTextField"),
      gpuAllocationMode: availableColumns.has("gpuAllocationMode"),
      nodeCount: availableColumns.has("nodeCount"),
      gpusPerNode: availableColumns.has("gpusPerNode"),
      gpuMemoryGi: availableColumns.has("gpuMemoryGi"),
      configSource: availableColumns.has("configSource"),
      launcherType: availableColumns.has("launcherType"),
      distributedBackend: availableColumns.has("distributedBackend"),
      deepspeedStage: availableColumns.has("deepspeedStage"),
      precision: availableColumns.has("precision"),
      loadIn4bit: availableColumns.has("loadIn4bit"),
      studioConfigSnapshot: availableColumns.has("studioConfigSnapshot"),
      trainingConfigSnapshot: availableColumns.has("trainingConfigSnapshot"),
      runtimeNamespace: availableColumns.has("runtimeNamespace"),
      runtimeKind: availableColumns.has("runtimeKind"),
      runtimeJobName: availableColumns.has("runtimeJobName"),
      runtimeServiceName: availableColumns.has("runtimeServiceName"),
      runtimeLeaderPodName: availableColumns.has("runtimeLeaderPodName"),
      runtimeImage: availableColumns.has("runtimeImage"),
      artifactPath: availableColumns.has("artifactPath"),
    };

    cachedColumnSupport = {
      value,
      expiresAt: now + 30_000,
    };

    return value;
  } catch (error) {
    console.error("[training] failed to inspect runtime columns", error);
    return DEFAULT_COLUMN_SUPPORT;
  }
}

export function normalizeTrainingJobRecord(row: PartialTrainingJobRecord) {
  return {
    ...row,
    datasetSplit: row.datasetSplit ?? "train",
    datasetTextField: row.datasetTextField ?? "text",
    gpuAllocationMode: row.gpuAllocationMode ?? "whole",
    nodeCount: row.nodeCount ?? 1,
    gpusPerNode: row.gpusPerNode ?? Math.max(1, row.gpuCount ?? 1),
    gpuMemoryGi: row.gpuMemoryGi ?? null,
    configSource: row.configSource ?? "manual",
    launcherType: row.launcherType ?? "python",
    distributedBackend: row.distributedBackend ?? "none",
    deepspeedStage: row.deepspeedStage ?? null,
    precision: row.precision ?? null,
    loadIn4bit: row.loadIn4bit ?? true,
    studioConfigSnapshot: row.studioConfigSnapshot ?? null,
    trainingConfigSnapshot: row.trainingConfigSnapshot ?? null,
    runtimeNamespace: row.runtimeNamespace ?? null,
    runtimeKind: row.runtimeKind ?? null,
    runtimeJobName: row.runtimeJobName ?? null,
    runtimeServiceName: row.runtimeServiceName ?? null,
    runtimeLeaderPodName: row.runtimeLeaderPodName ?? null,
    runtimeImage: row.runtimeImage ?? null,
    artifactPath: row.artifactPath ?? null,
  } satisfies typeof trainingJobs.$inferSelect;
}
