import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNodePortRangesIsolated,
  formatNodePortRange,
  NODE_PORT_RANGES,
  type NodePortRange,
} from "./node-port-ranges.ts";

void test("default NodePort ranges are isolated by product area", () => {
  assert.equal(formatNodePortRange(NODE_PORT_RANGES.openclaw), "31180-31279");
  assert.equal(formatNodePortRange(NODE_PORT_RANGES.hermes), "31280-31379");
  assert.equal(formatNodePortRange(NODE_PORT_RANGES.workspace), "31480-31579");
  assert.equal(formatNodePortRange(NODE_PORT_RANGES.jupyterlab), "31580-31679");
  assert.equal(
    formatNodePortRange(NODE_PORT_RANGES.platformReserved),
    "31680-32079",
  );
  assert.equal(
    formatNodePortRange(NODE_PORT_RANGES.unslothStudio),
    "32080-32179",
  );
  assert.equal(formatNodePortRange(NODE_PORT_RANGES.inference), "32300-32760");

  assert.doesNotThrow(() => assertNodePortRangesIsolated(NODE_PORT_RANGES));
});

void test("NodePort range validation rejects overlap", () => {
  const ranges: Record<string, NodePortRange> = {
    workspace: { label: "远程桌面", start: 31480, end: 31580 },
    jupyterlab: { label: "JupyterLab", start: 31580, end: 31679 },
  };

  assert.throws(
    () => assertNodePortRangesIsolated(ranges),
    /远程桌面 NodePort 区间 31480-31580 与 JupyterLab NodePort 区间 31580-31679 重叠/,
  );
});
