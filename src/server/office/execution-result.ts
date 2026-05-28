import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function resolveWorkspacePath(inputPath: string | null | undefined) {
  if (!inputPath) return null;
  if (inputPath.startsWith("/workspace/")) {
    return path.join(process.cwd(), inputPath.slice("/workspace/".length));
  }
  return inputPath;
}

export function readExecutionResult(inputPath: string | null | undefined) {
  const resolvedPath = resolveWorkspacePath(inputPath);
  if (!resolvedPath) return null;
  if (!existsSync(resolvedPath)) return null;

  try {
    const stats = statSync(resolvedPath);
    const filePath = stats.isDirectory()
      ? path.join(resolvedPath, "last-result.json")
      : resolvedPath;

    if (!existsSync(filePath)) return null;

    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      title?: string;
      result?: {
        outputs?: Array<{ text?: string | null }>;
        stdout?: string | null;
        stderr?: string | null;
      };
      taskId?: string;
      completedAt?: string;
    };
    const stdout = parsed.result?.stdout?.trim();
    const stderr = parsed.result?.stderr?.trim();

    return {
      outputText:
        parsed.result?.outputs?.find(
          (output) => typeof output.text === "string",
        )?.text ??
        stdout ??
        stderr ??
        null,
      completedAt: parsed.completedAt ?? null,
    };
  } catch {
    return null;
  }
}
