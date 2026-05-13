import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Client } from "ssh2";
import type { ConnectConfig } from "ssh2";

import { env } from "@/env";
import {
  type DockerTargetArchitecture,
  buildDockerTargetArchitectureVariables,
  normalizeDockerTargetArchitecture,
} from "@/server/cmdb/deploy-architecture";
import type * as DbSchema from "@/server/db/schema";
import {
  cmdbAssets,
  cmdbProjects,
  cmdbReleases,
  type CmdbReleaseOperationLog,
  type CmdbProjectConfig,
} from "@/server/db/schema";
import {
  loadResourceOwnerMap,
  ownerForUserId,
} from "@/server/resource-owners";

export const cmdbDeployTargetValues = ["k8s", "ssh", "docker", "none"] as const;
export const cmdbAssetStatusValues = [
  "connected",
  "planned",
  "unknown",
] as const;
export const cmdbReleaseStatusValues = [
  "pending",
  "running",
  "success",
  "failed",
  "canceled",
] as const;

type Database = PostgresJsDatabase<typeof DbSchema>;
type CmdbAssetStatus = (typeof cmdbAssetStatusValues)[number];
type CmdbReleaseStatus = (typeof cmdbReleaseStatusValues)[number];
type CmdbAssetRow = typeof cmdbAssets.$inferSelect;
type CmdbProjectRow = typeof cmdbProjects.$inferSelect;
type CmdbReleaseRow = typeof cmdbReleases.$inferSelect;
type SshReadyAssetRow = CmdbAssetRow & {
  sshUser: string;
  sshPassword: string;
};
type DockerContainerPort = {
  containerPort: string;
  protocol: string | null;
  hostIp: string | null;
  hostPort: string | null;
  label: string;
};
type DockerContainerStatus = {
  id: string;
  name: string;
  image: string;
  state: string;
  running: boolean;
  health: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
  restartCount: number;
  exitCode: number | null;
  ports: DockerContainerPort[];
};
type CmdbDeploymentResult = {
  stdout: string;
  stderr: string;
  durationMs: number;
};

type GitLabProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string | null;
  web_url: string;
};

type GitLabPipeline = {
  id: number;
  status: string;
  web_url?: string | null;
};
type GitLabBranch = {
  name: string;
  default?: boolean;
  protected?: boolean;
  web_url?: string | null;
};
type GitLabJob = {
  id: number;
  name: string;
  status: string;
  artifacts_file?: {
    filename?: string | null;
    size?: number | null;
  } | null;
};
type ProjectHealthProbeResult = {
  status: "healthy" | "degraded" | "unknown";
  statusCode: number | null;
  responseTimeMs: number | null;
  message: string;
  checkedAt: Date;
  url: string | null;
  method: "GET";
  timeoutMs: number;
  contentType: string | null;
  errorType: string | null;
  errorDetail: string | null;
  responsePreview: string | null;
};

const HEALTH_CHECK_TIMEOUT_MS = 2500;
const HEALTH_RESPONSE_PREVIEW_LENGTH = 600;
const CMDB_DEPLOYING_GITLAB_STATUS = "cmdb_deploying";
const DOCKER_DEFAULT_RESTART_POLICY = "unless-stopped";
const SHELL_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CMDB_ASSET_SSH_CHECK_INTERVAL_MS = 60_000;
const MAX_RELEASE_OPERATION_LOGS = 80;
const CMDB_ASSET_SSH_CHECK_CONCURRENCY = 3;

const cmdbAssetSshMonitor = (() => {
  const globalForMonitor = globalThis as unknown as {
    cmdbAssetSshMonitor?: {
      running: boolean;
      timer: ReturnType<typeof setInterval> | null;
    };
  };

  globalForMonitor.cmdbAssetSshMonitor ??= {
    running: false,
    timer: null,
  };

  return globalForMonitor.cmdbAssetSshMonitor;
})();

export type CmdbProjectTerminalTarget = {
  projectId: number;
  projectName: string;
  deployTarget: CmdbProjectRow["deployTarget"];
  targetAssetName: string;
  host: string;
  sshUser: string;
  sshPort: number;
  sshConfig: ConnectConfig;
  containerName: string | null;
  remoteCommand: string | null;
};

function gitlabBaseUrl() {
  return env.GITLAB_URL?.replace(/\/+$/, "") ?? null;
}

function gitlabApiBaseUrl() {
  const baseUrl = gitlabBaseUrl();
  return baseUrl ? `${baseUrl}/api/v4` : null;
}

function hasGitLabApiAccess() {
  return Boolean(gitlabApiBaseUrl() && env.GITLAB_API_TOKEN);
}

function hasGitLabTriggerSupport() {
  return Boolean(gitlabApiBaseUrl());
}

function cleanString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorDetail(error: unknown) {
  if (!(error instanceof Error)) return "未知错误";

  const cause = error.cause;
  if (!isRecord(cause)) return error.message;

  const causeParts = [
    typeof cause.code === "string" ? cause.code : null,
    typeof cause.syscall === "string" ? cause.syscall : null,
    typeof cause.hostname === "string" ? cause.hostname : null,
    typeof cause.address === "string" ? cause.address : null,
    typeof cause.port === "number" ? String(cause.port) : null,
  ].filter(Boolean);

  return causeParts.length > 0
    ? `${error.message} (${causeParts.join(" · ")})`
    : error.message;
}

function buildGitLabProjectUrl(
  projectPath: string,
  fallbackUrl?: string | null,
) {
  if (fallbackUrl) return fallbackUrl;

  const baseUrl = gitlabBaseUrl();
  if (!baseUrl) return null;

  return `${baseUrl}/${projectPath}`;
}

function normalizeAssetRoles(roles: string[] | null | undefined) {
  return Array.from(
    new Set(
      (roles ?? [])
        .map((role) => cleanString(role))
        .filter((role): role is string => Boolean(role)),
    ),
  );
}

function normalizeTargetAssetNames(
  assetNames: string[] | null | undefined,
  fallbackName?: string | null,
) {
  const normalized = [
    ...(assetNames ?? []),
    ...(fallbackName ? [fallbackName] : []),
  ]
    .map((assetName) => cleanString(assetName))
    .filter((assetName): assetName is string => Boolean(assetName));

  return Array.from(new Set(normalized));
}

function isDockerTargetArchitecture(
  value: string,
): value is DockerTargetArchitecture {
  return value === "amd64" || value === "arm64";
}

function deployTargetRequiresAsset(
  deployTarget: CmdbProjectRow["deployTarget"],
) {
  return deployTarget === "docker" || deployTarget === "ssh";
}

function deployTargetLabel(deployTarget: CmdbProjectRow["deployTarget"]) {
  switch (deployTarget) {
    case "k8s":
      return "Kubernetes";
    case "ssh":
      return "SSH";
    case "docker":
      return "Docker";
    default:
      return "未指定";
  }
}

function assertProjectReleaseReady(project: CmdbProjectRow) {
  if (!deployTargetRequiresAsset(project.deployTarget)) return;

  const targetAssetNames = normalizeTargetAssetNames(
    project.config?.targetAssetNames,
    project.config?.targetAssetName,
  );

  if (targetAssetNames.length === 0) {
    throw new Error(
      `${deployTargetLabel(project.deployTarget)} 发布需要至少选择一台目标资产。`,
    );
  }
}

function targetArchitecturesFromReleaseVariables(
  variables: Record<string, string> | null | undefined,
) {
  return Array.from(
    new Set(
      (variables?.DEPLOY_TARGET_ARCHES ?? variables?.DEPLOY_TARGET_ARCH ?? "")
        .split(",")
        .map((arch) => arch.trim())
        .filter(isDockerTargetArchitecture),
    ),
  );
}

function assertDockerReleaseArchitectureReady(
  project: CmdbProjectRow,
  variables: Record<string, string>,
) {
  if (project.deployTarget !== "docker") return;

  const targetArchitectures =
    targetArchitecturesFromReleaseVariables(variables);
  if (targetArchitectures.length <= 1) return;

  throw new Error(
    `Docker 发布不能在同一次发布中混合 ${targetArchitectures.join(
      ", ",
    )} 架构目标。请按架构分别触发发布，或把流水线改为多架构镜像推送。`,
  );
}

function normalizeSshPort(port: number | null | undefined) {
  const normalizedPort = port ?? 22;
  if (
    !Number.isInteger(normalizedPort) ||
    normalizedPort < 1 ||
    normalizedPort > 65535
  ) {
    throw new Error("SSH 端口必须是 1-65535 的整数。");
  }

  return normalizedPort;
}

function buildSshConfig(input: {
  ip: string;
  sshUser?: string | null;
  sshPassword?: string | null;
  sshPort?: number;
}): ConnectConfig {
  const host = cleanString(input.ip);
  if (!host) {
    throw new Error("请先填写服务器 IP 或主机地址。");
  }

  const username = cleanString(input.sshUser);
  if (!username) {
    throw new Error("请填写 SSH 用户。");
  }

  const password = input.sshPassword;
  if (!password) {
    throw new Error("请填写 SSH 密码。");
  }

  return {
    host,
    port: normalizeSshPort(input.sshPort),
    username,
    password,
    readyTimeout: 5000,
    keepaliveInterval: 10000,
  };
}

function sshErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "SSH 登录失败";

  if (/authentication/i.test(error.message)) {
    return "SSH 用户名或密码认证失败";
  }
  if (/timed out|timeout/i.test(error.message)) {
    return "SSH 登录超时";
  }

  return error.message;
}

function sshExec(
  input: {
    ip: string;
    sshUser?: string | null;
    sshPassword?: string | null;
    sshPort?: number;
  },
  command?: string,
) {
  const config = buildSshConfig(input);
  const startedAt = Date.now();

  return new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
    signal: string | null;
    durationMs: number;
  }>((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const finish = (
      error: Error | null,
      result?: {
        stdout: string;
        stderr: string;
        code: number | null;
        signal: string | null;
      },
    ) => {
      if (settled) return;
      settled = true;
      client.end();

      if (error) {
        reject(error);
        return;
      }

      resolve({
        stdout: result?.stdout ?? "",
        stderr: result?.stderr ?? "",
        code: result?.code ?? 0,
        signal: result?.signal ?? null,
        durationMs: Date.now() - startedAt,
      });
    };

    client.once("ready", () => {
      if (!command) {
        finish(null);
        return;
      }

      client.exec(command, (error, stream) => {
        if (error) {
          finish(error);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        stream.once("close", (code: number | null, signal: string | null) => {
          finish(null, { stdout, stderr, code, signal });
        });
      });
    });

    client.once("error", (error) => {
      finish(error);
    });

    client.connect(config);
  });
}

