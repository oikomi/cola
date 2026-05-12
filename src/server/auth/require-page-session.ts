import "server-only";

import { redirect } from "next/navigation";

import { db } from "@/server/db";

import { normalizeNextPath } from "./config";
import { getCurrentSessionUser } from "./session";

export async function requirePageSession(nextPath: string) {
  const user = await getCurrentSessionUser(db);

  if (!user) {
    const next = normalizeNextPath(nextPath);
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  return user;
}
