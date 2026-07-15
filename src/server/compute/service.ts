import "server-only";

import fs from "node:fs";
import path from "node:path";

import {
  CoreV1Api,
  Metrics,
  type PodMetricsList,
  type V1Container,
  type V1ContainerStatus,
  type V1Pod,
} from "@kubernetes/client-node";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import type * as DbSchema from "@/server/db/schema";
import { inferenceDeployments, trainingJobs, users } from "@/server/db/schema";
import { createKubeConfig } from "@/server/kubernetes/kubeconfig";
import { displayResourceOwnerName } from "@/server/resource-owners";
import {
  buildComputeSnapshot,
  parseCpuCores,
  parseMemoryBytes,
  type ComputeMetricSample,
  type ComputeOwner,
  type ComputeSourceState,
  type ConfiguredComputeNode,
  type HamiContainerRecord,
  type HamiGpuRecord,
  type HamiNodeRecord,
  type PodContainerRuntime,
  type PodRuntimeRecord,
  type WorkloadOwnerHint,
} from "./model";

type Database = PostgresJsDatabase<typeof DbSchema>;

const CLUSTER_DIR = path.join(process.cwd(), "infra", "k8s", "cluster");
const CLUSTER_CONFIG_PATH = path.join(CLUSTER_DIR, "config.json");
const CLUSTER_NODES_PATH = path.join(CLUSTER_DIR, "nodes.json");
const OWNER_USER_ID_METADATA_KEY = "cola.dev/owner-user-id";
const HAMI_REQUEST_TIMEOUT_MS = Number(
  process.env.COLA_COMPUTE_HAMI_TIMEOUT_MS ?? "5500",
);
const KUBERNETES_REQUEST_TIMEOUT_MS = Number(
  process.env.COLA_COMPUTE_K8S_TIMEOUT_MS ?? "5500",
);
const DATABASE_REQUEST_TIMEOUT_MS = Number(
  process.env.COLA_COMPUTE_DATABASE_TIMEOUT_MS ?? "3500",
);

type ClusterConfig = {
  clusterName: string;
  controllerIp?: string;
  workspaceNamespace?: string;
  workspaceLabelKey?: string;
  gpuLabelKey?: string;
};

type HamiData = {
  nodes: HamiNodeRecord[];
  gpus: HamiGpuRecord[];
  containers: HamiContainerRecord[];
  metrics: ComputeSnapshotInputMetrics;
  hamiState: ComputeSourceState;
  metricsState: ComputeSourceState;
  warnings: string[];
};

type KubernetesData = {
  pods: PodRuntimeRecord[];
  state: ComputeSourceState;
  warning: string | null;
};

type OwnerData = {
  ownerMap: Map<string, ComputeOwner>;
  hints: WorkloadOwnerHint[];
  state: ComputeSourceState;
  warning: string | null;
};

type ComputeSnapshotInputMetrics = {
  workloadGpu: ComputeMetricSample[];
  workloadGpuMemory: ComputeMetricSample[];
  workloadCpu: ComputeMetricSample[];
  workloadMemory: ComputeMetricSample[];
  nodeGpu: ComputeMetricSample[];
  nodeGpuMemory: ComputeMetricSample[];
};

type HamiContainersResponse = { items: HamiContainerRecord[] };
type HamiNodesResponse = { list: HamiNodeRecord[] };
type HamiGpusResponse = { list: HamiGpuRecord[] };
type HamiMetricResponse = { data: ComputeMetricSample[] };

const numberValue = z.coerce.number().catch(0);
const stringValue = z
  .string()
  .nullish()
  .transform((value) => value ?? "");
const stringList = z
  .array(z.string())
  .nullish()
  .transform((value) => value ?? []);

