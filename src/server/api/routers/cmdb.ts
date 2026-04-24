import { eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { cmdbProjects } from "@/server/db/schema";
import {
  cmdbDeployTargetValues,
  createCmdbRelease,
  getCmdbDashboard,
  listGitLabCatalog,
  upsertCmdbProject,
} from "@/server/cmdb/service";

const projectConfigSchema = z.object({
  triggerToken: z.string().optional(),
  customVariables: z.record(z.string()).optional(),
  targetAssetName: z.string().optional(),
  deployEnv: z.string().optional(),
  healthUrl: z.string().optional(),
  monitorUrl: z.string().optional(),
  k8sNamespace: z.string().optional(),
  k8sDeployment: z.string().optional(),
  dockerImage: z.string().optional(),
  sshPath: z.string().optional(),
  sshDeployCommand: z.string().optional(),
});

export const cmdbRouter = createTRPCRouter({
  dashboard: publicProcedure.query(async ({ ctx }) => {
    return getCmdbDashboard(ctx.db);
  }),

  gitlabCatalog: publicProcedure
    .input(
      z
        .object({
          query: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return listGitLabCatalog(input?.query);
    }),

  saveProject: publicProcedure
    .input(
      z.object({
        id: z.number().optional(),
        name: z.string().optional(),
        gitlabPath: z.string().min(1).max(512),
        description: z.string().optional(),
        defaultBranch: z.string().optional(),
        enabled: z.boolean().default(true),
        deployTarget: z.enum(cmdbDeployTargetValues),
        config: projectConfigSchema.optional(),
        syncWithGitLab: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return upsertCmdbProject(ctx.db, input);
    }),

  deleteProject: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(cmdbProjects).where(eq(cmdbProjects.id, input.id));
      return { success: true };
    }),

  triggerRelease: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        ref: z.string().optional(),
        deployEnv: z.string().optional(),
        variables: z.record(z.string()).optional(),
        triggeredBy: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .select()
        .from(cmdbProjects)
        .where(eq(cmdbProjects.id, input.projectId));

      if (!project) {
        throw new Error("项目不存在，无法触发发布。");
      }

      if (!project.enabled) {
        throw new Error("项目已禁用，请先启用后再触发发布。");
      }

      return createCmdbRelease(ctx.db, {
        project,
        ref: input.ref,
        deployEnv: input.deployEnv,
        variables: input.variables,
        triggeredBy: input.triggeredBy,
      });
    }),
});
