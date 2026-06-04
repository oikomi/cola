import "server-only";

import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  AppsV1Api,
  CoreV1Api,
  type V1Deployment,
  type V1Node,
  type V1Pod,
  type V1Service,
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
import { ISAAC_STATION_WEBRTC_PORT } from "./streaming-url";
import {
  buildContainerImageOptions,
  type ContainerImageOption,
} from "./image-options";

const K8S_INFRA_DIR = path.join(process.cwd(), "infra", "k8s");
const CLUSTER_CONFIG_PATH = path.join(K8S_INFRA_DIR, "cluster", "config.json");
const CLUSTER_NODES_PATH = path.join(K8S_INFRA_DIR, "cluster", "nodes.json");
const ISAAC_STATION_WORKDIR =
  process.env.COLA_ISAAC_STATION_WORKDIR ?? SHARED_STORAGE_MOUNT_PATH;
const K8S_API_CONNECT_TIMEOUT_MS = Number(
  process.env.COLA_ISAAC_STATION_K8S_API_CONNECT_TIMEOUT_MS ?? "2500",
);
const OWNER_USER_ID_METADATA_KEY = "cola.dev/owner-user-id";

function ownerMetadata(ownerUserId?: string | null): Record<string, string> {
  return ownerUserId ? { [OWNER_USER_ID_METADATA_KEY]: ownerUserId } : {};
}

type ClusterConfig = {
  clusterName: string;
  workspaceNamespace?: string;
  workspaceLabelKey?: string;
  gpuLabelKey?: string;
  controllerIp?: string;
};

type ClusterNode = {
  name: string;
  ip: string;
  roles: string[];
};

type IsaacStationKubeContext = {
  config: ClusterConfig;
  nodes: ClusterNode[];
  namespace: string;
  workspaceLabelKey: string;
  gpuLabelKey: string;
  kubeconfigPath: string | null;
  apiServer: string | null;
  appsApi: AppsV1Api;
  coreApi: CoreV1Api;
};

type IsaacStationResources = {
  deployments: V1Deployment[];
  services: V1Service[];
  pods: V1Pod[];
  liveNodes: V1Node[];
};

type IsaacStationLaunchMode = "headless-webrtc" | "headless-egl";

export type IsaacStationItem = {
  id: string;
  name: string;
  status: "running" | "starting" | "error";
  mode: IsaacStationLaunchMode;
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
  ownerUserId: string | null;
  ownerUser: ResourceOwner | null;
  updatedAt: string | null;
};

export type IsaacStationListResult = {
  available: boolean;
  reason: string | null;
  imageOptions: IsaacStationImageOption[];
  items: IsaacStationItem[];
};

export type IsaacStationImageOption = ContainerImageOption;

export type CreateIsaacStationInput = {
  name: string;
  image: string;
  cpu: string;
  memoryGi: number;
  gpuAllocationMode: GpuAllocationSpec["gpuAllocationMode"];
  gpuCount: number;
  gpuMemoryGi: number | null;
  mode: IsaacStationLaunchMode;
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
    process.env.COLA_ISAAC_STATION_K8S_NAMESPACE?.trim() ??
    config.workspaceNamespace ??
    "remote-work"
  );
}

function resolveKubeconfigPath(clusterName: string) {
  return resolveSharedKubeconfigPath({
    clusterName,
    envVarNames: [
      "COLA_ISAAC_STATION_KUBECONFIG_PATH",
      "REMOTE_WORK_KUBECONFIG_PATH",
      "WORKSPACE_KUBECONFIG",
    ],
  });
}

function createKubeConfig(clusterName: string) {
  return createSharedKubeConfig({
    clusterName,
    envVarNames: [
      "COLA_ISAAC_STATION_KUBECONFIG_PATH",
      "REMOTE_WORK_KUBECONFIG_PATH",
      "WORKSPACE_KUBECONFIG",
    ],
    warnPrefix: "[isaac-station]",
  });
}