const hamiContainerSchema = z
  .object({
    name: stringValue,
    status: stringValue,
    appName: stringValue,
    nodeName: stringValue,
    allocatedDevices: numberValue,
    allocatedCores: numberValue,
    allocatedMem: numberValue,
    type: stringValue,
    createTime: stringValue,
    startTime: stringValue,
    endTime: stringValue,
    podUid: stringValue,
    nodeUid: stringValue,
    namespace: stringValue,
    deviceIds: stringList,
    images: stringList,
  })
  .passthrough();

const hamiNodeSchema = z
  .object({
    name: stringValue,
    ip: stringValue,
    isReady: z.boolean().catch(false),
    isSchedulable: z.boolean().catch(false),
    type: stringList,
    vgpuUsed: numberValue,
    vgpuTotal: numberValue,
    coreUsed: numberValue,
    coreTotal: numberValue,
    memoryUsed: numberValue,
    memoryTotal: numberValue,
    cardCnt: numberValue,
  })
  .passthrough();

const hamiGpuSchema = z
  .object({
    uuid: stringValue,
    nodeName: stringValue,
    type: stringValue,
    vgpuUsed: numberValue,
    vgpuTotal: numberValue,
    coreUsed: numberValue,
    coreTotal: numberValue,
    memoryUsed: numberValue,
    memoryTotal: numberValue,
    health: z.boolean().catch(false),
    mode: stringValue,
  })
  .passthrough();

const metricSampleSchema = z.object({
  metric: z.record(z.string(), z.string()).catch({}),
  value: numberValue,
  timestamp: stringValue,
});

const hamiContainersResponseSchema = z.object({
  items: z.array(hamiContainerSchema).catch([]),
});
const hamiNodesResponseSchema = z.object({
  list: z.array(hamiNodeSchema).catch([]),
});
const hamiGpusResponseSchema = z.object({
  list: z.array(hamiGpuSchema).catch([]),
});
const metricResponseSchema = z.object({
  data: z.array(metricSampleSchema).catch([]),
});

