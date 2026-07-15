export type ComputeOwner = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  displayName: string;
};

export type ConfiguredComputeNode = {
  name: string;
  ip: string;
  roles: string[];
};

export type HamiNodeRecord = {
  name: string;
  ip: string;
  isReady: boolean;
  isSchedulable: boolean;
  type: string[];
  vgpuUsed: number;
  vgpuTotal: number;
  coreUsed: number;
  coreTotal: number;
  memoryUsed: number;
  memoryTotal: number;
  cardCnt: number;
};

export type HamiGpuRecord = {
  uuid: string;
  nodeName: string;
  type: string;
  vgpuUsed: number;
  vgpuTotal: number;
  coreUsed: number;
  coreTotal: number;
  memoryUsed: number;
  memoryTotal: number;
  health: boolean;
  mode: string;
};

export type HamiContainerRecord = {
  name: string;
  status: string;
  appName: string;
  nodeName: string;
  allocatedDevices: number;
  allocatedCores: number;
  allocatedMem: number;
  type: string;
  createTime: string;
  startTime: string;
  endTime: string;
  podUid: string;
  nodeUid: string;
  namespace: string;
  deviceIds: string[];
  images: string[];
};

export type ComputeMetricSample = {
  metric: Record<string, string>;
  value: number;
  timestamp: string;
};

export type PodContainerRuntime = {
  name: string;
  ready: boolean;
  restartCount: number;
  state: "running" | "waiting" | "terminated" | "unknown";
  cpuRequestCores: number | null;
  cpuLimitCores: number | null;
  memoryRequestBytes: number | null;
  memoryLimitBytes: number | null;
  cpuUsageCores: number | null;
  memoryUsageBytes: number | null;
};

export type PodRuntimeRecord = {
  uid: string;
  name: string;
  namespace: string;
  nodeName: string | null;
  ownerUserId: string | null;
  phase: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  containers: PodContainerRuntime[];
};

export type WorkloadOwnerHint = {
  prefix: string;
  ownerUserId: string | null;
  displayName?: string | null;
};

export type ComputeSourceState = "live" | "partial" | "unavailable";

export type ComputeSnapshot = {
  generatedAt: string;
  status: ComputeSourceState;
  cluster: {
    name: string;
    nodeCount: number;
    gpuNodeCount: number;
  };
  sources: {
    hami: ComputeSourceState;
    kubernetes: ComputeSourceState;
    metrics: ComputeSourceState;
    database: ComputeSourceState;
  };
  warnings: string[];
  summary: {
    gpuCardsTotal: number;
    gpuCardsAllocated: number;
    vgpuSlotsUsed: number;
    vgpuSlotsTotal: number;
    computeAllocationPercent: number | null;
    memoryAllocationPercent: number | null;
    gpuUtilizationPercent: number | null;
    gpuMemoryUtilizationPercent: number | null;
    workloadCount: number;
    activeOwnerCount: number;
    cpuUsageCores: number | null;
    memoryUsageBytes: number | null;
  };
  nodes: ComputeNodeSnapshot[];
  owners: ComputeOwnerSnapshot[];
  workloads: ComputeWorkloadSnapshot[];
};

export type ComputeNodeSnapshot = {
  name: string;
  ip: string;
  configuredRoles: string[];
  ready: boolean | null;
  schedulable: boolean | null;
  gpuModels: string[];
  gpuCardsTotal: number;
  gpuCardsAllocated: number;
  vgpuSlotsUsed: number;
  vgpuSlotsTotal: number;
  computeAllocationPercent: number | null;
  memoryAllocationPercent: number | null;
  gpuUtilizationPercent: number | null;
  gpuMemoryUtilizationPercent: number | null;
  workloadCount: number;
};

export type ComputeOwnerSnapshot = {
  id: string;
  owner: ComputeOwner | null;
  workloadCount: number;
  gpuCards: number;
  allocatedMemoryMi: number;
  cpuUsageCores: number | null;
  memoryUsageBytes: number | null;
  gpuUtilizationPercent: number | null;
};

