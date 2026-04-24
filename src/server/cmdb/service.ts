import { readFile } from "node:fs/promises";
import path from "node:path";

import { desc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { env } from "@/env";
import type * as DbSchema from "@/server/db/schema";
import {
  cmdbProjects,
  cmdbReleases,
  type CmdbProjectConfig,
} from "@/server/db/schema";

export const cmdbDeployTargetValues = ["k8s", "ssh", "docker", "none"] as const;
export const cmdbReleaseStatusValues = [
  "pending",
  "running",
  "success",
  "failed",
  "canceled",
] as const;

type Database = PostgresJsDatabase<typeof DbSchema>;
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

type ClusterNode = {
  name: string;
  ip: string;
  sshUser?: string;
  sshPassword?: string;
  sshPort?: number;
  roles?: string[];
  arch?: string;
};

type ClusterSummary = {
  clusterName?: string;
  controllerIp?: string;
  kubernetesVersion?: string;
  includedNodes?: ClusterNode[];
  skippedNodes?: ClusterNode[];
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

function buildGitLabProjectUrl(projectPath: string, fallbackUrl?: string | null) {
  if (fallbackUrl) return fallbackUrl;

  const baseUrl = gitlabBaseUrl();
  if (!baseUrl) return null;

  return `${baseUrl}/${projectPath}`;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function repoPath(...segments: string[]) {
  return path.join(process.cwd(), ...segments);
}

async function loadClusterInventory() {
  const [nodeList, clusterSummary] = await Promise.all([
    readJsonFile<ClusterNode[]>(repoPath("infra", "k8s", "cluster", "nodes.json")),
    readJsonFile<ClusterSummary>(
      repoPath("infra", "k8s", "runtime", "generated", "cluster-summary.json"),
    ),
  ]);

  const nodes = new Map<string, ClusterNode>();

  for (const node of nodeList ?? []) {
    nodes.set(node.name, node);
  }

  for (const node of clusterSummary?.includedNodes ?? []) {
    if (!nodes.has(node.name)) {
      nodes.set(node.name, node);
    }
  }

  for (const node of clusterSummary?.skippedNodes ?? []) {
    if (!nodes.has(node.name)) {
      nodes.set(node.name, node);
    }
  }

  return {
    clusterName: clusterSummary?.clusterName ?? null,
    controllerIp: clusterSummary?.controllerIp ?? null,
    kubernetesVersion: clusterSummary?.kubernetesVersion ?? null,
    nodes,
    includedNodeNames: new Set(
      (clusterSummary?.includedNodes ?? []).map((node) => node.name),
    ),
    skippedNodeNames: new Set(
      (clusterSummary?.skippedNodes ?? []).map((node) => node.name),
    ),
  };
}

async function gitlabApiFetch<T>(
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const apiBaseUrl = gitlabApiBaseUrl();

  if (!apiBaseUrl || !env.GITLAB_API_TOKEN) {
    throw new Error("GitLab API 未配置，请设置 GITLAB_URL 和 GITLAB_API_TOKEN。");
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
    const payload = (await response.json().catch(() => null)) as
      | { message?: unknown; error?: unknown }
      | null;
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

function normalizePipelineStatus(status: string | null | undefined): CmdbReleaseStatus {
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
  const project = await gitlabApiFetch<GitLabProject>(`/projects/${encodedPath}`);

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

  const items = await gitlabApiFetch<GitLabProject[]>(`/projects?${params.toString()}`);

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

  const projectRef = args.gitlabProjectId ?? encodeURIComponent(args.gitlabPath);
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
      const payload = (await response.json().catch(() => null)) as
        | { message?: unknown; error?: unknown }
        | null;
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
      pipelineUrl: pipeline.web_url ?? buildGitLabProjectUrl(args.gitlabPath, null),
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

  const pipeline = await gitlabApiFetch<GitLabPipeline>(`/projects/${projectRef}/pipeline`, {
    method: "POST",
    body: JSON.stringify(requestBody),
  });

  return {
    pipelineId: pipeline.id,
    pipelineUrl: pipeline.web_url ?? buildGitLabProjectUrl(args.gitlabPath, null),
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
        nextStatus === "pending" || nextStatus === "running" ? null : new Date();

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

async function probeProjectHealth(config: CmdbProjectConfig | null | undefined) {
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
    targetAssetName: cleanString(config.targetAssetName),
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

function buildReleaseVariables(
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
  if (project.config?.targetAssetName) {
    variables.DEPLOY_HOST = project.config.targetAssetName;
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

export async function createCmdbRelease(database: Database, args: {
  project: CmdbProjectRow;
  ref?: string;
  deployEnv?: string;
  variables?: Record<string, string>;
  triggeredBy?: string;
}) {
  const ref = cleanString(args.ref) ?? args.project.defaultBranch;
  const deployEnv = cleanString(args.deployEnv) ?? args.project.config?.deployEnv;
  const variables = buildReleaseVariables(args.project, args.variables);

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
    await database
      .update(cmdbReleases)
      .set({
        status: "failed",
        lastError: error instanceof Error ? error.message : "发布失败",
        completedAt: new Date(),
      })
      .where(eq(cmdbReleases.id, release.id));

    throw error;
  }
}

export async function upsertCmdbProject(database: Database, input: {
  id?: number;
  name?: string;
  gitlabPath: string;
  description?: string;
  defaultBranch?: string;
  enabled: boolean;
  deployTarget: (typeof cmdbDeployTargetValues)[number];
  config?: Partial<CmdbProjectConfig>;
  syncWithGitLab: boolean;
}) {
  const gitlabPath = cleanString(input.gitlabPath);
  if (!gitlabPath) {
    throw new Error("请填写 GitLab 项目路径，例如 group/project。");
  }

  let gitlabMeta:
    | {
        gitlabProjectId: number;
        name: string;
        path: string;
        description: string | null;
        defaultBranch: string;
        webUrl: string;
      }
    | null = null;

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
    description: cleanString(input.description) ?? gitlabMeta?.description ?? null,
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

  const [projectRows, releaseRows] = await Promise.all([
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

  const assetInventory = await loadClusterInventory();
  const attachedProjectCountByAsset = new Map<string, number>();

  for (const project of projectRows) {
    const assetName = cleanString(project.config?.targetAssetName);
    if (!assetName) continue;
    attachedProjectCountByAsset.set(
      assetName,
      (attachedProjectCountByAsset.get(assetName) ?? 0) + 1,
    );
  }

  const assets = Array.from(assetInventory.nodes.values())
    .map((node) => {
      const roles = node.roles ?? [];
      let status: "connected" | "planned" | "unknown" = "unknown";

      if (assetInventory.includedNodeNames.has(node.name)) {
        status = "connected";
      } else if (assetInventory.skippedNodeNames.has(node.name)) {
        status = "planned";
      } else if (assetInventory.nodes.size > 0) {
        status = "planned";
      }

      return {
        name: node.name,
        ip: node.ip,
        sshUser: cleanString(node.sshUser) ?? null,
        sshPort: node.sshPort ?? 22,
        roles,
        arch: cleanString(node.arch) ?? null,
        hasGpu: roles.includes("gpu"),
        isController:
          node.ip === assetInventory.controllerIp || roles.includes("master"),
        attachedProjectCount: attachedProjectCountByAsset.get(node.name) ?? 0,
        status,
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
      gitlabWebUrl: buildGitLabProjectUrl(project.gitlabPath, project.gitlabWebUrl),
      latestRelease: latestReleaseByProject.get(project.id) ?? null,
      monitor: await probeProjectHealth(project.config),
    })),
  );

  const recentReleases = releaseRows.slice(0, 12).map((release) => {
    const project = projectRows.find((item) => item.id === release.projectId) ?? null;

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
      clusterName: assetInventory.clusterName,
      controllerIp: assetInventory.controllerIp,
      kubernetesVersion: assetInventory.kubernetesVersion,
    },
    overview: {
      assetTotal: assets.length,
      connectedAssetTotal: assets.filter((asset) => asset.status === "connected")
        .length,
      gpuAssetTotal: assets.filter((asset) => asset.hasGpu).length,
      projectTotal: projects.length,
      monitoredProjectTotal: projects.filter((project) =>
        Boolean(project.config?.healthUrl),
      ).length,
      healthyProjectTotal: projects.filter(
        (project) => project.monitor.status === "healthy",
      ).length,
      runningReleaseTotal: releaseRows.filter((release) =>
        release.status === "pending" || release.status === "running",
      ).length,
      failedReleaseTotal: releaseRows.filter((release) => release.status === "failed")
        .length,
    },
    assets,
    projects,
    releases: recentReleases,
  };
}
