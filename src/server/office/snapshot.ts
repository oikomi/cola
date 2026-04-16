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
} from "@/server/db/schema";
import {
  agentStatusLabels,
  deviceStatusLabels,
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

function buildEmptySnapshot(now: Date): OfficeSnapshot {
  return {
    generatedAt: now.toISOString(),
    headline: "数据库为空，当前没有分区、角色、任务或执行记录。",
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
    zones: [],
    agents: [],
    tasks: [],
    devices: [],
    approvals: [],
    events: [],
    executionReports: [],
  };
}

export async function getOfficeSnapshot(database: Database): Promise<OfficeSnapshot> {
  try {
    const [agentRows, taskRows, deviceRows, approvalRows, eventRows] =
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
      ]);

    if (agentRows.length === 0) {
      return buildEmptySnapshot(new Date());
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
    const currentTaskByAgentId = new Map<string, string>();
    const agentsByZone = new Map<ZoneId, typeof agentRows>();
    const assignedDeviceByAgentId = new Map<string, (typeof deviceRows)[number]>();
    const runningSessionByAgentId = new Map<string, (typeof sessionRows)[number]>();

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

    const zones = (Object.entries(zonePresentation) as Array<
      [ZoneId, (typeof zonePresentation)[ZoneId]]
    >).map(([zoneId, zone]) => {
      const agentsInZone = agentsByZone.get(zoneId) ?? [];

      return {
        id: zoneId,
        label: zone.label,
        summary: zone.summary,
        headcount: agentsInZone.length,
        activeCount: agentsInZone.filter((agent) =>
          activeAgentStatuses.has(agent.status),
        ).length,
        x: zone.x,
        y: zone.y,
        width: zone.width,
        height: zone.height,
      };
    });

    const zoneAgentIndices = new Map<string, number>();

    const snapshotAgents = agentRows.map((agent) => {
      const zone = zonePresentation[agent.zoneId];
      const dynamicIndex = zoneAgentIndices.get(agent.zoneId) ?? 0;
      zoneAgentIndices.set(agent.zoneId, dynamicIndex + 1);
      const assignedDevice = assignedDeviceByAgentId.get(agent.id);
      const runningSession = runningSessionByAgentId.get(agent.id);

      const presentation = agentPresentation[agent.id] ?? {
        x: zone.x + 8 + (dynamicIndex % 2) * 9,
        y: zone.y + 12 + Math.floor(dynamicIndex / 2) * 8,
        energy: 72 - Math.min(dynamicIndex, 4) * 3,
      };

      return {
        id: agent.id,
        name: agent.name,
        role: agent.roleType,
        status: agent.status,
        zoneId: agent.zoneId,
        focus: agent.focus ?? `${agentStatusLabels[agent.status]}，等待新上下文`,
        currentTaskId: currentTaskByAgentId.get(agent.id) ?? null,
        deviceId: runningSession?.deviceId ?? assignedDevice?.id ?? null,
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
      const healthSummary =
        metadata &&
        "healthSummary" in metadata &&
        typeof metadata.healthSummary === "string"
          ? metadata.healthSummary
          : `${deviceStatusLabels[device.status]}，等待新的执行会话`;

      return {
        id: device.id,
        name: device.name,
        type: device.deviceType,
        status: device.status,
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
  } catch {
    return buildEmptySnapshot(new Date());
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
