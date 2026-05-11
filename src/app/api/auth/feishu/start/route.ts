import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_NEXT_COOKIE,
  AUTH_STATE_COOKIE,
  AUTH_STATE_MAX_AGE_SECONDS,
  authCookieSecure,
  normalizeNextPath,
} from "@/server/auth/config";
import { buildFeishuAuthorizeUrl } from "@/server/auth/feishu";
import { createStateToken } from "@/server/auth/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const next = normalizeNextPath(request.nextUrl.searchParams.get("next"));
    const state = createStateToken();
    const cookieStore = await cookies();
    const cookieOptions = {
      httpOnly: true,
      maxAge: AUTH_STATE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax" as const,
      secure: authCookieSecure(),
    };

    cookieStore.set(AUTH_STATE_COOKIE, state, cookieOptions);
    cookieStore.set(AUTH_NEXT_COOKIE, next, cookieOptions);

    return NextResponse.redirect(buildFeishuAuthorizeUrl(state));
  } catch (error) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "error",
      error instanceof Error ? error.message : "飞书登录初始化失败。",
    );
    return NextResponse.redirect(loginUrl);
  }
}

