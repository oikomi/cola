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

type FeishuAppCredentials = {
  appId: string;
  appSecret: string;
};

type FeishuChatListData = {
  items?: Array<{
    chat_id?: string;
    chat_status?: string;
  }>;
  has_more?: boolean;
  page_token?: string;
};

export type FeishuUserNotificationMessage = {
  openId: string;
  chatId: string | null;
  messageId: string | null;
};

const FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn/open-apis";
const FEISHU_CHAT_LIST_PAGE_SIZE = 100;

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

type FeishuTemplateCardContent = {
  type: "template";
  data: {
    template_id: string;
    template_variable: Record<string, unknown>;
  };
};

type FeishuInteractiveContent = FeishuCard | FeishuTemplateCardContent;

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

function resolveFeishuCardTemplateId() {
  return (
    trimEnv(process.env.COLA_HERMES_FEISHU_CARD_TEMPLATE_ID) ??
    trimEnv(process.env.FEISHU_CARD_TEMPLATE_ID)
  );
}

function readFeishuAppCredentials(): FeishuAppCredentials | null {
  const appId = trimEnv(process.env.FEISHU_APP_ID);
  const appSecret = trimEnv(process.env.FEISHU_APP_SECRET);
  if (!appId || !appSecret) return null;

  return { appId, appSecret };
}

function resolveFeishuAppCredentials(): FeishuAppCredentials {
  const credentials = readFeishuAppCredentials();
  if (credentials) return credentials;

  const missing = [
    trimEnv(process.env.FEISHU_APP_ID) ? null : "FEISHU_APP_ID",
    trimEnv(process.env.FEISHU_APP_SECRET) ? null : "FEISHU_APP_SECRET",
  ].filter((key): key is string => Boolean(key));

  throw new Error(`飞书个人通知缺少环境变量：${missing.join(", ")}。`);
}

function uniqueOpenIds(openIds: string[]) {
  return Array.from(new Set(openIds));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
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
  const outputText = normalizeResultText(input.outputText);
  const resultText = `**完整结果**：\n${outputText || "无"}`;
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

function buildHermesTaskTemplateVariables(
  input: HermesTaskResultNotificationInput,
  mentionOpenIds: string[] = [],
) {
  const documentReferences = extractFeishuDocumentReferences(input.taskSummary);
  const documentUrl = documentReferences[0]?.url ?? "";
  const summaryText = compactText(
    stripFeishuDocumentUrls(input.taskSummary),
    1200,
  );
  const outputText = normalizeResultText(input.outputText) || "无";
  const pathLines = [
    input.artifactPath ? `产物：${input.artifactPath}` : null,
    input.logPath ? `日志：${input.logPath}` : null,
  ].filter((line): line is string => Boolean(line));

  return {
    title: `Hermes 任务${statusText(input.status)}`,
    status: statusText(input.status),
    task_title: input.taskTitle,
    task_summary: summaryText,
    agent_name: input.agentName ?? "未绑定人物",
    device_name: input.deviceName,
    output_text: outputText,
    artifact_path: input.artifactPath ?? "",
    log_path: input.logPath ?? "",
    path_text: pathLines.join("\n"),
    document_url: documentUrl,
    mention_text: buildFeishuAtText(mentionOpenIds) ?? "",
    rows: [
      {
        name: input.agentName ?? input.deviceName,
        progress: outputText,
      },
    ],
  };
}

function buildHermesTaskResultContent(
  input: HermesTaskResultNotificationInput,
  mentionOpenIds: string[] = [],
  options: { includeReviewActions?: boolean } = {},
): FeishuInteractiveContent {
  const templateId = resolveFeishuCardTemplateId();

  if (templateId) {
    return {
      type: "template",
      data: {
        template_id: templateId,
        template_variable: buildHermesTaskTemplateVariables(
          input,
          mentionOpenIds,
        ),
      },
    };
  }

  return buildHermesTaskResultCard(input, mentionOpenIds, options);
}

function isFeishuTemplateCardContent(
  card: FeishuInteractiveContent,
): card is FeishuTemplateCardContent {
  return "type" in card && card.type === "template";
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

function isFeishuTemplateUnavailableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("ErrCode: 200380") ||
    message.includes("template does not exist")
  );
}

