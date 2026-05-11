import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { cookies } from "next/headers";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

import { env } from "@/env";
import type * as DbSchema from "@/server/db/schema";
import { authSessions, users } from "@/server/db/schema";

import {
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_MAX_AGE_SECONDS,
  authCookieSecure,
  requireFeishuConfig,
} from "./config";
import type { FeishuIdentity } from "./feishu";
import type { AuthRole, AuthSessionUser } from "./permissions";
import { createOpaqueToken, hashOpaqueToken } from "./token";

export { constantTimeEqual } from "./token";

type Database = PostgresJsDatabase<typeof DbSchema>;
type CookieReader = Pick<ReadonlyRequestCookies, "get">;

function nowPlusSessionMaxAge() {
  return new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000);
}

export function hashSessionToken(token: string) {
  const secret = env.AUTH_SESSION_SECRET ?? "development-session-secret";
  return hashOpaqueToken(token, secret);
}

export function createSessionToken() {
  return createOpaqueToken(32);
}

export function createStateToken() {
  return createOpaqueToken(24);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: authCookieSecure(),
  };
}

export function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax" as const,
    secure: authCookieSecure(),
  };
}

export async function getSessionUserFromToken(
  database: Database,
  token: string | undefined,
) {
  if (!token) return null;

  const [row] = await database
    .select({
      sessionId: authSessions.id,
      sessionExpiresAt: authSessions.expiresAt,
      userId: users.id,
      feishuOpenId: users.feishuOpenId,
      feishuUnionId: users.feishuUnionId,
      tenantKey: users.tenantKey,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      role: users.role,
      status: users.status,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(
        eq(authSessions.sessionTokenHash, hashSessionToken(token)),
        gt(authSessions.expiresAt, new Date()),
        isNull(authSessions.revokedAt),
      ),
    )
    .limit(1);

  if (row?.status !== "active") return null;

  return {
    id: row.userId,
    feishuOpenId: row.feishuOpenId,
    feishuUnionId: row.feishuUnionId,
    tenantKey: row.tenantKey,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    role: row.role,
    status: row.status,
    sessionId: row.sessionId,
    sessionExpiresAt: row.sessionExpiresAt,
  } satisfies AuthSessionUser;
}

export async function getSessionUserFromCookies(
  database: Database,
  cookieStore: CookieReader,
) {
  return getSessionUserFromToken(
    database,
    cookieStore.get(AUTH_SESSION_COOKIE)?.value,
  );
}

export async function getCurrentSessionUser(database: Database) {
  return getSessionUserFromCookies(database, await cookies());
}

export async function upsertUserFromFeishuIdentity(
  database: Database,
  identity: FeishuIdentity,
) {
  const now = new Date();
  const desiredRole = identity.role;

  const [existing] = await database
    .select()
    .from(users)
    .where(eq(users.feishuOpenId, identity.openId))
    .limit(1);

  if (existing) {
    const nextRole: AuthRole =
      desiredRole === "admin" && existing.role !== "admin"
        ? "admin"
        : existing.role;

    const [updated] = await database
      .update(users)
      .set({
        avatarUrl: identity.avatarUrl,
        email: identity.email,
        feishuUnionId: identity.unionId,
        lastLoginAt: now,
        name: identity.name,
        role: nextRole,
        tenantKey: identity.tenantKey,
        updatedAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning();

    if (!updated) {
      throw new Error("飞书用户更新失败。");
    }

    if (updated.status !== "active") {
      throw new Error("当前账号已被禁用。");
    }

    return updated;
  }

  const [created] = await database
    .insert(users)
    .values({
      avatarUrl: identity.avatarUrl,
      email: identity.email,
      feishuOpenId: identity.openId,
      feishuUnionId: identity.unionId,
      lastLoginAt: now,
      name: identity.name,
      role: desiredRole,
      status: "active",
      tenantKey: identity.tenantKey,
    })
    .returning();

  if (!created) {
    throw new Error("飞书用户创建失败。");
  }

  return created;
}

export async function createAuthSession(database: Database, userId: string) {
  requireFeishuConfig();

  const token = createSessionToken();
  const [session] = await database
    .insert(authSessions)
    .values({
      expiresAt: nowPlusSessionMaxAge(),
      sessionTokenHash: hashSessionToken(token),
      userId,
    })
    .returning();

  if (!session) {
    throw new Error("登录会话创建失败。");
  }

  return {
    expiresAt: session.expiresAt,
    token,
  };
}

export async function revokeAuthSession(database: Database, token: string) {
  await database
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(eq(authSessions.sessionTokenHash, hashSessionToken(token)));
}
