import "server-only";

import { inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as DbSchema from "@/server/db/schema";
import { users } from "@/server/db/schema";

type Database = PostgresJsDatabase<typeof DbSchema>;

export type ResourceOwner = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  displayName: string;
};

export function displayResourceOwnerName(
  user: Pick<
    typeof users.$inferSelect,
    "id" | "name" | "email" | "feishuOpenId"
  >,
) {
  return user.name ?? user.email ?? user.feishuOpenId ?? user.id;
}

export async function loadResourceOwnerMap(
  database: Database,
  ownerUserIds: Array<string | null | undefined>,
) {
  const ids = Array.from(
    new Set(ownerUserIds.filter((id): id is string => Boolean(id))),
  );

  if (ids.length === 0) return new Map<string, ResourceOwner>();

  const rows = await database
    .select({
      id: users.id,
      feishuOpenId: users.feishuOpenId,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(inArray(users.id, ids));

  return new Map(
    rows.map((user) => [
      user.id,
      {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        displayName: displayResourceOwnerName(user),
      },
    ]),
  );
}

export function ownerForUserId(
  ownerMap: Map<string, ResourceOwner>,
  ownerUserId: string | null | undefined,
) {
  return ownerUserId ? (ownerMap.get(ownerUserId) ?? null) : null;
}
