import assert from "node:assert/strict";
import test from "node:test";

import {
  notifyHermesTaskResultToFeishu,
  notifyHermesTaskResultToFeishuUser,
} from "./feishu-notifier.ts";

async function withEnv<T>(
  patch: Record<string, string | undefined>,
  callback: () => T | Promise<T>,
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

    return await callback();
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

function taskResultInput() {
  return {
    taskTitle: "整理发布摘要",
    taskSummary: "把任务执行结果发给负责人。",
    agentName: "Hermes",
    deviceName: "hermes-runner",
    status: "succeeded" as const,
    artifactPath: "/tmp/result",
    logPath: "/tmp/result/run.log",
    outputText: "已完成。",
  };
}

function stringifyFetchBody(body: BodyInit | null | undefined) {
  return typeof body === "string" ? body : "";
}

function requestUrlString(url: string | URL | Request) {
  return typeof url === "string"
    ? url
    : url instanceof URL
      ? url.toString()
      : url.url;
}

void test("Hermes group notification keeps webhook text content as object", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({
      url: requestUrlString(url),
      body: init?.body ? JSON.parse(stringifyFetchBody(init.body)) : null,
    });
    return new Response("{}", { status: 200 });
  };

  try {
    await withEnv(
      {
        COLA_HERMES_FEISHU_WEBHOOK_URL: "https://open.feishu.example/webhook",
        COLA_HERMES_FEISHU_WEBHOOK_SECRET: undefined,
      },
      () => notifyHermesTaskResultToFeishu(taskResultInput()),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.body, {
    msg_type: "text",
    content: {
      text: [
        "Hermes 任务执行成功",
        "人物：Hermes",
        "设备：hermes-runner",
        "任务：整理发布摘要",
        "说明：把任务执行结果发给负责人。",
        "结果：已完成。",
        "产物：/tmp/result",
        "日志：/tmp/result/run.log",
      ].join("\n"),
    },
  });
});

void test("Hermes group notification can mention recipient open_ids", async () => {
  const requests: Array<{ body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push({
      body: init?.body ? JSON.parse(stringifyFetchBody(init.body)) : null,
    });
    return new Response("{}", { status: 200 });
  };

  try {
    await withEnv(
      {
        COLA_HERMES_FEISHU_WEBHOOK_URL: "https://open.feishu.example/webhook",
        COLA_HERMES_FEISHU_WEBHOOK_SECRET: undefined,
      },
      () =>
        notifyHermesTaskResultToFeishu(taskResultInput(), [
          " ou_owner ",
          "ou_owner",
          "ou_reviewer",
        ]),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.body, {
    msg_type: "text",
    content: {
      text: [
        '<at user_id="ou_owner">通知人</at><at user_id="ou_reviewer">通知人</at>',
        "Hermes 任务执行成功",
        "人物：Hermes",
        "设备：hermes-runner",
        "任务：整理发布摘要",
        "说明：把任务执行结果发给负责人。",
        "结果：已完成。",
        "产物：/tmp/result",
        "日志：/tmp/result/run.log",
      ].join("\n"),
    },
  });
});

void test("Hermes user notification sends text message to open_id", async () => {
  const requests: Array<{
    url: string;
    body: unknown;
    authorization: string | null;
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const requestUrl = requestUrlString(url);
    requests.push({
      url: requestUrl,
      body: init?.body ? JSON.parse(stringifyFetchBody(init.body)) : null,
      authorization:
        init?.headers instanceof Headers
          ? init.headers.get("authorization")
          : ((init?.headers as Record<string, string> | undefined)
              ?.Authorization ?? null),
    });

    if (requestUrl.endsWith("/auth/v3/tenant_access_token/internal")) {
      return Response.json({
        code: 0,
        data: { tenant_access_token: "tenant-token" },
      });
    }

    return Response.json({
      code: 0,
      data: { message_id: "message-id" },
    });
  };

  try {
    await withEnv(
      {
        FEISHU_APP_ID: "app-id",
        FEISHU_APP_SECRET: "app-secret",
      },
      () => notifyHermesTaskResultToFeishuUser("ou_owner", taskResultInput()),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 2);
  assert.equal(
    requests[1]?.url,
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id",
  );
  assert.equal(requests[1]?.authorization, "Bearer tenant-token");
  assert.deepEqual(requests[1]?.body, {
    receive_id: "ou_owner",
    msg_type: "text",
    content: JSON.stringify({
      text: [
        "Hermes 任务执行成功",
        "人物：Hermes",
        "设备：hermes-runner",
        "任务：整理发布摘要",
        "说明：把任务执行结果发给负责人。",
        "结果：已完成。",
        "产物：/tmp/result",
        "日志：/tmp/result/run.log",
      ].join("\n"),
    }),
  });
});

void test("Hermes user notification explains missing Feishu bot ability", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = requestUrlString(url);
    if (requestUrl.endsWith("/auth/v3/tenant_access_token/internal")) {
      return Response.json({
        code: 0,
        data: { tenant_access_token: "tenant-token" },
      });
    }

    return Response.json({
      code: 99991672,
      msg: "Bot ability is not activated.",
    });
  };

  try {
    await assert.rejects(
      () =>
        withEnv(
          {
            FEISHU_APP_ID: "app-id",
            FEISHU_APP_SECRET: "app-secret",
          },
          () =>
            notifyHermesTaskResultToFeishuUser("ou_owner", taskResultInput()),
        ),
      /开启机器人能力.*im:message:send_as_bot.*发布版本/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
