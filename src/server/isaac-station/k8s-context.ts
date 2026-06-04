import "server-only";

import fs from "node:fs";
import path from "node:path";

const K8S_INFRA_DIR = path.join(process.cwd(), "infra", "k8s");
const CLUSTER_CONFIG_PATH = path.join(K8S_INFRA_DIR, "cluster", "config.json");
const CLUSTER_NODES_PATH = path.join(K8S_INFRA_DIR, "cluster", "nodes.json");

export type IsaacClusterConfig = {
  clusterName: string;
  workspaceNamespace?: string;
  workspaceLabelKey?: string;
  gpuLabelKey?: string;
  controllerIp?: string;
};

export type IsaacClusterNode = {
  name: string;
  ip: string;
  roles: string[];
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function readIsaacClusterConfig() {
  return {
    config: readJsonFile<IsaacClusterConfig>(CLUSTER_CONFIG_PATH),
    nodes: readJsonFile<IsaacClusterNode[]>(CLUSTER_NODES_PATH),
  };
}

export function resolveIsaacNamespace(
  config: IsaacClusterConfig,
  area: "station" | "lab",
) {
  const envName =
    area === "station"
      ? "COLA_ISAAC_STATION_K8S_NAMESPACE"
      : "COLA_ISAAC_LAB_K8S_NAMESPACE";

  return (
    process.env[envName]?.trim() ?? config.workspaceNamespace ?? "remote-work"
  );
}
