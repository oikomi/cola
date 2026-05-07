import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { resizeCmdbTerminalSession } from "@/server/cmdb/terminal-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

const terminalResizeSchema = z.object({
  cols: z.number().int().min(20).max(400),
  rows: z.number().int().min(5).max(200),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const json: unknown = await request.json();
    const input = terminalResizeSchema.parse(json);
    const resized = resizeCmdbTerminalSession(sessionId, input);

    if (!resized) {
      return NextResponse.json(
        { error: "终端会话不存在或尚未连接。" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "终端窗口尺寸同步失败。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
