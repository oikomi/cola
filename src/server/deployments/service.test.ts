import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertLlamaCppModelFileExists,
  assertLlamaCppModelFileExistsOnNodes,
  buildInferenceNodeAffinity,
  buildInferenceRuntimeCommand,
  defaultInferenceContainerSecurityContext,
  isInferencePodFailed,
  isInferencePodMakingProgress,
  resolveLlamaDownloadUrl,
  resolveLlamaHostModelPath,
  resolveLlamaRemoteModelPath,
  resolveLlamaRuntimeModelPath,
  resolveS3AwareRuntimeModelPath,
  resolveS3ModelPath,
} from "./runtime-utils.ts";
import {
  locateAnythingModelRef,
  locateAnythingModelRevision,
  qwen3Embedding4BModelRef,
} from "./catalog.ts";

void test("llama.cpp model refs map into the host model root", () => {
  assert.equal(
    resolveLlamaHostModelPath("unsloth/model.gguf", "/srv/models"),
    path.join("/srv/models", "unsloth", "model.gguf"),
  );
  assert.equal(
    resolveLlamaHostModelPath("/models/unsloth/model.gguf", "/srv/models"),
    path.join("/srv/models", "unsloth", "model.gguf"),
  );
});

void test("llama.cpp host model validation rejects missing files", () => {
  const modelRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cola-model-root-"));

  try {
    assert.throws(
      () => assertLlamaCppModelFileExists("unsloth/model.gguf", modelRoot),
      /llama\.cpp 模型文件不存在：/,
    );
  } finally {
    fs.rmSync(modelRoot, { recursive: true, force: true });
  }
});

void test("llama.cpp host model validation accepts existing files", () => {
  const modelRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cola-model-root-"));
  const hostModelPath = path.join(modelRoot, "unsloth", "model.gguf");

  try {
    fs.mkdirSync(path.dirname(hostModelPath), { recursive: true });
    fs.writeFileSync(hostModelPath, "gguf");

    assert.equal(
      assertLlamaCppModelFileExists("unsloth/model.gguf", modelRoot),
      hostModelPath,
    );
  } finally {
    fs.rmSync(modelRoot, { recursive: true, force: true });
  }
});

void test("llama.cpp node model validation rejects nodes without ssh credentials", async () => {
  await assert.rejects(
    () =>
      assertLlamaCppModelFileExistsOnNodes({
        modelRef: "unsloth/model.gguf",
        modelRoot: "/srv/models",
        nodes: [{ name: "worker-a", ip: "10.0.0.2" }],
      }),
    /缺少 sshUser 或 sshPassword/,
  );
});

void test("downloadable llama.cpp refs resolve to stable download URLs and cache paths", () => {
  assert.equal(
    resolveLlamaDownloadUrl(
      "hf://unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-Q3_K_M.gguf",
    ),
    "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q3_K_M.gguf",
  );
  assert.match(
    resolveLlamaRemoteModelPath(
      "eeee",
      "https://example.com/models/gemma-4-E2B-it-Q3_K_M.gguf?download=1",
    ),
    /\/cache\/huggingface\/gguf\/eeee\/[a-f0-9]{12}-gemma-4-E2B-it-Q3_K_M\.gguf$/,
  );
  assert.match(
    resolveLlamaRuntimeModelPath(
      "eeee",
      "hf://unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-Q3_K_M.gguf",
    ),
    /\/cache\/huggingface\/gguf\/eeee\/[a-f0-9]{12}-gemma-4-E2B-it-Q3_K_M\.gguf$/,
  );
});

void test("S3 model refs resolve to stable cache directories", () => {
  assert.match(
    resolveS3ModelPath("qwen3", "s3://xdream/models/qwen3-8b-instruct/"),
    /\/cache\/huggingface\/s3\/qwen3\/[a-f0-9]{12}$/,
  );
  assert.match(
    resolveS3AwareRuntimeModelPath(
      "qwen3",
      "s3://xdream/models/qwen3-8b-instruct/",
    ),
    /\/cache\/huggingface\/s3\/qwen3\/[a-f0-9]{12}$/,
  );
  assert.equal(
    resolveS3AwareRuntimeModelPath("qwen3", "Qwen/Qwen3-8B-Instruct"),
    "Qwen/Qwen3-8B-Instruct",
  );
});

void test("SGLang LocateAnything command uses the pinned native profile", () => {
  assert.deepEqual(
    buildInferenceRuntimeCommand({
      name: "locate-anything",
      engine: "sglang",
      modelRef: locateAnythingModelRef,
      gpuSpec: {
        gpuAllocationMode: "whole",
        gpuCount: 1,
        gpuMemoryGi: null,
      },
    }),
    {
      command: ["python3", "-m", "sglang.launch_server"],
      args: [
        "--model-path",
        locateAnythingModelRef,
        "--served-model-name",
        "locate-anything",
        "--host",
        "0.0.0.0",
        "--port",
        "8000",
        "--tp",
        "1",
        "--trust-remote-code",
        "--revision",
        locateAnythingModelRevision,
        "--model-impl",
        "sglang",
      ],
    },
  );
});