async function createKubeContext(): Promise<IsaacStationKubeContext> {
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
    appsApi: kubeConfig.makeApiClient(AppsV1Api),
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

function buildAccessError(ctx: IsaacStationKubeContext, error: unknown) {
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

function deploymentName(name: string) {
  return `isaac-station-${name}`;
}

function serviceName(name: string) {
  return `isaac-station-${name}-svc`;
}

function stationNameFromDeployment(name?: string | null) {
  if (!name?.startsWith("isaac-station-")) return null;
  return name.slice("isaac-station-".length);
}

function stationSelector(name: string) {
  return {
    "app.kubernetes.io/name": "cola-isaac-station",
    "app.kubernetes.io/component": "simulator",
    "app.kubernetes.io/managed-by": "cola",
    "cola.isaac/station-name": name,
  };
}

function stationLabel(metadata?: {
  labels?: Record<string, string> | null;
  name?: string | null;
}) {
  return (
    metadata?.labels?.["cola.isaac/station-name"] ??
    stationNameFromDeployment(metadata?.name)
  );
}

function validateStationName(name: string) {
  if (name.length > 42) {
    throw new Error("Isaac Station 名称最多 42 个字符。");
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error("Isaac Station 名称必须符合 DNS-1123 简单命名规则。");
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

function normalizeStationGpuAllocation(spec: GpuAllocationSpec) {
  return normalizeGpuAllocation(spec, {
    minGpuCount: 1,
  });
}

function normalizeLaunchMode(mode: IsaacStationLaunchMode) {
  return mode;
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

function assertStationSchedulable(params: {
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
    throw new Error("没有找到满足 Isaac GPU 需求的 Ready worker 节点。");
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

function deploymentStatus(deployment: V1Deployment) {
  const desired = deployment.spec?.replicas ?? 0;
  const ready = deployment.status?.readyReplicas ?? 0;
  const conditions = deployment.status?.conditions ?? [];
  const failed = conditions.some(
    (condition) =>
      condition.type === "ReplicaFailure" ||
      (condition.type === "Progressing" &&
        condition.status === "False" &&
        condition.reason === "ProgressDeadlineExceeded"),
  );

  if (failed) return "error" as const;
  if (desired > 0 && ready >= desired) return "running" as const;
  return "starting" as const;
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

async function listStationResources(
  ctx: IsaacStationKubeContext,
): Promise<IsaacStationResources> {
  if (!(await namespaceExists(ctx.coreApi, ctx.namespace))) {
    return {
      deployments: [],
      services: [],
      pods: [],
      liveNodes: [],
    };
  }

  const [deployments, services, pods, liveNodes] = await Promise.all([
    ctx.appsApi.listNamespacedDeployment({ namespace: ctx.namespace }),
    ctx.coreApi.listNamespacedService({ namespace: ctx.namespace }),
    ctx.coreApi.listNamespacedPod({ namespace: ctx.namespace }),
    ctx.coreApi.listNode(),
  ]);

  return {
    deployments: (deployments.items ?? []).filter(
      (deployment) =>
        deployment.metadata?.labels?.["app.kubernetes.io/name"] ===
          "cola-isaac-station" ||
        deployment.metadata?.name?.startsWith("isaac-station-"),
    ),
    services: (services.items ?? []).filter(
      (service) =>
        service.metadata?.labels?.["app.kubernetes.io/name"] ===
          "cola-isaac-station" ||
        service.metadata?.name?.startsWith("isaac-station-"),
    ),
    pods: (pods.items ?? []).filter(
      (pod) =>
        pod.metadata?.labels?.["app.kubernetes.io/name"] ===
          "cola-isaac-station" ||
        pod.metadata?.labels?.["cola.isaac/station-name"] !== undefined ||
        pod.metadata?.name?.startsWith("isaac-station-"),
    ),
    liveNodes: liveNodes.items ?? [],
  };
}

function resolveWorkVolume() {
  return resolveKubernetesWorkVolume({
    env: process.env,
    volumeName: "isaac-workspace",
    defaultMountPath: ISAAC_STATION_WORKDIR,
    seaweedfsEnabledEnvNames: ["COLA_ISAAC_STATION_SEAWEEDFS_MOUNT_ENABLED"],
    mountPathEnvNames: [
      "COLA_ISAAC_STATION_WORKDIR_MOUNT_PATH",
      "COLA_TRAINING_WORKDIR_MOUNT_PATH",
    ],
    hostPathEnvNames: [
      "COLA_ISAAC_STATION_WORKDIR_HOST_PATH",
      "COLA_TRAINING_WORKDIR_HOST_PATH",
    ],
    hostPathType: "DirectoryOrCreate",
    hostPathMountPathEnvNames: [
      "COLA_ISAAC_STATION_WORKDIR_MOUNT_PATH",
      "COLA_TRAINING_WORKDIR_MOUNT_PATH",
    ],
    pvcNameEnvNames: ["COLA_ISAAC_STATION_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_ISAAC_STATION_PVC_MOUNT_PATH"],
    fallbackHostPath: {
      path: "/var/lib/remote-work/isaac-station",
      type: "DirectoryOrCreate",
    },
  });
}

function resolveRuntimeClassName() {
  const configured =
    process.env.COLA_ISAAC_STATION_RUNTIME_CLASS_NAME?.trim() ??
    process.env.COLA_TRAINING_RUNTIME_CLASS_NAME?.trim();
  return configured && configured.length > 0 ? configured : "nvidia";
}

function resolveGpuRuntimeMode() {
  const configured = process.env.COLA_ISAAC_STATION_GPU_RUNTIME?.trim();
  return configured === "nvidia" ? "nvidia" : "hami";
}

function buildIsaacCommand(input: { workdir: string }) {
  const customCommand = process.env.COLA_ISAAC_STATION_COMMAND?.trim();
  if (customCommand) return customCommand;

  const executable =
    process.env.COLA_ISAAC_STATION_EXECUTABLE?.trim() ??
    "/isaac-sim/runheadless.sh";
  const extraArgs = process.env.COLA_ISAAC_STATION_EXTRA_ARGS?.trim() ?? "";

  return [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(input.workdir)}/cache ${shellQuote(input.workdir)}/logs ${shellQuote(input.workdir)}/data`,
    "export ACCEPT_EULA=${ACCEPT_EULA:-Y}",
    "export PRIVACY_CONSENT=${PRIVACY_CONSENT:-Y}",
    `export ISAAC_STATION_WORKDIR=${shellQuote(input.workdir)}`,
    `exec ${executable} ${extraArgs}`.trim(),
  ].join("\n");
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function buildStationDeployment(input: {
  name: string;
  image: string;
  cpu: string;
  memory: string;
  gpuAllocationMode: GpuAllocationSpec["gpuAllocationMode"];
  gpuCount: number;
  gpuMemoryGi: number | null;
  mode: IsaacStationLaunchMode;
  ownerUserId?: string;
}) {
  const labels = stationSelector(input.name);
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
  const gpuRuntimeMode = resolveGpuRuntimeMode();
  const schedulerSpec =
    gpuRuntimeMode === "hami" ? buildHamiSchedulerSpec(gpuSpec) : {};

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: deploymentName(input.name),
      labels: { ...labels, ...ownerLabels },
      annotations: {
        ...ownerLabels,
        "cola.isaac/title": input.name,
        "cola.isaac/mode": input.mode,
      },
    },
    spec: {
      replicas: 1,
      strategy: {
        type: "Recreate",
      },
      selector: {
        matchLabels: {
          "cola.isaac/station-name": input.name,
        },
      },
      template: {
        metadata: {
          labels: { ...labels, ...ownerLabels },
          annotations: {
            ...ownerLabels,
            "cola.isaac/mode": input.mode,
          },
        },
        spec: {
          hostNetwork: input.mode === "headless-webrtc",
          dnsPolicy:
            input.mode === "headless-webrtc"
              ? "ClusterFirstWithHostNet"
              : "ClusterFirst",
          ...(runtimeClassName ? { runtimeClassName } : {}),
          ...schedulerSpec,
          initContainers: buildWorkVolumeInitContainers(workVolume),
          containers: [
            {
              name: "isaac-sim",
              image: input.image,
              imagePullPolicy:
                process.env.COLA_ISAAC_STATION_IMAGE_PULL_POLICY ??
                "IfNotPresent",
              workingDir: mountPath,
              command: ["bash", "-lc"],
              args: [
                buildWorkVolumeShellCommand(
                  workVolume,
                  buildIsaacCommand({ workdir: mountPath }),
                ),
              ],
              ports: [
                {
                  containerPort: ISAAC_STATION_WEBRTC_PORT,
                  name: "webrtc",
                  protocol: "TCP",
                },
              ],
              env: [
                {
                  name: "TZ",
                  value: process.env.COLA_ISAAC_STATION_TZ ?? "Asia/Shanghai",
                },
                { name: "ACCEPT_EULA", value: "Y" },
                { name: "PRIVACY_CONSENT", value: "Y" },
                { name: "COLA_ISAAC_STATION_NAME", value: input.name },
                { name: "COLA_ISAAC_STATION_MODE", value: input.mode },
                {
                  name: "COLA_ISAAC_STATION_WORKDIR",
                  value: mountPath,
                },
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
              volumeMounts: buildWorkVolumeMounts(workVolume),
              securityContext: buildWorkVolumeSecurityContext(workVolume),
            },
          ],
          volumes: buildWorkVolumes(workVolume),
        },
      },
    },
  } satisfies V1Deployment;
}

function buildStationService(input: { name: string; ownerUserId?: string }) {
  const labels = stationSelector(input.name);
  const ownerLabels = ownerMetadata(input.ownerUserId);

  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: serviceName(input.name),
      labels: { ...labels, ...ownerLabels },
      annotations: {
        ...ownerLabels,
        "cola.isaac/network": "host-network",
      },
    },
    spec: {
      type: "ClusterIP",
      selector: {
        "cola.isaac/station-name": input.name,
      },
      ports: [
        {
          name: "webrtc",
          port: ISAAC_STATION_WEBRTC_PORT,
          targetPort: ISAAC_STATION_WEBRTC_PORT,
          protocol: "TCP",
        },
      ],
    },
  } satisfies V1Service;
}

function imageOptions(): IsaacStationImageOption[] {
  return buildContainerImageOptions({
    productName: "Isaac Sim",
    configuredImage: process.env.COLA_ISAAC_STATION_IMAGE,
    configuredImages: process.env.COLA_ISAAC_STATION_IMAGES,
    defaultOptions: [
      {
        value: "nvcr.io/nvidia/isaac-sim:5.0.0",
        label: "Isaac Sim 5.0.0",
        description: "nvcr.io/nvidia/isaac-sim:5.0.0",
      },
      {
        value: "nvcr.io/nvidia/isaac-sim:5.1.0",
        label: "Isaac Sim 5.1.0",
        description: "nvcr.io/nvidia/isaac-sim:5.1.0",
      },
      {
        value: "nvcr.io/nvidia/isaac-sim:6.0.0-dev2",
        label: "Isaac Sim 6.0.0 dev",
        description: "nvcr.io/nvidia/isaac-sim:6.0.0-dev2",
      },
      {
        value: "nvcr.io/nvidia/isaac-sim:4.5.0",
        label: "Isaac Sim 4.5.0",
        description: "nvcr.io/nvidia/isaac-sim:4.5.0",
      },
      {
        value: "nvcr.io/nvidia/isaac-sim:4.2.0",
        label: "Isaac Sim 4.2.0",
        description: "nvcr.io/nvidia/isaac-sim:4.2.0",
      },
    ],
  });
}

function stationItemFromDeployment(input: {
  deployment: V1Deployment;
  service?: V1Service;
  pod?: V1Pod;
  liveNodes: V1Node[];
  configNodes: ClusterNode[];
  ownerMap: Map<string, ResourceOwner>;
}): IsaacStationItem | null {
  const name = stationLabel(input.deployment.metadata);
  if (!name) return null;

  const container = input.deployment.spec?.template.spec?.containers?.[0];
  const resources =
    container?.resources?.limits ?? container?.resources?.requests;
  const gpu = parseGpuAllocationFromResources(resources);
  const ownerUserId =
    input.deployment.metadata?.annotations?.[OWNER_USER_ID_METADATA_KEY] ??
    input.deployment.metadata?.labels?.[OWNER_USER_ID_METADATA_KEY] ??
    null;
  const podNodeName = input.pod?.spec?.nodeName ?? null;
  const liveNode = podNodeName
    ? input.liveNodes.find((node) => node.metadata?.name === podNodeName)
    : undefined;
  const nodeIp = resolveNodeIp(input.configNodes, liveNode);
  const mode =
    input.deployment.metadata?.annotations?.["cola.isaac/mode"] ===
    "headless-egl"
      ? "headless-egl"
      : "headless-webrtc";

  return {
    id: name,
    name,
    status: deploymentStatus(input.deployment),
    mode,
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
      mode === "headless-webrtc"
        ? buildEndpoint({
            nodeIp,
            port: ISAAC_STATION_WEBRTC_PORT,
          })
        : null,
    ownerUserId,
    ownerUser: ownerForUserId(input.ownerMap, ownerUserId),
    updatedAt: formatTimestamp(input.deployment.metadata?.creationTimestamp),
  };
}

export async function listIsaacStations(): Promise<IsaacStationListResult> {
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

  let ctx: IsaacStationKubeContext;
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
    const resources = await listStationResources(ctx);
    const serviceByStation = new Map(
      resources.services
        .map((service) => [stationLabel(service.metadata), service] as const)
        .filter((entry): entry is readonly [string, V1Service] =>
          Boolean(entry[0]),
        ),
    );
    const podByStation = new Map(
      resources.pods
        .map((pod) => [stationLabel(pod.metadata), pod] as const)
        .filter((entry): entry is readonly [string, V1Pod] =>
          Boolean(entry[0]),
        ),
    );
    const ownerUserIds = resources.deployments.map(
      (deployment) =>
        deployment.metadata?.annotations?.[OWNER_USER_ID_METADATA_KEY] ??
        deployment.metadata?.labels?.[OWNER_USER_ID_METADATA_KEY],
    );
    const ownerMap = await loadResourceOwnerMap(db, ownerUserIds);
    const items = resources.deployments
      .map((deployment) =>
        stationItemFromDeployment({
          deployment,
          service: serviceByStation.get(
            stationLabel(deployment.metadata) ?? "",
          ),
          pod: podByStation.get(stationLabel(deployment.metadata) ?? ""),
          liveNodes: resources.liveNodes,
          configNodes: ctx.nodes,
          ownerMap,
        }),
      )
      .filter((item): item is IsaacStationItem => item !== null)
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

export async function createIsaacStation(input: CreateIsaacStationInput) {
  const name = input.name.trim().toLowerCase();
  validateStationName(name);

  const image = input.image.trim();
  if (!image) {
    throw new Error("Isaac Sim 镜像不能为空。");
  }

  const cpu = normalizeCpu(input.cpu);
  const memory = normalizeMemoryGi(input.memoryGi);
  const gpu = normalizeStationGpuAllocation({
    gpuAllocationMode: input.gpuAllocationMode,
    gpuCount: input.gpuCount,
    gpuMemoryGi: input.gpuMemoryGi,
  });
  const mode = normalizeLaunchMode(input.mode);

  if (!usesGpuAcceleration(gpu)) {
    throw new Error("Isaac Station 必须申请至少 1 个 GPU。");
  }

  const ctx = await createKubeContext();
  await ensureNamespace(ctx.coreApi, ctx.namespace);

  const resources = await listStationResources(ctx);
  if (
    resources.deployments.some(
      (deployment) => stationLabel(deployment.metadata) === name,
    )
  ) {
    throw new Error(`Isaac Station ${name} 已存在。`);
  }

  assertStationSchedulable({
    configNodes: ctx.nodes,
    liveNodes: resources.liveNodes,
    requestedGpuSpec: gpu,
    workspaceLabelKey: ctx.workspaceLabelKey,
    gpuLabelKey: ctx.gpuLabelKey,
  });

  const deployment = buildStationDeployment({
    name,
    image,
    cpu,
    memory,
    gpuAllocationMode: gpu.gpuAllocationMode,
    gpuCount: gpu.gpuCount,
    gpuMemoryGi: gpu.gpuMemoryGi,
    mode,
    ownerUserId: input.ownerUserId,
  });
  const service = buildStationService({
    name,
    ownerUserId: input.ownerUserId,
  });

  await ctx.appsApi.createNamespacedDeployment({
    namespace: ctx.namespace,
    body: deployment,
  });
  await ctx.coreApi.createNamespacedService({
    namespace: ctx.namespace,
    body: service,
  });

  return { name };
}

export async function deleteIsaacStation(nameInput: string) {
  const name = nameInput.trim().toLowerCase();
  validateStationName(name);

  const ctx = await createKubeContext();
  const errors: unknown[] = [];

  try {
    await ctx.appsApi.deleteNamespacedDeployment({
      namespace: ctx.namespace,
      name: deploymentName(name),
    });
  } catch (error) {
    if (!isNotFoundError(error)) errors.push(error);
  }

  try {
    await ctx.coreApi.deleteNamespacedService({
      namespace: ctx.namespace,
      name: serviceName(name),
    });
  } catch (error) {
    if (!isNotFoundError(error)) errors.push(error);
  }

  if (errors.length > 0) {
    const detail = errors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join("；");
    throw new Error(`删除 Isaac Station 失败：${detail}`);
  }

  return { name };
}
