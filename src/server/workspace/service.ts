import "server-only";

import fs from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";

import {
  AppsV1Api,
  CoreV1Api,
  NetworkingV1Api,
  type V1Deployment,
  type V1Ingress,
  type V1Node,
  type V1Pod,
  type V1Secret,
  type V1Service,
} from "@kubernetes/client-node";

import {
  type GpuAllocationSpec,
  usesGpuAcceleration,
} from "@/lib/gpu-allocation";
import {
  buildHamiGpuResources,
  buildHamiSchedulerSpec,
  normalizeGpuAllocation,
  parseGpuAllocationFromResources,
} from "@/server/gpu/hami";
import { db } from "@/server/db";
import {
  createKubeConfig,
  resolveKubeconfigPath as resolveSharedKubeconfigPath,
} from "@/server/kubernetes/kubeconfig";
import { resolveAvailableNodePort } from "@/server/kubernetes/node-port";
import { NODE_PORT_RANGES } from "@/server/kubernetes/node-port-ranges";
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

const K8S_INFRA_DIR = path.join(process.cwd(), "infra", "k8s");
const WORKSPACE_RUNTIME_DIR = path.join(process.cwd(), "runtime", "workspace");
const CLUSTER_CONFIG_PATH = path.join(K8S_INFRA_DIR, "cluster", "config.json");
const CLUSTER_NODES_PATH = path.join(K8S_INFRA_DIR, "cluster", "nodes.json");
const RUNTIME_IMAGE_PATH = path.join(WORKSPACE_RUNTIME_DIR, "latest-image.txt");

const K8S_API_CONNECT_TIMEOUT_MS = Number(
  process.env.WORKSPACE_K8S_API_CONNECT_TIMEOUT_MS ?? 2500,
);
const OWNER_USER_ID_METADATA_KEY = "cola.dev/owner-user-id";
const WORKSPACE_CODEX_MOUNT_PATH = "/opt/remote-work/codex";

function ownerMetadata(ownerUserId?: string | null): Record<string, string> {
  return ownerUserId ? { [OWNER_USER_ID_METADATA_KEY]: ownerUserId } : {};
}

type ClusterConfig = {
  clusterName: string;
  controllerIp?: string;
  workspaceNamespace: string;
  workspaceLabelKey: string;
  gpuLabelKey: string;
};

type ClusterNode = {
  name: string;
  ip: string;
  roles: string[];
};

type KubeContext = {
  config: ClusterConfig;
  nodes: ClusterNode[];
  kubeconfigPath: string;
  apiServer: string | null;
  appsApi: AppsV1Api;
  coreApi: CoreV1Api;
  networkingApi: NetworkingV1Api;
};

export type WorkspaceItem = {
  id: string;
  name: string;
  status: "running" | "starting" | "error";
  cpu: string;
  memory: string;
  gpuAllocationMode: GpuAllocationSpec["gpuAllocationMode"];
  gpuCount: number;
  gpuMemoryGi: number | null;
  resolution: string;
  nodeName: string | null;
  nodeIp: string | null;
  endpoint: string | null;
  loginUrl: string | null;
  ownerUserId: string | null;
  ownerUser: ResourceOwner | null;
  updatedAt: string | null;
};

export type WorkspaceListResult = {
  available: boolean;
  reason: string | null;
  items: WorkspaceItem[];
};

