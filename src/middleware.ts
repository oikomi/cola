import { NextResponse, type NextRequest } from "next/server";

import { AUTH_SESSION_COOKIE } from "@/server/auth/config";

const PUBLIC_PATH_PREFIXES = [
  "/api/auth",
  "/api/worker",
  "/_next",
  "/favicon.ico",
  "/xdream-cloud-mark.svg",
];

const PROTECTED_API_PREFIXES = [
  "/api/cmdb",
  "/api/office",
  "/api/system",
  "/api/trpc",
  "/api/auth/me",
];

function hasSessionCookie(request: NextRequest) {
  return Boolean(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
}

function isPublicPath(pathname: string) {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isProtectedApi(pathname: string) {
  return PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isPageRequest(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api")) return false;
  if (pathname.includes(".")) return false;
  return true;
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isProtectedApi(pathname) && !hasSessionCookie(request)) {
    return NextResponse.json({ error: "未登录。" }, { status: 401 });
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname === "/login") {
    return NextResponse.next();
  }

  if (isPageRequest(request) && !hasSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"],
};
