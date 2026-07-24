import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const DEFAULT_MAX_CLI_PROMPT_BYTES = 64 * 1024;
const DEFAULT_READINESS_ATTEMPTS = 30;
const DEFAULT_READINESS_INTERVAL_MS = 1000;
const DEFAULT_TASK_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_TASK_REQUEST_ATTEMPTS = 2;
const DEFAULT_TASK_REQUEST_RETRY_INTERVAL_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeApiBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function errorDetails(error) {
  if (!(error instanceof Error)) return "unknown request error";

  const details = [error.message];
  const cause = error.cause;
  if (isRecord(cause)) {
    if (typeof cause.code === "string") details.push(cause.code);
    if (
      typeof cause.message === "string" &&
      cause.message !== error.message
    ) {
      details.push(cause.message);
    }
  }

  return [...new Set(details.filter(Boolean))].join("；");
}

function nodeHttpResponse(url, init = {}, { timeoutMs } = {}) {
  const target = new URL(url);
  const requestImpl =
    target.protocol === "http:"
      ? httpRequest
      : target.protocol === "https:"
        ? httpsRequest
        : null;

  if (!requestImpl) {
    return Promise.reject(
      new Error(`Hermes API Server URL 协议不受支持：${target.protocol}`),
    );
  }

  const body = typeof init.body === "string" ? init.body : "";
  const headers = { ...(init.headers ?? {}) };
  if (
    body &&
    !Object.keys(headers).some(
      (name) => name.toLowerCase() === "content-length",
    )
  ) {
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }

  return new Promise((resolve, reject) => {
    const request = requestImpl(
      target,
      {
        method: init.method ?? "GET",
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          const responseText = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: status >= 200 && status < 300,
            status,
            async json() {
              return responseText ? JSON.parse(responseText) : {};
            },
          });
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(
      positiveInteger(timeoutMs, DEFAULT_TASK_REQUEST_TIMEOUT_MS),
      () => {
        const timeoutSeconds = Math.ceil(
          positiveInteger(timeoutMs, DEFAULT_TASK_REQUEST_TIMEOUT_MS) / 1000,
        );
        request.destroy(
          new Error(
            `Hermes API Server 请求超时：连续 ${timeoutSeconds} 秒未收到响应`,
          ),
        );
      },
    );
    if (body) request.write(body);
    request.end();
  });
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
  const requestImpl =
    options.requestImpl ?? (options.fetchImpl ? options.fetchImpl : nodeHttpResponse);
  const requestAttempts = taskId
    ? positiveInteger(
        options.requestAttempts,
        DEFAULT_TASK_REQUEST_ATTEMPTS,
      )
    : 1;
  const requestTimeoutMs = positiveInteger(
    options.requestTimeoutMs,
    DEFAULT_TASK_REQUEST_TIMEOUT_MS,
  );
  const requestRetryIntervalMs = positiveInteger(
    options.requestRetryIntervalMs,
    DEFAULT_TASK_REQUEST_RETRY_INTERVAL_MS,
  );
  const requestUrl = `${baseUrl}/v1/chat/completions`;
  const requestInit = {
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
  };

  let response;
  for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
    try {
      response = await requestImpl(requestUrl, requestInit, {
        timeoutMs: requestTimeoutMs,
      });
      break;
    } catch (error) {
      const details = errorDetails(error);
      if (attempt >= requestAttempts) {
        throw new Error(
          `Hermes API Server 请求失败（${attempt}/${requestAttempts}）：${details}`,
          { cause: error },
        );
      }

      await options.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts: requestAttempts,
        error: details,
      });
      await (options.sleepImpl ?? sleep)(requestRetryIntervalMs);
      await waitForHermesTaskApi(
        { apiBaseUrl, apiKey },
        {
          attempts: options.readinessAttempts,
          fetchImpl: options.fetchImpl,
          intervalMs: options.readinessIntervalMs,
          sleepImpl: options.sleepImpl,
        },
      );
    }
  }

  if (!response) {
    throw new Error("Hermes API Server 请求未返回响应。");
  }
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
