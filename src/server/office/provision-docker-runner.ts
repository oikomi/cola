import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  dockerRunnerEngineLabels,
  type DockerRunnerEngine,
} from "@/server/office/catalog";

const execFileAsync = promisify(execFile);

function slugify(input: string) {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return slug || "agent";
}

export type ProvisionDockerRunnerInput = {
  agentId: string;
  agentName: string;
  runnerName: string;
  roleLabel: string;
  resourcePool: string;
  engine: DockerRunnerEngine;
};

export type ProvisionDockerRunnerResult = {
  success: boolean;
  containerName: string;
  image: string;
  host: string;
  healthSummary: string;
  nativeDashboardUrl: string | null;
  errorMessage?: string;
};

type DockerLaunchConfig = {
  image: string;
  host: string;
  workspaceRoot: string;
  dashboardContainerPort: number;
  dashboardHostPort: number;
  args: string[];
  missingPaths: string[];
  missingMessage: string;
};

const OPENCLAW_DASHBOARD_PORT_START = 18789;
const OPENCLAW_DASHBOARD_CONTAINER_PORT = 18789;
const HERMES_DASHBOARD_PORT_START = 19119;
const HERMES_DASHBOARD_CONTAINER_PORT = 9119;

function dashboardBindHost() {
  return process.env.COLA_DASHBOARD_BIND_HOST ?? "127.0.0.1";
}

function dashboardPublicHost(engine: DockerRunnerEngine) {
  if (engine === "hermes-agent") {
    return (
      process.env.COLA_HERMES_DASHBOARD_PUBLIC_HOST ??
      process.env.COLA_DASHBOARD_PUBLIC_HOST ??
      null
    );
  }

  return (
    process.env.COLA_OPENCLAW_DASHBOARD_PUBLIC_HOST ??
    process.env.COLA_DASHBOARD_PUBLIC_HOST ??
    null
  );
}

function publishPortArg(hostPort: number, containerPort: number) {
  const bindHost = dashboardBindHost();
  return bindHost === "0.0.0.0"
    ? `${hostPort}:${containerPort}`
    : `${bindHost}:${hostPort}:${containerPort}`;
}

function uniqueOrigins(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function extractOrigin(urlValue: string | undefined) {
  if (!urlValue) return null;

  try {
    return new URL(urlValue).origin;
  } catch {
    return null;
  }
}

function openClawAllowedOrigins(dashboardHostPort: number) {
  const publicHost = dashboardPublicHost("openclaw");
  return uniqueOrigins([
    `http://localhost:${dashboardHostPort}`,
    `http://127.0.0.1:${dashboardHostPort}`,
    publicHost ? `http://${publicHost}:${dashboardHostPort}` : null,
    publicHost ? `https://${publicHost}:${dashboardHostPort}` : null,
    extractOrigin(process.env.NEXT_PUBLIC_OPENCLAW_NATIVE_URL),
    ...((process.env.COLA_DASHBOARD_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)),
  ]);
}

function openClawDisableDeviceIdentity() {
  const raw = process.env.COLA_OPENCLAW_DISABLE_DEVICE_IDENTITY;
  if (!raw) return false;

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

async function isPortAvailable(port: number) {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, "127.0.0.1");
  });
}

async function getReservedDockerHostPorts() {
  try {
    const { stdout: idsOutput } = await execFileAsync("docker", ["ps", "-aq"]);
    const containerIds = idsOutput
      .trim()
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (containerIds.length === 0) {
      return new Set<number>();
    }

    const { stdout: inspectOutput } = await execFileAsync("docker", [
      "inspect",
      ...containerIds,
    ]);
    const containers = JSON.parse(inspectOutput) as Array<{
      HostConfig?: {
        PortBindings?: Record<
          string,
          Array<{ HostPort?: string | null }> | null
        >;
      };
    }>;

    const reservedPorts = new Set<number>();

    for (const container of containers) {
      const portBindings = container.HostConfig?.PortBindings;
      if (!portBindings) continue;

      for (const bindings of Object.values(portBindings)) {
        if (!bindings) continue;

        for (const binding of bindings) {
          const hostPort = Number(binding.HostPort);
          if (Number.isInteger(hostPort) && hostPort > 0) {
            reservedPorts.add(hostPort);
          }
        }
      }
    }

    return reservedPorts;
  } catch {
    return new Set<number>();
  }
}

