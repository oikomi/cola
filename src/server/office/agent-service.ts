import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { agents, approvals, devices, events, tasks } from "@/server/db/schema";
import {
  dockerRunnerDeviceTypeByEngine,
  dockerRunnerEngineLabels,
  type AgentRole,
  type DockerRunnerEngine,
} from "@/server/office/catalog";
import {
  parseRunnerMetadata,
  resolveRunnerDashboardUrl,
  resourcePoolForRole,
  roleLabel,
  zoneForRole,
} from "@/server/office/domain";
import {
  cleanupRunner,
  getRunnerRuntime,
  provisionRunner,
  runnerRuntimeLabel,
} from "@/server/office/provision-runner";
import { getOfficeSnapshot } from "@/server/office/snapshot";

type Database = typeof db;

type BackgroundProvisionInput = {
  agentId: string;
  agentName: string;
  deviceId: string;
  deviceName: string;
  roleLabel: string;
  resourcePool: string;
  engine: DockerRunnerEngine;
};

export type CreateOfficeAgentInput = {
  name: string;
  role: AgentRole;
  engine: DockerRunnerEngine;
};

export type DeleteOfficeAgentInput = {
  agentId: string;
};

function linkedAgentIdFromDeviceMetadata(metadata: unknown) {
  return parseRunnerMetadata(metadata).agentId;
}

async function resolveDeviceDashboardUrl(
  device: typeof devices.$inferSelect,
): Promise<string | null> {
  return resolveRunnerDashboardUrl(device.metadata);
}

export async function resolveFreshDashboardUrl(
  database: Database,
  agentId: string,
): Promise<string | null> {
  const snapshot = await getOfficeSnapshot(database);
  const agent = snapshot.agents.find((item) => item.id === agentId);
  if (!agent?.deviceId) return null;

  const [deviceRow] = await database
    .select({ deviceId: devices.id })
    .from(devices)
    .where(eq(devices.id, agent.deviceId))
    .limit(1);

  if (!deviceRow?.deviceId) return null;

  const [device] = await database
    .select()
    .from(devices)
    .where(eq(devices.id, deviceRow.deviceId))
    .limit(1);

  return device ? resolveDeviceDashboardUrl(device) : null;
}

async function markProvisionFailed(
  database: Database,
  input: BackgroundProvisionInput,
  engineLabel: string,
  runtimeLabel: string,
  runtime: string,
  host: string,
  image: string,
  errorMessage: string,
) {
  const now = new Date();

  await database
    .update(devices)
    .set({
      status: "unhealthy",
      host,
      metadata: {
        agentId: input.agentId,
        agentName: input.agentName,
        runtime,
        engine: input.engine,
        image,
        healthSummary: `${runtimeLabel} runner 拉起失败，角色已创建但进入阻塞态。`,
        errorMessage,
      },
      lastHeartbeatAt: null,
      updatedAt: now,
    })
    .where(eq(devices.id, input.deviceId));

  await database
    .update(agents)
    .set({
      status: "blocked",
      focus: `${input.agentName} runner 拉起失败，需要处理 ${runtimeLabel} / ${engineLabel} 配置`,
      updatedAt: now,
    })
    .where(eq(agents.id, input.agentId));

  await database.insert(events).values({
    eventType: "device.provision.failed",
    entityType: "device",
    entityId: input.deviceId,
    severity: "critical",
    title: `${runtimeLabel} ${engineLabel} runner 启动失败：${input.agentName}`,
    description: errorMessage,
    occurredAt: now,
  });
}

async function provisionRunnerInBackground(input: BackgroundProvisionInput) {
  const engineLabel = dockerRunnerEngineLabels[input.engine];
  const runtime = getRunnerRuntime();
  const runtimeLabel = runnerRuntimeLabel(runtime);

  try {
    const provision = await provisionRunner({
      agentId: input.agentId,
      agentName: input.agentName,
      runnerName: input.deviceName,
      roleLabel: input.roleLabel,
      resourcePool: input.resourcePool,
      engine: input.engine,
    });

    if (!provision.success) {
      await markProvisionFailed(
        db,
        input,
        engineLabel,
        runtimeLabel,
        runtime,
        provision.host,
        provision.image,
        provision.errorMessage ?? provision.healthSummary,
      );
      return;
    }

    const now = new Date();
    const [deviceRow] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, input.deviceId))
      .limit(1);
    const [agentRow] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .limit(1);

    if (deviceRow?.status === "maintenance") {
      await db
        .update(devices)
        .set({
          host: provision.host,
          metadata: {
            agentId: input.agentId,
            agentName: input.agentName,
            runtime: provision.runtime,
            engine: input.engine,
            image: provision.image,
            nativeDashboardUrl: provision.nativeDashboardUrl,
            healthSummary: `${input.roleLabel} runner 已在 ${runnerRuntimeLabel(provision.runtime)} 中启动，等待 ${engineLabel} 自注册。`,
            ...(provision.metadata ?? {}),
          },
          updatedAt: now,
        })
        .where(eq(devices.id, input.deviceId));
    }

    if (agentRow?.status === "waiting_device") {
      await db
        .update(agents)
        .set({
          focus: `${input.agentName} runner 已在 ${runnerRuntimeLabel(provision.runtime)} 中启动，等待 ${engineLabel} 完成注册`,
          updatedAt: now,
        })
        .where(eq(agents.id, input.agentId));
    }

    await db.insert(events).values({
      eventType: "device.provisioned",
      entityType: "device",
      entityId: input.deviceId,
      severity: "info",
      title: `${runnerRuntimeLabel(provision.runtime)} ${engineLabel} runner 已启动：${input.agentName}`,
      description: `${input.roleLabel} runner 已在 ${runnerRuntimeLabel(provision.runtime)} 中启动，等待 ${engineLabel} 自注册。`,
      occurredAt: now,
    });
  } catch (error) {
    await markProvisionFailed(
      db,
      input,
      engineLabel,
      runtimeLabel,
      runtime,
      "kubernetes",
      "",
      error instanceof Error ? error.message : `未知 ${runtimeLabel} 启动错误`,
    );
  }
}

