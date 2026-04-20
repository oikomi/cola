import { officeRouter } from "@/server/api/routers/office";
import { postRouter } from "@/server/api/routers/post";
import { trainingRouter } from "@/server/api/routers/training";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { workerRouter } from "@/server/api/routers/worker";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  office: officeRouter,
  post: postRouter,
  training: trainingRouter,
  worker: workerRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
