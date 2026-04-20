import { db } from "@/server/db";
import type { trainingJobs } from "@/server/db/schema";

type OptionalRuntimeColumn =
  | "runtimeNamespace"
  | "runtimeJobName"
  | "runtimeImage"
  | "artifactPath";

export type TrainingRuntimeColumnSupport = Record<OptionalRuntimeColumn, boolean>;

type PartialTrainingJobRecord = Omit<
  typeof trainingJobs.$inferSelect,
  OptionalRuntimeColumn
> &
  Partial<Pick<typeof trainingJobs.$inferSelect, OptionalRuntimeColumn>>;

const DEFAULT_COLUMN_SUPPORT: TrainingRuntimeColumnSupport = {
  runtimeNamespace: true,
  runtimeJobName: true,
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
        and column_name in ('runtimeNamespace', 'runtimeJobName', 'runtimeImage', 'artifactPath')
    `;

    const availableColumns = new Set(rows.map((row) => row.column_name));
    const value: TrainingRuntimeColumnSupport = {
      runtimeNamespace: availableColumns.has("runtimeNamespace"),
      runtimeJobName: availableColumns.has("runtimeJobName"),
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
    runtimeNamespace: row.runtimeNamespace ?? null,
    runtimeJobName: row.runtimeJobName ?? null,
    runtimeImage: row.runtimeImage ?? null,
    artifactPath: row.artifactPath ?? null,
  } satisfies typeof trainingJobs.$inferSelect;
}
