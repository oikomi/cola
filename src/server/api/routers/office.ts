import { z } from "zod";

import {
  createTRPCRouter,
  operatorProcedure,
  viewerProcedure,
} from "@/server/api/trpc";
import {
  agentRoleValues,
  approvalTypeValues,
  dockerRunnerEngineValues,
  priorityValues,
  riskLevelValues,
  taskStatusValues,
  taskTypeValues,
  zoneValues,
} from "@/server/office/catalog";
import {
  createOfficeAgent,
  deleteOfficeAgent,
  resolveFreshDashboardUrl,
} from "@/server/office/agent-service";
import { getOfficeSnapshot } from "@/server/office/snapshot";
import {
  addOfficeWorkstation,
  createOfficeTask,
  requestOfficeApproval,
  resolveOfficeApproval,
  updateOfficeTaskStatus,
} from "@/server/office/task-service";

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
  gitlabRepository: z.string().trim().max(512).optional(),
  gitlabRef: z.string().trim().max(128).optional(),
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

export const officeRouter = createTRPCRouter({
  getSnapshot: viewerProcedure.query(({ ctx }) => getOfficeSnapshot(ctx.db)),

  getAgentById: viewerProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const snapshot = await getOfficeSnapshot(ctx.db);
      return (
        snapshot.agents.find((agent) => agent.id === input.agentId) ?? null
      );
    }),

  getTaskById: viewerProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const snapshot = await getOfficeSnapshot(ctx.db);
      return snapshot.tasks.find((task) => task.id === input.taskId) ?? null;
    }),

  getNativeDashboardUrl: operatorProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const url = await resolveFreshDashboardUrl(ctx.db, input.agentId);
      return { url };
    }),

  createAgent: operatorProcedure
    .input(createAgentInput)
    .mutation(({ ctx, input }) =>
      createOfficeAgent(ctx.db, { ...input, ownerUserId: ctx.user.id }),
    ),

  deleteAgent: operatorProcedure
    .input(deleteAgentInput)
    .mutation(({ ctx, input }) => deleteOfficeAgent(ctx.db, input)),

  addWorkstation: operatorProcedure
    .input(addWorkstationInput)
    .mutation(({ ctx, input }) =>
      addOfficeWorkstation(ctx.db, { ...input, ownerUserId: ctx.user.id }),
    ),

  createTask: operatorProcedure
    .input(createTaskInput)
    .mutation(({ ctx, input }) =>
      createOfficeTask(ctx.db, { ...input, ownerUserId: ctx.user.id }),
    ),

  updateTaskStatus: operatorProcedure
    .input(updateTaskStatusInput)
    .mutation(({ ctx, input }) => updateOfficeTaskStatus(ctx.db, input)),

  requestApproval: operatorProcedure
    .input(requestApprovalInput)
    .mutation(({ ctx, input }) =>
      requestOfficeApproval(ctx.db, { ...input, ownerUserId: ctx.user.id }),
    ),

  resolveApproval: operatorProcedure
    .input(resolveApprovalInput)
    .mutation(({ ctx, input }) =>
      resolveOfficeApproval(ctx.db, { ...input, ownerUserId: ctx.user.id }),
    ),
});
