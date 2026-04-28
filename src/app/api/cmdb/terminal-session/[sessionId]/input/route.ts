import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { writeCmdbTerminalSessionInput } from "@/server/cmdb/terminal-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

const terminalInputSchema = z.object({
  data: z.string().min(1).max(10_000),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const json: unknown = await request.json();
    const input = terminalInputSchema.parse(json);
    const written = writeCmdbTerminalSessionInput(sessionId, input.data);

    if (!written) {
      return NextResponse.json(
        { error: "终端会话不存在或尚未连接。" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "终端输入失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
