import type { users } from "@/server/db/schema";

export const authRoleValues = ["admin", "operator", "viewer"] as const;
export const authStatusValues = ["active", "disabled"] as const;

export type AuthRole = (typeof authRoleValues)[number];
export type AuthUser = Pick<
  typeof users.$inferSelect,
  | "id"
  | "feishuOpenId"
  | "feishuUnionId"
  | "tenantKey"
  | "name"
  | "email"
  | "avatarUrl"
  | "role"
  | "status"
>;
export type AuthSessionUser = AuthUser & {
  sessionId: string;
  sessionExpiresAt: Date;
};

const roleRank = {
  viewer: 1,
  operator: 2,
  admin: 3,
} satisfies Record<AuthRole, number>;

export function hasRoleAtLeast(user: Pick<AuthUser, "role">, role: AuthRole) {
  return roleRank[user.role] >= roleRank[role];
}

