import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import {
  promptByteLength,
  runHermesTaskViaApi,
  shouldUseHermesTaskApi,
} from "./task-executor.mjs";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

void test("Hermes task transport switches by UTF-8 byte length", () => {
  assert.equal(promptByteLength("周报"), 6);
  assert.equal(shouldUseHermesTaskApi("a".repeat(64), 64), false);
  assert.equal(shouldUseHermesTaskApi("a".repeat(65), 64), true);
  assert.equal(shouldUseHermesTaskApi("周".repeat(22), 64), true);
});

void test("large task prompt is carried intact in the API request body", async () => {
  const prompt = "GitLab evidence: 文档与代码\n".repeat(20_000);
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/health")) {
      return jsonResponse({ status: "ok" });
    }
    return jsonResponse({
      choices: [{ message: { content: "# 团队工作周报\n\n生成完成" } }],
    });
  };

  assert.ok(promptByteLength(prompt) > 300_000);
  const result = await runHermesTaskViaApi(
    {
      apiBaseUrl: "http://127.0.0.1:8642/",
      apiKey: "test-hermes-api-secret",
      prompt,
      taskId: "weekly-report-1",
    },
    {
      fetchImpl,
      readinessAttempts: 1,
      readinessIntervalMs: 0,
    },
  );

  assert.deepEqual(result, {
    stdout: "# 团队工作周报\n\n生成完成",
    stderr: "",
    code: 0,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://127.0.0.1:8642/health");
  assert.equal(calls[1].url, "http://127.0.0.1:8642/v1/chat/completions");
  assert.equal(calls[1].init.method, "POST");
  assert.equal(
    calls[1].init.headers.Authorization,
    "Bearer test-hermes-api-secret",
  );
  assert.equal(
    calls[1].init.headers["Idempotency-Key"],
    "cola-task-weekly-report-1",
  );
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    model: "hermes-agent",
    messages: [{ role: "user", content: prompt }],
    stream: false,
  });
});

void test("large task reports API failures clearly", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    if (callCount === 1) return jsonResponse({ status: "ok" });
    return jsonResponse({ error: { message: "model unavailable" } }, 503);
  };

  await assert.rejects(
    runHermesTaskViaApi(
      {
        apiBaseUrl: "http://127.0.0.1:8642",
        apiKey: "test-hermes-api-secret",
        prompt: "weekly report",
      },
      { fetchImpl, readinessAttempts: 1 },
    ),
    /Hermes API Server 执行失败：model unavailable/,
  );
});

void test("large task retries a broken API transport with the same idempotency key", async () => {
  const postHeaders = [];
  const retries = [];
  let postCount = 0;
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith("/health")) return jsonResponse({ status: "ok" });

    postCount += 1;
    postHeaders.push(init.headers);
    if (postCount === 1) {
      throw new Error("fetch failed", {
        cause: { code: "ECONNRESET", message: "socket closed" },
      });
    }
    return jsonResponse({
      choices: [{ message: { content: "retry completed" } }],
    });
  };

  const result = await runHermesTaskViaApi(
    {
      apiBaseUrl: "http://127.0.0.1:8642",
      apiKey: "test-hermes-api-secret",
      prompt: "weekly report",
      taskId: "retry-task-1",
    },
    {
      fetchImpl,
      readinessAttempts: 1,
      requestAttempts: 2,
      requestRetryIntervalMs: 1,
      sleepImpl: async () => {},
      onRetry: (event) => retries.push(event),
    },
  );

  assert.equal(result.stdout, "retry completed");
  assert.equal(postCount, 2);
  assert.equal(retries.length, 1);
  assert.match(retries[0].error, /ECONNRESET/);
  assert.equal(
    postHeaders[0]["Idempotency-Key"],
    "cola-task-retry-task-1",
  );
  assert.equal(
    postHeaders[1]["Idempotency-Key"],
    "cola-task-retry-task-1",
  );
});

void test("default task transport has an explicit long-running request timeout", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.setHeader("Content-Type", "application/json");
      response.end('{"status":"ok"}');
      return;
    }

    request.resume();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await assert.rejects(
      runHermesTaskViaApi(
        {
          apiBaseUrl: `http://127.0.0.1:${address.port}`,
          apiKey: "test-hermes-api-secret",
          prompt: "weekly report",
          taskId: "timeout-task-1",
        },
        {
          readinessAttempts: 1,
          requestAttempts: 1,
          requestTimeoutMs: 50,
        },
      ),
      /Hermes API Server 请求失败（1\/1）：Hermes API Server 请求超时/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

void test("large task requires the runner API key", async () => {
  await assert.rejects(
    runHermesTaskViaApi({
      apiBaseUrl: "http://127.0.0.1:8642",
      apiKey: "",
      prompt: "weekly report",
    }),
    /大型任务需要 API_SERVER_KEY/,
  );
});