export type ComputeWorkloadKind =
  | "workspace"
  | "training"
  | "inference"
  | "isaac"
  | "notebook"
  | "agent"
  | "other";

export type ComputeWorkloadStatus =
  | "running"
  | "pending"
  | "failed"
  | "completed"
  | "unknown";

export type ComputeWorkloadSnapshot = {
  id: string;
  podUid: string;
  namespace: string;
  podName: string;
  containerName: string;
  displayName: string;
  kind: ComputeWorkloadKind;
  status: ComputeWorkloadStatus;
  nodeName: string;
  ownerUserId: string | null;
  owner: ComputeOwner | null;
  image: string | null;
  createdAt: string | null;
  ready: boolean | null;
  restartCount: number | null;
  deviceIds: string[];
  gpuModels: string[];
  allocatedGpuCards: number;
  allocatedGpuCoresPercent: number;
  allocatedGpuMemoryMi: number;
  gpuUtilizationPercent: number | null;
  gpuMemoryUtilizationPercent: number | null;
  cpuUsageCores: number | null;
  cpuRequestCores: number | null;
  cpuLimitCores: number | null;
  cpuUtilizationPercent: number | null;
  memoryUsageBytes: number | null;
  memoryRequestBytes: number | null;
  memoryLimitBytes: number | null;
  memoryUtilizationPercent: number | null;
};

export type BuildComputeSnapshotInput = {
  generatedAt?: string;
  clusterName: string;
  configuredNodes: ConfiguredComputeNode[];
  hamiNodes: HamiNodeRecord[];
  hamiGpus: HamiGpuRecord[];
  hamiContainers: HamiContainerRecord[];
  podRuntimes: PodRuntimeRecord[];
  ownerHints: WorkloadOwnerHint[];
  ownerMap: Map<string, ComputeOwner>;
  metrics: {
    workloadGpu: ComputeMetricSample[];
    workloadGpuMemory: ComputeMetricSample[];
    workloadCpu: ComputeMetricSample[];
    workloadMemory: ComputeMetricSample[];
    nodeGpu: ComputeMetricSample[];
    nodeGpuMemory: ComputeMetricSample[];
  };
  sources: ComputeSnapshot["sources"];
  warnings?: string[];
};

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(used: number, total: number) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return round((used / total) * 100, 1);
}

function average(values: Array<number | null | undefined>) {
  const numbers = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (numbers.length === 0) return null;
  return round(
    numbers.reduce((total, value) => total + value, 0) / numbers.length,
    1,
  );
}

function sumOptional(values: Array<number | null | undefined>) {
  const numbers = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (numbers.length === 0) return null;
  return round(numbers.reduce((total, value) => total + value, 0));
}

function clampPercent(value: number | null | undefined) {
  const parsed = finiteNumber(value);
  return parsed === null ? null : round(Math.min(100, Math.max(0, parsed)), 1);
}

function metricKey(namespace: string, pod: string, container: string) {
  return `${namespace}/${pod}/${container}`;
}

function metricLookup(
  samples: ComputeMetricSample[],
  keys: { namespace: string; pod: string; container: string },
) {
  const map = new Map<string, number>();

  for (const sample of samples) {
    const namespace =
      sample.metric[keys.namespace] ?? sample.metric.namespace ?? "";
    const pod = sample.metric[keys.pod] ?? sample.metric.pod ?? "";
    const container =
      sample.metric[keys.container] ?? sample.metric.container ?? "";
    if (!namespace || !pod || !container) continue;
    map.set(metricKey(namespace, pod, container), sample.value);
  }

  return map;
}

function nodeMetricLookup(samples: ComputeMetricSample[]) {
  const map = new Map<string, number>();
  for (const sample of samples) {
    const node = sample.metric.node ?? sample.metric.NodeName;
    if (node) map.set(node, sample.value);
  }
  return map;
}

function statusForContainer(status: string): ComputeWorkloadStatus {
  switch (status.toLowerCase()) {
    case "success":
    case "running":
      return "running";
    case "pending":
    case "waiting":
    case "containercreating":
      return "pending";
    case "failed":
    case "error":
      return "failed";
    case "completed":
    case "succeeded":
      return "completed";
    default:
      return "unknown";
  }
}