export type CreateWorkspaceInput = {
  name: string;
  cpu: string;
  memoryGi: number;
  gpuAllocationMode: GpuAllocationSpec["gpuAllocationMode"];
  gpuCount: number;
  gpuMemoryGi: number | null;
  resolution: string;
  ownerUserId?: string;
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readClusterConfig() {
  const config = readJsonFile<ClusterConfig>(CLUSTER_CONFIG_PATH);
  const nodes = readJsonFile<ClusterNode[]>(CLUSTER_NODES_PATH);
  return { config, nodes };
}

function resolveKubeconfigPath(clusterName: string) {
  return resolveSharedKubeconfigPath({
    clusterName,
    envVarNames: ["REMOTE_WORK_KUBECONFIG_PATH", "WORKSPACE_KUBECONFIG"],
  });
}

function resolveWorkspaceImage() {
  const configuredImage = process.env.REMOTE_WORKSPACE_IMAGE?.trim();
  if (configuredImage) return configuredImage;

  if (fs.existsSync(RUNTIME_IMAGE_PATH)) {
    return fs.readFileSync(RUNTIME_IMAGE_PATH, "utf8").trim();
  }

  throw new Error(
    `未找到 workspace 镜像配置。请设置 REMOTE_WORKSPACE_IMAGE，或先生成 ${RUNTIME_IMAGE_PATH}。`,
  );
}

function resolveWorkspaceCodexConfigPath() {
  return (
    process.env.REMOTE_WORKSPACE_CODEX_CONFIG_PATH ??
    path.join(homedir(), ".codex", "config.toml")
  );
}

function resolveWorkspaceCodexAuthPath() {
  return (
    process.env.REMOTE_WORKSPACE_CODEX_AUTH_PATH ??
    path.join(homedir(), ".codex", "auth.json")
  );
}

function buildWorkspaceCodexSecret(input: {
  name: string;
  namespace: string;
  ownerUserId?: string;
}) {
  const existingSecret = process.env.REMOTE_WORKSPACE_CODEX_SECRET_NAME?.trim();
  if (existingSecret) {
    return { name: existingSecret, manifest: null };
  }

  const configPath = resolveWorkspaceCodexConfigPath();
  const authPath = resolveWorkspaceCodexAuthPath();

  if (!fs.existsSync(configPath) || !fs.existsSync(authPath)) {
    throw new Error(
      `缺少 Codex 配置或认证文件，无法创建云桌面 Codex Secret。请确认宿主机存在 ${configPath} 和 ${authPath}，或设置 REMOTE_WORKSPACE_CODEX_SECRET_NAME 使用已有 Secret。`,
    );
  }

  const ownerLabels = ownerMetadata(input.ownerUserId);
  const name = `workspace-${input.name}-codex`;

  return {
    name,
    manifest: {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name,
        namespace: input.namespace,
        labels: {
          "app.kubernetes.io/name": "remote-workspace",
          "remote-work/name": input.name,
          ...ownerLabels,
        },
        annotations: {
          ...ownerLabels,
        },
      },
      type: "Opaque",
      stringData: {
        "config.toml": fs.readFileSync(configPath, "utf8"),
        "auth.json": fs.readFileSync(authPath, "utf8"),
      },
    } satisfies V1Secret,
  };
}

function buildWorkspaceCapabilityError(kubeconfigPath: string) {
  return `无法访问 Kubernetes 集群。请确认 Ubuntu 服务器上 kubeconfig 可读：${kubeconfigPath}`;
}

function buildWorkspaceAccessError(ctx: KubeContext, error: unknown) {
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
  });
}

function workspaceNameFromDeployment(name?: string | null) {
  if (!name?.startsWith("workspace-")) return null;
  return name.slice("workspace-".length);
}

function validateWorkspaceName(name: string) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error("工作区名称必须符合 DNS-1123 简单命名规则。");
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
    throw new Error("Memory 必须是大于 0 的整数 Gi。");
  }

  return `${input}Gi`;
}

function normalizeWorkspaceGpuAllocation(spec: GpuAllocationSpec) {
  return normalizeGpuAllocation(spec, {
    minGpuCount: spec.gpuAllocationMode === "whole" ? 0 : 1,
  });
}

function normalizeResolution(input: string) {
  const value = input.trim().toLowerCase();
  const match = /^(\d{3,5})x(\d{3,5})x(\d{1,2})$/.exec(value);
  if (!match) {
    throw new Error("分辨率必须是 WxHxD 格式，例如 1600x900x24。");
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  const depth = Number(match[3]);

  if (width < 800 || height < 600) {
    throw new Error("分辨率不能低于 800x600。");
  }

  if (![16, 24, 32].includes(depth)) {
    throw new Error("色深只支持 16、24 或 32。");
  }

  return `${width}x${height}x${depth}`;
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

function assertWorkspaceSchedulable(params: {
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
        workspaceLabeled:
          live?.metadata?.labels?.[params.workspaceLabelKey] === "true",
        allocatableGpu: live ? allocatableGpuCount(live) : 0,
        gpuCapable: live ? isGpuCapable(node, live, params.gpuLabelKey) : false,
      };
    })
    .filter((entry) => entry.live && entry.ready)
    .filter((entry) =>
      usesGpuAcceleration(params.requestedGpuSpec)
        ? entry.gpuCapable &&
          (params.requestedGpuSpec.gpuAllocationMode === "memory"
            ? entry.allocatableGpu >= 1
            : entry.allocatableGpu >= params.requestedGpuSpec.gpuCount)
        : true,
    );

  const preferred = candidates.some((entry) => entry.workspaceLabeled)
    ? candidates.filter((entry) => entry.workspaceLabeled)
    : candidates;

  if (preferred.length === 0) {
    throw new Error(
      usesGpuAcceleration(params.requestedGpuSpec)
        ? "没有找到满足 GPU 需求的 Ready worker 节点。"
        : "没有找到可用的 Ready worker 节点。",
    );
  }
}