export async function createOfficeAgent(
  database: Database,
  input: CreateOfficeAgentInput,
) {
  const now = new Date();
  const zoneId = zoneForRole(input.role);
  const resourcePool = resourcePoolForRole(input.role);
  const roleText = roleLabel(input.role);
  const engineLabel = dockerRunnerEngineLabels[input.engine];
  const runtime = getRunnerRuntime();
  const runtimeLabel = runnerRuntimeLabel(runtime);
  const runnerName = `${input.name} Runner`;

  const { createdAgent, createdDevice } = await database.transaction(
    async (tx) => {
      const [existingAgent] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.name, input.name))
        .limit(1);

      if (existingAgent) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "人物名称已存在，请换一个名称后再创建。",
        });
      }

      const [existingDevice] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.name, runnerName))
        .limit(1);

      if (existingDevice) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "同名 Runner 已存在，请换一个人物名称后再创建。",
        });
      }

      const [createdAgent] = await tx
        .insert(agents)
        .values({
          name: input.name,
          roleType: input.role,
          status: "waiting_device",
          zoneId,
          focus: `正在为 ${input.name} 拉起 ${runtimeLabel} ${engineLabel} runner`,
          createdAt: now,
        })
        .returning();

      if (!createdAgent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "角色创建失败。",
        });
      }

      const [createdDevice] = await tx
        .insert(devices)
        .values({
          name: runnerName,
          deviceType: dockerRunnerDeviceTypeByEngine[input.engine],
          status: "maintenance",
          resourcePool,
          metadata: {
            agentId: createdAgent.id,
            agentName: input.name,
            runtime,
            engine: input.engine,
            healthSummary: `正在为 ${input.name} 创建 ${runtimeLabel} runner`,
          },
          createdAt: now,
        })
        .returning();

      if (!createdDevice) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "执行设备创建失败。",
        });
      }

      await tx.insert(events).values({
        eventType: "agent.created",
        entityType: "agent",
        entityId: createdAgent.id,
        severity: "info",
        title: `新增角色：${input.name}`,
        description: `${roleText}角色已创建，开始拉起 ${runtimeLabel} ${engineLabel} runner。`,
        occurredAt: now,
      });

      return { createdAgent, createdDevice };
    },
  );

  setTimeout(() => {
    void provisionRunnerInBackground({
      agentId: createdAgent.id,
      agentName: input.name,
      deviceId: createdDevice.id,
      deviceName: createdDevice.name,
      roleLabel: roleText,
      resourcePool,
      engine: input.engine,
    });
  }, 0);

  return {
    agentId: createdAgent.id,
    deviceId: createdDevice.id,
    queued: true,
    message: `${input.name} 已创建，并已触发 ${runtimeLabel} ${engineLabel} runner 拉起流程。`,
  };
}

export async function deleteOfficeAgent(
  database: Database,
  input: DeleteOfficeAgentInput,
) {
  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);

  if (!agent) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "未找到目标人物。",
    });
  }

  const activeTasks = await database
    .select()
    .from(tasks)
    .where(eq(tasks.currentAgentId, agent.id));

  const blockingTask = activeTasks.find(
    (task) => !["completed", "failed", "canceled"].includes(task.status),
  );
  if (blockingTask) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `人物仍有未结束任务：${blockingTask.title}。请先处理任务再删除。`,
    });
  }

  const pendingApprovals = await database
    .select()
    .from(approvals)
    .where(eq(approvals.requestedByAgentId, agent.id));

  const blockingApproval = pendingApprovals.find(
    (approval) => approval.status === "pending",
  );
  if (blockingApproval) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `人物仍有待审批事项：${blockingApproval.title}。请先处理审批再删除。`,
    });
  }

  const allDevices = await database.select().from(devices);
  const linkedDevice =
    allDevices.find(
      (device) => linkedAgentIdFromDeviceMetadata(device.metadata) === agent.id,
    ) ??
    allDevices.find((device) => device.name === `${agent.name} Runner`) ??
    null;

  if (linkedDevice) {
    await cleanupRunner(linkedDevice);
  }

  await database.transaction(async (tx) => {
    if (linkedDevice) {
      await tx.delete(devices).where(eq(devices.id, linkedDevice.id));
    }

    await tx.delete(agents).where(eq(agents.id, agent.id));

    await tx.insert(events).values({
      eventType: "agent.deleted",
      entityType: "agent",
      entityId: agent.id,
      severity: "warning",
      title: `人物已删除：${agent.name}`,
      description: linkedDevice
        ? `${agent.name} 及其 runner 资源已清理。`
        : `${agent.name} 已删除。`,
      occurredAt: new Date(),
    });
  });

  return {
    agentId: agent.id,
    message: linkedDevice
      ? `${agent.name} 已删除，关联 runner 资源已清理。`
      : `${agent.name} 已删除。`,
  };
}
