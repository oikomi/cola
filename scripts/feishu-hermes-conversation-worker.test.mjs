import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildArchiveMessage,
  normalizeHistoryRows,
  parseCardActionValue,
  readExecutionOutput,
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
  assert.match(message, /1\. 用户：这次结果没问题吗？/);
  assert.match(message, /2\. Hermes：已复核，没有阻塞问题。/);
  assert.match(message, /日志：\/workspace\/state-to-light\/.hermes-runner\/bootstrap.log/);
});
