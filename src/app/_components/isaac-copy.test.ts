import assert from "node:assert/strict";
import test from "node:test";

import { ISAAC_LAB_UI_COPY } from "./isaac-copy.ts";

void test("Isaac Lab page copy uses Isaac Lab instead of Lab Jobs", () => {
  assert.equal(ISAAC_LAB_UI_COPY.statusLabel, "Isaac Lab");
  assert.equal(ISAAC_LAB_UI_COPY.tabLabel, "Isaac Lab");
  assert.equal(ISAAC_LAB_UI_COPY.sectionTitle, "Isaac Lab");
  assert.equal(ISAAC_LAB_UI_COPY.dialogBadge, "Isaac Lab");
  assert.equal(ISAAC_LAB_UI_COPY.primaryActionLabel, "提交 Isaac Lab");
  assert.equal(ISAAC_LAB_UI_COPY.emptyActionLabel, "提交 Isaac Lab");
  assert.match(ISAAC_LAB_UI_COPY.summaryDescription, /Isaac Lab 负责/);
  assert.doesNotMatch(ISAAC_LAB_UI_COPY.summaryDescription, /Lab Jobs 负责/);
});