function resolveWorkspaceNodePort(services: V1Service[]) {
  return resolveAvailableNodePort({
    services,
    start: NODE_PORT_RANGES.workspace.start,
    end: NODE_PORT_RANGES.workspace.end,
    errorMessage: "无法为远程桌面自动分配 NodePort。",
  });
}

function resolveNodeIp(configNodes: ClusterNode[], liveNode?: V1Node) {
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

function controllerAccessHost(config: ClusterConfig, nodes: ClusterNode[]) {
  return (
    config.controllerIp ??
    nodes.find((node) => node.roles.includes("master"))?.ip ??
    null
  );
}

function buildLoginUrl(params: {
  ingress?: V1Ingress | null;
  service?: V1Service | null;
  nodeIp?: string | null;
}) {
  const host = params.ingress?.spec?.rules?.[0]?.host;
  if (host) {
    const secure = (params.ingress?.spec?.tls?.length ?? 0) > 0;
    return `${secure ? "https" : "http"}://${host}/`;
  }

  const nodePort = params.service?.spec?.ports?.find(
    (port) => port.port === 6080 || port.name === "http",
  )?.nodePort;

  if (!params.nodeIp || typeof nodePort !== "number") return null;

  return `http://${params.nodeIp}:${nodePort}/`;
}

function workspaceStatus(deployment: V1Deployment) {
  const desired = deployment.spec?.replicas ?? 0;
  const ready = deployment.status?.readyReplicas ?? 0;
  const conditions = deployment.status?.conditions ?? [];
  const failed = conditions.some(
    (condition) =>
      condition.type === "ReplicaFailure" ||
      (condition.type === "Progressing" && condition.status === "False"),
  );

  if (failed) return "error" as const;
  if (desired > 0 && ready >= desired) return "running" as const;
  return "starting" as const;
}

async function createKubeContext(): Promise<KubeContext> {
  const { config, nodes } = readClusterConfig();
  const { kubeConfig, kubeconfigPath } = createKubeConfig({
    clusterName: config.clusterName,
    envVarNames: ["REMOTE_WORK_KUBECONFIG_PATH", "WORKSPACE_KUBECONFIG"],
    preferInCluster: false,
    warnPrefix: "[workspace]",
  });
  const apiServer = kubeConfig.getCurrentCluster()?.server ?? null;

  return {
    config,
    nodes,
    kubeconfigPath: kubeconfigPath!,
    apiServer,
    appsApi: kubeConfig.makeApiClient(AppsV1Api),
    coreApi: kubeConfig.makeApiClient(CoreV1Api),
    networkingApi: kubeConfig.makeApiClient(NetworkingV1Api),
  };
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

async function listAllServicesWithFallback(ctx: KubeContext) {
  try {
    const services = await ctx.coreApi.listServiceForAllNamespaces();
    return services.items ?? [];
  } catch {
    const namespaceServices = await ctx.coreApi.listNamespacedService({
      namespace: ctx.config.workspaceNamespace,
    });
    return namespaceServices.items ?? [];
  }
}

async function listWorkspaceResources(ctx: KubeContext) {
  const namespace = ctx.config.workspaceNamespace;
  if (!(await namespaceExists(ctx.coreApi, namespace))) {
    return {
      deployments: [] as V1Deployment[],
      services: [] as V1Service[],
      allServices: [] as V1Service[],
      ingresses: [] as V1Ingress[],
      pods: [] as V1Pod[],
      liveNodes: [] as V1Node[],
    };
  }

  const [deployments, services, allServices, ingresses, pods, liveNodes] =
    await Promise.all([
      ctx.appsApi.listNamespacedDeployment({ namespace }),
      ctx.coreApi.listNamespacedService({ namespace }),
      listAllServicesWithFallback(ctx),
      ctx.networkingApi.listNamespacedIngress({ namespace }),
      ctx.coreApi.listNamespacedPod({ namespace }),
      ctx.coreApi.listNode(),
    ]);

  return {
    deployments: (deployments.items ?? []).filter((deployment) =>
      deployment.metadata?.name?.startsWith("workspace-"),
    ),
    services: (services.items ?? []).filter((service) =>
      service.metadata?.name?.startsWith("workspace-"),
    ),
    ingresses: (ingresses.items ?? []).filter((ingress) =>
      ingress.metadata?.name?.startsWith("workspace-"),
    ),
    pods: (pods.items ?? []).filter(
      (pod) =>
        pod.metadata?.labels?.["app.kubernetes.io/name"] ===
          "remote-workspace" ||
        pod.metadata?.labels?.["remote-work/name"] !== undefined ||
        pod.metadata?.name?.startsWith("workspace-"),
    ),
    allServices,
    liveNodes: liveNodes.items ?? [],
  };
}

function buildWorkspaceDeployment(input: {
  name: string;
  image: string;
  cpu: string;
  memory: string;
  gpuAllocationMode: GpuAllocationSpec["gpuAllocationMode"];
  gpuCount: number;
  gpuMemoryGi: number | null;
  resolution: string;
  codexSecretName: string;
  ownerUserId?: string;
}) {
  const workspaceRoot =
    process.env.REMOTE_WORKSPACE_ROOT ?? "/var/lib/remote-work/workspaces";
  const workVolume = resolveKubernetesWorkVolume({
    env: process.env,
    volumeName: "workspace",
    defaultMountPath: SHARED_STORAGE_MOUNT_PATH,
    seaweedfsEnabledEnvNames: ["REMOTE_WORKSPACE_SEAWEEDFS_MOUNT_ENABLED"],
    mountPathEnvNames: [
      "REMOTE_WORKSPACE_WORKDIR_MOUNT_PATH",
      "COLA_TRAINING_WORKDIR_MOUNT_PATH",
    ],
    hostPathEnvNames: [
      "REMOTE_WORKSPACE_WORKDIR_HOST_PATH",
      "COLA_TRAINING_WORKDIR_HOST_PATH",
    ],
    hostPathMountPathEnvNames: [
      "REMOTE_WORKSPACE_WORKDIR_MOUNT_PATH",
      "COLA_TRAINING_WORKDIR_MOUNT_PATH",
    ],
    pvcNameEnvNames: ["REMOTE_WORKSPACE_PVC_NAME"],
    pvcMountPathEnvNames: ["REMOTE_WORKSPACE_PVC_MOUNT_PATH"],
    fallbackHostPath: {
      path: path.posix.join(workspaceRoot, input.name, "workspace"),
      type: "DirectoryOrCreate",
    },
  });
  const gpuSpec = {
    gpuAllocationMode: input.gpuAllocationMode,
    gpuCount: input.gpuCount,
    gpuMemoryGi: input.gpuMemoryGi,
  } satisfies GpuAllocationSpec;
  const gpuResources = buildHamiGpuResources(gpuSpec);

  const ownerLabels = ownerMetadata(input.ownerUserId);

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: `workspace-${input.name}`,
      labels: {
        "app.kubernetes.io/name": "remote-workspace",
        "remote-work/name": input.name,
        ...ownerLabels,
      },
      annotations: {
        ...ownerLabels,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          "remote-work/name": input.name,
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "remote-workspace",
            "remote-work/name": input.name,
            ...ownerLabels,
          },
          annotations: {
            ...ownerLabels,
          },
        },
        spec: {
          ...(usesGpuAcceleration(gpuSpec)
            ? { runtimeClassName: "nvidia" }
            : {}),
          ...buildHamiSchedulerSpec(gpuSpec),
          initContainers: buildWorkVolumeInitContainers(workVolume),
          containers: [
            {
              name: "desktop",
              image: input.image,
              imagePullPolicy: "IfNotPresent",
              ports: [{ containerPort: 6080, name: "http" }],
              env: [
                {
                  name: "TZ",
                  value: process.env.REMOTE_WORKSPACE_TZ ?? "Asia/Shanghai",
                },
                { name: "DISPLAY", value: ":1" },
                {
                  name: "RESOLUTION",
                  value: input.resolution,
                },
                {
                  name: "WORKSPACE_NAME",
                  value: input.name,
                },
                { name: "KASMVNC_PORT", value: "6080" },
                { name: "KASMVNC_SEND_CUT_TEXT", value: "1" },
                { name: "KASMVNC_ACCEPT_CUT_TEXT", value: "1" },
                { name: "VNC_DISABLE_PASSWORD", value: "1" },
                ...buildWorkVolumeEnv(workVolume),
              ],
              command: ["/bin/bash", "-lc"],
              args: [
                buildWorkVolumeShellCommand(
                  workVolume,
                  "exec /usr/bin/tini -- /opt/remote-work/entrypoint.sh",
                ),
              ],
              readinessProbe: {
                tcpSocket: { port: 6080 },
                initialDelaySeconds: 10,
                periodSeconds: 10,
              },
              livenessProbe: {
                tcpSocket: { port: 6080 },
                initialDelaySeconds: 30,
                periodSeconds: 15,
              },
              resources: {
                requests: {
                  cpu: input.cpu,
                  memory: input.memory,
                  ...gpuResources,
                },
                limits: {
                  cpu: input.cpu,
                  memory: input.memory,
                  ...gpuResources,
                },
              },
              volumeMounts: [
                { name: "home", mountPath: "/home/worker" },
                {
                  name: "codex",
                  mountPath: WORKSPACE_CODEX_MOUNT_PATH,
                  readOnly: true,
                },
                ...buildWorkVolumeMounts(workVolume),
              ],
              ...(buildWorkVolumeSecurityContext(workVolume)
                ? {
                    securityContext: buildWorkVolumeSecurityContext(workVolume),
                  }
                : {}),
            },
          ],
          volumes: [
            {
              name: "home",
              hostPath: {
                path: path.posix.join(workspaceRoot, input.name, "home"),
                type: "DirectoryOrCreate",
              },
            },
            {
              name: "codex",
              secret: {
                secretName: input.codexSecretName,
              },
            },
            ...buildWorkVolumes(workVolume),
          ],
        },
      },
    },
  } satisfies V1Deployment;
}

