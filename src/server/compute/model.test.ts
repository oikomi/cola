import assert from "node:assert/strict";
import test from "node:test";

import {
  buildComputeSnapshot,
  parseCpuCores,
  parseMemoryBytes,
  type BuildComputeSnapshotInput,
} from "./model.ts";

void test("Kubernetes CPU and memory quantities are normalized", () => {
  assert.equal(parseCpuCores("750m"), 0.75);
  assert.equal(parseCpuCores("250000000n"), 0.25);
  assert.equal(parseCpuCores("2"), 2);
  assert.equal(parseCpuCores("invalid"), null);

  assert.equal(parseMemoryBytes("512Mi"), 512 * 1024 ** 2);
  assert.equal(parseMemoryBytes("2Gi"), 2 * 1024 ** 3);
  assert.equal(parseMemoryBytes("1G"), 1_000_000_000);
  assert.equal(parseMemoryBytes("invalid"), null);
});

function fixture(): BuildComputeSnapshotInput {
  return {
    generatedAt: "2026-07-15T08:00:00.000Z",
    clusterName: "xdream-cloud",
    configuredNodes: [
      {
        name: "master-01",
        ip: "172.16.60.198",
        roles: ["master", "worker", "gpu"],
      },
      {
        name: "node-01",
        ip: "172.16.60.162",
        roles: ["worker", "gpu"],
      },
    ],
    hamiNodes: [
      {
        name: "master-01",
        ip: "172.16.60.198",
        isReady: true,
        isSchedulable: true,
        type: ["RTX 4090"],
        vgpuUsed: 1,
        vgpuTotal: 10,
        coreUsed: 100,
        coreTotal: 100,
        memoryUsed: 12_288,
        memoryTotal: 24_564,
        cardCnt: 1,
      },
      {
        name: "node-01",
        ip: "172.16.60.162",
        isReady: true,
        isSchedulable: true,
        type: ["RTX 4090"],
        vgpuUsed: 1,
        vgpuTotal: 20,
        coreUsed: 100,
        coreTotal: 200,
        memoryUsed: 23_552,
        memoryTotal: 49_128,
        cardCnt: 2,
      },
    ],
    hamiGpus: [
      {
        uuid: "GPU-A",
        nodeName: "master-01",
        type: "RTX 4090",
        vgpuUsed: 1,
        vgpuTotal: 10,
        coreUsed: 100,
        coreTotal: 100,
        memoryUsed: 12_288,
        memoryTotal: 24_564,
        health: true,
        mode: "hami-core",
      },
      {
        uuid: "GPU-B",
        nodeName: "node-01",
        type: "RTX 4090",
        vgpuUsed: 0,
        vgpuTotal: 10,
        coreUsed: 0,
        coreTotal: 100,
        memoryUsed: 0,
        memoryTotal: 24_564,
        health: true,
        mode: "hami-core",
      },
      {
        uuid: "GPU-C",
        nodeName: "node-01",
        type: "RTX 4090",
        vgpuUsed: 1,
        vgpuTotal: 10,
        coreUsed: 100,
        coreTotal: 100,
        memoryUsed: 23_552,
        memoryTotal: 24_564,
        health: true,
        mode: "hami-core",
      },
    ],
    hamiContainers: [
      {
        name: "server",
        status: "success",
        appName: "inference-sam2-abcde",
        nodeName: "master-01",
        allocatedDevices: 1,
        allocatedCores: 100,
        allocatedMem: 12_288,
        type: "NVIDIA",
        createTime: "2026-07-15T07:00:00.000Z",
        startTime: "",
        endTime: "",
        podUid: "pod-a",
        nodeUid: "node-a",
        namespace: "remote-work",
        deviceIds: ["GPU-A"],
        images: ["cola-sam2:local"],
      },
      {
        name: "trainer",
        status: "running",
        appName: "cola-train-vision-12345678-0-abcde",
        nodeName: "node-01",
        allocatedDevices: 1,
        allocatedCores: 100,
        allocatedMem: 23_552,
        type: "NVIDIA",
        createTime: "2026-07-15T07:30:00.000Z",
        startTime: "",
        endTime: "",
        podUid: "pod-b",
        nodeUid: "node-b",
        namespace: "remote-work",
        deviceIds: ["GPU-C"],
        images: ["trainer:latest"],
      },
    ],
    podRuntimes: [
      {
        uid: "pod-a",
        name: "inference-sam2-abcde",
        namespace: "remote-work",
        nodeName: "master-01",
        ownerUserId: "user-a",
        phase: "Running",
        labels: { "cola.dev/inference-name": "sam2" },
        annotations: {},
        containers: [
          {
            name: "server",
            ready: true,
            restartCount: 1,
            state: "running",
            cpuRequestCores: 2,
            cpuLimitCores: 4,
            memoryRequestBytes: 4 * 1024 ** 3,
            memoryLimitBytes: 8 * 1024 ** 3,
            cpuUsageCores: null,
            memoryUsageBytes: null,
          },
        ],
      },
      {
        uid: "pod-b",
        name: "cola-train-vision-12345678-0-abcde",
        namespace: "remote-work",
        nodeName: "node-01",
        ownerUserId: null,
        phase: "Running",
        labels: { "cola.training/job-id": "job-b" },
        annotations: {},
        containers: [
          {
            name: "trainer",
            ready: true,
            restartCount: 0,
            state: "running",
            cpuRequestCores: 4,
            cpuLimitCores: 4,
            memoryRequestBytes: 24 * 1024 ** 3,
            memoryLimitBytes: 24 * 1024 ** 3,
            cpuUsageCores: null,
            memoryUsageBytes: null,
          },
        ],
      },
    ],
    ownerHints: [
      {
        prefix: "cola-train-vision-12345678",
        ownerUserId: "user-b",
        displayName: "视觉模型训练",
      },
    ],
    ownerMap: new Map([
      [
        "user-a",
        {
          id: "user-a",
          name: "Alice",
          email: "alice@example.com",
          avatarUrl: null,
          displayName: "Alice",
        },
      ],
      [
        "user-b",
        {
          id: "user-b",
          name: "Bob",
          email: "bob@example.com",
          avatarUrl: null,
          displayName: "Bob",
        },
      ],
    ]),
    metrics: {
      workloadGpu: [
        {
          metric: {
            namespace_name: "remote-work",
            pod_name: "inference-sam2-abcde",
            container_name: "server",
          },
          value: 35,
          timestamp: "1",
        },
        {
          metric: {
            namespace_name: "remote-work",
            pod_name: "cola-train-vision-12345678-0-abcde",
            container_name: "trainer",
          },
          value: 80,
          timestamp: "1",
        },
      ],
      workloadGpuMemory: [
        {
          metric: {
            namespace_name: "remote-work",
            pod_name: "inference-sam2-abcde",
            container_name: "server",
          },
          value: 50,
          timestamp: "1",
        },
      ],
      workloadCpu: [
        {
          metric: {
            namespace: "remote-work",
            pod: "inference-sam2-abcde",
            container: "server",
          },
          value: 1,
          timestamp: "1",
        },
      ],
      workloadMemory: [
        {
          metric: {
            namespace: "remote-work",
            pod: "inference-sam2-abcde",
            container: "server",
          },
          value: 2 * 1024 ** 3,
          timestamp: "1",
        },
      ],
      nodeGpu: [
        { metric: { node: "master-01" }, value: 20, timestamp: "1" },
        { metric: { node: "node-01" }, value: 60, timestamp: "1" },
      ],
      nodeGpuMemory: [
        { metric: { node: "master-01" }, value: 30, timestamp: "1" },
        { metric: { node: "node-01" }, value: 90, timestamp: "1" },
      ],
    },
    sources: {
      hami: "live",
      kubernetes: "live",
      metrics: "live",
      database: "live",
    },
    warnings: [],
  };
}

