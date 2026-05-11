import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  createTRPCRouter,
  operatorProcedure,
  viewerProcedure,
} from "@/server/api/trpc";
import { cmdbProjects } from "@/server/db/schema";
import {
  cancelCmdbRelease,
  cmdbAssetStatusValues,
  cmdbDeployTargetValues,
  createCmdbTopicRelease,
  createCmdbRelease,
  deleteCmdbAsset,
  deleteCmdbProject,
  deleteCmdbTopicReleaseGroup,
  getCmdbDashboard,
  listGitLabBranches,
  listGitLabCatalog,
  runCmdbProjectOperation,
  testCmdbAssetConnectivity,
  upsertCmdbAsset,
  upsertCmdbProject,
} from "@/server/cmdb/service";

function authUserDisplayName(user: {
  name?: string | null;
  email?: string | null;
  feishuOpenId: string;
}) {
  return user.name ?? user.email ?? user.feishuOpenId;
}

const assetSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1).max(128),
  ip: z.string().min(1).max(128),
  sshUser: z.string().optional(),
  sshPassword: z.string().optional(),
  sshPort: z.number().int().positive().optional(),
  roles: z.array(z.string()).default([]),
  arch: z.string().optional(),
  status: z.enum(cmdbAssetStatusValues),
});

const projectConfigSchema = z.object({
  triggerToken: z.string().optional(),
  customVariables: z.record(z.string()).optional(),
  targetAssetName: z.string().optional(),
  targetAssetNames: z.array(z.string()).optional(),
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
  dashboard: viewerProcedure.query(async ({ ctx }) => {
    return getCmdbDashboard(ctx.db);
  }),

  saveAsset: operatorProcedure
    .input(assetSchema)
    .mutation(async ({ ctx, input }) => {
      return upsertCmdbAsset(ctx.db, {
        ...input,
        ownerUserId: ctx.user.id,
      });
    }),

  testAssetConnectivity: operatorProcedure
    .input(
      z.object({
        ip: z.string().min(1).max(128),
        sshUser: z.string().min(1).max(128),
        sshPassword: z.string().min(1),
        sshPort: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return testCmdbAssetConnectivity(input);
    }),

  deleteAsset: operatorProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return deleteCmdbAsset(ctx.db, input.id);
    }),

  gitlabCatalog: viewerProcedure
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

  gitlabBranches: viewerProcedure
    .input(
      z.object({
        projectPath: z.string().min(1).max(512),
      }),
    )
    .query(async ({ input }) => {
      return listGitLabBranches(input.projectPath);
    }),

  saveProject: operatorProcedure
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
      return upsertCmdbProject(ctx.db, {
        ...input,
        ownerUserId: ctx.user.id,
      });
    }),

  deleteProject: operatorProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return deleteCmdbProject(ctx.db, input.id);
    }),

  triggerRelease: operatorProcedure
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
        triggeredBy: authUserDisplayName(ctx.user),
        ownerUserId: ctx.user.id,
      });
    }),

  triggerTopicRelease: operatorProcedure
    .input(
      z.object({
        topic: z.string().optional(),
        projectIds: z.array(z.number()).min(1).max(50),
        ref: z.string().optional(),
        deployEnv: z.string().optional(),
        variables: z.record(z.string()).optional(),
        triggeredBy: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return createCmdbTopicRelease(ctx.db, {
        topic: input.topic,
        projectIds: input.projectIds,
        ref: input.ref,
        deployEnv: input.deployEnv,
        variables: input.variables,
        triggeredBy: authUserDisplayName(ctx.user),
        ownerUserId: ctx.user.id,
      });
    }),

  deleteTopicReleaseGroup: operatorProcedure
    .input(z.object({ topic: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      return deleteCmdbTopicReleaseGroup(ctx.db, input.topic);
    }),

  cancelRelease: operatorProcedure
    .input(z.object({ releaseId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return cancelCmdbRelease(ctx.db, input.releaseId);
    }),

  projectOperation: operatorProcedure
    .input(
      z.object({
        projectId: z.number(),
        action: z.enum([
          "dockerStatus",
          "dockerLogs",
          "containerMonitor",
          "sshInfo",
        ]),
        targetAssetName: z.string().optional(),
        tail: z.number().int().min(20).max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return runCmdbProjectOperation(ctx.db, input);
    }),
});
