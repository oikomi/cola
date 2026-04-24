import assert from "node:assert/strict";
import test from "node:test";

// @ts-ignore Node --experimental-strip-types requires an explicit .ts specifier here.
import {
  mergeMetadata,
  parseRunnerMetadata,
  resolveDockerRunnerEngine,
  resolveRunnerRuntime,
  resourcePoolForRole,
  roleLabel,
  zoneForRole,
} from "./domain.ts";

void test("role helpers map roles to office zones and runner pools", () => {
  assert.equal(zoneForRole("engineering"), "engineering");
  assert.equal(zoneForRole("operations"), "growth");
  assert.equal(zoneForRole("procurement"), "vendor");
  assert.equal(resourcePoolForRole("engineering"), "docker-core");
  assert.equal(resourcePoolForRole("hr"), "docker-backoffice");
  assert.equal(resourcePoolForRole("ceo_office"), "docker-command");
  assert.equal(roleLabel("product"), "产品");
});

void test("runner metadata parser accepts only supported enum values", () => {
  assert.deepEqual(
    parseRunnerMetadata({
      agentId: "agent-1",
      agentName: "Alice",
      containerName: "runner-alice",
      deploymentName: "runner-alice-deploy",
      engine: "hermes-agent",
      namespace: "cola-runners",
      nativeDashboardUrl: "http://127.0.0.1:31080/",
      nodePort: "31080",
      runtime: "kubernetes",
    }),
    {
      agentId: "agent-1",
      agentName: "Alice",
      containerName: "runner-alice",
      deploymentName: "runner-alice-deploy",
      engine: "hermes-agent",
      namespace: "cola-runners",
      nativeDashboardUrl: "http://127.0.0.1:31080/",
      nodePort: 31080,
      runtime: "kubernetes",
    },
  );

  assert.deepEqual(
    parseRunnerMetadata({
      agentId: 123,
      engine: "unknown",
      nodePort: -1,
      runtime: "serverless",
    }),
    {
      agentId: null,
      agentName: null,
      containerName: null,
      deploymentName: null,
      engine: null,
      namespace: null,
      nativeDashboardUrl: null,
      nodePort: null,
      runtime: null,
    },
  );
});

void test("runner defaults preserve existing fallback behavior", () => {
  assert.equal(resolveDockerRunnerEngine("hermes-agent"), "hermes-agent");
  assert.equal(resolveDockerRunnerEngine("bad-engine"), "openclaw");
  assert.equal(resolveRunnerRuntime("kubernetes"), "kubernetes");
  assert.equal(resolveRunnerRuntime(undefined), "docker");
});

void test("metadata merge keeps existing keys and applies patch", () => {
  assert.deepEqual(
    mergeMetadata({ agentId: "a1", stale: "kept" }, { engine: "openclaw" }),
    { agentId: "a1", stale: "kept", engine: "openclaw" },
  );
  assert.deepEqual(mergeMetadata(null, { engine: "openclaw" }), {
    engine: "openclaw",
  });
});
