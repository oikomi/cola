import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/server/db";
import { heartbeatRunner } from "@/server/worker/service";
import { heartbeatInputSchema } from "@/server/worker/schemas";

export async function POST(request: NextRequest) {
  try {
    const json: unknown = await request.json();
    const input = heartbeatInputSchema.parse(json);
    const result = await heartbeatRunner(db, input);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "心跳失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
