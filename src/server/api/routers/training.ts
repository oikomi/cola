import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  createTRPCRouter,
  operatorProcedure,
  viewerProcedure,
} from "@/server/api/trpc";
import { trainingJobs } from "@/server/db/schema";
import {
  gpuAllocationModeValues,
  MAX_GPU_MEMORY_GI,
} from "@/lib/gpu-allocation";
import {
  loadResourceOwnerMap,
  ownerForUserId,
} from "@/server/resource-owners";
import {
  createJupyterLabRuntime,
  deleteJupyterLabRuntime,
  listJupyterLabRuntimes,
} from "@/server/training/jupyterlab-service";
import { resolveJupyterLabImageOptions } from "@/server/training/jupyterlab-images";
import { priorityValues } from "@/server/office/catalog";
import {
  trainingConfigSourceValues,
  trainingDistributedBackendValues,
  trainingJobTypeValues,
  trainingLauncherTypeValues,
  trainingPrecisionValues,
} from "@/server/training/catalog";
import { normalizeTrainingJobRecord } from "@/server/training/compat";
import {
  deleteTrainingJobRun,
  inspectTrainingJobRuntime,
  stopTrainingJobRun,
  submitTrainingJob,
  syncTrainingJobs,
} from "@/server/training/service";
import {
  createUnslothStudioRuntime,
  deleteUnslothStudioRuntime,
  listUnslothStudioRuntimes,
} from "@/server/training/unsloth-studio-service";
import { resolveUnslothStudioImageOptions } from "@/server/training/unsloth-studio-images";

const createJupyterLabInput = z
  .object({
    name: z.string().trim().min(2).max(48),
    image: z.string().trim().min(1).max(240),
    cpu: z.string().trim().min(1).max(20),
    memoryGi: z.number().int().positive().max(2048),
    gpuAllocationMode: z.enum(gpuAllocationModeValues).default("whole"),
    gpuCount: z.number().int().nonnegative().max(16),
    gpuMemoryGi: z.number().int().positive().max(MAX_GPU_MEMORY_GI).nullable(),
  })
  .superRefine((input, ctx) => {
    if (input.gpuAllocationMode === "memory" && !input.gpuMemoryGi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gpuMemoryGi"],
        message: "显存模式下必须填写每个 GPU 份额的显存大小。",
      });
    }
  });

const jupyterLabActionInput = z.object({
  name: z.string().trim().min(2).max(48),
});

const createUnslothStudioInput = createJupyterLabInput;

const unslothStudioActionInput = z.object({
  name: z.string().trim().min(2).max(48),
});

const jsonObjectInput = z
  .record(z.unknown())
  .nullable()
  .optional();

const createStudioTrainingRunInput = z
  .object({
    title: z.string().trim().min(2).max(160),
    jobType: z.enum(trainingJobTypeValues).default("lora"),
    priority: z.enum(priorityValues).default("medium"),
    baseModel: z.string().trim().min(2).max(120),
    datasetName: z.string().trim().min(1).max(120),
    datasetSplit: z.string().trim().min(1).max(32).default("train"),
    datasetTextField: z.string().trim().min(1).max(64).default("text"),
    objective: z.string().trim().min(2).max(4000),
    gpuAllocationMode: z.enum(gpuAllocationModeValues).default("whole"),
    nodeCount: z.number().int().positive().max(32),
    gpusPerNode: z.number().int().positive().max(16),
    gpuMemoryGi: z.number().int().positive().max(MAX_GPU_MEMORY_GI).nullable(),
    configSource: z.enum(trainingConfigSourceValues).default("unsloth_studio"),
    launcherType: z.enum(trainingLauncherTypeValues).default("torchrun"),
    distributedBackend: z
      .enum(trainingDistributedBackendValues)
      .default("deepspeed"),
    deepspeedStage: z.number().int().min(2).max(3).nullable(),
    precision: z.enum(trainingPrecisionValues).default("bf16"),
    loadIn4bit: z.boolean().default(true),
    studioConfigSnapshot: jsonObjectInput,
    trainingConfigSnapshot: jsonObjectInput,
    autoStart: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    if (input.gpuAllocationMode === "memory" && !input.gpuMemoryGi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gpuMemoryGi"],
        message: "显存模式下必须填写每个 GPU 份额的显存大小。",
      });
    }

    if (input.nodeCount > 1 && input.gpuAllocationMode === "memory") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gpuAllocationMode"],
        message: "多机训练建议使用整卡 GPU，不建议使用显存份额。",
      });
    }

    if (input.distributedBackend === "deepspeed" && !input.deepspeedStage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deepspeedStage"],
        message: "DeepSpeed 训练必须选择 ZeRO stage。",
      });
    }
  });

