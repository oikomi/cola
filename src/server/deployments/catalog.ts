export const inferenceDeploymentEngineValues = [
  "vllm",
  "llama.cpp",
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
