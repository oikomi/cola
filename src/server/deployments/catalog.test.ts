import assert from "node:assert/strict";
import test from "node:test";

import {
  canCreateInferenceDeploymentWithEngine,
  creatableInferenceDeploymentEngineValues,
  isHuggingFaceModelRef,
  isLlamaCppHuggingFaceFileRef,
  isLlamaCppModelRef,
  isLlamaCppRemoteModelUrl,
  isS3ModelRef,
  isValidInferenceModelRef,
  llamaCppModelRefExample,
  s3ModelRefExample,
  visionDetectionModelRefExample,
} from "./catalog.ts";

void test("create flow exposes all supported runtimes", () => {
  assert.deepEqual(creatableInferenceDeploymentEngineValues, [
    "vllm",
    "lmdeploy",
    "llama.cpp",
    "sglang",
    "vision-detection",
  ]);
  assert.equal(canCreateInferenceDeploymentWithEngine("vllm"), true);
  assert.equal(canCreateInferenceDeploymentWithEngine("lmdeploy"), true);
  assert.equal(canCreateInferenceDeploymentWithEngine("llama.cpp"), true);
  assert.equal(canCreateInferenceDeploymentWithEngine("sglang"), true);
  assert.equal(
    canCreateInferenceDeploymentWithEngine("vision-detection"),
    true,
  );
});

void test("Hugging Face model refs reject local paths", () => {
  assert.equal(isHuggingFaceModelRef("Qwen/Qwen3-8B-Instruct"), true);
  assert.equal(isHuggingFaceModelRef("meta-llama/Llama-3.1-8B-Instruct"), true);
  assert.equal(
    isHuggingFaceModelRef("/var/lib/remote-work/models/qwen.gguf"),
    false,
  );
  assert.equal(
    isHuggingFaceModelRef("llama-3.1-8b-instruct-q4_k_m.gguf"),
    false,
  );
  assert.equal(isHuggingFaceModelRef("Qwen/Qwen3-8B-Instruct/weights"), false);
});

void test("llama.cpp model refs accept local gguf paths under /models", () => {
  assert.equal(isLlamaCppModelRef(llamaCppModelRefExample), true);
  assert.equal(isLlamaCppModelRef("unsloth/gemma-4-E2B-it-Q3_K_M.gguf"), true);
  assert.equal(isLlamaCppModelRef("Qwen/Qwen3-8B-Instruct"), false);
  assert.equal(isLlamaCppModelRef("../qwen3.gguf"), false);
  assert.equal(isLlamaCppModelRef("/models/../qwen3.gguf"), false);
  assert.equal(
    isLlamaCppModelRef("/var/lib/remote-work/models/qwen3.gguf"),
    false,
  );
  assert.equal(isLlamaCppModelRef("qwen3/qwen3-8b-instruct"), false);
});

void test("llama.cpp model refs accept downloadable gguf sources", () => {
  assert.equal(
    isLlamaCppRemoteModelUrl("https://example.com/models/qwen3-q4_k_m.gguf"),
    true,
  );
  assert.equal(
    isLlamaCppHuggingFaceFileRef(
      "hf://bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    ),
    true,
  );
  assert.equal(
    isLlamaCppModelRef(
      "hf://bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    ),
    true,
  );
  assert.equal(
    isLlamaCppModelRef("https://example.com/models/qwen3-q4_k_m.bin"),
    false,
  );
});

void test("S3 model refs accept bucket prefixes and reject unsafe values", () => {
  assert.equal(isS3ModelRef(s3ModelRefExample), true);
  assert.equal(isS3ModelRef("s3://xdream/models/qwen3-8b-instruct"), true);
  assert.equal(isS3ModelRef("s3://xdream/models/Qwen3-8B/config.json"), true);
  assert.equal(isS3ModelRef("s3://x/models/qwen3"), false);
  assert.equal(isS3ModelRef("s3://xdream"), false);
  assert.equal(isS3ModelRef("s3://xdream/@models/qwen3"), false);
  assert.equal(isS3ModelRef("s3://xdream/../qwen3"), false);
  assert.equal(isS3ModelRef("s3://xdream/models//qwen3"), false);
  assert.equal(isS3ModelRef("s3://xdream/models/qwen3?versionId=1"), false);
  assert.equal(
    isS3ModelRef("http://172.16.60.198:32247/xdream/models/qwen3"),
    false,
  );
});

void test("model ref validation follows runtime selection", () => {
  assert.equal(
    isValidInferenceModelRef("vllm", "Qwen/Qwen3-8B-Instruct"),
    true,
  );
  assert.equal(
    isValidInferenceModelRef("sglang", "Qwen/Qwen3-8B-Instruct"),
    true,
  );
  assert.equal(
    isValidInferenceModelRef("lmdeploy", "internlm/internlm3-8b-instruct"),
    true,
  );
  assert.equal(isValidInferenceModelRef("lmdeploy", s3ModelRefExample), true);
  assert.equal(isValidInferenceModelRef("vllm", s3ModelRefExample), true);
  assert.equal(isValidInferenceModelRef("sglang", s3ModelRefExample), true);
  assert.equal(
    isValidInferenceModelRef("llama.cpp", llamaCppModelRefExample),
    true,
  );
  assert.equal(
    isValidInferenceModelRef("llama.cpp", "Qwen/Qwen3-8B-Instruct"),
    false,
  );
  assert.equal(
    isValidInferenceModelRef(
      "vision-detection",
      visionDetectionModelRefExample,
    ),
    true,
  );
  assert.equal(
    isValidInferenceModelRef("vision-detection", s3ModelRefExample),
    false,
  );
  assert.equal(
    isValidInferenceModelRef("vision-detection", "/models/a.pt"),
    false,
  );
});
