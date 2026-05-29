import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { db } from "@/server/db";
import {
  agents,
  devices,
  events,
  executionSessions,
  tasks,
  users,
} from "@/server/db/schema";
import {
  dockerRunnerDeviceTypeByEngine,
  dockerRunnerEngineLabels,
  runnerRuntimeLabels,
} from "@/server/office/catalog";
import {
  mergeMetadata,
  parseRunnerMetadata,
  resolveDockerRunnerEngine,
  resolveRunnerRuntime,
} from "@/server/office/domain";
import {
  notifyHermesTaskResultToFeishu,
  notifyHermesTaskResultToFeishuUser,
  type FeishuUserNotificationMessage,
} from "@/server/office/feishu-notifier";
import { readHermesGitLabRepository } from "@/server/office/hermes-gitlab";
import { readExecutionResult } from "@/server/office/execution-result";
import { buildRunnerTaskPrompt } from "@/server/worker/task-prompt";
import type {
  HeartbeatInput,
  PullNextTaskInput,
  RegisterDockerRunnerInput,
  ReportSessionInput,
} from "@/server/worker/schemas";

type Database = typeof db;

function readNotificationUserIds(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const notification = "notification" in payload ? payload.notification : null;
  if (
    !notification ||
    typeof notification !== "object" ||
    Array.isArray(notification)
  ) {
    return [];
  }

  const userIds = "userIds" in notification ? notification.userIds : null;
  if (!Array.isArray(userIds)) return [];

  return Array.from(
    new Set(
      userIds.filter((userId): userId is string => typeof userId === "string"),
    ),
  );
}

function linkedAgentMetadata(metadata: unknown) {
  const { agentId, agentName } = parseRunnerMetadata(metadata);
  return { agentId, agentName };
}

async function findOwnerUserIdForLinkedAgent(
  database: Database,
  metadata: unknown,
) {
  const { agentId } = parseRunnerMetadata(metadata);
  if (!agentId) return null;

  const [agent] = await database
    .select({ ownerUserId: agents.ownerUserId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  return agent?.ownerUserId ?? null;
}

async function syncLinkedAgentReadiness(
  database: Database,
  metadata: unknown,
  engineLabel: string,
  runtimeLabel: string,
  deviceStatus: RegisterDockerRunnerInput["status"] | HeartbeatInput["status"],
  healthSummary: string,
  now: Date,
) {
  const { agentId, agentName } = linkedAgentMetadata(metadata);
  if (!agentId) return;

  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (
    !agent ||
    (deviceStatus === "online"
      ? !["waiting_device", "blocked", "error"].includes(agent.status)
      : ["executing", "waiting_handoff", "waiting_approval"].includes(
          agent.status,
        ))
  ) {
    return;
  }

  const displayName = agentName ?? agent.name;

  if (deviceStatus === "online") {
    await database
      .update(agents)
      .set({
        status: "idle",
        focus: `${displayName} 已就绪，可开始接任务`,
        updatedAt: now,
      })
      .where(eq(agents.id, agentId));
    return;
  }

  if (deviceStatus === "maintenance") {
    await database
      .update(agents)
      .set({
        status: "waiting_device",
        focus: `${displayName} runner 已在 ${runtimeLabel} 中启动，等待 ${engineLabel} 完成注册`,
        updatedAt: now,
      })
      .where(eq(agents.id, agentId));
    return;
  }

  if (deviceStatus === "unhealthy" || deviceStatus === "offline") {
    await database
      .update(agents)
      .set({
        status: deviceStatus === "unhealthy" ? "error" : "blocked",
        focus:
          healthSummary ||
          `${displayName} runner 就绪检查失败，需要处理 ${runtimeLabel} / ${engineLabel} 配置`,
        updatedAt: now,
      })
      .where(eq(agents.id, agentId));
  }
}

export async function registerDockerRunner(
  database: Database,
  input: RegisterDockerRunnerInput,
) {
  const now = new Date();
  const engine = resolveDockerRunnerEngine(input.engine);
  const engineLabel = dockerRunnerEngineLabels[engine];
  const runtime = resolveRunnerRuntime(input.runtime);
  const runtimeLabel = runnerRuntimeLabels[runtime];
  const status = input.status ?? "online";
  const [existing] = await database
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
    runtime,
    engine,
    healthSummary:
      input.healthSummary ?? `${runtimeLabel} runner 已注册，等待任务。`,
    ...(input.containerName ? { containerName: input.containerName } : {}),
    ...(input.image ? { image: input.image } : {}),
  };

  if (existing) {
    const mergedMetadata = mergeMetadata(existing.metadata, metadataPatch);
    const ownerUserId =
      existing.ownerUserId ??
      (await findOwnerUserIdForLinkedAgent(database, existing.metadata));
    const [updated] = await database
      .update(devices)
      .set({
        ownerUserId,
        deviceType: dockerRunnerDeviceTypeByEngine[engine],
        status,
        host: input.host ?? existing.host,
        metadata: mergedMetadata,
        lastHeartbeatAt: now,
        updatedAt: now,
      })
      .where(eq(devices.id, existing.id))
      .returning();

    await syncLinkedAgentReadiness(
      database,
      mergedMetadata,
      engineLabel,
      runtimeLabel,
      status,
      metadataPatch.healthSummary,
      now,
    );

    await database.insert(events).values({
      eventType: "device.registered",
      entityType: "device",
      entityId: existing.id,
      ownerUserId,
      severity:
        status === "unhealthy" || status === "offline"
          ? "critical"
          : status === "maintenance"
            ? "warning"
            : "info",
      title: `${runtimeLabel} ${engineLabel} runner 已重新注册：${existing.name}`,
      description: metadataPatch.healthSummary,
      occurredAt: now,
    });

    return { deviceId: updated?.id ?? existing.id };
  }

  const [created] = await database
    .insert(devices)
    .values({
      name: input.name,
      ownerUserId: await findOwnerUserIdForLinkedAgent(database, metadataPatch),
      deviceType: dockerRunnerDeviceTypeByEngine[engine],
      status,
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
      message: `${runtimeLabel} runner 注册失败。`,
    });
  }

  await database.insert(events).values({
    eventType: "device.registered",
    entityType: "device",
    entityId: created.id,
    ownerUserId: created.ownerUserId,
    severity:
      status === "unhealthy" || status === "offline"
        ? "critical"
        : status === "maintenance"
          ? "warning"
          : "info",
    title: `${runtimeLabel} ${engineLabel} runner 已注册：${created.name}`,
    description: metadataPatch.healthSummary,
    occurredAt: now,
  });

  return { deviceId: created.id };
}