void test("compute snapshot joins GPU telemetry, pod load and owners", () => {
  const snapshot = buildComputeSnapshot(fixture());

  assert.equal(snapshot.status, "live");
  assert.equal(snapshot.cluster.gpuNodeCount, 2);
  assert.equal(snapshot.summary.gpuCardsTotal, 3);
  assert.equal(snapshot.summary.gpuCardsAllocated, 2);
  assert.equal(snapshot.summary.workloadCount, 2);
  assert.equal(snapshot.summary.activeOwnerCount, 2);
  assert.equal(snapshot.summary.computeAllocationPercent, 66.7);
  assert.equal(snapshot.summary.gpuUtilizationPercent, 46.7);

  const inference = snapshot.workloads.find(
    (workload) => workload.kind === "inference",
  );
  assert.ok(inference);
  assert.equal(inference.displayName, "sam2");
  assert.equal(inference.owner?.displayName, "Alice");
  assert.equal(inference.gpuUtilizationPercent, 35);
  assert.equal(inference.cpuUsageCores, 1);
  assert.equal(inference.cpuUtilizationPercent, 25);
  assert.equal(inference.memoryUtilizationPercent, 25);
  assert.equal(inference.restartCount, 1);

  const training = snapshot.workloads.find(
    (workload) => workload.kind === "training",
  );
  assert.ok(training);
  assert.equal(training.displayName, "视觉模型训练");
  assert.equal(training.owner?.displayName, "Bob");
});

void test("nodes outside infra/k8s/cluster are excluded and reported", () => {
  const input = fixture();
  input.hamiNodes.push({
    ...input.hamiNodes[0]!,
    name: "unmanaged-gpu-node",
    ip: "10.0.0.9",
  });
  input.hamiGpus.push({
    ...input.hamiGpus[0]!,
    uuid: "GPU-UNMANAGED",
    nodeName: "unmanaged-gpu-node",
  });
  input.hamiContainers.push({
    ...input.hamiContainers[0]!,
    podUid: "pod-unmanaged",
    appName: "inference-unmanaged-abcde",
    nodeName: "unmanaged-gpu-node",
    deviceIds: ["GPU-UNMANAGED"],
  });

  const snapshot = buildComputeSnapshot(input);

  assert.equal(snapshot.summary.gpuCardsTotal, 3);
  assert.equal(snapshot.summary.workloadCount, 2);
  assert.match(snapshot.warnings[0] ?? "", /未在 infra\/k8s\/cluster/);
});

void test("missing secondary sources produces a partial snapshot", () => {
  const input = fixture();
  input.sources.kubernetes = "unavailable";
  input.sources.database = "unavailable";

  const snapshot = buildComputeSnapshot(input);
  assert.equal(snapshot.status, "partial");
});
