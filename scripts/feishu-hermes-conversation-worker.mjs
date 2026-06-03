import * as lark from "@larksuiteoapi/node-sdk";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

const FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn/open-apis";
const DEFAULT_HERMES_API_SERVER_KEY = "cola-hermes-api";
const DEFAULT_MODEL = "hermes-agent";
const MAX_HISTORY_MESSAGES = 16;
const MAX_ARCHIVE_HISTORY_MESSAGES = 80;
const ARCHIVE_MESSAGE_MAX_LENGTH = 4500;
const ARCHIVE_TARGET_LIST_PAGE_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value || null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function compactText(value, maxLength) {
  if (!value) return "";
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function limitText(value, maxLength) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessageText(content) {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed?.text === "string") return parsed.text.trim();
  } catch {
    return "";
  }

  return "";
}

function sanitizeUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function resolveWorkspacePath(inputPath) {
  if (!inputPath) return null;
  if (inputPath.startsWith("/workspace/")) {
    return path.join(process.cwd(), inputPath.slice("/workspace/".length));
  }
  return inputPath;
}

function readExecutionOutput(inputPath) {
  const resolvedPath = resolveWorkspacePath(inputPath);
  if (!resolvedPath) return null;

  try {
    const stats = fs.statSync(resolvedPath);
    const filePath = stats.isDirectory()
      ? path.join(resolvedPath, "last-result.json")
      : resolvedPath;
    if (!fs.existsSync(filePath)) return null;

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isPlainRecord(parsed)) return null;

    const result = isPlainRecord(parsed.result) ? parsed.result : {};
    const outputs = Array.isArray(result.outputs) ? result.outputs : [];
    const firstOutput = outputs.find(
      (output) =>
        isPlainRecord(output) &&
        typeof output.text === "string" &&
        output.text.trim(),
    );
    if (firstOutput) return firstOutput.text.trim();

    if (typeof result.stdout === "string" && result.stdout.trim()) {
      return result.stdout.trim();
    }
    if (typeof result.stderr === "string" && result.stderr.trim()) {
      return result.stderr.trim();
    }
  } catch {
    return null;
  }

  return null;
}

function parseMetadata(metadata) {
  const record = isPlainRecord(metadata) ? metadata : {};
  return {
    agentId: typeof record.agentId === "string" ? record.agentId : null,
    agentName: typeof record.agentName === "string" ? record.agentName : null,
    engine: typeof record.engine === "string" ? record.engine : null,
    hermesApiServerUrl:
      typeof record.hermesApiServerUrl === "string"
        ? record.hermesApiServerUrl
        : null,
    hermesApiServerKey:
      typeof record.hermesApiServerKey === "string"
        ? record.hermesApiServerKey
        : null,
  };
}

function parseCardActionValue(value) {
  if (!isPlainRecord(value)) return null;
  if (value.source !== "cola.hermes_task_result") return null;

  const action =
    value.action === "confirm"
      ? "confirm"
      : value.action === "reject"
        ? "reject"
        : null;
  const taskId = sanitizeUuid(value.taskId);
  const sessionId = sanitizeUuid(value.sessionId);

  if (!action || !taskId || !sessionId) return null;
  return { action, taskId, sessionId };
}

function parseTextReviewAction(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[。.!！]+$/g, "");

  if (["确认", "同意", "认可", "通过"].includes(normalized)) {
    return "confirm";
  }
  if (["不认可", "不通过", "拒绝", "驳回"].includes(normalized)) {
    return "reject";
  }

  return null;
}

function extractNotificationMessages(payload) {
  if (!isPlainRecord(payload)) return [];
  const feishu = isPlainRecord(payload.feishu) ? payload.feishu : null;
  const messages = Array.isArray(feishu?.notificationMessages)
    ? feishu.notificationMessages
    : [];

  return messages
    .filter((message) => isPlainRecord(message))
    .map((message) => ({
      openId: typeof message.openId === "string" ? message.openId : null,
      chatId: typeof message.chatId === "string" ? message.chatId : null,
      messageId:
        typeof message.messageId === "string" ? message.messageId : null,
    }));
}

