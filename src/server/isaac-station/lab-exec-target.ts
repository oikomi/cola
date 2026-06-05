import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";

import {
  CoreV1Api,
  Exec,
  type V1Pod,
  type V1Status,
} from "@kubernetes/client-node";

import {
  createKubeConfig as createSharedKubeConfig,
  resolveKubeconfigPath as resolveSharedKubeconfigPath,
} from "@/server/kubernetes/kubeconfig";

const K8S_INFRA_DIR = path.join(process.cwd(), "infra", "k8s");
const CLUSTER_CONFIG_PATH = path.join(K8S_INFRA_DIR, "cluster", "config.json");

export const DEFAULT_TERMINAL_COLS = 120;
export const DEFAULT_TERMINAL_ROWS = 32;
export const LAB_CONTAINER_NAME = "isaac-lab";
export const ISAAC_LAB_LOGIN_COMMAND =
  'cd "${ISAAC_LAB_WORKDIR:-$PWD}" 2>/dev/null || true; exec /bin/bash -l';

const ISAAC_LAB_KUBECONFIG_ENV_NAMES = [
  "COLA_ISAAC_LAB_KUBECONFIG_PATH",
  "REMOTE_WORK_KUBECONFIG_PATH",
  "WORKSPACE_KUBECONFIG",
];

type IsaacLabExecClusterConfig = {
  clusterName: string;
  workspaceNamespace?: string;
};

export type TerminalSocket = {
  close: () => void;
  once: (
    eventName: "close" | "error",
    listener: (error?: unknown) => void,
  ) => void;
};

export type IsaacLabExecTarget = {
  namespace: string;
  jobName: string;
  podName: string;
  containerName: string;
  nodeName: string | null;
  exec: Exec;
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readIsaacLabExecClusterConfig() {
  return readJsonFile<IsaacLabExecClusterConfig>(CLUSTER_CONFIG_PATH);
}

function resolveIsaacLabExecNamespace(config: IsaacLabExecClusterConfig) {
  return (
    process.env.COLA_ISAAC_LAB_K8S_NAMESPACE?.trim() ??
    config.workspaceNamespace ??
    "remote-work"
  );
}

export function resolveIsaacLabKubeconfigPath(clusterName: string) {
  return resolveSharedKubeconfigPath({
    clusterName,
    envVarNames: ISAAC_LAB_KUBECONFIG_ENV_NAMES,
  });
}

function createIsaacLabKubeConfig(clusterName: string) {
  return createSharedKubeConfig({
    clusterName,
    envVarNames: ISAAC_LAB_KUBECONFIG_ENV_NAMES,
    warnPrefix: "[isaac-lab]",
  });
}

function jobName(name: string) {
  return `isaac-lab-${name}`;
}

export function validateIsaacLabJobName(name: string) {
  if (name.length > 42) {
    throw new Error("Isaac Lab Job 名称最多 42 个字符。");
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error("Isaac Lab Job 名称必须符合 DNS-1123 简单命名规则。");
  }
}

function podBelongsToJob(pod: V1Pod, name: string) {
  return (
    pod.metadata?.labels?.["cola.isaac/lab-job-name"] === name ||
    pod.metadata?.labels?.["batch.kubernetes.io/job-name"] === jobName(name) ||
    pod.metadata?.labels?.["job-name"] === jobName(name)
  );
}

function isPodReady(pod: V1Pod) {
  return (
    pod.status?.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    ) ?? false
  );
}

function selectLabPod(pods: V1Pod[], name: string) {
  const matches = pods.filter((pod) => podBelongsToJob(pod, name));
  return (
    matches.find((pod) => pod.status?.phase === "Running" && isPodReady(pod)) ??
    matches.find((pod) => pod.status?.phase === "Running") ??
    null
  );
}

export function statusExitCode(status: V1Status) {
  const raw = status.details?.causes?.find(
    (cause) => cause.reason === "ExitCode",
  )?.message;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

export function isTerminalSocket(value: unknown): value is TerminalSocket {
  return (
    typeof value === "object" &&
    value !== null &&
    "close" in value &&
    typeof value.close === "function" &&
    "once" in value &&
    typeof value.once === "function"
  );
}

export class ResizableTerminalOutput extends Writable {
  columns = DEFAULT_TERMINAL_COLS;
  rows = DEFAULT_TERMINAL_ROWS;

  constructor(private readonly onData: (data: string) => void) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.onData(chunk.toString());
    callback();
  }

  resize(cols: number, rows: number) {
    this.columns = cols;
    this.rows = rows;
    this.emit("resize");
  }
}

export async function resolveIsaacLabExecTarget(
  nameInput: string,
): Promise<IsaacLabExecTarget> {
  const name = nameInput.trim().toLowerCase();
  validateIsaacLabJobName(name);

  const config = readIsaacLabExecClusterConfig();
  resolveIsaacLabKubeconfigPath(config.clusterName);
  const { kubeConfig } = createIsaacLabKubeConfig(config.clusterName);
  const coreApi = kubeConfig.makeApiClient(CoreV1Api);
  const namespace = resolveIsaacLabExecNamespace(config);
  const pods = await coreApi.listNamespacedPod({ namespace });
  const pod = selectLabPod(pods.items ?? [], name);

  if (!pod?.metadata?.name) {
    throw new Error("没有找到正在运行的 Isaac Lab Pod。请先启动 Job。");
  }

  const container =
    pod.spec?.containers?.find((item) => item.name === LAB_CONTAINER_NAME)
      ?.name ?? pod.spec?.containers?.[0]?.name;

  if (!container) {
    throw new Error("Isaac Lab Pod 没有可进入的容器。");
  }

  return {
    namespace,
    jobName: name,
    podName: pod.metadata.name,
    containerName: container,
    nodeName: pod.spec?.nodeName ?? null,
    exec: new Exec(kubeConfig),
  };
}
