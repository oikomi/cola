import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultAgentDraft } from "./office-agent-defaults.ts";

void test("new office agents default to Hermes K8s", () => {
  assert.equal(createDefaultAgentDraft().engine, "hermes-agent");
});
