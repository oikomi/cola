import "server-only";

import fs from "node:fs";
import path from "node:path";

import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  type V1Deployment,
  type V1Node,
  type V1Pod,
  type V1Service,
} from "@kubernetes/client-node";

import {
  defaultInferenceImage,
  type InferenceDeploymentEngine,
  type InferenceDeploymentStatus,
  inferenceDeploymentEngineValues,
} from "@/server/deployments/catalog";

const REMOTE_WORK_DIR = path.join(process.cwd(), "infra", "remote-work");
const CLUSTER_CONFIG_PATH = path.join(
  REMOTE_WORK_DIR,
  "cluster",
  "config.json",
);
const CLUSTER_NODES_PATH = path.join(REMOTE_WORK_DIR, "cluster", "nodes.json");

const INFERENCE_DEPLOYMENT_PREFIX = "inference-";
const INFERENCE_SERVICE_SUFFIX = "-svc";
const INFERENCE_NODE_PORT_START = 32300;
const INFERENCE_NODE_PORT_END = 32760;
const METADATA_PREFIX = "cola.dev";
const MODEL_CACHE_ROOT =
  process.env.INFERENCE_MODEL_CACHE_ROOT ??
  "/var/lib/remote-work/inference-cache";
const MODEL_ROOT =
  process.env.INFERENCE_MODEL_ROOT ?? "/var/lib/remote-work/models";

const INFERENCE_METADATA = {
  engine: `${METADATA_PREFIX}/inference-engine`,
  modelRef: `${METADATA_PREFIX}/inference-model-ref`,
  desiredReplicas: `${METADATA_PREFIX}/inference-desired-replicas`,
  lastStartedAt: `${METADATA_PREFIX}/inference-last-started-at`,
} as const;

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
  namespace: string;
  appsApi: AppsV1Api;
  coreApi: CoreV1Api;
};

export type InferenceDeploymentItem = {
  id: string;
  name: string;
  engine: InferenceDeploymentEngine;
  status: InferenceDeploymentStatus;
  modelRef: string;
  image: string;
  cpu: string;
  memory: string;
  gpuCount: number;
  desiredReplicas: number;
  readyReplicas: number;
  nodeNames: string[];
  endpoint: string | null;
  nodePort: number | null;
  updatedAt: string | null;
};

export type InferenceDeploymentListResult = {
  available: boolean;
  reason: string | null;
  items: InferenceDeploymentItem[];
};

