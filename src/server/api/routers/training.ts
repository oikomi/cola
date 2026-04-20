import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { events, trainingJobs } from "@/server/db/schema";
import {
  priorityValues,
  priorityLabels,
} from "@/server/office/catalog";
import {
  trainingJobStatusLabels,
  trainingJobTypeLabels,
  trainingJobTypeValues,
} from "@/server/training/catalog";

const createTrainingJobInput = z.object({
  title: z.string().trim().min(3).max(160),
  objective: z.string().trim().min(8).max(600),
  jobType: z.enum(trainingJobTypeValues),
  priority: z.enum(priorityValues),
  baseModel: z.string().trim().min(2).max(120),
  datasetName: z.string().trim().min(2).max(120),
  gpuCount: z.number().int().min(1).max(64),
});

const trainingJobActionInput = z.object({
  jobId: z.string().uuid(),
});

export const trainingRouter = createTRPCRouter({
  listJobs: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(trainingJobs)
      .orderBy(desc(trainingJobs.createdAt));
  }),

  createJob: publicProcedure
    .input(createTrainingJobInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

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
            gpuCount: input.gpuCount,
            status: "draft",
            createdAt: now,
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
          description: `${trainingJobTypeLabels[input.jobType]} · ${input.baseModel} · ${priorityLabels[input.priority]}优先级`,
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

      return ctx.db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(trainingJobs)
          .where(eq(trainingJobs.id, input.jobId))
          .limit(1);

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

        await tx
          .update(trainingJobs)
          .set({
            status: "running",
            startedAt: now,
            finishedAt: null,
            updatedAt: now,
          })
          .where(eq(trainingJobs.id, job.id));

        await tx.insert(events).values({
          eventType: "training.job.started",
          entityType: "training_job",
          entityId: job.id,
          severity: "info",
          title: `训练任务已启动：${job.title}`,
          description: `${trainingJobStatusLabels.running} · ${job.gpuCount} GPU`,
          occurredAt: now,
        });

        return {
          jobId: job.id,
          message: "训练任务已启动。",
        };
      });
    }),

  stopJob: publicProcedure
    .input(trainingJobActionInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      return ctx.db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(trainingJobs)
          .where(eq(trainingJobs.id, input.jobId))
          .limit(1);

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
          description: "任务已从运行状态切回停止状态。",
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
        const [job] = await tx
          .select()
          .from(trainingJobs)
          .where(eq(trainingJobs.id, input.jobId))
          .limit(1);

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
