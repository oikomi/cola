import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBootstrapConfigMap,
  buildHermesReliabilityEnv,
  resolveHermesApiServerKey,
} from "./provision-kubernetes-runner.ts";
import { buildHermesDashboardAuthEnv } from "./hermes-dashboard-auth.ts";

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

void test("Hermes API Server key falls back to a generated strong token", () => {
  withEnv(
    {
      COLA_HERMES_API_SERVER_KEY: undefined,
      HERMES_API_SERVER_KEY: undefined,
    },
    () => {
      assert.equal(
        resolveHermesApiServerKey(() => "generated-hermes-api-secret"),
        "generated-hermes-api-secret",
      );
    },
  );
});

void test("Hermes API Server key rejects weak configured values", () => {
  withEnv(
    {
      COLA_HERMES_API_SERVER_KEY: "cola-hermes-api",
      HERMES_API_SERVER_KEY: undefined,
    },
    () => {
      assert.throws(
        () => resolveHermesApiServerKey(() => "generated-hermes-api-secret"),
        /Hermes API Server key must be at least 16 characters/,
      );
    },
  );
});

void test("Hermes API Server key keeps configured strong values", () => {
  withEnv(
    {
      COLA_HERMES_API_SERVER_KEY: undefined,
      HERMES_API_SERVER_KEY: "configured-hermes-api-secret",
    },
    () => {
      assert.equal(
        resolveHermesApiServerKey(() => "generated-hermes-api-secret"),
        "configured-hermes-api-secret",
      );
    },
  );
});

void test("Hermes runner gives slow upstream models a larger retry budget", () => {
  withEnv(
    {
      COLA_HERMES_API_CALL_STALE_TIMEOUT_SECONDS: undefined,
      HERMES_API_CALL_STALE_TIMEOUT: undefined,
      COLA_HERMES_API_MAX_RETRIES: undefined,
      COLA_HERMES_TASK_API_TIMEOUT_MS: undefined,
      COLA_HERMES_TASK_API_ATTEMPTS: undefined,
      COLA_HERMES_TASK_API_RETRY_INTERVAL_MS: undefined,
    },
    () => {
      assert.deepEqual(buildHermesReliabilityEnv(), [
        { name: "HERMES_API_CALL_STALE_TIMEOUT", value: "300" },
        { name: "COLA_HERMES_API_MAX_RETRIES", value: "5" },
        { name: "COLA_HERMES_TASK_API_TIMEOUT_MS", value: "3600000" },
        { name: "COLA_HERMES_TASK_API_ATTEMPTS", value: "2" },
        {
          name: "COLA_HERMES_TASK_API_RETRY_INTERVAL_MS",
          value: "3000",
        },
      ]);
    },
  );
});

void test("Hermes reliability budget accepts Cola environment overrides", () => {
  withEnv(
    {
      COLA_HERMES_API_CALL_STALE_TIMEOUT_SECONDS: "600",
      HERMES_API_CALL_STALE_TIMEOUT: undefined,
      COLA_HERMES_API_MAX_RETRIES: "7",
      COLA_HERMES_TASK_API_TIMEOUT_MS: "7200000",
      COLA_HERMES_TASK_API_ATTEMPTS: "3",
      COLA_HERMES_TASK_API_RETRY_INTERVAL_MS: "5000",
    },
    () => {
      assert.deepEqual(buildHermesReliabilityEnv(), [
        { name: "HERMES_API_CALL_STALE_TIMEOUT", value: "600" },
        { name: "COLA_HERMES_API_MAX_RETRIES", value: "7" },
        { name: "COLA_HERMES_TASK_API_TIMEOUT_MS", value: "7200000" },
        { name: "COLA_HERMES_TASK_API_ATTEMPTS", value: "3" },
        {
          name: "COLA_HERMES_TASK_API_RETRY_INTERVAL_MS",
          value: "5000",
        },
      ]);
    },
  );
});

void test("Hermes runner ConfigMap includes the large-task API transport", () => {
  const configMap = buildBootstrapConfigMap("hermes-runner-test", "owner-1");

  assert.match(
    configMap.data?.["hermes-bootstrap.mjs"] ?? "",
    /from "\.\/task-executor\.mjs"/,
  );
  assert.match(
    configMap.data?.["task-executor.mjs"] ?? "",
    /export async function runHermesTaskViaApi/,
  );
});
