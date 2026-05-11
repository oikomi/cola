import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/server/db";

import { AUTH_SESSION_COOKIE } from "./config";
import { getSessionUserFromToken } from "./session";
import { hasRoleAtLeast, type AuthRole } from "./permissions";

export async function requireRouteUser(request: NextRequest | Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_SESSION_COOKIE}=`))
    ?.slice(AUTH_SESSION_COOKIE.length + 1);

  const user = await getSessionUserFromToken(
    db,
    token ? decodeURIComponent(token) : undefined,
  );

  if (!user) {
    return {
      response: NextResponse.json({ error: "未登录。" }, { status: 401 }),
      user: null,
    } as const;
  }

  return { response: null, user } as const;
}

export async function requireRouteRole(
  request: NextRequest | Request,
  role: AuthRole,
) {
  const result = await requireRouteUser(request);

  if (result.response) return result;

  if (!hasRoleAtLeast(result.user, role)) {
    return {
      response: NextResponse.json({ error: "权限不足。" }, { status: 403 }),
      user: result.user,
    } as const;
  }

  return result;
}

