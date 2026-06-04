import "server-only";

import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  BatchV1Api,
  CoreV1Api,
  type V1Job,
  type V1Node,
  type V1Pod,
} from "@kubernetes/client-node";

import {
  type GpuAllocationSpec,
  usesGpuAcceleration,
} from "@/lib/gpu-allocation";
import { db } from "@/server/db";
import {
  buildHamiGpuResources,
  buildHamiSchedulerSpec,
  buildNvidiaDesktopRuntimeEnv,
  normalizeGpuAllocation,
  parseGpuAllocationFromResources,
} from "@/server/gpu/hami";
import {
  createKubeConfig as createSharedKubeConfig,
  resolveKubeconfigPath as resolveSharedKubeconfigPath,
} from "@/server/kubernetes/kubeconfig";
import {
  loadResourceOwnerMap,
  ownerForUserId,
  type ResourceOwner,
} from "@/server/resource-owners";
import {
  buildWorkVolumeEnv,
  buildWorkVolumeInitContainers,
  buildWorkVolumeMounts,
  buildWorkVolumeSecurityContext,
  buildWorkVolumeShellCommand,
  buildWorkVolumes,
  resolveKubernetesWorkVolume,
  SHARED_STORAGE_MOUNT_PATH,
} from "@/server/training/work-volume";
import {
  buildContainerImageOptions,
  type ContainerImageOption,
} from "./image-options";
import { buildIsaacLabGitLabTokenEnv as buildGitLabTokenEnv } from "./gitlab-token-env.js";
import { ISAAC_STATION_WEBRTC_PORT } from "./streaming-url";

const K8S_INFRA_DIR = path.join(process.cwd(), "infra", "k8s");
const CLUSTER_CONFIG_PATH = path.join(K8S_INFRA_DIR, "cluster", "config.json");
const CLUSTER_NODES_PATH = path.join(K8S_INFRA_DIR, "cluster", "nodes.json");
const ISAAC_LAB_WORKDIR =
  process.env.COLA_ISAAC_LAB_WORKDIR ?? SHARED_STORAGE_MOUNT_PATH;
const K8S_API_CONNECT_TIMEOUT_MS = Number(
  process.env.COLA_ISAAC_LAB_K8S_API_CONNECT_TIMEOUT_MS ?? "2500",
);
const ISAAC_LAB_GITLAB_TOKEN_SECRET_NAME =
  process.env.COLA_ISAAC_LAB_GITLAB_TOKEN_SECRET_NAME?.trim() ??
  "isaac-gitlab-token";
const ISAAC_LAB_GITLAB_TOKEN_SECRET_KEY =
  process.env.COLA_ISAAC_LAB_GITLAB_TOKEN_SECRET_KEY?.trim() ?? "GITLAB_TOKEN";
const ISAAC_LAB_GITLAB_TOKEN_ENV_NAME =
  process.env.COLA_ISAAC_LAB_GITLAB_TOKEN_ENV_NAME?.trim() ?? "GITLAB_TOKEN";
const DEFAULT_ISAAC_LAB_ROOT_SHELL = "${ISAACLAB_PATH:-/workspace/isaaclab}";
const OWNER_USER_ID_METADATA_KEY = "cola.dev/owner-user-id";

function ownerMetadata(ownerUserId?: string | null): Record<string, string> {
  return ownerUserId ? { [OWNER_USER_ID_METADATA_KEY]: ownerUserId } : {};
}

type ClusterConfig = {
  clusterName: string;
  workspaceNamespace?: string;
  workspaceLabelKey?: string;
  gpuLabelKey?: string;
};

type ClusterNode = {
  name: string;
  ip: string;
  roles: string[];
};

type IsaacLabKubeContext = {
  config: ClusterConfig;
  nodes: ClusterNode[];
  namespace: string;
  workspaceLabelKey: string;
  gpuLabelKey: string;
  kubeconfigPath: string | null;
  apiServer: string | null;
  batchApi: BatchV1Api;
  coreApi: CoreV1Api;
};

type IsaacLabResources = {
  jobs: V1Job[];
  pods: V1Pod[];
  liveNodes: V1Node[];
};

export type IsaacLabRunner = "direct" | "rsl-rl" | "skrl" | "custom";
export type IsaacLabDisplayMode = "headless" | "webrtc";

export type IsaacLabJobItem = {
  id: string;
  name: string;
  status: "running" | "pending" | "completed" | "failed";
  runner: IsaacLabRunner;
  displayMode: IsaacLabDisplayMode;
  task: string;
  image: string;
  cpu: string;
  memory: string;
  gpuAllocationMode: GpuAllocationSpec["gpuAllocationMode"];
  gpuCount: number;
  gpuMemoryGi: number | null;
  nodeName: string | null;
  nodeIp: string | null;
  webrtcPort: number;
  endpoint: string | null;
  podName: string | null;
  podPhase: string | null;
  restarts: number;
  summary: string;
  ownerUserId: string | null;
  ownerUser: ResourceOwner | null;
  createdAt: string | null;
};

