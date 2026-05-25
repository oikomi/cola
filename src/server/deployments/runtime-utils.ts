import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import type { ConnectConfig } from "ssh2";
import { Client } from "ssh2";

import type { V1Pod } from "@kubernetes/client-node";
import {
  isLlamaCppHuggingFaceFileRef,
  isLlamaCppLocalModelRef,
  isLlamaCppRemoteModelRef,
  isLlamaCppRemoteModelUrl,
  isS3ModelRef,
} from "./catalog.ts";

export const DEFAULT_INFERENCE_MODEL_ROOT =
  process.env.INFERENCE_MODEL_ROOT ?? "/var/lib/remote-work/models";
export const DEFAULT_INFERENCE_CACHE_ROOT = "/cache/huggingface";
export const DEFAULT_LLAMA_CPP_REMOTE_CACHE_ROOT = `${DEFAULT_INFERENCE_CACHE_ROOT}/gguf`;
export const DEFAULT_INFERENCE_S3_MODEL_CACHE_ROOT = `${DEFAULT_INFERENCE_CACHE_ROOT}/s3`;

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
  return value.startsWith("/models/")
    ? value
    : path.posix.join("/models", value);
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

function sshExec(config: ConnectConfig, command: string) {
  return new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
    signal: string | null;
  }>((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const finish = (
      error: Error | null,
      result?: {
        stdout: string;
        stderr: string;
        code: number | null;
        signal: string | null;
      },
    ) => {
      if (settled) return;
      settled = true;
      client.end();

      if (error) {
        reject(error);
        return;
      }

      resolve({
        stdout: result?.stdout ?? "",
        stderr: result?.stderr ?? "",
        code: result?.code ?? 0,
        signal: result?.signal ?? null,
      });
    };

    client.once("ready", () => {
      client.exec(command, (error, stream) => {
        if (error) {
          finish(error);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        stream.once("close", (code: number | null, signal: string | null) => {
          finish(null, { stdout, stderr, code, signal });
        });
      });
    });

    client.once("error", (error) => {
      finish(error);
    });

    client.connect(config);
  });
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function readableLlamaCppNodeValidationError(params: {
  nodeName: string;
  nodeIp: string;
  hostModelPath: string;
  output: string;
}) {
  switch (params.output.trim()) {
    case "missing":
      return `llama.cpp 模型文件不存在：${params.hostModelPath}。请先把对应 GGUF 文件放到 K8s 节点 ${params.nodeName}(${params.nodeIp}) 的宿主机目录后再上线部署。`;
    case "not-file":
      return `llama.cpp 模型路径不是文件：${params.hostModelPath}。请确认 K8s 节点 ${params.nodeName}(${params.nodeIp}) 上 /models 下引用的是可读的 GGUF 文件。`;
    case "not-readable":
      return `llama.cpp 模型文件不可读：${params.hostModelPath}。请检查 K8s 节点 ${params.nodeName}(${params.nodeIp}) 上的文件权限。`;
    default:
      return `无法确认 K8s 节点 ${params.nodeName}(${params.nodeIp}) 上的 llama.cpp 模型文件：${params.hostModelPath}。`;
  }
}

export async function assertLlamaCppModelFileExistsOnNodes(params: {
  modelRef: string;
  nodes: Array<{
    name: string;
    ip: string;
    sshUser?: string;
    sshPassword?: string;
    sshPort?: number;
  }>;
  modelRoot?: string;
}) {
  const hostModelPath = resolveLlamaHostModelPath(
    params.modelRef,
    params.modelRoot,
  );
  const nodes = params.nodes.filter((node) => node.ip);

  if (nodes.length === 0) {
    throw new Error(
      `无法确认 llama.cpp 模型文件：${hostModelPath}。部署没有可检查的 K8s 调度节点。`,
    );
  }

  const command = [
    "p=",
    shellSingleQuote(hostModelPath),
    "; ",
    '[ -e "$p" ] || { echo missing; exit 10; }; ',
    '[ -f "$p" ] || { echo not-file; exit 11; }; ',
    '[ -r "$p" ] || { echo not-readable; exit 12; }; ',
    "echo ok",
  ].join("");

  for (const node of nodes) {
    if (!node.sshUser || !node.sshPassword) {
      throw new Error(
        `无法通过 SSH 检查 K8s 节点 ${node.name}(${node.ip}) 上的 llama.cpp 模型文件：缺少 sshUser 或 sshPassword。`,
      );
    }

    let result: Awaited<ReturnType<typeof sshExec>>;

    try {
      result = await sshExec(
        {
          host: node.ip,
          port: node.sshPort ?? 22,
          username: node.sshUser,
          password: node.sshPassword,
          readyTimeout: 8000,
          keepaliveInterval: 10000,
        },
        command,
      );
    } catch (error) {
      throw new Error(
        `无法通过 SSH 检查 K8s 节点 ${node.name}(${node.ip}) 上的 llama.cpp 模型文件：${
          error instanceof Error ? error.message : "SSH 连接失败"
        }。`,
      );
    }

    if (result.code !== 0) {
      throw new Error(
        readableLlamaCppNodeValidationError({
          nodeName: node.name,
          nodeIp: node.ip,
          hostModelPath,
          output: result.stdout || result.stderr,
        }),
      );
    }
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

export function resolveS3ModelPath(
  deploymentName: string,
  modelRef: string,
  cacheRoot = DEFAULT_INFERENCE_S3_MODEL_CACHE_ROOT,
) {
  if (!isS3ModelRef(modelRef)) {
    throw new Error(`不支持的 S3 模型引用：${modelRef}`);
  }

  const digest = createHash("sha256")
    .update(modelRef.trim())
    .digest("hex")
    .slice(0, 12);
  return path.posix.join(cacheRoot, deploymentName, digest);
}

export function resolveS3AwareRuntimeModelPath(
  deploymentName: string,
  modelRef: string,
) {
  return isS3ModelRef(modelRef)
    ? resolveS3ModelPath(deploymentName, modelRef)
    : modelRef;
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

export function isInferencePodMakingProgress(pod: Pick<V1Pod, "status">) {
  if (isInferencePodFailed(pod)) return false;

  if (pod.status?.phase === "Running") return true;

  const initStatuses = pod.status?.initContainerStatuses ?? [];
  const containerStatuses = pod.status?.containerStatuses ?? [];

  if (
    [...initStatuses, ...containerStatuses].some(
      (status) => status.state?.running,
    )
  ) {
    return true;
  }

  return initStatuses.some(
    (status) => (status.state?.terminated?.exitCode ?? 1) === 0,
  );
}
