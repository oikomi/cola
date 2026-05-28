import { createHmac } from "node:crypto";

import type { SessionStatus } from "@/server/office/catalog";

type HermesTaskResultNotificationInput = {
  taskTitle: string;
  taskSummary: string | null;
  agentName: string | null;
  deviceName: string;
  status: SessionStatus;
  artifactPath: string | null;
  logPath: string | null;
  outputText: string | null;
};

function trimEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveFeishuWebhookUrl() {
  return (
    trimEnv(process.env.COLA_HERMES_FEISHU_WEBHOOK_URL) ??
    trimEnv(process.env.FEISHU_BOT_WEBHOOK_URL)
  );
}

function resolveFeishuWebhookSecret() {
  return (
    trimEnv(process.env.COLA_HERMES_FEISHU_WEBHOOK_SECRET) ??
    trimEnv(process.env.FEISHU_BOT_WEBHOOK_SECRET)
  );
}

function signFeishuWebhook(timestamp: string, secret: string) {
  return createHmac("sha256", `${timestamp}\n${secret}`)
    .update("")
    .digest("base64");
}

function statusText(status: SessionStatus) {
  switch (status) {
    case "succeeded":
      return "执行成功";
    case "failed":
      return "执行失败";
    case "canceled":
      return "已取消";
    case "running":
      return "执行中";
    case "starting":
      return "启动中";
    default:
      return "等待中";
  }
}

function compactText(value: string | null | undefined, maxLength: number) {
  if (!value) return "无";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "无";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export async function notifyHermesTaskResultToFeishu(
  input: HermesTaskResultNotificationInput,
) {
  if (!["succeeded", "failed", "canceled"].includes(input.status)) {
    return;
  }

  const webhookUrl = resolveFeishuWebhookUrl();
  if (!webhookUrl) return;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = resolveFeishuWebhookSecret();
  const content = [
    `Hermes 任务${statusText(input.status)}`,
    `人物：${input.agentName ?? "未绑定人物"}`,
    `设备：${input.deviceName}`,
    `任务：${input.taskTitle}`,
    `说明：${compactText(input.taskSummary, 240)}`,
    `结果：${compactText(input.outputText, 900)}`,
    input.artifactPath ? `产物：${input.artifactPath}` : null,
    input.logPath ? `日志：${input.logPath}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(secret
        ? {
            timestamp,
            sign: signFeishuWebhook(timestamp, secret),
          }
        : {}),
      msg_type: "text",
      content: {
        text: content,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`飞书群通知发送失败：HTTP ${response.status}`);
  }
}
