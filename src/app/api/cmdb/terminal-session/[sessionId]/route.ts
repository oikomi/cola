import { NextResponse } from "next/server";

import { closeCmdbTerminalSession } from "@/server/cmdb/terminal-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  closeCmdbTerminalSession(sessionId);
  return NextResponse.json({ success: true });
}