function buildWorkspaceService(input: {
  name: string;
  nodePort: number;
  ownerUserId?: string;
}) {
  const ownerLabels = ownerMetadata(input.ownerUserId);

  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: `workspace-${input.name}-svc`,
      labels: {
        "app.kubernetes.io/name": "remote-workspace",
        "remote-work/name": input.name,
        ...ownerLabels,
      },
      annotations: {
        ...ownerLabels,
      },
    },
    spec: {
      type: "NodePort",
      selector: {
        "remote-work/name": input.name,
      },
      ports: [
        {
          name: "http",
          port: 6080,
          targetPort: 6080,
          nodePort: input.nodePort,
        },
      ],
    },
  } satisfies V1Service;
}

function workspaceLabel(metadata?: {
  labels?: Record<string, string> | null;
  name?: string | null;
}) {
  return (
    metadata?.labels?.["remote-work/name"] ??
    workspaceNameFromDeployment(metadata?.name)
  );
}

export async function listWorkspaces(): Promise<WorkspaceListResult> {
  let ctx: KubeContext;

  try {
    ctx = await createKubeContext();
  } catch (error) {
    const { config } = readClusterConfig();
    const kubeconfigPath = resolveKubeconfigPath(config.clusterName);

    return {
      available: false,
      reason:
        error instanceof Error
          ? `${buildWorkspaceCapabilityError(kubeconfigPath)}。${error.message}`
          : buildWorkspaceCapabilityError(kubeconfigPath),
      items: [],
    };
  }

  const apiConnectivityReason = await probeKubeApiServer(ctx.apiServer);
  if (apiConnectivityReason) {
    return {
      available: false,
      reason: apiConnectivityReason,
      items: [],
    };
  }

  let resources: Awaited<ReturnType<typeof listWorkspaceResources>>;
  try {
    resources = await listWorkspaceResources(ctx);
  } catch (error) {
    return {
      available: false,
      reason: buildWorkspaceAccessError(ctx, error),
      items: [],
    };
  }

  const { deployments, services, ingresses, liveNodes, pods } = resources;
  const accessHost = controllerAccessHost(ctx.config, ctx.nodes);

  const serviceByName = new Map(
    services
      .map((service) => [workspaceLabel(service.metadata), service] as const)
      .filter((entry): entry is readonly [string, V1Service] =>
        Boolean(entry[0]),
      ),
  );

  const ingressByName = new Map(
    ingresses
      .map((ingress) => [workspaceLabel(ingress.metadata), ingress] as const)
      .filter((entry): entry is readonly [string, V1Ingress] =>
        Boolean(entry[0]),
      ),
  );

  const liveNodeMap = new Map(
    liveNodes
      .map((node) => [node.metadata?.name, node] as const)
      .filter((entry): entry is readonly [string, V1Node] => Boolean(entry[0])),
  );
  const podNodeByName = new Map<string, string>();
  for (const pod of pods) {
    const name = workspaceLabel(pod.metadata);
    const nodeName = pod.spec?.nodeName;
    if (name && nodeName && !podNodeByName.has(name)) {
      podNodeByName.set(name, nodeName);
    }
  }

  const itemsWithoutOwners: WorkspaceItem[] = deployments
    .map<WorkspaceItem | null>((deployment) => {
      const name = workspaceNameFromDeployment(deployment.metadata?.name);
      if (!name) return null;

      const nodeName = podNodeByName.get(name) ?? null;
      const liveNode = nodeName ? liveNodeMap.get(nodeName) : undefined;
      const nodeIp = resolveNodeIp(ctx.nodes, liveNode);
      const service = serviceByName.get(name) ?? null;
      const ingress = ingressByName.get(name) ?? null;
      const container = deployment.spec?.template?.spec?.containers?.[0];
      const limits =
        container?.resources?.limits ?? container?.resources?.requests ?? {};
      const gpuAllocation = parseGpuAllocationFromResources(
        limits as Record<string, string | number | null | undefined>,
      );
      const resolution =
        container?.env?.find((entry) => entry.name === "RESOLUTION")?.value ??
        process.env.REMOTE_WORKSPACE_RESOLUTION ??
        "1600x900x24";
      const updatedSource =
        deployment.status?.conditions
          ?.map((condition) => condition.lastTransitionTime)
          .filter((value): value is Date => value instanceof Date)
          .sort((left, right) => left.getTime() - right.getTime())
          .at(-1) ??
        deployment.metadata?.creationTimestamp ??
        null;

      return {
        id: name,
        name,
        status: workspaceStatus(deployment),
        cpu: String(limits.cpu ?? container?.resources?.requests?.cpu ?? "0"),
        memory: String(
          limits.memory ?? container?.resources?.requests?.memory ?? "0Gi",
        ),
        gpuAllocationMode: gpuAllocation.gpuAllocationMode,
        gpuCount: gpuAllocation.gpuCount,
        gpuMemoryGi: gpuAllocation.gpuMemoryGi,
        resolution,
        nodeName,
        nodeIp,
        endpoint:
          ingress?.spec?.rules?.[0]?.host ??
          (service?.spec?.ports?.find((port) => port.nodePort)?.nodePort &&
          accessHost
            ? `${accessHost}:${service.spec.ports?.find((port) => port.nodePort)?.nodePort}`
            : null),
        loginUrl: buildLoginUrl({
          ingress,
          service,
          nodeIp: accessHost,
        }),
        ownerUserId:
          deployment.metadata?.annotations?.[OWNER_USER_ID_METADATA_KEY] ??
          deployment.metadata?.labels?.[OWNER_USER_ID_METADATA_KEY] ??
          null,
        ownerUser: null,
        updatedAt: formatTimestamp(updatedSource),
      } satisfies WorkspaceItem;
    })
    .filter((item): item is WorkspaceItem => Boolean(item))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const ownerMap = await loadResourceOwnerMap(
    db,
    itemsWithoutOwners.map((item) => item.ownerUserId),
  );
  const items = itemsWithoutOwners.map((item) => ({
    ...item,
    ownerUser: ownerForUserId(ownerMap, item.ownerUserId),
  }));

  return {
    available: true,
    reason: null,
    items,
  };
}

