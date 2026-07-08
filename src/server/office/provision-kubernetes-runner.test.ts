import assert from "node:assert/strict";
import test from "node:test";

import { buildHermesDashboardAuthEnv } from "./hermes-dashboard-auth.ts";

void test("Hermes Kubernetes runner configures dashboard basic auth", () => {
  assert.deepEqual(buildHermesDashboardAuthEnv("token-1"), [
    {
      name: "HERMES_DASHBOARD_BASIC_AUTH_USERNAME",
      value: "cola",
    },
    {
      name: "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD",
      value: "token-1",
    },
    {
      name: "HERMES_DASHBOARD_BASIC_AUTH_SECRET",
      value: "token-1",
    },
  ]);
});

void test("Hermes dashboard auth env is omitted without a token", () => {
  assert.deepEqual(buildHermesDashboardAuthEnv(null), []);
});
