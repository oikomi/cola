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

type FeishuApiResponse<T> = {
  code?: number;
  msg?: string;
  data?: T;
} & Partial<T>;

type TenantAccessTokenData = {
  tenant_access_token?: string;
  expire?: number;
};

type SendMessageData = {
  message_id?: string;
};

const FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn/open-apis";

function trimEnv(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function escapeFeishuAtText(value: string) {
  return value.replace(/[<&>]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      default:
        return char;
    }
  });
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

function resolveFeishuAppCredentials() {
  const appId = trimEnv(process.env.FEISHU_APP_ID);
  const appSecret = trimEnv(process.env.FEISHU_APP_SECRET);
  if (!appId || !appSecret) {
    const missing = [
      appId ? null : "FEISHU_APP_ID",
      appSecret ? null : "FEISHU_APP_SECRET",
    ].filter((key): key is string => Boolean(key));
    throw new Error(`飞书个人通知缺少环境变量：${missing.join(", ")}。`);
  }

  return { appId, appSecret };
}

function uniqueOpenIds(openIds: string[]) {
  return Array.from(new Set(openIds));
}

function normalizeOpenIds(openIds: string[]) {
  return uniqueOpenIds(openIds.map((openId) => openId.trim())).filter(Boolean);
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

function buildHermesTaskResultText(input: HermesTaskResultNotificationInput) {
  return [
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
}

function buildFeishuAtText(openIds: string[]) {
  const recipientOpenIds = normalizeOpenIds(openIds);
  if (recipientOpenIds.length === 0) return null;

  return recipientOpenIds
    .map((openId) => `<at user_id="${escapeFeishuAtText(openId)}">通知人</at>`)
    .join("");
}

function enhanceFeishuMessageError(message: string) {
  if (
    message.includes("Bot ability is not activated") ||
    message.includes("im:message:send") ||
    message.includes("im:message:send_as_bot")
  ) {
    return `${message}。请在飞书开放平台为当前应用开启机器人能力，申请 im:message:send_as_bot（或 im:message / im:message:send）权限，并发布版本；同时确认接收人在应用机器人的可用范围内。`;
  }

  return message;
}

async function postFeishu<T>(
  path: string,
  body: unknown,
  headers: HeadersInit = {},
) {
  const response = await fetch(`${FEISHU_OPEN_API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as FeishuApiResponse<T>;

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg ?? `飞书接口请求失败：HTTP ${response.status}`);
  }

  return (payload.data ?? payload) as T;
}

async function getTenantAccessToken() {
  const credentials = resolveFeishuAppCredentials();

  const data = await postFeishu<TenantAccessTokenData>(
    "/auth/v3/tenant_access_token/internal",
    {
      app_id: credentials.appId,
      app_secret: credentials.appSecret,
    },
  );

  if (!data.tenant_access_token) {
    throw new Error("飞书没有返回 tenant_access_token。");
  }

  return data.tenant_access_token;
}

export async function notifyHermesTaskResultToFeishu(
  input: HermesTaskResultNotificationInput,
  mentionOpenIds: string[] = [],
) {
  if (!["succeeded", "failed", "canceled"].includes(input.status)) {
    return;
  }

  const webhookUrl = resolveFeishuWebhookUrl();
  if (!webhookUrl) return;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = resolveFeishuWebhookSecret();
  const mentionText = buildFeishuAtText(mentionOpenIds);
  const content = [mentionText, buildHermesTaskResultText(input)]
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

export async function notifyHermesTaskResultToFeishuUser(
  openId: string | string[] | null | undefined,
  input: HermesTaskResultNotificationInput,
) {
  const openIds = Array.isArray(openId) ? openId : openId ? [openId] : [];

  if (openIds.length === 0) {
    return;
  }

  await notifyHermesTaskResultToFeishuUsers(openIds, input);
}

export async function notifyHermesTaskResultToFeishuUsers(
  openIds: string[],
  input: HermesTaskResultNotificationInput,
) {
  const recipientOpenIds = uniqueOpenIds(
    openIds.map((openId) => openId.trim()),
  ).filter(Boolean);

  if (
    recipientOpenIds.length === 0 ||
    !["succeeded", "failed", "canceled"].includes(input.status)
  ) {
    return;
  }

  const tenantAccessToken = await getTenantAccessToken();

  const text = buildHermesTaskResultText(input);
  const failures: string[] = [];

  for (const openId of recipientOpenIds) {
    try {
      await postFeishu<SendMessageData>(
        "/im/v1/messages?receive_id_type=open_id",
        {
          receive_id: openId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
        {
          Authorization: `Bearer ${tenantAccessToken}`,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      failures.push(`${openId}: ${enhanceFeishuMessageError(message)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`飞书个人通知发送失败：${failures.join("；")}`);
  }
}