export type IsaacLabListResult = {
  available: boolean;
  reason: string | null;
  imageOptions: IsaacLabImageOption[];
  items: IsaacLabJobItem[];
};

export type IsaacLabImageOption = ContainerImageOption;

export type CreateIsaacLabJobInput = {
  name: string;
  image: string;
  runner: IsaacLabRunner;
  displayMode: IsaacLabDisplayMode;
  task: string;
  command: string | null;
  maxIterations: number;
  cpu: string;
  memoryGi: number;
  gpuAllocationMode: GpuAllocationSpec["gpuAllocationMode"];
  gpuCount: number;
  gpuMemoryGi: number | null;
  ownerUserId?: string;
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readClusterConfig() {
  return {
    config: readJsonFile<ClusterConfig>(CLUSTER_CONFIG_PATH),
    nodes: readJsonFile<ClusterNode[]>(CLUSTER_NODES_PATH),
  };
}

function resolveNamespace(config: ClusterConfig) {
  return (
    process.env.COLA_ISAAC_LAB_K8S_NAMESPACE?.trim() ??
    config.workspaceNamespace ??
    "remote-work"
  );
}

function resolveKubeconfigPath(clusterName: string) {
  return resolveSharedKubeconfigPath({
    clusterName,
    envVarNames: [
      "COLA_ISAAC_LAB_KUBECONFIG_PATH",
      "REMOTE_WORK_KUBECONFIG_PATH",
      "WORKSPACE_KUBECONFIG",
    ],
  });
}

function createKubeConfig(clusterName: string) {
  return createSharedKubeConfig({
    clusterName,
    envVarNames: [
      "COLA_ISAAC_LAB_KUBECONFIG_PATH",
      "REMOTE_WORK_KUBECONFIG_PATH",
      "WORKSPACE_KUBECONFIG",
    ],
    warnPrefix: "[isaac-lab]",
  });
}

async function createKubeContext(): Promise<IsaacLabKubeContext> {
  const { config, nodes } = readClusterConfig();
  const { kubeConfig, kubeconfigPath } = createKubeConfig(config.clusterName);

  return {
    config,
    nodes,
    kubeconfigPath,
    namespace: resolveNamespace(config),
    workspaceLabelKey: config.workspaceLabelKey ?? "remote-work/workspace",
    gpuLabelKey: config.gpuLabelKey ?? "remote-work/gpu",
    apiServer: kubeConfig.getCurrentCluster()?.server ?? null,
    batchApi: kubeConfig.makeApiClient(BatchV1Api),
    coreApi: kubeConfig.makeApiClient(CoreV1Api),
  };
}

function buildCapabilityError(kubeconfigPath: string | null) {
  if (kubeconfigPath) {
    return `无法访问 Kubernetes 集群。请确认 kubeconfig 可读：${kubeconfigPath}`;
  }

  return "无法访问 Kubernetes 集群。请确认集群内 ServiceAccount 权限可用。";
}

function safeResolveKubeconfigPath(clusterName: string) {
  try {
    return resolveKubeconfigPath(clusterName);
  } catch {
    return null;
  }
}

function buildAccessError(ctx: IsaacLabKubeContext, error: unknown) {
  const target = ctx.apiServer
    ? `Kubernetes API ${ctx.apiServer}`
    : "Kubernetes API";

  return error instanceof Error
    ? `无法访问 ${target}。${error.message}`
    : `无法访问 ${target}。`;
}

function probeKubeApiServer(apiServer: string | null) {
  if (!apiServer) return Promise.resolve<string | null>(null);

  let endpoint: URL;
  try {
    endpoint = new URL(apiServer);
  } catch {
    return Promise.resolve<string | null>(null);
  }

  const port = Number(
    endpoint.port || (endpoint.protocol === "https:" ? 443 : 80),
  );
  const host = endpoint.hostname;
  if (!host || !Number.isInteger(port) || port <= 0) {
    return Promise.resolve<string | null>(null);
  }

  return new Promise<string | null>((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (reason: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reason);
    };

    socket.setTimeout(K8S_API_CONNECT_TIMEOUT_MS);
    socket.once("connect", () => finish(null));
    socket.once("timeout", () =>
      finish(`Kubernetes API 连接超时：${host}:${port}`),
    );
    socket.once("error", (error) =>
      finish(`Kubernetes API 无法连接：${host}:${port}。${error.message}`),
    );
  });
}