export async function createWorkspace(input: CreateWorkspaceInput) {
  const ctx = await createKubeContext();
  const namespace = ctx.config.workspaceNamespace;

  validateWorkspaceName(input.name);
  const cpu = normalizeCpu(input.cpu);
  const memory = normalizeMemoryGi(input.memoryGi);
  const gpuSpec = normalizeWorkspaceGpuAllocation({
    gpuAllocationMode: input.gpuAllocationMode,
    gpuCount: input.gpuCount,
    gpuMemoryGi: input.gpuMemoryGi,
  });
  const resolution = normalizeResolution(input.resolution);

  await ensureNamespace(ctx.coreApi, namespace);

  const { deployments, allServices, liveNodes } =
    await listWorkspaceResources(ctx);
  const existing = deployments.some(
    (deployment) =>
      workspaceNameFromDeployment(deployment.metadata?.name) === input.name,
  );

  if (existing) {
    throw new Error(`工作区 ${input.name} 已存在。`);
  }

  assertWorkspaceSchedulable({
    configNodes: ctx.nodes,
    liveNodes,
    requestedGpuSpec: gpuSpec,
    workspaceLabelKey: ctx.config.workspaceLabelKey,
    gpuLabelKey: ctx.config.gpuLabelKey,
  });
  const nodePort = resolveWorkspaceNodePort(allServices);
  const image = resolveWorkspaceImage();
  const codexSecret = buildWorkspaceCodexSecret({
    name: input.name,
    namespace,
    ownerUserId: input.ownerUserId,
  });

  if (codexSecret.manifest) {
    await upsertSecret(ctx.coreApi, namespace, codexSecret.manifest);
  }

  try {
    await ctx.appsApi.createNamespacedDeployment({
      namespace,
      body: buildWorkspaceDeployment({
        name: input.name,
        image,
        cpu,
        memory,
        gpuAllocationMode: gpuSpec.gpuAllocationMode,
        gpuCount: gpuSpec.gpuCount,
        gpuMemoryGi: gpuSpec.gpuMemoryGi,
        resolution,
        codexSecretName: codexSecret.name,
        ownerUserId: input.ownerUserId,
      }),
    });

    await ctx.coreApi.createNamespacedService({
      namespace,
      body: buildWorkspaceService({
        name: input.name,
        nodePort,
        ownerUserId: input.ownerUserId,
      }),
    });
  } catch (error) {
    await deleteResource({
      action: () =>
        ctx.appsApi.deleteNamespacedDeployment({
          name: `workspace-${input.name}`,
          namespace,
          propagationPolicy: "Foreground",
        }),
    });
    if (codexSecret.manifest) {
      await deleteResource({
        action: () =>
          ctx.coreApi.deleteNamespacedSecret({
            name: codexSecret.name,
            namespace,
          }),
      });
    }
    throw error;
  }

  const accessHost = controllerAccessHost(ctx.config, ctx.nodes);
  return {
    name: input.name,
    loginUrl: buildLoginUrl({
      nodeIp: accessHost,
      service: buildWorkspaceService({
        name: input.name,
        nodePort,
        ownerUserId: input.ownerUserId,
      }),
    }),
    nodeName: null,
    nodePort,
  };
}

