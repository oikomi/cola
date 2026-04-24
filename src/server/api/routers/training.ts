import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import type { db } from "@/server/db";
import { events, trainingJobs } from "@/server/db/schema";
import {
  formatDistributedGpuAllocationLabel,
  gpuAllocationModeValues,
  MAX_GPU_MEMORY_GI,
} from "@/lib/gpu-allocation";
import {
  priorityValues,
  priorityLabels,
} from "@/server/office/catalog";
import {
  trainingConfigSourceValues,
  trainingDistributedBackendLabels,
  trainingDistributedBackendValues,
  trainingLauncherTypeValues,
  trainingPrecisionValues,
  trainingJobStatusLabels,
  trainingJobTypeLabels,
  trainingJobTypeValues,
} from "@/server/training/catalog";
import {
  type TrainingRuntimeColumnSupport,
  getTrainingRuntimeColumnSupport,
  normalizeTrainingJobRecord,
} from "@/server/training/compat";
import {
  inspectTrainingJobRuntime,
  stopTrainingJobRun,
  submitTrainingJob,
  syncTrainingJobs,
} from "@/server/training/service";

const createTrainingJobInput = z.object({
  title: z.string().trim().min(3).max(160),
  objective: z.string().trim().min(8).max(600),
  jobType: z.enum(trainingJobTypeValues),
  priority: z.enum(priorityValues),
  baseModel: z.string().trim().min(2).max(120),
  datasetName: z.string().trim().min(2).max(120),
  datasetSplit: z.string().trim().min(1).max(32).default("train"),
  datasetTextField: z.string().trim().min(1).max(64).default("text"),
  gpuAllocationMode: z.enum(gpuAllocationModeValues).default("whole"),
  nodeCount: z.number().int().min(1).max(32),
  gpusPerNode: z.number().int().min(1).max(16),
  gpuMemoryGi: z.number().int().min(1).max(MAX_GPU_MEMORY_GI).nullable(),
  configSource: z.enum(trainingConfigSourceValues).default("manual"),
  launcherType: z.enum(trainingLauncherTypeValues).default("torchrun"),
  distributedBackend: z
    .enum(trainingDistributedBackendValues)
    .default("deepspeed"),
  deepspeedStage: z.number().int().min(2).max(3).nullable().default(2),
  precision: z.enum(trainingPrecisionValues).default("bf16"),
  loadIn4bit: z.boolean().default(true),
  studioConfigSnapshot: z.unknown().optional(),
  trainingConfigSnapshot: z.unknown().optional(),
}).superRefine((input, ctx) => {
  if (input.gpuAllocationMode === "memory" && !input.gpuMemoryGi) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["gpuMemoryGi"],
      message: "显存模式下必须填写每个 GPU 份额的显存大小。",
    });
  }
});

const trainingJobActionInput = z.object({
  jobId: z.string().uuid(),
});

const trainingRuntimeDetailInput = z.object({
  jobId: z.string().uuid(),
  podName: z.string().trim().min(1).max(160).optional(),
  tailLines: z.number().int().min(20).max(500).optional(),
});

type CreateTrainingJobInput = z.infer<typeof createTrainingJobInput>;
type TrainingJobReader = Pick<typeof db, "select">;

