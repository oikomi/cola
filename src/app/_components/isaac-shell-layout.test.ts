import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./isaac-shell.tsx", import.meta.url),
  "utf8",
);

void test("Isaac hero does not render the resource status strip", () => {
  assert.doesNotMatch(source, /<StatusStrip\s+stations=\{stationRows\}/);
});

void test("Isaac Lab list omits the section header", () => {
  assert.match(source, /<ModuleSection\s+headerless/);
  assert.doesNotMatch(source, /title=\{ISAAC_LAB_UI_COPY\.sectionTitle\}/);
  assert.doesNotMatch(
    source,
    /description="提交和查看 Isaac Lab 训练、benchmark 与批量实验任务，可选 headless 或 WebRTC。"/,
  );
  assert.doesNotMatch(source, /\{labRows\.length\} 个任务/);
});
