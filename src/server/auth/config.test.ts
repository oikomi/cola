import assert from "node:assert/strict";
import test from "node:test";

import { normalizeNextPath } from "./url.ts";

void test("normalizeNextPath only allows same-site relative paths", () => {
  assert.equal(normalizeNextPath("/cmdb?tab=assets"), "/cmdb?tab=assets");
  assert.equal(normalizeNextPath("https://example.com"), "/");
  assert.equal(normalizeNextPath("//example.com/path"), "/");
  assert.equal(normalizeNextPath("cmdb"), "/");
  assert.equal(normalizeNextPath(null), "/");
});
