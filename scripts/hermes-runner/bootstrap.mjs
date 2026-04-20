import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const apiBaseUrl =
  process.env.COLA_API_BASE_URL ?? "http://host.docker.internal:50038";
const runnerName = process.env.COLA_RUNNER_NAME ?? "Hermes Runner";
const resourcePool = process.env.COLA_RESOURCE_POOL ?? "docker-core";
const runnerRuntime = process.env.COLA_RUNNER_RUNTIME ?? "docker";
const runtimeLabel =
  runnerRuntime === "kubernetes" ? "Kubernetes" : "Docker";
const runnerHost = process.env.COLA_RUNNER_HOST ?? "host.docker.internal";
const image = process.env.HERMES_AGENT_IMAGE ?? "unknown-image";
const containerName =
  process.env.HOSTNAME ?? process.env.COLA_CONTAINER_NAME ?? runnerName;
const codexConfigPath =
  process.env.HERMES_CODEX_CONFIG_PATH ??
  path.join(homedir(), ".codex", "config.toml");
const codexAuthPath =
  process.env.HERMES_CODEX_AUTH_PATH ??
  path.join(homedir(), ".codex", "auth.json");
const hermesHome = process.env.HERMES_HOME ?? "/tmp/hermes-home";
const configPath =
  process.env.HERMES_CONFIG_PATH ?? path.join(hermesHome, "config.yaml");
const envPath = process.env.HERMES_ENV_PATH ?? path.join(hermesHome, ".env");
const hermesBin = process.env.HERMES_BIN ?? "/opt/hermes/.venv/bin/hermes";
const heartbeatIntervalMs = Number(
  process.env.COLA_HEARTBEAT_INTERVAL_MS ?? "15000",
);
const readyCommand = process.env.HERMES_READY_COMMAND ?? `${hermesBin} --version`;
const bootCommand = process.env.HERMES_BOOT_COMMAND;
const bootTaskId = process.env.HERMES_BOOT_TASK_ID;
const bootAgentId = process.env.HERMES_BOOT_AGENT_ID;
const agentId = process.env.COLA_AGENT_ID ?? "";
const taskPollIntervalMs = Number(
  process.env.COLA_TASK_POLL_INTERVAL_MS ?? "10000",
);
const taskCommand = process.env.HERMES_TASK_COMMAND;
const workdir = process.env.HERMES_WORKDIR ?? "/workspace";
const logDir = process.env.HERMES_LOG_DIR ?? "/workspace/.hermes-runner";
const sessionLogPath = path.join(logDir, "bootstrap.log");
const resultPath = path.join(logDir, "last-result.json");

let deviceId = "";
let sessionId = "";
let currentStatus = "maintenance";
let isTaskLoopRunning = false;
let resolvedModel = "gpt-5.4";
let resolvedProvider = "custom";
let resolvedBaseUrl = "https://api.openai.com/v1";
let resolvedApiKey = "";
let resolvedApiMode = "chat_completions";

function extractQuotedValue(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*\"([^\"]+)\"$`, "m"));
  return match?.[1] ?? null;
}

function normalizeHermesBaseUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function loadCodexModelConfig() {
  const configText = readFileSync(codexConfigPath, "utf8");
  const auth = JSON.parse(readFileSync(codexAuthPath, "utf8"));

  const providerName = extractQuotedValue(configText, "model_provider") ?? "OpenAI";
  const model = extractQuotedValue(configText, "model") ?? "gpt-5.4";

  const providerSectionMatch = configText.match(
    new RegExp(
      `\\[model_providers\\.${providerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]([\\s\\S]*?)(?:\\n\\[|$)`,
    ),
  );

  const providerSection = providerSectionMatch?.[1] ?? "";
  const baseUrl =
    providerSection.match(/base_url\s*=\s*"([^"]+)"/)?.[1] ??
    "https://api.openai.com/v1";
  const wireApi =
    providerSection.match(/wire_api\s*=\s*"([^"]+)"/)?.[1] ?? "responses";
  const apiKey = auth.OPENAI_API_KEY ?? auth.api_key ?? auth.token ?? null;

  if (!apiKey) {
    throw new Error("auth.json 中未找到可用的 OPENAI_API_KEY。");
  }

  return {
    model,
    apiKey,
    baseUrl: normalizeHermesBaseUrl(baseUrl),
    apiMode:
      wireApi === "responses" || wireApi === "codex-responses"
        ? "codex_responses"
        : "chat_completions",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureRunnerHome() {
  await mkdir(hermesHome, { recursive: true });
}

async function ensureLogDir() {
  await mkdir(logDir, { recursive: true });
}

async function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await appendFile(sessionLogPath, line);
  console.log(message);
}

