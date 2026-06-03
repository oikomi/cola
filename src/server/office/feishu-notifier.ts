import { createHmac } from "node:crypto";

import type { SessionStatus } from "./catalog.ts";
import { extractFeishuDocumentReferences } from "./feishu-docs.ts";

type HermesTaskResultNotificationInput = {
  taskId?: string;
  sessionId?: string;
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
  chat_id?: string;
  message_id?: string;
};

export type FeishuUserNotificationMessage = {
  openId: string;
  chatId: string | null;
  messageId: string | null;
};

const FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn/open-apis";
const RESULT_PREVIEW_MAX_LENGTH = 560;

type FeishuCardText = {
  tag: "plain_text" | "lark_md";
  content: string;
};

type FeishuCardButton = {
  tag: "button";
  text: FeishuCardText;
  type: "default" | "primary" | "danger";
  url?: string;
  value?: Record<string, unknown>;
};

type FeishuCardElement =
  | {
      tag: "div";
      text: FeishuCardText;
    }
  | {
      tag: "hr";
    }
  | {
      tag: "note";
      elements: FeishuCardText[];
    }
  | {
      tag: "action";
      actions: FeishuCardButton[];
      layout?: "bisected" | "trisection" | "flow";
    };

type FeishuCard = {
  config: {
    wide_screen_mode: boolean;
  };
  header: {
    template: "green" | "red" | "grey" | "orange" | "blue";
    title: FeishuCardText;
  };
  elements: FeishuCardElement[];
};

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

function stripFeishuDocumentUrls(value: string | null | undefined) {
  if (!value) return value;
  return extractFeishuDocumentReferences(value).reduce(
    (current, document) => current.replaceAll(document.url, "[飞书文档链接]"),
    value,
  );
}

function normalizeResultText(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\r\n?/g, "\n").trim();
}

function hasLongResult(input: HermesTaskResultNotificationInput) {
  const outputText = normalizeResultText(input.outputText);
  return outputText.length > RESULT_PREVIEW_MAX_LENGTH;
}

function cardTemplate(status: SessionStatus): FeishuCard["header"]["template"] {
  switch (status) {
    case "succeeded":
      return "green";
    case "failed":
      return "red";
    case "canceled":
      return "grey";
    case "running":
      return "blue";
    case "starting":
      return "orange";
    default:
      return "grey";
  }
}

function cardText(content: string, tag: FeishuCardText["tag"] = "lark_md") {
  return { tag, content } satisfies FeishuCardText;
}

function buildHermesTaskResultCard(
  input: HermesTaskResultNotificationInput,
  mentionOpenIds: string[] = [],
  options: { includeReviewActions?: boolean } = {},
): FeishuCard {
  const longResult = hasLongResult(input);
  const mentionText = buildFeishuAtText(mentionOpenIds);
  const documentReferences = extractFeishuDocumentReferences(input.taskSummary);
  const actions: FeishuCardButton[] = documentReferences
    .slice(0, 1)
    .map((document) => ({
      tag: "button",
      text: cardText("打开飞书文档", "plain_text"),
      type: "primary",
      url: document.url,
    }));
  const reviewActions = buildHermesTaskReviewActions(input, options);
  const summaryText = compactText(
    stripFeishuDocumentUrls(input.taskSummary),
    260,
  );
  const resultText = longResult
    ? [
        `**结果摘要**：${compactText(input.outputText, RESULT_PREVIEW_MAX_LENGTH)}`,
        "**完整结果**：内容较长，飞书里只展示摘要；请查看下方产物或日志。",
      ].join("\n")
    : `**结果**：${compactText(input.outputText, RESULT_PREVIEW_MAX_LENGTH)}`;
  const metaLines = [
    `**人物**：${input.agentName ?? "未绑定人物"}`,
    `**设备**：${input.deviceName}`,
    `**任务**：${input.taskTitle}`,
    `**说明**：${summaryText}`,
  ];
  const pathLines = [
    input.artifactPath ? `产物：${input.artifactPath}` : null,
    input.logPath ? `日志：${input.logPath}` : null,
  ].filter((line): line is string => Boolean(line));
  const elements: FeishuCardElement[] = [
    ...(mentionText
      ? [
          {
            tag: "div" as const,
            text: cardText(mentionText),
          },
        ]
      : []),
    {
      tag: "div",
      text: cardText(metaLines.join("\n")),
    },
    {
      tag: "hr",
    },
    {
      tag: "div",
      text: cardText(resultText),
    },
    ...(actions.length > 0
      ? [
          {
            tag: "action" as const,
            actions,
          },
        ]
      : []),
    ...(reviewActions.length > 0
      ? [
          {
            tag: "action" as const,
            layout: "bisected" as const,
            actions: reviewActions,
          },
        ]
      : []),
    ...(pathLines.length > 0
      ? [
          {
            tag: "note" as const,
            elements: [cardText(pathLines.join("\n"))],
          },
        ]
      : []),
  ];

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: cardTemplate(input.status),
      title: cardText(`Hermes 任务${statusText(input.status)}`, "plain_text"),
    },
    elements,
  };
}

function buildHermesTaskReviewActions(
  input: HermesTaskResultNotificationInput,
  options: { includeReviewActions?: boolean },
) {
  if (
    !options.includeReviewActions ||
    input.status !== "succeeded" ||
    !input.taskId ||
    !input.sessionId
  ) {
    return [];
  }

  const actionValue = {
    source: "cola.hermes_task_result",
    taskId: input.taskId,
    sessionId: input.sessionId,
  };

  return [
    {
      tag: "button" as const,
      text: cardText("确认", "plain_text"),
      type: "primary" as const,
      value: {
        ...actionValue,
        action: "confirm",
      },
    },
    {
      tag: "button" as const,
      text: cardText("不认可", "plain_text"),
      type: "default" as const,
      value: {
        ...actionValue,
        action: "reject",
      },
    },
  ];
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

async function sendFeishuUserCard(
  openId: string,
  card: FeishuCard,
  tenantAccessToken: string,
) {
  return postFeishu<SendMessageData>(
    "/im/v1/messages?receive_id_type=open_id",
    {
      receive_id: openId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    },
    {
      Authorization: `Bearer ${tenantAccessToken}`,
    },
  );
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
  const card = buildHermesTaskResultCard(input, mentionOpenIds, {
    includeReviewActions: true,
  });

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
      msg_type: "interactive",
      card,
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
    return [];
  }

  return notifyHermesTaskResultToFeishuUsers(openIds, input);
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
    return [];
  }

  const tenantAccessToken = await getTenantAccessToken();

  const card = buildHermesTaskResultCard(input);
  const failures: string[] = [];
  const sentMessages: FeishuUserNotificationMessage[] = [];

  for (const openId of recipientOpenIds) {
    try {
      const sentMessage = await sendFeishuUserCard(
        openId,
        card,
        tenantAccessToken,
      );
      sentMessages.push({
        openId,
        chatId: sentMessage.chat_id ?? null,
        messageId: sentMessage.message_id ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      failures.push(`${openId}: ${enhanceFeishuMessageError(message)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`飞书个人通知发送失败：${failures.join("；")}`);
  }

  return sentMessages;
}