async function findAvailablePort(startPort: number) {
  const reservedPorts = await getReservedDockerHostPorts();

  for (let port = startPort; port < startPort + 200; port += 1) {
    if (reservedPorts.has(port)) continue;
    if (await isPortAvailable(port)) return port;
  }

  throw new Error(`无法找到可用端口，起始端口 ${startPort}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveOpenClawDashboardUrl(
  containerName: string,
  dashboardHostPort: number,
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("docker", [
        "exec",
        containerName,
        "sh",
        "-lc",
        "openclaw dashboard --no-open",
      ]);
      const dashboardUrl = stdout
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("Dashboard URL: "));

      if (dashboardUrl) {
        const parsedUrl = dashboardUrl.replace("Dashboard URL: ", "").trim();
        const publicHost = dashboardPublicHost("openclaw");
        if (publicHost) {
          return parsedUrl.replace(
            /^http:\/\/127\.0\.0\.1:18789\//,
            `http://${publicHost}:${dashboardHostPort}/`,
          );
        }
        return parsedUrl.replace(
          /^http:\/\/127\.0\.0\.1:18789\//,
          `http://127.0.0.1:${dashboardHostPort}/`,
        );
      }
    } catch {
      // The gateway may still be booting, so retry a few times.
    }

    await sleep(400);
  }

  const publicHost = dashboardPublicHost("openclaw");
  return publicHost
    ? `http://${publicHost}:${dashboardHostPort}/`
    : `http://127.0.0.1:${dashboardHostPort}/`;
}

function defaultApiBaseUrl() {
  return (
    process.env.COLA_API_BASE_URL ??
    `http://host.docker.internal:${process.env.PORT ?? "50038"}`
  );
}

function openClawConfig(
  input: ProvisionDockerRunnerInput,
  containerName: string,
  dashboardHostPort: number,
): DockerLaunchConfig {
  const configPath =
    process.env.OPENCLAW_CONFIG_PATH ??
    path.join(homedir(), ".codex", "config.toml");
  const authPath =
    process.env.OPENCLAW_AUTH_PATH ??
    path.join(homedir(), ".codex", "auth.json");
  const configDir = path.dirname(configPath);
  const image =
    process.env.OPENCLAW_IMAGE ?? "ghcr.io/openclaw/openclaw:latest";
  const workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT ?? process.cwd();
  const host = process.env.COLA_RUNNER_HOST ?? "host.docker.internal";
  const configPatches: Array<{
    path: string;
    value: string | string[] | boolean;
  }> = [
    { path: "gateway.mode", value: "local" },
    { path: "gateway.bind", value: "lan" },
    {
      path: "gateway.controlUi.allowedOrigins",
      value: openClawAllowedOrigins(dashboardHostPort),
    },
  ];

  if (openClawDisableDeviceIdentity()) {
    configPatches.push({
      path: "gateway.controlUi.dangerouslyDisableDeviceAuth",
      value: true,
    });
  }

  const batchConfig = JSON.stringify(configPatches);
  const commandOverride =
    process.env.OPENCLAW_DOCKER_COMMAND ??
    `openclaw config set --batch-json '${batchConfig}' --strict-json >/tmp/openclaw-config.log 2>&1 && ((if command -v node >/dev/null 2>&1; then node /workspace/scripts/openclaw-runner/bootstrap.mjs; elif command -v bun >/dev/null 2>&1; then bun /workspace/scripts/openclaw-runner/bootstrap.mjs; else echo "Missing node/bun runtime for bootstrap" >&2; exit 1; fi) >/tmp/openclaw-bootstrap.log 2>&1 &) && exec openclaw gateway --allow-unconfigured --bind lan --port ${OPENCLAW_DASHBOARD_CONTAINER_PORT}`;

  return {
    image,
    host,
    workspaceRoot,
    dashboardContainerPort: OPENCLAW_DASHBOARD_CONTAINER_PORT,
    dashboardHostPort,
    missingPaths: [configPath, authPath],
    missingMessage: "缺少 ~/.codex/config.toml 或 ~/.codex/auth.json",
    args: [
      "run",
      "-d",
      "--name",
      containerName,
      "--restart",
      "unless-stopped",
      "-p",
      publishPortArg(dashboardHostPort, OPENCLAW_DASHBOARD_CONTAINER_PORT),
      "-v",
      `${workspaceRoot}:/workspace`,
      "-v",
      `${configDir}:/home/node/.codex:ro`,
      "-e",
      `COLA_API_BASE_URL=${defaultApiBaseUrl()}`,
      "-e",
      `COLA_RUNNER_NAME=${input.runnerName}`,
      "-e",
      `COLA_RESOURCE_POOL=${input.resourcePool}`,
      "-e",
      `COLA_RUNNER_HOST=${host}`,
      "-e",
      "COLA_RUNNER_ENGINE=openclaw",
      "-e",
      "COLA_CODEX_CONFIG_PATH=/home/node/.codex/config.toml",
      "-e",
      "COLA_CODEX_AUTH_PATH=/home/node/.codex/auth.json",
      "-e",
      `COLA_AGENT_ID=${input.agentId}`,
      "-e",
      `COLA_RUNNER_IMAGE=${image}`,
      image,
      "sh",
      "-lc",
      commandOverride,
    ],
  };
}

