import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireRouteRole } from "@/server/auth/http";
import {
  resolveCmdbAssetTerminalTarget,
  resolveCmdbProjectTerminalTarget,
} from "@/server/cmdb/service";
import { createCmdbTerminalSession } from "@/server/cmdb/terminal-session";
import { db } from "@/server/db";

export const runtime = "nodejs";

const startTerminalSessionSchema = z.object({
  projectId: z.number().int().positive().optional(),
  assetId: z.number().int().positive().optional(),
  targetAssetName: z.string().optional(),
}).refine((value) => Boolean(value.projectId) !== Boolean(value.assetId), {
  message: "请指定项目或资产其一。",
});

export async function POST(request: NextRequest) {
  const auth = await requireRouteRole(request, "operator");
  if (auth.response) return auth.response;

  try {
    const json: unknown = await request.json();
    const input = startTerminalSessionSchema.parse(json);
    const target =
      typeof input.assetId === "number"
        ? await resolveCmdbAssetTerminalTarget(db, input.assetId)
        : typeof input.projectId === "number"
          ? await resolveCmdbProjectTerminalTarget(
              db,
              input.projectId,
              input.targetAssetName,
            )
          : null;

    if (!target) {
      throw new Error("请指定项目或资产其一。");
    }
    const session = createCmdbTerminalSession(target);

    return NextResponse.json(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "终端会话创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