function getErrorStatus(error: unknown) {
  const candidate = error as {
    statusCode?: number;
    code?: number;
    body?: { code?: number };
    response?: { statusCode?: number };
  };

  return (
    candidate.statusCode ??
    candidate.code ??
    candidate.body?.code ??
    candidate.response?.statusCode ??
    null
  );
}

function isNotFoundError(error: unknown) {
  return getErrorStatus(error) === 404;
}

function formatTimestamp(input?: string | Date | null) {
  if (!input) return null;

  const date = new Date(input);
  if (Number.isNaN(date.valueOf())) return String(input);

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function jobName(name: string) {
  return `isaac-lab-${name}`;
}

function labNameFromJob(name?: string | null) {
  if (!name?.startsWith("isaac-lab-")) return null;
  return name.slice("isaac-lab-".length);
}

function labSelector(name: string) {
  return {
    "app.kubernetes.io/name": "cola-isaac-lab",
    "app.kubernetes.io/component": "lab-job",
    "app.kubernetes.io/managed-by": "cola",
    "cola.isaac/lab-job-name": name,
  };
}

function labLabel(metadata?: {
  labels?: Record<string, string> | null;
  name?: string | null;
}) {
  return (
    metadata?.labels?.["cola.isaac/lab-job-name"] ??
    labNameFromJob(metadata?.name)
  );
}

function validateLabName(name: string) {
  if (name.length > 42) {
    throw new Error("Isaac Lab Job 名称最多 42 个字符。");
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error("Isaac Lab Job 名称必须符合 DNS-1123 简单命名规则。");
  }
}

function normalizeCpu(input: string) {
  const value = input.trim();
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error("CPU 必须是大于 0 的数字。");
  }

  if (Number(value) <= 0) {
    throw new Error("CPU 必须大于 0。");
  }

  return value;
}

function normalizeMemoryGi(input: number) {
  if (!Number.isInteger(input) || input <= 0) {
    throw new Error("内存必须是大于 0 的整数 Gi。");
  }

  return `${input}Gi`;
}

function normalizeLabGpuAllocation(spec: GpuAllocationSpec) {
  return normalizeGpuAllocation(spec, {
    minGpuCount: 1,
  });
}

function normalizeTask(input: string) {
  const value = input.trim();
  if (value.length < 3 || value.length > 120) {
    throw new Error("Isaac Lab task 名称长度必须是 3 到 120 个字符。");
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw new Error(
      "Isaac Lab task 只能包含字母、数字、下划线、点、冒号和短横线。",
    );
  }
  return value;
}

function normalizeMaxIterations(input: number) {
  if (!Number.isInteger(input) || input < 1 || input > 100_000_000) {
    throw new Error("最大迭代数必须是 1 到 100000000 之间的整数。");
  }
  return input;
}

function normalizeRunner(input: IsaacLabRunner) {
  return input;
}

function normalizeDisplayMode(input: IsaacLabDisplayMode | null | undefined) {
  return input === "webrtc" ? "webrtc" : "headless";
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function isReady(node: V1Node) {
  return (
    node.status?.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    ) ?? false
  );
}