function sshUploadBuffer(
  input: {
    ip: string;
    sshUser?: string | null;
    sshPassword?: string | null;
    sshPort?: number;
  },
  remotePath: string,
  data: Buffer,
) {
  const config = buildSshConfig(input);
  const startedAt = Date.now();

  return new Promise<{ durationMs: number }>((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      client.end();

      if (error) {
        reject(error);
        return;
      }

      resolve({ durationMs: Date.now() - startedAt });
    };

    client.once("ready", () => {
      client.sftp((error, sftp) => {
        if (error) {
          finish(error);
          return;
        }

        const stream = sftp.createWriteStream(remotePath, {
          mode: 0o600,
        });
        stream.once("error", finish);
        stream.once("close", () => finish());
        stream.end(data);
      });
    });

    client.once("error", (error) => {
      finish(error);
    });

    client.connect(config);
  });
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: workerCount }).map(async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;

        if (item !== undefined) {
          await worker(item);
        }
      }
    }),
  );
}

async function probeCmdbAssetSshStatus(asset: CmdbAssetRow) {
  if (!asset.ip || !asset.sshUser || !asset.sshPassword) {
    return "planned" satisfies CmdbAssetStatus;
  }

  try {
    await sshExec({
      ip: asset.ip,
      sshUser: asset.sshUser,
      sshPassword: asset.sshPassword,
      sshPort: asset.sshPort ?? 22,
    });
    return "connected" satisfies CmdbAssetStatus;
  } catch {
    return "unknown" satisfies CmdbAssetStatus;
  }
}

export async function refreshCmdbAssetSshStatuses(database: Database) {
  if (cmdbAssetSshMonitor.running) return;

  cmdbAssetSshMonitor.running = true;

  try {
    const assets = await database.select().from(cmdbAssets);

    await runWithConcurrency(
      assets,
      CMDB_ASSET_SSH_CHECK_CONCURRENCY,
      async (asset) => {
        const nextStatus = await probeCmdbAssetSshStatus(asset);
        if (nextStatus === asset.status) return;

        await database
          .update(cmdbAssets)
          .set({
            status: nextStatus,
          })
          .where(eq(cmdbAssets.id, asset.id));
      },
    );
  } finally {
    cmdbAssetSshMonitor.running = false;
  }
}

