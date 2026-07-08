import assert from "node:assert/strict";
import test from "node:test";

import {
  ISAAC_LAB_DEFAULT_DRAFT,
  shouldShowIsaacLabTrainingFields,
} from "./isaac-lab-draft.ts";

void test("Isaac Lab defaults to custom WebRTC with a sleep command", () => {
  assert.equal(ISAAC_LAB_DEFAULT_DRAFT.runner, "custom");
  assert.equal(ISAAC_LAB_DEFAULT_DRAFT.displayMode, "webrtc");
  assert.equal(ISAAC_LAB_DEFAULT_DRAFT.command, "sleep 1000000000000000");
});

void test("Isaac Lab hides task and iteration fields for custom runner", () => {
  assert.equal(shouldShowIsaacLabTrainingFields("custom"), false);
  assert.equal(shouldShowIsaacLabTrainingFields("direct"), true);
  assert.equal(shouldShowIsaacLabTrainingFields("rsl-rl"), true);
  assert.equal(shouldShowIsaacLabTrainingFields("skrl"), true);
});
