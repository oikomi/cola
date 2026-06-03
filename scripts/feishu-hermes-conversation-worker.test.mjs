import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildArchiveMessage,
  buildConversationArchiveSummary,
  normalizeHistoryRows,
  parseCardActionValue,
  parseTextReviewAction,
  readExecutionOutput,
  sendArchiveText,
} from "./feishu-hermes-conversation-worker.mjs";

const taskId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

void test("parses Hermes result review card values", () => {
  assert.deepEqual(
    parseCardActionValue({
      source: "cola.hermes_task_result",
      action: "confirm",
      taskId,
      sessionId,
    }),
    {
      action: "confirm",
      taskId,
      sessionId,
    },
  );

  assert.equal(
    parseCardActionValue({
      source: "cola.hermes_task_result",
      action: "confirm",
      taskId: "not-a-uuid",
      sessionId,
    }),
    null,
  );
  assert.equal(
    parseCardActionValue({
      source: "other",
      action: "confirm",
      taskId,
      sessionId,
    }),
    null,
  );
});

void test("parses plain text review actions sent by Feishu buttons", () => {
  assert.equal(parseTextReviewAction("确认"), "confirm");
  assert.equal(parseTextReviewAction(" 确认。 "), "confirm");
  assert.equal(parseTextReviewAction("不认可"), "reject");
  assert.equal(parseTextReviewAction("不通过！"), "reject");
  assert.equal(parseTextReviewAction("确认一下最新状态"), null);
  assert.equal(parseTextReviewAction("继续检查"), null);
});

void test("normalizes stored Feishu conversation messages", () => {
  assert.deepEqual(
    normalizeHistoryRows([
      { payload: { role: "user", content: "请再检查一次" } },
      { payload: { role: "assistant", content: "已经复核完成" } },
      { payload: { role: "assistant", content: "   " } },
      { payload: { role: "system", content: "fallback role" } },
    ]),
    [
      { role: "user", content: "请再检查一次" },
      { role: "assistant", content: "已经复核完成" },
      { role: "user", content: "fallback role" },
    ],
  );
});

void test("reads Hermes execution output from last-result artifact", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cola-hermes-result-"));
  try {
    fs.writeFileSync(
      path.join(tmpDir, "last-result.json"),
      JSON.stringify({
        result: {
          outputs: [{ text: "归档用执行结果" }],
          stdout: "stdout fallback",
        },
      }),
    );

    assert.equal(readExecutionOutput(tmpDir), "归档用执行结果");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test("builds archive message with task result and conversation history", () => {
  const message = buildArchiveMessage(
    {
      event: {
        session_id: sessionId,
        task_title: "定时分析代码仓库",
        task_summary: "每 10 分钟检查仓库并输出灯光 CSV。",
        device_name: "test334333 Runner",
        artifact_path: "/workspace/state-to-light/.hermes-runner",
        log_path: "/workspace/state-to-light/.hermes-runner/bootstrap.log",
      },
      history: [
        { payload: { role: "user", content: "这次结果没问题吗？" } },
        { payload: { role: "assistant", content: "已复核，没有阻塞问题。" } },
      ],
      outputText: "完成。已检查仓库并生成四列灯光 CSV。",
    },
    {
      action: "confirm",
      taskId,
      sessionId,
      chatId: "oc_chat",
      messageId: "om_message",
      operatorOpenId: "ou_user",
      operatorName: "测试用户",
    },
  );

  assert.match(message, /Hermes 任务已确认并归档/);
  assert.match(message, /确认人：测试用户/);
  assert.match(message, /任务：定时分析代码仓库/);
  assert.match(message, /执行结果摘要：\n完成。已检查仓库并生成四列灯光 CSV。/);
  assert.match(message, /多轮对话总结：/);
  assert.match(message, /用户核心诉求：/);
  assert.match(message, /Hermes 处理结论：/);
  assert.match(message, /最终确认：用户已确认通过/);
  assert.match(message, /关键对话摘录：/);
  assert.match(message, /1\. 用户：这次结果没问题吗？/);
  assert.match(message, /2\. Hermes：已复核，没有阻塞问题。/);
  assert.match(
    message,
    /日志：\/workspace\/state-to-light\/.hermes-runner\/bootstrap.log/,
  );
});

void test("summarizes multi-turn archive conversations", () => {
  const summary = buildConversationArchiveSummary(
    [
      { payload: { role: "user", content: "不够详细" } },
      {
        payload: {
          role: "assistant",
          content: "已补充最近一个月的进度分析和关键提交。",
        },
      },
      { payload: { role: "user", content: "确认" } },
    ],
    { action: "confirm" },
  );

  assert.match(summary, /对话规模：用户 2 条，Hermes 1 条/);
  assert.match(summary, /用户核心诉求：/);
  assert.match(summary, /Hermes 处理结论：/);
  assert.match(summary, /最终确认：用户已确认通过/);
});

void test("broadcasts archive text to all bot group chats", async () => {
  const sent = [];
  const client = {
    im: {
      v1: {
        chat: {
          list: async ({ params }) => ({
            code: 0,
            data: {
              items:
                params.page_token === "next"
                  ? [{ chat_id: "oc_group_2", name: "test2" }]
                  : [
                      { chat_id: "oc_group_1", name: "test1" },
                      {
                        chat_id: "oc_dissolved",
                        name: "old",
                        chat_status: "dissolved",
                      },
                    ],
              has_more: !params.page_token,
              page_token: !params.page_token ? "next" : undefined,
            },
          }),
        },
        message: {
          create: async ({ data }) => {
            sent.push(data);
            return { code: 0 };
          },
        },
      },
    },
  };

  const delivery = await sendArchiveText(client, "oc_source", "归档总结");

  assert.deepEqual(
    sent.map((message) => message.receive_id),
    ["oc_group_1", "oc_group_2", "oc_source"],
  );
  assert.deepEqual(delivery.targetChatIds, ["oc_group_1", "oc_group_2"]);
  assert.deepEqual(delivery.failures, []);
  assert.equal(JSON.parse(sent[0].content).text, "归档总结");
  assert.match(JSON.parse(sent[2].content).text, /已发送到 2 个机器人所在群/);
});

void test("falls back to known group chats when bot chat list is denied", async () => {
  const sent = [];
  const sql = async (strings) => {
    assert.match(String(strings[0]), /from cola_event/);
    return [
      { payload: { chatType: "group", chatId: "oc_known_group" } },
      {
        payload: {
          feishu: {
            notificationMessages: [{ chatId: "oc_notified_group" }],
          },
        },
      },
    ];
  };
  const client = {
    im: {
      v1: {
        chat: {
          list: async () => {
            const error = new Error("Request failed with status code 400");
            error.response = {
              data: {
                code: 99991672,
                msg: "Access denied. One of the following scopes is required: [im:chat:readonly]",
              },
            };
            throw error;
          },
        },
        message: {
          create: async ({ data }) => {
            sent.push(data);
            return { code: 0 };
          },
        },
      },
    },
  };

  const delivery = await sendArchiveText(client, "oc_source", "归档总结", {
    sql,
  });

  assert.deepEqual(
    sent.map((message) => message.receive_id),
    ["oc_known_group", "oc_notified_group", "oc_source"],
  );
  assert.deepEqual(delivery.targetChatIds, [
    "oc_known_group",
    "oc_notified_group",
  ]);
  assert.match(delivery.failures[0], /99991672: Access denied/);
  assert.match(JSON.parse(sent[2].content).text, /发送失败明细/);
});
