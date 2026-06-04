import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  gpuAllocationModeValues,
  MAX_GPU_MEMORY_GI,
} from "@/lib/gpu-allocation";
import {
  createTRPCRouter,
  operatorProcedure,
  viewerProcedure,
} from "@/server/api/trpc";
import {
  createIsaacStation,
  deleteIsaacStation,
  listIsaacStations,
} from "@/server/isaac-station/service";
import {
  createIsaacLabJob,
  deleteIsaacLabJob,
  listIsaacLabJobs,
} from "@/server/isaac-station/lab-jobs";

const isaacStationNameInput = z.object({
  name: z.string().trim().min(2).max(42),
});

const createIsaacStationInput = z
  .object({
    name: z.string().trim().min(2).max(42),
    image: z.string().trim().min(1).max(240),
    cpu: z.string().trim().min(1).max(20),
    memoryGi: z.number().int().positive().max(2048),
    gpuAllocationMode: z.enum(gpuAllocationModeValues).default("whole"),
    gpuCount: z.number().int().positive().max(16),
    gpuMemoryGi: z.number().int().positive().max(MAX_GPU_MEMORY_GI).nullable(),
    mode: z
      .enum(["headless-webrtc", "headless-egl"])
      .default("headless-webrtc"),
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

const isaacLabJobNameInput = z.object({
  name: z.string().trim().min(2).max(42),
});

const createIsaacLabJobInput = z
  .object({
    name: z.string().trim().min(2).max(42),
    image: z.string().trim().min(1).max(240),
    runner: z.enum(["direct", "rsl-rl", "skrl", "custom"]).default("rsl-rl"),
    displayMode: z.enum(["headless", "webrtc"]).default("headless"),
    task: z.string().trim().min(3).max(120),
    command: z.string().trim().max(4000).nullable(),
    maxIterations: z.number().int().positive().max(100_000_000),
    cpu: z.string().trim().min(1).max(20),
    memoryGi: z.number().int().positive().max(2048),
    gpuAllocationMode: z.enum(gpuAllocationModeValues).default("whole"),
    gpuCount: z.number().int().positive().max(16),
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

    if (input.runner === "custom" && !input.command?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "Custom runner 必须填写启动命令。",
      });
    }
  });

export const isaacStationRouter = createTRPCRouter({
  list: viewerProcedure.query(async () => {
    return listIsaacStations();
  }),

  create: operatorProcedure
    .input(createIsaacStationInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createIsaacStation({
          ...input,
          ownerUserId: ctx.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "创建 Isaac Station 失败。",
        });
      }
    }),

  delete: operatorProcedure
    .input(isaacStationNameInput)
    .mutation(async ({ input }) => {
      try {
        return await deleteIsaacStation(input.name);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "删除 Isaac Station 失败。",
        });
      }
    }),

  listLabJobs: viewerProcedure.query(async () => {
    return listIsaacLabJobs();
  }),

  createLabJob: operatorProcedure
    .input(createIsaacLabJobInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createIsaacLabJob({
          ...input,
          ownerUserId: ctx.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "创建 Isaac Lab Job 失败。",
        });
      }
    }),

  deleteLabJob: operatorProcedure
    .input(isaacLabJobNameInput)
    .mutation(async ({ input }) => {
      try {
        return await deleteIsaacLabJob(input.name);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "删除 Isaac Lab Job 失败。",
        });
      }
    }),
});
