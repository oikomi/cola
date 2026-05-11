import { env } from "@/env";

export { isSafeInternalNextPath, normalizeNextPath } from "./url";

export const AUTH_SESSION_COOKIE = "cola_session";
export const AUTH_STATE_COOKIE = "cola_auth_state";
export const AUTH_NEXT_COOKIE = "cola_auth_next";
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const AUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

function parseCsvSet(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function authCookieSecure() {
  return env.AUTH_COOKIE_SECURE === "true";
}

export function authPublicBaseUrl() {
  return env.AUTH_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? null;
}

export function authPublicOrigin() {
  const baseUrl = authPublicBaseUrl();
  return baseUrl ? new URL(baseUrl).origin : null;
}

export function authUrl(path: string, requestUrl: string | URL) {
  const baseUrl = authPublicBaseUrl() ?? new URL(requestUrl).origin;
  return new URL(path, baseUrl);
}

export function adminFeishuOpenIds() {
  return parseCsvSet(env.AUTH_ADMIN_FEISHU_OPEN_IDS);
}

export function allowedTenantKeys() {
  return parseCsvSet(env.AUTH_ALLOWED_TENANT_KEYS);
}

export function requireFeishuConfig() {
  const missing = [
    ["FEISHU_APP_ID", env.FEISHU_APP_ID],
    ["FEISHU_APP_SECRET", env.FEISHU_APP_SECRET],
    ["FEISHU_REDIRECT_URI", env.FEISHU_REDIRECT_URI],
    ["AUTH_SESSION_SECRET", env.AUTH_SESSION_SECRET],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`飞书登录缺少环境变量：${missing.join(", ")}。`);
  }

  return {
    appId: env.FEISHU_APP_ID!,
    appSecret: env.FEISHU_APP_SECRET!,
    redirectUri: env.FEISHU_REDIRECT_URI!,
    sessionSecret: env.AUTH_SESSION_SECRET!,
  };
}