function workloadKind(
  podName: string,
  labels: Record<string, string>,
): ComputeWorkloadKind {
  if (
    labels["remote-work/name"] ||
    labels["app.kubernetes.io/name"] === "remote-workspace" ||
    podName.startsWith("workspace-")
  ) {
    return "workspace";
  }
  if (
    labels["cola.training/job-id"] ||
    labels["app.kubernetes.io/name"] === "cola-training" ||
    podName.startsWith("cola-train-")
  ) {
    return "training";
  }
  if (labels["cola.dev/inference-name"] || podName.startsWith("inference-")) {
    return "inference";
  }
  if (labels["cola.isaac/station-name"] || podName.startsWith("isaac-")) {
    return "isaac";
  }
  if (
    podName.startsWith("jupyterlab-") ||
    podName.startsWith("unsloth-studio-")
  ) {
    return "notebook";
  }
  if (
    labels["app.kubernetes.io/name"] === "cola-runner" ||
    podName.startsWith("cola-agent-")
  ) {
    return "agent";
  }
  return "other";
}

function workloadDisplayName(
  podName: string,
  labels: Record<string, string>,
  annotations: Record<string, string>,
  hintName: string | null,
) {
  return (
    annotations["cola.training/title"] ??
    annotations["cola.isaac/title"] ??
    labels["remote-work/name"] ??
    labels["cola.dev/inference-name"] ??
    labels["cola.isaac/station-name"] ??
    hintName ??
    podName
  );
}

function resolveOwnerHint(podName: string, hints: WorkloadOwnerHint[]) {
  return [...hints]
    .filter((hint) => podName.startsWith(hint.prefix))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0];
}

function podContainerState(
  pod: PodRuntimeRecord | undefined,
  containerName: string,
) {
  return pod?.containers.find((container) => container.name === containerName);
}

function resourceUtilization(
  usage: number | null,
  limit: number | null,
  request: number | null,
) {
  const denominator =
    limit && limit > 0 ? limit : request && request > 0 ? request : null;
  return usage !== null && denominator !== null
    ? round((usage / denominator) * 100, 1)
    : null;
}

function overallStatus(
  sources: ComputeSnapshot["sources"],
): ComputeSourceState {
  if (sources.hami === "unavailable") return "unavailable";
  return Object.values(sources).every((source) => source === "live")
    ? "live"
    : "partial";
}

export function parseCpuCores(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const input = value.trim();
  const match = /^([0-9]+(?:\.[0-9]+)?)(n|u|m)?$/.exec(input);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  switch (match[2]) {
    case "n":
      return amount / 1_000_000_000;
    case "u":
      return amount / 1_000_000;
    case "m":
      return amount / 1_000;
    default:
      return amount;
  }
}