function allocatableGpuCount(node: V1Node) {
  const raw = node.status?.allocatable?.["nvidia.com/gpu"];
  const value = Number(raw ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function isGpuCapable(
  configNode: ClusterNode,
  liveNode: V1Node,
  gpuLabelKey: string,
) {
  if (configNode.roles.includes("gpu")) return true;

  return (
    liveNode.metadata?.labels?.[gpuLabelKey] === "true" ||
    allocatableGpuCount(liveNode) > 0
  );
}

function assertLabSchedulable(params: {
  configNodes: ClusterNode[];
  liveNodes: V1Node[];
  requestedGpuSpec: GpuAllocationSpec;
  workspaceLabelKey: string;
  gpuLabelKey: string;
}) {
  const liveNodeMap = new Map(
    params.liveNodes
      .map((node) => [node.metadata?.name, node] as const)
      .filter((entry): entry is readonly [string, V1Node] => Boolean(entry[0])),
  );

  const candidates = params.configNodes
    .filter((node) => node.roles.includes("worker"))
    .map((node) => {
      const live = liveNodeMap.get(node.name);
      return {
        node,
        live,
        ready: live ? isReady(live) : false,
        isMaster: node.roles.includes("master"),
        workspaceLabeled:
          live?.metadata?.labels?.[params.workspaceLabelKey] === "true",
        allocatableGpu: live ? allocatableGpuCount(live) : 0,
        gpuCapable: live ? isGpuCapable(node, live, params.gpuLabelKey) : false,
      };
    })
    .filter((entry) => entry.live && entry.ready)
    .filter(
      (entry) =>
        entry.gpuCapable &&
        (params.requestedGpuSpec.gpuAllocationMode === "memory"
          ? entry.allocatableGpu >= 1
          : entry.allocatableGpu >= params.requestedGpuSpec.gpuCount),
    );

  const workspaceCandidates = candidates.some((entry) => entry.workspaceLabeled)
    ? candidates.filter((entry) => entry.workspaceLabeled)
    : candidates;
  const nonMaster = workspaceCandidates.filter((entry) => !entry.isMaster);
  const preferred = nonMaster.length > 0 ? nonMaster : workspaceCandidates;

  if (preferred.length === 0) {
    throw new Error("没有找到满足 Isaac Lab GPU 需求的 Ready worker 节点。");
  }
}

function resolveNodeIp(configNodes: ClusterNode[], liveNode?: V1Node | null) {
  const nodeName = liveNode?.metadata?.name;
  const configNode = nodeName
    ? configNodes.find((node) => node.name === nodeName)
    : null;

  if (configNode?.ip) return configNode.ip;

  const external =
    liveNode?.status?.addresses?.find((entry) => entry.type === "ExternalIP")
      ?.address ??
    liveNode?.status?.addresses?.find((entry) => entry.type === "InternalIP")
      ?.address;

  return external ?? null;
}

function buildEndpoint(params: { nodeIp?: string | null; port: number }) {
  if (!params.nodeIp) return null;
  return `${params.nodeIp}:${params.port}`;
}

async function namespaceExists(coreApi: CoreV1Api, namespace: string) {
  try {
    await coreApi.readNamespace({ name: namespace });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function ensureNamespace(coreApi: CoreV1Api, namespace: string) {
  if (await namespaceExists(coreApi, namespace)) return;

  await coreApi.createNamespace({
    body: {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: namespace },
    },
  });
}

async function listLabResources(
  ctx: IsaacLabKubeContext,
): Promise<IsaacLabResources> {
  if (!(await namespaceExists(ctx.coreApi, ctx.namespace))) {
    return {
      jobs: [],
      pods: [],
      liveNodes: [],
    };
  }

  const [jobs, pods, liveNodes] = await Promise.all([
    ctx.batchApi.listNamespacedJob({ namespace: ctx.namespace }),
    ctx.coreApi.listNamespacedPod({ namespace: ctx.namespace }),
    ctx.coreApi.listNode(),
  ]);

  return {
    jobs: (jobs.items ?? []).filter(
      (job) =>
        job.metadata?.labels?.["app.kubernetes.io/name"] === "cola-isaac-lab" ||
        job.metadata?.name?.startsWith("isaac-lab-") === true,
    ),
    pods: (pods.items ?? []).filter(
      (pod) =>
        pod.metadata?.labels?.["app.kubernetes.io/name"] === "cola-isaac-lab" ||
        pod.metadata?.labels?.["cola.isaac/lab-job-name"] !== undefined ||
        pod.metadata?.labels?.["batch.kubernetes.io/job-name"]?.startsWith(
          "isaac-lab-",
        ) === true ||
        pod.metadata?.labels?.["job-name"]?.startsWith("isaac-lab-") === true,
    ),
    liveNodes: liveNodes.items ?? [],
  };
}

function resolveWorkVolume() {
  return resolveKubernetesWorkVolume({
    env: process.env,
    volumeName: "isaac-lab-workspace",
    defaultMountPath: ISAAC_LAB_WORKDIR,
    seaweedfsEnabledEnvNames: ["COLA_ISAAC_LAB_SEAWEEDFS_MOUNT_ENABLED"],
    mountPathEnvNames: [
      "COLA_ISAAC_LAB_WORKDIR_MOUNT_PATH",
      "COLA_TRAINING_WORKDIR_MOUNT_PATH",
    ],
    hostPathEnvNames: [
      "COLA_ISAAC_LAB_WORKDIR_HOST_PATH",
      "COLA_TRAINING_WORKDIR_HOST_PATH",
    ],
    hostPathType: "DirectoryOrCreate",
    hostPathMountPathEnvNames: [
      "COLA_ISAAC_LAB_WORKDIR_MOUNT_PATH",
      "COLA_TRAINING_WORKDIR_MOUNT_PATH",
    ],
    pvcNameEnvNames: ["COLA_ISAAC_LAB_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_ISAAC_LAB_PVC_MOUNT_PATH"],
    fallbackHostPath: {
      path: "/var/lib/remote-work/isaac-lab",
      type: "DirectoryOrCreate",
    },
  });
}

function resolveRuntimeClassName() {
  const configured =
    process.env.COLA_ISAAC_LAB_RUNTIME_CLASS_NAME?.trim() ??
    process.env.COLA_TRAINING_RUNTIME_CLASS_NAME?.trim();
  return configured && configured.length > 0 ? configured : "nvidia";
}

function buildLabCommand(input: {
  runner: IsaacLabRunner;
  displayMode: IsaacLabDisplayMode;
  task: string;
  maxIterations: number;
  command: string | null;
  workdir: string;
}) {
  if (input.runner === "custom") {
    const command = input.command?.trim();
    if (!command) {
      throw new Error("Custom runner 必须填写启动命令。");
    }
    return command;
  }

  const executable =
    process.env.COLA_ISAAC_LAB_EXECUTABLE?.trim() ??
    `${DEFAULT_ISAAC_LAB_ROOT_SHELL}/isaaclab.sh`;
  const configuredLabRoot = process.env.COLA_ISAAC_LAB_ROOT?.trim();
  const labRoot = configuredLabRoot
    ? shellQuote(configuredLabRoot)
    : `"${DEFAULT_ISAAC_LAB_ROOT_SHELL}"`;
  const runnerScript = {
    direct: "scripts/reinforcement_learning/direct/train.py",
    "rsl-rl": "scripts/reinforcement_learning/rsl_rl/train.py",
    skrl: "scripts/reinforcement_learning/skrl/train.py",
    custom: "",
  } satisfies Record<IsaacLabRunner, string>;
  const extraArgs = process.env.COLA_ISAAC_LAB_EXTRA_ARGS?.trim() ?? "";
  const displayArgs =
    input.displayMode === "webrtc" ? "--livestream 2" : "--headless";

  return [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(input.workdir)}/isaac-lab/runs ${shellQuote(input.workdir)}/isaac-lab/logs`,
    "export ACCEPT_EULA=${ACCEPT_EULA:-Y}",
    "export PRIVACY_CONSENT=${PRIVACY_CONSENT:-Y}",
    `export ISAAC_LAB_WORKDIR=${shellQuote(input.workdir)}`,
    `cd ${labRoot}`,
    [
      "exec",
      executable,
      "-p",
      runnerScript[input.runner],
      "--task",
      shellQuote(input.task),
      displayArgs,
      "--max_iterations",
      String(input.maxIterations),
      extraArgs,
    ]
      .filter(Boolean)
      .join(" "),
  ].join("\n");
}

function buildLabJob(input: {
  name: string;
  image: string;
  runner: IsaacLabRunner;
  displayMode: IsaacLabDisplayMode;
  task: string;
  command: string | null;
  maxIterations: number;
  cpu: string;
  memory: string;
  gpuAllocationMode: GpuAllocationSpec["gpuAllocationMode"];
  gpuCount: number;
  gpuMemoryGi: number | null;
  ownerUserId?: string;
}) {
  const labels = labSelector(input.name);
  const ownerLabels = ownerMetadata(input.ownerUserId);
  const gpuSpec = {
    gpuAllocationMode: input.gpuAllocationMode,
    gpuCount: input.gpuCount,
    gpuMemoryGi: input.gpuMemoryGi,
  } satisfies GpuAllocationSpec;
  const gpuResources = buildHamiGpuResources(gpuSpec);
  const workVolume = resolveWorkVolume();
  const { mountPath } = workVolume;
  const runtimeClassName = resolveRuntimeClassName();
  const configuredWorkingDir =
    process.env.COLA_ISAAC_LAB_CONTAINER_WORKDIR?.trim();

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: jobName(input.name),
      labels: { ...labels, ...ownerLabels },
      annotations: {
        ...ownerLabels,
        "cola.isaac/title": input.name,
        "cola.isaac/runner": input.runner,
        "cola.isaac/display-mode": input.displayMode,
        "cola.isaac/task": input.task,
      },
    },
    spec: {
      backoffLimit: 0,
      template: {
        metadata: {
          labels: { ...labels, ...ownerLabels },
          annotations: {
            ...ownerLabels,
            "cola.isaac/runner": input.runner,
            "cola.isaac/display-mode": input.displayMode,
            "cola.isaac/task": input.task,
          },
        },
        spec: {
          restartPolicy: "Never",
          hostNetwork: input.displayMode === "webrtc",
          dnsPolicy:
            input.displayMode === "webrtc"
              ? "ClusterFirstWithHostNet"
              : "ClusterFirst",
          ...(runtimeClassName ? { runtimeClassName } : {}),
          ...buildHamiSchedulerSpec(gpuSpec),
          initContainers: buildWorkVolumeInitContainers(workVolume),
          containers: [
            {
              name: "isaac-lab",
              image: input.image,
              imagePullPolicy:
                process.env.COLA_ISAAC_LAB_IMAGE_PULL_POLICY ?? "IfNotPresent",
              ...(configuredWorkingDir
                ? { workingDir: configuredWorkingDir }
                : {}),
              command: ["bash", "-lc"],
              args: [
                buildWorkVolumeShellCommand(
                  workVolume,
                  buildLabCommand({
                    runner: input.runner,
                    displayMode: input.displayMode,
                    task: input.task,
                    maxIterations: input.maxIterations,
                    command: input.command,
                    workdir: mountPath,
                  }),
                ),
              ],
              env: [
                {
                  name: "TZ",
                  value: process.env.COLA_ISAAC_LAB_TZ ?? "Asia/Shanghai",
                },
                { name: "ACCEPT_EULA", value: "Y" },
                { name: "PRIVACY_CONSENT", value: "Y" },
                { name: "COLA_ISAAC_LAB_JOB_NAME", value: input.name },
                { name: "COLA_ISAAC_LAB_RUNNER", value: input.runner },
                {
                  name: "COLA_ISAAC_LAB_DISPLAY_MODE",
                  value: input.displayMode,
                },
                { name: "COLA_ISAAC_LAB_TASK", value: input.task },
                { name: "COLA_ISAAC_LAB_WORKDIR", value: mountPath },
                ...buildGitLabTokenEnv({
                  secretName: ISAAC_LAB_GITLAB_TOKEN_SECRET_NAME,
                  secretKey: ISAAC_LAB_GITLAB_TOKEN_SECRET_KEY,
                  envName: ISAAC_LAB_GITLAB_TOKEN_ENV_NAME,
                }),
                ...buildNvidiaDesktopRuntimeEnv(gpuSpec),
                ...buildWorkVolumeEnv(workVolume),
              ],
              resources: {
                requests: {
                  cpu: input.cpu,
                  memory: input.memory,
                },
                limits: {
                  cpu: input.cpu,
                  memory: input.memory,
                  ...gpuResources,
                },
              },
              ports:
                input.displayMode === "webrtc"
                  ? [
                      {
                        containerPort: ISAAC_STATION_WEBRTC_PORT,
                        name: "webrtc",
                        protocol: "TCP",
                      },
                    ]
                  : [],
              volumeMounts: buildWorkVolumeMounts(workVolume),
              securityContext: buildWorkVolumeSecurityContext(workVolume),
            },
          ],
          volumes: buildWorkVolumes(workVolume),
        },
      },
    },
  } satisfies V1Job;
}

function imageOptions(): IsaacLabImageOption[] {
  return buildContainerImageOptions({
    productName: "Isaac Lab",
    configuredImage: process.env.COLA_ISAAC_LAB_IMAGE,
    configuredImages: process.env.COLA_ISAAC_LAB_IMAGES,
    defaultOptions: [
      {
        value: "nvcr.io/nvidia/isaac-lab:2.2.0",
        label: "Isaac Lab 2.2.0",
        description: "nvcr.io/nvidia/isaac-lab:2.2.0",
      },
      {
        value: "nvcr.io/nvidia/isaac-lab:2.3.2",
        label: "Isaac Lab 2.3.2",
        description: "nvcr.io/nvidia/isaac-lab:2.3.2",
      },
      {
        value: "nvcr.io/nvidia/isaac-lab:2.3.1",
        label: "Isaac Lab 2.3.1",
        description: "nvcr.io/nvidia/isaac-lab:2.3.1",
      },
      {
        value: "nvcr.io/nvidia/isaac-lab:2.3.0",
        label: "Isaac Lab 2.3.0",
        description: "nvcr.io/nvidia/isaac-lab:2.3.0",
      },
      {
        value: "nvcr.io/nvidia/isaac-lab:2.2.1",
        label: "Isaac Lab 2.2.1",
        description: "nvcr.io/nvidia/isaac-lab:2.2.1",
      },
      {
        value: "nvcr.io/nvidia/isaac-lab:2.1.0",
        label: "Isaac Lab 2.1.0",
        description: "nvcr.io/nvidia/isaac-lab:2.1.0",
      },
      {
        value: "nvcr.io/nvidia/isaac-lab:2.1.1",
        label: "Isaac Lab 2.1.1",
        description: "nvcr.io/nvidia/isaac-lab:2.1.1",
      },
      {
        value: "nvcr.io/nvidia/isaac-lab:2.0.2",
        label: "Isaac Lab 2.0.2",
        description: "nvcr.io/nvidia/isaac-lab:2.0.2",
      },
      {
        value: "nvcr.io/nvidia/isaac-lab:2.0.1",
        label: "Isaac Lab 2.0.1",
        description: "nvcr.io/nvidia/isaac-lab:2.0.1",
      },
      {
        value: "nvcr.io/nvidia/isaac-lab:2.0.0",
        label: "Isaac Lab 2.0.0",
        description: "nvcr.io/nvidia/isaac-lab:2.0.0",
      },
    ],
  });
}

function podForJob(pods: V1Pod[], name: string) {
  return (
    pods.find(
      (pod) =>
        pod.metadata?.labels?.["cola.isaac/lab-job-name"] === name ||
        pod.metadata?.labels?.["batch.kubernetes.io/job-name"] ===
          jobName(name) ||
        pod.metadata?.labels?.["job-name"] === jobName(name),
    ) ?? null
  );
}

function restartsForPod(pod?: V1Pod | null) {
  return (pod?.status?.containerStatuses ?? []).reduce(
    (total, status) => total + (status.restartCount ?? 0),
    0,
  );
}

function labJobStatus(job: V1Job, pod?: V1Pod | null) {
  const conditions = job.status?.conditions ?? [];
  if (
    conditions.some(
      (condition) =>
        condition.type === "Complete" && condition.status === "True",
    )
  ) {
    return "completed" as const;
  }
  if (
    conditions.some(
      (condition) => condition.type === "Failed" && condition.status === "True",
    ) ||
    (job.status?.failed ?? 0) > 0
  ) {
    return "failed" as const;
  }
  if (pod?.status?.phase === "Running" || (job.status?.active ?? 0) > 0) {
    return "running" as const;
  }
  return "pending" as const;
}

function summaryForJob(job: V1Job, pod?: V1Pod | null) {
  const status = labJobStatus(job, pod);
  if (status === "completed") return "Job completed";
  if (status === "failed") {
    const failed = job.status?.conditions?.find(
      (condition) => condition.type === "Failed" && condition.status === "True",
    );
    return (
      [failed?.reason, failed?.message].filter(Boolean).join(": ") ||
      "Job failed"
    );
  }
  if (pod) {
    return `${pod.status?.phase ?? "Unknown"} on ${pod.spec?.nodeName ?? "pending node"}`;
  }
  return "Waiting for pod scheduling";
}

function labItemFromJob(input: {
  job: V1Job;
  pods: V1Pod[];
  liveNodes: V1Node[];
  configNodes: ClusterNode[];
  ownerMap: Map<string, ResourceOwner>;
}): IsaacLabJobItem | null {
  const name = labLabel(input.job.metadata);
  if (!name) return null;

  const pod = podForJob(input.pods, name);
  const container = input.job.spec?.template.spec?.containers?.[0];
  const resources =
    container?.resources?.limits ?? container?.resources?.requests;
  const gpu = parseGpuAllocationFromResources(resources);
  const ownerUserId =
    input.job.metadata?.annotations?.[OWNER_USER_ID_METADATA_KEY] ??
    input.job.metadata?.labels?.[OWNER_USER_ID_METADATA_KEY] ??
    null;
  const runner =
    (input.job.metadata?.annotations?.["cola.isaac/runner"] as
      | IsaacLabRunner
      | undefined) ?? "custom";
  const displayMode = normalizeDisplayMode(
    input.job.metadata?.annotations?.["cola.isaac/display-mode"] as
      | IsaacLabDisplayMode
      | undefined,
  );
  const task = input.job.metadata?.annotations?.["cola.isaac/task"] ?? "";
  const podNodeName = pod?.spec?.nodeName ?? null;
  const liveNode = podNodeName
    ? input.liveNodes.find((node) => node.metadata?.name === podNodeName)
    : undefined;
  const nodeIp = resolveNodeIp(input.configNodes, liveNode);

  return {
    id: name,
    name,
    status: labJobStatus(input.job, pod),
    runner,
    displayMode,
    task,
    image: container?.image ?? "",
    cpu: String(resources?.cpu ?? ""),
    memory: String(resources?.memory ?? ""),
    gpuAllocationMode: gpu.gpuAllocationMode,
    gpuCount: gpu.gpuCount,
    gpuMemoryGi: gpu.gpuMemoryGi,
    nodeName: podNodeName,
    nodeIp,
    webrtcPort: ISAAC_STATION_WEBRTC_PORT,
    endpoint:
      displayMode === "webrtc"
        ? buildEndpoint({
            nodeIp,
            port: ISAAC_STATION_WEBRTC_PORT,
          })
        : null,
    podName: pod?.metadata?.name ?? null,
    podPhase: pod?.status?.phase ?? null,
    restarts: restartsForPod(pod),
    summary: summaryForJob(input.job, pod),
    ownerUserId,
    ownerUser: ownerForUserId(input.ownerMap, ownerUserId),
    createdAt: formatTimestamp(input.job.metadata?.creationTimestamp),
  };
}

export async function listIsaacLabJobs(): Promise<IsaacLabListResult> {
  let kubeconfigPath: string | null = null;

  try {
    const { config } = readClusterConfig();
    kubeconfigPath = safeResolveKubeconfigPath(config.clusterName);
  } catch {
    return {
      available: false,
      reason: `无法读取 Kubernetes 集群配置：${CLUSTER_CONFIG_PATH}`,
      imageOptions: imageOptions(),
      items: [],
    };
  }

  let ctx: IsaacLabKubeContext;
  try {
    ctx = await createKubeContext();
  } catch {
    return {
      available: false,
      reason: buildCapabilityError(kubeconfigPath),
      imageOptions: imageOptions(),
      items: [],
    };
  }

  const probeReason = await probeKubeApiServer(ctx.apiServer);
  if (probeReason) {
    return {
      available: false,
      reason: probeReason,
      imageOptions: imageOptions(),
      items: [],
    };
  }

  try {
    const resources = await listLabResources(ctx);
    const ownerUserIds = resources.jobs.map(
      (job) =>
        job.metadata?.annotations?.[OWNER_USER_ID_METADATA_KEY] ??
        job.metadata?.labels?.[OWNER_USER_ID_METADATA_KEY],
    );
    const ownerMap = await loadResourceOwnerMap(db, ownerUserIds);
    const items = resources.jobs
      .map((job) =>
        labItemFromJob({
          job,
          pods: resources.pods,
          liveNodes: resources.liveNodes,
          configNodes: ctx.nodes,
          ownerMap,
        }),
      )
      .filter((item): item is IsaacLabJobItem => item !== null)
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      available: true,
      reason: null,
      imageOptions: imageOptions(),
      items,
    };
  } catch (error) {
    return {
      available: false,
      reason: buildAccessError(ctx, error),
      imageOptions: imageOptions(),
      items: [],
    };
  }
}

export async function createIsaacLabJob(input: CreateIsaacLabJobInput) {
  const name = input.name.trim().toLowerCase();
  validateLabName(name);

  const image = input.image.trim();
  if (!image) {
    throw new Error("Isaac Lab 镜像不能为空。");
  }

  const runner = normalizeRunner(input.runner);
  const displayMode = normalizeDisplayMode(input.displayMode);
  const task = normalizeTask(input.task);
  const maxIterations = normalizeMaxIterations(input.maxIterations);
  const cpu = normalizeCpu(input.cpu);
  const memory = normalizeMemoryGi(input.memoryGi);
  const gpu = normalizeLabGpuAllocation({
    gpuAllocationMode: input.gpuAllocationMode,
    gpuCount: input.gpuCount,
    gpuMemoryGi: input.gpuMemoryGi,
  });

  if (!usesGpuAcceleration(gpu)) {
    throw new Error("Isaac Lab Job 必须申请至少 1 个 GPU。");
  }

  const ctx = await createKubeContext();
  await ensureNamespace(ctx.coreApi, ctx.namespace);

  const resources = await listLabResources(ctx);
  if (resources.jobs.some((job) => labLabel(job.metadata) === name)) {
    throw new Error(`Isaac Lab Job ${name} 已存在。`);
  }

  assertLabSchedulable({
    configNodes: ctx.nodes,
    liveNodes: resources.liveNodes,
    requestedGpuSpec: gpu,
    workspaceLabelKey: ctx.workspaceLabelKey,
    gpuLabelKey: ctx.gpuLabelKey,
  });

  const job = buildLabJob({
    name,
    image,
    runner,
    displayMode,
    task,
    command: input.command,
    maxIterations,
    cpu,
    memory,
    gpuAllocationMode: gpu.gpuAllocationMode,
    gpuCount: gpu.gpuCount,
    gpuMemoryGi: gpu.gpuMemoryGi,
    ownerUserId: input.ownerUserId,
  });

  await ctx.batchApi.createNamespacedJob({
    namespace: ctx.namespace,
    body: job,
  });

  return { name };
}

export async function deleteIsaacLabJob(nameInput: string) {
  const name = nameInput.trim().toLowerCase();
  validateLabName(name);

  const ctx = await createKubeContext();

  try {
    await ctx.batchApi.deleteNamespacedJob({
      namespace: ctx.namespace,
      name: jobName(name),
      propagationPolicy: "Foreground",
      gracePeriodSeconds: 0,
    });
  } catch (error) {
    if (!isNotFoundError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`删除 Isaac Lab Job 失败：${message}`);
    }
  }

  return { name };
}