function hermesConfig(
  input: ProvisionDockerRunnerInput,
  containerName: string,
  dashboardHostPort: number,
): DockerLaunchConfig {
  const codexConfigPath =
    process.env.HERMES_CODEX_CONFIG_PATH ??
    process.env.OPENCLAW_CONFIG_PATH ??
    path.join(homedir(), ".codex", "config.toml");
  const codexAuthPath =
    process.env.HERMES_CODEX_AUTH_PATH ??
    process.env.OPENCLAW_AUTH_PATH ??
    path.join(homedir(), ".codex", "auth.json");
  const codexDir = path.dirname(codexConfigPath);
  const image =
    process.env.HERMES_AGENT_IMAGE ??
    process.env.HERMES_IMAGE ??
    "nousresearch/hermes-agent:latest";
  const workspaceRoot = process.env.HERMES_WORKSPACE_ROOT ?? process.cwd();
  const host = process.env.COLA_RUNNER_HOST ?? "host.docker.internal";
  const hermesBin =
    process.env.HERMES_BIN_IN_CONTAINER ?? "/opt/hermes/.venv/bin/hermes";
  const commandOverride =
    process.env.HERMES_DOCKER_COMMAND ??
    `((if command -v node >/dev/null 2>&1; then node /workspace/scripts/hermes-runner/bootstrap.mjs; elif command -v bun >/dev/null 2>&1; then bun /workspace/scripts/hermes-runner/bootstrap.mjs; else echo "Missing node/bun runtime for bootstrap" >&2; exit 1; fi) >/tmp/hermes-bootstrap.log 2>&1 &) && exec ${hermesBin} dashboard --host 0.0.0.0 --port ${HERMES_DASHBOARD_CONTAINER_PORT} --no-open --insecure`;

  return {
    image,
    host,
    workspaceRoot,
    dashboardContainerPort: HERMES_DASHBOARD_CONTAINER_PORT,
    dashboardHostPort,
    missingPaths: [codexConfigPath, codexAuthPath],
    missingMessage: "缺少 ~/.codex/config.toml 或 ~/.codex/auth.json",
    args: [
      "run",
      "-d",
      "--name",
      containerName,
      "--restart",
      "unless-stopped",
      "--entrypoint",
      "sh",
      "-p",
      publishPortArg(dashboardHostPort, HERMES_DASHBOARD_CONTAINER_PORT),
      "-v",
      `${workspaceRoot}:/workspace`,
      "-v",
      `${codexDir}:/home/node/.codex:ro`,
      "-e",
      `COLA_API_BASE_URL=${defaultApiBaseUrl()}`,
      "-e",
      `COLA_RUNNER_NAME=${input.runnerName}`,
      "-e",
      `COLA_RESOURCE_POOL=${input.resourcePool}`,
      "-e",
      `COLA_RUNNER_HOST=${host}`,
      "-e",
      "COLA_RUNNER_ENGINE=hermes-agent",
      "-e",
      "HERMES_HOME=/tmp/hermes-home",
      "-e",
      "HERMES_CODEX_CONFIG_PATH=/home/node/.codex/config.toml",
      "-e",
      "HERMES_CODEX_AUTH_PATH=/home/node/.codex/auth.json",
      "-e",
      `HERMES_BIN=${hermesBin}`,
      "-e",
      `COLA_AGENT_ID=${input.agentId}`,
      "-e",
      `HERMES_AGENT_IMAGE=${image}`,
      image,
      "-lc",
      commandOverride,
    ],
  };
}

