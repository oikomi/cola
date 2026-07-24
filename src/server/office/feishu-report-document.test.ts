import assert from "node:assert/strict";
import test from "node:test";

import {
  createFeishuDocumentFromMarkdown,
  prepareFeishuReportMarkdown,
} from "./feishu-docs.ts";

function feishuResponse(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status >= 400
        ? { code: 999, msg: "permission denied" }
        : { code: 0, msg: "success", data },
    ),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

function requestUrlString(input: string | URL | Request) {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  return typeof body === "string" ? (JSON.parse(body) as unknown) : null;
}

void test("Feishu report preparation converts tables and clips at Markdown boundaries", () => {
  const prepared = prepareFeishuReportMarkdown(
    [
      "# 团队工作周报",
      "",
      "| 项目 | 提交 |",
      "|---|---:|",
      "| [alpha](https://code.example.com/alpha) | 12 |",
      "| [beta](https://code.example.com/beta) | 4 |",
      "",
      "## 成员工作情况",
      "",
      ...Array.from(
        { length: 20 },
        (_, index) => `- 成员 ${index + 1}：完成一项有证据的交付。`,
      ),
    ].join("\n"),
    260,
  );

  assert.equal(prepared.tablesConverted, 1);
  assert.equal(prepared.truncated, true);
  assert.ok(prepared.markdown.length <= 260);
  assert.doesNotMatch(prepared.markdown, /\|---\|/);
  assert.match(
    prepared.markdown,
    /- 项目：\[alpha\]\(https:\/\/code\.example\.com\/alpha\)；提交：12/,
  );
  assert.match(prepared.markdown, /报告已按飞书文档写入上限精简/);
});

void test("weekly report Markdown is converted into a shared Feishu document", async () => {
  const originalAppId = process.env.FEISHU_APP_ID;
  const originalAppSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID = "cli_test";
  process.env.FEISHU_APP_SECRET = "secret_test";
  const requests: Array<{ body: unknown; url: string }> = [];

  try {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = requestUrlString(input);
      const body = parseRequestBody(init?.body);
      requests.push({ url, body });

      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return feishuResponse({ tenant_access_token: "tenant-token" });
      }
      if (url.endsWith("/docx/v1/documents")) {
        return feishuResponse({
          document: { document_id: "docx-token", title: "团队工作周报" },
        });
      }
      if (url.endsWith("/docx/v1/documents/blocks/convert")) {
        return feishuResponse({
          first_level_block_ids: ["tmp-heading"],
          blocks: [
            {
              block_id: "tmp-heading",
              block_type: 3,
              heading1: {
                elements: [{ text_run: { content: "总体进展" } }],
              },
            },
          ],
        });
      }
      if (url.includes("/descendant?")) return feishuResponse({});
      if (url.includes("/members/batch_create?")) return feishuResponse({});
      return new Response("not found", { status: 404 });
    };

    const document = await createFeishuDocumentFromMarkdown(
      {
        title: "团队工作周报",
        markdown:
          "# 总体进展\n\n| 项目 | 结果 |\n|---|---|\n| cola | 完成任务队列优化 |",
        viewerOpenIds: ["ou_owner", "ou_owner", "ou_reviewer"],
      },
      { fetchImpl },
    );

    assert.deepEqual(document, {
      documentId: "docx-token",
      title: "团队工作周报",
      url: "https://feishu.cn/docx/docx-token",
      warnings: ["为兼容飞书文档，已将 1 个 Markdown 表格转换为列表。"],
    });
    assert.deepEqual(
      requests.find((request) => request.url.includes("/blocks/convert"))?.body,
      {
        content_type: "markdown",
        content: "# 总体进展\n\n- 项目：cola；结果：完成任务队列优化",
      },
    );
    assert.deepEqual(
      requests.find((request) => request.url.includes("/members/batch_create"))
        ?.body,
      {
        members: [
          { member_type: "openid", member_id: "ou_owner", perm: "view" },
          { member_type: "openid", member_id: "ou_reviewer", perm: "view" },
        ],
      },
    );
  } finally {
    if (originalAppId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = originalAppId;
    if (originalAppSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = originalAppSecret;
  }
});

void test("document creation reports viewer permission failures without losing the link", async () => {
  const originalAppId = process.env.FEISHU_APP_ID;
  const originalAppSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID = "cli_test";
  process.env.FEISHU_APP_SECRET = "secret_test";

  try {
    const fetchImpl: typeof fetch = async (input) => {
      const url = requestUrlString(input);
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return feishuResponse({ tenant_access_token: "tenant-token" });
      }
      if (url.endsWith("/docx/v1/documents")) {
        return feishuResponse({ document: { document_id: "docx-token" } });
      }
      if (url.endsWith("/docx/v1/documents/blocks/convert")) {
        return feishuResponse({
          first_level_block_ids: ["tmp-text"],
          blocks: [{ block_id: "tmp-text", block_type: 2, text: {} }],
        });
      }
      if (url.includes("/descendant?")) return feishuResponse({});
      if (url.includes("/members/batch_create?")) {
        return feishuResponse({}, 403);
      }
      return new Response("not found", { status: 404 });
    };

    const document = await createFeishuDocumentFromMarkdown(
      {
        title: "团队工作周报",
        markdown: "周报正文",
        viewerOpenIds: ["ou_owner"],
      },
      { fetchImpl },
    );

    assert.equal(document.url, "https://feishu.cn/docx/docx-token");
    assert.match(document.warnings[0] ?? "", /权限添加失败/);
    assert.match(
      document.warnings[0] ?? "",
      /添加飞书文档查看权限失败：permission denied（code=999）/,
    );
  } finally {
    if (originalAppId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = originalAppId;
    if (originalAppSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = originalAppSecret;
  }
});