async function deleteResource(options: { action: () => Promise<unknown> }) {
  try {
    await options.action();
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

async function upsertSecret(
  coreApi: CoreV1Api,
  namespace: string,
  body: V1Secret,
) {
  const name = body.metadata?.name;
  if (!name) throw new Error("Secret 缺少 metadata.name");

  try {
    const existing = await coreApi.readNamespacedSecret({ name, namespace });
    await coreApi.replaceNamespacedSecret({
      name,
      namespace,
      body: {
        ...body,
        metadata: {
          ...(body.metadata ?? {}),
          resourceVersion: existing.metadata?.resourceVersion,
        },
      },
    });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await coreApi.createNamespacedSecret({ namespace, body });
  }
}

export async function deleteWorkspace(name: string) {
  validateWorkspaceName(name);

  const ctx = await createKubeContext();
  const namespace = ctx.config.workspaceNamespace;

  await Promise.all([
    deleteResource({
      action: () =>
        ctx.appsApi.deleteNamespacedDeployment({
          name: `workspace-${name}`,
          namespace,
          propagationPolicy: "Foreground",
        }),
    }),
    deleteResource({
      action: () =>
        ctx.coreApi.deleteNamespacedService({
          name: `workspace-${name}-svc`,
          namespace,
        }),
    }),
    deleteResource({
      action: () =>
        ctx.coreApi.deleteNamespacedSecret({
          name: `workspace-${name}-secret`,
          namespace,
        }),
    }),
    deleteResource({
      action: () =>
        ctx.coreApi.deleteNamespacedSecret({
          name: `workspace-${name}-codex`,
          namespace,
        }),
    }),
    deleteResource({
      action: () =>
        ctx.networkingApi.deleteNamespacedIngress({
          name: `workspace-${name}-ing`,
          namespace,
        }),
    }),
  ]);

  return { success: true };
}
