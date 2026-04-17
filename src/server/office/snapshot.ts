import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";

import type { db } from "@/server/db";
import {
  agents,
  approvals,
  devices,
  events,
  executionSessions,
  tasks,
  zoneSettings,
} from "@/server/db/schema";
import {
  agentStatusLabels,
  deviceStatusLabels,
  resolveZoneWorkstationCapacity,
  zoneWorkstationLimitByZone,
  type DockerRunnerEngine,
  type ZoneId,
} from "@/server/office/catalog";
import { officeHeadline, agentPresentation, zonePresentation } from "@/server/office/presentation";
import type { OfficeSnapshot } from "@/server/office/types";

type Database = typeof db;

const activeAgentStatuses = new Set([
  "planning",
  "waiting_device",
  "executing",
  "waiting_handoff",
  "waiting_approval",
  "blocked",
  "error",
]);

const canonicalPoolDeviceNamePattern =
  /^(OpenClaw Runner-\d+|HermesHub Runner|Mac mini.*)$/;
const staleDeviceThresholdMs = Number(
  process.env.COLA_DEVICE_STALE_AFTER_MS ?? "45000",
);

function formatRelativeTime(occurredAt: Date, now: Date) {
  const diffMs = now.getTime() - occurredAt.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} 天前`;
}

function resolveWorkspacePath(inputPath: string | null | undefined) {
  if (!inputPath) return null;
  if (inputPath.startsWith("/workspace/")) {
    return path.join(process.cwd(), inputPath.slice("/workspace/".length));
  }
  return inputPath;
}

function tryReadExecutionResult(inputPath: string | null | undefined) {
  const resolvedPath = resolveWorkspacePath(inputPath);
  if (!resolvedPath) return null;
  if (!existsSync(resolvedPath)) return null;

  try {
    const stats = statSync(resolvedPath);
    const filePath = stats.isDirectory()
      ? path.join(resolvedPath, "last-result.json")
      : resolvedPath;

    if (!existsSync(filePath)) return null;

    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      title?: string;
      result?: { outputs?: Array<{ text?: string | null }> };
      taskId?: string;
      completedAt?: string;
    };

    return {
      outputText:
        parsed.result?.outputs?.find((output) => typeof output.text === "string")?.text ??
        null,
      completedAt: parsed.completedAt ?? null,
    };
  } catch {
    return null;
  }
}

function buildSnapshotZones(
  agentsByZone: Map<ZoneId, Array<typeof agents.$inferSelect>>,
  zoneSettingByZoneId: Map<ZoneId, typeof zoneSettings.$inferSelect>,
) {
  return (Object.entries(zonePresentation) as Array<
    [ZoneId, (typeof zonePresentation)[ZoneId]]
  >).map(([zoneId, zone]) => {
    const agentsInZone = agentsByZone.get(zoneId) ?? [];
    const workstationCapacity = resolveZoneWorkstationCapacity(zoneId, {
      configuredCapacity: zoneSettingByZoneId.get(zoneId)?.workstationCapacity ?? null,
      occupiedCount: agentsInZone.length,
    });

    return {
      id: zoneId,
      label: zone.label,
      summary: zone.summary,
      headcount: agentsInZone.length,
      activeCount: agentsInZone.filter((agent) =>
        activeAgentStatuses.has(agent.status),
      ).length,
      workstationCapacity,
      workstationMax: zoneWorkstationLimitByZone[zoneId],
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
    };
  });
}

function buildEmptySnapshot(
  now: Date,
  zoneSettingByZoneId: Map<ZoneId, typeof zoneSettings.$inferSelect>,
): OfficeSnapshot {
  const agentsByZone = new Map<ZoneId, Array<typeof agents.$inferSelect>>();
  for (const zoneId of Object.keys(zonePresentation) as ZoneId[]) {
    agentsByZone.set(zoneId, []);
  }

  return {
    generatedAt: now.toISOString(),
    mode: "database",
    readOnlyReason: null,
    headline: "系统已初始化基础办公区，当前还没有人物、任务或执行记录。",
    metrics: [
      {
        label: "在线角色",
        value: "0",
        delta: "还没有角色占用设备",
      },
      {
        label: "执行中任务",
        value: "0",
        delta: "还没有任务等待审批",
      },
      {
        label: "设备池负载",
        value: "0%",
        delta: "还没有 runner 注册到系统",
      },
      {
        label: "异常事件",
        value: "0",
        delta: "当前没有关键级异常",
      },
    ],
    zones: buildSnapshotZones(agentsByZone, zoneSettingByZoneId),
    agents: [],
    tasks: [],
    devices: [],
    approvals: [],
    events: [],
    executionReports: [],
  };
}

function buildFallbackSnapshot(now: Date, reason: string): OfficeSnapshot {
  return {
    generatedAt: now.toISOString(),
    mode: "fallback",
    readOnlyReason: reason,
    headline: "数据库当前不可用，页面已切换到只读回退模式。",
    metrics: [
      {
        label: "在线角色",
        value: "0",
        delta: "数据库恢复后才会展示真实人物状态",
      },
      {
        label: "执行中任务",
        value: "0",
        delta: "回退模式下不支持任务写入与调度",
      },
      {
        label: "设备池负载",
        value: "0%",
        delta: "当前无法读取真实 runner 状态",
      },
      {
        label: "异常事件",
        value: "1",
        delta: "请先恢复本地数据库连接",
      },
    ],
    zones: [],
    agents: [],
    tasks: [],
    devices: [],
    approvals: [],
    events: [
      {
        id: "fallback-db-unreachable",
        severity: "critical",
        title: "数据库不可用",
        description: reason,
        at: "刚刚",
      },
    ],
    executionReports: [],
  };
}

export async function getOfficeSnapshot(database: Database): Promise<OfficeSnapshot> {
  try {
    const [agentRows, taskRows, deviceRows, approvalRows, eventRows, zoneSettingRows] =
      await Promise.all([
        database.select().from(agents),
        database.select().from(tasks),
        database.select().from(devices),
        database
          .select()
          .from(approvals)
          .where(eq(approvals.status, "pending"))
          .orderBy(desc(approvals.createdAt)),
        database.select().from(events).orderBy(desc(events.occurredAt)).limit(32),
        database.select().from(zoneSettings),
      ]);

    const zoneSettingByZoneId = new Map(
      zoneSettingRows.map((setting) => [setting.zoneId, setting] as const),
    );

    if (agentRows.length === 0) {
      return buildEmptySnapshot(new Date(), zoneSettingByZoneId);
    }

    const now = new Date();
    const agentIds = new Set(agentRows.map((agent) => agent.id));
    const taskIds = new Set(taskRows.map((task) => task.id));
    const sessionLimit = Math.max(32, deviceRows.length * 6);
    const sessionRows = await database
      .select()
      .from(executionSessions)
      .orderBy(desc(executionSessions.createdAt))
      .limit(sessionLimit);
    const sessionIds = new Set(sessionRows.map((session) => session.id));
    const deviceById = new Map(deviceRows.map((device) => [device.id, device]));
    const currentTaskByAgentId = new Map<string, string>();
    const agentsByZone = new Map<ZoneId, typeof agentRows>();
    const assignedDeviceByAgentId = new Map<string, (typeof deviceRows)[number]>();
    const runningSessionByAgentId = new Map<string, (typeof sessionRows)[number]>();

    const inferEngineFromDevice = (
      device: (typeof deviceRows)[number] | undefined,
    ): DockerRunnerEngine | null => {
      if (!device) return null;

      const metadata =
        device.metadata && typeof device.metadata === "object" ? device.metadata : null;
      if (
        metadata &&
        "engine" in metadata &&
        (metadata.engine === "openclaw" || metadata.engine === "hermes-agent")
      ) {
        return metadata.engine;
      }

      if (device.deviceType === "docker_openclaw") return "openclaw";
      if (device.deviceType === "docker_hermes_agent") return "hermes-agent";

      return null;
    };

    for (const task of taskRows) {
      if (!task.currentAgentId || currentTaskByAgentId.has(task.currentAgentId)) continue;
      currentTaskByAgentId.set(task.currentAgentId, task.id);
    }

    for (const zoneId of Object.keys(zonePresentation) as ZoneId[]) {
      agentsByZone.set(zoneId, []);
    }

    for (const agent of agentRows) {
      const agentsInZone = agentsByZone.get(agent.zoneId);
      if (agentsInZone) {
        agentsInZone.push(agent);
      } else {
        agentsByZone.set(agent.zoneId, [agent]);
      }
    }

    for (const device of deviceRows) {
      if (!device.metadata || typeof device.metadata !== "object") continue;
      if (!("agentId" in device.metadata) || typeof device.metadata.agentId !== "string") {
        continue;
      }

      if (!assignedDeviceByAgentId.has(device.metadata.agentId)) {
        assignedDeviceByAgentId.set(device.metadata.agentId, device);
      }
    }

    const latestSessionByDeviceId = new Map<string, (typeof sessionRows)[number]>();

    for (const session of sessionRows) {
      if (!session.deviceId || latestSessionByDeviceId.has(session.deviceId)) continue;
      latestSessionByDeviceId.set(session.deviceId, session);

      if (
        session.agentId &&
        !runningSessionByAgentId.has(session.agentId) &&
        (session.status === "running" || session.status === "starting")
      ) {
        runningSessionByAgentId.set(session.agentId, session);
      }
    }

    const relevantDeviceRows = deviceRows.filter((device) => {
      const metadata =
        device.metadata && typeof device.metadata === "object" ? device.metadata : null;

      if (latestSessionByDeviceId.has(device.id)) {
        return true;
      }

      if (
        metadata &&
        "agentId" in metadata &&
        typeof metadata.agentId === "string"
      ) {
        return agentIds.has(metadata.agentId);
      }

      return canonicalPoolDeviceNamePattern.test(device.name);
    });
    const relevantDeviceIds = new Set(relevantDeviceRows.map((device) => device.id));
    const relevantApprovalIds = new Set(approvalRows.map((approval) => approval.id));

    const zones = buildSnapshotZones(agentsByZone, zoneSettingByZoneId);

    const zoneAgentIndices = new Map<string, number>();

    const snapshotAgents = agentRows.map((agent) => {
      const zone = zonePresentation[agent.zoneId];
      const dynamicIndex = zoneAgentIndices.get(agent.zoneId) ?? 0;
      zoneAgentIndices.set(agent.zoneId, dynamicIndex + 1);
      const assignedDevice = assignedDeviceByAgentId.get(agent.id);
      const runningSession = runningSessionByAgentId.get(agent.id);
      const activeDevice =
        (runningSession?.deviceId
          ? deviceById.get(runningSession.deviceId)
          : undefined) ?? assignedDevice;

      const presentation = agentPresentation[agent.id] ?? {
        x: zone.x + 8 + (dynamicIndex % 2) * 9,
        y: zone.y + 12 + Math.floor(dynamicIndex / 2) * 8,
        energy: 72 - Math.min(dynamicIndex, 4) * 3,
      };

      return {
        id: agent.id,
        name: agent.name,
        role: agent.roleType,
        engine: inferEngineFromDevice(activeDevice),
        status: agent.status,
        zoneId: agent.zoneId,
        focus: agent.focus ?? `${agentStatusLabels[agent.status]}，等待新上下文`,
        currentTaskId: currentTaskByAgentId.get(agent.id) ?? null,
        deviceId: activeDevice?.id ?? null,
        energy: presentation.energy,
        x: presentation.x,
        y: presentation.y,
      };
    });

    const snapshotTasks = taskRows.map((task) => ({
      id: task.id,
      title: task.title,
      type: task.taskType,
      status: task.status,
      priority: task.priority,
      riskLevel: task.riskLevel,
      ownerAgentId: task.currentAgentId ?? "",
      zoneId: task.zoneId,
      summary: task.summary ?? "暂无摘要",
    }));

    const snapshotDevices = relevantDeviceRows.map((device) => {
      const session = latestSessionByDeviceId.get(device.id);
      const metadata =
        device.metadata && typeof device.metadata === "object" ? device.metadata : null;
      const isStale =
        device.lastHeartbeatAt instanceof Date &&
        now.getTime() - device.lastHeartbeatAt.getTime() > staleDeviceThresholdMs;
      const effectiveStatus =
        isStale && ["online", "busy", "maintenance"].includes(device.status)
          ? "offline"
          : device.status;
      const healthSummary =
        isStale
          ? "Runner 心跳已超时，原生入口已暂时禁用。"
          : metadata &&
              "healthSummary" in metadata &&
              typeof metadata.healthSummary === "string"
            ? metadata.healthSummary
            : `${deviceStatusLabels[effectiveStatus]}，等待新的执行会话`;
      const nativeDashboardUrl =
        isStale
          ? null
          : metadata &&
              "nativeDashboardUrl" in metadata &&
              typeof metadata.nativeDashboardUrl === "string"
            ? metadata.nativeDashboardUrl
            : null;

      return {
        id: device.id,
        name: device.name,
        type: device.deviceType,
        engine: inferEngineFromDevice(device),
        nativeDashboardUrl,
        status: effectiveStatus,
        resourcePool: device.resourcePool,
        currentSessionStatus: session?.status ?? null,
        currentTaskId: session?.taskId ?? null,
        healthSummary,
      };
    });

    const snapshotApprovals = approvalRows.map((approval) => ({
      id: approval.id,
      type: approval.approvalType,
      status: approval.status,
      taskId: approval.taskId ?? "",
      requestedByAgentId: approval.requestedByAgentId ?? "",
      title: approval.title,
      summary: approval.reason ?? "需要人工确认后继续执行。",
    }));

    const snapshotEvents = eventRows
      .filter((event) => {
        switch (event.entityType) {
          case "agent":
            return agentIds.has(event.entityId);
          case "task":
            return taskIds.has(event.entityId);
          case "device":
            return relevantDeviceIds.has(event.entityId);
          case "approval":
            return relevantApprovalIds.has(event.entityId);
          case "execution_session":
            return sessionIds.has(event.entityId);
          default:
            return true;
        }
      })
      .slice(0, 8)
      .map((event) => ({
        id: event.id,
        severity: event.severity,
        title: event.title,
        description: event.description ?? "无附加描述",
        at: formatRelativeTime(event.occurredAt, now),
      }));

    const taskTitleById = new Map(taskRows.map((task) => [task.id, task.title]));
    const taskSummaryById = new Map(
      taskRows.map((task) => [task.id, task.summary ?? "暂无任务摘要"]),
    );
    const latestExecutionReports = sessionRows.slice(0, 8).map((session) => {
      const executionResult = tryReadExecutionResult(session.artifactPath);

      return {
        sessionId: session.id,
        taskId: session.taskId ?? "",
        agentId: session.agentId ?? null,
        deviceId: session.deviceId ?? null,
        status: session.status,
        title: taskTitleById.get(session.taskId ?? "") ?? "未命名任务",
        summary: taskSummaryById.get(session.taskId ?? "") ?? "暂无任务摘要",
        outputText: executionResult?.outputText ?? null,
        artifactPath: session.artifactPath ?? null,
        logPath: session.logPath ?? null,
        completedAt:
          executionResult?.completedAt ??
          session.endedAt?.toISOString() ??
          null,
      };
    });

    const onlineRoleCount = snapshotAgents.length;
    const inProgressTaskCount = snapshotTasks.filter((task) =>
      ["assigned", "in_progress", "pending_approval", "handed_off"].includes(task.status),
    ).length;
    const busyDeviceCount = snapshotDevices.filter((device) =>
      ["busy", "unhealthy"].includes(device.status),
    ).length;
    const deviceLoad =
      snapshotDevices.length > 0
        ? `${Math.round((busyDeviceCount / snapshotDevices.length) * 100)}%`
        : "0%";
    const criticalEventCount = snapshotEvents.filter(
      (event) => event.severity === "critical",
    ).length;

    return {
      generatedAt: now.toISOString(),
      mode: "database",
      readOnlyReason: null,
      headline: officeHeadline,
      metrics: [
        {
          label: "在线角色",
          value: String(onlineRoleCount),
          delta: `${snapshotAgents.filter((agent) => agent.deviceId).length} 个角色占用设备`,
        },
        {
          label: "执行中任务",
          value: String(inProgressTaskCount),
          delta: `${snapshotApprovals.length} 个任务等待审批`,
        },
        {
          label: "设备池负载",
          value: deviceLoad,
          delta: `${busyDeviceCount} / ${snapshotDevices.length} 台处于忙碌或异常`,
        },
        {
          label: "异常事件",
          value: String(criticalEventCount),
          delta:
            criticalEventCount > 0 ? "需要人工处理关键故障" : "当前没有关键级异常",
        },
      ],
      zones,
      agents: snapshotAgents,
      tasks: snapshotTasks,
      devices: snapshotDevices,
      approvals: snapshotApprovals,
      events: snapshotEvents,
      executionReports: latestExecutionReports,
    };
  } catch (error) {
    return buildFallbackSnapshot(
      new Date(),
      error instanceof Error ? error.message : "数据库连接失败",
    );
  }
}

export async function getOfficeRealtimeVersion(database: Database) {
  try {
    const latestEvent = await database.query.events.findFirst({
      orderBy: (event, { desc }) => [desc(event.occurredAt)],
    });

    return latestEvent
      ? `${latestEvent.id}:${latestEvent.occurredAt.toISOString()}`
      : "empty";
  } catch {
    return "empty";
  }
}
