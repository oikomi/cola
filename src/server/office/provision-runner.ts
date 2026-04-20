import {
  type DockerRunnerEngine,
  runnerRuntimeLabels,
  type RunnerRuntime,
} from "@/server/office/catalog";
import {
  cleanupDockerRunner,
  provisionDockerRunner,
  type ProvisionDockerRunnerInput as ProvisionRunnerInput,
  type ProvisionDockerRunnerResult as ProvisionRunnerResult,
} from "@/server/office/provision-docker-runner";
import {
  cleanupKubernetesRunner,
  provisionKubernetesRunner,
} from "@/server/office/provision-kubernetes-runner";
import type { devices } from "@/server/db/schema";

export type { ProvisionRunnerInput, ProvisionRunnerResult };

export function getRunnerRuntime(): RunnerRuntime {
  const configured = process.env.COLA_RUNNER_RUNTIME?.trim().toLowerCase();
  if (configured === "docker" || configured === "kubernetes") {
    return configured;
  }

  return "kubernetes";
}

export function runnerRuntimeLabel(runtime: RunnerRuntime) {
  return runnerRuntimeLabels[runtime];
}

export async function provisionRunner(
  input: ProvisionRunnerInput,
): Promise<ProvisionRunnerResult> {
  return getRunnerRuntime() === "kubernetes"
    ? provisionKubernetesRunner(input)
    : provisionDockerRunner(input);
}

export function runnerRuntimeMetadataPatch(runtime: RunnerRuntime) {
  return {
    runtime,
    runtimeLabel: runnerRuntimeLabel(runtime),
  };
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

  if (runtime === "kubernetes") {
    await cleanupKubernetesRunner({
      namespace:
        metadata && typeof metadata.namespace === "string"
          ? metadata.namespace
          : null,
      deploymentName:
        metadata && typeof metadata.deploymentName === "string"
          ? metadata.deploymentName
          : null,
      serviceName:
        metadata && typeof metadata.serviceName === "string"
          ? metadata.serviceName
          : null,
      configMapName:
        metadata && typeof metadata.configMapName === "string"
          ? metadata.configMapName
          : null,
      codexSecretName:
        metadata && typeof metadata.codexSecretName === "string"
          ? metadata.codexSecretName
          : null,
      codexSecretManaged: Boolean(
        metadata && metadata.codexSecretManaged === "true",
      ),
    });
    return;
  }

  await cleanupDockerRunner({
    containerName:
      metadata && typeof metadata.containerName === "string"
        ? metadata.containerName
        : null,
  });
}

function resolveCleanupRuntime(value: string): RunnerRuntime {
  return value === "kubernetes" ? "kubernetes" : "docker";
}
