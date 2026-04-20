import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/env";

function hostNameFromHeader(rawHost: string | null) {
  if (!rawHost) return "masterIP";

  const normalized = rawHost.trim();

  if (normalized.startsWith("[")) {
    const end = normalized.indexOf("]");
    return end >= 0 ? normalized.slice(1, end) : normalized;
  }

  const [host] = normalized.split(":");
  return host || "masterIP";
}

export default async function SystemPage() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host");

  const dashboardUrl =
    env.NEXT_PUBLIC_K8S_DASHBOARD_URL ??
    `https://${hostNameFromHeader(host)}:8443/`;

  redirect(dashboardUrl);
}
