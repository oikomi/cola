import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  AppsV1Api,
  CoreV1Api,
  type V1Deployment,
  type V1Node,
  type V1Service,
} from "@kubernetes/client-node";

import {
  type GpuAllocationSpec,
  usesGpuAcceleration,
} from "@/lib/gpu-allocation";
import {
  buildHamiGpuResources,
  normalizeGpuAllocation,
  parseGpuAllocationFromResources,
} from "@/server/gpu/hami";
import { db } from "@/server/db";
import {
  createKubeConfig as createSharedKubeConfig,
  resolveKubeconfigPath as resolveSharedKubeconfigPath,
} from "@/server/kubernetes/kubeconfig";
import {
  loadResourceOwnerMap,
  ownerForUserId,
  type ResourceOwner,
} from "@/server/resource-owners";
import { resolveUnslothStudioImage } from "@/server/training/unsloth-studio-images";

const K8S_INFRA_DIR = path.join(process.cwd(), "infra", "k8s");
const CLUSTER_CONFIG_PATH = path.join(K8S_INFRA_DIR, "cluster", "config.json");
const CLUSTER_NODES_PATH = path.join(K8S_INFRA_DIR, "cluster", "nodes.json");
const UNSLOTH_STUDIO_NODE_PORT_START = Number(
  process.env.COLA_UNSLOTH_STUDIO_NODE_PORT_START ?? "32080",
);
const UNSLOTH_STUDIO_NODE_PORT_END = Number(
  process.env.COLA_UNSLOTH_STUDIO_NODE_PORT_END ?? "32179",
);
const UNSLOTH_STUDIO_PORT = Number(
  process.env.COLA_UNSLOTH_STUDIO_PORT ?? "8888",
);
const UNSLOTH_STUDIO_WORKDIR =
  process.env.COLA_UNSLOTH_STUDIO_WORKDIR ?? "/workspace";
const K8S_API_CONNECT_TIMEOUT_MS = Number(
  process.env.COLA_UNSLOTH_STUDIO_K8S_API_CONNECT_TIMEOUT_MS ?? "2500",
);
const OWNER_USER_ID_METADATA_KEY = "cola.dev/owner-user-id";

function ownerMetadata(ownerUserId?: string | null): Record<string, string> {
  return ownerUserId ? { [OWNER_USER_ID_METADATA_KEY]: ownerUserId } : {};
}

type ClusterConfig = {
  clusterName: string;
  workspaceNamespace?: string;
  gpuLabelKey?: string;
};

type ClusterNode = {
  name: string;
  ip: string;
  roles: string[];
};

type UnslothStudioKubeContext = {
  config: ClusterConfig;
  nodes: ClusterNode[];
  namespace: string;
  gpuLabelKey: string;
  kubeconfigPath: string | null;
  apiServer: string | null;
  appsApi: AppsV1Api;
  coreApi: CoreV1Api;
};

type UnslothStudioResources = {
  deployments: V1Deployment[];
  services: V1Service[];
  allServices: V1Service[];
  liveNodes: V1Node[];
};

export type UnslothStudioRuntimeItem = {
  id: string;
  name: string;
  status: "running" | "starting" | "error";
  cpu: string;
  memory: string;
  gpuAllocationMode: GpuAllocationSpec["gpuAllocationMode"];
  gpuCount: number;
  gpuMemoryGi: number | null;
  image: string;
  nodeName: string | null;
  nodeIp: string | null;
  endpoint: string | null;
  studioUrl: string | null;
  ownerUserId: string | null;
  ownerUser: ResourceOwner | null;
  updatedAt: string | null;
};

export type UnslothStudioListResult = {
  available: boolean;
  reason: string | null;
  items: UnslothStudioRuntimeItem[];
};

