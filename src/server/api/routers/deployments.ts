import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import {
  canCreateInferenceDeploymentWithEngine,
  type InferenceDeploymentEngine,
  inferenceDeploymentEngineValues,
  isHuggingFaceModelRef,
} from "@/server/deployments/catalog";
import {
  createInferenceDeployment,
  deleteInferenceDeployment,
  listInferenceDeployments,
  startInferenceDeployment,
  stopInferenceDeployment,
} from "@/server/deployments/service";

const createInferenceDeploymentInput = z.object({
  name: z.string().trim().min(2).max(63),
  engine: z
    .enum(inferenceDeploymentEngineValues)
    .refine(
      canCreateInferenceDeploymentWithEngine,
      "当前创建推理部署只支持 vLLM 和 SGLang。",
    ),
  modelRef: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .refine(
      isHuggingFaceModelRef,
      "模型引用目前只支持 Hugging Face 模型 ID，例如 Qwen/Qwen3-8B-Instruct。",
    ),
  image: z.string().trim().min(2).max(255),
  cpu: z.string().trim().min(1).max(20),
  memoryGi: z.number().int().positive().max(2048),
  gpuCount: z.number().int().nonnegative().max(16),
  replicaCount: z.number().int().positive().max(16),
});

const inferenceDeploymentActionInput = z.object({
  name: z.string().trim().min(2).max(63),
});

function runtimeLabel(engine: InferenceDeploymentEngine) {
  switch (engine) {
    case "vllm":
      return "vLLM";
    case "llama.cpp":
      return "llama.cpp";
    case "sglang":
      return "SGLang";
    default:
      return engine;
  }
}

export const deploymentsRouter = createTRPCRouter({
  list: publicProcedure.query(async () => {
    return listInferenceDeployments();
  }),

  create: publicProcedure
    .input(createInferenceDeploymentInput)
    .mutation(async ({ input }) => {
      try {
        const result = await createInferenceDeployment(input);
        return {
          ...result,
          message: `${runtimeLabel(input.engine)} 部署已创建，默认先处于草稿状态。`,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "创建推理部署失败。",
        });
      }
    }),

  start: publicProcedure
    .input(inferenceDeploymentActionInput)
    .mutation(async ({ input }) => {
      try {
        return await startInferenceDeployment(input.name);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "启动推理部署失败。",
        });
      }
    }),

  stop: publicProcedure
    .input(inferenceDeploymentActionInput)
    .mutation(async ({ input }) => {
      try {
        return await stopInferenceDeployment(input.name);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "暂停推理部署失败。",
        });
      }
    }),

  delete: publicProcedure
    .input(inferenceDeploymentActionInput)
    .mutation(async ({ input }) => {
      try {
        return await deleteInferenceDeployment(input.name);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "删除推理部署失败。",
        });
      }
    }),
});
