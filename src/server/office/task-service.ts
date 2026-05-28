import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import type { db } from "@/server/db";
import {
  agents,
  approvals,
  devices,
  events,
  tasks,
  zoneSettings,
} from "@/server/db/schema";
import {
  resolveZoneWorkstationCapacity,
  taskStatusLabels,
  zoneLabels,
  zoneWorkstationLimitByZone,
  type ApprovalType,
  type Priority,
  type RiskLevel,
  type TaskStatus,
  type TaskType,
  type ZoneId,
} from "@/server/office/catalog";
import { parseRunnerMetadata } from "@/server/office/domain";
import {
  normalizeHermesGitLabRepository,
  type HermesGitLabRepository,
} from "@/server/office/hermes-gitlab";

type Database = typeof db;

export type AddWorkstationInput = {
  zoneId: ZoneId;
  ownerUserId: string;
};

export type CreateOfficeTaskInput = {
  title: string;
  summary: string;
  ownerAgentId: string;
  taskType: TaskType;
  priority: Priority;
  riskLevel: RiskLevel;
  gitlabRepository?: string;
  gitlabRef?: string;
  ownerUserId: string;
};

export type UpdateOfficeTaskStatusInput = {
  taskId: string;
  status: TaskStatus;
};

export type RequestOfficeApprovalInput = {
  taskId: string;
  approvalType: ApprovalType;
  title: string;
  summary: string;
  ownerUserId: string;
};

export type ResolveOfficeApprovalInput = {
  approvalId: string;
  decision: "approved" | "rejected";
  ownerUserId: string;
};

function nextAgentStatusForTaskStatus(status: TaskStatus) {
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
    case "completed":
    case "canceled":
      return "idle";
    default:
      return "planning";
  }
}

function taskStatusLabel(status: TaskStatus) {
  return taskStatusLabels[status];
}

function taskInputPayload(gitlabRepository: HermesGitLabRepository | null) {
  return gitlabRepository
    ? {
        gitlab: {
          repository: gitlabRepository.input,
          projectPath: gitlabRepository.projectPath,
          repositoryUrl: gitlabRepository.repositoryUrl,
          ref: gitlabRepository.ref,
        },
      }
    : undefined;
}

function linkedAgentId(metadata: unknown) {
  return parseRunnerMetadata(metadata).agentId;
}