async function parseFeishuResponse<T>(response: Response) {
  const payload = (await response.json()) as FeishuApiResponse<T>;

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg ?? `飞书接口请求失败：HTTP ${response.status}`);
  }

  return (payload.data ?? payload) as T;
}

async function getFeishu<T>(
  path: string,
  tenantAccessToken: string,
  params: Record<string, string | number | undefined> = {},
) {
  const url = new URL(`${FEISHU_OPEN_API_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
    },
  });

  return parseFeishuResponse<T>(response);
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

  return parseFeishuResponse<T>(response);
}

async function listFeishuBotGroupChatIds(tenantAccessToken: string) {
  const chatIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const data = await getFeishu<FeishuChatListData>(
      "/im/v1/chats",
      tenantAccessToken,
      {
        sort_type: "ByActiveTimeDesc",
        page_size: FEISHU_CHAT_LIST_PAGE_SIZE,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    );

    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      if (typeof item.chat_id !== "string") continue;
      if (item.chat_status && item.chat_status !== "normal") continue;
      chatIds.push(item.chat_id);
    }

    pageToken = data.has_more ? data.page_token || undefined : undefined;
  } while (pageToken);

  return uniqueStrings(chatIds);
}

async function sendFeishuChatCard(
  chatId: string,
  card: FeishuInteractiveContent,
  tenantAccessToken: string,
) {
  return postFeishu<SendMessageData>(
    "/im/v1/messages?receive_id_type=chat_id",
    {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    },
    {
      Authorization: `Bearer ${tenantAccessToken}`,
    },
  );
}

async function sendFeishuUserCard(
  openId: string,
  card: FeishuInteractiveContent,
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

async function sendFeishuCardWithTemplateFallback<T>(
  card: FeishuInteractiveContent,
  fallbackCard: FeishuInteractiveContent,
  send: (card: FeishuInteractiveContent) => Promise<T>,
) {
  try {
    return await send(card);
  } catch (error) {
    if (
      !isFeishuTemplateCardContent(card) ||
      !isFeishuTemplateUnavailableError(error)
    ) {
      throw error;
    }

    return send(fallbackCard);
  }
}

async function getTenantAccessToken(
  credentials: FeishuAppCredentials = resolveFeishuAppCredentials(),
) {
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

  const card = buildHermesTaskResultContent(input, mentionOpenIds, {
    includeReviewActions: true,
  });
  const appCredentials = readFeishuAppCredentials();

  if (appCredentials) {
    const tenantAccessToken = await getTenantAccessToken(appCredentials);
    const chatIds = await listFeishuBotGroupChatIds(tenantAccessToken);
    const fallbackCard = isFeishuTemplateCardContent(card)
      ? buildHermesTaskResultCard(input, mentionOpenIds, {
          includeReviewActions: true,
        })
      : card;
    const failures: string[] = [];

    for (const chatId of chatIds) {
      try {
        await sendFeishuCardWithTemplateFallback(
          card,
          fallbackCard,
          (content) => sendFeishuChatCard(chatId, content, tenantAccessToken),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        failures.push(`${chatId}: ${enhanceFeishuMessageError(message)}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`飞书群通知发送失败：${failures.join("；")}`);
    }

    return;
  }

  const webhookUrl = resolveFeishuWebhookUrl();
  if (!webhookUrl) return;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = resolveFeishuWebhookSecret();

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

  const card = buildHermesTaskResultContent(input);
  const fallbackCard = isFeishuTemplateCardContent(card)
    ? buildHermesTaskResultCard(input)
    : card;
  const failures: string[] = [];
  const sentMessages: FeishuUserNotificationMessage[] = [];

  for (const openId of recipientOpenIds) {
    try {
      const sentMessage = await sendFeishuCardWithTemplateFallback(
        card,
        fallbackCard,
        (content) => sendFeishuUserCard(openId, content, tenantAccessToken),
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
