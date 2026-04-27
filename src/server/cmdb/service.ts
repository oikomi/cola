import { desc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Client } from "ssh2";
import type { ConnectConfig } from "ssh2";

import { env } from "@/env";
import type * as DbSchema from "@/server/db/schema";
import {
  cmdbAssets,
  cmdbProjects,
  cmdbReleases,
  type CmdbProjectConfig,
} from "@/server/db/schema";

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
type CmdbProjectRow = typeof cmdbProjects.$inferSelect;
type CmdbReleaseRow = typeof cmdbReleases.$inferSelect;

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

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: unknown;
      error?: unknown;
    } | null;
    const rawMessage = payload?.message ?? payload?.error;
    const message =
      typeof rawMessage === "string"
        ? rawMessage
        : rawMessage == null
          ? `HTTP ${response.status}`
          : JSON.stringify(rawMessage);

    throw new Error(`GitLab API 错误: ${message}`);
  }

  return response.json() as Promise<T>;
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

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: unknown;
        error?: unknown;
      } | null;
      const rawMessage = payload?.message ?? payload?.error;
      const message =
        typeof rawMessage === "string"
          ? rawMessage
          : rawMessage == null
            ? `HTTP ${response.status}`
            : JSON.stringify(rawMessage);

      throw new Error(`GitLab Trigger 失败: ${message}`);
    }

    const pipeline = (await response.json()) as GitLabPipeline;
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
      const pipeline = await gitlabApiFetch<GitLabPipeline>(
        `/projects/${item.project.gitlabProjectId ?? encodeURIComponent(item.project.gitlabPath)}/pipelines/${item.release.gitlabPipelineId}`,
      );

      const nextStatus = normalizePipelineStatus(pipeline.status);
      const completedAt =
        nextStatus === "pending" || nextStatus === "running"
          ? null
          : new Date();

      if (
        nextStatus !== item.release.status ||
        pipeline.status !== item.release.gitlabStatus ||
        (completedAt && !item.release.completedAt)
      ) {
        await database
          .update(cmdbReleases)
          .set({
            status: nextStatus,
            gitlabStatus: pipeline.status,
            completedAt,
          })
          .where(eq(cmdbReleases.id, item.release.id));
      }
    } catch {
      // Keep last known state when GitLab polling fails.
    }
  }
}

async function probeProjectHealth(
  config: CmdbProjectConfig | null | undefined,
) {
  const healthUrl = cleanString(config?.healthUrl);

  if (!healthUrl) {
    return {
      status: "unknown" as const,
      statusCode: null,
      responseTimeMs: null,
      message: "未配置健康检查地址",
    };
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });

    const responseTimeMs = Date.now() - startedAt;
    return {
      status: response.ok ? ("healthy" as const) : ("degraded" as const),
      statusCode: response.status,
      responseTimeMs,
      message: response.ok ? "健康检查通过" : `健康检查返回 ${response.status}`,
    };
  } catch (error) {
    return {
      status: "degraded" as const,
      statusCode: null,
      responseTimeMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "健康检查失败",
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
  project: Pick<CmdbProjectRow, "deployTarget" | "config">,
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
        arch: cleanString(asset.arch) ?? "",
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
        if (primaryTarget.arch) {
          variables.DEPLOY_ASSET_ARCH = primaryTarget.arch;
        }
      }
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

  const [release] = await database
    .insert(cmdbReleases)
    .values({
      projectId: args.project.id,
      ref,
      deployEnv,
      status: "pending",
      variables,
      triggeredBy: cleanString(args.triggeredBy),
    })
    .returning();

  if (!release) {
    throw new Error("创建发布记录失败");
  }

  try {
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
        status: result.status,
      })
      .where(eq(cmdbReleases.id, release.id))
      .returning();

    return updatedRelease ?? release;
  } catch (error) {
    const [failedRelease] = await database
      .update(cmdbReleases)
      .set({
        status: "failed",
        lastError: error instanceof Error ? error.message : "发布失败",
        completedAt: new Date(),
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
    .values(values)
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

  const [createdProject] = await database
    .insert(cmdbProjects)
    .values(values)
    .returning();

  if (!createdProject) {
    throw new Error("创建项目失败。");
  }

  return createdProject;
}

export async function getCmdbDashboard(database: Database) {
  await refreshRunningCmdbReleases(database);

  const [assetRows, projectRows, releaseRows] = await Promise.all([
    database.select().from(cmdbAssets).orderBy(cmdbAssets.name),
    database
      .select()
      .from(cmdbProjects)
      .orderBy(desc(cmdbProjects.enabled), cmdbProjects.name),
    database.select().from(cmdbReleases).orderBy(desc(cmdbReleases.createdAt)),
  ]);

  const latestReleaseByProject = new Map<number, CmdbReleaseRow>();
  for (const release of releaseRows) {
    if (!latestReleaseByProject.has(release.projectId)) {
      latestReleaseByProject.set(release.projectId, release);
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
      gitlabWebUrl: buildGitLabProjectUrl(
        project.gitlabPath,
        project.gitlabWebUrl,
      ),
      latestRelease: latestReleaseByProject.get(project.id) ?? null,
      monitor: await probeProjectHealth(project.config),
    })),
  );

  const recentReleases = releaseRows.slice(0, 12).map((release) => {
    const project =
      projectRows.find((item) => item.id === release.projectId) ?? null;

    return {
      ...release,
      project: project
        ? {
            id: project.id,
            name: project.name,
            gitlabPath: project.gitlabPath,
            gitlabWebUrl: buildGitLabProjectUrl(
              project.gitlabPath,
              project.gitlabWebUrl,
            ),
            deployTarget: project.deployTarget,
          }
        : null,
    };
  });

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
