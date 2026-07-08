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
