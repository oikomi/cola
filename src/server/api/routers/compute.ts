import { createTRPCRouter, viewerProcedure } from "@/server/api/trpc";
import { getComputeSnapshot } from "@/server/compute/service";

export const computeRouter = createTRPCRouter({
  getSnapshot: viewerProcedure.query(({ ctx }) => getComputeSnapshot(ctx.db)),
});
