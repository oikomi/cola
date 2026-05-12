import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clusterKubeconfigPath,
  kubeconfigPathCandidates,
  resolveKubeconfigPath,
  resolveReadableKubeconfigPath,
} from "./kubeconfig.ts";

function withEnv<T>(
  patch: Record<string, string | undefined>,
  callback: () => T,
) {
  const previous = new Map(
    Object.keys(patch).map((key) => [key, process.env[key]]),
  );

  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

void test("kubeconfig candidates keep env priority and include cluster fallback", () => {
  const candidates = withEnv(
    {
      PRIMARY_KUBECONFIG: "/tmp/primary.config",
      SECONDARY_KUBECONFIG: " ",
    },
    () =>
      kubeconfigPathCandidates({
        clusterName: "xdream-cloud",
        envVarNames: ["PRIMARY_KUBECONFIG", "SECONDARY_KUBECONFIG"],
        fallbackPaths: ["/tmp/primary.config", "/tmp/fallback.config"],
      }),
  );

  assert.deepEqual(candidates, [
    "/tmp/primary.config",
    "/tmp/fallback.config",
    clusterKubeconfigPath("xdream-cloud"),
  ]);
});

void test("readable kubeconfig resolution skips stale local env paths", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cola-kubeconfig-"));
  const remotePath = path.join(tempDir, "remote.config");

  try {
    fs.writeFileSync(remotePath, "apiVersion: v1\n");

    const resolved = withEnv(
      {
        REMOTE_WORK_KUBECONFIG_PATH:
          "/Users/harold/dev/webdev/cola/runtime/kube/missing-xdream-cloud.config",
        WORKSPACE_KUBECONFIG: remotePath,
      },
      () =>
        resolveReadableKubeconfigPath({
          clusterName: "xdream-cloud",
          envVarNames: [
            "REMOTE_WORK_KUBECONFIG_PATH",
            "WORKSPACE_KUBECONFIG",
          ],
        }),
    );

    assert.equal(resolved, remotePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("kubeconfig path falls back to infra cluster name path when none are readable", () => {
  const resolved = withEnv(
    {
      REMOTE_WORK_KUBECONFIG_PATH: "/missing/local.config",
      WORKSPACE_KUBECONFIG: undefined,
    },
    () =>
      resolveKubeconfigPath({
        clusterName: "xdream-cloud",
        envVarNames: ["REMOTE_WORK_KUBECONFIG_PATH", "WORKSPACE_KUBECONFIG"],
      }),
  );

  assert.equal(resolved, clusterKubeconfigPath("xdream-cloud"));
});
