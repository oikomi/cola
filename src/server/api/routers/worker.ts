import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { devices, events, executionSessions, tasks } from "@/server/db/schema";
import {
  deviceStatusValues,
  sessionStatusValues,
} from "@/server/office/catalog";

const registerDockerRunnerInput = z.object({
  name: z.string().trim().min(3).max(120),
  resourcePool: z.string().trim().min(2).max(120),
  host: z.string().trim().max(255).optional(),
  healthSummary: z.string().trim().max(255).optional(),
  containerName: z.string().trim().max(120).optional(),
  image: z.string().trim().max(255).optional(),
});

const heartbeatInput = z.object({
  deviceId: z.string().uuid(),
  status: z.enum(deviceStatusValues),
  healthSummary: z.string().trim().max(255).optional(),
  host: z.string().trim().max(255).optional(),
  containerName: z.string().trim().max(120).optional(),
  image: z.string().trim().max(255).optional(),
});

const reportSessionInput = z.object({
  sessionId: z.string().uuid().optional(),
  deviceId: z.string().uuid(),
  taskId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  status: z.enum(sessionStatusValues),
  logPath: z.string().trim().max(500).optional(),
  artifactPath: z.string().trim().max(500).optional(),
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeMetadata(
  current: unknown,
  patch: Record<string, string>,
): Record<string, unknown> {
  return {
    ...(isPlainRecord(current) ? current : {}),
    ...patch,
  };
}

export const workerRouter = createTRPCRouter({
  registerDockerRunner: publicProcedure
    .input(registerDockerRunnerInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [existing] = await ctx.db
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.name, input.name),
            eq(devices.resourcePool, input.resourcePool),
          ),
        )
        .limit(1);

      const metadataPatch = {
        runtime: "docker",
        engine: "openclaw",
        healthSummary: input.healthSummary ?? "Docker runner 已注册，等待任务。",
        ...(input.containerName ? { containerName: input.containerName } : {}),
        ...(input.image ? { image: input.image } : {}),
      };

      if (existing) {
        const [updated] = await ctx.db
          .update(devices)
          .set({
            deviceType: "docker_openclaw",
            status: "online",
            host: input.host ?? existing.host,
            metadata: mergeMetadata(existing.metadata, metadataPatch),
            lastHeartbeatAt: now,
            updatedAt: now,
          })
          .where(eq(devices.id, existing.id))
          .returning();

        await ctx.db.insert(events).values({
          eventType: "device.registered",
          entityType: "device",
          entityId: existing.id,
          severity: "info",
          title: `Docker OpenClaw runner 已重新注册：${existing.name}`,
          description: `资源池 ${existing.resourcePool} 已恢复在线。`,
          occurredAt: now,
        });

        return { deviceId: updated?.id ?? existing.id };
      }

      const [created] = await ctx.db
        .insert(devices)
        .values({
          name: input.name,
          deviceType: "docker_openclaw",
          status: "online",
          resourcePool: input.resourcePool,
          host: input.host,
          metadata: metadataPatch,
          lastHeartbeatAt: now,
          createdAt: now,
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Docker runner 注册失败。",
        });
      }

      await ctx.db.insert(events).values({
        eventType: "device.registered",
        entityType: "device",
        entityId: created.id,
        severity: "info",
        title: `Docker OpenClaw runner 已注册：${created.name}`,
        description: `资源池 ${created.resourcePool} 已加入执行层。`,
        occurredAt: now,
      });

      return { deviceId: created.id };
    }),

  heartbeat: publicProcedure
    .input(heartbeatInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [device] = await ctx.db
        .select()
        .from(devices)
        .where(eq(devices.id, input.deviceId))
        .limit(1);

      if (!device) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "未找到目标 Docker runner。",
        });
      }

      const previousStatus = device.status;
      const metadataPatch = {
        runtime: "docker",
        engine: "openclaw",
        healthSummary:
          input.healthSummary ?? "Docker runner 心跳正常，等待下一次调度。",
        ...(input.containerName ? { containerName: input.containerName } : {}),
        ...(input.image ? { image: input.image } : {}),
      };

      await ctx.db
        .update(devices)
        .set({
          status: input.status,
          host: input.host ?? device.host,
          metadata: mergeMetadata(device.metadata, metadataPatch),
          lastHeartbeatAt: now,
          updatedAt: now,
        })
        .where(eq(devices.id, device.id));

      if (previousStatus !== input.status) {
        await ctx.db.insert(events).values({
          eventType: "device.status.changed",
          entityType: "device",
          entityId: device.id,
          severity:
            input.status === "unhealthy" || input.status === "offline"
              ? "critical"
              : input.status === "maintenance"
                ? "warning"
                : "info",
          title: `Docker runner 状态变更：${device.name}`,
          description: `设备状态已从 ${previousStatus} 更新为 ${input.status}。`,
          occurredAt: now,
        });
      }

      return { deviceId: device.id };
    }),

  reportSession: publicProcedure
    .input(reportSessionInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      return ctx.db.transaction(async (tx) => {
        const [device] = await tx
          .select()
          .from(devices)
          .where(eq(devices.id, input.deviceId))
          .limit(1);

        if (!device) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "未找到目标 Docker runner。",
          });
        }

        const [task] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.id, input.taskId))
          .limit(1);

        if (!task) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "未找到目标任务，无法记录会话。",
          });
        }

        const existingSession = input.sessionId
          ? (
              await tx
                .select()
                .from(executionSessions)
                .where(eq(executionSessions.id, input.sessionId))
                .limit(1)
            )[0]
          : (
              await tx
                .select()
                .from(executionSessions)
                .where(eq(executionSessions.deviceId, input.deviceId))
                .orderBy(desc(executionSessions.createdAt))
                .limit(1)
            )[0];

        const isRunning = input.status === "starting" || input.status === "running";
        const isFinished =
          input.status === "succeeded" ||
          input.status === "failed" ||
          input.status === "canceled";

        const session =
          existingSession && input.sessionId
            ? (
                await tx
                  .update(executionSessions)
                  .set({
                    taskId: input.taskId,
                    agentId: input.agentId ?? existingSession.agentId,
                    deviceId: input.deviceId,
                    status: input.status,
                    logPath: input.logPath ?? existingSession.logPath,
                    artifactPath: input.artifactPath ?? existingSession.artifactPath,
                    startedAt:
                      existingSession.startedAt ?? (isRunning ? now : existingSession.startedAt),
                    endedAt: isFinished ? now : null,
                    updatedAt: now,
                  })
                  .where(eq(executionSessions.id, existingSession.id))
                  .returning()
              )[0]
            : (
                await tx
                  .insert(executionSessions)
                  .values({
                    taskId: input.taskId,
                    agentId: input.agentId,
                    deviceId: input.deviceId,
                    status: input.status,
                    logPath: input.logPath,
                    artifactPath: input.artifactPath,
                    startedAt: isRunning ? now : null,
                    endedAt: isFinished ? now : null,
                    createdAt: now,
                  })
                  .returning()
              )[0];

        if (!session) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "执行会话写入失败。",
          });
        }

        await tx
          .update(devices)
          .set({
            status: isRunning ? "busy" : input.status === "failed" ? "unhealthy" : "online",
            lastHeartbeatAt: now,
            updatedAt: now,
          })
          .where(eq(devices.id, input.deviceId));

        await tx.insert(events).values({
          eventType: "execution_session.reported",
          entityType: "execution_session",
          entityId: session.id,
          severity: input.status === "failed" ? "critical" : "info",
          title: `Docker runner 已回报执行会话：${device.name}`,
          description: `任务「${task.title}」当前会话状态为 ${input.status}。`,
          occurredAt: now,
        });

        return { sessionId: session.id };
      });
    }),
});

