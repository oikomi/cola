import { TRPCError } from "@trpc/server";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure,
} from "@/server/api/trpc";
import { authRoleValues, authStatusValues } from "@/server/auth/permissions";
import type * as DbSchema from "@/server/db/schema";
import { authSessions, users } from "@/server/db/schema";

type Database = PostgresJsDatabase<typeof DbSchema>;

const updateUserInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(authRoleValues).optional(),
  status: z.enum(authStatusValues).optional(),
});

async function activeAdminCount(database: Database) {
  const [row] = await database
    .select({ value: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));

  return row?.value ?? 0;
}

function displayName(
  user: Pick<typeof users.$inferSelect, "name" | "email" | "feishuOpenId">,
) {
  return user.name ?? user.email ?? user.feishuOpenId;
}

export const authRouter = createTRPCRouter({
  permissions: protectedProcedure.query(async ({ ctx }) => {
    const hasActiveAdmin = (await activeAdminCount(ctx.db)) > 0;
    const canManageUsers = ctx.user.role === "admin" || !hasActiveAdmin;

    const userRows = canManageUsers
      ? await ctx.db
          .select({
            id: users.id,
            feishuOpenId: users.feishuOpenId,
            feishuUnionId: users.feishuUnionId,
            tenantKey: users.tenantKey,
            name: users.name,
            email: users.email,
            avatarUrl: users.avatarUrl,
            role: users.role,
            status: users.status,
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          })
          .from(users)
          .orderBy(desc(users.lastLoginAt), desc(users.createdAt))
      : [];

    return {
      currentUser: ctx.user,
      hasActiveAdmin,
      canBootstrapAdmin: !hasActiveAdmin,
      canManageUsers,
      users: userRows,
    };
  }),

  bootstrapAdmin: protectedProcedure.mutation(async ({ ctx }) => {
    return ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(2026051101)`);

      const adminTotal = await activeAdminCount(tx);
      if (adminTotal > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "系统已经存在管理员。",
        });
      }

      const [updatedUser] = await tx
        .update(users)
        .set({
          role: "admin",
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.user.id))
        .returning();

      if (!updatedUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "当前用户不存在。",
        });
      }

      return {
        userId: updatedUser.id,
        role: updatedUser.role,
        status: updatedUser.status,
      };
    });
  }),

  updateUser: adminProcedure
    .input(updateUserInput)
    .mutation(async ({ ctx, input }) => {
      if (input.role === undefined && input.status === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "没有需要更新的权限字段。",
        });
      }

      return ctx.db.transaction(async (tx) => {
        const [targetUser] = await tx
          .select()
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1);

        if (!targetUser) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "目标用户不存在。",
          });
        }

        const nextRole = input.role ?? targetUser.role;
        const nextStatus = input.status ?? targetUser.status;
        const wasActiveAdmin =
          targetUser.role === "admin" && targetUser.status === "active";
        const remainsActiveAdmin =
          nextRole === "admin" && nextStatus === "active";

        if (targetUser.id === ctx.user.id && nextStatus === "disabled") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "不能禁用当前登录账号。",
          });
        }

        if (wasActiveAdmin && !remainsActiveAdmin) {
          const adminTotal = await activeAdminCount(tx);
          if (adminTotal <= 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "不能移除最后一个启用状态的管理员。",
            });
          }
        }

        const [updatedUser] = await tx
          .update(users)
          .set({
            ...(input.role ? { role: input.role } : {}),
            ...(input.status ? { status: input.status } : {}),
            updatedAt: new Date(),
          })
          .where(eq(users.id, input.userId))
          .returning();

        if (!updatedUser) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "用户权限更新失败。",
          });
        }

        if (input.status === "disabled") {
          await tx
            .update(authSessions)
            .set({ revokedAt: new Date() })
            .where(eq(authSessions.userId, updatedUser.id));
        }

        return {
          userId: updatedUser.id,
          label: displayName(updatedUser),
          role: updatedUser.role,
          status: updatedUser.status,
        };
      });
    }),
});
