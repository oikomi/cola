import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const apiBaseUrl =
  process.env.COLA_API_BASE_URL ?? "http://host.docker.internal:50038";
const runnerName = process.env.COLA_RUNNER_NAME ?? "OpenClaw Runner";
const resourcePool = process.env.COLA_RESOURCE_POOL ?? "docker-core";
const runnerRuntime = process.env.COLA_RUNNER_RUNTIME ?? "kubernetes";
const runtimeLabel =
  runnerRuntime === "kubernetes" ? "Kubernetes" : "Docker";
const runnerHost = process.env.COLA_RUNNER_HOST ?? "kubernetes";
const image =
  process.env.COLA_RUNNER_IMAGE ?? process.env.OPENCLAW_IMAGE ?? "unknown-image";
const containerName =
  process.env.HOSTNAME ?? process.env.COLA_CONTAINER_NAME ?? runnerName;
const configPath =
  process.env.COLA_CODEX_CONFIG_PATH ??
  process.env.OPENCLAW_CODEX_CONFIG_PATH ??
  process.env.OPENCLAW_CONFIG_PATH ??
  path.join(homedir(), ".codex", "config.toml");
const authPath =
  process.env.COLA_CODEX_AUTH_PATH ??
  process.env.OPENCLAW_CODEX_AUTH_PATH ??
  process.env.OPENCLAW_AUTH_PATH ??
  path.join(homedir(), ".codex", "auth.json");
const heartbeatIntervalMs = Number(
  process.env.COLA_HEARTBEAT_INTERVAL_MS ?? "15000",
);
const readyCommand =
  process.env.OPENCLAW_READY_COMMAND ?? "openclaw config validate";
const bootCommand = process.env.OPENCLAW_BOOT_COMMAND;
const bootTaskId = process.env.OPENCLAW_BOOT_TASK_ID;
const bootAgentId = process.env.OPENCLAW_BOOT_AGENT_ID;
const agentId = process.env.COLA_AGENT_ID ?? "";
const taskPollIntervalMs = Number(
  process.env.COLA_TASK_POLL_INTERVAL_MS ?? "10000",
);
const openClawThinking = process.env.OPENCLAW_AGENT_THINKING ?? "high";
const taskCommand = process.env.OPENCLAW_TASK_COMMAND;
const workdir = process.env.OPENCLAW_WORKDIR ?? "/workspace";
const logDir = process.env.OPENCLAW_LOG_DIR ?? "/workspace/.openclaw-runner";
const sessionLogPath = path.join(logDir, "bootstrap.log");
const generatedOpenClawConfigPath =
  process.env.OPENCLAW_GENERATED_CONFIG_PATH ?? "/tmp/openclaw.generated.json";
const openClawStateDir =
  process.env.OPENCLAW_STATE_DIR ?? path.join(homedir(), ".openclaw");
const openClawDefaultConfigPath =
  process.env.OPENCLAW_DEFAULT_CONFIG_PATH ??
  path.join(openClawStateDir, "openclaw.json");
const openClawWorkspaceDir =
  process.env.OPENCLAW_WORKSPACE_DIR ?? path.join(openClawStateDir, "workspace");
const openClawMainAgentDir = path.join(openClawStateDir, "agents", "main", "agent");
const openClawMainSessionsDir = path.join(
  openClawStateDir,
  "agents",
  "main",
  "sessions",
);
const openClawAuthProfilesPath = path.join(
  openClawMainAgentDir,
  "auth-profiles.json",
);
const openClawSessionsIndexPath = path.join(
  openClawMainSessionsDir,
  "sessions.json",
);
const openClawBootstrapPath = path.join(openClawWorkspaceDir, "BOOTSTRAP.md");
const openClawIdentityPath = path.join(openClawWorkspaceDir, "IDENTITY.md");
const openClawUserPath = path.join(openClawWorkspaceDir, "USER.md");
const colaAgentName = process.env.COLA_AGENT_NAME?.trim() || "OpenClaw Agent";
const colaRoleLabel = process.env.COLA_AGENT_ROLE_LABEL?.trim() || "执行";
const colaWorkspaceOwnerName =
  process.env.COLA_WORKSPACE_OWNER_NAME?.trim() || "Cola Operator";