function buildLaunchConfig(
  input: ProvisionDockerRunnerInput,
  containerName: string,
  dashboardHostPort: number,
): DockerLaunchConfig {
  switch (input.engine) {
    case "hermes-agent":
      return hermesConfig(input, containerName, dashboardHostPort);
    case "openclaw":
    default:
      return openClawConfig(input, containerName, dashboardHostPort);
  }
}

export async function provisionDockerRunner(
  input: ProvisionDockerRunnerInput,
): Promise<ProvisionDockerRunnerResult> {
  const engineLabel = dockerRunnerEngineLabels[input.engine];
  const containerName = `cola-${slugify(input.agentName)}-${input.agentId.slice(0, 8)}`;
  const dashboardHostPort = await findAvailablePort(
    input.engine === "hermes-agent"
      ? HERMES_DASHBOARD_PORT_START
      : OPENCLAW_DASHBOARD_PORT_START,
  );
  const launchConfig = buildLaunchConfig(
    input,
    containerName,
    dashboardHostPort,
  );
  const nativeDashboardUrl =
    input.engine === "openclaw"
      ? await resolveOpenClawDashboardUrl(
          containerName,
          launchConfig.dashboardHostPort,
        )
      : dashboardPublicHost("hermes-agent")
        ? `http://${dashboardPublicHost("hermes-agent")}:${launchConfig.dashboardHostPort}/`
        : `http://127.0.0.1:${launchConfig.dashboardHostPort}/`;
  const hasAllPaths = launchConfig.missingPaths.every((filePath) => existsSync(filePath));

  if (!hasAllPaths) {
    return {
      success: false,
      containerName,
      image: launchConfig.image,
      host: launchConfig.host,
      healthSummary: `${engineLabel} 配置或认证文件不存在，Docker runner 未启动。`,
      nativeDashboardUrl: null,
      errorMessage: launchConfig.missingMessage,
    };
  }

  try {
    await execFileAsync("docker", ["pull", launchConfig.image], {
      cwd: launchConfig.workspaceRoot,
    });
  } catch (error) {
    return {
      success: false,
      containerName,
      image: launchConfig.image,
      host: launchConfig.host,
      healthSummary: "Docker 镜像拉取失败，runner 未启动。",
      nativeDashboardUrl: null,
      errorMessage:
        error instanceof Error ? error.message : "未知 Docker 拉取错误",
    };
  }

  try {
    await execFileAsync("docker", launchConfig.args, {
      cwd: launchConfig.workspaceRoot,
    });

    return {
      success: true,
      containerName,
      image: launchConfig.image,
      host: launchConfig.host,
      healthSummary: `${input.roleLabel} runner 已在 Docker 中启动，等待 ${engineLabel} 自注册。`,
      nativeDashboardUrl,
    };
  } catch (error) {
    return {
      success: false,
      containerName,
      image: launchConfig.image,
      host: launchConfig.host,
      healthSummary: "Docker runner 拉起失败，角色已创建但进入阻塞态。",
      nativeDashboardUrl: null,
      errorMessage:
        error instanceof Error ? error.message : "未知 Docker 启动错误",
    };
  }
}
