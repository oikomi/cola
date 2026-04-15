import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { agents, approvals, events, tasks } from "@/server/db/schema";
import {
  approvalTypeValues,
  priorityValues,
  riskLevelValues,
  taskStatusValues,
  taskTypeValues,
} from "@/server/office/catalog";
import { getOfficeSnapshot } from "@/server/office/snapshot";

const createTaskInput = z.object({
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(8).max(500),
  ownerAgentId: z.string().uuid(),
  taskType: z.enum(taskTypeValues),
  priority: z.enum(priorityValues),
  riskLevel: z.enum(riskLevelValues),
});

const updateTaskStatusInput = z.object({
  taskId: z.string().uuid(),
  status: z.enum(taskStatusValues),
});

const requestApprovalInput = z.object({
  taskId: z.string().uuid(),
  approvalType: z.enum(approvalTypeValues),
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(8).max(500),
});

const resolveApprovalInput = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});

function nextAgentStatusForTaskStatus(status: (typeof taskStatusValues)[number]) {
  switch (status) {
    case "assigned":
    case "created":
    case "queued":
      return "planning";
    case "in_progress":
      return "executing";
    case "pending_approval":
      return "waiting_approval";
    case "handed_off":
      return "waiting_handoff";
    case "failed":
      return "error";
    case "completed":
    case "canceled":
      return "idle";
    default:
      return "planning";
  }
}