async function postJson(pathname, body) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : `Request failed: ${response.status}`,
    );
  }

  return data;
}

async function shell(command, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], {
      cwd: workdir,
      env: {
        ...process.env,
        HERMES_HOME: hermesHome,
        HERMES_CONFIG: configPath,
        OPENAI_API_KEY: resolvedApiKey,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(
          new Error(
            stderr.trim() || stdout.trim() || `Command exited with code ${code}`,
          ),
        );
      }
    });
  });
}

async function writeHermesConfig() {
  const { model, apiKey, baseUrl, apiMode } = loadCodexModelConfig();
  resolvedModel = model;
  resolvedBaseUrl = baseUrl;
  resolvedApiKey = apiKey;
  resolvedApiMode = apiMode;

  const configText = `
model:
  default: "${model}"
  provider: "custom"
  base_url: "${baseUrl}"
  api_mode: "${apiMode}"

terminal:
  backend: "local"
  cwd: "."
  timeout: 180

display:
  streaming: false
`.trimStart();

  const envText = `OPENAI_API_KEY=${apiKey}\nOPENAI_BASE_URL=${baseUrl}\n`;

  await ensureRunnerHome();
  await writeFile(configPath, configText);
  await writeFile(envPath, envText);
}

async function registerRunner(healthSummary, status = "online") {
  const result = await postJson("/api/worker/register", {
    name: runnerName,
    resourcePool,
    status,
    engine: "hermes-agent",
    runtime: runnerRuntime,
    host: runnerHost,
    healthSummary,
    containerName,
    image,
  });

  deviceId = result.deviceId;
  return result;
}

async function sendHeartbeat(status, healthSummary) {
  if (!deviceId) return;
  currentStatus = status;
  await postJson("/api/worker/heartbeat", {
    deviceId,
    status,
    name: runnerName,
    resourcePool,
    engine: "hermes-agent",
    runtime: runnerRuntime,
    healthSummary,
    host: runnerHost,
    containerName,
    image,
  });
}

async function reportSession(status, extra = {}) {
  if (!deviceId || !bootTaskId) return;

  const result = await postJson("/api/worker/session", {
    sessionId: sessionId || undefined,
    deviceId,
    taskId: bootTaskId,
    agentId: bootAgentId || undefined,
    status,
    logPath: sessionLogPath,
    artifactPath: logDir,
    ...extra,
  });

  if (typeof result?.sessionId === "string") {
    sessionId = result.sessionId;
  }
}

async function reportTaskSession(taskId, status, extra = {}) {
  if (!deviceId) return;

  const result = await postJson("/api/worker/session", {
    sessionId: sessionId || undefined,
    deviceId,
    taskId,
    agentId: agentId || undefined,
    status,
    logPath: sessionLogPath,
    artifactPath: logDir,
    ...extra,
  });

  if (typeof result?.sessionId === "string") {
    sessionId = result.sessionId;
  }
}

async function probeHermes() {
  if (!existsSync(codexConfigPath) || !existsSync(codexAuthPath)) {
    return {
      status: "unhealthy",
      summary: "缺少 ~/.codex/config.toml 或 ~/.codex/auth.json 挂载",
    };
  }

  if (!existsSync(hermesBin)) {
    return {
      status: "unhealthy",
      summary: `Hermes CLI 不存在：${hermesBin}`,
    };
  }

  try {
    await writeHermesConfig();
    await shell(readyCommand);
    return {
      status: "online",
      summary: `Hermes Agent 已从 Codex 配置派生完成，默认模型 ${resolvedModel}`,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      summary:
        error instanceof Error
          ? `Hermes Agent 就绪检查失败：${error.message}`
          : "Hermes Agent 就绪检查失败",
    };
  }
}

