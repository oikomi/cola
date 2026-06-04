import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireRouteRole } from "@/server/auth/http";
import { createIsaacLabTerminalSession } from "@/server/isaac-station/terminal-session";

export const runtime = "nodejs";

const startTerminalSessionSchema = z.object({
  jobName: z.string().trim().min(2).max(42),
});

export async function POST(request: NextRequest) {
  const auth = await requireRouteRole(request, "operator");
  if (auth.response) return auth.response;

  try {
    const json: unknown = await request.json();
    const input = startTerminalSessionSchema.parse(json);
    const session = await createIsaacLabTerminalSession(input.jobName);

    return NextResponse.json(session);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Isaac Lab 终端会话创建失败。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