export type CreateUnslothStudioInput = {
  name: string;
  image: string;
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

function resolveStudioNamespace(config: ClusterConfig) {
  return (
    process.env.COLA_UNSLOTH_STUDIO_K8S_NAMESPACE?.trim() ??
    process.env.COLA_TRAINING_K8S_NAMESPACE?.trim() ??
    config.workspaceNamespace ??
    "default"
  );
}

function resolveKubeconfigPath(clusterName: string) {
  return resolveSharedKubeconfigPath({
    clusterName,
    envVarNames: [
      "COLA_UNSLOTH_STUDIO_KUBECONFIG_PATH",
      "COLA_TRAINING_KUBECONFIG_PATH",
      "REMOTE_WORK_KUBECONFIG_PATH",
      "WORKSPACE_KUBECONFIG",
    ],
  });
}

function resolveRuntimeClassName() {
  const configured =
    process.env.COLA_UNSLOTH_STUDIO_RUNTIME_CLASS_NAME?.trim() ??
    process.env.COLA_TRAINING_RUNTIME_CLASS_NAME?.trim();
  return configured && configured.length > 0 ? configured : "nvidia";
}

function createKubeConfig(clusterName: string) {
  return createSharedKubeConfig({
    clusterName,
    envVarNames: [
      "COLA_UNSLOTH_STUDIO_KUBECONFIG_PATH",
      "COLA_TRAINING_KUBECONFIG_PATH",
      "REMOTE_WORK_KUBECONFIG_PATH",
      "WORKSPACE_KUBECONFIG",
    ],
    warnPrefix: "[unsloth-studio]",
  });
}

async function createKubeContext(): Promise<UnslothStudioKubeContext> {
  const { config, nodes } = readClusterConfig();
  const { kubeConfig, kubeconfigPath } = createKubeConfig(config.clusterName);

  return {
    config,
    nodes,
    kubeconfigPath,
    namespace: resolveStudioNamespace(config),
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

function buildAccessError(ctx: UnslothStudioKubeContext, error: unknown) {
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

function studioNameFromDeployment(name?: string | null) {
  if (!name?.startsWith("unsloth-studio-")) return null;
  return name.slice("unsloth-studio-".length);
}

function validateStudioName(name: string) {
  if (name.length > 48) {
    throw new Error("Unsloth Studio 名称最多 48 个字符。");
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error("Unsloth Studio 名称必须符合 DNS-1123 简单命名规则。");
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

function normalizeStudioGpuAllocation(spec: GpuAllocationSpec) {
  return normalizeGpuAllocation(spec, {
    minGpuCount: spec.gpuAllocationMode === "whole" ? 0 : 1,
  });
}

function deploymentName(name: string) {
  return `unsloth-studio-${name}`;
}

function serviceName(name: string) {
  return `unsloth-studio-${name}-svc`;
}

function studioSelector(name: string) {
  return {
    "app.kubernetes.io/name": "cola-unsloth-studio",
    "app.kubernetes.io/component": "studio",
    "app.kubernetes.io/managed-by": "cola",
    "cola.training/unsloth-studio-name": name,
  };
}

function studioLabel(metadata?: {
  labels?: Record<string, string> | null;
  name?: string | null;
}) {
  return (
    metadata?.labels?.["cola.training/unsloth-studio-name"] ??
    studioNameFromDeployment(metadata?.name)
  );
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

function countStudiosOnNode(deployments: V1Deployment[], nodeName: string) {
  return deployments.filter(
    (deployment) =>
      deployment.metadata?.name?.startsWith("unsloth-studio-") &&
      deployment.spec?.template?.spec?.nodeSelector?.[
        "kubernetes.io/hostname"
      ] === nodeName,
  ).length;
}

function selectStudioNode(params: {
  configNodes: ClusterNode[];
  liveNodes: V1Node[];
  deployments: V1Deployment[];
  requestedGpuSpec: GpuAllocationSpec;
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
        studioCount: countStudiosOnNode(params.deployments, node.name),
        isMaster: node.roles.includes("master"),
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

  const nonMaster = candidates.filter((entry) => !entry.isMaster);
  const preferred = nonMaster.length > 0 ? nonMaster : candidates;

  if (preferred.length === 0) {
    throw new Error(
      usesGpuAcceleration(params.requestedGpuSpec)
        ? "没有找到满足 GPU 需求的 Ready worker 节点。"
        : "没有找到可用的 Ready worker 节点。",
    );
  }

  return [...preferred].sort((left, right) => {
    if (left.studioCount !== right.studioCount) {
      return left.studioCount - right.studioCount;
    }

    return left.node.name.localeCompare(right.node.name, "en");
  })[0]!;
}

function collectUsedNodePorts(services: V1Service[]) {
  const ports = new Set<number>();

  for (const service of services) {
    for (const port of service.spec?.ports ?? []) {
      if (typeof port.nodePort === "number") {
        ports.add(port.nodePort);
      }
    }
  }

  return ports;
}

function resolveStudioNodePort(services: V1Service[]) {
  const usedPorts = collectUsedNodePorts(services);

  for (
    let candidate = UNSLOTH_STUDIO_NODE_PORT_START;
    candidate <= UNSLOTH_STUDIO_NODE_PORT_END;
    candidate += 1
  ) {
    if (!usedPorts.has(candidate)) return candidate;
  }

  throw new Error("无法为 Unsloth Studio 自动分配 NodePort。");
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

function buildStudioUrl(params: {
  service?: V1Service | null;
  nodeIp?: string | null;
  token?: string | null;
}) {
  const nodePort = params.service?.spec?.ports?.find(
    (port) => port.port === UNSLOTH_STUDIO_PORT || port.name === "http",
  )?.nodePort;

  if (!params.nodeIp || typeof nodePort !== "number") return null;

  const token = params.token
    ? `?token=${encodeURIComponent(params.token)}`
    : "";
  return `http://${params.nodeIp}:${nodePort}/${token}`;
}

function buildEndpoint(params: {
  service?: V1Service | null;
  nodeIp?: string | null;
}) {
  const nodePort = params.service?.spec?.ports?.find(
    (port) => port.port === UNSLOTH_STUDIO_PORT || port.name === "http",
  )?.nodePort;

  if (!params.nodeIp || typeof nodePort !== "number") return null;
  return `${params.nodeIp}:${nodePort}`;
}

function resolveWorkVolume() {
  const pvcName =
    process.env.COLA_UNSLOTH_STUDIO_PVC_NAME?.trim() ??
    process.env.COLA_TRAINING_PVC_NAME?.trim();

  if (pvcName) {
    return {
      volume: {
        name: "unsloth-studio-workdir",
        persistentVolumeClaim: {
          claimName: pvcName,
        },
      },
      mountPath:
        process.env.COLA_UNSLOTH_STUDIO_PVC_MOUNT_PATH?.trim() ??
        process.env.COLA_TRAINING_PVC_MOUNT_PATH?.trim() ??
        UNSLOTH_STUDIO_WORKDIR,
    };
  }

  return {
    volume: {
      name: "unsloth-studio-workdir",
      emptyDir: {},
    },
    mountPath: UNSLOTH_STUDIO_WORKDIR,
  };
}

function buildStudioCommand(workdir: string) {
  const command =
    process.env.COLA_UNSLOTH_STUDIO_COMMAND?.trim() ??
    `unsloth studio -H 0.0.0.0 -p ${UNSLOTH_STUDIO_PORT}`;

  return [
    "set -eu",
    `mkdir -p ${JSON.stringify(workdir)}`,
    `cd ${JSON.stringify(workdir)}`,
    'export UNSLOTH_STUDIO_TOKEN="${UNSLOTH_STUDIO_TOKEN}"',
    `exec ${command}`,
  ].join("\n");
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

async function listAllServicesWithFallback(ctx: UnslothStudioKubeContext) {
  try {
    const services = await ctx.coreApi.listServiceForAllNamespaces();
    return services.items ?? [];
  } catch {
    const namespaceServices = await ctx.coreApi.listNamespacedService({
      namespace: ctx.namespace,
    });
    return namespaceServices.items ?? [];
  }
}

async function listStudioResources(
  ctx: UnslothStudioKubeContext,
): Promise<UnslothStudioResources> {
  if (!(await namespaceExists(ctx.coreApi, ctx.namespace))) {
    return {
      deployments: [],
      services: [],
      allServices: [],
      liveNodes: [],
    };
  }

  const [deployments, services, allServices, liveNodes] = await Promise.all([
    ctx.appsApi.listNamespacedDeployment({ namespace: ctx.namespace }),
    ctx.coreApi.listNamespacedService({ namespace: ctx.namespace }),
    listAllServicesWithFallback(ctx),
    ctx.coreApi.listNode(),
  ]);

  return {
    deployments: (deployments.items ?? []).filter(
      (deployment) =>
        deployment.metadata?.labels?.["app.kubernetes.io/name"] ===
          "cola-unsloth-studio" ||
        deployment.metadata?.name?.startsWith("unsloth-studio-"),
    ),
    services: (services.items ?? []).filter(
      (service) =>
        service.metadata?.labels?.["app.kubernetes.io/name"] ===
          "cola-unsloth-studio" ||
        service.metadata?.name?.startsWith("unsloth-studio-"),
    ),
    allServices,
    liveNodes: liveNodes.items ?? [],
  };
}

function buildStudioDeployment(input: {
  name: string;
  image: string;
  token: string;
  nodeName: string;
  cpu: string;
  memory: string;
  gpuAllocationMode: GpuAllocationSpec["gpuAllocationMode"];
  gpuCount: number;
  gpuMemoryGi: number | null;
  ownerUserId?: string;
}) {
  const labels = studioSelector(input.name);
  const ownerLabels = ownerMetadata(input.ownerUserId);
  const gpuSpec = {
    gpuAllocationMode: input.gpuAllocationMode,
    gpuCount: input.gpuCount,
    gpuMemoryGi: input.gpuMemoryGi,
  } satisfies GpuAllocationSpec;
  const gpuResources = buildHamiGpuResources(gpuSpec);
  const { volume, mountPath } = resolveWorkVolume();
  const runtimeClassName = resolveRuntimeClassName();

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: deploymentName(input.name),
      labels: { ...labels, ...ownerLabels },
      annotations: {
        ...ownerLabels,
        "cola.training/title": input.name,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          "cola.training/unsloth-studio-name": input.name,
        },
      },
      template: {
        metadata: {
          labels: { ...labels, ...ownerLabels },
          annotations: {
            ...ownerLabels,
          },
        },
        spec: {
          ...(usesGpuAcceleration(gpuSpec) && runtimeClassName
            ? { runtimeClassName }
            : {}),
          nodeSelector: {
            "kubernetes.io/hostname": input.nodeName,
          },
          containers: [
            {
              name: "unsloth-studio",
              image: input.image,
              imagePullPolicy:
                process.env.COLA_UNSLOTH_STUDIO_IMAGE_PULL_POLICY ??
                "IfNotPresent",
              workingDir: mountPath,
              command: ["bash", "-lc"],
              args: [buildStudioCommand(mountPath)],
              ports: [{ containerPort: UNSLOTH_STUDIO_PORT, name: "http" }],
              env: [
                {
                  name: "TZ",
                  value: process.env.COLA_TRAINING_TZ ?? "Asia/Shanghai",
                },
                { name: "UNSLOTH_STUDIO_TOKEN", value: input.token },
                { name: "COLA_UNSLOTH_STUDIO_NAME", value: input.name },
                { name: "COLA_UNSLOTH_STUDIO_WORKDIR", value: mountPath },
              ],
              readinessProbe: {
                httpGet: { path: "/", port: UNSLOTH_STUDIO_PORT },
                initialDelaySeconds: 12,
                periodSeconds: 10,
              },
              livenessProbe: {
                httpGet: { path: "/", port: UNSLOTH_STUDIO_PORT },
                initialDelaySeconds: 45,
                periodSeconds: 20,
              },
              volumeMounts: [
                {
                  name: volume.name,
                  mountPath,
                },
              ],
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
            },
          ],
          volumes: [volume],
        },
      },
    },
  } satisfies V1Deployment;
}

function buildStudioService(input: {
  name: string;
  nodePort: number;
  ownerUserId?: string;
}) {
  const ownerLabels = ownerMetadata(input.ownerUserId);

  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: serviceName(input.name),
      labels: { ...studioSelector(input.name), ...ownerLabels },
      annotations: {
        ...ownerLabels,
      },
    },
    spec: {
      type: "NodePort",
      selector: {
        "cola.training/unsloth-studio-name": input.name,
      },
      ports: [
        {
          name: "http",
          port: UNSLOTH_STUDIO_PORT,
          targetPort: UNSLOTH_STUDIO_PORT,
          nodePort: input.nodePort,
        },
      ],
    },
  } satisfies V1Service;
}

export async function listUnslothStudioRuntimes(): Promise<UnslothStudioListResult> {
  let ctx: UnslothStudioKubeContext;

  try {
    ctx = await createKubeContext();
  } catch (error) {
    const { config } = readClusterConfig();
    const kubeconfigPath = safeResolveKubeconfigPath(config.clusterName);

    return {
      available: false,
      reason:
        error instanceof Error
          ? `${buildCapabilityError(kubeconfigPath)}。${error.message}`
          : buildCapabilityError(kubeconfigPath),
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

  let resources: UnslothStudioResources;
  try {
    resources = await listStudioResources(ctx);
  } catch (error) {
    return {
      available: false,
      reason: buildAccessError(ctx, error),
      items: [],
    };
  }

  const serviceByName = new Map(
    resources.services
      .map((service) => [studioLabel(service.metadata), service] as const)
      .filter((entry): entry is readonly [string, V1Service] =>
        Boolean(entry[0]),
      ),
  );
  const liveNodeMap = new Map(
    resources.liveNodes
      .map((node) => [node.metadata?.name, node] as const)
      .filter((entry): entry is readonly [string, V1Node] => Boolean(entry[0])),
  );

  const itemsWithoutOwners: UnslothStudioRuntimeItem[] = resources.deployments
    .map<UnslothStudioRuntimeItem | null>((deployment) => {
      const name = studioLabel(deployment.metadata);
      if (!name) return null;

      const nodeName =
        deployment.spec?.template?.spec?.nodeSelector?.[
          "kubernetes.io/hostname"
        ] ?? null;
      const liveNode = nodeName ? liveNodeMap.get(nodeName) : undefined;
      const nodeIp = resolveNodeIp(ctx.nodes, liveNode);
      const service = serviceByName.get(name) ?? null;
      const container = deployment.spec?.template?.spec?.containers?.[0];
      const limits =
        container?.resources?.limits ?? container?.resources?.requests ?? {};
      const gpuAllocation = parseGpuAllocationFromResources(
        limits as Record<string, string | number | null | undefined>,
      );
      const token =
        container?.env?.find((entry) => entry.name === "UNSLOTH_STUDIO_TOKEN")
          ?.value ?? null;
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
        status: deploymentStatus(deployment),
        cpu: String(limits.cpu ?? container?.resources?.requests?.cpu ?? "0"),
        memory: String(
          limits.memory ?? container?.resources?.requests?.memory ?? "0Gi",
        ),
        gpuAllocationMode: gpuAllocation.gpuAllocationMode,
        gpuCount: gpuAllocation.gpuCount,
        gpuMemoryGi: gpuAllocation.gpuMemoryGi,
        image: container?.image ?? resolveUnslothStudioImage(null),
        nodeName,
        nodeIp,
        endpoint: buildEndpoint({ service, nodeIp }),
        studioUrl: buildStudioUrl({ service, nodeIp, token }),
        ownerUserId:
          deployment.metadata?.annotations?.[OWNER_USER_ID_METADATA_KEY] ??
          deployment.metadata?.labels?.[OWNER_USER_ID_METADATA_KEY] ??
          null,
        ownerUser: null,
        updatedAt: formatTimestamp(updatedSource),
      } satisfies UnslothStudioRuntimeItem;
    })
    .filter((item): item is UnslothStudioRuntimeItem => Boolean(item))
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

export async function createUnslothStudioRuntime(
  input: CreateUnslothStudioInput,
) {
  const ctx = await createKubeContext();
  const name = input.name.trim().toLowerCase();
  validateStudioName(name);
  const cpu = normalizeCpu(input.cpu);
  const memory = normalizeMemoryGi(input.memoryGi);
  const gpuSpec = normalizeStudioGpuAllocation({
    gpuAllocationMode: input.gpuAllocationMode,
    gpuCount: input.gpuCount,
    gpuMemoryGi: input.gpuMemoryGi,
  });

  await ensureNamespace(ctx.coreApi, ctx.namespace);

  const resources = await listStudioResources(ctx);
  const existing = resources.deployments.some(
    (deployment) => studioLabel(deployment.metadata) === name,
  );

  if (existing) {
    throw new Error(`Unsloth Studio ${name} 已存在。`);
  }

  const selectedNode = selectStudioNode({
    configNodes: ctx.nodes,
    liveNodes: resources.liveNodes,
    deployments: resources.deployments,
    requestedGpuSpec: gpuSpec,
    gpuLabelKey: ctx.gpuLabelKey,
  });
  const nodePort = resolveStudioNodePort(resources.allServices);
  const image = resolveUnslothStudioImage(input.image);
  const token = crypto.randomBytes(18).toString("hex");
  const deployment = buildStudioDeployment({
    name,
    image,
    token,
    nodeName: selectedNode.node.name,
    cpu,
    memory,
    gpuAllocationMode: gpuSpec.gpuAllocationMode,
    gpuCount: gpuSpec.gpuCount,
    gpuMemoryGi: gpuSpec.gpuMemoryGi,
    ownerUserId: input.ownerUserId,
  });
  const service = buildStudioService({
    name,
    nodePort,
    ownerUserId: input.ownerUserId,
  });

  await ctx.appsApi.createNamespacedDeployment({
    namespace: ctx.namespace,
    body: deployment,
  });

  try {
    await ctx.coreApi.createNamespacedService({
      namespace: ctx.namespace,
      body: service,
    });
  } catch (error) {
    await ctx.appsApi.deleteNamespacedDeployment({
      namespace: ctx.namespace,
      name: deploymentName(name),
      propagationPolicy: "Foreground",
    });
    throw error;
  }

  const nodeIp = resolveNodeIp(ctx.nodes, selectedNode.live);
  return {
    name,
    namespace: ctx.namespace,
    nodeName: selectedNode.node.name,
    nodePort,
    studioUrl: buildStudioUrl({ service, nodeIp, token }),
    message: `Unsloth Studio 已提交到 Kubernetes：${ctx.namespace}/${deploymentName(name)}`,
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

export async function deleteUnslothStudioRuntime(name: string) {
  const normalizedName = name.trim().toLowerCase();
  validateStudioName(normalizedName);

  const ctx = await createKubeContext();

  await Promise.all([
    deleteResource({
      action: () =>
        ctx.appsApi.deleteNamespacedDeployment({
          name: deploymentName(normalizedName),
          namespace: ctx.namespace,
          propagationPolicy: "Foreground",
        }),
    }),
    deleteResource({
      action: () =>
        ctx.coreApi.deleteNamespacedService({
          name: serviceName(normalizedName),
          namespace: ctx.namespace,
        }),
    }),
  ]);

  return {
    name: normalizedName,
    message: `Unsloth Studio ${normalizedName} 已删除。`,
  };
}
