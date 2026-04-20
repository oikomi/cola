import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";

import type { db } from "@/server/db";
import {
  agents,
  devices,
  events,
  executionSessions,
  tasks,
} from "@/server/db/schema";
import {
  dockerRunnerDeviceTypeByEngine,
  dockerRunnerEngineLabels,
  dockerRunnerEngineValues,
  type DockerRunnerEngine,
  runnerRuntimeLabels,
  runnerRuntimeValues,
  type RunnerRuntime,
} from "@/server/office/catalog";
import type {
  HeartbeatInput,
  PullNextTaskInput,
  RegisterDockerRunnerInput,
  ReportSessionInput,
} from "@/server/worker/schemas";

type Database = typeof db;

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

function resolveDockerRunnerEngine(engine: unknown): DockerRunnerEngine {
  if (
    typeof engine === "string" &&
    dockerRunnerEngineValues.includes(engine as DockerRunnerEngine)
  ) {
    return engine as DockerRunnerEngine;
  }

  return "openclaw";
}

function resolveRunnerRuntime(runtime: unknown): RunnerRuntime {
  if (
    typeof runtime === "string" &&
    runnerRuntimeValues.includes(runtime as RunnerRuntime)
  ) {
    return runtime as RunnerRuntime;
  }

  return "docker";
}

function linkedAgentMetadata(metadata: unknown) {
  const record = isPlainRecord(metadata) ? metadata : null;

  return {
    agentId:
      record && typeof record.agentId === "string" ? record.agentId : null,
    agentName:
      record && typeof record.agentName === "string" ? record.agentName : null,
  };
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

  if (!agent || !["waiting_device", "blocked"].includes(agent.status)) {
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
        status: "blocked",
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
    const [updated] = await database
      .update(devices)
      .set({
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
  const currentMetadata = isPlainRecord(device.metadata)
    ? device.metadata
    : null;
  const engine = resolveDockerRunnerEngine(
    input.engine ?? currentMetadata?.engine,
  );
  const engineLabel = dockerRunnerEngineLabels[engine];
  const runtime = resolveRunnerRuntime(input.runtime ?? currentMetadata?.runtime);
  const runtimeLabel = runnerRuntimeLabels[runtime];
  const metadataPatch = {
    runtime,
    engine,
    healthSummary:
      input.healthSummary ?? `${runtimeLabel} runner 心跳正常，等待下一次调度。`,
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
        status: isRunning
          ? "busy"
          : input.status === "failed"
            ? "unhealthy"
            : "online",
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
          status: isRunning
            ? "executing"
            : input.status === "failed"
              ? "error"
              : "idle",
          focus: isRunning
            ? `正在执行任务：${task.title}`
            : input.status === "failed"
              ? `任务执行失败：${task.title}`
              : `已完成任务：${task.title}`,
          updatedAt: now,
        })
        .where(eq(agents.id, input.agentId));
    }

    await tx.insert(events).values({
      eventType: "execution_session.reported",
      entityType: "execution_session",
      entityId: session.id,
      severity: input.status === "failed" ? "critical" : "info",
      title: `Runner 已回报执行会话：${device.name}`,
      description: `任务「${task.title}」当前会话状态为 ${input.status}。`,
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

  const metadata = isPlainRecord(device.metadata) ? device.metadata : null;
  const engine = resolveDockerRunnerEngine(metadata?.engine);
  const agentId =
    metadata && typeof metadata.agentId === "string" ? metadata.agentId : null;

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
    severity: "info",
    title: `任务已被 runner 认领：${nextTask.title}`,
    description: `${device.name} 已开始执行 ${nextTask.title}。`,
    occurredAt: now,
  });

  return {
    task: {
      id: nextTask.id,
      agentId,
      title: nextTask.title,
      summary: nextTask.summary ?? "",
      taskType: nextTask.taskType,
      priority: nextTask.priority,
      riskLevel: nextTask.riskLevel,
      prompt: [
        `You are a ${dockerRunnerEngineLabels[engine]} execution worker inside Cola Virtual Office.`,
        `Task title: ${nextTask.title}`,
        `Task summary: ${nextTask.summary ?? "No summary provided."}`,
        `Task type: ${nextTask.taskType}`,
        `Priority: ${nextTask.priority}`,
        `Risk level: ${nextTask.riskLevel}`,
        "Operate inside the mounted /workspace directory.",
        "Return a concise completion summary and mention any files changed.",
      ].join("\n"),
      engine,
    },
  };
}