const HAMI_METRIC_QUERIES = {
  workloadGpu:
    "avg by (namespace_name, pod_name, container_name) (hami_container_core_util)",
  workloadGpuMemory:
    "avg by (namespace_name, pod_name, container_name) (hami_container_memory_util)",
  workloadCpu:
    'sum by (namespace, pod, container) (rate(container_cpu_usage_seconds_total{container!="",container!="POD"}[5m]))',
  workloadMemory:
    'sum by (namespace, pod, container) (container_memory_working_set_bytes{container!="",container!="POD"})',
  nodeGpu: "avg by (node) (hami_core_util_avg)",
  nodeGpuMemory:
    "sum by (node) (hami_memory_used) / sum by (node) (hami_memory_size) * 100",
} satisfies Record<keyof ComputeSnapshotInputMetrics, string>;

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readClusterDefinition() {
  return {
    config: readJsonFile<ClusterConfig>(CLUSTER_CONFIG_PATH),
    nodes: readJsonFile<ConfiguredComputeNode[]>(CLUSTER_NODES_PATH),
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function hamiBaseUrl(config: ClusterConfig) {
  const configured =
    process.env.COLA_HAMI_WEBUI_URL?.trim() ??
    process.env.NEXT_PUBLIC_HAMI_WEBUI_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const controllerIp = config.controllerIp?.trim();
  if (!controllerIp) {
    throw new Error(
      "infra/k8s/cluster/config.json does not define controllerIp",
    );
  }
  return `http://${controllerIp}:3000`;
}

async function fetchHamiJson<T>(
  baseUrl: string,
  pathname: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  body?: unknown,
) {
  const response = await fetch(new URL(pathname, `${baseUrl}/`), {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(HAMI_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HAMi-WebUI responded with HTTP ${response.status}`);
  }

  return schema.parse(await response.json());
}

function resultState(results: PromiseSettledResult<unknown>[]) {
  const liveCount = results.filter(
    (result) => result.status === "fulfilled",
  ).length;
  if (liveCount === results.length) return "live" as const;
  if (liveCount === 0) return "unavailable" as const;
  return "partial" as const;
}

async function loadHamiData(config: ClusterConfig): Promise<HamiData> {
  let baseUrl: string;
  try {
    baseUrl = hamiBaseUrl(config);
  } catch (error) {
    console.warn("[compute] unable to resolve HAMi-WebUI URL", error);
    return {
      nodes: [],
      gpus: [],
      containers: [],
      metrics: emptyMetrics(),
      hamiState: "unavailable",
      metricsState: "unavailable",
      warnings: ["无法确定 HAMi-WebUI 地址，GPU 实时数据暂不可用。"],
    };
  }

  const listBody = {
    filters: {},
    pageRequest: { pageSize: 500, pageNo: 1 },
  };
  const requiredRequests: [
    Promise<HamiContainersResponse>,
    Promise<HamiNodesResponse>,
    Promise<HamiGpusResponse>,
  ] = [
    fetchHamiJson<HamiContainersResponse>(
      baseUrl,
      "/api/vgpu/v1/containers",
      hamiContainersResponseSchema,
      listBody,
    ),
    fetchHamiJson<HamiNodesResponse>(
      baseUrl,
      "/api/vgpu/v1/nodes",
      hamiNodesResponseSchema,
      listBody,
    ),
    fetchHamiJson<HamiGpusResponse>(
      baseUrl,
      "/api/vgpu/v1/gpus",
      hamiGpusResponseSchema,
      listBody,
    ),
  ];
  const metricEntries = Object.entries(HAMI_METRIC_QUERIES) as Array<
    [keyof ComputeSnapshotInputMetrics, string]
  >;
  const metricRequests: Array<Promise<HamiMetricResponse>> = metricEntries.map(
    ([, query]) =>
      fetchHamiJson<HamiMetricResponse>(
        baseUrl,
        "/api/vgpu/v1/monitor/query/instant-vector",
        metricResponseSchema,
        { query },
      ),
  );

  const [requiredResults, metricResults] = await Promise.all([
    Promise.allSettled(requiredRequests),
    Promise.allSettled(metricRequests),
  ]);
  const [containersResult, nodesResult, gpusResult] = requiredResults;
  const metrics = emptyMetrics();

  metricResults.forEach((result, index) => {
    const key = metricEntries[index]?.[0];
    if (key && result.status === "fulfilled") {
      metrics[key] = result.value.data;
    }
  });

  for (const result of [...requiredResults, ...metricResults]) {
    if (result.status === "rejected") {
      console.warn("[compute] HAMi-WebUI request failed", result.reason);
    }
  }

  const hamiState = resultState(requiredResults);
  const metricsState = resultState(metricResults);
  const warnings: string[] = [];
  if (hamiState === "unavailable") {
    warnings.push("HAMi-WebUI 暂不可达，GPU 分配与工作负载列表无法读取。");
  } else if (hamiState === "partial") {
    warnings.push("HAMi-WebUI 部分接口暂不可用，当前资源汇总可能不完整。");
  }
  if (metricsState === "unavailable") {
    warnings.push("Prometheus 实时负载暂不可用，资源分配数据仍可查看。");
  } else if (metricsState === "partial") {
    warnings.push("部分 Prometheus 指标暂不可用，对应负载项显示为暂无数据。");
  }

  return {
    containers:
      containersResult?.status === "fulfilled"
        ? containersResult.value.items
        : [],
    nodes: nodesResult?.status === "fulfilled" ? nodesResult.value.list : [],
    gpus: gpusResult?.status === "fulfilled" ? gpusResult.value.list : [],
    metrics,
    hamiState,
    metricsState,
    warnings,
  };
}

function emptyMetrics(): ComputeSnapshotInputMetrics {
  return {
    workloadGpu: [],
    workloadGpuMemory: [],
    workloadCpu: [],
    workloadMemory: [],
    nodeGpu: [],
    nodeGpuMemory: [],
  };
}

function containerState(status: V1ContainerStatus | undefined) {
  if (status?.state?.running) return "running" as const;
  if (status?.state?.waiting) return "waiting" as const;
  if (status?.state?.terminated) return "terminated" as const;
  return "unknown" as const;
}

function resourceValue(
  container: V1Container,
  resource: "cpu" | "memory",
  source: "requests" | "limits",
) {
  const value = container.resources?.[source]?.[resource];
  return value === undefined || value === null ? null : String(value);
}

function metricUsageMap(metrics: PodMetricsList | null) {
  const map = new Map<
    string,
    { cpuUsageCores: number | null; memoryUsageBytes: number | null }
  >();

  for (const pod of metrics?.items ?? []) {
    for (const container of pod.containers ?? []) {
      map.set(
        `${pod.metadata.namespace}/${pod.metadata.name}/${container.name}`,
        {
          cpuUsageCores: parseCpuCores(container.usage.cpu),
          memoryUsageBytes: parseMemoryBytes(container.usage.memory),
        },
      );
    }
  }

  return map;
}

function podRuntimeRecords(pods: V1Pod[], metrics: PodMetricsList | null) {
  const usage = metricUsageMap(metrics);

  return pods.flatMap((pod): PodRuntimeRecord[] => {
    const uid = pod.metadata?.uid;
    const name = pod.metadata?.name;
    const namespace = pod.metadata?.namespace;
    if (!uid || !name || !namespace) return [];
    const labels = pod.metadata?.labels ?? {};
    const annotations = pod.metadata?.annotations ?? {};
    const statuses = new Map(
      (pod.status?.containerStatuses ?? []).map((status) => [
        status.name,
        status,
      ]),
    );
    const containers = (pod.spec?.containers ?? []).map(
      (container): PodContainerRuntime => {
        const status = statuses.get(container.name);
        const runtimeUsage = usage.get(
          `${namespace}/${name}/${container.name}`,
        );

        return {
          name: container.name,
          ready: status?.ready ?? false,
          restartCount: status?.restartCount ?? 0,
          state: containerState(status),
          cpuRequestCores: parseCpuCores(
            resourceValue(container, "cpu", "requests"),
          ),
          cpuLimitCores: parseCpuCores(
            resourceValue(container, "cpu", "limits"),
          ),
          memoryRequestBytes: parseMemoryBytes(
            resourceValue(container, "memory", "requests"),
          ),
          memoryLimitBytes: parseMemoryBytes(
            resourceValue(container, "memory", "limits"),
          ),
          cpuUsageCores: runtimeUsage?.cpuUsageCores ?? null,
          memoryUsageBytes: runtimeUsage?.memoryUsageBytes ?? null,
        };
      },
    );

    return [
      {
        uid,
        name,
        namespace,
        nodeName: pod.spec?.nodeName ?? null,
        ownerUserId:
          annotations[OWNER_USER_ID_METADATA_KEY] ??
          labels[OWNER_USER_ID_METADATA_KEY] ??
          null,
        phase: pod.status?.phase ?? "Unknown",
        labels,
        annotations,
        containers,
      },
    ];
  });
}

async function loadKubernetesData(
  config: ClusterConfig,
): Promise<KubernetesData> {
  try {
    const runtimeKubeconfig = path.join(
      process.cwd(),
      "runtime",
      "kube",
      `${config.clusterName}.config`,
    );
    const { kubeConfig } = createKubeConfig({
      clusterName: config.clusterName,
      envVarNames: [
        "COLA_COMPUTE_KUBECONFIG_PATH",
        "REMOTE_WORK_KUBECONFIG_PATH",
        "WORKSPACE_KUBECONFIG",
      ],
      fallbackPaths: [runtimeKubeconfig],
      warnPrefix: "[compute]",
    });
    const coreApi = kubeConfig.makeApiClient(CoreV1Api);
    const metricsApi = new Metrics(kubeConfig);
    const [podsResult, metricsResult] = await Promise.allSettled([
      withTimeout(
        coreApi.listPodForAllNamespaces(),
        KUBERNETES_REQUEST_TIMEOUT_MS,
        "Kubernetes pod list",
      ),
      withTimeout(
        metricsApi.getPodMetrics(),
        KUBERNETES_REQUEST_TIMEOUT_MS,
        "Kubernetes metrics",
      ),
    ]);

    if (podsResult.status === "rejected") {
      throw podsResult.reason;
    }
    if (metricsResult.status === "rejected") {
      console.warn(
        "[compute] metrics-server fallback is unavailable",
        metricsResult.reason,
      );
    }

    return {
      pods: podRuntimeRecords(
        podsResult.value.items ?? [],
        metricsResult.status === "fulfilled" ? metricsResult.value : null,
      ),
      state: "live",
      warning: null,
    };
  } catch (error) {
    console.warn("[compute] Kubernetes enrichment failed", error);
    return {
      pods: [],
      state: "unavailable",
      warning:
        "Kubernetes Pod 元数据暂不可用，用户归属、重启次数和资源配额可能不完整。",
    };
  }
}

async function loadOwnerData(database: Database): Promise<OwnerData> {
  try {
    const [userRows, inferenceRows, trainingRows] = await withTimeout(
      Promise.all([
        database
          .select({
            id: users.id,
            feishuOpenId: users.feishuOpenId,
            name: users.name,
            email: users.email,
            avatarUrl: users.avatarUrl,
          })
          .from(users),
        database
          .select({
            name: inferenceDeployments.name,
            ownerUserId: inferenceDeployments.ownerUserId,
          })
          .from(inferenceDeployments),
        database
          .select({
            title: trainingJobs.title,
            runtimeJobName: trainingJobs.runtimeJobName,
            ownerUserId: trainingJobs.ownerUserId,
          })
          .from(trainingJobs),
      ]),
      DATABASE_REQUEST_TIMEOUT_MS,
      "Compute owner lookup",
    );

    const ownerMap = new Map<string, ComputeOwner>(
      userRows.map((user) => [
        user.id,
        {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          displayName: displayResourceOwnerName(user),
        },
      ]),
    );
    const hints: WorkloadOwnerHint[] = [
      ...inferenceRows.map((deployment) => ({
        prefix: `inference-${deployment.name}-`,
        ownerUserId: deployment.ownerUserId,
        displayName: deployment.name,
      })),
      ...trainingRows.flatMap((job): WorkloadOwnerHint[] =>
        job.runtimeJobName
          ? [
              {
                prefix: `${job.runtimeJobName}-`,
                ownerUserId: job.ownerUserId,
                displayName: job.title,
              },
            ]
          : [],
      ),
    ];

    return { ownerMap, hints, state: "live", warning: null };
  } catch (error) {
    console.warn("[compute] owner lookup failed", error);
    return {
      ownerMap: new Map(),
      hints: [],
      state: "unavailable",
      warning: "用户目录暂不可用，未能从数据库补全工作负载归属。",
    };
  }
}

export async function getComputeSnapshot(database: Database) {
  const { config, nodes } = readClusterDefinition();
  const [hami, kubernetes, owners] = await Promise.all([
    loadHamiData(config),
    loadKubernetesData(config),
    loadOwnerData(database),
  ]);
  const warnings = [
    ...hami.warnings,
    kubernetes.warning,
    owners.warning,
  ].filter((warning): warning is string => Boolean(warning));

  return buildComputeSnapshot({
    clusterName: config.clusterName,
    configuredNodes: nodes,
    hamiNodes: hami.nodes,
    hamiGpus: hami.gpus,
    hamiContainers: hami.containers,
    podRuntimes: kubernetes.pods,
    ownerHints: owners.hints,
    ownerMap: owners.ownerMap,
    metrics: hami.metrics,
    sources: {
      hami: hami.hamiState,
      kubernetes: kubernetes.state,
      metrics: hami.metricsState,
      database: owners.state,
    },
    warnings,
  });
}