const trainingRunActionInput = z.object({
  id: z.string().uuid(),
});

const inspectTrainingRunInput = z.object({
  id: z.string().uuid(),
  podName: z.string().trim().min(1).max(253).nullable().optional(),
  tailLines: z.number().int().min(20).max(500).default(160),
});

export const trainingRouter = createTRPCRouter({
  listStudioRuns: viewerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(trainingJobs)
      .orderBy(desc(trainingJobs.createdAt))
      .limit(80);

    const jobs = rows.map(normalizeTrainingJobRecord);
    const syncedJobs = await syncTrainingJobs(jobs);
    const ownerMap = await loadResourceOwnerMap(
      ctx.db,
      syncedJobs.map((job) => job.ownerUserId),
    );

    return syncedJobs.map((job) => ({
      ...job,
      ownerUser: ownerForUserId(ownerMap, job.ownerUserId),
    }));
  }),

  createStudioRun: operatorProcedure
    .input(createStudioTrainingRunInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const now = new Date();
        const [created] = await ctx.db
          .insert(trainingJobs)
          .values({
            ownerUserId: ctx.user.id,
            title: input.title,
            jobType: input.jobType,
            status: "draft",
            priority: input.priority,
            baseModel: input.baseModel,
            datasetName: input.datasetName,
            datasetSplit: input.datasetSplit,
            datasetTextField: input.datasetTextField,
            objective: input.objective,
            gpuAllocationMode: input.gpuAllocationMode,
            gpuCount: input.nodeCount * input.gpusPerNode,
            gpuMemoryGi:
              input.gpuAllocationMode === "memory" ? input.gpuMemoryGi : null,
            nodeCount: input.nodeCount,
            gpusPerNode: input.gpusPerNode,
            configSource: input.configSource,
            launcherType:
              input.nodeCount > 1 || input.gpusPerNode > 1
                ? "torchrun"
                : input.launcherType,
            distributedBackend: input.distributedBackend,
            deepspeedStage:
              input.distributedBackend === "deepspeed"
                ? (input.deepspeedStage ?? 2)
                : null,
            precision: input.precision,
            loadIn4bit: input.loadIn4bit,
            studioConfigSnapshot: input.studioConfigSnapshot ?? null,
            trainingConfigSnapshot: input.trainingConfigSnapshot ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (!created) {
          throw new Error("创建训练运行记录失败。");
        }

        const job = normalizeTrainingJobRecord(created);
        if (!input.autoStart) {
          return {
            job,
            message: `训练运行「${job.title}」已保存为草稿。`,
          };
        }

        const runtime = await submitTrainingJob(job);
        const [updated] = await ctx.db
          .update(trainingJobs)
          .set({
            status: "running",
            runtimeNamespace: runtime.namespace,
            runtimeKind: runtime.kind,
            runtimeJobName: runtime.jobName,
            runtimeServiceName: runtime.serviceName,
            runtimeLeaderPodName: runtime.leaderPodName,
            runtimeImage: runtime.image,
            artifactPath: runtime.artifactPath,
            lastError: null,
            startedAt: new Date(),
            finishedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(trainingJobs.id, job.id))
          .returning();

        return {
          job: normalizeTrainingJobRecord(updated ?? created),
          message: `多机多卡训练已提交：${runtime.namespace}/${runtime.jobName}`,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "提交 Unsloth 训练失败。",
        });
      }
    }),

  startStudioRun: operatorProcedure
    .input(trainingRunActionInput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(trainingJobs)
        .where(eq(trainingJobs.id, input.id))
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "训练运行不存在。",
        });
      }

      const job = normalizeTrainingJobRecord(row);
      if (job.status === "running") {
        return { message: "训练运行已经在执行中。" };
      }

      try {
        const runtime = await submitTrainingJob(job);
        await ctx.db
          .update(trainingJobs)
          .set({
            status: "running",
            runtimeNamespace: runtime.namespace,
            runtimeKind: runtime.kind,
            runtimeJobName: runtime.jobName,
            runtimeServiceName: runtime.serviceName,
            runtimeLeaderPodName: runtime.leaderPodName,
            runtimeImage: runtime.image,
            artifactPath: runtime.artifactPath,
            lastError: null,
            startedAt: new Date(),
            finishedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(trainingJobs.id, job.id));

        return {
          message: `训练运行已提交：${runtime.namespace}/${runtime.jobName}`,
        };
      } catch (error) {
        await ctx.db
          .update(trainingJobs)
          .set({
            status: "failed",
            lastError:
              error instanceof Error ? error.message : "启动训练运行失败。",
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(trainingJobs.id, job.id));

        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "启动训练运行失败。",
        });
      }
    }),

  stopStudioRun: operatorProcedure
    .input(trainingRunActionInput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(trainingJobs)
        .where(eq(trainingJobs.id, input.id))
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "训练运行不存在。",
        });
      }

      const job = normalizeTrainingJobRecord(row);

      try {
        await stopTrainingJobRun(job);
        await ctx.db
          .update(trainingJobs)
          .set({
            status: "stopped",
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(trainingJobs.id, job.id));

        return {
          message: `训练运行「${job.title}」已停止。`,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "停止训练运行失败。",
        });
      }
    }),

  deleteStudioRun: operatorProcedure
    .input(trainingRunActionInput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(trainingJobs)
        .where(eq(trainingJobs.id, input.id))
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "训练运行不存在。",
        });
      }

      const job = normalizeTrainingJobRecord(row);

      try {
        await deleteTrainingJobRun(job);
        await ctx.db.delete(trainingJobs).where(eq(trainingJobs.id, job.id));

        return {
          message: `训练运行「${job.title}」已删除。`,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "删除训练运行失败。",
        });
      }
    }),

  inspectStudioRun: viewerProcedure
    .input(inspectTrainingRunInput)
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(trainingJobs)
        .where(eq(trainingJobs.id, input.id))
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "训练运行不存在。",
        });
      }

      try {
        return await inspectTrainingJobRuntime(normalizeTrainingJobRecord(row), {
          podName: input.podName,
          tailLines: input.tailLines,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "读取训练运行失败。",
        });
      }
    }),

  listUnslothStudios: viewerProcedure.query(async () => {
    const result = await listUnslothStudioRuntimes();
    return {
      ...result,
      imageOptions: resolveUnslothStudioImageOptions(),
    };
  }),

  createUnslothStudio: operatorProcedure
    .input(createUnslothStudioInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createUnslothStudioRuntime({
          ...input,
          ownerUserId: ctx.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "创建 Unsloth Studio 失败。",
        });
      }
    }),

  deleteUnslothStudio: operatorProcedure
    .input(unslothStudioActionInput)
    .mutation(async ({ input }) => {
      try {
        return await deleteUnslothStudioRuntime(input.name);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "删除 Unsloth Studio 失败。",
        });
      }
    }),

  listJupyterLabs: viewerProcedure.query(async () => {
    const result = await listJupyterLabRuntimes();
    return {
      ...result,
      imageOptions: resolveJupyterLabImageOptions(),
    };
  }),

  createJupyterLab: operatorProcedure
    .input(createJupyterLabInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createJupyterLabRuntime({
          ...input,
          ownerUserId: ctx.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "创建 JupyterLab 失败。",
        });
      }
    }),

  deleteJupyterLab: operatorProcedure
    .input(jupyterLabActionInput)
    .mutation(async ({ input }) => {
      try {
        return await deleteJupyterLabRuntime(input.name);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "删除 JupyterLab 失败。",
        });
      }
    }),
});