const workspaceBootstrapPollIntervalMs = Number(
  process.env.OPENCLAW_WORKSPACE_BOOTSTRAP_POLL_INTERVAL_MS ?? "5000",
);
const prepareOnly = process.argv.includes("--prepare-only");

let deviceId = "";
let sessionId = "";
let currentStatus = "maintenance";
let isTaskLoopRunning = false;
let resolvedModelRef = "openai/gpt-5.4";

function extractQuotedValue(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*\"([^\"]+)\"$`, "m"));
  return match?.[1] ?? null;
}

function mapWireApiToOpenClawApi(wireApi) {
  switch (wireApi) {
    case "responses":
      return "openai-responses";
    case "codex-responses":
      return "openai-codex-responses";
    case "completions":
      return "openai-completions";
    default:
      return "openai-responses";
  }
}

function readJsonIfExists(filePath, fallbackValue) {
  if (!existsSync(filePath)) return fallbackValue;

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function loadCodexModelConfig() {
  const configText = readFileSync(configPath, "utf8");
  const auth = JSON.parse(readFileSync(authPath, "utf8"));

  const providerName =
    extractQuotedValue(configText, "model_provider") ?? "OpenAI";
  const model = extractQuotedValue(configText, "model") ?? "gpt-5.4";
  const reasoningEffort =
    extractQuotedValue(configText, "model_reasoning_effort") ?? "high";

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

  const providerId = providerName.toLowerCase();
  const apiKey = auth.OPENAI_API_KEY ?? auth.api_key ?? auth.token ?? null;

  if (!apiKey) {
    throw new Error("auth.json 中未找到可用的 OPENAI_API_KEY。");
  }

  const openClawConfig = {
    models: {
      mode: "replace",
      providers: {
        [providerId]: {
          baseUrl,
          apiKey,
          auth: "api-key",
          api: mapWireApiToOpenClawApi(wireApi),
          models: [
            {
              id: model,
              name: model,
              api: mapWireApiToOpenClawApi(wireApi),
              reasoning: true,
              input: ["text"],
            },
          ],
        },
      },
    },
    env: {
      vars: {
        OPENAI_API_KEY: apiKey,
      },
    },
  };

  return {
    providerId,
    model,
    reasoningEffort,
    apiKey,
    config: openClawConfig,
  };
}

async function ensureOpenClawAuthProfiles(modelConfig) {
  await mkdir(openClawMainAgentDir, { recursive: true });

  let authProfiles = {
    version: 1,
    profiles: {},
  };

  if (existsSync(openClawAuthProfilesPath)) {
    try {
      const parsed = JSON.parse(readFileSync(openClawAuthProfilesPath, "utf8"));
      if (parsed && typeof parsed === "object") {
        authProfiles = {
          version:
            typeof parsed.version === "number" && Number.isFinite(parsed.version)
              ? parsed.version
              : 1,
          profiles:
            parsed.profiles && typeof parsed.profiles === "object"
              ? parsed.profiles
              : {},
        };
      }
    } catch {
      authProfiles = {
        version: 1,
        profiles: {},
      };
    }
  }

  authProfiles.profiles[`${modelConfig.providerId}:default`] = {
    type: "api_key",
    provider: modelConfig.providerId,
    key: modelConfig.apiKey,
  };

  await writeFile(
    openClawAuthProfilesPath,
    JSON.stringify(authProfiles, null, 2),
  );
}

async function resetMainSessionsAfterBootstrap() {
  await mkdir(openClawMainSessionsDir, { recursive: true });

  const entries = existsSync(openClawMainSessionsDir)
    ? readJsonIfExists(openClawSessionsIndexPath, {})
    : {};
  const sessionFiles =
    entries &&
    typeof entries === "object" &&
    entries["agent:main:main"] &&
    typeof entries["agent:main:main"] === "object" &&
    typeof entries["agent:main:main"].sessionFile === "string"
      ? [entries["agent:main:main"].sessionFile]
      : [];

  for (const sessionFile of sessionFiles) {
    await rm(sessionFile, { force: true });
    await rm(`${sessionFile}.lock`, { force: true });
  }

  await writeFile(openClawSessionsIndexPath, "{}");
  await logLine("reset OpenClaw main session cache after bootstrap");
}

async function prepareOpenClawConfig() {
  const modelConfig = loadCodexModelConfig();
  resolvedModelRef = `${modelConfig.providerId}/${modelConfig.model}`;
  await ensureOpenClawAuthProfiles(modelConfig);

  const existingConfig = readJsonIfExists(openClawDefaultConfigPath, {});
  const mergedConfig = {
    ...(existingConfig && typeof existingConfig === "object"
      ? existingConfig
      : {}),
    models: modelConfig.config.models,
    env: modelConfig.config.env,
  };

  await writeFile(
    generatedOpenClawConfigPath,
    JSON.stringify(mergedConfig, null, 2),
  );

  return modelConfig;
}

function buildIdentityMarkdown() {
  return `# IDENTITY.md - Who Am I?

- **Name:** ${colaAgentName}
- **Creature:** Cola ${colaRoleLabel} Agent
- **Vibe:** Direct, capable, calm
- **Emoji:** 🤖
- **Avatar:** _(workspace-relative path, http(s) URL, or data URI)_

## Context

- You are the OpenClaw-native workspace for ${colaAgentName}.
- You operate as the ${colaRoleLabel} role inside Cola Virtual Office.
- Keep execution grounded in the mounted \`/workspace\` directory when working on tasks.
`;
}

function buildUserMarkdown() {
  return `# USER.md - About Your Human

- **Name:** ${colaWorkspaceOwnerName}
- **What to call them:** ${colaWorkspaceOwnerName}
- **Pronouns:** _(optional)_
- **Timezone:** _(learn and update when confirmed)_
- **Notes:**
  - You are helping the Cola operator through the native OpenClaw dashboard.
  - Default to Chinese when the user speaks Chinese.
  - Keep responses concise and execution-oriented unless they ask for depth.

## Context

- This workspace is attached to Cola Virtual Office.
- ${colaAgentName} is the active persona for this runner.
- Use \`/workspace\` as the execution directory for project files and task work.
`;
}

async function completeWorkspaceBootstrapIfNeeded() {
  await mkdir(openClawWorkspaceDir, { recursive: true });

  if (!existsSync(openClawBootstrapPath)) {
    return false;
  }

  await writeFile(openClawIdentityPath, buildIdentityMarkdown());
  await writeFile(openClawUserPath, buildUserMarkdown());
  await rm(openClawBootstrapPath, { force: true });
  await resetMainSessionsAfterBootstrap();
  await logLine(
    `completed OpenClaw workspace bootstrap for ${colaAgentName}`,
  );
  return true;
}

async function startWorkspaceBootstrapLoop() {
  while (true) {
    try {
      await completeWorkspaceBootstrapIfNeeded();
    } catch (error) {
      await logLine(
        `workspace bootstrap sync failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }

    await sleep(workspaceBootstrapPollIntervalMs);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function ensureLogDir() {
  await mkdir(logDir, { recursive: true });
}

async function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await appendFile(sessionLogPath, line);
  console.log(message);
}

async function shell(command) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], {
      cwd: workdir,
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: generatedOpenClawConfigPath,
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
            stderr.trim() ||
              stdout.trim() ||
              `Command exited with code ${code}`,
          ),
        );
      }
    });
  });
}

async function registerRunner(healthSummary, status = "online") {
  const result = await postJson("/api/worker/register", {
    name: runnerName,
    resourcePool,
    status,
    engine: "openclaw",
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
    engine: "openclaw",
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

async function probeOpenClaw() {
  if (!existsSync(configPath) || !existsSync(authPath)) {
    return {
      status: "unhealthy",
      summary: "缺少 ~/.codex/config.toml 或 ~/.codex/auth.json 挂载",
    };
  }

  try {
    await prepareOpenClawConfig();
    await shell(readyCommand);
    return {
      status: "online",
      summary: `OpenClaw 配置校验通过，runner 已就绪，默认模型 ${resolvedModelRef}`,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      summary:
        error instanceof Error
          ? `OpenClaw 就绪检查失败：${error.message}`
          : "OpenClaw 就绪检查失败",
    };
  }
}

async function startHeartbeatLoop() {
  while (true) {
    try {
      await sendHeartbeat(
        currentStatus,
        currentStatus === "online"
          ? `${runtimeLabel} OpenClaw runner 心跳正常`
          : currentStatus === "busy"
            ? `${runtimeLabel} OpenClaw runner 正在执行任务`
            : currentStatus === "unhealthy"
              ? `${runtimeLabel} OpenClaw runner 处于异常状态`
              : `${runtimeLabel} OpenClaw runner 处于维护状态`,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("未找到目标 runner。")
      ) {
        try {
          await logLine("runner record is missing, re-registering before next heartbeat");
          await registerRunner(
            `${runtimeLabel} OpenClaw runner 已重新注册，恢复心跳`,
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

async function runOpenClawForTask(task) {
  const prompt = task.prompt;

  if (taskCommand) {
    return shell(taskCommand);
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(
      "openclaw",
      [
        "infer",
        "model",
        "run",
        "--local",
        "--json",
        "--model",
        resolvedModelRef,
        "--prompt",
        prompt,
      ],
      {
        cwd: workdir,
        env: {
          ...process.env,
          OPENCLAW_CONFIG_PATH: generatedOpenClawConfigPath,
          COLA_TASK_ID: task.id,
          COLA_TASK_TITLE: task.title,
          COLA_TASK_SUMMARY: task.summary,
          COLA_TASK_TYPE: task.taskType,
          COLA_TASK_PRIORITY: task.priority,
          COLA_TASK_RISK_LEVEL: task.riskLevel,
          COLA_TASK_PROMPT: prompt,
          OPENCLAW_AGENT_THINKING: openClawThinking,
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
            stderr.trim() ||
              stdout.trim() ||
              `openclaw exited with code ${code}`,
          ),
        );
      }
    });
  });
}

async function runTask(task) {
  const taskResultPath = path.join(logDir, `result-${task.id}.json`);
  currentStatus = "busy";
  await logLine(`claimed task ${task.id}: ${task.title}`);
  await reportTaskSession(task.id, "starting", {
    artifactPath: taskResultPath,
  });

  try {
    await reportTaskSession(task.id, "running", {
      artifactPath: taskResultPath,
    });
    const result = await runOpenClawForTask(task);
    await writeFile(
      taskResultPath,
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
    await reportTaskSession(task.id, "succeeded", {
      artifactPath: taskResultPath,
    });
    await logLine(`task ${task.id} finished successfully`);
  } catch (error) {
    currentStatus = "unhealthy";
    await reportTaskSession(task.id, "failed", {
      artifactPath: taskResultPath,
    });
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
      currentStatus = "unhealthy";
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
      OPENCLAW_CONFIG_PATH: generatedOpenClawConfigPath,
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
  await logLine(`starting ${runtimeLabel} OpenClaw bootstrap`);
  await completeWorkspaceBootstrapIfNeeded();

  if (prepareOnly) {
    await prepareOpenClawConfig();
    await logLine(
      `prepared OpenClaw config for gateway with model ${resolvedModelRef}`,
    );
    return;
  }

  const probe = await probeOpenClaw();
  await registerRunner(probe.summary, probe.status);
  currentStatus = probe.status;

  await logLine(`runner registered as ${deviceId} with status ${probe.status}`);

  if (bootCommand) {
    await runBootCommand();
  }

  await Promise.all([
    startWorkspaceBootstrapLoop(),
    startHeartbeatLoop(),
    startTaskLoop(),
  ]);
}

main().catch(async (error) => {
  const message =
    error instanceof Error ? error.message : "unknown bootstrap error";
  try {
    await ensureLogDir();
    await logLine(`bootstrap fatal: ${message}`);
  } catch {
    console.error(message);
  }
  process.exit(1);
});
