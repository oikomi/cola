import assert from "node:assert/strict";
import test from "node:test";

import {
  extractFeishuDocumentReferences,
  loadFeishuDocumentContext,
  readFeishuDocumentReferences,
} from "./feishu-docs.ts";

void test("extracts Feishu wiki and docx links from task text", () => {
  const references = extractFeishuDocumentReferences(
    [
      "请阅读 https://tcnwhpxcbxef.feishu.cn/wiki/VkLOw4tFaiwxVrkxw2kcYtThnur",
      "以及 https://tcnwhpxcbxef.feishu.cn/docx/AbcdEfghIjklMnop?from=from_copylink。",
    ].join("\n"),
  );

  assert.deepEqual(references, [
    {
      type: "wiki",
      token: "VkLOw4tFaiwxVrkxw2kcYtThnur",
      url: "https://tcnwhpxcbxef.feishu.cn/wiki/VkLOw4tFaiwxVrkxw2kcYtThnur",
    },
    {
      type: "docx",
      token: "AbcdEfghIjklMnop",
      url: "https://tcnwhpxcbxef.feishu.cn/docx/AbcdEfghIjklMnop?from=from_copylink",
    },
  ]);
});

void test("prefers stored Feishu document references over fallback text", () => {
  const references = readFeishuDocumentReferences(
    {
      feishu: {
        documents: [
          {
            type: "wiki",
            token: "stored-token",
            url: "https://example.feishu.cn/wiki/stored-token",
          },
        ],
      },
    },
    "https://example.feishu.cn/docx/fallback-token",
  );

  assert.deepEqual(references, [
    {
      type: "wiki",
      token: "stored-token",
      url: "https://example.feishu.cn/wiki/stored-token",
    },
  ]);
});

void test("loads Feishu wiki document content through OpenAPI calls", async () => {
  const originalFetch = globalThis.fetch;
  const originalAppId = process.env.FEISHU_APP_ID;
  const originalAppSecret = process.env.FEISHU_APP_SECRET;
  const requestedUrls: string[] = [];

  process.env.FEISHU_APP_ID = "cli_test";
  process.env.FEISHU_APP_SECRET = "secret_test";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    requestedUrls.push(url);

    if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
      return Response.json({
        code: 0,
        tenant_access_token: "tenant-token",
      });
    }

    if (url.includes("/wiki/v2/spaces/get_node")) {
      return Response.json({
        code: 0,
        data: {
          node: {
            obj_token: "docx-token",
            obj_type: "docx",
            title: "周报",
          },
        },
      });
    }

    if (url.endsWith("/docx/v1/documents/docx-token/raw_content")) {
      return Response.json({
        code: 0,
        data: {
          content: "这里是飞书文档正文。",
        },
      });
    }

    return Response.json({ code: 999, msg: "unexpected url" });
  }) as typeof fetch;

  try {
    const result = await loadFeishuDocumentContext([
      {
        type: "wiki",
        token: "wiki-token",
        url: "https://example.feishu.cn/wiki/wiki-token",
      },
    ]);

    assert.deepEqual(result.warnings, []);
    assert.equal(result.documents[0]?.title, "周报");
    assert.equal(result.documents[0]?.content, "这里是飞书文档正文。");
    assert.ok(
      requestedUrls.some((url) => url.includes("/wiki/v2/spaces/get_node")),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAppId === undefined) {
      delete process.env.FEISHU_APP_ID;
    } else {
      process.env.FEISHU_APP_ID = originalAppId;
    }

    if (originalAppSecret === undefined) {
      delete process.env.FEISHU_APP_SECRET;
    } else {
      process.env.FEISHU_APP_SECRET = originalAppSecret;
    }
  }
});
