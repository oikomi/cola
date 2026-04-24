import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
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
    .mutation(({ ctx, input }) => createOfficeAgent(ctx.db, input)),

  deleteAgent: publicProcedure
    .input(deleteAgentInput)
    .mutation(({ ctx, input }) => deleteOfficeAgent(ctx.db, input)),

  addWorkstation: publicProcedure
    .input(addWorkstationInput)
    .mutation(({ ctx, input }) => addOfficeWorkstation(ctx.db, input)),

  createTask: publicProcedure
    .input(createTaskInput)
    .mutation(({ ctx, input }) => createOfficeTask(ctx.db, input)),

  updateTaskStatus: publicProcedure
    .input(updateTaskStatusInput)
    .mutation(({ ctx, input }) => updateOfficeTaskStatus(ctx.db, input)),

  requestApproval: publicProcedure
    .input(requestApprovalInput)
    .mutation(({ ctx, input }) => requestOfficeApproval(ctx.db, input)),

  resolveApproval: publicProcedure
    .input(resolveApprovalInput)
    .mutation(({ ctx, input }) => resolveOfficeApproval(ctx.db, input)),
});
