export const inferenceDeploymentEngineValues = [
  "vllm",
  "lmdeploy",
  "llama.cpp",
  "sglang",
  "vision-detection",
] as const;

export const creatableInferenceDeploymentEngineValues = [
  "vllm",
  "lmdeploy",
  "llama.cpp",
  "sglang",
  "vision-detection",
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

const creatableInferenceDeploymentEngineSet =
  new Set<InferenceDeploymentEngine>(creatableInferenceDeploymentEngineValues);
export const llamaCppModelRoot = "/models";
export const llamaCppModelRefExample =
  "/models/unsloth/gemma-4-E2B-it-Q3_K_M.gguf";
export const llamaCppRemoteModelRefExample =
  "hf://unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-Q3_K_M.gguf";
export const llamaCppRemoteModelUrlExample = "https://example.com/model.gguf";
export const lmDeployModelRefExample = "internlm/internlm3-8b-instruct";
export const s3ModelRefExample = "s3://xdream/models/qwen3-8b-instruct/";
export const visionDetectionModelRefExample = "PekingU/rtdetr_v2_r50vd";
const huggingFaceModelRefPattern =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const llamaCppPathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const huggingFaceRepoSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const s3BucketPattern =
  /^(?!\d+\.\d+\.\d+\.\d+$)(?!.*\.\.)(?!.*\.-)(?!.*-\.)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const s3PathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._=+,-]{0,255}$/;

export function canCreateInferenceDeploymentWithEngine(
  engine: InferenceDeploymentEngine,
) {
  return creatableInferenceDeploymentEngineSet.has(engine);
}

export function isHuggingFaceModelRef(modelRef: string) {
  return huggingFaceModelRefPattern.test(modelRef.trim());
}

export function isS3ModelRef(modelRef: string) {
  const value = modelRef.trim();
  if (!value.startsWith("s3://")) return false;
  if (value.includes("?") || value.includes("#") || value.includes("@")) {
    return false;
  }

  const withoutScheme = value.slice("s3://".length);
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex <= 0) return false;

  const bucket = withoutScheme.slice(0, slashIndex);
  const key = withoutScheme.slice(slashIndex + 1);
  if (!s3BucketPattern.test(bucket)) return false;
  if (!key || key.includes("//")) return false;

  const segments = key.split("/").filter(Boolean);
  return segments.every(
    (segment) =>
      segment !== "." && segment !== ".." && s3PathSegmentPattern.test(segment),
  );
}

export function supportsS3ModelRef(engine: InferenceDeploymentEngine) {
  return engine === "vllm" || engine === "lmdeploy" || engine === "sglang";
}

function hasValidLlamaCppFilePathSegments(segments: string[]) {
  if (segments.length === 0) return false;
  if (!segments.at(-1)?.toLowerCase().endsWith(".gguf")) return false;

  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      llamaCppPathSegmentPattern.test(segment),
  );
}

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isLlamaCppLocalModelRef(modelRef: string) {
  const value = modelRef.trim();
  if (!value) return false;

  let relativePath = value;
  if (value === llamaCppModelRoot) return false;
  if (value.startsWith(`${llamaCppModelRoot}/`)) {
    relativePath = value.slice(llamaCppModelRoot.length + 1);
  } else if (value.startsWith("/")) {
    return false;
  }

  const segments = relativePath.split("/");
  return hasValidLlamaCppFilePathSegments(segments);
}

export function isLlamaCppRemoteModelUrl(modelRef: string) {
  const url = parseUrl(modelRef.trim());
  if (!url) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.pathname.toLowerCase().endsWith(".gguf");
}

export function isLlamaCppHuggingFaceFileRef(modelRef: string) {
  const url = parseUrl(modelRef.trim());
  if (url?.protocol !== "hf:") return false;
  if (!huggingFaceRepoSegmentPattern.test(url.hostname)) return false;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return false;

  const [repo, ...fileSegments] = segments;
  if (!repo || !huggingFaceRepoSegmentPattern.test(repo)) return false;

  return hasValidLlamaCppFilePathSegments(fileSegments);
}

export function isLlamaCppRemoteModelRef(modelRef: string) {
  return (
    isLlamaCppRemoteModelUrl(modelRef) || isLlamaCppHuggingFaceFileRef(modelRef)
  );
}

export function isLlamaCppModelRef(modelRef: string) {
  return (
    isLlamaCppLocalModelRef(modelRef) || isLlamaCppRemoteModelRef(modelRef)
  );
}

export function isValidInferenceModelRef(
  engine: InferenceDeploymentEngine,
  modelRef: string,
) {
  switch (engine) {
    case "llama.cpp":
      return isLlamaCppModelRef(modelRef);
    case "lmdeploy":
    case "vllm":
    case "sglang":
      return isHuggingFaceModelRef(modelRef) || isS3ModelRef(modelRef);
    case "vision-detection":
      return isHuggingFaceModelRef(modelRef);
    default:
      return false;
  }
}

export const inferenceDeploymentEngineLabels: Record<
  InferenceDeploymentEngine,
  string
> = {
  vllm: "vLLM",
  lmdeploy: "LMDeploy",
  "llama.cpp": "llama.cpp",
  sglang: "SGLang",
  "vision-detection": "视觉检测",
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
    case "lmdeploy":
      return "openmmlab/lmdeploy:latest";
    case "llama.cpp":
      return gpuCount > 0
        ? "ghcr.io/ggml-org/llama.cpp:server-cuda"
        : "ghcr.io/ggml-org/llama.cpp:server";
    case "sglang":
      return "lmsysorg/sglang:latest";
    case "vision-detection":
      return "cola-vision-tensorrt:local";
    default:
      return "vllm/vllm-openai:latest";
  }
}