export async function heartbeatRunner(
  database: Database,
  input: HeartbeatInput,
) {
  const now = new Date();
  const findDeviceById = async (deviceId: string) =>
    (
      await database
        .select()
        .from(devices)
        .where(eq(devices.id, deviceId))
        .limit(1)
    )[0];

  let device = await findDeviceById(input.deviceId);

  if (!device) {
    if (input.name && input.resourcePool) {
      const registration = await registerDockerRunner(database, {
        name: input.name,
        resourcePool: input.resourcePool,
        status: input.status,
        engine: input.engine,
        host: input.host,
        healthSummary: input.healthSummary,
        containerName: input.containerName,
        image: input.image,
        runtime: input.runtime,
      });

      device = await findDeviceById(registration.deviceId);
    }

    if (!device) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "未找到目标 runner。",
      });
    }
  }

  const previousStatus = device.status;
  const currentMetadata = parseRunnerMetadata(device.metadata);
  const engine = resolveDockerRunnerEngine(
    input.engine ?? currentMetadata.engine,
  );
  const engineLabel = dockerRunnerEngineLabels[engine];
  const runtime = resolveRunnerRuntime(
    input.runtime ?? currentMetadata.runtime,
  );
  const runtimeLabel = runnerRuntimeLabels[runtime];
  const metadataPatch = {
    runtime,
    engine,
    healthSummary:
      input.healthSummary ??
      `${runtimeLabel} runner 心跳正常，等待下一次调度。`,
    ...(input.containerName ? { containerName: input.containerName } : {}),
    ...(input.image ? { image: input.image } : {}),
  };

  await database
    .update(devices)
    .set({
      deviceType: dockerRunnerDeviceTypeByEngine[engine],
      status: input.status,
      host: input.host ?? device.host,
      metadata: mergeMetadata(device.metadata, metadataPatch),
      lastHeartbeatAt: now,
      updatedAt: now,
    })
    .where(eq(devices.id, device.id));

  if (input.status !== "busy") {
    await syncLinkedAgentReadiness(
      database,
      mergeMetadata(device.metadata, metadataPatch),
      engineLabel,
      runtimeLabel,
      input.status,
      metadataPatch.healthSummary,
      now,
    );
  }

  if (previousStatus !== input.status) {
    await database.insert(events).values({
      eventType: "device.status.changed",
      entityType: "device",
      entityId: device.id,
      ownerUserId: device.ownerUserId,
      severity:
        input.status === "unhealthy" || input.status === "offline"
          ? "critical"
          : input.status === "maintenance"
            ? "warning"
            : "info",
      title: `${runtimeLabel} ${engineLabel} runner 状态变更：${device.name}`,
      description: `设备状态已从 ${previousStatus} 更新为 ${input.status}。`,
      occurredAt: now,
    });
  }

  return { deviceId: device.id };
}

