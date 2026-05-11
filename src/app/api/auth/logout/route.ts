import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_SESSION_COOKIE } from "@/server/auth/config";
import {
  clearSessionCookieOptions,
  revokeAuthSession,
} from "@/server/auth/session";
import { db } from "@/server/db";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_SESSION_COOKIE)?.value;

  if (token) {
    await revokeAuthSession(db, token);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_SESSION_COOKIE, "", clearSessionCookieOptions());
  return response;
}

