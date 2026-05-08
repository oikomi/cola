import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const TOKEN_COMMAND_TIMEOUT_MS = 90_000;

export async function POST() {
  const scriptPath = path.join(
    process.cwd(),
    "infra",
    "k8s",
    "bin",
    "cluster.sh",
  );

  try {
    const { stdout } = await execFileAsync(scriptPath, ["dashboard", "token"], {
      cwd: path.join(process.cwd(), "infra", "k8s"),
      timeout: TOKEN_COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const token = stdout.trim();

    if (!token) {
      return NextResponse.json(
        { error: "Dashboard Token 为空，请检查 admin-user-token Secret。" },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { token },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "读取 Kubernetes Dashboard Token 失败。";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
