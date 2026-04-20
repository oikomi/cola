import { z } from "zod";

import {
  dockerRunnerEngineValues,
  deviceStatusValues,
  runnerRuntimeValues,
  sessionStatusValues,
} from "@/server/office/catalog";

export const registerDockerRunnerInputSchema = z.object({
  name: z.string().trim().min(3).max(120),
  resourcePool: z.string().trim().min(2).max(120),
  status: z.enum(deviceStatusValues).optional(),
  engine: z.enum(dockerRunnerEngineValues).optional(),
  host: z.string().trim().max(255).optional(),
  runtime: z.enum(runnerRuntimeValues).optional(),
  healthSummary: z.string().trim().max(255).optional(),
  containerName: z.string().trim().max(120).optional(),
  image: z.string().trim().max(255).optional(),
});

export const heartbeatInputSchema = z.object({
  deviceId: z.string().uuid(),
  status: z.enum(deviceStatusValues),
  name: z.string().trim().min(3).max(120).optional(),
  resourcePool: z.string().trim().min(2).max(120).optional(),
  engine: z.enum(dockerRunnerEngineValues).optional(),
  runtime: z.enum(runnerRuntimeValues).optional(),
  healthSummary: z.string().trim().max(255).optional(),
  host: z.string().trim().max(255).optional(),
  containerName: z.string().trim().max(120).optional(),
  image: z.string().trim().max(255).optional(),
});

export const pullNextTaskInputSchema = z.object({
  deviceId: z.string().uuid(),
});

export const reportSessionInputSchema = z.object({
  sessionId: z.string().uuid().optional(),
  deviceId: z.string().uuid(),
  taskId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  status: z.enum(sessionStatusValues),
  logPath: z.string().trim().max(500).optional(),
  artifactPath: z.string().trim().max(500).optional(),
});

export type RegisterDockerRunnerInput = z.infer<
  typeof registerDockerRunnerInputSchema
>;
export type HeartbeatInput = z.infer<typeof heartbeatInputSchema>;
export type PullNextTaskInput = z.infer<typeof pullNextTaskInputSchema>;
export type ReportSessionInput = z.infer<typeof reportSessionInputSchema>;