export async function reportRunnerSession(
  database: Database,
  input: ReportSessionInput,
) {
  const now = new Date();

  return database.transaction(async (tx) => {
    const [device] = await tx
      .select()
      .from(devices)
      .where(eq(devices.id, input.deviceId))
      .limit(1);

    if (!device) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "未找到目标 runner。",
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
                ownerUserId: existingSession.ownerUserId ?? task.ownerUserId,
                agentId: input.agentId ?? existingSession.agentId,
                deviceId: input.deviceId,
                status: input.status,
                logPath: input.logPath ?? existingSession.logPath,
                artifactPath:
                  input.artifactPath ?? existingSession.artifactPath,
                startedAt:
                  existingSession.startedAt ??
                  (isRunning ? now : existingSession.startedAt),
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
                ownerUserId: task.ownerUserId,
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
        status: isRunning ? "busy" : "online",
        lastHeartbeatAt: now,
        updatedAt: now,
      })
      .where(eq(devices.id, input.deviceId));

    const nextTaskStatus = isRunning
      ? "in_progress"
      : input.status === "succeeded"
        ? "completed"
        : input.status === "failed"
          ? "failed"
          : input.status === "canceled"
            ? "canceled"
            : null;

    if (nextTaskStatus) {
      await tx
        .update(tasks)
        .set({
          status: nextTaskStatus,
          updatedAt: now,
        })
        .where(eq(tasks.id, input.taskId));
    }

    if (input.agentId) {
      await tx
        .update(agents)
        .set({
          status: isRunning ? "executing" : "idle",
          focus: isRunning
            ? `正在执行任务：${task.title}`
            : input.status === "failed"
              ? `上次任务执行失败：${task.title}`
              : input.status === "canceled"
                ? `任务已取消：${task.title}`
                : `已完成任务：${task.title}`,
          updatedAt: now,
        })
        .where(eq(agents.id, input.agentId));
    }

    const [agent] = input.agentId
      ? await tx
          .select()
          .from(agents)
          .where(eq(agents.id, input.agentId))
          .limit(1)
      : [null];
    const notificationUserIds = readNotificationUserIds(task.inputPayload);
    const notificationUsers =
      notificationUserIds.length > 0
        ? await tx
            .select({ feishuOpenId: users.feishuOpenId })
            .from(users)
            .where(inArray(users.id, notificationUserIds))
        : [];
    const [taskOwner] =
      notificationUsers.length === 0 && task.ownerUserId
        ? await tx
            .select({ feishuOpenId: users.feishuOpenId })
            .from(users)
            .where(eq(users.id, task.ownerUserId))
            .limit(1)
        : [null];
    const deviceMetadata = parseRunnerMetadata(device.metadata);
    const isHermesRunner =
      resolveDockerRunnerEngine(deviceMetadata.engine) === "hermes-agent";
    const notificationWarnings: string[] = [];
    let feishuUserMessages: FeishuUserNotificationMessage[] = [];
    let recipientSummary = "未触发个人通知";

    if (isFinished && isHermesRunner) {
      const executionResult = readExecutionResult(
        input.artifactPath ?? session.artifactPath,
      );
      const notificationInput = {
        taskTitle: task.title,
        taskSummary: task.summary,
        agentName: agent?.name ?? deviceMetadata.agentName ?? null,
        deviceName: device.name,
        status: input.status,
        artifactPath: input.artifactPath ?? session.artifactPath,
        logPath: input.logPath ?? session.logPath,
        outputText: input.outputText ?? executionResult?.outputText ?? null,
      };
      const recipientOpenIds =
        notificationUsers.length > 0
          ? notificationUsers.map((user) => user.feishuOpenId)
          : [];
      recipientSummary =
        notificationUserIds.length > 0
          ? `指定个人通知 ${recipientOpenIds.length}/${notificationUserIds.length} 人`
          : taskOwner?.feishuOpenId
            ? "默认通知任务创建人"
            : "没有可用个人通知人";
      const targetOpenIds =
        recipientOpenIds.length > 0
          ? recipientOpenIds
          : taskOwner?.feishuOpenId
            ? [taskOwner.feishuOpenId]
            : [];

      try {
        await notifyHermesTaskResultToFeishu(notificationInput, targetOpenIds);
      } catch (error) {
        notificationWarnings.push(
          error instanceof Error ? error.message : "飞书群通知发送失败。",
        );
      }

      try {
        feishuUserMessages = await notifyHermesTaskResultToFeishuUser(
          targetOpenIds,
          notificationInput,
        );
      } catch (error) {
        notificationWarnings.push(
          error instanceof Error ? error.message : "飞书个人通知发送失败。",
        );
      }
    }

    await tx.insert(events).values({
      eventType: "execution_session.reported",
      entityType: "execution_session",
      entityId: session.id,
      ownerUserId: session.ownerUserId ?? task.ownerUserId,
      severity:
        notificationWarnings.length > 0
          ? "critical"
          : input.status === "failed"
            ? "warning"
            : "info",
      title: `Runner 已回报执行会话：${device.name}`,
      description:
        notificationWarnings.length > 0
          ? `任务「${task.title}」当前会话状态为 ${input.status}，${recipientSummary}，但${notificationWarnings.join("；")}`
          : `任务「${task.title}」当前会话状态为 ${input.status}，${recipientSummary}。`,
      payload:
        feishuUserMessages.length > 0
          ? {
              feishu: {
                notificationMessages: feishuUserMessages,
              },
            }
          : undefined,
      occurredAt: now,
    });

    return { sessionId: session.id };
  });
}

