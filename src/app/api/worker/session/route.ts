import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/server/db";
import { reportRunnerSession } from "@/server/worker/service";
import { reportSessionInputSchema } from "@/server/worker/schemas";

export async function POST(request: NextRequest) {
  try {
    const json: unknown = await request.json();
    const input = reportSessionInputSchema.parse(json);
    const result = await reportRunnerSession(db, input);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "会话上报失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
