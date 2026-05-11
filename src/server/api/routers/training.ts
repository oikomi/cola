import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  operatorProcedure,
  viewerProcedure,
} from "@/server/api/trpc";
import {
  gpuAllocationModeValues,
  MAX_GPU_MEMORY_GI,
} from "@/lib/gpu-allocation";
import {
  createJupyterLabRuntime,
  deleteJupyterLabRuntime,
  listJupyterLabRuntimes,
} from "@/server/training/jupyterlab-service";
import { resolveJupyterLabImageOptions } from "@/server/training/jupyterlab-images";

const createJupyterLabInput = z
  .object({
    name: z.string().trim().min(2).max(48),
    image: z.string().trim().min(1).max(240),
    cpu: z.string().trim().min(1).max(20),
    memoryGi: z.number().int().positive().max(2048),
    gpuAllocationMode: z.enum(gpuAllocationModeValues).default("whole"),
    gpuCount: z.number().int().nonnegative().max(16),
    gpuMemoryGi: z.number().int().positive().max(MAX_GPU_MEMORY_GI).nullable(),
  })
  .superRefine((input, ctx) => {
    if (input.gpuAllocationMode === "memory" && !input.gpuMemoryGi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gpuMemoryGi"],
        message: "显存模式下必须填写每个 GPU 份额的显存大小。",
      });
    }
  });

const jupyterLabActionInput = z.object({
  name: z.string().trim().min(2).max(48),
});

export const trainingRouter = createTRPCRouter({
  listJupyterLabs: viewerProcedure.query(async () => {
    const result = await listJupyterLabRuntimes();
    return {
      ...result,
      imageOptions: resolveJupyterLabImageOptions(),
    };
  }),

  createJupyterLab: operatorProcedure
    .input(createJupyterLabInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createJupyterLabRuntime({
          ...input,
          ownerUserId: ctx.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "创建 JupyterLab 失败。",
        });
      }
    }),

  deleteJupyterLab: operatorProcedure
    .input(jupyterLabActionInput)
    .mutation(async ({ input }) => {
      try {
        return await deleteJupyterLabRuntime(input.name);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "删除 JupyterLab 失败。",
        });
      }
    }),
});
