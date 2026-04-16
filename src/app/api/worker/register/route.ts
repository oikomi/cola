import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/server/db";
import { registerDockerRunner } from "@/server/worker/service";
import { registerDockerRunnerInputSchema } from "@/server/worker/schemas";

export async function POST(request: NextRequest) {
  try {
    const json: unknown = await request.json();
    const input = registerDockerRunnerInputSchema.parse(json);
    const result = await registerDockerRunner(db, input);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "注册失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