export type CreateInferenceDeploymentInput = {
  name: string;
  engine: InferenceDeploymentEngine;
  modelRef: string;
  image: string;
  cpu: string;
  memoryGi: number;
  gpuCount: number;
  replicaCount: number;
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

function buildInferenceCapabilityError(kubeconfigPath: string) {
  return `无法访问 Kubernetes 集群。请确认 master 节点上的 kubeconfig 可读：${kubeconfigPath}`;
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

function inferenceDeploymentName(name: string) {
  return `${INFERENCE_DEPLOYMENT_PREFIX}${name}`;
}

function inferenceServiceName(name: string) {
  return `${INFERENCE_DEPLOYMENT_PREFIX}${name}${INFERENCE_SERVICE_SUFFIX}`;
}

function inferenceNameFromResource(name?: string | null) {
  if (!name?.startsWith(INFERENCE_DEPLOYMENT_PREFIX)) return null;

  const trimmed = name.slice(INFERENCE_DEPLOYMENT_PREFIX.length);
  return trimmed.endsWith(INFERENCE_SERVICE_SUFFIX)
    ? trimmed.slice(0, -INFERENCE_SERVICE_SUFFIX.length)
    : trimmed;
}

function validateInferenceName(name: string) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error("部署名称必须符合 DNS-1123 简单命名规则。");
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

function normalizeGpuCount(
  engine: InferenceDeploymentEngine,
  gpuCount: number,
) {
  if (!Number.isInteger(gpuCount) || gpuCount < 0 || gpuCount > 16) {
    throw new Error("GPU 数量必须是 0 到 16 之间的整数。");
  }

  if ((engine === "vllm" || engine === "sglang") && gpuCount < 1) {
    throw new Error(`${engine} 至少需要 1 张 GPU。`);
  }

  return gpuCount;
}

function normalizeReplicaCount(replicaCount: number) {
  if (!Number.isInteger(replicaCount) || replicaCount <= 0 || replicaCount > 16) {
    throw new Error("副本数必须是 1 到 16 之间的整数。");
  }

  return replicaCount;
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

function countInferenceDeploymentsOnNode(
  deployments: V1Deployment[],
  nodeName: string,
) {
  return deployments.filter((deployment) => {
    const affinity =
      deployment.spec?.template?.spec?.affinity?.nodeAffinity
        ?.requiredDuringSchedulingIgnoredDuringExecution;

    const hostnames =
      affinity?.nodeSelectorTerms
        ?.flatMap((term) => term.matchExpressions ?? [])
        .filter((expression) => expression.key === "kubernetes.io/hostname")
        .flatMap((expression) => expression.values ?? []) ?? [];

    return hostnames.includes(nodeName);
  }).length;
}

function selectEligibleInferenceNodes(params: {
  configNodes: ClusterNode[];
  liveNodes: V1Node[];
  deployments: V1Deployment[];
  requestedGpu: number;
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
        allocatableGpu: live ? allocatableGpuCount(live) : 0,
        gpuCapable: live
          ? isGpuCapable(node, live, params.gpuLabelKey)
          : false,
        workloadCount: countInferenceDeploymentsOnNode(
          params.deployments,
          node.name,
        ),
      };
    })
    .filter((entry) => entry.live && entry.ready)
    .filter((entry) =>
      params.requestedGpu > 0
        ? entry.gpuCapable && entry.allocatableGpu >= params.requestedGpu
        : true,
    );

  const nonMaster = candidates.filter((entry) => !entry.isMaster);
  const preferred = nonMaster.length > 0 ? nonMaster : candidates;

  if (preferred.length === 0) {
    throw new Error(
      params.requestedGpu > 0
        ? "没有找到满足 GPU 需求的 Ready worker 节点。"
        : "没有找到可用的 Ready worker 节点。",
    );
  }

  return [...preferred]
    .sort((left, right) => {
      if (left.workloadCount !== right.workloadCount) {
        return left.workloadCount - right.workloadCount;
      }

      return left.node.name.localeCompare(right.node.name, "en");
    })
    .map((entry) => entry.node.name);
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

function resolveInferenceNodePort(services: V1Service[]) {
  const usedPorts = collectUsedNodePorts(services);

  for (
    let candidate = INFERENCE_NODE_PORT_START;
    candidate <= INFERENCE_NODE_PORT_END;
    candidate += 1
  ) {
    if (!usedPorts.has(candidate)) return candidate;
  }

  throw new Error("无法为推理部署自动分配 NodePort。");
}

function resolveControllerAccessHost(config: ClusterConfig, nodes: ClusterNode[]) {
  if (config.controllerIp) return config.controllerIp;

  return nodes.find((node) => node.roles.includes("master"))?.ip ?? null;
}

function buildEndpoint(options: {
  controllerAccessHost: string | null;
  service?: V1Service | null;
}) {
  const nodePort = options.service?.spec?.ports?.find(
    (port) => port.name === "http" || port.port === 8000,
  )?.nodePort;

  if (!options.controllerAccessHost || typeof nodePort !== "number") {
    return null;
  }

  return `http://${options.controllerAccessHost}:${nodePort}`;
}

function deploymentLabels(name: string, engine: InferenceDeploymentEngine) {
  return {
    "app.kubernetes.io/name": "cola-inference",
    "app.kubernetes.io/component": "runtime",
    "cola.dev/inference-name": name,
    "cola.dev/inference-engine": engine,
  };
}

function deploymentAnnotations(input: {
  engine: InferenceDeploymentEngine;
  modelRef: string;
  desiredReplicas: number;
  lastStartedAt?: string;
}) {
  return {
    [INFERENCE_METADATA.engine]: input.engine,
    [INFERENCE_METADATA.modelRef]: input.modelRef,
    [INFERENCE_METADATA.desiredReplicas]: String(input.desiredReplicas),
    ...(input.lastStartedAt
      ? { [INFERENCE_METADATA.lastStartedAt]: input.lastStartedAt }
      : {}),
  };
}

function resolveLlamaModelPath(modelRef: string) {
  return modelRef.startsWith("/") ? modelRef : path.posix.join("/models", modelRef);
}

function buildRuntimeCommand(input: {
  name: string;
  engine: InferenceDeploymentEngine;
  modelRef: string;
  gpuCount: number;
}) {
  switch (input.engine) {
    case "vllm":
      return {
        args: [
          "--model",
          input.modelRef,
          "--served-model-name",
          input.name,
          "--host",
          "0.0.0.0",
          "--port",
          "8000",
          "--tensor-parallel-size",
          String(Math.max(input.gpuCount, 1)),
        ],
      };
    case "llama.cpp":
      return {
        args: [
          "-m",
          resolveLlamaModelPath(input.modelRef),
          "--host",
          "0.0.0.0",
          "--port",
          "8000",
          "-c",
          process.env.LLAMA_CPP_CONTEXT_SIZE ?? "4096",
          ...(input.gpuCount > 0
            ? ["-ngl", process.env.LLAMA_CPP_GPU_LAYERS ?? "999"]
            : []),
        ],
      };
    case "sglang":
      return {
        command: ["python3", "-m", "sglang.launch_server"],
        args: [
          "--model-path",
          input.modelRef,
          "--host",
          "0.0.0.0",
          "--port",
          "8000",
          "--tp-size",
          String(Math.max(input.gpuCount, 1)),
        ],
      };
    default:
      return {
        args: [],
      };
  }
}

function buildInferenceDeployment(input: {
  name: string;
  engine: InferenceDeploymentEngine;
  modelRef: string;
  image: string;
  cpu: string;
  memory: string;
  gpuCount: number;
  replicaCount: number;
  eligibleNodeNames: string[];
}) {
  const runtimeCommand = buildRuntimeCommand({
    name: input.name,
    engine: input.engine,
    modelRef: input.modelRef,
    gpuCount: input.gpuCount,
  });

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: inferenceDeploymentName(input.name),
      labels: deploymentLabels(input.name, input.engine),
      annotations: deploymentAnnotations({
        engine: input.engine,
        modelRef: input.modelRef,
        desiredReplicas: input.replicaCount,
      }),
    },
    spec: {
      replicas: 0,
      selector: {
        matchLabels: {
          "cola.dev/inference-name": input.name,
        },
      },
      template: {
        metadata: {
          labels: deploymentLabels(input.name, input.engine),
        },
        spec: {
          ...(input.gpuCount > 0 ? { runtimeClassName: "nvidia" } : {}),
          affinity: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  {
                    matchExpressions: [
                      {
                        key: "kubernetes.io/hostname",
                        operator: "In",
                        values: input.eligibleNodeNames,
                      },
                    ],
                  },
                ],
              },
            },
          },
          topologySpreadConstraints: [
            {
              maxSkew: 1,
              topologyKey: "kubernetes.io/hostname",
              whenUnsatisfiable: "ScheduleAnyway",
              labelSelector: {
                matchLabels: {
                  "cola.dev/inference-name": input.name,
                },
              },
            },
          ],
          containers: [
            {
              name: "server",
              image: input.image,
              imagePullPolicy: "IfNotPresent",
              ...(runtimeCommand.command
                ? { command: runtimeCommand.command }
                : {}),
              args: runtimeCommand.args,
              ports: [{ containerPort: 8000, name: "http" }],
              env: [
                {
                  name: "TZ",
                  value: process.env.INFERENCE_TZ ?? "Asia/Shanghai",
                },
                {
                  name: "HF_HOME",
                  value: "/root/.cache/huggingface",
                },
                {
                  name: "TRANSFORMERS_CACHE",
                  value: "/root/.cache/huggingface",
                },
              ],
              readinessProbe: {
                tcpSocket: { port: 8000 },
                initialDelaySeconds: 15,
                periodSeconds: 10,
              },
              livenessProbe: {
                tcpSocket: { port: 8000 },
                initialDelaySeconds: 45,
                periodSeconds: 20,
              },
              resources: {
                requests: {
                  cpu: input.cpu,
                  memory: input.memory,
                  ...(input.gpuCount > 0
                    ? { "nvidia.com/gpu": `${input.gpuCount}` }
                    : {}),
                },
                limits: {
                  cpu: input.cpu,
                  memory: input.memory,
                  ...(input.gpuCount > 0
                    ? { "nvidia.com/gpu": `${input.gpuCount}` }
                    : {}),
                },
              },
              volumeMounts: [
                {
                  name: "hf-cache",
                  mountPath: "/root/.cache/huggingface",
                },
                {
                  name: "models",
                  mountPath: "/models",
                },
                {
                  name: "dev-shm",
                  mountPath: "/dev/shm",
                },
              ],
            },
          ],
          volumes: [
            {
              name: "hf-cache",
              hostPath: {
                path: path.posix.join(MODEL_CACHE_ROOT, input.name),
                type: "DirectoryOrCreate",
              },
            },
            {
              name: "models",
              hostPath: {
                path: MODEL_ROOT,
                type: "DirectoryOrCreate",
              },
            },
            {
              name: "dev-shm",
              emptyDir: {
                medium: "Memory",
              },
            },
          ],
        },
      },
    },
  } satisfies V1Deployment;
}

