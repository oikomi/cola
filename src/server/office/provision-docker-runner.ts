import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
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
  errorMessage?: string;
};

type DockerLaunchConfig = {
  image: string;
  host: string;
  workspaceRoot: string;
  args: string[];
  missingPaths: string[];
  missingMessage: string;
};

function defaultApiBaseUrl() {
  return (
    process.env.COLA_API_BASE_URL ??
    `http://host.docker.internal:${process.env.PORT ?? "3000"}`
  );
}

function openClawConfig(
  input: ProvisionDockerRunnerInput,
  containerName: string,
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
  const commandOverride =
    process.env.OPENCLAW_DOCKER_COMMAND ??
    "if command -v node >/dev/null 2>&1; then node /workspace/scripts/openclaw-runner/bootstrap.mjs; elif command -v bun >/dev/null 2>&1; then bun /workspace/scripts/openclaw-runner/bootstrap.mjs; else echo 'Missing node/bun runtime for bootstrap' >&2; sleep infinity; fi";

  return {
    image,
    host,
    workspaceRoot,
    missingPaths: [configPath, authPath],
    missingMessage: "缺少 ~/.codex/config.toml 或 ~/.codex/auth.json",
    args: [
      "run",
      "-d",
      "--name",
      containerName,
      "--restart",
      "unless-stopped",
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
      "OPENCLAW_CONFIG_PATH=/home/node/.codex/config.toml",
      "-e",
      "OPENCLAW_AUTH_PATH=/home/node/.codex/auth.json",
      "-e",
      `COLA_AGENT_ID=${input.agentId}`,
      "-e",
      `OPENCLAW_IMAGE=${image}`,
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
    "ghcr.io/nousresearch/hermes-agent:latest";
  const workspaceRoot = process.env.HERMES_WORKSPACE_ROOT ?? process.cwd();
  const host = process.env.COLA_RUNNER_HOST ?? "host.docker.internal";
  const hermesBin =
    process.env.HERMES_BIN_IN_CONTAINER ?? "/opt/hermes/.venv/bin/hermes";
  const commandOverride =
    process.env.HERMES_DOCKER_COMMAND ??
    "if command -v node >/dev/null 2>&1; then node /workspace/scripts/hermes-runner/bootstrap.mjs; elif command -v bun >/dev/null 2>&1; then bun /workspace/scripts/hermes-runner/bootstrap.mjs; else echo 'Missing node/bun runtime for bootstrap' >&2; sleep infinity; fi";

  return {
    image,
    host,
    workspaceRoot,
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
): DockerLaunchConfig {
  switch (input.engine) {
    case "hermes-agent":
      return hermesConfig(input, containerName);
    case "openclaw":
    default:
      return openClawConfig(input, containerName);
  }
}

export async function provisionDockerRunner(
  input: ProvisionDockerRunnerInput,
): Promise<ProvisionDockerRunnerResult> {
  const engineLabel = dockerRunnerEngineLabels[input.engine];
  const containerName = `cola-${slugify(input.agentName)}-${input.agentId.slice(0, 8)}`;
  const launchConfig = buildLaunchConfig(input, containerName);

  if (!launchConfig.missingPaths.every((filePath) => existsSync(filePath))) {
    return {
      success: false,
      containerName,
      image: launchConfig.image,
      host: launchConfig.host,
      healthSummary: `${engineLabel} 配置或认证文件不存在，Docker runner 未启动。`,
      errorMessage: launchConfig.missingMessage,
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
    };
  } catch (error) {
    return {
      success: false,
      containerName,
      image: launchConfig.image,
      host: launchConfig.host,
      healthSummary: "Docker runner 拉起失败，角色已创建但进入阻塞态。",
      errorMessage:
        error instanceof Error ? error.message : "未知 Docker 启动错误",
    };
  }
}
