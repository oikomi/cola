import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readExecutionResult } from "./execution-result.ts";

void test("readExecutionResult accepts Hermes stdout result files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cola-hermes-result-"));

  try {
    fs.writeFileSync(
      path.join(tempDir, "last-result.json"),
      JSON.stringify({
        completedAt: "2026-05-28T01:02:03.000Z",
        result: {
          stdout: "wiki link is readable\n",
          stderr: "",
          code: 0,
        },
      }),
    );

    assert.deepEqual(readExecutionResult(tempDir), {
      outputText: "wiki link is readable",
      completedAt: "2026-05-28T01:02:03.000Z",
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
