import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
} from "@/server/workspace/service";

const createWorkspaceInput = z.object({
  name: z.string().trim().min(2).max(63),
  cpu: z.string().trim().min(1).max(20),
  memoryGi: z.number().int().positive().max(2048),
  gpu: z.number().int().nonnegative().max(16),
  resolution: z.string().trim().min(9).max(20),
});

const deleteWorkspaceInput = z.object({
  name: z.string().trim().min(2).max(63),
});

export const workspaceRouter = createTRPCRouter({
  list: publicProcedure.query(async () => {
    return listWorkspaces();
  }),

  create: publicProcedure
    .input(createWorkspaceInput)
    .mutation(async ({ input }) => {
      try {
        return await createWorkspace(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "创建远程桌面失败。",
        });
      }
    }),

  delete: publicProcedure
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
