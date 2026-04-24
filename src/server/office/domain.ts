import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  dockerRunnerEngineValues,
  roleLabels,
  runnerRuntimeValues,
  type AgentRole,
  type DockerRunnerEngine,
  type RunnerRuntime,
  type ZoneId,
} from "./catalog.ts";
const execFileAsync = promisify(execFile);

async function loadKubernetesRunnerDashboardHelpers() {
  return import("./provision-kubernetes-runner.ts");
}

export type RunnerMetadata = {
  agentId: string | null;
  agentName: string | null;
  containerName: string | null;
  deploymentName: string | null;
  engine: DockerRunnerEngine | null;
  namespace: string | null;
  nativeDashboardUrl: string | null;
  nodePort: number | null;
  runtime: RunnerRuntime | null;
};

export const zoneByRole: Record<AgentRole, ZoneId> = {
  product: "product",
  engineering: "engineering",
  operations: "growth",
  hr: "people",
  procurement: "vendor",
  ceo_office: "command",
};

export const resourcePoolByRole: Record<AgentRole, string> = {
  product: "docker-command",
  engineering: "docker-core",
  operations: "docker-ops",
  hr: "docker-backoffice",
  procurement: "docker-backoffice",
  ceo_office: "docker-command",
};

export function roleLabel(role: AgentRole) {
  return roleLabels[role];
}

export function zoneForRole(role: AgentRole) {
  return zoneByRole[role];
}

export function resourcePoolForRole(role: AgentRole) {
  return resourcePoolByRole[role];
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeMetadata(
  current: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(isPlainRecord(current) ? current : {}),
    ...patch,
  };
}

export function resolveDockerRunnerEngine(engine: unknown): DockerRunnerEngine {
  if (
    typeof engine === "string" &&
    dockerRunnerEngineValues.includes(engine as DockerRunnerEngine)
  ) {
    return engine as DockerRunnerEngine;
  }

  return "openclaw";
}

export function resolveRunnerRuntime(runtime: unknown): RunnerRuntime {
  if (
    typeof runtime === "string" &&
    runnerRuntimeValues.includes(runtime as RunnerRuntime)
  ) {
    return runtime as RunnerRuntime;
  }

  return "docker";
}

function optionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function nodePortFromValue(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const nodePort = Number(value);
  return Number.isInteger(nodePort) && nodePort > 0 ? nodePort : null;
}

export function parseRunnerMetadata(metadata: unknown): RunnerMetadata {
  const record = isPlainRecord(metadata) ? metadata : {};
  const rawEngine = record.engine;
  const rawRuntime = record.runtime;

  return {
    agentId: optionalString(record, "agentId"),
    agentName: optionalString(record, "agentName"),
    containerName: optionalString(record, "containerName"),
    deploymentName: optionalString(record, "deploymentName"),
    engine:
      typeof rawEngine === "string" &&
      dockerRunnerEngineValues.includes(rawEngine as DockerRunnerEngine)
        ? (rawEngine as DockerRunnerEngine)
        : null,
    namespace: optionalString(record, "namespace"),
    nativeDashboardUrl: optionalString(record, "nativeDashboardUrl"),
    nodePort: nodePortFromValue(record.nodePort),
    runtime:
      typeof rawRuntime === "string" &&
      runnerRuntimeValues.includes(rawRuntime as RunnerRuntime)
        ? (rawRuntime as RunnerRuntime)
        : null,
  };
}

function rebuildOpenClawDashboardUrl(currentUrl: string, freshUrl: string) {
  const fresh = new URL(freshUrl);
  const current = new URL(currentUrl);
  const publicHost =
    process.env.COLA_OPENCLAW_DASHBOARD_PUBLIC_HOST ??
    process.env.COLA_DASHBOARD_PUBLIC_HOST ??
    current.hostname;
  const port = current.port || fresh.port;
  const controlUrl = new URL(
    `${current.protocol}//${publicHost}${port ? `:${port}` : ""}/`,
  );

  controlUrl.searchParams.set(
    "gatewayUrl",
    `${controlUrl.protocol === "https:" ? "wss:" : "ws:"}//${publicHost}${port ? `:${port}` : ""}`,
  );
  controlUrl.hash = fresh.hash;

  return controlUrl.toString();
}

async function refreshDockerOpenClawDashboardUrl(metadata: RunnerMetadata) {
  if (!metadata.containerName || !metadata.nativeDashboardUrl) {
    return null;
  }

  const { stdout } = await execFileAsync("docker", [
    "exec",
    metadata.containerName,
    "sh",
    "-lc",
    "OPENCLAW_CONFIG_PATH=/tmp/openclaw.generated.json openclaw dashboard --no-open",
  ]);
  const dashboardLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("Dashboard URL: "));

  if (!dashboardLine) return metadata.nativeDashboardUrl;

  return rebuildOpenClawDashboardUrl(
    metadata.nativeDashboardUrl,
    dashboardLine.replace("Dashboard URL: ", "").trim(),
  );
}

export async function resolveRunnerDashboardUrl(metadataInput: unknown) {
  const metadata = parseRunnerMetadata(metadataInput);
  const { buildNativeDashboardUrl, resolveKubernetesRunnerDashboardUrl } =
    await loadKubernetesRunnerDashboardHelpers();
  const fallbackUrl =
    metadata.nodePort && metadata.engine
      ? buildNativeDashboardUrl(metadata.engine, metadata.nodePort)
      : null;

  if (metadata.runtime === "kubernetes") {
    if (metadata.nodePort && metadata.engine) {
      const directUrl = await resolveKubernetesRunnerDashboardUrl({
        engine: metadata.engine,
        namespace: metadata.namespace,
        deploymentName: metadata.deploymentName,
        nodePort: metadata.nodePort,
      });

      return directUrl ?? fallbackUrl ?? metadata.nativeDashboardUrl;
    }

    return fallbackUrl ?? metadata.nativeDashboardUrl;
  }

  if (metadata.engine !== "openclaw") {
    return metadata.nativeDashboardUrl ?? fallbackUrl;
  }

  try {
    return (
      (await refreshDockerOpenClawDashboardUrl(metadata)) ??
      metadata.nativeDashboardUrl ??
      fallbackUrl
    );
  } catch {
    return metadata.nativeDashboardUrl ?? fallbackUrl;
  }
}
