import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertLlamaCppModelFileExists,
  isInferencePodFailed,
  isInferencePodMakingProgress,
  resolveLlamaDownloadUrl,
  resolveLlamaHostModelPath,
  resolveLlamaRemoteModelPath,
  resolveLlamaRuntimeModelPath,
} from "./runtime-utils.ts";

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