void test("Qwen3 Embedding 4B command starts the lightweight TEI runtime", () => {
  assert.deepEqual(
    buildInferenceRuntimeCommand({
      name: "qwen3-embedding",
      engine: "qwen3-embedding",
      modelRef: qwen3Embedding4BModelRef,
      gpuSpec: {
        gpuAllocationMode: "whole",
        gpuCount: 1,
        gpuMemoryGi: null,
      },
    }),
    {
      args: [
        "--model-id",
        qwen3Embedding4BModelRef,
        "--dtype",
        "float16",
        "--hostname",
        "0.0.0.0",
        "--port",
        "8000",
        "--huggingface-hub-cache",
        "/cache/huggingface",
        "--auto-truncate",
      ],
    },
  );
});

void test("Qwen3 Embedding TEI rejects multi-GPU replicas", () => {
  assert.throws(
    () =>
      buildInferenceRuntimeCommand({
        name: "qwen3-embedding",
        engine: "qwen3-embedding",
        modelRef: qwen3Embedding4BModelRef,
        gpuSpec: {
          gpuAllocationMode: "whole",
          gpuCount: 2,
          gpuMemoryGi: null,
        },
      }),
    /每个副本固定使用 1 个 GPU 份额/,
  );
});

void test("only Qwen3 Embedding defaults its server container to privileged", () => {
  assert.deepEqual(
    defaultInferenceContainerSecurityContext("qwen3-embedding"),
    {
      privileged: true,
    },
  );
  assert.equal(defaultInferenceContainerSecurityContext("vllm"), null);
});

void test("inference node affinity pins pods to the selected worker nodes", () => {
  assert.deepEqual(
    buildInferenceNodeAffinity(["node-b", "node-a", "node-b", " "]),
    {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [
                {
                  key: "kubernetes.io/hostname",
                  operator: "In",
                  values: ["node-a", "node-b"],
                },
              ],
            },
          ],
        },
      },
    },
  );
  assert.equal(buildInferenceNodeAffinity([]), null);
});

void test("SGLang does not trust remote code for arbitrary model refs", () => {
  const command = buildInferenceRuntimeCommand({
    name: "qwen",
    engine: "sglang",
    modelRef: "Qwen/Qwen3-8B-Instruct",
    gpuSpec: {
      gpuAllocationMode: "whole",
      gpuCount: 2,
      gpuMemoryGi: null,
    },
  });

  assert.deepEqual(command.command, ["python3", "-m", "sglang.launch_server"]);
  assert.deepEqual(command.args, [
    "--model-path",
    "Qwen/Qwen3-8B-Instruct",
    "--served-model-name",
    "qwen",
    "--host",
    "0.0.0.0",
    "--port",
    "8000",
    "--tp",
    "2",
  ]);
});

void test("SAM 2 command follows the dedicated runtime entrypoint contract", () => {
  assert.deepEqual(
    buildInferenceRuntimeCommand({
      name: "sam2-images",
      engine: "sam2",
      modelRef: "facebook/sam2.1-hiera-tiny",
      gpuSpec: {
        gpuAllocationMode: "whole",
        gpuCount: 1,
        gpuMemoryGi: null,
      },
    }),
    {
      args: [
        "--model",
        "facebook/sam2.1-hiera-tiny",
        "--host",
        "0.0.0.0",
        "--port",
        "8000",
      ],
    },
  );
});

void test("inference pod failure detection catches crash loops", () => {
  assert.equal(
    isInferencePodFailed({
      status: {
        phase: "Running",
        containerStatuses: [
          {
            name: "server",
            ready: false,
            restartCount: 5,
            image: "ghcr.io/ggml-org/llama.cpp:server-cuda",
            imageID: "ghcr.io/ggml-org/llama.cpp@sha256:test",
            state: {
              waiting: {
                reason: "CrashLoopBackOff",
              },
            },
          },
        ],
      },
    }),
    true,
  );

  assert.equal(
    isInferencePodFailed({
      status: {
        phase: "Running",
        containerStatuses: [
          {
            name: "server",
            ready: true,
            restartCount: 0,
            image: "ghcr.io/ggml-org/llama.cpp:server-cuda",
            imageID: "ghcr.io/ggml-org/llama.cpp@sha256:test",
            state: {
              running: {
                startedAt: new Date(),
              },
            },
          },
        ],
      },
    }),
    false,
  );
});

void test("inference pod progress detection treats running init containers as progress", () => {
  assert.equal(
    isInferencePodMakingProgress({
      status: {
        phase: "Pending",
        initContainerStatuses: [
          {
            name: "gguf-downloader",
            ready: false,
            restartCount: 0,
            image: "curlimages/curl:8.12.1",
            imageID: "curlimages/curl@sha256:test",
            state: {
              running: {
                startedAt: new Date(),
              },
            },
          },
        ],
        containerStatuses: [
          {
            name: "server",
            ready: false,
            restartCount: 0,
            image: "ghcr.io/ggml-org/llama.cpp:server-cuda",
            imageID: "ghcr.io/ggml-org/llama.cpp@sha256:test",
            state: {
              waiting: {
                reason: "PodInitializing",
              },
            },
          },
        ],
      },
    }),
    true,
  );
});
