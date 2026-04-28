import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { resolveCmdbProjectTerminalTarget } from "@/server/cmdb/service";
import { createCmdbTerminalSession } from "@/server/cmdb/terminal-session";
import { db } from "@/server/db";

export const runtime = "nodejs";

const startTerminalSessionSchema = z.object({
  projectId: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  try {
    const json: unknown = await request.json();
    const input = startTerminalSessionSchema.parse(json);
    const target = await resolveCmdbProjectTerminalTarget(db, input.projectId);
    const session = createCmdbTerminalSession(target);

    return NextResponse.json(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "终端会话创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