function startCmdbAssetSshMonitor(database: Database) {
  if (cmdbAssetSshMonitor.timer) return;

  void refreshCmdbAssetSshStatuses(database).catch((error: unknown) => {
    console.error("CMDB asset SSH status refresh failed", error);
  });

  cmdbAssetSshMonitor.timer = setInterval(() => {
    void refreshCmdbAssetSshStatuses(database).catch((error: unknown) => {
      console.error("CMDB asset SSH status refresh failed", error);
    });
  }, CMDB_ASSET_SSH_CHECK_INTERVAL_MS);
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function shellEnvAssignment(name: string, value: string) {
  if (!SHELL_ENV_NAME_PATTERN.test(name)) {
    throw new Error(`无效的环境变量名: ${name}`);
  }

  return `${name}=${shellQuote(value)}`;
}

function shellEnvPrefix(variables: Record<string, string>) {
  return Object.entries(variables)
    .map(([key, value]) => shellEnvAssignment(key, value))
    .join(" ");
}

function truncateOutput(value: string, maxLength = 20000) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n... output truncated ...`;
}

function normalizeReleaseOperationLogs(
  value: unknown,
): CmdbReleaseOperationLog[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): CmdbReleaseOperationLog[] => {
    if (!isRecord(item)) return [];

    const at = typeof item.at === "string" ? item.at : null;
    const step = typeof item.step === "string" ? item.step : null;
    const status = typeof item.status === "string" ? item.status : null;
    const title = typeof item.title === "string" ? item.title : null;
    const detail = typeof item.detail === "string" ? item.detail : undefined;

    if (!at || !step || !title) return [];
    if (
      status !== "pending" &&
      status !== "running" &&
      status !== "success" &&
      status !== "failed" &&
      status !== "canceled" &&
      status !== "info"
    ) {
      return [];
    }

    return [{ at, step, status, title, detail }];
  });
}

function releaseOperationLog(
  step: string,
  status: CmdbReleaseOperationLog["status"],
  title: string,
  detail?: string | null,
): CmdbReleaseOperationLog {
  return {
    at: new Date().toISOString(),
    step,
    status,
    title,
    ...(detail ? { detail: truncateOutput(detail, 4000) } : {}),
  };
}

function appendReleaseOperationLogValue(
  current: unknown,
  log: CmdbReleaseOperationLog,
) {
  return [...normalizeReleaseOperationLogs(current), log].slice(
    -MAX_RELEASE_OPERATION_LOGS,
  );
}

async function currentReleaseOperationLogs(
  database: Database,
  release: Pick<CmdbReleaseRow, "id" | "operationLogs">,
) {
  const [currentRelease] = await database
    .select({ operationLogs: cmdbReleases.operationLogs })
    .from(cmdbReleases)
    .where(eq(cmdbReleases.id, release.id));

  return currentRelease?.operationLogs ?? release.operationLogs;
}

async function appendReleaseOperationLog(
  database: Database,
  release: Pick<CmdbReleaseRow, "id" | "operationLogs">,
  log: CmdbReleaseOperationLog,
) {
  const nextLogs = appendReleaseOperationLogValue(
    await currentReleaseOperationLogs(database, release),
    log,
  );

  await database
    .update(cmdbReleases)
    .set({ operationLogs: nextLogs })
    .where(eq(cmdbReleases.id, release.id));

  return nextLogs;
}

function compactPreview(
  value: string,
  maxLength = HEALTH_RESPONSE_PREVIEW_LENGTH,
) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function parseJsonPayload<T>(value: string, source: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const preview = compactPreview(value);
    const detail = preview ? `响应片段: ${preview}` : "响应体为空";
    const cause = error instanceof Error ? error.message : "JSON 解析失败";
    throw new Error(`${source} 返回的不是有效 JSON。${cause}。${detail}`);
  }
}

async function readResponseText(response: Response) {
  return response.text().catch(() => "");
}

function parseDotenvVariables(value: string) {
  const variables: Record<string, string> = {};

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!SHELL_ENV_NAME_PATTERN.test(key)) continue;

    let parsedValue = line.slice(separatorIndex + 1).trim();
    if (
      (parsedValue.startsWith('"') && parsedValue.endsWith('"')) ||
      (parsedValue.startsWith("'") && parsedValue.endsWith("'"))
    ) {
      parsedValue = parsedValue.slice(1, -1);
    }

    if (parsedValue.length > 0) {
      variables[key] = parsedValue;
    }
  }

  return variables;
}

function findGitLabArtifactJob(jobs: GitLabJob[]) {
  const candidates = jobs.filter((job) => {
    const filename = cleanString(job.artifacts_file?.filename);
    return job.status === "success" && Boolean(filename);
  });

  return candidates.find((job) => job.name === "docker-image") ?? candidates[0];
}

function apiErrorMessageFromResponse(response: Response, responseText: string) {
  if (!responseText) return `HTTP ${response.status}`;

  try {
    const payload = JSON.parse(responseText) as {
      message?: unknown;
      error?: unknown;
    };
    const rawMessage = payload.message ?? payload.error;

    if (typeof rawMessage === "string") return rawMessage;
    if (rawMessage != null) return JSON.stringify(rawMessage);
  } catch {
    const preview = compactPreview(responseText);
    return [
      `HTTP ${response.status}`,
      response.statusText || null,
      preview ? `响应不是 JSON: ${preview}` : "响应不是 JSON",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return `HTTP ${response.status}`;
}

function dockerContainerName(project: Pick<CmdbProjectRow, "name" | "config">) {
  return (
    cleanString(project.config?.customVariables?.DOCKER_CONTAINER_NAME) ??
    project.name
  );
}

async function resolvePrimaryProjectAsset(
  database: Database,
  project: Pick<CmdbProjectRow, "name" | "config">,
  preferredAssetName?: string,
): Promise<SshReadyAssetRow> {
  const targetAssetNames = normalizeTargetAssetNames(
    project.config?.targetAssetNames,
    project.config?.targetAssetName,
  );
  const preferredTargetAssetName = cleanString(preferredAssetName);
  const targetAssetName = preferredTargetAssetName ?? targetAssetNames[0];

  if (!targetAssetName) {
    throw new Error("项目未配置目标资产，无法执行远程运维操作。");
  }

  if (
    preferredTargetAssetName &&
    !targetAssetNames.includes(preferredTargetAssetName)
  ) {
    throw new Error(`项目未部署到目标资产 ${preferredTargetAssetName}。`);
  }

  const [asset] = await database
    .select()
    .from(cmdbAssets)
    .where(eq(cmdbAssets.name, targetAssetName));

  if (!asset) {
    throw new Error(`目标资产 ${targetAssetName} 不存在。`);
  }

  if (!asset.sshUser || !asset.sshPassword) {
    throw new Error(`目标资产 ${targetAssetName} 未配置 SSH 用户或密码。`);
  }

  return {
    ...asset,
    sshUser: asset.sshUser,
    sshPassword: asset.sshPassword,
  };
}

async function resolveProjectAssets(
  database: Database,
  project: Pick<CmdbProjectRow, "name" | "config">,
): Promise<SshReadyAssetRow[]> {
  const targetAssetNames = normalizeTargetAssetNames(
    project.config?.targetAssetNames,
    project.config?.targetAssetName,
  );

  if (targetAssetNames.length === 0) {
    throw new Error("项目未配置目标资产，无法执行远程部署。");
  }

  const assetRows = await database
    .select()
    .from(cmdbAssets)
    .where(inArray(cmdbAssets.name, targetAssetNames));
  const assetByName = new Map(assetRows.map((asset) => [asset.name, asset]));
  const assets = targetAssetNames.map((assetName) => {
    const asset = assetByName.get(assetName);
    if (!asset) {
      throw new Error(`目标资产 ${assetName} 不存在。`);
    }
    if (!asset.sshUser || !asset.sshPassword) {
      throw new Error(`目标资产 ${assetName} 未配置 SSH 用户或密码。`);
    }

    return {
      ...asset,
      sshUser: asset.sshUser,
      sshPassword: asset.sshPassword,
    };
  });

  return assets;
}

function buildDeploymentCommandFailureMessage(
  commandLabel: string,
  result: {
    stdout: string;
    stderr: string;
    code: number | null;
  },
) {
  const output = [
    result.stdout.trim() ? `stdout:\n${truncateOutput(result.stdout)}` : null,
    result.stderr.trim() ? `stderr:\n${truncateOutput(result.stderr)}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    `${commandLabel} 执行失败，退出码 ${result.code ?? "unknown"}。`,
    output,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function sshExecOrThrow(
  asset: SshReadyAssetRow,
  command: string,
  commandLabel: string,
) {
  const result = await sshExec(
    {
      ip: asset.ip,
      sshUser: asset.sshUser,
      sshPassword: asset.sshPassword,
      sshPort: asset.sshPort ?? 22,
    },
    command,
  );

  if (result.code !== 0) {
    throw new Error(buildDeploymentCommandFailureMessage(commandLabel, result));
  }

  return result;
}

async function sshUploadBufferOrThrow(
  asset: SshReadyAssetRow,
  remotePath: string,
  data: Buffer,
  commandLabel: string,
) {
  return sshUploadBuffer(
    {
      ip: asset.ip,
      sshUser: asset.sshUser,
      sshPassword: asset.sshPassword,
      sshPort: asset.sshPort ?? 22,
    },
    remotePath,
    data,
  ).catch((error: unknown) => {
    throw new Error(
      `${commandLabel} 失败：${
        error instanceof Error ? error.message : "未知错误"
      }`,
    );
  });
}

function buildDockerStatusCommand(containerName: string) {
  const container = shellQuote(containerName);

  return [
    "set -eu",
    `CONTAINER=${container}`,
    "docker inspect \"$CONTAINER\" --format '{{json .}}'",
  ].join("\n");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function dockerTimestamp(value: unknown) {
  const timestamp = stringValue(value)?.trim();
  if (!timestamp || timestamp.startsWith("0001-01-01")) return null;
  return timestamp;
}

function dockerPortLabel(args: {
  containerPort: string;
  protocol: string | null;
  hostIp: string | null;
  hostPort: string | null;
}) {
  const target = `${args.containerPort}${args.protocol ? `/${args.protocol}` : ""}`;
  if (!args.hostPort) return target;

  const hostIp = args.hostIp?.trim() ?? "0.0.0.0";
  return `${hostIp}:${args.hostPort} -> ${target}`;
}

function dockerPortsFromInspect(value: unknown): DockerContainerPort[] {
  if (!isRecord(value)) return [];

  return Object.entries(value).flatMap(([key, bindings]) => {
    const [containerPort = key, protocol = null] = key.split("/");

    if (!Array.isArray(bindings) || bindings.length === 0) {
      const port = {
        containerPort,
        protocol,
        hostIp: null,
        hostPort: null,
      };

      return [
        {
          ...port,
          label: dockerPortLabel(port),
        },
      ];
    }

    return bindings.map((binding) => {
      const hostIp = isRecord(binding) ? stringValue(binding.HostIp) : null;
      const hostPort = isRecord(binding) ? stringValue(binding.HostPort) : null;
      const port = {
        containerPort,
        protocol,
        hostIp,
        hostPort,
      };

      return {
        ...port,
        label: dockerPortLabel(port),
      };
    });
  });
}

function parseDockerStatusOutput(
  stdout: string,
  fallbackContainerName: string,
): DockerContainerStatus | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;

  const config = isRecord(parsed.Config) ? parsed.Config : {};
  const state = isRecord(parsed.State) ? parsed.State : {};
  const health = isRecord(state.Health) ? state.Health : null;
  const network = isRecord(parsed.NetworkSettings)
    ? parsed.NetworkSettings
    : {};
  const rawName = stringValue(parsed.Name)?.replace(/^\/+/, "");
  const stateName = stringValue(state.Status) ?? "unknown";
  const running = booleanValue(state.Running) ?? stateName === "running";

  return {
    id: stringValue(parsed.Id) ?? "",
    name: rawName ?? fallbackContainerName,
    image: stringValue(config.Image) ?? stringValue(parsed.Image) ?? "",
    state: stateName,
    running,
    health: stringValue(health?.Status),
    startedAt: dockerTimestamp(state.StartedAt),
    finishedAt: dockerTimestamp(state.FinishedAt),
    createdAt: dockerTimestamp(parsed.Created),
    restartCount: numberValue(parsed.RestartCount) ?? 0,
    exitCode: numberValue(state.ExitCode),
    ports: dockerPortsFromInspect(network.Ports),
  };
}

function dockerStatusOutputText(status: DockerContainerStatus) {
  const statusText = [
    status.running ? "运行中" : status.state || "未知",
    status.health ? `健康状态: ${status.health}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    `容器: ${status.name}`,
    `状态: ${statusText}`,
    `镜像: ${status.image || "-"}`,
    `端口: ${status.ports.length ? status.ports.map((port) => port.label).join(", ") : "未暴露"}`,
    `启动时间: ${status.startedAt ?? "-"}`,
    `重启次数: ${status.restartCount}`,
    status.running ? null : `退出码: ${status.exitCode ?? "-"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDockerLogsCommand(containerName: string, tail: number) {
  const container = shellQuote(containerName);

  return [
    "set -eu",
    `CONTAINER=${container}`,
    `docker logs --tail ${tail} "$CONTAINER" 2>&1`,
  ].join("\n");
}

function buildDockerRemoveCommand(containerName: string) {
  const container = shellQuote(containerName);

  return [
    "set -eu",
    `CONTAINER=${container}`,
    'if ! command -v docker >/dev/null 2>&1; then echo "docker command not found" >&2; exit 127; fi',
    'if docker inspect "$CONTAINER" >/dev/null 2>&1; then',
    '  docker rm -f "$CONTAINER"',
    "else",
    "  inspect_status=$?",
    "  if docker ps >/dev/null 2>&1; then",
    '    echo "container $CONTAINER not found; skipped"',
    "  else",
    '    echo "docker daemon unavailable while removing $CONTAINER" >&2',
    '    exit "$inspect_status"',
    "  fi",
    "fi",
  ].join("\n");
}

function dockerImageForDeployment(
  project: CmdbProjectRow,
  release: CmdbReleaseRow,
) {
  return (
    cleanString(release.variables?.DOCKER_IMAGE) ??
    cleanString(project.config?.dockerImage) ??
    null
  );
}

function dockerRunArgs(project: CmdbProjectRow, release: CmdbReleaseRow) {
  return (
    cleanString(release.variables?.DOCKER_RUN_ARGS) ??
    cleanString(project.config?.customVariables?.DOCKER_RUN_ARGS)
  );
}

function dockerRestartPolicy(project: CmdbProjectRow, release: CmdbReleaseRow) {
  return (
    cleanString(release.variables?.DOCKER_RESTART_POLICY) ??
    cleanString(project.config?.customVariables?.DOCKER_RESTART_POLICY) ??
    DOCKER_DEFAULT_RESTART_POLICY
  );
}

function dockerRegistryHost(image: string, variables: Record<string, string>) {
  const configuredRegistry = cleanString(variables.DOCKER_REGISTRY);
  if (configuredRegistry) return configuredRegistry;

  const firstSegment = image.split("/")[0];
  if (
    firstSegment &&
    (firstSegment.includes(".") ||
      firstSegment.includes(":") ||
      firstSegment === "localhost")
  ) {
    return firstSegment;
  }

  return null;
}

function buildDockerRegistryLoginCommand(
  image: string,
  variables: Record<string, string>,
) {
  const username =
    cleanString(variables.DOCKER_REGISTRY_USER) ??
    cleanString(variables.CI_REGISTRY_USER);
  const password =
    cleanString(variables.DOCKER_REGISTRY_PASSWORD) ??
    cleanString(variables.CI_REGISTRY_PASSWORD);
  const registry =
    dockerRegistryHost(image, variables) ?? cleanString(variables.CI_REGISTRY);

  if (!username || !password || !registry) return null;

  return [
    `printf %s ${shellQuote(password)} | docker login -u ${shellQuote(
      username,
    )} --password-stdin ${shellQuote(registry)}`,
  ];
}

function dockerImageArtifactPath(release: CmdbReleaseRow) {
  return cleanString(release.variables?.DOCKER_IMAGE_ARTIFACT_PATH);
}

function buildDockerDeployCommand(args: {
  project: CmdbProjectRow;
  release: CmdbReleaseRow;
  asset: SshReadyAssetRow;
  imageArchivePath?: string | null;
}) {
  const image = dockerImageForDeployment(args.project, args.release);
  if (!image) {
    throw new Error(
      "Docker 部署缺少镜像。请确认 GitLab 流水线 build.env 产出了 DOCKER_IMAGE，且 CMDB 可读取该 artifact。",
    );
  }

  const containerName = dockerContainerName(args.project);
  const runArgs = dockerRunArgs(args.project, args.release);
  const restartPolicy = dockerRestartPolicy(args.project, args.release);
  const variables = args.release.variables ?? {};
  const loginCommand = buildDockerRegistryLoginCommand(image, variables);
  const loadCommand = args.imageArchivePath
    ? `gzip -dc ${shellQuote(args.imageArchivePath)} | docker load`
    : null;

  return [
    "set -eu",
    `IMAGE=${shellQuote(image)}`,
    `CONTAINER=${shellQuote(containerName)}`,
    `RESTART_POLICY=${shellQuote(restartPolicy)}`,
    `echo "CMDB Docker deploy: ${containerName} on ${args.asset.name}"`,
    ...(loginCommand ?? []),
    loadCommand
      ? `docker image inspect "$IMAGE" >/dev/null 2>&1 || ${loadCommand}`
      : 'docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE"',
    'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true',
    [
      'docker run -d --restart "$RESTART_POLICY" --name "$CONTAINER"',
      runArgs,
      '"$IMAGE"',
    ]
      .filter(Boolean)
      .join(" "),
  ].join("\n");
}

function buildSshDeployCommand(args: {
  project: CmdbProjectRow;
  release: CmdbReleaseRow;
  asset: SshReadyAssetRow;
}) {
  const configuredCommand =
    cleanString(args.release.variables?.DEPLOY_COMMAND) ??
    cleanString(args.project.config?.sshDeployCommand);

  if (!configuredCommand) {
    throw new Error("SSH 发布需要在 CMDB 项目中配置部署命令。");
  }

  const deployPath =
    cleanString(args.release.variables?.DEPLOY_PATH) ??
    cleanString(args.project.config?.sshPath);
  const releaseVariables = { ...(args.release.variables ?? {}) };
  delete releaseVariables.DEPLOY_COMMAND;
  const envPrefix = shellEnvPrefix({
    CMDB_PROJECT_NAME: args.project.name,
    CMDB_PROJECT_PATH: args.project.gitlabPath,
    CMDB_RELEASE_REF: args.release.ref,
    DEPLOY_ENV: args.release.deployEnv ?? "",
    DEPLOY_ASSET_NAME: args.asset.name,
    DEPLOY_HOST: args.asset.ip,
    ...releaseVariables,
  });
  const command = [
    deployPath ? `cd ${shellQuote(deployPath)}` : null,
    [envPrefix, configuredCommand].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" && ");

  return ["set -eu", command].join("\n");
}

async function executeCmdbDeployment(
  database: Database,
  project: CmdbProjectRow,
  release: CmdbReleaseRow,
): Promise<CmdbDeploymentResult | null> {
  if (project.deployTarget === "none") {
    await appendReleaseOperationLog(
      database,
      release,
      releaseOperationLog(
        "cmdb-deploy",
        "success",
        "无需 CMDB 部署",
        "项目部署目标为未指定，GitLab Pipeline 完成后发布即结束。",
      ),
    );
    return null;
  }

  if (project.deployTarget === "k8s") {
    await appendReleaseOperationLog(
      database,
      release,
      releaseOperationLog(
        "cmdb-deploy",
        "success",
        "Kubernetes 部署由流水线处理",
        "CMDB 不执行额外部署命令。",
      ),
    );
    return null;
  }

  if (project.deployTarget === "docker") {
    const targetArchitectures = targetArchitecturesFromReleaseVariables(
      release.variables,
    );
    if (targetArchitectures.length > 1) {
      assertDockerReleaseArchitectureReady(project, release.variables ?? {});
    }
  }

  const assets = await resolveProjectAssets(database, project);
  const startedAt = Date.now();
  const logs: string[] = [];
  const imageArtifactPath =
    project.deployTarget === "docker" ? dockerImageArtifactPath(release) : null;
  const imageArchive = imageArtifactPath
    ? await readGitLabReleaseArtifactFile({
        project,
        release,
        artifactPath: imageArtifactPath,
      })
    : null;

  await appendReleaseOperationLog(
    database,
    release,
    releaseOperationLog(
      "cmdb-deploy",
      "running",
      `开始 ${deployTargetLabel(project.deployTarget)} 部署`,
      `目标资产: ${assets.map((asset) => asset.name).join(", ") || "-"}${
        imageArchive ? `；已读取镜像产物 ${imageArtifactPath}` : ""
      }`,
    ),
  );

  for (const asset of assets) {
    const remoteImageArchivePath =
      imageArchive && imageArtifactPath
        ? `/tmp/cola-${project.name}-${release.id}-image.tar.gz`.replace(
            /[^A-Za-z0-9._/-]/g,
            "-",
          )
        : null;

    if (imageArchive && remoteImageArchivePath) {
      await appendReleaseOperationLog(
        database,
        release,
        releaseOperationLog(
          "artifact-upload",
          "running",
          `上传镜像产物到 ${asset.name}`,
          remoteImageArchivePath,
        ),
      );
      await sshUploadBufferOrThrow(
        asset,
        remoteImageArchivePath,
        imageArchive,
        `上传 Docker 镜像产物到 ${asset.name}`,
      );
      await appendReleaseOperationLog(
        database,
        release,
        releaseOperationLog(
          "artifact-upload",
          "success",
          `镜像产物已上传到 ${asset.name}`,
          remoteImageArchivePath,
        ),
      );
    }

    const command =
      project.deployTarget === "docker"
        ? buildDockerDeployCommand({
            project,
            release,
            asset,
            imageArchivePath: remoteImageArchivePath,
          })
        : buildSshDeployCommand({ project, release, asset });
    await appendReleaseOperationLog(
      database,
      release,
      releaseOperationLog(
        "remote-command",
        "running",
        `${deployTargetLabel(project.deployTarget)} 部署到 ${asset.name}`,
        `目标地址: ${asset.ip}`,
      ),
    );
    const result = await sshExecOrThrow(
      asset,
      command,
      `${deployTargetLabel(project.deployTarget)} 部署到 ${asset.name}`,
    );
    await appendReleaseOperationLog(
      database,
      release,
      releaseOperationLog(
        "remote-command",
        "success",
        `${deployTargetLabel(project.deployTarget)} 部署到 ${asset.name} 完成`,
        [result.stdout.trim(), result.stderr.trim()]
          .filter(Boolean)
          .join("\n\n"),
      ),
    );
    const output = [
      `# ${asset.name} (${asset.ip})`,
      imageArchive && remoteImageArchivePath
        ? `已上传镜像产物: ${remoteImageArchivePath}`
        : null,
      result.stdout.trim(),
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    logs.push(output);
  }

  return {
    stdout: truncateOutput(logs.join("\n\n")),
    stderr: "",
    durationMs: Date.now() - startedAt,
  };
}

function localDoubleQuote(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`")}"`;
}

function buildDockerContainerLoginRemoteCommand(containerName: string) {
  const container = shellQuote(containerName);
  const shellProbe = shellQuote(
    "command -v bash >/dev/null 2>&1 && exec bash || exec sh",
  );

  return `docker exec -it ${container} sh -lc ${shellProbe}`;
}

function buildSshCommand(args: {
  sshPort: number;
  sshUser: string;
  host: string;
  remoteCommand?: string;
}) {
  const ttyFlag = args.remoteCommand ? "-t " : "";
  const baseCommand = `ssh ${ttyFlag}-p ${args.sshPort} ${args.sshUser}@${args.host}`;

  if (!args.remoteCommand) return baseCommand;

  return `${baseCommand} ${localDoubleQuote(args.remoteCommand)}`;
}

export async function testCmdbAssetConnectivity(input: {
  ip: string;
  sshUser?: string;
  sshPassword?: string;
  sshPort?: number;
}) {
  const startedAt = Date.now();

  try {
    const result = await sshExec(input);
    return {
      status: "connected" as const,
      message: "SSH 登录成功",
      durationMs: result.durationMs,
    };
  } catch (error) {
    return {
      status: "unknown" as const,
      message: sshErrorMessage(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

export async function resolveCmdbProjectTerminalTarget(
  database: Database,
  projectId: number,
  targetAssetName?: string,
): Promise<CmdbProjectTerminalTarget> {
  const [project] = await database
    .select()
    .from(cmdbProjects)
    .where(eq(cmdbProjects.id, projectId));

  if (!project) {
    throw new Error("项目不存在，无法登录目标资产。");
  }

  const asset = await resolvePrimaryProjectAsset(
    database,
    project,
    targetAssetName,
  );
  const sshPort = asset.sshPort ?? 22;
  const containerName =
    project.deployTarget === "docker" ? dockerContainerName(project) : null;

  return {
    projectId: project.id,
    projectName: project.name,
    deployTarget: project.deployTarget,
    targetAssetName: asset.name,
    host: asset.ip,
    sshUser: asset.sshUser,
    sshPort,
    sshConfig: buildSshConfig({
      ip: asset.ip,
      sshUser: asset.sshUser,
      sshPassword: asset.sshPassword,
      sshPort,
    }),
    containerName,
    remoteCommand: containerName
      ? buildDockerContainerLoginRemoteCommand(containerName)
      : null,
  };
}

export async function runCmdbProjectOperation(
  database: Database,
  input: {
    projectId: number;
    action: "dockerStatus" | "dockerLogs" | "containerMonitor" | "sshInfo";
    targetAssetName?: string;
    tail?: number;
  },
) {
  const [project] = await database
    .select()
    .from(cmdbProjects)
    .where(eq(cmdbProjects.id, input.projectId));

  if (!project) {
    throw new Error("项目不存在，无法执行运维操作。");
  }

  const asset = await resolvePrimaryProjectAsset(
    database,
    project,
    input.targetAssetName,
  );
  const sshPort = asset.sshPort ?? 22;
  const sshUser = asset.sshUser;
  if (!sshUser) {
    throw new Error(`目标资产 ${asset.name} 未配置 SSH 用户。`);
  }

  const containerName = dockerContainerName(project);
  const hostSshCommand = buildSshCommand({
    sshPort,
    sshUser,
    host: asset.ip,
  });
  const containerLoginCommand =
    project.deployTarget === "docker"
      ? buildSshCommand({
          sshPort,
          sshUser,
          host: asset.ip,
          remoteCommand: buildDockerContainerLoginRemoteCommand(containerName),
        })
      : hostSshCommand;

  if (input.action === "sshInfo") {
    return {
      action: input.action,
      projectId: project.id,
      projectName: project.name,
      targetAssetName: asset.name,
      host: asset.ip,
      sshUser: asset.sshUser,
      sshPort,
      sshCommand: containerLoginCommand,
      containerName,
      monitorUrl: cleanString(project.config?.monitorUrl) ?? null,
      stdout: containerLoginCommand,
      stderr: "",
      code: 0,
      durationMs: 0,
    };
  }

  if (project.deployTarget !== "docker") {
    throw new Error("当前仅 Docker 部署项目支持查看容器状态、日志和监控。");
  }

  const usesDockerInspect =
    input.action === "dockerStatus" || input.action === "containerMonitor";
  const command = usesDockerInspect
    ? buildDockerStatusCommand(containerName)
    : buildDockerLogsCommand(
        containerName,
        Math.min(Math.max(input.tail ?? 200, 20), 1000),
      );
  const result = await sshExec(
    {
      ip: asset.ip,
      sshUser: asset.sshUser,
      sshPassword: asset.sshPassword,
      sshPort,
    },
    command,
  );
  const dockerStatus = usesDockerInspect
    ? parseDockerStatusOutput(result.stdout, containerName)
    : null;
  const stdout = usesDockerInspect
    ? dockerStatus
      ? dockerStatusOutputText(dockerStatus)
      : "未能解析容器状态。"
    : result.stdout;

  return {
    action: input.action,
    projectId: project.id,
    projectName: project.name,
    targetAssetName: asset.name,
    host: asset.ip,
    sshUser: asset.sshUser,
    sshPort,
    sshCommand: hostSshCommand,
    containerName,
    monitorUrl: cleanString(project.config?.monitorUrl) ?? null,
    stdout: truncateOutput(stdout),
    stderr: truncateOutput(result.stderr),
    code: result.code,
    durationMs: result.durationMs,
    dockerStatus,
  };
}

async function gitlabApiFetch<T>(
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const apiBaseUrl = gitlabApiBaseUrl();

  if (!apiBaseUrl || !env.GITLAB_API_TOKEN) {
    throw new Error(
      "GitLab API 未配置，请设置 GITLAB_URL 和 GITLAB_API_TOKEN。",
    );
  }

  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      "PRIVATE-TOKEN": env.GITLAB_API_TOKEN,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const responseText = await readResponseText(response);

  if (!response.ok) {
    throw new Error(
      `GitLab API 错误: ${apiErrorMessageFromResponse(response, responseText)}`,
    );
  }

  return parseJsonPayload<T>(responseText, "GitLab API");
}

async function gitlabApiFetchText(pathname: string, init?: RequestInit) {
  const apiBaseUrl = gitlabApiBaseUrl();

  if (!apiBaseUrl || !env.GITLAB_API_TOKEN) {
    throw new Error(
      "GitLab API 未配置，请设置 GITLAB_URL 和 GITLAB_API_TOKEN。",
    );
  }

  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      "PRIVATE-TOKEN": env.GITLAB_API_TOKEN,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const responseText = await readResponseText(response);

  if (!response.ok) {
    throw new Error(
      `GitLab API 错误: ${apiErrorMessageFromResponse(response, responseText)}`,
    );
  }

  return responseText;
}

async function gitlabApiFetchBuffer(pathname: string, init?: RequestInit) {
  const apiBaseUrl = gitlabApiBaseUrl();

  if (!apiBaseUrl || !env.GITLAB_API_TOKEN) {
    throw new Error(
      "GitLab API 未配置，请设置 GITLAB_URL 和 GITLAB_API_TOKEN。",
    );
  }

  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      "PRIVATE-TOKEN": env.GITLAB_API_TOKEN,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText = await readResponseText(response);
    throw new Error(
      `GitLab API 错误: ${apiErrorMessageFromResponse(response, responseText)}`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

async function readGitLabReleaseArtifactVariables(
  project: CmdbProjectRow,
  release: CmdbReleaseRow,
) {
  if (!release.gitlabPipelineId || !hasGitLabApiAccess()) {
    return {};
  }

  const projectRef =
    project.gitlabProjectId ?? encodeURIComponent(project.gitlabPath);
  const jobs = await gitlabApiFetch<GitLabJob[]>(
    `/projects/${projectRef}/pipelines/${release.gitlabPipelineId}/jobs?per_page=100`,
  );
  const artifactJob = findGitLabArtifactJob(jobs);

  if (!artifactJob) return {};

  const artifactText = await gitlabApiFetchText(
    `/projects/${projectRef}/jobs/${artifactJob.id}/artifacts/build.env`,
  );

  return parseDotenvVariables(artifactText);
}

async function readGitLabReleaseArtifactFile(args: {
  project: CmdbProjectRow;
  release: CmdbReleaseRow;
  artifactPath: string;
}) {
  if (!args.release.gitlabPipelineId || !hasGitLabApiAccess()) {
    return null;
  }

  const projectRef =
    args.project.gitlabProjectId ?? encodeURIComponent(args.project.gitlabPath);
  const jobs = await gitlabApiFetch<GitLabJob[]>(
    `/projects/${projectRef}/pipelines/${args.release.gitlabPipelineId}/jobs?per_page=100`,
  );
  const artifactJob = findGitLabArtifactJob(jobs);

  if (!artifactJob) return null;

  return gitlabApiFetchBuffer(
    `/projects/${projectRef}/jobs/${artifactJob.id}/artifacts/${encodeURIComponent(
      args.artifactPath,
    )}`,
  );
}

async function hydrateReleaseDeploymentVariables(
  database: Database,
  project: CmdbProjectRow,
  release: CmdbReleaseRow,
) {
  if (project.deployTarget !== "docker") return release;
  const configuredDockerImage =
    cleanString(release.variables?.DOCKER_IMAGE) ??
    cleanString(project.config?.dockerImage);

  let artifactVariables: Record<string, string>;
  try {
    artifactVariables = await readGitLabReleaseArtifactVariables(
      project,
      release,
    );
  } catch (error: unknown) {
    if (configuredDockerImage) return release;

    throw new Error(
      `读取 GitLab 构建产物变量失败：${
        error instanceof Error ? error.message : "未知错误"
      }`,
    );
  }

  if (Object.keys(artifactVariables).length === 0) return release;

  const dockerImage =
    configuredDockerImage ?? cleanString(artifactVariables.DOCKER_IMAGE);

  const variables = {
    ...(release.variables ?? {}),
    ...artifactVariables,
  };
  if (dockerImage) variables.DOCKER_IMAGE = dockerImage;
  const [updatedRelease] = await database
    .update(cmdbReleases)
    .set({ variables })
    .where(eq(cmdbReleases.id, release.id))
    .returning();

  return updatedRelease ?? { ...release, variables };
}

function normalizePipelineStatus(
  status: string | null | undefined,
): CmdbReleaseStatus {
  switch (status) {
    case "running":
      return "running";
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "canceled":
    case "canceling":
    case "skipped":
      return "canceled";
    case "created":
    case "pending":
    case "preparing":
    case "waiting_for_resource":
    case "scheduled":
    case "manual":
    default:
      return "pending";
  }
}

async function fetchGitLabProject(projectPath: string) {
  const encodedPath = encodeURIComponent(projectPath);
  const project = await gitlabApiFetch<GitLabProject>(
    `/projects/${encodedPath}`,
  );

  return {
    gitlabProjectId: project.id,
    name: project.name,
    path: project.path_with_namespace,
    description: project.description,
    defaultBranch: project.default_branch ?? "main",
    webUrl: project.web_url,
  };
}

export async function listGitLabCatalog(query?: string) {
  const params = new URLSearchParams({
    membership: "true",
    per_page: query?.trim() ? "20" : "12",
    order_by: "last_activity_at",
  });

  const normalizedQuery = query?.trim();
  if (normalizedQuery) {
    params.set("search", normalizedQuery);
  }

  const items = await gitlabApiFetch<GitLabProject[]>(
    `/projects?${params.toString()}`,
  );

  return items.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path_with_namespace,
    description: project.description,
    defaultBranch: project.default_branch ?? "main",
    webUrl: project.web_url,
  }));
}

export async function listGitLabBranches(projectPath: string) {
  const normalizedProjectPath = cleanString(projectPath);
  if (!normalizedProjectPath) {
    throw new Error("请先选择或填写 GitLab 项目路径。");
  }

  const params = new URLSearchParams({
    per_page: "100",
  });
  const encodedPath = encodeURIComponent(normalizedProjectPath);
  const items = await gitlabApiFetch<GitLabBranch[]>(
    `/projects/${encodedPath}/repository/branches?${params.toString()}`,
  );

  return items.map((branch) => ({
    name: branch.name,
    isDefault: Boolean(branch.default),
    isProtected: Boolean(branch.protected),
    webUrl: branch.web_url ?? null,
  }));
}

export async function triggerGitLabPipeline(args: {
  gitlabProjectId?: number | null;
  gitlabPath: string;
  ref: string;
  variables: Record<string, string>;
  triggerToken?: string;
}) {
  const apiBaseUrl = gitlabApiBaseUrl();
  if (!apiBaseUrl) {
    throw new Error("GitLab 未配置，请先设置 GITLAB_URL。");
  }

  const projectRef =
    args.gitlabProjectId ?? encodeURIComponent(args.gitlabPath);
  const normalizedRef = args.ref.trim();

  if (args.triggerToken) {
    const body = new URLSearchParams({
      token: args.triggerToken,
      ref: normalizedRef,
    });

    for (const [key, value] of Object.entries(args.variables)) {
      body.append(`variables[${key}]`, value);
    }

    const response = await fetch(
      `${apiBaseUrl}/projects/${projectRef}/trigger/pipeline`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        cache: "no-store",
      },
    );

    const responseText = await readResponseText(response);

    if (!response.ok) {
      throw new Error(
        `GitLab Trigger 失败: ${apiErrorMessageFromResponse(
          response,
          responseText,
        )}`,
      );
    }

    const pipeline = parseJsonPayload<GitLabPipeline>(
      responseText,
      "GitLab Trigger",
    );
    return {
      pipelineId: pipeline.id,
      pipelineUrl:
        pipeline.web_url ?? buildGitLabProjectUrl(args.gitlabPath, null),
      gitlabStatus: pipeline.status ?? "pending",
      status: normalizePipelineStatus(pipeline.status),
    };
  }

  if (!env.GITLAB_API_TOKEN) {
    throw new Error(
      "项目未配置 Trigger Token，且全局 GITLAB_API_TOKEN 不可用，无法触发发布。",
    );
  }

  const requestBody = {
    ref: normalizedRef,
    variables: Object.entries(args.variables).map(([key, value]) => ({
      key,
      value,
      variable_type: "env_var",
    })),
  };

  const pipeline = await gitlabApiFetch<GitLabPipeline>(
    `/projects/${projectRef}/pipeline`,
    {
      method: "POST",
      body: JSON.stringify(requestBody),
    },
  );

  return {
    pipelineId: pipeline.id,
    pipelineUrl:
      pipeline.web_url ?? buildGitLabProjectUrl(args.gitlabPath, null),
    gitlabStatus: pipeline.status ?? "pending",
    status: normalizePipelineStatus(pipeline.status),
  };
}

export async function refreshRunningCmdbReleases(database: Database) {
  if (!hasGitLabApiAccess()) return;

  const pendingStatuses: CmdbReleaseStatus[] = ["pending", "running"];
  const items = await database
    .select({
      release: cmdbReleases,
      project: cmdbProjects,
    })
    .from(cmdbReleases)
    .innerJoin(cmdbProjects, eq(cmdbReleases.projectId, cmdbProjects.id))
    .where(inArray(cmdbReleases.status, pendingStatuses))
    .orderBy(desc(cmdbReleases.createdAt));

  for (const item of items) {
    if (!item.release.gitlabPipelineId) continue;

    try {
      if (item.release.gitlabStatus === CMDB_DEPLOYING_GITLAB_STATUS) {
        continue;
      }

      const pipeline = await gitlabApiFetch<GitLabPipeline>(
        `/projects/${item.project.gitlabProjectId ?? encodeURIComponent(item.project.gitlabPath)}/pipelines/${item.release.gitlabPipelineId}`,
      );

      const nextStatus = normalizePipelineStatus(pipeline.status);
      if (nextStatus === "success") {
        await appendReleaseOperationLog(
          database,
          item.release,
          releaseOperationLog(
            "gitlab-pipeline",
            "success",
            "GitLab Pipeline 已成功",
            `GitLab 状态: ${pipeline.status}`,
          ),
        );
        await completeCmdbReleaseDeployment(database, item.project, {
          ...item.release,
          gitlabStatus: pipeline.status,
        });
        continue;
      }

      const completedAt =
        nextStatus === "failed" || nextStatus === "canceled"
          ? new Date()
          : null;

      if (
        nextStatus !== item.release.status ||
        pipeline.status !== item.release.gitlabStatus ||
        (completedAt && !item.release.completedAt)
      ) {
        const statusChanged = nextStatus !== item.release.status;
        const gitlabStatusChanged =
          pipeline.status !== item.release.gitlabStatus;
        const nextLogs =
          statusChanged || gitlabStatusChanged || completedAt
            ? appendReleaseOperationLogValue(
                item.release.operationLogs,
                releaseOperationLog(
                  "gitlab-pipeline",
                  nextStatus === "failed"
                    ? "failed"
                    : nextStatus === "canceled"
                      ? "canceled"
                      : "running",
                  "GitLab Pipeline 状态更新",
                  `GitLab 状态: ${pipeline.status}`,
                ),
              )
            : item.release.operationLogs;

        await database
          .update(cmdbReleases)
          .set({
            status: nextStatus,
            gitlabStatus: pipeline.status,
            completedAt,
            operationLogs: nextLogs,
          })
          .where(eq(cmdbReleases.id, item.release.id));
      }
    } catch {
      // Keep last known state when GitLab polling fails.
    }
  }
}

export async function cancelCmdbRelease(database: Database, releaseId: number) {
  const [item] = await database
    .select({
      release: cmdbReleases,
      project: cmdbProjects,
    })
    .from(cmdbReleases)
    .innerJoin(cmdbProjects, eq(cmdbReleases.projectId, cmdbProjects.id))
    .where(eq(cmdbReleases.id, releaseId));

  if (!item) {
    throw new Error("发布记录不存在，无法停止。");
  }

  if (item.release.status !== "pending" && item.release.status !== "running") {
    throw new Error("只有排队中或运行中的发布可以停止。");
  }

  if (item.release.gitlabStatus === CMDB_DEPLOYING_GITLAB_STATUS) {
    throw new Error(
      "GitLab Pipeline 已完成，CMDB 正在执行部署，无法通过 GitLab 停止。",
    );
  }

  if (!item.release.gitlabPipelineId) {
    throw new Error("发布记录缺少 GitLab Pipeline ID，无法停止。");
  }

  if (!hasGitLabApiAccess()) {
    throw new Error(
      "GitLab API 未配置，无法停止 Pipeline。请设置 GITLAB_URL 和 GITLAB_API_TOKEN。",
    );
  }

  const projectRef =
    item.project.gitlabProjectId ?? encodeURIComponent(item.project.gitlabPath);
  const pipeline = await gitlabApiFetch<GitLabPipeline>(
    `/projects/${projectRef}/pipelines/${item.release.gitlabPipelineId}/cancel`,
    { method: "POST" },
  );
  const nextStatus = normalizePipelineStatus(pipeline.status);
  if (nextStatus === "success") {
    throw new Error("GitLab Pipeline 已完成，无法停止。请等待 CMDB 同步状态。");
  }
  const releaseStatus: CmdbReleaseStatus =
    nextStatus === "failed" ? "failed" : "canceled";

  const [updatedRelease] = await database
    .update(cmdbReleases)
    .set({
      status: releaseStatus,
      gitlabStatus: pipeline.status ?? releaseStatus,
      gitlabPipelineUrl: pipeline.web_url ?? item.release.gitlabPipelineUrl,
      completedAt: new Date(),
      lastError:
        releaseStatus === "canceled"
          ? "已请求停止 GitLab Pipeline。"
          : item.release.lastError,
      operationLogs: appendReleaseOperationLogValue(
        item.release.operationLogs,
        releaseOperationLog(
          "gitlab-cancel",
          releaseStatus === "canceled" ? "canceled" : "failed",
          releaseStatus === "canceled"
            ? "已请求停止 GitLab Pipeline"
            : "GitLab Pipeline 停止失败",
          `GitLab 状态: ${pipeline.status ?? releaseStatus}`,
        ),
      ),
    })
    .where(eq(cmdbReleases.id, item.release.id))
    .returning();

  return updatedRelease ?? item.release;
}

async function completeCmdbReleaseDeployment(
  database: Database,
  project: CmdbProjectRow,
  release: CmdbReleaseRow,
) {
  const [lockedRelease] = await database
    .update(cmdbReleases)
    .set({
      status: "running",
      gitlabStatus: CMDB_DEPLOYING_GITLAB_STATUS,
      lastError: null,
      operationLogs: appendReleaseOperationLogValue(
        await currentReleaseOperationLogs(database, release),
        releaseOperationLog(
          "cmdb-deploy",
          "running",
          "进入 CMDB 部署阶段",
          `${deployTargetLabel(project.deployTarget)} · ${project.name}`,
        ),
      ),
    })
    .where(
      and(
        eq(cmdbReleases.id, release.id),
        inArray(cmdbReleases.status, ["pending", "running"]),
        ne(cmdbReleases.gitlabStatus, CMDB_DEPLOYING_GITLAB_STATUS),
      ),
    )
    .returning();

  if (!lockedRelease) return;

  try {
    const hydratedRelease = await hydrateReleaseDeploymentVariables(
      database,
      project,
      lockedRelease,
    );
    const deploymentResult = await executeCmdbDeployment(
      database,
      project,
      hydratedRelease,
    );
    const deploymentSummary = deploymentResult
      ? [
          `CMDB 部署完成，耗时 ${deploymentResult.durationMs}ms。`,
          deploymentResult.stdout,
        ]
          .filter(Boolean)
          .join("\n\n")
      : project.deployTarget === "k8s"
        ? "GitLab Pipeline 成功。Kubernetes 部署未由 CMDB 执行。"
        : "GitLab Pipeline 成功，无需 CMDB 执行部署。";
    await database
      .update(cmdbReleases)
      .set({
        status: "success",
        gitlabStatus: release.gitlabStatus ?? "success",
        lastError: truncateOutput(deploymentSummary),
        completedAt: new Date(),
        operationLogs: appendReleaseOperationLogValue(
          await currentReleaseOperationLogs(database, hydratedRelease),
          releaseOperationLog(
            "release-complete",
            "success",
            "发布完成",
            deploymentSummary,
          ),
        ),
      })
      .where(eq(cmdbReleases.id, lockedRelease.id));
  } catch (error) {
    await database
      .update(cmdbReleases)
      .set({
        status: "failed",
        gitlabStatus: release.gitlabStatus ?? "success",
        lastError:
          error instanceof Error ? truncateOutput(error.message) : "部署失败",
        completedAt: new Date(),
        operationLogs: appendReleaseOperationLogValue(
          await currentReleaseOperationLogs(database, lockedRelease),
          releaseOperationLog(
            "release-complete",
            "failed",
            "发布失败",
            error instanceof Error ? error.message : "部署失败",
          ),
        ),
      })
      .where(eq(cmdbReleases.id, lockedRelease.id));
  }
}

async function probeProjectHealth(
  config: CmdbProjectConfig | null | undefined,
): Promise<ProjectHealthProbeResult> {
  const healthUrl = cleanString(config?.healthUrl);
  const checkedAt = new Date();

  if (!healthUrl) {
    return {
      status: "unknown" as const,
      statusCode: null,
      responseTimeMs: null,
      message: "未配置健康检查地址",
      checkedAt,
      url: null,
      method: "GET",
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      contentType: null,
      errorType: null,
      errorDetail: null,
      responsePreview: null,
    };
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      cache: "no-store",
    });
    const responseTimeMs = Date.now() - startedAt;
    const contentType =
      cleanString(response.headers.get("content-type")) ?? null;
    const responseText = await readResponseText(response);
    const responsePreview = response.ok
      ? null
      : compactPreview(responseText) || null;

    return {
      status: response.ok ? ("healthy" as const) : ("degraded" as const),
      statusCode: response.status,
      responseTimeMs,
      message: response.ok ? "健康检查通过" : `健康检查返回 ${response.status}`,
      checkedAt,
      url: healthUrl,
      method: "GET",
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      contentType,
      errorType: response.ok ? null : "HTTP_STATUS",
      errorDetail: response.ok
        ? null
        : `${response.status} ${response.statusText || "HTTP 错误"}`,
      responsePreview,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    const errorName = error instanceof Error ? error.name : "Error";
    const timedOut =
      errorName === "TimeoutError" || responseTimeMs >= HEALTH_CHECK_TIMEOUT_MS;

    return {
      status: "degraded" as const,
      statusCode: null,
      responseTimeMs,
      message: timedOut
        ? `健康检查超时（${HEALTH_CHECK_TIMEOUT_MS}ms）`
        : "健康检查请求失败",
      checkedAt,
      url: healthUrl,
      method: "GET",
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      contentType: null,
      errorType: timedOut ? "TIMEOUT" : errorName,
      errorDetail: timedOut
        ? `超过 ${HEALTH_CHECK_TIMEOUT_MS}ms 未收到响应，请检查服务是否启动、端口是否暴露，以及 Cola 服务所在网络是否能访问该地址。`
        : errorDetail(error),
      responsePreview: null,
    };
  }
}

export function normalizeProjectConfig(
  config: Partial<CmdbProjectConfig> | null | undefined,
): CmdbProjectConfig | undefined {
  if (!config) return undefined;

  const customVariables = Object.fromEntries(
    Object.entries(config.customVariables ?? {})
      .map<[string, string]>(([key, value]) => [key.trim(), value.trim()])
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );

  const normalized: CmdbProjectConfig = {
    triggerToken: cleanString(config.triggerToken),
    targetAssetName: normalizeTargetAssetNames(
      config.targetAssetNames,
      config.targetAssetName,
    )[0],
    targetAssetNames: normalizeTargetAssetNames(
      config.targetAssetNames,
      config.targetAssetName,
    ),
    deployEnv: cleanString(config.deployEnv),
    healthUrl: cleanString(config.healthUrl),
    monitorUrl: cleanString(config.monitorUrl),
    k8sNamespace: cleanString(config.k8sNamespace),
    k8sDeployment: cleanString(config.k8sDeployment),
    dockerImage: cleanString(config.dockerImage),
    sshPath: cleanString(config.sshPath),
    sshDeployCommand: cleanString(config.sshDeployCommand),
  };

  if (Object.keys(customVariables).length > 0) {
    normalized.customVariables = customVariables;
  }

  const hasValue = Object.values(normalized).some((value) => {
    if (value == null) return false;
    if (typeof value === "string") return value.length > 0;
    return Object.keys(value).length > 0;
  });

  return hasValue ? normalized : undefined;
}

async function buildReleaseVariables(
  database: Database,
  project: Pick<
    CmdbProjectRow,
    "deployTarget" | "config" | "gitlabPath" | "defaultBranch"
  >,
  overrides?: Record<string, string>,
) {
  const variables: Record<string, string> = {
    ...(project.config?.customVariables ?? {}),
  };

  if (project.deployTarget !== "none") {
    variables.CMDB_DEPLOY_TARGET = project.deployTarget;
  }
  if (project.config?.deployEnv) {
    variables.DEPLOY_ENV = project.config.deployEnv;
  }
  const targetAssetName = cleanString(project.config?.targetAssetName);
  const targetAssetNames = normalizeTargetAssetNames(
    project.config?.targetAssetNames,
    targetAssetName,
  );
  if (targetAssetNames.length > 0) {
    variables.DEPLOY_ASSET_NAME = targetAssetNames[0]!;
    variables.DEPLOY_ASSET_NAMES = targetAssetNames.join(",");
    variables.DEPLOY_TARGET_COUNT = String(targetAssetNames.length);
    variables.DEPLOY_HOST = targetAssetNames[0]!;

    const assetRows = await database
      .select()
      .from(cmdbAssets)
      .where(inArray(cmdbAssets.name, targetAssetNames));
    const assetByName = new Map(assetRows.map((asset) => [asset.name, asset]));
    const deployTargets = targetAssetNames
      .map((assetName) => assetByName.get(assetName))
      .filter((asset): asset is (typeof assetRows)[number] => Boolean(asset))
      .map((asset) => ({
        name: asset.name,
        host: asset.ip,
        sshHost: asset.ip,
        sshPort: asset.sshPort ?? 22,
        sshUser: cleanString(asset.sshUser) ?? "",
        sshPassword: asset.sshPassword ?? "",
        roles: normalizeAssetRoles(asset.roles),
        arch: normalizeDockerTargetArchitecture(asset.arch) ?? "",
      }));

    if (deployTargets.length > 0) {
      const [primaryTarget] = deployTargets;
      variables.DEPLOY_TARGETS_JSON = JSON.stringify(deployTargets);
      variables.DEPLOY_HOSTS = deployTargets
        .map((target) => target.host)
        .join(",");
      variables.DEPLOY_SSH_HOSTS = deployTargets
        .map((target) => target.sshHost)
        .join(",");
      variables.DEPLOY_SSH_PORTS = deployTargets
        .map((target) => String(target.sshPort))
        .join(",");
      variables.DEPLOY_SSH_USERS = deployTargets
        .map((target) => target.sshUser)
        .join(",");

      if (primaryTarget) {
        variables.DEPLOY_ASSET_NAME = primaryTarget.name;
        variables.DEPLOY_HOST = primaryTarget.host;
        variables.DEPLOY_SSH_HOST = primaryTarget.sshHost;
        variables.DEPLOY_SSH_PORT = String(primaryTarget.sshPort);
        if (primaryTarget.sshUser) {
          variables.DEPLOY_SSH_USER = primaryTarget.sshUser;
        }
        if (primaryTarget.sshPassword) {
          variables.DEPLOY_SSH_PASSWORD = primaryTarget.sshPassword;
        }
        if (primaryTarget.roles.length > 0) {
          variables.DEPLOY_ASSET_ROLES = primaryTarget.roles.join(",");
        }
      }
      Object.assign(
        variables,
        buildDockerTargetArchitectureVariables({
          targetArchitectures: deployTargets.map((target) => target.arch),
          primaryArchitecture: primaryTarget?.arch,
        }),
      );
    }
  }
  if (project.config?.k8sNamespace) {
    variables.K8S_NAMESPACE = project.config.k8sNamespace;
  }
  if (project.config?.k8sDeployment) {
    variables.K8S_DEPLOYMENT = project.config.k8sDeployment;
  }
  if (project.config?.dockerImage) {
    variables.DOCKER_IMAGE = project.config.dockerImage;
  }
  if (project.gitlabPath) {
    variables.CMDB_PROJECT_PATH = project.gitlabPath;
  }
  if (project.defaultBranch) {
    variables.CMDB_DEFAULT_BRANCH = project.defaultBranch;
  }
  if (project.config?.sshPath) {
    variables.DEPLOY_PATH = project.config.sshPath;
  }
  if (project.config?.sshDeployCommand) {
    variables.DEPLOY_COMMAND = project.config.sshDeployCommand;
  }

  for (const [key, value] of Object.entries(overrides ?? {})) {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (normalizedKey.length === 0 || normalizedValue.length === 0) continue;
    variables[normalizedKey] = normalizedValue;
  }

  return variables;
}

export async function createCmdbRelease(
  database: Database,
  args: {
    project: CmdbProjectRow;
    ownerUserId?: string;
    ref?: string;
    deployEnv?: string;
    variables?: Record<string, string>;
    triggeredBy?: string;
    throwOnPipelineError?: boolean;
  },
) {
  const ref = cleanString(args.ref) ?? args.project.defaultBranch;
  const deployEnv =
    cleanString(args.deployEnv) ?? args.project.config?.deployEnv;
  const variables = await buildReleaseVariables(
    database,
    args.project,
    args.variables,
  );
  assertProjectReleaseReady(args.project);
  assertDockerReleaseArchitectureReady(args.project, variables);

  const [release] = await database
    .insert(cmdbReleases)
    .values({
      projectId: args.project.id,
      ownerUserId: args.ownerUserId,
      ref,
      deployEnv,
      status: "pending",
      variables,
      triggeredBy: cleanString(args.triggeredBy),
      operationLogs: [
        releaseOperationLog(
          "release-created",
          "pending",
          "已创建发布记录",
          `${args.project.name} · ${ref}${deployEnv ? ` -> ${deployEnv}` : ""}`,
        ),
      ],
    })
    .returning();

  if (!release) {
    throw new Error("创建发布记录失败");
  }

  try {
    const triggerStartedLogs = await appendReleaseOperationLog(
      database,
      release,
      releaseOperationLog(
        "gitlab-trigger",
        "running",
        "正在触发 GitLab Pipeline",
        args.project.gitlabPath,
      ),
    );
    const result = await triggerGitLabPipeline({
      gitlabProjectId: args.project.gitlabProjectId,
      gitlabPath: args.project.gitlabPath,
      ref,
      variables,
      triggerToken: args.project.config?.triggerToken,
    });

    const [updatedRelease] = await database
      .update(cmdbReleases)
      .set({
        gitlabPipelineId: result.pipelineId,
        gitlabPipelineUrl: result.pipelineUrl,
        gitlabStatus: result.gitlabStatus,
        status: result.status === "success" ? "running" : result.status,
        operationLogs: appendReleaseOperationLogValue(
          triggerStartedLogs,
          releaseOperationLog(
            "gitlab-trigger",
            result.status === "failed"
              ? "failed"
              : result.status === "canceled"
                ? "canceled"
                : "success",
            "GitLab Pipeline 已创建",
            `Pipeline #${result.pipelineId} · ${result.gitlabStatus}`,
          ),
        ),
      })
      .where(eq(cmdbReleases.id, release.id))
      .returning();

    if (updatedRelease && result.status === "success") {
      await completeCmdbReleaseDeployment(
        database,
        args.project,
        updatedRelease,
      );
      const [completedRelease] = await database
        .select()
        .from(cmdbReleases)
        .where(eq(cmdbReleases.id, updatedRelease.id));

      return completedRelease ?? updatedRelease;
    }

    return updatedRelease ?? release;
  } catch (error) {
    const [failedRelease] = await database
      .update(cmdbReleases)
      .set({
        status: "failed",
        lastError: error instanceof Error ? error.message : "发布失败",
        completedAt: new Date(),
        operationLogs: appendReleaseOperationLogValue(
          await currentReleaseOperationLogs(database, release),
          releaseOperationLog(
            "gitlab-trigger",
            "failed",
            "触发 GitLab Pipeline 失败",
            error instanceof Error ? error.message : "发布失败",
          ),
        ),
      })
      .where(eq(cmdbReleases.id, release.id))
      .returning();

    if (args.throwOnPipelineError === false) {
      return failedRelease ?? release;
    }

    throw error;
  }
}

export async function createCmdbTopicRelease(
  database: Database,
  args: {
    projectIds: number[];
    topic?: string;
    ref?: string;
    deployEnv?: string;
    variables?: Record<string, string>;
    triggeredBy?: string;
    ownerUserId?: string;
  },
) {
  const projectIds = Array.from(new Set(args.projectIds));
  if (projectIds.length === 0) {
    throw new Error("请选择至少一个要发布的项目。");
  }

  const topic = cleanString(args.topic);
  const projectRows = await database
    .select()
    .from(cmdbProjects)
    .where(inArray(cmdbProjects.id, projectIds));
  const projectsById = new Map(
    projectRows.map((project) => [project.id, project]),
  );
  const topicVariables = {
    ...(args.variables ?? {}),
    ...(topic ? { CMDB_RELEASE_TOPIC: topic } : {}),
  };

  const results: Array<{
    projectId: number;
    projectName?: string;
    gitlabPath?: string;
    releaseId?: number;
    status: CmdbReleaseStatus | "skipped";
    pipelineUrl?: string | null;
    error?: string | null;
  }> = [];

  for (const projectId of projectIds) {
    const project = projectsById.get(projectId);

    if (!project) {
      results.push({
        projectId,
        status: "skipped",
        error: "项目不存在。",
      });
      continue;
    }

    if (!project.enabled) {
      results.push({
        projectId,
        projectName: project.name,
        gitlabPath: project.gitlabPath,
        status: "skipped",
        error: "项目已禁用。",
      });
      continue;
    }

    try {
      const release = await createCmdbRelease(database, {
        project,
        ref: args.ref,
        deployEnv: args.deployEnv,
        variables: topicVariables,
        ownerUserId: args.ownerUserId,
        triggeredBy:
          cleanString(args.triggeredBy) ??
          (topic ? `主题发布：${topic}` : "主题发布"),
        throwOnPipelineError: false,
      });

      results.push({
        projectId: project.id,
        projectName: project.name,
        gitlabPath: project.gitlabPath,
        releaseId: release.id,
        status: release.status,
        pipelineUrl: release.gitlabPipelineUrl,
        error: release.lastError,
      });
    } catch (error) {
      results.push({
        projectId: project.id,
        projectName: project.name,
        gitlabPath: project.gitlabPath,
        status: "failed",
        error: error instanceof Error ? error.message : "发布失败",
      });
    }
  }

  const successTotal = results.filter(
    (result) => result.status !== "failed" && result.status !== "skipped",
  ).length;
  const failedTotal = results.length - successTotal;

  return {
    topic: topic ?? null,
    total: results.length,
    successTotal,
    failedTotal,
    results,
  };
}

export async function deleteCmdbTopicReleaseGroup(
  database: Database,
  topic: string,
) {
  const normalizedTopic = cleanString(topic);
  if (!normalizedTopic) {
    throw new Error("主题名称不能为空。");
  }

  await database
    .delete(cmdbReleases)
    .where(
      sql`${cmdbReleases.variables}->>'CMDB_RELEASE_TOPIC' = ${normalizedTopic}`,
    );

  return { success: true };
}

export async function deleteCmdbProject(database: Database, id: number) {
  const [project] = await database
    .select()
    .from(cmdbProjects)
    .where(eq(cmdbProjects.id, id));

  if (!project) {
    throw new Error("项目不存在，无法删除。");
  }

  const cleanupResults: Array<{
    assetName: string;
    containerName: string;
    stdout: string;
    stderr: string;
    code: number | null;
    durationMs: number;
  }> = [];

  if (project.deployTarget === "docker") {
    const containerName = dockerContainerName(project);
    const assets = await resolveProjectAssets(database, project);
    const command = buildDockerRemoveCommand(containerName);

    for (const asset of assets) {
      const result = await sshExecOrThrow(
        asset,
        command,
        `清理 Docker 容器 ${containerName} @ ${asset.name}`,
      );

      cleanupResults.push({
        assetName: asset.name,
        containerName,
        stdout: truncateOutput(result.stdout),
        stderr: truncateOutput(result.stderr),
        code: result.code,
        durationMs: result.durationMs,
      });
    }
  }

  await database.delete(cmdbProjects).where(eq(cmdbProjects.id, id));

  return {
    success: true,
    cleanedContainers: cleanupResults,
  };
}

async function syncAssetNameToProjects(
  database: Database,
  previousName: string,
  nextName: string,
) {
  if (previousName === nextName) return;

  const projectRows = await database.select().from(cmdbProjects);

  for (const project of projectRows) {
    const targetAssetNames = normalizeTargetAssetNames(
      project.config?.targetAssetNames,
      project.config?.targetAssetName,
    );
    if (!targetAssetNames.includes(previousName)) continue;

    await database
      .update(cmdbProjects)
      .set({
        config: normalizeProjectConfig({
          ...project.config,
          targetAssetName:
            cleanString(project.config?.targetAssetName) === previousName
              ? nextName
              : project.config?.targetAssetName,
          targetAssetNames: targetAssetNames.map((assetName) =>
            assetName === previousName ? nextName : assetName,
          ),
        }),
      })
      .where(eq(cmdbProjects.id, project.id));
  }
}

export async function upsertCmdbAsset(
  database: Database,
  input: {
    id?: number;
    name: string;
    ip: string;
    sshUser?: string;
    sshPassword?: string;
    sshPort?: number;
    roles?: string[];
    arch?: string;
    status: CmdbAssetStatus;
    ownerUserId?: string;
  },
) {
  const name = cleanString(input.name);
  if (!name) {
    throw new Error("请填写服务器资产名称。");
  }

  const ip = cleanString(input.ip);
  if (!ip) {
    throw new Error("请填写服务器 IP 或主机地址。");
  }

  const sshUser = cleanString(input.sshUser);
  if (!sshUser) {
    throw new Error("请填写 SSH 用户。");
  }

  if (!input.sshPassword) {
    throw new Error("请填写 SSH 密码。");
  }

  const sshPort = input.sshPort ?? 22;
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
    throw new Error("SSH 端口必须是 1-65535 的整数。");
  }

  const [sameNameAsset] = await database
    .select()
    .from(cmdbAssets)
    .where(eq(cmdbAssets.name, name));

  if (sameNameAsset && sameNameAsset.id !== input.id) {
    throw new Error(`资产名称 ${name} 已存在，请使用其他名称。`);
  }

  const values = {
    name,
    ip,
    sshUser,
    sshPassword: input.sshPassword,
    sshPort,
    roles: normalizeAssetRoles(input.roles),
    arch: cleanString(input.arch) ?? null,
    status: input.status,
  };

  if (input.id) {
    const [existingAsset] = await database
      .select()
      .from(cmdbAssets)
      .where(eq(cmdbAssets.id, input.id));

    if (!existingAsset) {
      throw new Error("资产不存在，无法更新。");
    }

    const [updatedAsset] = await database
      .update(cmdbAssets)
      .set(values)
      .where(eq(cmdbAssets.id, input.id))
      .returning();

    if (!updatedAsset) {
      throw new Error("资产不存在，无法更新。");
    }

    await syncAssetNameToProjects(
      database,
      existingAsset.name,
      updatedAsset.name,
    );

    return updatedAsset;
  }

  const [createdAsset] = await database
    .insert(cmdbAssets)
    .values({
      ...values,
      ownerUserId: input.ownerUserId,
    })
    .returning();

  if (!createdAsset) {
    throw new Error("创建资产失败。");
  }

  return createdAsset;
}

export async function deleteCmdbAsset(database: Database, id: number) {
  const [asset] = await database
    .select()
    .from(cmdbAssets)
    .where(eq(cmdbAssets.id, id));

  if (!asset) {
    throw new Error("资产不存在，无法删除。");
  }

  const attachedProjects = await database.select().from(cmdbProjects);
  const linkedProjectCount = attachedProjects.filter((project) =>
    normalizeTargetAssetNames(
      project.config?.targetAssetNames,
      project.config?.targetAssetName,
    ).includes(asset.name),
  ).length;

  if (linkedProjectCount > 0) {
    throw new Error(
      `资产 ${asset.name} 已关联 ${linkedProjectCount} 个项目，请先解除关联后再删除。`,
    );
  }

  await database.delete(cmdbAssets).where(eq(cmdbAssets.id, id));

  return { success: true };
}

export async function upsertCmdbProject(
  database: Database,
  input: {
    id?: number;
    name?: string;
    gitlabPath: string;
    description?: string;
    defaultBranch?: string;
    enabled: boolean;
    deployTarget: (typeof cmdbDeployTargetValues)[number];
    config?: Partial<CmdbProjectConfig>;
    syncWithGitLab: boolean;
    ownerUserId?: string;
  },
) {
  const gitlabPath = cleanString(input.gitlabPath);
  if (!gitlabPath) {
    throw new Error("请填写 GitLab 项目路径，例如 group/project。");
  }

  let gitlabMeta: {
    gitlabProjectId: number;
    name: string;
    path: string;
    description: string | null;
    defaultBranch: string;
    webUrl: string;
  } | null = null;

  if (input.syncWithGitLab) {
    gitlabMeta = await fetchGitLabProject(gitlabPath);
  }

  const name = cleanString(input.name) ?? gitlabMeta?.name;
  if (!name) {
    throw new Error("请填写项目名称，或开启 GitLab 同步自动拉取项目元数据。");
  }

  const values = {
    name,
    gitlabProjectId: gitlabMeta?.gitlabProjectId,
    gitlabPath: gitlabMeta?.path ?? gitlabPath,
    gitlabWebUrl: gitlabMeta?.webUrl,
    description:
      cleanString(input.description) ?? gitlabMeta?.description ?? null,
    defaultBranch:
      cleanString(input.defaultBranch) ?? gitlabMeta?.defaultBranch ?? "main",
    enabled: input.enabled,
    deployTarget: input.deployTarget,
    config: normalizeProjectConfig(input.config),
    lastSyncedAt: gitlabMeta ? new Date() : null,
  };

  if (input.id) {
    const [updatedProject] = await database
      .update(cmdbProjects)
      .set(values)
      .where(eq(cmdbProjects.id, input.id))
      .returning();

    if (!updatedProject) {
      throw new Error("项目不存在，无法更新。");
    }

    return updatedProject;
  }

  const [existingProject] = await database
    .select()
    .from(cmdbProjects)
    .where(eq(cmdbProjects.gitlabPath, values.gitlabPath));

  if (existingProject) {
    const [updatedProject] = await database
      .update(cmdbProjects)
      .set(values)
      .where(eq(cmdbProjects.id, existingProject.id))
      .returning();

    if (!updatedProject) {
      throw new Error("项目不存在，无法更新。");
    }

    return updatedProject;
  }

  const [createdProject] = await database
    .insert(cmdbProjects)
    .values({
      ...values,
      ownerUserId: input.ownerUserId,
    })
    .returning();

  if (!createdProject) {
    throw new Error("创建项目失败。");
  }

  return createdProject;
}

export async function getCmdbDashboard(database: Database) {
  startCmdbAssetSshMonitor(database);
  await refreshRunningCmdbReleases(database);

  const [assetRows, projectRows, releaseRows] = await Promise.all([
    database.select().from(cmdbAssets).orderBy(cmdbAssets.name),
    database
      .select()
      .from(cmdbProjects)
      .orderBy(desc(cmdbProjects.enabled), cmdbProjects.name),
    database.select().from(cmdbReleases).orderBy(desc(cmdbReleases.createdAt)),
  ]);
  const ownerMap = await loadResourceOwnerMap(database, [
    ...assetRows.map((asset) => asset.ownerUserId),
    ...projectRows.map((project) => project.ownerUserId),
    ...releaseRows.map((release) => release.ownerUserId),
  ]);

  const projectSummaryById = new Map(
    projectRows.map((project) => [
      project.id,
      {
        id: project.id,
        name: project.name,
        gitlabPath: project.gitlabPath,
        gitlabWebUrl: buildGitLabProjectUrl(
          project.gitlabPath,
          project.gitlabWebUrl,
        ),
        deployTarget: project.deployTarget,
      },
    ]),
  );
  const releaseRowsByProject = new Map<number, CmdbReleaseRow[]>();
  const releaseWithProject = (release: CmdbReleaseRow) => ({
    ...release,
    ownerUser: ownerForUserId(ownerMap, release.ownerUserId),
    project: projectSummaryById.get(release.projectId) ?? null,
  });

  const latestReleaseByProject = new Map<
    number,
    ReturnType<typeof releaseWithProject>
  >();
  for (const release of releaseRows) {
    const projectReleases = releaseRowsByProject.get(release.projectId);
    if (projectReleases) {
      projectReleases.push(release);
    } else {
      releaseRowsByProject.set(release.projectId, [release]);
    }

    if (!latestReleaseByProject.has(release.projectId)) {
      latestReleaseByProject.set(
        release.projectId,
        releaseWithProject(release),
      );
    }
  }

  const attachedProjectCountByAsset = new Map<string, number>();

  for (const project of projectRows) {
    for (const assetName of normalizeTargetAssetNames(
      project.config?.targetAssetNames,
      project.config?.targetAssetName,
    )) {
      attachedProjectCountByAsset.set(
        assetName,
        (attachedProjectCountByAsset.get(assetName) ?? 0) + 1,
      );
    }
  }

  const assets = assetRows
    .map((asset) => {
      const roles = normalizeAssetRoles(asset.roles);

      return {
        id: asset.id,
        name: asset.name,
        ip: asset.ip,
        sshUser: cleanString(asset.sshUser) ?? null,
        sshPassword: asset.sshPassword ?? null,
        sshPort: asset.sshPort ?? 22,
        roles,
        arch: cleanString(asset.arch) ?? null,
        hasGpu: roles.includes("gpu"),
        isController: roles.includes("master"),
        attachedProjectCount: attachedProjectCountByAsset.get(asset.name) ?? 0,
        status: asset.status,
        ownerUserId: asset.ownerUserId,
        ownerUser: ownerForUserId(ownerMap, asset.ownerUserId),
      };
    })
    .sort((left, right) => {
      if (left.isController !== right.isController) {
        return left.isController ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  const projects = await Promise.all(
    projectRows.map(async (project) => ({
      ...project,
      ownerUser: ownerForUserId(ownerMap, project.ownerUserId),
      gitlabWebUrl: buildGitLabProjectUrl(
        project.gitlabPath,
        project.gitlabWebUrl,
      ),
      latestRelease: latestReleaseByProject.get(project.id) ?? null,
      releases: (releaseRowsByProject.get(project.id) ?? [])
        .slice(0, 8)
        .map(releaseWithProject),
      monitor: await probeProjectHealth(project.config),
    })),
  );

  const recentReleases = releaseRows.slice(0, 12).map(releaseWithProject);

  return {
    gitlab: {
      baseUrl: gitlabBaseUrl(),
      canBrowseCatalog: hasGitLabApiAccess(),
      canTriggerPipelines: hasGitLabTriggerSupport(),
      hasApiToken: Boolean(env.GITLAB_API_TOKEN),
    },
    cluster: {
      clusterName: null,
      controllerIp: null,
      kubernetesVersion: null,
    },
    overview: {
      assetTotal: assets.length,
      connectedAssetTotal: assets.filter(
        (asset) => asset.status === "connected",
      ).length,
      gpuAssetTotal: assets.filter((asset) => asset.hasGpu).length,
      projectTotal: projects.length,
      monitoredProjectTotal: projects.filter((project) =>
        Boolean(project.config?.healthUrl),
      ).length,
      healthyProjectTotal: projects.filter(
        (project) => project.monitor.status === "healthy",
      ).length,
      runningReleaseTotal: releaseRows.filter(
        (release) =>
          release.status === "pending" || release.status === "running",
      ).length,
      failedReleaseTotal: releaseRows.filter(
        (release) => release.status === "failed",
      ).length,
    },
    assets,
    projects,
    releases: recentReleases,
  };
}
