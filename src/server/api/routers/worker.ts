import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import {
  heartbeatInputSchema,
  pullNextTaskInputSchema,
  registerDockerRunnerInputSchema,
  reportSessionInputSchema,
} from "@/server/worker/schemas";
import {
  heartbeatRunner,
  pullNextTaskForRunner,
  registerDockerRunner,
  reportRunnerSession,
} from "@/server/worker/service";

export const workerRouter = createTRPCRouter({
  registerDockerRunner: publicProcedure
    .input(registerDockerRunnerInputSchema)
    .mutation(({ ctx, input }) => registerDockerRunner(ctx.db, input)),

  heartbeat: publicProcedure
    .input(heartbeatInputSchema)
    .mutation(({ ctx, input }) => heartbeatRunner(ctx.db, input)),

  pullNextTask: publicProcedure
    .input(pullNextTaskInputSchema)
    .mutation(({ ctx, input }) => pullNextTaskForRunner(ctx.db, input)),

  reportSession: publicProcedure
    .input(reportSessionInputSchema)
    .mutation(({ ctx, input }) => reportRunnerSession(ctx.db, input)),
});
