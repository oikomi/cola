import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_NEXT_COOKIE,
  AUTH_SESSION_COOKIE,
  AUTH_STATE_COOKIE,
  authCookieSecure,
  normalizeNextPath,
} from "@/server/auth/config";
import { getFeishuIdentityFromCode } from "@/server/auth/feishu";
import {
  clearSessionCookieOptions,
  constantTimeEqual,
  createAuthSession,
  sessionCookieOptions,
  upsertUserFromFeishuIdentity,
} from "@/server/auth/session";
import { db } from "@/server/db";

export const runtime = "nodejs";

function redirectToLogin(request: NextRequest, message: string) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", message);
  return NextResponse.redirect(loginUrl);
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const expectedState = cookieStore.get(AUTH_STATE_COOKIE)?.value;
  const next = normalizeNextPath(cookieStore.get(AUTH_NEXT_COOKIE)?.value);

  cookieStore.delete(AUTH_STATE_COOKIE);
  cookieStore.delete(AUTH_NEXT_COOKIE);

  if (!code) {
    return redirectToLogin(request, "飞书回调缺少授权码。");
  }

  if (
    !returnedState ||
    !expectedState ||
    !constantTimeEqual(returnedState, expectedState)
  ) {
    return redirectToLogin(request, "飞书登录状态校验失败，请重新登录。");
  }

  try {
    const identity = await getFeishuIdentityFromCode(code);
    const user = await upsertUserFromFeishuIdentity(db, identity);
    const session = await createAuthSession(db, user.id);
    const response = NextResponse.redirect(new URL(next, request.url));
    response.cookies.set(
      AUTH_SESSION_COOKIE,
      session.token,
      sessionCookieOptions(),
    );
    return response;
  } catch (error) {
    const response = redirectToLogin(
      request,
      error instanceof Error ? error.message : "飞书登录失败。",
    );
    response.cookies.set(AUTH_SESSION_COOKIE, "", clearSessionCookieOptions());
    response.cookies.set(AUTH_STATE_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: authCookieSecure(),
    });
    response.cookies.set(AUTH_NEXT_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: authCookieSecure(),
    });
    return response;
  }
}