function extractAssistantContent(payload) {
  if (!isPlainRecord(payload)) return null;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    const message = isPlainRecord(choice) ? choice.message : null;
    if (!isPlainRecord(message)) continue;
    if (typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return null;
}

function eventSummary(data) {
  const message = data?.message ?? {};
  const sender = data?.sender ?? {};
  return {
    eventId: data?.event_id ?? null,
    chatId: message.chat_id ?? null,
    messageId: message.message_id ?? null,
    parentId: message.parent_id ?? null,
    rootId: message.root_id ?? null,
    messageType: message.message_type ?? null,
    chatType: message.chat_type ?? null,
    senderType: sender.sender_type ?? null,
    senderOpenId: sender.sender_id?.open_id ?? null,
    text: compactText(parseMessageText(message.content), 120),
  };
}

async function postFeishu(path, body, tenantAccessToken) {
  const response = await fetch(`${FEISHU_OPEN_API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new Error(
      payload.msg ?? `Feishu request failed: HTTP ${response.status}`,
    );
  }

  return payload.data ?? payload;
}

async function getTenantAccessToken(appId, appSecret) {
  const response = await fetch(
    `${FEISHU_OPEN_API_BASE_URL}/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new Error(
      payload.msg ??
        `Feishu tenant_access_token failed: HTTP ${response.status}`,
    );
  }

  if (!payload.tenant_access_token) {
    throw new Error("Feishu did not return tenant_access_token.");
  }

  return payload.tenant_access_token;
}

async function sendFeishuText(client, chatId, text) {
  await client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function listFeishuBotGroupChatIds(client) {
  const chatIds = [];
  let pageToken = undefined;

  do {
    const response = await client.im.v1.chat.list({
      params: {
        sort_type: "ByActiveTimeDesc",
        page_size: ARCHIVE_TARGET_LIST_PAGE_SIZE,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    });
    if (response?.code && response.code !== 0) {
      throw new Error(response.msg ?? "Feishu chat list failed.");
    }

    const items = Array.isArray(response?.data?.items)
      ? response.data.items
      : [];
    for (const item of items) {
      if (typeof item.chat_id !== "string") continue;
      if (item.chat_status && item.chat_status !== "normal") continue;
      chatIds.push(item.chat_id);
    }

    pageToken = response?.data?.has_more
      ? response.data.page_token || undefined
      : undefined;
  } while (pageToken);

  return uniqueStrings(chatIds);
}

async function resolveArchiveTargets(client, sourceChatId) {
  try {
    return {
      targetChatIds: await listFeishuBotGroupChatIds(client),
      failures: [],
    };
  } catch (error) {
    return {
      targetChatIds: [],
      failures: [`获取机器人所在群失败：${errorMessage(error)}`],
    };
  }
}

async function sendArchiveText(client, sourceChatId, archiveText) {
  const { targetChatIds, failures } = await resolveArchiveTargets(
    client,
    sourceChatId,
  );
  const deliveryFailures = [...failures];
  const deliveredTargetChatIds = [];

  if (targetChatIds.length === 0) {
    await sendFeishuText(
      client,
      sourceChatId,
      [
        "Hermes 归档已生成，但没有找到可发送的机器人所在群。",
        deliveryFailures.length > 0
          ? [
              "失败明细：",
              ...deliveryFailures.map((failure) => `- ${failure}`),
            ].join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    ).catch(() => null);

    return {
      targetChatIds: deliveredTargetChatIds,
      failures: deliveryFailures,
    };
  }

  for (const targetChatId of targetChatIds) {
    try {
      await sendFeishuText(client, targetChatId, archiveText);
      deliveredTargetChatIds.push(targetChatId);
    } catch (error) {
      deliveryFailures.push(
        `发送归档群 ${targetChatId} 失败：${errorMessage(error)}`,
      );
    }
  }

  if (!deliveredTargetChatIds.includes(sourceChatId)) {
    await sendFeishuText(
      client,
      sourceChatId,
      [
        deliveredTargetChatIds.length > 0
          ? `Hermes 任务归档已处理，归档总结已发送到 ${deliveredTargetChatIds.length} 个机器人所在群。`
          : "Hermes 归档已生成，但没有成功发送到机器人所在群。",
        deliveryFailures.length > 0
          ? [
              "发送失败明细：",
              ...deliveryFailures.map((failure) => `- ${failure}`),
            ].join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    ).catch(() => null);
  }

  return {
    targetChatIds: deliveredTargetChatIds,
    failures: deliveryFailures,
  };
}

async function markFeishuMessageRead(appId, appSecret, messageId) {
  const tenantAccessToken = await getTenantAccessToken(appId, appSecret);
  await postFeishu(
    `/im/v1/messages/${encodeURIComponent(messageId)}/read_users`,
    {},
    tenantAccessToken,
  ).catch(() => null);
}

async function findConversationContext(sql, message) {
  const senderOpenId = message.sender?.sender_id?.open_id ?? null;
  const chatId = message.message.chat_id;
  const replyIds = new Set(
    [message.message.parent_id, message.message.root_id].filter(Boolean),
  );

  const recentEvents = await sql`
    select
      e.id as event_id,
      e."entityId" as session_id,
      e.payload,
      e."occurredAt" as occurred_at,
      s."taskId" as task_id,
      s."agentId" as agent_id,
      s."deviceId" as device_id,
      t.title as task_title,
      t.summary as task_summary,
      d.name as device_name,
      d.metadata as device_metadata
    from cola_event e
    left join cola_execution_session s on s.id::text = e."entityId"
    left join cola_task t on t.id = s."taskId"
    left join cola_device d on d.id = s."deviceId"
    where e."eventType" = 'execution_session.reported'
      and e.payload is not null
    order by e."occurredAt" desc
    limit 80
  `;

  for (const event of recentEvents) {
    const notificationMessages = extractNotificationMessages(event.payload);
    const matchedMessage = notificationMessages.find((notification) => {
      if (notification.messageId && replyIds.has(notification.messageId)) {
        return true;
      }

      return (
        notification.chatId === chatId &&
        (!senderOpenId || notification.openId === senderOpenId)
      );
    });

    if (matchedMessage) {
      const metadata = parseMetadata(event.device_metadata);
      if (metadata.engine !== "hermes-agent") {
        console.warn(
          "[feishu-hermes] matched notification but device is not Hermes:",
          JSON.stringify({
            taskId: event.task_id,
            deviceId: event.device_id,
            engine: metadata.engine,
          }),
        );
        return null;
      }
      if (!metadata.hermesApiServerUrl) {
        console.warn(
          "[feishu-hermes] matched notification but Hermes API URL is missing:",
          JSON.stringify({
            taskId: event.task_id,
            deviceId: event.device_id,
          }),
        );
        return null;
      }

      console.log(
        "[feishu-hermes] matched conversation context:",
        JSON.stringify({
          taskId: event.task_id,
          sessionId: event.session_id,
          deviceId: event.device_id,
          chatId,
          senderOpenId,
          notificationMessageId: matchedMessage.messageId,
        }),
      );
      return {
        event,
        metadata,
        matchedMessage,
      };
    }
  }

  return null;
}

async function loadConversationMessages(sql, context, userText) {
  const rows = await sql`
    select payload
    from cola_event
    where "eventType" = 'feishu.hermes_conversation.message'
      and "entityType" = 'task'
      and "entityId" = ${context.event.task_id}
    order by "occurredAt" desc
    limit ${MAX_HISTORY_MESSAGES}
  `;
  const history = rows
    .reverse()
    .map((row) => {
      const payload = isPlainRecord(row.payload) ? row.payload : {};
      const role = payload.role === "assistant" ? "assistant" : "user";
      const content =
        typeof payload.content === "string" ? payload.content.trim() : "";
      return content ? { role, content } : null;
    })
    .filter(Boolean);

  return [
    {
      role: "system",
      content: [
        "你是 Cola Virtual Office 里的 Hermes Agent。",
        "用户正在基于一个已完成任务继续追问，请结合任务上下文持续对话。",
        "回答要直接、可执行；如果需要继续操作或查看文件，说明你能做什么和下一步。",
      ].join("\n"),
    },
    {
      role: "assistant",
      content: [
        `原任务：${context.event.task_title ?? "未命名任务"}`,
        `任务说明：${compactText(context.event.task_summary, 800) || "无"}`,
        `执行设备：${context.event.device_name ?? "Hermes Runner"}`,
        "我已经把任务结果发给你。你可以继续追问，我会基于这个任务继续处理。",
      ].join("\n"),
    },
    ...history,
    {
      role: "user",
      content: userText,
    },
  ];
}

async function callHermes(context, messages) {
  const apiUrl = `${context.metadata.hermesApiServerUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${
        context.metadata.hermesApiServerKey ?? DEFAULT_HERMES_API_SERVER_KEY
      }`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: optionalEnv("COLA_FEISHU_HERMES_MODEL") ?? DEFAULT_MODEL,
      messages,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.error?.message === "string"
        ? payload.error.message
        : `Hermes API failed: HTTP ${response.status}`,
    );
  }

  return extractAssistantContent(payload) ?? "Hermes 没有返回可读文本。";
}

async function recordConversationMessage(sql, context, input) {
  await sql`
    insert into cola_event (
      "eventType",
      "entityType",
      "entityId",
      severity,
      title,
      description,
      payload,
      "occurredAt",
      "createdAt"
    )
    values (
      'feishu.hermes_conversation.message',
      'task',
      ${context.event.task_id},
      'info',
      ${input.title},
      ${input.description},
      ${sql.json(input.payload)},
      now(),
      now()
    )
  `;
}

async function loadArchiveContext(sql, input) {
  const rows = await sql`
    select
      s.id as session_id,
      s."taskId" as task_id,
      s."agentId" as agent_id,
      s."deviceId" as device_id,
      s.status as session_status,
      s."artifactPath" as artifact_path,
      s."logPath" as log_path,
      s."endedAt" as ended_at,
      t.title as task_title,
      t.summary as task_summary,
      d.name as device_name,
      d.metadata as device_metadata
    from cola_execution_session s
    left join cola_task t on t.id = s."taskId"
    left join cola_device d on d.id = s."deviceId"
    where s.id = ${input.sessionId}::uuid
      and s."taskId" = ${input.taskId}::uuid
    limit 1
  `;
  const event = rows[0];
  if (!event) return null;

  const historyRows = await sql`
    select payload, "occurredAt" as occurred_at
    from cola_event
    where "eventType" = 'feishu.hermes_conversation.message'
      and "entityType" = 'task'
      and "entityId" = ${input.taskId}
    order by "occurredAt" desc
    limit ${MAX_ARCHIVE_HISTORY_MESSAGES}
  `;

  return {
    event,
    metadata: parseMetadata(event.device_metadata),
    history: historyRows.reverse(),
    outputText: readExecutionOutput(event.artifact_path),
  };
}

function normalizeHistoryRows(rows) {
  return rows
    .map((row) => {
      const payload = isPlainRecord(row.payload) ? row.payload : {};
      const role = payload.role === "assistant" ? "assistant" : "user";
      const content =
        typeof payload.content === "string" ? payload.content.trim() : "";
      return content ? { role, content } : null;
    })
    .filter(Boolean);
}

function latestMessages(messages, role, limit) {
  return messages.filter((message) => message.role === role).slice(-limit);
}

function formatMessageList(messages, maxItemLength) {
  return messages
    .map(
      (message, index) =>
        `${index + 1}. ${compactText(message.content, maxItemLength)}`,
    )
    .join("\n");
}

function buildConversationArchiveSummary(rows, input) {
  const messages = normalizeHistoryRows(rows);
  if (messages.length === 0) {
    return input.action === "confirm"
      ? "没有继续对话；用户直接确认任务结果并归档。"
      : "没有继续对话；用户直接标记任务结果未通过。";
  }

  const userMessages = messages.filter((message) => message.role === "user");
  const assistantMessages = messages.filter(
    (message) => message.role === "assistant",
  );
  const recentUserMessages = latestMessages(messages, "user", 5);
  const recentAssistantMessages = latestMessages(messages, "assistant", 3);
  const finalDecision =
    input.action === "confirm"
      ? "用户已确认通过，按当前任务结果归档。"
      : "用户不认可当前结果，需要继续处理。";

  return [
    `对话规模：用户 ${userMessages.length} 条，Hermes ${assistantMessages.length} 条。`,
    recentUserMessages.length > 0
      ? `用户核心诉求：\n${formatMessageList(recentUserMessages, 180)}`
      : null,
    recentAssistantMessages.length > 0
      ? `Hermes 处理结论：\n${formatMessageList(recentAssistantMessages, 420)}`
      : null,
    `最终确认：${finalDecision}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildConversationArchiveHighlights(rows) {
  const messages = normalizeHistoryRows(rows);
  if (messages.length === 0) return null;

  return messages
    .slice(-10)
    .map((message, index) => {
      const label = message.role === "assistant" ? "Hermes" : "用户";
      return `${index + 1}. ${label}：${compactText(message.content, 260)}`;
    })
    .join("\n");
}

function buildArchiveSummaryPrompt(context, input) {
  const event = context.event;
  const messages = normalizeHistoryRows(context.history)
    .slice(-40)
    .map((message, index) => {
      const label = message.role === "assistant" ? "Hermes" : "用户";
      return `${index + 1}. ${label}: ${compactText(message.content, 600)}`;
    });

  return [
    "请为这个 Hermes 任务生成归档总结。",
    "要求：",
    "1. 用中文输出，直接给结论，不要解释你的总结方法。",
    "2. 聚焦这个任务产生的多轮对话，而不是逐字复述。",
    "3. 包含：用户核心诉求、Hermes 实际处理/答复、最终状态、遗留问题或下一步。",
    "4. 如果用户已经确认通过，明确写出已确认归档；如果不认可，明确写出需要继续处理。",
    "5. 控制在 800 字以内。",
    "",
    `任务：${event.task_title ?? "未命名任务"}`,
    `任务说明：${compactText(event.task_summary, 800) || "无"}`,
    `执行结果：${compactText(context.outputText, 1200) || "无"}`,
    `最终确认状态：${
      input.action === "confirm" ? "确认通过" : "不认可，需要继续处理"
    }`,
    "",
    messages.length > 0 ? `多轮对话：\n${messages.join("\n")}` : "多轮对话：无",
  ].join("\n");
}

async function summarizeArchiveConversation(context, input) {
  if (!context.metadata?.hermesApiServerUrl) {
    return buildConversationArchiveSummary(context.history, input);
  }

  try {
    const summary = await callHermes(context, [
      {
        role: "system",
        content:
          "你是 Cola Virtual Office 的任务归档助手，负责把任务结果和飞书多轮追问整理成可转发的归档总结。",
      },
      {
        role: "user",
        content: buildArchiveSummaryPrompt(context, input),
      },
    ]);
    return limitText(summary, 1200);
  } catch (error) {
    console.warn(
      "[feishu-hermes] archive summary fallback:",
      errorMessage(error),
    );
    return buildConversationArchiveSummary(context.history, input);
  }
}

function buildArchiveMessage(context, input) {
  const event = context.event;
  const operatorName =
    input.operatorName?.trim() || input.operatorOpenId || "飞书用户";
  const decisionText =
    input.action === "confirm" ? "确认通过" : "不认可，需要继续处理";
  const titlePrefix =
    input.action === "confirm"
      ? "Hermes 任务已确认并归档"
      : "Hermes 任务未通过确认";
  const headerLines = [
    `${titlePrefix}`,
    "",
    `确认人：${operatorName}`,
    `任务：${event.task_title ?? "未命名任务"}`,
    `设备：${event.device_name ?? "Hermes Runner"}`,
    `会话：${event.session_id}`,
    `结论：${decisionText}`,
  ];
  const taskSummary = compactText(event.task_summary, 800);
  const resultText = compactText(context.outputText, 1000);
  const conversationSummary =
    input.conversationSummary ??
    buildConversationArchiveSummary(context.history, input);
  const conversationHighlights = buildConversationArchiveHighlights(
    context.history,
  );
  const sections = [
    headerLines.join("\n"),
    taskSummary ? `任务说明：\n${taskSummary}` : null,
    resultText ? `执行结果摘要：\n${resultText}` : null,
    `多轮对话总结：\n${conversationSummary}`,
    conversationHighlights ? `关键对话摘录：\n${conversationHighlights}` : null,
    event.artifact_path || event.log_path
      ? [
          "产物与日志：",
          event.artifact_path ? `产物：${event.artifact_path}` : null,
          event.log_path ? `日志：${event.log_path}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : null,
  ].filter(Boolean);
  const message = sections.join("\n\n");

  return message.length <= ARCHIVE_MESSAGE_MAX_LENGTH
    ? message
    : `${message.slice(0, ARCHIVE_MESSAGE_MAX_LENGTH - 1)}…`;
}

async function recordArchiveEvent(sql, context, input, archiveText) {
  const severity =
    input.action === "confirm"
      ? sql`'info'::cola_event_severity`
      : sql`'warning'::cola_event_severity`;
  const title =
    input.action === "confirm"
      ? "Hermes 任务对话已确认归档"
      : "Hermes 任务对话被标记为不认可";

  await sql`
    insert into cola_event (
      "eventType",
      "entityType",
      "entityId",
      severity,
      title,
      description,
      payload,
      "occurredAt",
      "createdAt"
    )
    values (
      'feishu.hermes_conversation.archived',
      'task',
      ${input.taskId},
      ${severity},
      ${title},
      ${compactText(archiveText, 240)},
      ${sql.json({
        action: input.action,
        sessionId: input.sessionId,
        chatId: input.chatId,
        archiveTargetChatIds: input.archiveTargetChatIds ?? [],
        archiveDeliveryFailures: input.archiveDeliveryFailures ?? [],
        messageId: input.messageId,
        operatorOpenId: input.operatorOpenId,
        operatorName: input.operatorName ?? null,
        deviceId: context.event.device_id ?? null,
        agentId: context.event.agent_id ?? null,
      })},
      now(),
      now()
    )
  `;
}

async function handleCardAction(sql, client, data) {
  const normalized = lark.normalizeCardAction(data, { includeRaw: false });
  if (!normalized) {
    console.warn("[feishu-hermes] skipped invalid card action.");
    return;
  }

  const actionValue = parseCardActionValue(normalized.action.value);
  if (!actionValue) {
    console.log(
      "[feishu-hermes] skipped unrelated card action:",
      JSON.stringify({
        chatId: normalized.chatId,
        messageId: normalized.messageId,
        tag: normalized.action.tag,
      }),
    );
    return;
  }

  console.log(
    "[feishu-hermes] received Hermes result review action:",
    JSON.stringify({
      chatId: normalized.chatId,
      messageId: normalized.messageId,
      operatorOpenId: normalized.operator.openId,
      action: actionValue.action,
      taskId: actionValue.taskId,
      sessionId: actionValue.sessionId,
    }),
  );

  const context = await loadArchiveContext(sql, actionValue);
  if (!context) {
    await sendFeishuText(
      client,
      normalized.chatId,
      "Hermes 归档失败：没有找到这条任务结果对应的执行会话。",
    );
    return;
  }

  const archiveInput = {
    ...actionValue,
    chatId: normalized.chatId,
    messageId: normalized.messageId,
    operatorOpenId: normalized.operator.openId,
    operatorName: normalized.operator.name,
  };
  archiveInput.conversationSummary = await summarizeArchiveConversation(
    context,
    archiveInput,
  );
  const archiveText = buildArchiveMessage(context, archiveInput);
  const delivery = await sendArchiveText(
    client,
    normalized.chatId,
    archiveText,
  );
  await recordArchiveEvent(
    sql,
    context,
    {
      ...archiveInput,
      archiveTargetChatIds: delivery.targetChatIds,
      archiveDeliveryFailures: delivery.failures,
    },
    archiveText,
  );
}

async function archiveConversationContext(sql, client, context, input) {
  const archiveInput = {
    action: input.action,
    taskId: context.event.task_id,
    sessionId: context.event.session_id,
    chatId: input.chatId,
    messageId: input.messageId,
    operatorOpenId: input.operatorOpenId,
    operatorName: input.operatorName,
  };

  const archiveContext = await loadArchiveContext(sql, archiveInput);
  if (!archiveContext) {
    await sendFeishuText(
      client,
      input.chatId,
      "Hermes 归档失败：没有找到这条任务结果对应的执行会话。",
    );
    return;
  }

  archiveInput.conversationSummary = await summarizeArchiveConversation(
    archiveContext,
    archiveInput,
  );
  const archiveText = buildArchiveMessage(archiveContext, archiveInput);
  const delivery = await sendArchiveText(client, input.chatId, archiveText);
  await recordArchiveEvent(
    sql,
    archiveContext,
    {
      ...archiveInput,
      archiveTargetChatIds: delivery.targetChatIds,
      archiveDeliveryFailures: delivery.failures,
    },
    archiveText,
  );
}

async function handleMessage(sql, client, appConfig, data) {
  console.log(
    "[feishu-hermes] received im.message.receive_v1:",
    JSON.stringify(eventSummary(data)),
  );

  if (data.sender?.sender_type === "app") {
    console.log("[feishu-hermes] skipped app-sent message.");
    return;
  }
  if (data.message.message_type !== "text") {
    console.log(
      "[feishu-hermes] skipped non-text message:",
      data.message.message_type,
    );
    return;
  }

  const userText = parseMessageText(data.message.content);
  if (!userText) {
    console.log("[feishu-hermes] skipped empty text message.");
    return;
  }

  const context = await findConversationContext(sql, data);
  if (!context) {
    console.warn(
      "[feishu-hermes] no conversation context found:",
      JSON.stringify(eventSummary(data)),
    );
    await sendFeishuText(
      client,
      data.message.chat_id,
      "我收到了你的消息，但没有找到可继续处理的 Hermes 任务上下文。请从任务完成通知那条消息继续回复。",
    );
    return;
  }

  const textReviewAction = parseTextReviewAction(userText);
  if (textReviewAction) {
    await archiveConversationContext(sql, client, context, {
      action: textReviewAction,
      chatId: data.message.chat_id,
      messageId: data.message.message_id,
      operatorOpenId: data.sender?.sender_id?.open_id ?? null,
      operatorName: null,
    });

    if (data.message.message_id) {
      await markFeishuMessageRead(
        appConfig.appId,
        appConfig.appSecret,
        data.message.message_id,
      );
    }
    return;
  }

  await recordConversationMessage(sql, context, {
    title: "飞书用户继续追问 Hermes 任务",
    description: compactText(userText, 240),
    payload: {
      role: "user",
      content: userText,
      feishu: {
        chatId: data.message.chat_id,
        messageId: data.message.message_id,
        parentId: data.message.parent_id ?? null,
        rootId: data.message.root_id ?? null,
        senderOpenId: data.sender?.sender_id?.open_id ?? null,
      },
    },
  });

  await sendFeishuText(
    client,
    data.message.chat_id,
    "Hermes 收到，正在继续处理。",
  );
  const messages = await loadConversationMessages(sql, context, userText);
  const reply = await callHermes(context, messages);
  await sendFeishuText(client, data.message.chat_id, reply);
  console.log(
    "[feishu-hermes] sent Hermes reply:",
    JSON.stringify({
      chatId: data.message.chat_id,
      taskId: context.event.task_id,
      length: reply.length,
    }),
  );

  await recordConversationMessage(sql, context, {
    title: "Hermes 已回复飞书继续对话",
    description: compactText(reply, 240),
    payload: {
      role: "assistant",
      content: reply,
      feishu: {
        chatId: data.message.chat_id,
      },
    },
  });

  if (data.message.message_id) {
    await markFeishuMessageRead(
      appConfig.appId,
      appConfig.appSecret,
      data.message.message_id,
    );
  }
}

async function reportHandlingError(client, data, error) {
  console.error(
    "[feishu-hermes] message handling failed:",
    error instanceof Error ? error.message : error,
  );
  const chatId = data?.message?.chat_id;
  if (chatId) {
    await sendFeishuText(
      client,
      chatId,
      `Hermes 继续处理失败：${error instanceof Error ? error.message : "未知错误"}`,
    ).catch(() => null);
  }
}

async function reportCardActionError(client, data, error) {
  console.error(
    "[feishu-hermes] card action handling failed:",
    error instanceof Error ? error.message : error,
  );
  const normalized = lark.normalizeCardAction(data, { includeRaw: false });
  if (normalized?.chatId) {
    await sendFeishuText(
      client,
      normalized.chatId,
      `Hermes 归档失败：${error instanceof Error ? error.message : "未知错误"}`,
    ).catch(() => null);
  }
}

async function main() {
  const appConfig = {
    appId: requiredEnv("FEISHU_APP_ID"),
    appSecret: requiredEnv("FEISHU_APP_SECRET"),
  };
  const databaseUrl = requiredEnv("DATABASE_URL");
  const sql = postgres(databaseUrl, { max: 4 });
  const client = new lark.Client(appConfig);
  const dispatcher = new lark.EventDispatcher({}).register({
    "im.message.receive_v1": (data) => {
      void handleMessage(sql, client, appConfig, data).catch((error) =>
        reportHandlingError(client, data, error),
      );
    },
    "card.action.trigger": (data) => {
      void handleCardAction(sql, client, data).catch((error) =>
        reportCardActionError(client, data, error),
      );
    },
  });

  const wsClient = new lark.WSClient({
    ...appConfig,
    loggerLevel: lark.LoggerLevel.info,
  });

  await wsClient.start({ eventDispatcher: dispatcher });
  console.log("[feishu-hermes] worker started with Feishu long connection.");

  const shutdown = async () => {
    console.log("[feishu-hermes] shutting down.");
    wsClient.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}

export {
  buildArchiveMessage,
  buildConversationArchiveSummary,
  normalizeHistoryRows,
  parseCardActionValue,
  parseTextReviewAction,
  readExecutionOutput,
  resolveArchiveTargets,
  sendArchiveText,
};
