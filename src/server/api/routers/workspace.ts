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
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  openWorkspace,
} from "@/server/workspace/service";

const createWorkspaceInput = z
  .object({
    name: z.string().trim().min(2).max(63),
    cpu: z.string().trim().min(1).max(20),
    memoryGi: z.number().int().positive().max(2048),
    gpuAllocationMode: z.enum(gpuAllocationModeValues).default("whole"),
    gpuCount: z.number().int().nonnegative().max(16),
    gpuMemoryGi: z.number().int().positive().max(MAX_GPU_MEMORY_GI).nullable(),
    resolution: z.string().trim().min(9).max(20),
    cameraNodeName: z.string().trim().max(63).optional(),
    cameraDevicePath: z.string().trim().max(64).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.gpuAllocationMode === "memory" && !input.gpuMemoryGi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gpuMemoryGi"],
        message: "显存模式下必须填写每个 GPU 份额的显存大小。",
      });
    }

    if (input.cameraDevicePath && !input.cameraNodeName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cameraNodeName"],
        message: "挂载主机摄像头时必须指定摄像头所在节点。",
      });
    }
  });

const deleteWorkspaceInput = z.object({
  name: z.string().trim().min(2).max(63),
});

export const workspaceRouter = createTRPCRouter({
  list: viewerProcedure.query(async () => {
    return listWorkspaces();
  }),

  create: operatorProcedure
    .input(createWorkspaceInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createWorkspace({ ...input, ownerUserId: ctx.user.id });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "创建远程桌面失败。",
        });
      }
    }),

  open: viewerProcedure
    .input(deleteWorkspaceInput)
    .mutation(async ({ input }) => {
      try {
        return await openWorkspace(input.name);
      } catch (error) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            error instanceof Error ? error.message : "远程桌面当前不可打开。",
        });
      }
    }),

  delete: operatorProcedure
    .input(deleteWorkspaceInput)
    .mutation(async ({ input }) => {
      try {
        return await deleteWorkspace(input.name);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "删除远程桌面失败。",
        });
      }
    }),
});
