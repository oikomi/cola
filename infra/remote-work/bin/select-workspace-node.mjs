import fs from "node:fs";

function parseArgs(argv) {
  const args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`无法解析参数: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`参数 ${token} 缺少值`);
    }
    args[key] = value;
    index += 1;
  }

  return args;
}

const args = parseArgs(process.argv);
for (const key of [
  "nodes-json",
  "cluster-nodes-json",
  "deployments-json",
  "gpu",
  "gpu-label-key",
  "workspace-label-key",
]) {
  if (!args[key]) {
    throw new Error(`缺少必要参数 --${key}`);
  }
}

const configuredNodes = JSON.parse(fs.readFileSync(args["nodes-json"], "utf8"));
const clusterNodes = JSON.parse(
  fs.readFileSync(args["cluster-nodes-json"], "utf8") || '{"items":[]}',
);
const deployments = JSON.parse(
  fs.readFileSync(args["deployments-json"], "utf8") || '{"items":[]}',
);

const requestGpu = Number(args.gpu);
if (!Number.isInteger(requestGpu) || requestGpu < 0) {
  throw new Error("--gpu 必须是大于等于 0 的整数");
}

const liveNodeMap = new Map(
  (clusterNodes.items ?? []).map((node) => [node.metadata?.name, node]),
);

const workspaceCounts = new Map();
for (const item of deployments.items ?? []) {
  if (!item?.metadata?.name?.startsWith("workspace-")) {
    continue;
  }
  const nodeName =
    item?.spec?.template?.spec?.nodeSelector?.["kubernetes.io/hostname"];
  if (!nodeName) {
    continue;
  }
  workspaceCounts.set(nodeName, (workspaceCounts.get(nodeName) ?? 0) + 1);
}

function isReady(node) {
  const conditions = node?.status?.conditions ?? [];
  return conditions.some(
    (condition) => condition.type === "Ready" && condition.status === "True",
  );
}

function hasGpu(nodeConfig, nodeLive) {
  if (nodeConfig.roles.includes("gpu")) {
    return true;
  }
  if (
    nodeLive?.metadata?.labels?.[args["gpu-label-key"]] === "true" ||
    Number(nodeLive?.status?.allocatable?.["nvidia.com/gpu"] ?? 0) > 0
  ) {
    return true;
  }
  return false;
}

function allocatableGpuCount(nodeLive) {
  const raw = nodeLive?.status?.allocatable?.["nvidia.com/gpu"];
  const value = Number(raw ?? 0);
  return Number.isFinite(value) ? value : 0;
}

let candidates = configuredNodes.filter((node) => node.roles.includes("worker"));

if (args["requested-node"]) {
  candidates = candidates.filter(
    (node) =>
      node.name === args["requested-node"] || node.ip === args["requested-node"],
  );
  if (candidates.length === 0) {
    throw new Error(`指定节点不存在或未配置为 worker: ${args["requested-node"]}`);
  }
}

candidates = candidates
  .map((node) => {
    const live = liveNodeMap.get(node.name);
    return {
      node,
      live,
      ready: live ? isReady(live) : false,
      workspaceCount: workspaceCounts.get(node.name) ?? 0,
      gpuCapable: hasGpu(node, live),
      allocatableGpu: allocatableGpuCount(live),
      workspaceLabeled:
        live?.metadata?.labels?.[args["workspace-label-key"]] === "true",
    };
  })
  .filter((entry) => entry.live && entry.ready);

if (requestGpu > 0) {
  candidates = candidates.filter((entry) => entry.allocatableGpu >= requestGpu);
}

const labeledCandidates = candidates.filter((entry) => entry.workspaceLabeled);
if (labeledCandidates.length > 0) {
  candidates = labeledCandidates;
}

if (candidates.length === 0) {
  throw new Error(
    requestGpu > 0
      ? "没有找到 Ready 且 allocatable GPU 足够的候选节点。"
      : "没有找到 Ready 的候选 worker 节点。",
  );
}

const minWorkspaceCount = Math.min(
  ...candidates.map((entry) => entry.workspaceCount),
);
const leastLoaded = candidates.filter(
  (entry) => entry.workspaceCount === minWorkspaceCount,
);
const chosen =
  leastLoaded[Math.floor(Math.random() * leastLoaded.length)] ?? leastLoaded[0];

const result = {
  nodeName: chosen.node.name,
  allowGpuNode: requestGpu > 0 && !chosen.node.roles.includes("gpu") && chosen.gpuCapable,
  autoSelected: !args["requested-node"],
  workspaceCount: chosen.workspaceCount,
  candidateCount: candidates.length,
  reason: args["requested-node"]
    ? `使用显式指定节点 ${chosen.node.name}。`
    : `自动选择 ${chosen.node.name}，在 ${candidates.length} 个候选 Ready 节点中它的现有工作区数量最少（${chosen.workspaceCount}）。`,
};

console.log(JSON.stringify(result));
