import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import type { V1Pod } from "@kubernetes/client-node";
import {
  isLlamaCppHuggingFaceFileRef,
  isLlamaCppLocalModelRef,
  isLlamaCppRemoteModelRef,
  isLlamaCppRemoteModelUrl,
} from "./catalog.ts";

export const DEFAULT_INFERENCE_MODEL_ROOT =
  process.env.INFERENCE_MODEL_ROOT ?? "/var/lib/remote-work/models";
export const DEFAULT_INFERENCE_CACHE_ROOT = "/cache/huggingface";
export const DEFAULT_LLAMA_CPP_REMOTE_CACHE_ROOT =
  `${DEFAULT_INFERENCE_CACHE_ROOT}/gguf`;

const FAILED_POD_WAITING_REASONS = new Set([
  "CrashLoopBackOff",
  "CreateContainerConfigError",
  "CreateContainerError",
  "ContainerCannotRun",
  "ErrImagePull",
  "ImagePullBackOff",
  "RunContainerError",
]);

export function resolveLlamaLocalModelPath(modelRef: string) {
  const value = modelRef.trim();
  return value.startsWith("/models/") ? value : path.posix.join("/models", value);
}

export function resolveLlamaHostModelPath(
  modelRef: string,
  modelRoot = DEFAULT_INFERENCE_MODEL_ROOT,
) {
  const containerModelPath = resolveLlamaLocalModelPath(modelRef);
  return path.join(
    modelRoot,
    path.posix.relative("/models", containerModelPath),
  );
}

export function assertLlamaCppModelFileExists(
  modelRef: string,
  modelRoot = DEFAULT_INFERENCE_MODEL_ROOT,
) {
  const hostModelPath = resolveLlamaHostModelPath(modelRef, modelRoot);
  let stats: fs.Stats;

  try {
    stats = fs.statSync(hostModelPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `llama.cpp 模型文件不存在：${hostModelPath}。请先把对应 GGUF 文件放到宿主机挂载到 /models 的目录后再上线部署。`,
      );
    }
    throw error;
  }

  if (!stats.isFile()) {
    throw new Error(
      `llama.cpp 模型路径不是文件：${hostModelPath}。请确认 /models 下引用的是可读的 GGUF 文件。`,
    );
  }

  try {
    fs.accessSync(hostModelPath, fs.constants.R_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      throw new Error(
        `llama.cpp 模型文件不可读：${hostModelPath}。请检查宿主机上的文件权限。`,
      );
    }
    throw error;
  }

  return hostModelPath;
}

function sanitizeRemoteFileName(fileName: string) {
  const normalized = fileName.trim() || "model.gguf";
  return normalized.replace(/[^A-Za-z0-9._-]/g, "-");
}

function resolveRemoteBaseFileName(modelRef: string) {
  if (isLlamaCppRemoteModelUrl(modelRef)) {
    const url = new URL(modelRef.trim());
    const baseName = path.posix.basename(url.pathname);
    return sanitizeRemoteFileName(decodeURIComponent(baseName || "model.gguf"));
  }

  if (isLlamaCppHuggingFaceFileRef(modelRef)) {
    const url = new URL(modelRef.trim());
    const segments = url.pathname.split("/").filter(Boolean);
    const baseName = segments.at(-1) ?? "model.gguf";
    return sanitizeRemoteFileName(baseName);
  }

  return "model.gguf";
}

export function resolveLlamaRemoteModelPath(
  deploymentName: string,
  modelRef: string,
  cacheRoot = DEFAULT_LLAMA_CPP_REMOTE_CACHE_ROOT,
) {
  const digest = createHash("sha256")
    .update(modelRef.trim())
    .digest("hex")
    .slice(0, 12);
  const baseName = resolveRemoteBaseFileName(modelRef);
  return path.posix.join(cacheRoot, deploymentName, `${digest}-${baseName}`);
}

export function resolveLlamaDownloadUrl(modelRef: string) {
  const value = modelRef.trim();

  if (isLlamaCppRemoteModelUrl(value)) {
    return value;
  }

  if (isLlamaCppHuggingFaceFileRef(value)) {
    const url = new URL(value);
    const owner = encodeURIComponent(url.hostname);
    const [repo, ...fileSegments] = url.pathname.split("/").filter(Boolean);
    const encodedFilePath = fileSegments.map(encodeURIComponent).join("/");
    return `https://huggingface.co/${owner}/${encodeURIComponent(repo ?? "")}/resolve/main/${encodedFilePath}`;
  }

  throw new Error(`无法从当前 llama.cpp 模型引用推导下载地址：${modelRef}`);
}

export function resolveLlamaRuntimeModelPath(
  deploymentName: string,
  modelRef: string,
) {
  if (isLlamaCppLocalModelRef(modelRef)) {
    return resolveLlamaLocalModelPath(modelRef);
  }

  if (isLlamaCppRemoteModelRef(modelRef)) {
    return resolveLlamaRemoteModelPath(deploymentName, modelRef);
  }

  throw new Error(`不支持的 llama.cpp 模型引用：${modelRef}`);
}

export function isInferencePodFailed(pod: Pick<V1Pod, "status">) {
  if (pod.status?.phase === "Failed") return true;

  const statuses = [
    ...(pod.status?.initContainerStatuses ?? []),
    ...(pod.status?.containerStatuses ?? []),
  ];

  return statuses.some((status) => {
    const reason = status.state?.waiting?.reason;
    return reason ? FAILED_POD_WAITING_REASONS.has(reason) : false;
  });
}