const priorityWeight = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
} as const;

export async function pullNextTaskForRunner(
  database: Database,
  input: PullNextTaskInput,
) {
  const now = new Date();
  const [device] = await database
    .select()
    .from(devices)
    .where(eq(devices.id, input.deviceId))
    .limit(1);

  if (!device) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "未找到目标 runner。",
    });
  }

  const metadata = parseRunnerMetadata(device.metadata);
  const engine = resolveDockerRunnerEngine(metadata.engine);
  const agentId = metadata.agentId;

  if (!agentId) {
    return { task: null };
  }

  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent) {
    return { task: null };
  }

  const candidateTasks = await database
    .select()
    .from(tasks)
    .where(eq(tasks.currentAgentId, agentId));

  const nextTask = candidateTasks
    .filter((task) => task.status === "assigned" || task.status === "queued")
    .sort((a, b) => {
      const byPriority =
        priorityWeight[b.priority] - priorityWeight[a.priority];
      if (byPriority !== 0) return byPriority;
      return a.createdAt.getTime() - b.createdAt.getTime();
    })[0];

  if (!nextTask) {
    return { task: null };
  }

  await database
    .update(tasks)
    .set({
      status: "in_progress",
      updatedAt: now,
    })
    .where(eq(tasks.id, nextTask.id));

  await database
    .update(agents)
    .set({
      status: "executing",
      focus: `Runner 已认领任务：${nextTask.title}`,
      updatedAt: now,
    })
    .where(eq(agents.id, agentId));

  await database.insert(events).values({
    eventType: "task.claimed",
    entityType: "task",
    entityId: nextTask.id,
    ownerUserId: nextTask.ownerUserId,
    severity: "info",
    title: `任务已被 runner 认领：${nextTask.title}`,
    description: `${device.name} 已开始执行 ${nextTask.title}。`,
    occurredAt: now,
  });

  const gitlabRepository =
    engine === "hermes-agent"
      ? readHermesGitLabRepository(nextTask.inputPayload)
      : null;

  return {
    task: {
      id: nextTask.id,
      agentId,
      title: nextTask.title,
      summary: nextTask.summary ?? "",
      taskType: nextTask.taskType,
      priority: nextTask.priority,
      riskLevel: nextTask.riskLevel,
      prompt: buildRunnerTaskPrompt({
        engine,
        title: nextTask.title,
        summary: nextTask.summary,
        taskType: nextTask.taskType,
        priority: nextTask.priority,
        riskLevel: nextTask.riskLevel,
        gitlabRepository,
      }),
      gitlab: gitlabRepository,
      engine,
    },
  };
}
