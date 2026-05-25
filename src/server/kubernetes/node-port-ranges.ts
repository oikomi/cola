export type NodePortRange = {
  label: string;
  start: number;
  end: number;
};

const K8S_NODE_PORT_MIN = 30000;
const K8S_NODE_PORT_MAX = 32767;

function readNumberFromEnv(names: string[], fallback: number) {
  for (const name of names) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;

    const value = Number(raw);
    if (Number.isInteger(value)) return value;

    throw new Error(`${name} 必须是整数 NodePort。`);
  }

  return fallback;
}

function createNodePortRange(input: {
  label: string;
  startEnv: string[];
  endEnv: string[];
  start: number;
  end: number;
}): NodePortRange {
  const start = readNumberFromEnv(input.startEnv, input.start);
  const end = readNumberFromEnv(input.endEnv, input.end);

  if (start < K8S_NODE_PORT_MIN || end > K8S_NODE_PORT_MAX || start > end) {
    throw new Error(
      `${input.label} NodePort 区间无效：${start}-${end}，必须位于 ${K8S_NODE_PORT_MIN}-${K8S_NODE_PORT_MAX} 且 start <= end。`,
    );
  }

  return {
    label: input.label,
    start,
    end,
  };
}

export function formatNodePortRange(range: NodePortRange) {
  return `${range.start}-${range.end}`;
}

export function assertNodePortRangesIsolated(
  ranges: Record<string, NodePortRange>,
) {
  const entries = Object.entries(ranges);

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < entries.length;
      rightIndex += 1
    ) {
      const left = entries[leftIndex]!;
      const right = entries[rightIndex]!;
      const leftRange = left[1];
      const rightRange = right[1];
      const overlaps =
        leftRange.start <= rightRange.end && rightRange.start <= leftRange.end;

      if (overlaps) {
        throw new Error(
          `${leftRange.label} NodePort 区间 ${formatNodePortRange(leftRange)} 与 ${rightRange.label} NodePort 区间 ${formatNodePortRange(rightRange)} 重叠。`,
        );
      }
    }
  }
}

export const NODE_PORT_RANGES = {
  openclaw: createNodePortRange({
    label: "OpenClaw",
    startEnv: ["COLA_OPENCLAW_NODE_PORT_START"],
    endEnv: ["COLA_OPENCLAW_NODE_PORT_END"],
    start: 31180,
    end: 31279,
  }),
  hermes: createNodePortRange({
    label: "Hermes",
    startEnv: ["COLA_HERMES_NODE_PORT_START"],
    endEnv: ["COLA_HERMES_NODE_PORT_END"],
    start: 31280,
    end: 31379,
  }),
  hermesApi: createNodePortRange({
    label: "Hermes API",
    startEnv: ["COLA_HERMES_API_NODE_PORT_START"],
    endEnv: ["COLA_HERMES_API_NODE_PORT_END"],
    start: 31380,
    end: 31479,
  }),
  workspace: createNodePortRange({
    label: "远程桌面",
    startEnv: [
      "COLA_WORKSPACE_NODE_PORT_START",
      "REMOTE_WORKSPACE_NODE_PORT_START",
    ],
    endEnv: ["COLA_WORKSPACE_NODE_PORT_END", "REMOTE_WORKSPACE_NODE_PORT_END"],
    start: 31480,
    end: 31579,
  }),
  jupyterlab: createNodePortRange({
    label: "JupyterLab",
    startEnv: ["COLA_JUPYTERLAB_NODE_PORT_START"],
    endEnv: ["COLA_JUPYTERLAB_NODE_PORT_END"],
    start: 31580,
    end: 31679,
  }),
  platformReserved: createNodePortRange({
    label: "平台/遗留保留",
    startEnv: ["COLA_PLATFORM_NODE_PORT_START"],
    endEnv: ["COLA_PLATFORM_NODE_PORT_END"],
    start: 31680,
    end: 32079,
  }),
  unslothStudio: createNodePortRange({
    label: "Unsloth Studio",
    startEnv: ["COLA_UNSLOTH_STUDIO_NODE_PORT_START"],
    endEnv: ["COLA_UNSLOTH_STUDIO_NODE_PORT_END"],
    start: 32080,
    end: 32179,
  }),
  jupyterlabPublic: createNodePortRange({
    label: "JupyterLab 公开端口",
    startEnv: ["COLA_JUPYTERLAB_PUBLIC_NODE_PORT_START"],
    endEnv: ["COLA_JUPYTERLAB_PUBLIC_NODE_PORT_END"],
    start: 32180,
    end: 32199,
  }),
  storage: createNodePortRange({
    label: "存储管理",
    startEnv: ["COLA_STORAGE_NODE_PORT_START"],
    endEnv: ["COLA_STORAGE_NODE_PORT_END"],
    start: 32200,
    end: 32299,
  }),
  inference: createNodePortRange({
    label: "推理部署",
    startEnv: ["COLA_INFERENCE_NODE_PORT_START", "INFERENCE_NODE_PORT_START"],
    endEnv: ["COLA_INFERENCE_NODE_PORT_END", "INFERENCE_NODE_PORT_END"],
    start: 32300,
    end: 32760,
  }),
} as const satisfies Record<string, NodePortRange>;

assertNodePortRangesIsolated(NODE_PORT_RANGES);
