import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  gpuAllocationModeValues,
  MAX_GPU_MEMORY_GI,
} from "@/lib/gpu-allocation";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import {
  canCreateInferenceDeploymentWithEngine,
  type InferenceDeploymentEngine,
  inferenceDeploymentEngineValues,
  isValidInferenceModelRef,
  llamaCppModelRefExample,
  llamaCppRemoteModelRefExample,
} from "@/server/deployments/catalog";
import {
  createInferenceDeployment,
  deleteInferenceDeployment,
  listInferenceDeployments,
  startInferenceDeployment,
  stopInferenceDeployment,
} from "@/server/deployments/service";

function modelRefValidationMessage(engine: InferenceDeploymentEngine) {
  switch (engine) {
    case "llama.cpp":
      return `llama.cpp 支持 /models 下的本地 GGUF，或可直接下载的 GGUF 来源，例如 ${llamaCppModelRefExample}、${llamaCppRemoteModelRefExample}。`;
    case "vllm":
    case "sglang":
      return "模型引用目前只支持 Hugging Face 模型 ID，例如 Qwen/Qwen3-8B-Instruct。";
    default:
      return "模型引用格式不正确。";
  }
}

const createInferenceDeploymentInput = z
  .object({
    name: z.string().trim().min(2).max(63),
    engine: z
      .enum(inferenceDeploymentEngineValues)
      .refine(
        canCreateInferenceDeploymentWithEngine,
        "当前运行时还不能通过创建流程直接部署。",
      ),
    modelRef: z.string().trim().min(3).max(2048),
    image: z.string().trim().min(2).max(255),
    cpu: z.string().trim().min(1).max(20),
    memoryGi: z.number().int().positive().max(2048),
    gpuAllocationMode: z.enum(gpuAllocationModeValues).default("whole"),
    gpuCount: z.number().int().nonnegative().max(16),
    gpuMemoryGi: z.number().int().positive().max(MAX_GPU_MEMORY_GI).nullable(),
    replicaCount: z.number().int().positive().max(16),
  })
  .superRefine((input, ctx) => {
    if (!isValidInferenceModelRef(input.engine, input.modelRef)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modelRef"],
        message: modelRefValidationMessage(input.engine),
      });
    }

    if (input.gpuAllocationMode === "memory" && !input.gpuMemoryGi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gpuMemoryGi"],
        message: "显存模式下必须填写每个 GPU 份额的显存大小。",
      });
    }
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