function buildTrainingJobSelection(runtimeColumns: TrainingRuntimeColumnSupport) {
  return {
    id: trainingJobs.id,
    title: trainingJobs.title,
    jobType: trainingJobs.jobType,
    status: trainingJobs.status,
    priority: trainingJobs.priority,
    baseModel: trainingJobs.baseModel,
    datasetName: trainingJobs.datasetName,
    objective: trainingJobs.objective,
    ...(runtimeColumns.gpuAllocationMode
      ? { gpuAllocationMode: trainingJobs.gpuAllocationMode }
      : {}),
    gpuCount: trainingJobs.gpuCount,
    ...(runtimeColumns.gpuMemoryGi
      ? { gpuMemoryGi: trainingJobs.gpuMemoryGi }
      : {}),
    lastError: trainingJobs.lastError,
    startedAt: trainingJobs.startedAt,
    finishedAt: trainingJobs.finishedAt,
    createdAt: trainingJobs.createdAt,
    updatedAt: trainingJobs.updatedAt,
    ...(runtimeColumns.datasetSplit
      ? { datasetSplit: trainingJobs.datasetSplit }
      : {}),
    ...(runtimeColumns.datasetTextField
      ? { datasetTextField: trainingJobs.datasetTextField }
      : {}),
    ...(runtimeColumns.nodeCount ? { nodeCount: trainingJobs.nodeCount } : {}),
    ...(runtimeColumns.gpusPerNode
      ? { gpusPerNode: trainingJobs.gpusPerNode }
      : {}),
    ...(runtimeColumns.configSource
      ? { configSource: trainingJobs.configSource }
      : {}),
    ...(runtimeColumns.launcherType
      ? { launcherType: trainingJobs.launcherType }
      : {}),
    ...(runtimeColumns.distributedBackend
      ? { distributedBackend: trainingJobs.distributedBackend }
      : {}),
    ...(runtimeColumns.deepspeedStage
      ? { deepspeedStage: trainingJobs.deepspeedStage }
      : {}),
    ...(runtimeColumns.precision ? { precision: trainingJobs.precision } : {}),
    ...(runtimeColumns.loadIn4bit
      ? { loadIn4bit: trainingJobs.loadIn4bit }
      : {}),
    ...(runtimeColumns.studioConfigSnapshot
      ? { studioConfigSnapshot: trainingJobs.studioConfigSnapshot }
      : {}),
    ...(runtimeColumns.trainingConfigSnapshot
      ? { trainingConfigSnapshot: trainingJobs.trainingConfigSnapshot }
      : {}),
    ...(runtimeColumns.runtimeNamespace
      ? { runtimeNamespace: trainingJobs.runtimeNamespace }
      : {}),
    ...(runtimeColumns.runtimeKind
      ? { runtimeKind: trainingJobs.runtimeKind }
      : {}),
    ...(runtimeColumns.runtimeJobName
      ? { runtimeJobName: trainingJobs.runtimeJobName }
      : {}),
    ...(runtimeColumns.runtimeServiceName
      ? { runtimeServiceName: trainingJobs.runtimeServiceName }
      : {}),
    ...(runtimeColumns.runtimeLeaderPodName
      ? { runtimeLeaderPodName: trainingJobs.runtimeLeaderPodName }
      : {}),
    ...(runtimeColumns.runtimeImage
      ? { runtimeImage: trainingJobs.runtimeImage }
      : {}),
    ...(runtimeColumns.artifactPath
      ? { artifactPath: trainingJobs.artifactPath }
      : {}),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildTrainingConfigSnapshot(input: CreateTrainingJobInput) {
  const totalGpuCount = input.nodeCount * input.gpusPerNode;
  const baseSnapshot = {
    version: 2,
    source: input.configSource,
    jobType: input.jobType,
    baseModel: input.baseModel,
    objective: input.objective,
    dataset: {
      name: input.datasetName,
      split: input.datasetSplit,
      textField: input.datasetTextField,
    },
    gpu: {
      allocationMode: input.gpuAllocationMode,
      countPerNode: input.gpusPerNode,
      totalGpuCount,
      memoryGiPerGpu:
        input.gpuAllocationMode === "memory" ? input.gpuMemoryGi : null,
    },
    model: {
      loadIn4bit: input.loadIn4bit,
    },
    distributed: {
      launcher: input.launcherType,
      backend: input.distributedBackend,
      gpuAllocationMode: input.gpuAllocationMode,
      nodeCount: input.nodeCount,
      gpusPerNode: input.gpusPerNode,
      totalGpuCount,
      gpuMemoryGi:
        input.gpuAllocationMode === "memory" ? input.gpuMemoryGi : null,
      deepspeedStage:
        input.distributedBackend === "deepspeed" ? input.deepspeedStage : null,
      precision: input.precision,
    },
  };

  if (!isPlainObject(input.trainingConfigSnapshot)) {
    return baseSnapshot;
  }

  return {
    ...input.trainingConfigSnapshot,
    ...baseSnapshot,
  };
}

async function listTrainingJobsWithCompat(database: TrainingJobReader) {
  const runtimeColumns = await getTrainingRuntimeColumnSupport();
  const rows = await database
    .select(buildTrainingJobSelection(runtimeColumns))
    .from(trainingJobs)
    .orderBy(desc(trainingJobs.createdAt));

  return {
    rows: rows.map(normalizeTrainingJobRecord),
    runtimeColumns,
  };
}

async function getTrainingJobByIdWithCompat(
  database: TrainingJobReader,
  jobId: string,
) {
  const runtimeColumns = await getTrainingRuntimeColumnSupport();
  const [row] = await database
    .select(buildTrainingJobSelection(runtimeColumns))
    .from(trainingJobs)
    .where(eq(trainingJobs.id, jobId))
    .limit(1);

  return {
    job: row ? normalizeTrainingJobRecord(row) : null,
    runtimeColumns,
  };
}

export const trainingRouter = createTRPCRouter({
  listJobs: publicProcedure.query(async ({ ctx }) => {
    const { rows } = await listTrainingJobsWithCompat(ctx.db);

    return syncTrainingJobs(rows);
  }),

  getRuntimeDetails: publicProcedure
    .input(trainingRuntimeDetailInput)
    .query(async ({ ctx, input }) => {
      const { job } = await getTrainingJobByIdWithCompat(ctx.db, input.jobId);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "未找到训练任务。",
        });
      }

      if (!job.runtimeJobName && !job.runtimeNamespace) {
        return null;
      }

      try {
        return await inspectTrainingJobRuntime(job, {
          podName: input.podName,
          tailLines: input.tailLines,
        });
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "读取训练任务运行态失败。",
        });
      }
    }),

  createJob: publicProcedure
    .input(createTrainingJobInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const runtimeColumns = await getTrainingRuntimeColumnSupport();
      const totalGpuCount = input.nodeCount * input.gpusPerNode;
      const trainingConfigSnapshot = buildTrainingConfigSnapshot(input);

      return ctx.db.transaction(async (tx) => {
        const [createdJob] = await tx
          .insert(trainingJobs)
          .values({
            title: input.title,
            objective: input.objective,
            jobType: input.jobType,
            priority: input.priority,
            baseModel: input.baseModel,
            datasetName: input.datasetName,
            ...(runtimeColumns.gpuAllocationMode
              ? { gpuAllocationMode: input.gpuAllocationMode }
              : {}),
            gpuCount: totalGpuCount,
            status: "draft",
            createdAt: now,
            ...(runtimeColumns.datasetSplit
              ? { datasetSplit: input.datasetSplit }
              : {}),
            ...(runtimeColumns.datasetTextField
              ? { datasetTextField: input.datasetTextField }
              : {}),
            ...(runtimeColumns.nodeCount ? { nodeCount: input.nodeCount } : {}),
            ...(runtimeColumns.gpusPerNode
              ? { gpusPerNode: input.gpusPerNode }
              : {}),
            ...(runtimeColumns.gpuMemoryGi
              ? {
                  gpuMemoryGi:
                    input.gpuAllocationMode === "memory"
                      ? input.gpuMemoryGi
                      : null,
                }
              : {}),
            ...(runtimeColumns.configSource
              ? { configSource: input.configSource }
              : {}),
            ...(runtimeColumns.launcherType
              ? { launcherType: input.launcherType }
              : {}),
            ...(runtimeColumns.distributedBackend
              ? { distributedBackend: input.distributedBackend }
              : {}),
            ...(runtimeColumns.deepspeedStage
              ? {
                  deepspeedStage:
                    input.distributedBackend === "deepspeed"
                      ? input.deepspeedStage
                      : null,
                }
              : {}),
            ...(runtimeColumns.precision ? { precision: input.precision } : {}),
            ...(runtimeColumns.loadIn4bit
              ? { loadIn4bit: input.loadIn4bit }
              : {}),
            ...(runtimeColumns.studioConfigSnapshot &&
            input.studioConfigSnapshot !== undefined
              ? { studioConfigSnapshot: input.studioConfigSnapshot }
              : {}),
            ...(runtimeColumns.trainingConfigSnapshot
              ? { trainingConfigSnapshot }
              : {}),
          })
          .returning();

        if (!createdJob) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "训练任务创建失败。",
          });
        }

        await tx.insert(events).values({
          eventType: "training.job.created",
          entityType: "training_job",
          entityId: createdJob.id,
          severity: "info",
          title: `已创建训练任务：${createdJob.title}`,
          description: `${trainingJobTypeLabels[input.jobType]} · ${input.baseModel} · ${formatDistributedGpuAllocationLabel(
            input.nodeCount,
            {
              gpuAllocationMode: input.gpuAllocationMode,
              gpuCount: input.gpusPerNode,
              gpuMemoryGi:
                input.gpuAllocationMode === "memory"
                  ? input.gpuMemoryGi
                  : null,
            },
          )} · ${trainingDistributedBackendLabels[input.distributedBackend]} · ${priorityLabels[input.priority]}优先级`,
          occurredAt: now,
        });

        return {
          jobId: createdJob.id,
          message: "训练任务已创建，可立即启动。",
        };
      });
    }),

  startJob: publicProcedure
    .input(trainingJobActionInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      const { job, runtimeColumns } = await getTrainingJobByIdWithCompat(
        ctx.db,
        input.jobId,
      );

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "未找到训练任务。",
        });
      }

      if (job.status === "running") {
        return {
          jobId: job.id,
          message: "训练任务已经在运行中。",
        };
      }

      if (job.status === "completed") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "已完成的训练任务不能直接再次启动。",
        });
      }

      let runtime;
      try {
        runtime = await submitTrainingJob(job);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "训练任务提交到 Kubernetes 失败。",
        });
      }

      try {
        return await ctx.db.transaction(async (tx) => {
          await tx
            .update(trainingJobs)
            .set({
              status: "running",
              startedAt: now,
              finishedAt: null,
              lastError: null,
              updatedAt: now,
              ...(runtimeColumns.runtimeNamespace
                ? { runtimeNamespace: runtime.namespace }
                : {}),
              ...(runtimeColumns.runtimeKind
                ? { runtimeKind: runtime.kind }
                : {}),
              ...(runtimeColumns.runtimeJobName
                ? { runtimeJobName: runtime.jobName }
                : {}),
              ...(runtimeColumns.runtimeServiceName
                ? { runtimeServiceName: runtime.serviceName }
                : {}),
              ...(runtimeColumns.runtimeLeaderPodName
                ? { runtimeLeaderPodName: runtime.leaderPodName }
                : {}),
              ...(runtimeColumns.runtimeImage
                ? { runtimeImage: runtime.image }
                : {}),
              ...(runtimeColumns.artifactPath
                ? { artifactPath: runtime.artifactPath }
                : {}),
            })
            .where(eq(trainingJobs.id, job.id));

          await tx.insert(events).values({
            eventType: "training.job.started",
            entityType: "training_job",
            entityId: job.id,
            severity: "info",
            title: `训练任务已启动：${job.title}`,
            description: `${trainingJobStatusLabels.running} · ${formatDistributedGpuAllocationLabel(
              job.nodeCount,
              {
                gpuAllocationMode: job.gpuAllocationMode,
                gpuCount: job.gpusPerNode,
                gpuMemoryGi: job.gpuMemoryGi,
              },
            )} · ${runtime.jobName}`,
            occurredAt: now,
          });

          return {
            jobId: job.id,
            message: `训练任务已提交到 Kubernetes：${runtime.namespace}/${runtime.jobName}`,
          };
        });
      } catch (error) {
        await stopTrainingJobRun({
          ...job,
          runtimeNamespace: runtime.namespace,
          runtimeKind: runtime.kind,
          runtimeJobName: runtime.jobName,
          runtimeServiceName: runtime.serviceName,
          runtimeLeaderPodName: runtime.leaderPodName,
          runtimeImage: runtime.image,
          artifactPath: runtime.artifactPath,
          lastError: null,
        });
        throw error;
      }
    }),

  stopJob: publicProcedure
    .input(trainingJobActionInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      const { job } = await getTrainingJobByIdWithCompat(ctx.db, input.jobId);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "未找到训练任务。",
        });
      }

      if (job.status !== "running") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "只有运行中的训练任务才能停止。",
        });
      }

      try {
        await stopTrainingJobRun(job);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "停止 Kubernetes 训练任务失败。",
        });
      }

      return ctx.db.transaction(async (tx) => {
        await tx
          .update(trainingJobs)
          .set({
            status: "stopped",
            finishedAt: now,
            updatedAt: now,
          })
          .where(eq(trainingJobs.id, job.id));

        await tx.insert(events).values({
          eventType: "training.job.stopped",
          entityType: "training_job",
          entityId: job.id,
          severity: "warning",
          title: `训练任务已停止：${job.title}`,
          description: job.runtimeJobName
            ? `已删除 Kubernetes Job：${job.runtimeNamespace ?? "default"}/${job.runtimeJobName}`
            : "任务已从运行状态切回停止状态。",
          occurredAt: now,
        });

        return {
          jobId: job.id,
          message: "训练任务已停止。",
        };
      });
    }),

  deleteJob: publicProcedure
    .input(trainingJobActionInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      return ctx.db.transaction(async (tx) => {
        const { job } = await getTrainingJobByIdWithCompat(tx, input.jobId);

        if (!job) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "未找到训练任务。",
          });
        }

        if (job.status === "running") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "请先停止运行中的训练任务，再删除。",
          });
        }

        await tx.delete(trainingJobs).where(eq(trainingJobs.id, job.id));

        await tx.insert(events).values({
          eventType: "training.job.deleted",
          entityType: "training_job",
          entityId: job.id,
          severity: "warning",
          title: `训练任务已删除：${job.title}`,
          description: "任务配置已从训练平台移除。",
          occurredAt: now,
        });

        return {
          jobId: job.id,
          message: "训练任务已删除。",
        };
      });
    }),
});
