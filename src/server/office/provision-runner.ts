import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  runnerRuntimeLabels,
  type RunnerRuntime,
} from "@/server/office/catalog";
import {
  cleanupKubernetesRunner,
  provisionKubernetesRunner,
} from "@/server/office/provision-kubernetes-runner";
import type { devices } from "@/server/db/schema";
import type {
  ProvisionRunnerInput,
  ProvisionRunnerResult,
} from "@/server/office/provision-types";

export type { ProvisionRunnerInput, ProvisionRunnerResult };

const execFileAsync = promisify(execFile);
const RUNNER_RUNTIME = "kubernetes" as const;

export function getRunnerRuntime(): RunnerRuntime {
  return RUNNER_RUNTIME;
}

export function runnerRuntimeLabel(runtime: RunnerRuntime) {
  return runnerRuntimeLabels[runtime];
}

export async function provisionRunner(
  input: ProvisionRunnerInput,
): Promise<ProvisionRunnerResult> {
  return provisionKubernetesRunner(input);
}

type DeviceRecord = typeof devices.$inferSelect;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function cleanupRunner(device: DeviceRecord) {
  const metadata = isPlainRecord(device.metadata) ? device.metadata : null;
  const runtime =
    metadata && typeof metadata.runtime === "string"
      ? resolveCleanupRuntime(metadata.runtime)
      : getRunnerRuntime();

  if (runtime === "docker") {
    await cleanupLegacyDockerRunner(
      metadata && typeof metadata.containerName === "string"
        ? metadata.containerName
        : null,
    );
    return;
  }

  await cleanupKubernetesRunner({
    namespace:
      typeof metadata?.namespace === "string" ? metadata.namespace : null,
    deploymentName:
      typeof metadata?.deploymentName === "string"
        ? metadata.deploymentName
        : null,
    serviceName:
      typeof metadata?.serviceName === "string" ? metadata.serviceName : null,
    configMapName:
      typeof metadata?.configMapName === "string"
        ? metadata.configMapName
        : null,
    codexSecretName:
      typeof metadata?.codexSecretName === "string"
        ? metadata.codexSecretName
        : null,
    codexSecretManaged: Boolean(metadata?.codexSecretManaged === "true"),
  });
}

function resolveCleanupRuntime(value: string): RunnerRuntime {
  return value === "docker" ? "docker" : RUNNER_RUNTIME;
}

async function cleanupLegacyDockerRunner(containerName?: string | null) {
  const trimmedName = containerName?.trim();
  if (!trimmedName) return;

  try {
    await execFileAsync("docker", ["rm", "-f", trimmedName]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("No such container") ||
      message.includes("No such object")
    ) {
      return;
    }
    throw error;
  }
}
