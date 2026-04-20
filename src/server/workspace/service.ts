import "server-only";

import fs from "node:fs";
import path from "node:path";

import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  NetworkingV1Api,
  type V1Deployment,
  type V1Ingress,
  type V1Node,
  type V1Service,
} from "@kubernetes/client-node";

const REMOTE_WORK_DIR = path.join(process.cwd(), "infra", "remote-work");
const CLUSTER_CONFIG_PATH = path.join(
  REMOTE_WORK_DIR,
  "cluster",
  "config.json",
);
const CLUSTER_NODES_PATH = path.join(REMOTE_WORK_DIR, "cluster", "nodes.json");
const RUNTIME_IMAGE_PATH = path.join(
  REMOTE_WORK_DIR,
  "runtime",
  "latest-image.txt",
);

const WORKSPACE_NODE_PORT_START = 32080;
const WORKSPACE_NODE_PORT_END = 32760;

type ClusterConfig = {
  clusterName: string;
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
  gpu: number;
  nodeName: string | null;
  nodeIp: string | null;
  endpoint: string | null;
  loginUrl: string | null;
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
  gpu: number;
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
  return (
    process.env.REMOTE_WORK_KUBECONFIG_PATH ??
    process.env.WORKSPACE_KUBECONFIG ??
    path.join("/etc/kubeasz", "clusters", clusterName, "kubectl.kubeconfig")
  );
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

function buildWorkspaceCapabilityError(kubeconfigPath: string) {
  return `无法访问 Kubernetes 集群。请确认 Ubuntu 服务器上 kubeconfig 可读：${kubeconfigPath}`;
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

function normalizeGpu(input: number) {
  if (!Number.isInteger(input) || input < 0) {
    throw new Error("GPU 必须是大于等于 0 的整数。");
  }

  return input;
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

function countWorkspacesOnNode(deployments: V1Deployment[], nodeName: string) {
  return deployments.filter(
    (deployment) =>
      deployment.metadata?.name?.startsWith("workspace-") &&
      deployment.spec?.template?.spec?.nodeSelector?.[
        "kubernetes.io/hostname"
      ] === nodeName,
  ).length;
}

function selectWorkspaceNode(params: {
  configNodes: ClusterNode[];
  liveNodes: V1Node[];
  deployments: V1Deployment[];
  requestedGpu: number;
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
        workspaceCount: countWorkspacesOnNode(params.deployments, node.name),
        workspaceLabeled:
          live?.metadata?.labels?.[params.workspaceLabelKey] === "true",
        allocatableGpu: live ? allocatableGpuCount(live) : 0,
        gpuCapable: live ? isGpuCapable(node, live, params.gpuLabelKey) : false,
      };
    })
    .filter((entry) => entry.live && entry.ready)
    .filter((entry) =>
      params.requestedGpu > 0
        ? entry.allocatableGpu >= params.requestedGpu
        : true,
    );

  const preferred = candidates.some((entry) => entry.workspaceLabeled)
    ? candidates.filter((entry) => entry.workspaceLabeled)
    : candidates;

  if (preferred.length === 0) {
    throw new Error(
      params.requestedGpu > 0
        ? "没有找到满足 GPU 需求的 Ready worker 节点。"
        : "没有找到可用的 Ready worker 节点。",
    );
  }

  return [...preferred].sort((left, right) => {
    if (left.workspaceCount !== right.workspaceCount) {
      return left.workspaceCount - right.workspaceCount;
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

function resolveWorkspaceNodePort(services: V1Service[]) {
  const usedPorts = collectUsedNodePorts(services);

  for (
    let candidate = WORKSPACE_NODE_PORT_START;
    candidate <= WORKSPACE_NODE_PORT_END;
    candidate += 1
  ) {
    if (!usedPorts.has(candidate)) return candidate;
  }

  throw new Error("无法为远程桌面自动分配 NodePort。");
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

  return `http://${params.nodeIp}:${nodePort}/vnc.html?autoconnect=1&resize=remote`;
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
  const kubeconfigPath = resolveKubeconfigPath(config.clusterName);

  fs.accessSync(kubeconfigPath, fs.constants.R_OK);

  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromFile(kubeconfigPath);

  return {
    config,
    nodes,
    kubeconfigPath,
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

async function listWorkspaceResources(ctx: KubeContext) {
  const namespace = ctx.config.workspaceNamespace;
  if (!(await namespaceExists(ctx.coreApi, namespace))) {
    return {
      deployments: [] as V1Deployment[],
      services: [] as V1Service[],
      ingresses: [] as V1Ingress[],
      liveNodes: [] as V1Node[],
    };
  }

  const [deployments, services, ingresses, liveNodes] = await Promise.all([
    ctx.appsApi.listNamespacedDeployment({ namespace }),
    ctx.coreApi.listNamespacedService({ namespace }),
    ctx.networkingApi.listNamespacedIngress({ namespace }),
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
    liveNodes: liveNodes.items ?? [],
  };
}

function buildWorkspaceDeployment(input: {
  name: string;
  image: string;
  nodeName: string;
  cpu: string;
  memory: string;
  gpu: number;
}) {
  const workspaceRoot =
    process.env.REMOTE_WORKSPACE_ROOT ?? "/var/lib/remote-work/workspaces";

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: `workspace-${input.name}`,
      labels: {
        "app.kubernetes.io/name": "remote-workspace",
        "remote-work/name": input.name,
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
          },
        },
        spec: {
          ...(input.gpu > 0 ? { runtimeClassName: "nvidia" } : {}),
          nodeSelector: {
            "kubernetes.io/hostname": input.nodeName,
          },
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
                  value:
                    process.env.REMOTE_WORKSPACE_RESOLUTION ?? "1920x1080x24",
                },
                { name: "NOVNC_PORT", value: "6080" },
                { name: "VNC_PORT", value: "5901" },
                { name: "VNC_DISABLE_PASSWORD", value: "1" },
              ],
              readinessProbe: {
                httpGet: { path: "/vnc.html", port: 6080 },
                initialDelaySeconds: 10,
                periodSeconds: 10,
              },
              livenessProbe: {
                httpGet: { path: "/vnc.html", port: 6080 },
                initialDelaySeconds: 30,
                periodSeconds: 15,
              },
              resources: {
                requests: {
                  cpu: input.cpu,
                  memory: input.memory,
                  ...(input.gpu > 0
                    ? { "nvidia.com/gpu": `${input.gpu}` }
                    : {}),
                },
                limits: {
                  cpu: input.cpu,
                  memory: input.memory,
                  ...(input.gpu > 0
                    ? { "nvidia.com/gpu": `${input.gpu}` }
                    : {}),
                },
              },
              volumeMounts: [
                { name: "home", mountPath: "/home/worker" },
                { name: "workspace", mountPath: "/workspace" },
              ],
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
              name: "workspace",
              hostPath: {
                path: path.posix.join(workspaceRoot, input.name, "workspace"),
                type: "DirectoryOrCreate",
              },
            },
          ],
        },
      },
    },
  } satisfies V1Deployment;
}