export async function addOfficeWorkstation(
  database: Database,
  input: AddWorkstationInput,
) {
  const now = new Date();
  const maxCapacity = zoneWorkstationLimitByZone[input.zoneId];

  return database.transaction(async (tx) => {
    const agentsInZone = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.zoneId, input.zoneId));

    const [currentSetting] = await tx
      .select()
      .from(zoneSettings)
      .where(eq(zoneSettings.zoneId, input.zoneId))
      .limit(1);

    const currentCapacity = resolveZoneWorkstationCapacity(input.zoneId, {
      configuredCapacity: currentSetting?.workstationCapacity ?? null,
      occupiedCount: agentsInZone.length,
    });
    const nextCapacity = currentCapacity + 1;

    if (nextCapacity > maxCapacity) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${zoneLabels[input.zoneId]} 的预设工位已经全部启用。`,
      });
    }

    if (currentSetting) {
      await tx
        .update(zoneSettings)
        .set({
          workstationCapacity: nextCapacity,
          ownerUserId: currentSetting.ownerUserId ?? input.ownerUserId,
          updatedAt: now,
        })
        .where(eq(zoneSettings.zoneId, input.zoneId));
    } else {
      await tx.insert(zoneSettings).values({
        zoneId: input.zoneId,
        ownerUserId: input.ownerUserId,
        workstationCapacity: nextCapacity,
        createdAt: now,
      });
    }

    await tx.insert(events).values({
      eventType: "zone.workstation_added",
      entityType: "zone",
      entityId: input.zoneId,
      ownerUserId: input.ownerUserId,
      severity: "info",
      title: `${zoneLabels[input.zoneId]} 已新增工位`,
      description: `当前已启用 ${nextCapacity} / ${maxCapacity} 个预设工位。`,
      occurredAt: now,
    });

    return {
      zoneId: input.zoneId,
      workstationCapacity: nextCapacity,
      workstationMax: maxCapacity,
      message: `${zoneLabels[input.zoneId]} 已新增工位，当前 ${nextCapacity} / ${maxCapacity} 个工位已启用。`,
    };
  });
}

export async function createOfficeTask(
  database: Database,
  input: CreateOfficeTaskInput,
) {
  const now = new Date();

  return database.transaction(async (tx) => {
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

    const gitlabRepository = normalizeHermesGitLabRepository(
      input.gitlabRepository,
      input.gitlabRef,
    );

    if (gitlabRepository) {
      const deviceRows = await tx.select().from(devices);
      const targetDevice = deviceRows.find(
        (device) => linkedAgentId(device.metadata) === owner.id,
      );
      const targetEngine = parseRunnerMetadata(targetDevice?.metadata).engine;
      if (targetEngine !== "hermes-agent") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "GitLab 仓库任务只能分派给已绑定 Hermes runner 的人物。",
        });
      }
    }

    if (input.gitlabRef?.trim() && !gitlabRepository) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "填写分支或提交时，也需要填写 GitLab 仓库。",
      });
    }

    const taskStatus = owner.status === "idle" ? "assigned" : "queued";
    const [createdTask] = await tx
      .insert(tasks)
      .values({
        title: input.title,
        ownerUserId: input.ownerUserId,
        summary: input.summary,
        taskType: input.taskType,
        priority: input.priority,
        riskLevel: input.riskLevel,
        zoneId: owner.zoneId,
        currentAgentId: owner.id,
        inputPayload: taskInputPayload(gitlabRepository),
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
      ownerUserId: input.ownerUserId,
      severity: "info",
      title: `新任务已进入 ${owner.name} 的待办`,
      description: `${input.title} 已创建，并分派给 ${owner.name}。`,
      occurredAt: now,
    });

    return { taskId: createdTask.id };
  });
}

export async function updateOfficeTaskStatus(
  database: Database,
  input: UpdateOfficeTaskStatusInput,
) {
  const now = new Date();

  return database.transaction(async (tx) => {
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

    if (task.status === input.status) {
      return { taskId: task.id };
    }

    if (task.status === "pending_approval") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "任务正在等待审批，处理审批后才能继续修改状态。",
      });
    }

    if (task.status === "completed" || task.status === "canceled") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "已结束任务不能再次修改状态。",
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
          focus: `任务「${task.title}」状态已更新为 ${taskStatusLabel(input.status)}`,
          updatedAt: now,
        })
        .where(eq(agents.id, task.currentAgentId));
    }

    await tx.insert(events).values({
      eventType: "task.status.changed",
      entityType: "task",
      entityId: task.id,
      ownerUserId: task.ownerUserId,
      severity:
        input.status === "failed"
          ? "warning"
          : input.status === "pending_approval"
            ? "warning"
            : "info",
      title: `任务状态已更新：${task.title}`,
      description: `任务已被更新为${taskStatusLabel(input.status)}。`,
      occurredAt: now,
    });

    return { taskId: task.id };
  });
}

export async function requestOfficeApproval(
  database: Database,
  input: RequestOfficeApprovalInput,
) {
  const now = new Date();

  return database.transaction(async (tx) => {
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

    if (task.status === "pending_approval") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "该任务已有待处理审批。",
      });
    }

    if (task.status === "completed" || task.status === "canceled") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "已结束任务不能再发起审批。",
      });
    }

    const [pendingApproval] = await tx
      .select()
      .from(approvals)
      .where(
        and(eq(approvals.taskId, task.id), eq(approvals.status, "pending")),
      )
      .limit(1);

    if (pendingApproval) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "该任务已有待处理审批。",
      });
    }

    const [approval] = await tx
      .insert(approvals)
      .values({
        taskId: task.id,
        ownerUserId: task.ownerUserId ?? input.ownerUserId,
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
      ownerUserId: task.ownerUserId ?? input.ownerUserId,
      severity: "warning",
      title: `已发起审批：${input.title}`,
      description: input.summary,
      occurredAt: now,
    });

    return { approvalId: approval?.id ?? null };
  });
}

export async function resolveOfficeApproval(
  database: Database,
  input: ResolveOfficeApprovalInput,
) {
  const now = new Date();

  return database.transaction(async (tx) => {
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
        approvedByUserId: input.ownerUserId,
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
            status: input.decision === "approved" ? "planning" : "blocked",
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
      ownerUserId: approval.ownerUserId ?? input.ownerUserId,
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
}