function buildInferenceService(input: { name: string; nodePort: number }) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: inferenceServiceName(input.name),
      labels: {
        "app.kubernetes.io/name": "cola-inference",
        "app.kubernetes.io/component": "runtime",
        "cola.dev/inference-name": input.name,
      },
    },
    spec: {
      type: "NodePort",
      selector: {
        "cola.dev/inference-name": input.name,
      },
      ports: [
        {
          name: "http",
          port: 8000,
          targetPort: 8000,
          nodePort: input.nodePort,
        },
      ],
    },
  } satisfies V1Service;
}

function inferenceStatus(deployment: V1Deployment): InferenceDeploymentStatus {
  const desiredReplicas = deployment.spec?.replicas ?? 0;
  const readyReplicas = deployment.status?.readyReplicas ?? 0;
  const conditions = deployment.status?.conditions ?? [];
  const failed = conditions.some(
    (condition) =>
      condition.type === "ReplicaFailure" ||
      (condition.type === "Progressing" && condition.status === "False"),
  );

  if (failed) return "failed";
  if (desiredReplicas === 0) {
    return deployment.metadata?.annotations?.[INFERENCE_METADATA.lastStartedAt]
      ? "paused"
      : "draft";
  }

  if (readyReplicas >= desiredReplicas) return "serving";
  return "starting";
}