export function parseMemoryBytes(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const input = value.trim();
  const match = /^([0-9]+(?:\.[0-9]+)?)(Ki|Mi|Gi|Ti|Pi|Ei|K|M|G|T|P|E)?$/.exec(
    input,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const binaryPowers: Record<string, number> = {
    Ki: 1,
    Mi: 2,
    Gi: 3,
    Ti: 4,
    Pi: 5,
    Ei: 6,
  };
  const decimalPowers: Record<string, number> = {
    K: 1,
    M: 2,
    G: 3,
    T: 4,
    P: 5,
    E: 6,
  };
  const suffix = match[2] ?? "";
  if (suffix in binaryPowers) {
    return amount * 1024 ** binaryPowers[suffix]!;
  }
  if (suffix in decimalPowers) {
    return amount * 1000 ** decimalPowers[suffix]!;
  }
  return amount;
}

export function buildComputeSnapshot(
  input: BuildComputeSnapshotInput,
): ComputeSnapshot {
  const configuredNames = new Set(
    input.configuredNodes.map((node) => node.name),
  );
  const configuredGpuNodes = input.configuredNodes.filter((node) =>
    node.roles.includes("gpu"),
  );
  const gpuNodeNames = new Set(configuredGpuNodes.map((node) => node.name));
  const hamiNodes = input.hamiNodes.filter((node) =>
    configuredNames.has(node.name),
  );
  const hamiGpus = input.hamiGpus.filter((gpu) =>
    gpuNodeNames.has(gpu.nodeName),
  );
  const hamiContainers = input.hamiContainers.filter((container) =>
    gpuNodeNames.has(container.nodeName),
  );
  const podByUid = new Map(
    input.podRuntimes.filter((pod) => pod.uid).map((pod) => [pod.uid, pod]),
  );
  const podByName = new Map(
    input.podRuntimes.map((pod) => [`${pod.namespace}/${pod.name}`, pod]),
  );
  const gpuById = new Map(hamiGpus.map((gpu) => [gpu.uuid, gpu]));
  const workloadGpu = metricLookup(input.metrics.workloadGpu, {
    namespace: "namespace_name",
    pod: "pod_name",
    container: "container_name",
  });
  const workloadGpuMemory = metricLookup(input.metrics.workloadGpuMemory, {
    namespace: "namespace_name",
    pod: "pod_name",
    container: "container_name",
  });
  const workloadCpu = metricLookup(input.metrics.workloadCpu, {
    namespace: "namespace",
    pod: "pod",
    container: "container",
  });
  const workloadMemory = metricLookup(input.metrics.workloadMemory, {
    namespace: "namespace",
    pod: "pod",
    container: "container",
  });
  const nodeGpu = nodeMetricLookup(input.metrics.nodeGpu);
  const nodeGpuMemory = nodeMetricLookup(input.metrics.nodeGpuMemory);

  const workloads = hamiContainers.map((container): ComputeWorkloadSnapshot => {
    const pod =
      podByUid.get(container.podUid) ??
      podByName.get(`${container.namespace}/${container.appName}`);
    const podContainer = podContainerState(pod, container.name);
    const hint = resolveOwnerHint(container.appName, input.ownerHints);
    const ownerUserId = pod?.ownerUserId ?? hint?.ownerUserId ?? null;
    const owner = ownerUserId
      ? (input.ownerMap.get(ownerUserId) ?? null)
      : null;
    const key = metricKey(
      container.namespace,
      container.appName,
      container.name,
    );
    const cpuUsageCores =
      finiteNumber(workloadCpu.get(key)) ?? podContainer?.cpuUsageCores ?? null;
    const memoryUsageBytes =
      finiteNumber(workloadMemory.get(key)) ??
      podContainer?.memoryUsageBytes ??
      null;
    const cpuRequestCores = podContainer?.cpuRequestCores ?? null;
    const cpuLimitCores = podContainer?.cpuLimitCores ?? null;
    const memoryRequestBytes = podContainer?.memoryRequestBytes ?? null;
    const memoryLimitBytes = podContainer?.memoryLimitBytes ?? null;
    const labels = pod?.labels ?? {};
    const annotations = pod?.annotations ?? {};

    return {
      id: `${container.podUid || container.appName}:${container.name}`,
      podUid: container.podUid,
      namespace: container.namespace,
      podName: container.appName,
      containerName: container.name,
      displayName: workloadDisplayName(
        container.appName,
        labels,
        annotations,
        hint?.displayName ?? null,
      ),
      kind: workloadKind(container.appName, labels),
      status: statusForContainer(container.status),
      nodeName: container.nodeName,
      ownerUserId,
      owner,
      image: container.images[0] ?? null,
      createdAt: container.createTime || container.startTime || null,
      ready: podContainer?.ready ?? null,
      restartCount: podContainer?.restartCount ?? null,
      deviceIds: container.deviceIds,
      gpuModels: Array.from(
        new Set(
          container.deviceIds
            .map((deviceId) => gpuById.get(deviceId)?.type)
            .filter((model): model is string => Boolean(model)),
        ),
      ),
      allocatedGpuCards: container.allocatedDevices,
      allocatedGpuCoresPercent: container.allocatedCores,
      allocatedGpuMemoryMi: container.allocatedMem,
      gpuUtilizationPercent: clampPercent(workloadGpu.get(key)),
      gpuMemoryUtilizationPercent: clampPercent(workloadGpuMemory.get(key)),
      cpuUsageCores,
      cpuRequestCores,
      cpuLimitCores,
      cpuUtilizationPercent: resourceUtilization(
        cpuUsageCores,
        cpuLimitCores,
        cpuRequestCores,
      ),
      memoryUsageBytes,
      memoryRequestBytes,
      memoryLimitBytes,
      memoryUtilizationPercent: resourceUtilization(
        memoryUsageBytes,
        memoryLimitBytes,
        memoryRequestBytes,
      ),
    };
  });
  workloads.sort((left, right) => {
    const loadDifference =
      (right.gpuUtilizationPercent ?? -1) - (left.gpuUtilizationPercent ?? -1);
    if (loadDifference !== 0) return loadDifference;
    return left.displayName.localeCompare(right.displayName, "zh-CN");
  });

  const nodes = configuredGpuNodes.map(
    (configuredNode): ComputeNodeSnapshot => {
      const hamiNode = hamiNodes.find(
        (node) => node.name === configuredNode.name,
      );
      const nodeGpus = hamiGpus.filter(
        (gpu) => gpu.nodeName === configuredNode.name,
      );

      return {
        name: configuredNode.name,
        ip: configuredNode.ip,
        configuredRoles: configuredNode.roles,
        ready: hamiNode?.isReady ?? null,
        schedulable: hamiNode?.isSchedulable ?? null,
        gpuModels: Array.from(
          new Set(
            nodeGpus
              .map((gpu) => gpu.type)
              .filter((model): model is string => Boolean(model)),
          ),
        ),
        gpuCardsTotal:
          nodeGpus.length > 0 ? nodeGpus.length : (hamiNode?.cardCnt ?? 0),
        gpuCardsAllocated: nodeGpus.filter((gpu) => gpu.vgpuUsed > 0).length,
        vgpuSlotsUsed: hamiNode?.vgpuUsed ?? 0,
        vgpuSlotsTotal: hamiNode?.vgpuTotal ?? 0,
        computeAllocationPercent: hamiNode
          ? percent(hamiNode.coreUsed, hamiNode.coreTotal)
          : null,
        memoryAllocationPercent: hamiNode
          ? percent(hamiNode.memoryUsed, hamiNode.memoryTotal)
          : null,
        gpuUtilizationPercent: clampPercent(nodeGpu.get(configuredNode.name)),
        gpuMemoryUtilizationPercent: clampPercent(
          nodeGpuMemory.get(configuredNode.name),
        ),
        workloadCount: workloads.filter(
          (workload) => workload.nodeName === configuredNode.name,
        ).length,
      };
    },
  );

  const ownerBuckets = new Map<string, ComputeWorkloadSnapshot[]>();
  for (const workload of workloads) {
    const ownerKey = workload.ownerUserId ?? "__unassigned__";
    const current = ownerBuckets.get(ownerKey) ?? [];
    current.push(workload);
    ownerBuckets.set(ownerKey, current);
  }

  const owners = Array.from(ownerBuckets.entries()).map(
    ([id, ownerWorkloads]): ComputeOwnerSnapshot => ({
      id,
      owner: id === "__unassigned__" ? null : (input.ownerMap.get(id) ?? null),
      workloadCount: ownerWorkloads.length,
      gpuCards: ownerWorkloads.reduce(
        (total, workload) => total + workload.allocatedGpuCards,
        0,
      ),
      allocatedMemoryMi: ownerWorkloads.reduce(
        (total, workload) => total + workload.allocatedGpuMemoryMi,
        0,
      ),
      cpuUsageCores: sumOptional(
        ownerWorkloads.map((workload) => workload.cpuUsageCores),
      ),
      memoryUsageBytes: sumOptional(
        ownerWorkloads.map((workload) => workload.memoryUsageBytes),
      ),
      gpuUtilizationPercent: average(
        ownerWorkloads.map((workload) => workload.gpuUtilizationPercent),
      ),
    }),
  );
  owners.sort((left, right) => {
    if (right.allocatedMemoryMi !== left.allocatedMemoryMi) {
      return right.allocatedMemoryMi - left.allocatedMemoryMi;
    }
    return right.workloadCount - left.workloadCount;
  });

  const totalCoreUsed = hamiGpus.reduce(
    (total, gpu) => total + gpu.coreUsed,
    0,
  );
  const totalCore = hamiGpus.reduce((total, gpu) => total + gpu.coreTotal, 0);
  const totalMemoryUsed = hamiGpus.reduce(
    (total, gpu) => total + gpu.memoryUsed,
    0,
  );
  const totalMemory = hamiGpus.reduce(
    (total, gpu) => total + gpu.memoryTotal,
    0,
  );
  const nodeCardTotal = nodes.reduce(
    (total, node) => total + node.gpuCardsTotal,
    0,
  );
  const weightedNodeGpu = nodes.reduce(
    (total, node) =>
      total + (node.gpuUtilizationPercent ?? 0) * node.gpuCardsTotal,
    0,
  );
  const nodesWithGpuTelemetry = nodes.reduce(
    (total, node) =>
      total + (node.gpuUtilizationPercent === null ? 0 : node.gpuCardsTotal),
    0,
  );
  const weightedNodeMemory = nodes.reduce((total, node) => {
    const hamiNode = hamiNodes.find(
      (candidate) => candidate.name === node.name,
    );
    return (
      total +
      (node.gpuMemoryUtilizationPercent ?? 0) * (hamiNode?.memoryTotal ?? 0)
    );
  }, 0);
  const memoryWithTelemetry = nodes.reduce((total, node) => {
    const hamiNode = hamiNodes.find(
      (candidate) => candidate.name === node.name,
    );
    return (
      total +
      (node.gpuMemoryUtilizationPercent === null
        ? 0
        : (hamiNode?.memoryTotal ?? 0))
    );
  }, 0);

  const warnings = Array.from(new Set(input.warnings ?? []));
  const ignoredNodeCount = input.hamiNodes.filter(
    (node) => !configuredNames.has(node.name),
  ).length;
  if (ignoredNodeCount > 0) {
    warnings.push(
      `监控源返回了 ${ignoredNodeCount} 个未在 infra/k8s/cluster/nodes.json 中登记的节点，已忽略。`,
    );
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: overallStatus(input.sources),
    cluster: {
      name: input.clusterName,
      nodeCount: input.configuredNodes.length,
      gpuNodeCount: configuredGpuNodes.length,
    },
    sources: input.sources,
    warnings,
    summary: {
      gpuCardsTotal: hamiGpus.length || nodeCardTotal,
      gpuCardsAllocated: hamiGpus.filter((gpu) => gpu.vgpuUsed > 0).length,
      vgpuSlotsUsed: hamiGpus.reduce((total, gpu) => total + gpu.vgpuUsed, 0),
      vgpuSlotsTotal: hamiGpus.reduce((total, gpu) => total + gpu.vgpuTotal, 0),
      computeAllocationPercent: percent(totalCoreUsed, totalCore),
      memoryAllocationPercent: percent(totalMemoryUsed, totalMemory),
      gpuUtilizationPercent:
        nodesWithGpuTelemetry > 0
          ? round(weightedNodeGpu / nodesWithGpuTelemetry, 1)
          : null,
      gpuMemoryUtilizationPercent:
        memoryWithTelemetry > 0
          ? round(weightedNodeMemory / memoryWithTelemetry, 1)
          : null,
      workloadCount: workloads.length,
      activeOwnerCount: new Set(
        workloads
          .map((workload) => workload.ownerUserId)
          .filter((ownerUserId): ownerUserId is string => Boolean(ownerUserId)),
      ).size,
      cpuUsageCores: sumOptional(
        workloads.map((workload) => workload.cpuUsageCores),
      ),
      memoryUsageBytes: sumOptional(
        workloads.map((workload) => workload.memoryUsageBytes),
      ),
    },
    nodes,
    owners,
    workloads,
  };
}