async function startHeartbeatLoop() {
  while (true) {
    try {
      await sendHeartbeat(
        currentStatus,
        currentStatus === "online"
          ? `${runtimeLabel} Hermes Agent runner 心跳正常`
          : currentStatus === "busy"
            ? `${runtimeLabel} Hermes Agent runner 正在执行任务`
            : currentStatus === "unhealthy"
              ? `${runtimeLabel} Hermes Agent runner 处于异常状态`
              : `${runtimeLabel} Hermes Agent runner 处于维护状态`,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("未找到目标 Docker runner。") ||
          error.message.includes("未找到目标 runner。"))
      ) {
        try {
          await logLine("runner record is missing, re-registering before next heartbeat");
          await registerRunner(
            `${runtimeLabel} Hermes Agent runner 已重新注册，恢复心跳`,
            currentStatus,
          );
        } catch (registerError) {
          await logLine(
            `runner re-register failed: ${
              registerError instanceof Error ? registerError.message : "unknown error"
            }`,
          );
        }
      }

      await logLine(
        `heartbeat failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    await sleep(heartbeatIntervalMs);
  }
}

async function pullNextTask() {
  if (!deviceId) return null;
  const result = await postJson("/api/worker/tasks/next", {
    deviceId,
  });

  return result?.task ?? null;
}

async function runHermesForTask(task) {
  const prompt = task.prompt;

  if (taskCommand) {
    return shell(taskCommand);
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(
      hermesBin,
      [
        "chat",
        "--model",
        resolvedModel,
        "--quiet",
        "--yolo",
        "-q",
        prompt,
      ],
      {
        cwd: workdir,
        env: {
          ...process.env,
          HERMES_HOME: hermesHome,
          HERMES_CONFIG: configPath,
          OPENAI_API_KEY: resolvedApiKey,
          OPENAI_BASE_URL: resolvedBaseUrl,
          COLA_TASK_ID: task.id,
          COLA_TASK_TITLE: task.title,
          COLA_TASK_SUMMARY: task.summary,
          COLA_TASK_TYPE: task.taskType,
          COLA_TASK_PRIORITY: task.priority,
          COLA_TASK_RISK_LEVEL: task.riskLevel,
          COLA_TASK_PROMPT: prompt,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", async (chunk) => {
      const text = chunk.toString();
      stdout += text;
      await appendFile(sessionLogPath, text);
    });

    child.stderr.on("data", async (chunk) => {
      const text = chunk.toString();
      stderr += text;
      await appendFile(sessionLogPath, text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(
          new Error(
            stderr.trim() || stdout.trim() || `hermes exited with code ${code}`,
          ),
        );
      }
    });
  });
}

async function runTask(task) {
  currentStatus = "busy";
  await logLine(`claimed task ${task.id}: ${task.title}`);
  await reportTaskSession(task.id, "starting");

  try {
    await reportTaskSession(task.id, "running");
    const result = await runHermesForTask(task);
    await writeFile(
      resultPath,
      JSON.stringify(
        {
          taskId: task.id,
          title: task.title,
          completedAt: new Date().toISOString(),
          result,
        },
        null,
        2,
      ),
    );
    currentStatus = "online";
    await reportTaskSession(task.id, "succeeded");
    await logLine(`task ${task.id} finished successfully`);
  } catch (error) {
    currentStatus = "unhealthy";
    await reportTaskSession(task.id, "failed");
    await logLine(
      `task ${task.id} failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

async function startTaskLoop() {
  if (isTaskLoopRunning) return;
  isTaskLoopRunning = true;

  while (true) {
    try {
      if (deviceId && currentStatus === "online") {
        const task = await pullNextTask();
        if (task) {
          await runTask(task);
        }
      }
    } catch (error) {
      await logLine(
        `task loop failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    await sleep(taskPollIntervalMs);
  }
}

async function runBootCommand() {
  if (!bootCommand) return;

  await logLine(`boot command detected: ${bootCommand}`);

  if (bootTaskId) {
    await reportSession("starting");
  }

  currentStatus = "busy";

  const child = spawn("sh", ["-lc", bootCommand], {
    cwd: workdir,
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      HERMES_CONFIG: configPath,
      OPENAI_API_KEY: resolvedApiKey,
      OPENAI_BASE_URL: resolvedBaseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", async (chunk) => {
    await appendFile(sessionLogPath, chunk.toString());
  });

  child.stderr.on("data", async (chunk) => {
    await appendFile(sessionLogPath, chunk.toString());
  });

  child.on("close", async (code) => {
    if (code === 0) {
      currentStatus = "online";
      await reportSession("succeeded");
      await logLine("boot command completed successfully");
    } else {
      currentStatus = "unhealthy";
      await reportSession("failed");
      await logLine(`boot command failed with code ${code ?? -1}`);
    }
  });
}

async function main() {
  await ensureLogDir();
  await logLine(`starting ${runtimeLabel} Hermes Agent bootstrap`);

  const probe = await probeHermes();
  await registerRunner(probe.summary, probe.status);
  currentStatus = probe.status;

  await logLine(`runner registered as ${deviceId} with status ${probe.status}`);

  if (bootCommand) {
    await runBootCommand();
  }

  await Promise.all([startHeartbeatLoop(), startTaskLoop()]);
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : "unknown bootstrap error";
  try {
    await ensureLogDir();
    await logLine(`bootstrap fatal: ${message}`);
  } catch {
    console.error(message);
  }
  process.exitCode = 1;
});
