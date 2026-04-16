import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/server/db";
import { pullNextTaskForRunner } from "@/server/worker/service";
import { pullNextTaskInputSchema } from "@/server/worker/schemas";

export async function POST(request: NextRequest) {
  try {
    const json: unknown = await request.json();
    const input = pullNextTaskInputSchema.parse(json);
    const result = await pullNextTaskForRunner(db, input);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "拉取任务失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

