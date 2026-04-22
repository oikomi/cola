import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { db } from "@/server/db";
import {
  agents,
  approvals,
  devices,
  events,
  tasks,
  zoneSettings,
} from "@/server/db/schema";
import {
  agentRoleValues,
  dockerRunnerDeviceTypeByEngine,
  dockerRunnerEngineLabels,
  dockerRunnerEngineValues,
  approvalTypeValues,
  priorityValues,
  riskLevelValues,
  resolveZoneWorkstationCapacity,
  taskStatusLabels,
  taskStatusValues,
  taskTypeValues,
  zoneLabels,
  zoneValues,
  zoneWorkstationLimitByZone,
} from "@/server/office/catalog";
import {
  getRunnerRuntime,
  cleanupRunner,
  provisionRunner,
  runnerRuntimeLabel,
} from "@/server/office/provision-runner";
import { buildNativeDashboardUrl } from "@/server/office/provision-kubernetes-runner";
import { getOfficeSnapshot } from "@/server/office/snapshot";

const execFileAsync = promisify(execFile);

const createAgentInput = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.enum(agentRoleValues),
  engine: z.enum(dockerRunnerEngineValues).default("openclaw"),
});

const deleteAgentInput = z.object({
  agentId: z.string().uuid(),
});

const addWorkstationInput = z.object({
  zoneId: z.enum(zoneValues),
});

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

