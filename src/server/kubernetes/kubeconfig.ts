import fs from "node:fs";
import path from "node:path";

import { KubeConfig } from "@kubernetes/client-node";

type KubeconfigPathOptions = {
  clusterName: string;
  envVarNames?: string[];
  fallbackPaths?: Array<string | null | undefined>;
};

type CreateKubeConfigOptions = KubeconfigPathOptions & {
  preferInCluster?: boolean;
  warnPrefix?: string;
};

function normalizePathCandidate(candidate: string | null | undefined) {
  const value = candidate?.trim();
  return value && value.length > 0 ? value : null;
}

function uniqueCandidates(candidates: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    const value = normalizePathCandidate(candidate);
    if (!value || seen.has(value)) continue;

    seen.add(value);
    result.push(value);
  }

  return result;
}

export function clusterKubeconfigPath(clusterName: string) {
  return path.join(
    "/etc/kubeasz",
    "clusters",
    clusterName,
    "kubectl.kubeconfig",
  );
}

export function kubeconfigPathCandidates(options: KubeconfigPathOptions) {
  return uniqueCandidates([
    ...(options.envVarNames ?? []).map((name) => process.env[name]),
    ...(options.fallbackPaths ?? []),
    clusterKubeconfigPath(options.clusterName),
  ]);
}

export function isReadableKubeconfigPath(kubeconfigPath: string) {
  try {
    fs.accessSync(kubeconfigPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveReadableKubeconfigPath(
  options: KubeconfigPathOptions,
) {
  return (
    kubeconfigPathCandidates(options).find((candidate) =>
      isReadableKubeconfigPath(candidate),
    ) ?? null
  );
}

export function resolveKubeconfigPath(options: KubeconfigPathOptions) {
  return (
    resolveReadableKubeconfigPath(options) ??
    clusterKubeconfigPath(options.clusterName)
  );
}

function hasInClusterEnvironment() {
  return Boolean(
    process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT,
  );
}

export function createKubeConfig(options: CreateKubeConfigOptions) {
  const kubeConfig = new KubeConfig();

  if (options.preferInCluster !== false && hasInClusterEnvironment()) {
    try {
      kubeConfig.loadFromCluster();
      return { kubeConfig, kubeconfigPath: null };
    } catch (error) {
      console.warn(
        `${options.warnPrefix ?? "[kubernetes]"} failed to load in-cluster kubeconfig, falling back to file`,
        error,
      );
    }
  }

  const kubeconfigPath = resolveKubeconfigPath(options);
  fs.accessSync(kubeconfigPath, fs.constants.R_OK);
  kubeConfig.loadFromFile(kubeconfigPath);

  return { kubeConfig, kubeconfigPath };
}
