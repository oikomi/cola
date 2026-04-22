import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types requires an explicit .ts specifier here.
import {
  canCreateInferenceDeploymentWithEngine,
  creatableInferenceDeploymentEngineValues,
  isHuggingFaceModelRef,
} from "./catalog.ts";

void test("create flow only exposes Hugging Face backed runtimes", () => {
  assert.deepEqual(creatableInferenceDeploymentEngineValues, ["vllm", "sglang"]);
  assert.equal(canCreateInferenceDeploymentWithEngine("vllm"), true);
  assert.equal(canCreateInferenceDeploymentWithEngine("sglang"), true);
  assert.equal(canCreateInferenceDeploymentWithEngine("llama.cpp"), false);
});

void test("Hugging Face model refs reject local paths", () => {
  assert.equal(isHuggingFaceModelRef("Qwen/Qwen3-8B-Instruct"), true);
  assert.equal(
    isHuggingFaceModelRef("meta-llama/Llama-3.1-8B-Instruct"),
    true,
  );
  assert.equal(isHuggingFaceModelRef("/var/lib/remote-work/models/qwen.gguf"), false);
  assert.equal(isHuggingFaceModelRef("llama-3.1-8b-instruct-q4_k_m.gguf"), false);
  assert.equal(isHuggingFaceModelRef("Qwen/Qwen3-8B-Instruct/weights"), false);
});
