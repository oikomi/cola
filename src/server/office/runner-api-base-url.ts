import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const K8S_INFRA_DIR = path.join(process.cwd(), "infra", "k8s");
const CLUSTER_CONFIG_PATH = path.join(K8S_INFRA_DIR, "cluster", "config.json");
const CLUSTER_NODES_PATH = path.join(K8S_INFRA_DIR, "cluster", "nodes.json");

type ClusterConfig = {
  controllerIp?: string;
};

type ClusterNode = {
  ip?: string;
};

function readClusterConfig() {
  if (!existsSync(CLUSTER_CONFIG_PATH)) return null;

  return JSON.parse(readFileSync(CLUSTER_CONFIG_PATH, "utf8")) as ClusterConfig;
}

function readClusterNodes() {
  if (!existsSync(CLUSTER_NODES_PATH)) return [];

  return JSON.parse(readFileSync(CLUSTER_NODES_PATH, "utf8")) as ClusterNode[];
}

function uniqueValues(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function clusterControllerIp() {
  const controllerIp = readClusterConfig()?.controllerIp?.trim();
  return controllerIp && controllerIp.length > 0 ? controllerIp : null;
}

function clusterNodeIps() {
  return uniqueValues([
    clusterControllerIp(),
    ...readClusterNodes().map((node) => node.ip?.trim()),
  ]);
}

function isIpLiteral(host: string) {
  return /^[0-9.]+$/.test(host.trim()) || host.includes(":");
}

function stripTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

function useClusterControllerForStaleIpBaseUrl(baseUrl: string) {
  const clusterHost = clusterControllerIp();
  if (!clusterHost) return stripTrailingSlashes(baseUrl.trim());

  try {
    const url = new URL(baseUrl);

    if (isIpLiteral(url.hostname) && !clusterNodeIps().includes(url.hostname)) {
      url.hostname = clusterHost;
      return stripTrailingSlashes(url.toString());
    }
  } catch {
    return stripTrailingSlashes(baseUrl.trim());
  }

  return stripTrailingSlashes(baseUrl.trim());
}

export function resolveRunnerApiBaseUrl() {
  const configured =
    process.env.COLA_K8S_API_BASE_URL ?? process.env.COLA_API_BASE_URL;

  if (configured?.trim()) {
    return useClusterControllerForStaleIpBaseUrl(configured);
  }

  if (existsSync(CLUSTER_CONFIG_PATH)) {
    const controllerIp = clusterControllerIp();

    if (controllerIp) {
      return `http://${controllerIp}:${process.env.PORT ?? "50038"}`;
    }
  }

  throw new Error(
    "Kubernetes runner 需要可被 pod 访问的 Cola API 地址。请设置 COLA_K8S_API_BASE_URL / COLA_API_BASE_URL，或补齐 infra/k8s/cluster/config.json 中的 controllerIp。",
  );
}