function latestTimestamp(
  values: Array<string | Date | null | undefined>,
): string | Date | null {
  const normalized = values
    .filter((value): value is string | Date => Boolean(value))
    .map((value) => ({
      raw: value,
      time: new Date(value).valueOf(),
    }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((left, right) => left.time - right.time);

  return normalized.at(-1)?.raw ?? null;
}

async function createKubeContext(): Promise<KubeContext> {
  const { config, nodes } = readClusterConfig();
  const kubeconfigPath = resolveKubeconfigPath(config.clusterName);
  const namespace =
    process.env.INFERENCE_DEPLOYMENT_NAMESPACE ?? config.workspaceNamespace;

  fs.accessSync(kubeconfigPath, fs.constants.R_OK);

  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromFile(kubeconfigPath);

  return {
    config,
    nodes,
    kubeconfigPath,
    namespace,
    appsApi: kubeConfig.makeApiClient(AppsV1Api),
    coreApi: kubeConfig.makeApiClient(CoreV1Api),
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

async function listInferenceResources(ctx: KubeContext) {
  if (!(await namespaceExists(ctx.coreApi, ctx.namespace))) {
    return {
      deployments: [] as V1Deployment[],
      services: [] as V1Service[],
      pods: [] as V1Pod[],
      liveNodes: [] as V1Node[],
    };
  }

  const [deployments, services, pods, liveNodes] = await Promise.all([
    ctx.appsApi.listNamespacedDeployment({ namespace: ctx.namespace }),
    ctx.coreApi.listNamespacedService({ namespace: ctx.namespace }),
    ctx.coreApi.listNamespacedPod({ namespace: ctx.namespace }),
    ctx.coreApi.listNode(),
  ]);

  return {
    deployments: (deployments.items ?? []).filter((deployment) =>
      deployment.metadata?.name?.startsWith(INFERENCE_DEPLOYMENT_PREFIX),
    ),
    services: (services.items ?? []).filter((service) =>
      service.metadata?.name?.startsWith(INFERENCE_DEPLOYMENT_PREFIX),
    ),
    pods: (pods.items ?? []).filter((pod) =>
      pod.metadata?.labels?.["app.kubernetes.io/name"] === "cola-inference",
    ),
    liveNodes: liveNodes.items ?? [],
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

export async function listInferenceDeployments(): Promise<InferenceDeploymentListResult> {
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
          ? `${buildInferenceCapabilityError(kubeconfigPath)}。${error.message}`
          : buildInferenceCapabilityError(kubeconfigPath),
      items: [],
    };
  }

  const { deployments, services, pods } = await listInferenceResources(ctx);
  const controllerAccessHost = resolveControllerAccessHost(ctx.config, ctx.nodes);

  const serviceByName = new Map(
    services
      .map((service) => [inferenceNameFromResource(service.metadata?.name), service] as const)
      .filter((entry): entry is readonly [string, V1Service] => Boolean(entry[0])),
  );

  const podNodesByName = new Map<string, Set<string>>();
  for (const pod of pods) {
    const name = pod.metadata?.labels?.["cola.dev/inference-name"];
    if (!name) continue;

    if (!podNodesByName.has(name)) {
      podNodesByName.set(name, new Set<string>());
    }

    if (pod.spec?.nodeName) {
      podNodesByName.get(name)?.add(pod.spec.nodeName);
    }
  }

  const items = deployments
    .map((deployment) => {
      const name = inferenceNameFromResource(deployment.metadata?.name);
      if (!name) return null;

      const service = serviceByName.get(name) ?? null;
      const container = deployment.spec?.template?.spec?.containers?.[0];
      const limits =
        container?.resources?.limits ?? container?.resources?.requests ?? {};
      const desiredReplicas = Number.parseInt(
        deployment.metadata?.annotations?.[INFERENCE_METADATA.desiredReplicas] ??
          String(deployment.spec?.replicas ?? 0),
        10,
      );
      const engine =
        (deployment.metadata?.annotations?.[
          INFERENCE_METADATA.engine
        ] as InferenceDeploymentEngine | undefined) ?? "vllm";
      const updatedSource = latestTimestamp([
        ...((deployment.status?.conditions ?? []).map(
          (condition) => condition.lastTransitionTime,
        ) as Array<string | Date | null | undefined>),
        deployment.metadata?.creationTimestamp,
      ]);

      return {
        id: name,
        name,
        engine: inferenceDeploymentEngineValues.includes(engine)
          ? engine
          : "vllm",
        status: inferenceStatus(deployment),
        modelRef:
          deployment.metadata?.annotations?.[INFERENCE_METADATA.modelRef] ??
          name,
        image:
          container?.image ??
          defaultInferenceImage(engine, Number(limits["nvidia.com/gpu"] ?? 0)),
        cpu: String(limits.cpu ?? container?.resources?.requests?.cpu ?? "0"),
        memory: String(
          limits.memory ?? container?.resources?.requests?.memory ?? "0Gi",
        ),
        gpuCount: Number(limits["nvidia.com/gpu"] ?? 0) || 0,
        desiredReplicas: Number.isFinite(desiredReplicas) ? desiredReplicas : 0,
        readyReplicas: deployment.status?.readyReplicas ?? 0,
        nodeNames: [...(podNodesByName.get(name) ?? new Set<string>())].sort(),
        endpoint: buildEndpoint({
          controllerAccessHost,
          service,
        }),
        nodePort:
          service?.spec?.ports?.find(
            (port) => port.name === "http" || port.port === 8000,
          )?.nodePort ?? null,
        updatedAt: formatTimestamp(updatedSource),
      } satisfies InferenceDeploymentItem;
    })
    .filter((item): item is InferenceDeploymentItem => Boolean(item))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  return {
    available: true,
    reason: null,
    items,
  };
}

export async function createInferenceDeployment(
  input: CreateInferenceDeploymentInput,
) {
  const ctx = await createKubeContext();

  validateInferenceName(input.name);
  const cpu = normalizeCpu(input.cpu);
  const memory = normalizeMemoryGi(input.memoryGi);
  const gpuCount = normalizeGpuCount(input.engine, input.gpuCount);
  const replicaCount = normalizeReplicaCount(input.replicaCount);

  await ensureNamespace(ctx.coreApi, ctx.namespace);

  const { deployments, services, liveNodes } = await listInferenceResources(ctx);
  const existing = deployments.some(
    (deployment) =>
      inferenceNameFromResource(deployment.metadata?.name) === input.name,
  );

  if (existing) {
    throw new Error(`推理部署 ${input.name} 已存在。`);
  }

  const eligibleNodeNames = selectEligibleInferenceNodes({
    configNodes: ctx.nodes,
    liveNodes,
    deployments,
    requestedGpu: gpuCount,
    gpuLabelKey: ctx.config.gpuLabelKey,
  });
  const nodePort = resolveInferenceNodePort(services);

  await ctx.appsApi.createNamespacedDeployment({
    namespace: ctx.namespace,
    body: buildInferenceDeployment({
      name: input.name,
      engine: input.engine,
      modelRef: input.modelRef,
      image: input.image,
      cpu,
      memory,
      gpuCount,
      replicaCount,
      eligibleNodeNames,
    }),
  });

  try {
    await ctx.coreApi.createNamespacedService({
      namespace: ctx.namespace,
      body: buildInferenceService({
        name: input.name,
        nodePort,
      }),
    });
  } catch (error) {
    await ctx.appsApi.deleteNamespacedDeployment({
      name: inferenceDeploymentName(input.name),
      namespace: ctx.namespace,
      propagationPolicy: "Foreground",
    });
    throw error;
  }

  const controllerAccessHost = resolveControllerAccessHost(ctx.config, ctx.nodes);

  return {
    name: input.name,
    endpoint: buildEndpoint({
      controllerAccessHost,
      service: buildInferenceService({ name: input.name, nodePort }),
    }),
    eligibleNodeNames,
    nodePort,
  };
}

async function readInferenceDeployment(ctx: KubeContext, name: string) {
  return ctx.appsApi.readNamespacedDeployment({
    namespace: ctx.namespace,
    name: inferenceDeploymentName(name),
  });
}

export async function startInferenceDeployment(name: string) {
  validateInferenceName(name);

  const ctx = await createKubeContext();
  const deployment = await readInferenceDeployment(ctx, name);
  const desiredReplicas = Number.parseInt(
    deployment.metadata?.annotations?.[INFERENCE_METADATA.desiredReplicas] ?? "1",
    10,
  );

  if ((deployment.spec?.replicas ?? 0) > 0) {
    return {
      name,
      message: "推理部署已经在线上服务中。",
    };
  }

  await ctx.appsApi.replaceNamespacedDeployment({
    namespace: ctx.namespace,
    name: deployment.metadata?.name ?? inferenceDeploymentName(name),
    body: {
      ...deployment,
      metadata: {
        ...deployment.metadata,
        annotations: deploymentAnnotations({
          engine:
            (deployment.metadata?.annotations?.[
              INFERENCE_METADATA.engine
            ] as InferenceDeploymentEngine | undefined) ?? "vllm",
          modelRef:
            deployment.metadata?.annotations?.[INFERENCE_METADATA.modelRef] ?? name,
          desiredReplicas: Number.isFinite(desiredReplicas) ? desiredReplicas : 1,
          lastStartedAt: new Date().toISOString(),
        }),
      },
      spec: {
        ...deployment.spec,
        replicas: Number.isFinite(desiredReplicas) ? desiredReplicas : 1,
      },
    },
  });

  return {
    name,
    message: "推理部署已上线。",
  };
}

export async function stopInferenceDeployment(name: string) {
  validateInferenceName(name);

  const ctx = await createKubeContext();
  const deployment = await readInferenceDeployment(ctx, name);

  if ((deployment.spec?.replicas ?? 0) === 0) {
    return {
      name,
      message: "推理部署已经处于暂停状态。",
    };
  }

  await ctx.appsApi.replaceNamespacedDeployment({
    namespace: ctx.namespace,
    name: deployment.metadata?.name ?? inferenceDeploymentName(name),
    body: {
      ...deployment,
      spec: {
        ...deployment.spec,
        replicas: 0,
      },
    },
  });

  return {
    name,
    message: "推理部署已暂停。",
  };
}

export async function deleteInferenceDeployment(name: string) {
  validateInferenceName(name);

  const ctx = await createKubeContext();

  await Promise.all([
    deleteResource({
      action: () =>
        ctx.appsApi.deleteNamespacedDeployment({
          name: inferenceDeploymentName(name),
          namespace: ctx.namespace,
          propagationPolicy: "Foreground",
        }),
    }),
    deleteResource({
      action: () =>
        ctx.coreApi.deleteNamespacedService({
          name: inferenceServiceName(name),
          namespace: ctx.namespace,
        }),
    }),
  ]);

  return { success: true };
}
