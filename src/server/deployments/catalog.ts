export const inferenceDeploymentEngineValues = [
  "vllm",
  "llama.cpp",
  "sglang",
] as const;

export const creatableInferenceDeploymentEngineValues = [
  "vllm",
  "sglang",
] as const;

export const inferenceDeploymentStatusValues = [
  "draft",
  "starting",
  "serving",
  "paused",
  "failed",
] as const;

export type InferenceDeploymentEngine =
  (typeof inferenceDeploymentEngineValues)[number];
export type InferenceDeploymentStatus =
  (typeof inferenceDeploymentStatusValues)[number];

const creatableInferenceDeploymentEngineSet = new Set<InferenceDeploymentEngine>(
  creatableInferenceDeploymentEngineValues,
);
const huggingFaceModelRefPattern =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

export function canCreateInferenceDeploymentWithEngine(
  engine: InferenceDeploymentEngine,
) {
  return creatableInferenceDeploymentEngineSet.has(engine);
}

export function isHuggingFaceModelRef(modelRef: string) {
  return huggingFaceModelRefPattern.test(modelRef.trim());
}

export const inferenceDeploymentEngineLabels: Record<
  InferenceDeploymentEngine,
  string
> = {
  vllm: "vLLM",
  "llama.cpp": "llama.cpp",
  sglang: "SGLang",
};

export const inferenceDeploymentStatusLabels: Record<
  InferenceDeploymentStatus,
  string
> = {
  draft: "草稿",
  starting: "启动中",
  serving: "服务中",
  paused: "已暂停",
  failed: "失败",
};

export function defaultInferenceImage(
  engine: InferenceDeploymentEngine,
  gpuCount: number,
) {
  switch (engine) {
    case "vllm":
      return "vllm/vllm-openai:latest";
    case "llama.cpp":
      return gpuCount > 0
        ? "ghcr.io/ggml-org/llama.cpp:server-cuda"
        : "ghcr.io/ggml-org/llama.cpp:server";
    case "sglang":
      return "lmsysorg/sglang:latest";
    default:
      return "vllm/vllm-openai:latest";
  }
}
