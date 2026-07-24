const DEFAULT_MAX_CLI_PROMPT_BYTES = 64 * 1024;
const DEFAULT_READINESS_ATTEMPTS = 30;
const DEFAULT_READINESS_INTERVAL_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeApiBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responsePayload(response) {
  return await response.json().catch(() => ({}));
}

function apiErrorMessage(payload, status) {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") return payload.error;
    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
    if (typeof payload.detail === "string") return payload.detail;
    if (typeof payload.message === "string") return payload.message;
  }

  return `HTTP ${status}`;
}

function completionText(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return null;
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  const content = choice.message.content;

  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const parts = content
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

export function promptByteLength(prompt) {
  return Buffer.byteLength(prompt, "utf8");
}

export function shouldUseHermesTaskApi(
  prompt,
  maxCliPromptBytes = DEFAULT_MAX_CLI_PROMPT_BYTES,
) {
  const threshold =
    Number.isFinite(maxCliPromptBytes) && maxCliPromptBytes > 0
      ? maxCliPromptBytes
      : DEFAULT_MAX_CLI_PROMPT_BYTES;
  return promptByteLength(prompt) > threshold;
}

export async function waitForHermesTaskApi(
  { apiBaseUrl, apiKey },
  {
    attempts = DEFAULT_READINESS_ATTEMPTS,
    fetchImpl = fetch,
    intervalMs = DEFAULT_READINESS_INTERVAL_MS,
    sleepImpl = sleep,
  } = {},
) {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  let lastError = "health check failed";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${baseUrl}/health`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
    }

    if (attempt < attempts) await sleepImpl(intervalMs);
  }

  throw new Error(`Hermes API Server 未就绪：${lastError}`);
}

export async function runHermesTaskViaApi(
  { apiBaseUrl, apiKey, prompt, taskId },
  options = {},
) {
  if (!apiKey.trim()) {
    throw new Error("大型任务需要 API_SERVER_KEY 才能调用 Hermes API Server。");
  }

  await waitForHermesTaskApi(
    { apiBaseUrl, apiKey },
    {
      attempts: options.readinessAttempts,
      fetchImpl: options.fetchImpl,
      intervalMs: options.readinessIntervalMs,
      sleepImpl: options.sleepImpl,
    },
  );

  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const response = await (options.fetchImpl ?? fetch)(
    `${baseUrl}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(taskId ? { "Idempotency-Key": `cola-task-${taskId}` } : {}),
      },
      body: JSON.stringify({
        model: "hermes-agent",
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
    },
  );
  const payload = await responsePayload(response);

  if (!response.ok) {
    throw new Error(
      `Hermes API Server 执行失败：${apiErrorMessage(payload, response.status)}`,
    );
  }

  const output = completionText(payload);
  if (!output?.trim()) {
    throw new Error("Hermes API Server 没有返回任务结果。");
  }

  return { stdout: output, stderr: "", code: 0 };
}