export const officeRouter = createTRPCRouter({
  getSnapshot: publicProcedure.query(({ ctx }) => getOfficeSnapshot(ctx.db)),

  getAgentById: publicProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const snapshot = await getOfficeSnapshot(ctx.db);
      return snapshot.agents.find((agent) => agent.id === input.agentId) ?? null;
    }),

  getTaskById: publicProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const snapshot = await getOfficeSnapshot(ctx.db);
      return snapshot.tasks.find((task) => task.id === input.taskId) ?? null;
    }),

  createTask: publicProcedure
    .input(createTaskInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      return ctx.db.transaction(async (tx) => {
        const [owner] = await tx
          .select()
          .from(agents)
          .where(eq(agents.id, input.ownerAgentId))
          .limit(1);

        if (!owner) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "未找到目标角色，无法创建任务。",
          });
        }

        const taskStatus = owner.status === "idle" ? "assigned" : "queued";
        const [createdTask] = await tx
          .insert(tasks)
          .values({
            title: input.title,
            summary: input.summary,
            taskType: input.taskType,
            priority: input.priority,
            riskLevel: input.riskLevel,
            zoneId: owner.zoneId,
            currentAgentId: owner.id,
            status: taskStatus,
            createdAt: now,
          })
          .returning();

        if (!createdTask) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "任务创建失败。",
          });
        }

        if (owner.status === "idle") {
          await tx
            .update(agents)
            .set({
              status: "planning",
              focus: `已接收新任务：${input.title}`,
              updatedAt: now,
            })
            .where(eq(agents.id, owner.id));
        }

        await tx.insert(events).values({
          eventType: "task.created",
          entityType: "task",
          entityId: createdTask.id,
          severity: "info",
          title: `新任务已进入 ${owner.name} 的待办`,
          description: `${input.title} 已创建，并分派给 ${owner.name}。`,
          occurredAt: now,
        });

        return { taskId: createdTask.id };
      });
    }),

  updateTaskStatus: publicProcedure
    .input(updateTaskStatusInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      return ctx.db.transaction(async (tx) => {
        const [task] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.id, input.taskId))
          .limit(1);

        if (!task) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "未找到目标任务。",
          });
        }

        await tx
          .update(tasks)
          .set({
            status: input.status,
            updatedAt: now,
          })
          .where(eq(tasks.id, task.id));

        if (task.currentAgentId) {
          await tx
            .update(agents)
            .set({
              status: nextAgentStatusForTaskStatus(input.status),
              focus: `任务「${task.title}」状态已更新为 ${input.status}`,
              updatedAt: now,
            })
            .where(eq(agents.id, task.currentAgentId));
        }

        await tx.insert(events).values({
          eventType: "task.status.changed",
          entityType: "task",
          entityId: task.id,
          severity:
            input.status === "failed"
              ? "critical"
              : input.status === "pending_approval"
                ? "warning"
                : "info",
          title: `任务状态已更新：${task.title}`,
          description: `任务已被更新为 ${input.status}。`,
          occurredAt: now,
        });

        return { taskId: task.id };
      });
    }),

  requestApproval: publicProcedure
    .input(requestApprovalInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      return ctx.db.transaction(async (tx) => {
        const [task] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.id, input.taskId))
          .limit(1);

        if (!task) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "未找到目标任务，无法发起审批。",
          });
        }

        const [pendingApproval] = await tx
          .select()
          .from(approvals)
          .where(eq(approvals.taskId, task.id))
          .limit(1);

        if (pendingApproval?.status === "pending") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "该任务已有待处理审批。",
          });
        }

        const [approval] = await tx
          .insert(approvals)
          .values({
            taskId: task.id,
            approvalType: input.approvalType,
            status: "pending",
            requestedByAgentId: task.currentAgentId,
            title: input.title,
            reason: input.summary,
            createdAt: now,
          })
          .returning();

        await tx
          .update(tasks)
          .set({
            status: "pending_approval",
            updatedAt: now,
          })
          .where(eq(tasks.id, task.id));

        if (task.currentAgentId) {
          await tx
            .update(agents)
            .set({
              status: "waiting_approval",
              focus: `等待审批：${input.title}`,
              updatedAt: now,
            })
            .where(eq(agents.id, task.currentAgentId));
        }

        await tx.insert(events).values({
          eventType: "approval.requested",
          entityType: "approval",
          entityId: approval?.id ?? task.id,
          severity: "warning",
          title: `已发起审批：${input.title}`,
          description: input.summary,
          occurredAt: now,
        });

        return { approvalId: approval?.id ?? null };
      });
    }),

  resolveApproval: publicProcedure
    .input(resolveApprovalInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      return ctx.db.transaction(async (tx) => {
        const [approval] = await tx
          .select()
          .from(approvals)
          .where(eq(approvals.id, input.approvalId))
          .limit(1);

        if (!approval) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "未找到审批记录。",
          });
        }

        if (approval.status !== "pending") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "该审批已经处理过，不能重复提交。",
          });
        }

        await tx
          .update(approvals)
          .set({
            status: input.decision,
            approvedByUserId: "local-operator",
            resolvedAt: now,
            updatedAt: now,
          })
          .where(eq(approvals.id, approval.id));

        if (approval.taskId) {
          const nextTaskStatus =
            input.decision === "approved" ? "assigned" : "canceled";

          await tx
            .update(tasks)
            .set({
              status: nextTaskStatus,
              updatedAt: now,
            })
            .where(eq(tasks.id, approval.taskId));

          if (approval.requestedByAgentId) {
            await tx
              .update(agents)
              .set({
                status:
                  input.decision === "approved" ? "planning" : "blocked",
                focus:
                  input.decision === "approved"
                    ? `审批通过，继续执行：${approval.title}`
                    : `审批被驳回：${approval.title}`,
                updatedAt: now,
              })
              .where(eq(agents.id, approval.requestedByAgentId));
          }
        }

        await tx.insert(events).values({
          eventType: "approval.resolved",
          entityType: "approval",
          entityId: approval.id,
          severity: input.decision === "approved" ? "info" : "critical",
          title:
            input.decision === "approved"
              ? `审批已通过：${approval.title}`
              : `审批被驳回：${approval.title}`,
          description:
            input.decision === "approved"
              ? "系统已恢复任务流转。"
              : "任务已被取消，等待人工重排。",
          occurredAt: now,
        });

        return { approvalId: approval.id };
      });
    }),
});