function buildWorkspaceService(input: { name: string; nodePort: number }) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: `workspace-${input.name}-svc`,
      labels: {
        "app.kubernetes.io/name": "remote-workspace",
        "remote-work/name": input.name,
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

  const { deployments, services, ingresses, liveNodes } =
    await listWorkspaceResources(ctx);

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

  const items = deployments
    .map((deployment) => {
      const name = workspaceNameFromDeployment(deployment.metadata?.name);
      if (!name) return null;

      const nodeName =
        deployment.spec?.template?.spec?.nodeSelector?.[
          "kubernetes.io/hostname"
        ] ?? null;
      const liveNode = nodeName ? liveNodeMap.get(nodeName) : undefined;
      const nodeIp = resolveNodeIp(ctx.nodes, liveNode);
      const service = serviceByName.get(name) ?? null;
      const ingress = ingressByName.get(name) ?? null;
      const container = deployment.spec?.template?.spec?.containers?.[0];
      const limits =
        container?.resources?.limits ?? container?.resources?.requests ?? {};
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
        gpu: Number(limits["nvidia.com/gpu"] ?? 0) || 0,
        nodeName,
        nodeIp,
        endpoint:
          ingress?.spec?.rules?.[0]?.host ??
          (service?.spec?.ports?.find((port) => port.nodePort)?.nodePort &&
          nodeIp
            ? `${nodeIp}:${service.spec.ports?.find((port) => port.nodePort)?.nodePort}`
            : null),
        loginUrl: buildLoginUrl({
          ingress,
          service,
          nodeIp,
        }),
        updatedAt: formatTimestamp(updatedSource),
      } satisfies WorkspaceItem;
    })
    .filter((item): item is WorkspaceItem => Boolean(item))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

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
  const gpu = normalizeGpu(input.gpu);

  await ensureNamespace(ctx.coreApi, namespace);

  const { deployments, services, liveNodes } =
    await listWorkspaceResources(ctx);
  const existing = deployments.some(
    (deployment) =>
      workspaceNameFromDeployment(deployment.metadata?.name) === input.name,
  );

  if (existing) {
    throw new Error(`工作区 ${input.name} 已存在。`);
  }

  const selectedNode = selectWorkspaceNode({
    configNodes: ctx.nodes,
    liveNodes,
    deployments,
    requestedGpu: gpu,
    workspaceLabelKey: ctx.config.workspaceLabelKey,
    gpuLabelKey: ctx.config.gpuLabelKey,
  });
  const nodePort = resolveWorkspaceNodePort(services);
  const image = resolveWorkspaceImage();

  await ctx.appsApi.createNamespacedDeployment({
    namespace,
    body: buildWorkspaceDeployment({
      name: input.name,
      image,
      nodeName: selectedNode.node.name,
      cpu,
      memory,
      gpu,
    }),
  });

  try {
    await ctx.coreApi.createNamespacedService({
      namespace,
      body: buildWorkspaceService({
        name: input.name,
        nodePort,
      }),
    });
  } catch (error) {
    await ctx.appsApi.deleteNamespacedDeployment({
      name: `workspace-${input.name}`,
      namespace,
      propagationPolicy: "Foreground",
    });
    throw error;
  }

  const nodeIp = resolveNodeIp(ctx.nodes, selectedNode.live);
  return {
    name: input.name,
    loginUrl: buildLoginUrl({
      nodeIp,
      service: buildWorkspaceService({ name: input.name, nodePort }),
    }),
    nodeName: selectedNode.node.name,
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
        ctx.networkingApi.deleteNamespacedIngress({
          name: `workspace-${name}-ing`,
          namespace,
        }),
    }),
  ]);

  return { success: true };
}