function nextAgentStatusForTaskStatus(
  status: (typeof taskStatusValues)[number],
) {
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

function taskStatusLabel(status: (typeof taskStatusValues)[number]) {
  return taskStatusLabels[status];
}

function zoneForRole(role: (typeof agentRoleValues)[number]) {
  switch (role) {
    case "product":
      return "product";
    case "engineering":
      return "engineering";
    case "operations":
      return "growth";
    case "hr":
      return "people";
    case "procurement":
      return "vendor";
    case "ceo_office":
      return "command";
    default:
      return "command";
  }
}

function resourcePoolForRole(role: (typeof agentRoleValues)[number]) {
  switch (role) {
    case "engineering":
      return "docker-core";
    case "operations":
      return "docker-ops";
    case "hr":
    case "procurement":
      return "docker-backoffice";
    case "product":
    case "ceo_office":
    default:
      return "docker-command";
  }
}

function roleLabel(role: (typeof agentRoleValues)[number]) {
  switch (role) {
    case "product":
      return "产品";
    case "engineering":
      return "研发";
    case "operations":
      return "运营";
    case "hr":
      return "HR";
    case "procurement":
      return "采购";
    case "ceo_office":
      return "CEO Office";
    default:
      return "角色";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function linkedAgentIdFromDeviceMetadata(metadata: unknown) {
  if (!isPlainRecord(metadata)) return null;
  return typeof metadata.agentId === "string" ? metadata.agentId : null;
}

function nodePortFromDeviceMetadata(metadata: unknown) {
  if (!isPlainRecord(metadata)) return null;

  const raw = metadata.nodePort;
  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }

  const nodePort = Number(raw);
  if (!Number.isInteger(nodePort) || nodePort <= 0) {
    return null;
  }

  return nodePort;
}

async function resolveFreshDashboardUrl(
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

async function resolveDeviceDashboardUrl(
  device: typeof devices.$inferSelect,
): Promise<string | null> {
  const metadata =
    device.metadata && typeof device.metadata === "object" ? device.metadata : null;
  const currentUrl =
    metadata &&
    "nativeDashboardUrl" in metadata &&
    typeof metadata.nativeDashboardUrl === "string"
      ? metadata.nativeDashboardUrl
      : null;
  const containerName =
    metadata &&
    "containerName" in metadata &&
    typeof metadata.containerName === "string"
      ? metadata.containerName
      : null;
  const engine =
    metadata &&
    "engine" in metadata &&
    typeof metadata.engine === "string"
      ? metadata.engine
      : null;
  const runtime =
    metadata &&
    "runtime" in metadata &&
    typeof metadata.runtime === "string"
      ? metadata.runtime
      : null;
  const nodePort = nodePortFromDeviceMetadata(metadata);
  const fallbackUrl =
    nodePort && (engine === "openclaw" || engine === "hermes-agent")
      ? buildNativeDashboardUrl(engine, nodePort)
      : null;

  if (runtime === "kubernetes") {
    return fallbackUrl ?? currentUrl;
  }

  if (engine !== "openclaw" || !containerName || !currentUrl) {
    return currentUrl ?? fallbackUrl;
  }

  try {
    const { stdout } = await execFileAsync("docker", [
      "exec",
      containerName,
      "sh",
      "-lc",
      "openclaw dashboard --no-open",
    ]);
    const dashboardLine = stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("Dashboard URL: "));

    if (!dashboardLine) {
      return currentUrl;
    }

    const freshUrl = new URL(dashboardLine.replace("Dashboard URL: ", "").trim());
    const current = new URL(currentUrl);
    const publicHost =
      process.env.COLA_OPENCLAW_DASHBOARD_PUBLIC_HOST ??
      process.env.COLA_DASHBOARD_PUBLIC_HOST ??
      current.hostname;
    const port = current.port || freshUrl.port;
    const controlUrl = new URL(
      `${current.protocol}//${publicHost}${port ? `:${port}` : ""}/`,
    );
    controlUrl.searchParams.set(
      "gatewayUrl",
      `${controlUrl.protocol === "https:" ? "wss:" : "ws:"}//${publicHost}${port ? `:${port}` : ""}`,
    );
    controlUrl.hash = freshUrl.hash;

    return controlUrl.toString();
  } catch {
    return currentUrl ?? fallbackUrl;
  }
}

type Database = typeof db;

type BackgroundProvisionInput = {
  agentId: string;
  agentName: string;
  deviceId: string;
  deviceName: string;
  roleLabel: string;
  resourcePool: string;
  engine: (typeof dockerRunnerEngineValues)[number];
};

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

export const officeRouter = createTRPCRouter({
  getSnapshot: publicProcedure.query(({ ctx }) => getOfficeSnapshot(ctx.db)),

  getAgentById: publicProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const snapshot = await getOfficeSnapshot(ctx.db);
      return (
        snapshot.agents.find((agent) => agent.id === input.agentId) ?? null
      );
    }),

  getTaskById: publicProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const snapshot = await getOfficeSnapshot(ctx.db);
      return snapshot.tasks.find((task) => task.id === input.taskId) ?? null;
    }),

  getNativeDashboardUrl: publicProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const url = await resolveFreshDashboardUrl(ctx.db, input.agentId);
      return { url };
    }),

  createAgent: publicProcedure
    .input(createAgentInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const zoneId = zoneForRole(input.role);
      const resourcePool = resourcePoolForRole(input.role);
      const roleText = roleLabel(input.role);
      const engineLabel = dockerRunnerEngineLabels[input.engine];
      const runtime = getRunnerRuntime();
      const runtimeLabel = runnerRuntimeLabel(runtime);
      const runnerName = `${input.name} Runner`;

      const { createdAgent, createdDevice } = await ctx.db.transaction(
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
    }),

  deleteAgent: publicProcedure
    .input(deleteAgentInput)
    .mutation(async ({ ctx, input }) => {
      const [agent] = await ctx.db
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

      const activeTasks = await ctx.db
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

      const pendingApprovals = await ctx.db
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

      const allDevices = await ctx.db.select().from(devices);
      const linkedDevice =
        allDevices.find(
          (device) => linkedAgentIdFromDeviceMetadata(device.metadata) === agent.id,
        ) ??
        allDevices.find((device) => device.name === `${agent.name} Runner`) ??
        null;

      if (linkedDevice) {
        await cleanupRunner(linkedDevice);
      }

      await ctx.db.transaction(async (tx) => {
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
    }),

  addWorkstation: publicProcedure
    .input(addWorkstationInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const maxCapacity = zoneWorkstationLimitByZone[input.zoneId];

      return ctx.db.transaction(async (tx) => {
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
              updatedAt: now,
            })
            .where(eq(zoneSettings.zoneId, input.zoneId));
        } else {
          await tx.insert(zoneSettings).values({
            zoneId: input.zoneId,
            workstationCapacity: nextCapacity,
            createdAt: now,
          });
        }

        await tx.insert(events).values({
          eventType: "zone.workstation_added",
          entityType: "zone",
          entityId: input.zoneId,
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
          severity:
            input.status === "failed"
              ? "critical"
              : input.status === "pending_approval"
                ? "warning"
                : "info",
          title: `任务状态已更新：${task.title}`,
          description: `任务已被更新为${taskStatusLabel(input.status)}。`,
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
