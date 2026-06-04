import { NextResponse } from "next/server";

import { requireRouteRole } from "@/server/auth/http";
import { closeIsaacTerminalSession } from "@/server/isaac-station/terminal-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireRouteRole(request, "operator");
  if (auth.response) return auth.response;

  const { sessionId } = await context.params;
  closeIsaacTerminalSession(sessionId);
  return NextResponse.json({ success: true });
}
