import { desc } from "drizzle-orm";

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
import { officeSnapshot as fallbackSnapshot } from "@/server/office/sample-data";
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

export async function getOfficeSnapshot(database: Database): Promise<OfficeSnapshot> {
  try {
    const [
      agentRows,
      taskRows,
      deviceRows,
      sessionRows,
      approvalRows,
      eventRows,
    ] = await Promise.all([
      database.select().from(agents),
      database.select().from(tasks),
      database.select().from(devices),
      database.select().from(executionSessions).orderBy(desc(executionSessions.createdAt)),
      database.select().from(approvals).orderBy(desc(approvals.createdAt)),
      database.select().from(events).orderBy(desc(events.occurredAt)),
    ]);

    if (agentRows.length === 0) {
      return fallbackSnapshot;
    }

    const now = new Date();
    const currentTaskByAgentId = new Map<string, string>();

    for (const task of taskRows) {
      if (!task.currentAgentId || currentTaskByAgentId.has(task.currentAgentId)) continue;
      currentTaskByAgentId.set(task.currentAgentId, task.id);
    }

    const latestSessionByDeviceId = new Map<string, (typeof sessionRows)[number]>();

    for (const session of sessionRows) {
      if (!session.deviceId || latestSessionByDeviceId.has(session.deviceId)) continue;
      latestSessionByDeviceId.set(session.deviceId, session);
    }

    const zones = (Object.entries(zonePresentation) as Array<
      [ZoneId, (typeof zonePresentation)[ZoneId]]
    >).map(([zoneId, zone]) => {
      const agentsInZone = agentRows.filter((agent) => agent.zoneId === zoneId);

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

    const snapshotAgents = agentRows.map((agent) => {
      const presentation = agentPresentation[agent.id] ?? {
        x: 20,
        y: 20,
        energy: 70,
      };

      return {
        id: agent.id,
        name: agent.name,
        role: agent.roleType,
        status: agent.status,
        zoneId: agent.zoneId,
        focus: agent.focus ?? `${agentStatusLabels[agent.status]}，等待新上下文`,
        currentTaskId: currentTaskByAgentId.get(agent.id) ?? null,
        deviceId:
          sessionRows.find(
            (session) =>
              session.agentId === agent.id &&
              (session.status === "running" || session.status === "starting"),
          )?.deviceId ?? null,
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

    const snapshotDevices = deviceRows.map((device) => {
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

    const pendingApprovals = approvalRows.filter((approval) => approval.status === "pending");
    const snapshotApprovals = pendingApprovals.map((approval) => ({
      id: approval.id,
      type: approval.approvalType,
      status: approval.status,
      taskId: approval.taskId ?? "",
      requestedByAgentId: approval.requestedByAgentId ?? "",
      title: approval.title,
      summary: approval.reason ?? "需要人工确认后继续执行。",
    }));

    const snapshotEvents = eventRows.slice(0, 8).map((event) => ({
      id: event.id,
      severity: event.severity,
      title: event.title,
      description: event.description ?? "无附加描述",
      at: formatRelativeTime(event.occurredAt, now),
    }));

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
    };
  } catch {
    return fallbackSnapshot;
  }
}

