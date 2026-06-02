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

function taskResultInputWithDocumentLink() {
  return {
    ...taskResultInput(),
    taskSummary:
      "读取分析 https://example.feishu.cn/wiki/wiki-token 并输出重点。",
  };
}

function longTaskResultInput() {
  return {
    ...taskResultInput(),
    outputText: [
      "第一部分：周报总体判断。",
      "A".repeat(3200),
      "第二部分：风险和建议。",
    ].join("\n"),
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

function recordBody<T>(body: unknown) {
  assert.ok(body && typeof body === "object" && !Array.isArray(body));
  return body as T;
}

void test("Hermes group notification sends an interactive card", async () => {
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
      () => notifyHermesTaskResultToFeishu(taskResultInputWithDocumentLink()),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  const body = recordBody<{
    msg_type: string;
    card: {
      header: { template: string; title: { content: string } };
      elements: Array<{
        tag: string;
        text?: { content: string };
        actions?: Array<{ url: string; text: { content: string } }>;
      }>;
    };
  }>(requests[0]?.body);

  assert.equal(body.msg_type, "interactive");
  assert.equal(body.card.header.template, "green");
  assert.equal(body.card.header.title.content, "Hermes 任务执行成功");
  assert.match(body.card.elements[0]?.text?.content ?? "", /人物.*Hermes/);
  assert.match(body.card.elements[0]?.text?.content ?? "", /\[飞书文档链接\]/);
  assert.doesNotMatch(
    body.card.elements[0]?.text?.content ?? "",
    /https:\/\/example\.feishu\.cn\/wiki/,
  );
  assert.equal(body.card.elements[3]?.actions?.[0]?.text.content, "打开飞书文档");
  assert.equal(
    body.card.elements[3]?.actions?.[0]?.url,
    "https://example.feishu.cn/wiki/wiki-token",
  );
});

void test("Hermes group notification card can mention recipient open_ids", async () => {
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
  const body = recordBody<{
    msg_type: string;
    card: { elements: Array<{ text?: { content: string } }> };
  }>(requests[0]?.body);

  assert.equal(body.msg_type, "interactive");
  assert.equal(
    body.card.elements[0]?.text?.content,
    '<at user_id="ou_owner">通知人</at><at user_id="ou_reviewer">通知人</at>',
  );
});

void test("Hermes user notification sends interactive card to open_id", async () => {
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
  const body = recordBody<{
    receive_id: string;
    msg_type: string;
    content: string;
  }>(requests[1]?.body);
  const card = JSON.parse(body.content) as {
    header: { title: { content: string } };
    elements: Array<{ text?: { content: string } }>;
  };

  assert.equal(body.receive_id, "ou_owner");
  assert.equal(body.msg_type, "interactive");
  assert.equal(card.header.title.content, "Hermes 任务执行成功");
  assert.match(card.elements[0]?.text?.content ?? "", /任务.*整理发布摘要/);
});

void test("Hermes user notification keeps long result inside a compact card summary", async () => {
  const requests: Array<{
    url: string;
    body: unknown;
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const requestUrl = requestUrlString(url);
    requests.push({
      url: requestUrl,
      body: init?.body ? JSON.parse(stringifyFetchBody(init.body)) : null,
    });

    if (requestUrl.endsWith("/auth/v3/tenant_access_token/internal")) {
      return Response.json({
        code: 0,
        data: { tenant_access_token: "tenant-token" },
      });
    }

    return Response.json({
      code: 0,
      data: { message_id: `message-${requests.length}` },
    });
  };

  try {
    await withEnv(
      {
        FEISHU_APP_ID: "app-id",
        FEISHU_APP_SECRET: "app-secret",
      },
      () =>
        notifyHermesTaskResultToFeishuUser("ou_owner", longTaskResultInput()),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const messageRequests = requests.filter((request) =>
    request.url.includes("/im/v1/messages"),
  );

  assert.equal(messageRequests.length, 1);

  const firstCard = JSON.parse(
    recordBody<{ content: string }>(messageRequests[0]?.body).content,
  ) as { elements: Array<{ text?: { content: string } }> };
  assert.match(firstCard.elements[2]?.text?.content ?? "", /结果摘要/);
  assert.match(
    firstCard.elements[2]?.text?.content ?? "",
    /完整结果.*请查看下方产物或日志/,
  );
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
