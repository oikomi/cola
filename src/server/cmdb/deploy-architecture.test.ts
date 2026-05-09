import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDockerTargetArchitectureVariables,
  dockerPlatformForArchitecture,
  normalizeDockerTargetArchitecture,
} from "./deploy-architecture.ts";

void test("normalizes CMDB asset architecture aliases for Docker builds", () => {
  assert.equal(normalizeDockerTargetArchitecture("amd64"), "amd64");
  assert.equal(normalizeDockerTargetArchitecture("x86_64"), "amd64");
  assert.equal(normalizeDockerTargetArchitecture("x64"), "amd64");
  assert.equal(normalizeDockerTargetArchitecture("arm64"), "arm64");
  assert.equal(normalizeDockerTargetArchitecture("aarch64"), "arm64");
  assert.equal(normalizeDockerTargetArchitecture("riscv64"), null);
});

void test("maps target architecture to Docker platform", () => {
  assert.equal(dockerPlatformForArchitecture("amd64"), "linux/amd64");
  assert.equal(dockerPlatformForArchitecture("arm64"), "linux/arm64");
});

void test("builds single-architecture GitLab variables", () => {
  assert.deepEqual(
    buildDockerTargetArchitectureVariables({
      targetArchitectures: ["aarch64"],
      primaryArchitecture: "aarch64",
    }),
    {
      DEPLOY_TARGET_ARCHES: "arm64",
      DEPLOY_TARGET_ARCH: "arm64",
      DOCKER_DEFAULT_PLATFORM: "linux/arm64",
      TARGETARCH: "arm64",
      TARGETPLATFORM: "linux/arm64",
      DEPLOY_ASSET_ARCH: "arm64",
      DEPLOY_ASSET_PLATFORM: "linux/arm64",
    },
  );
});

void test("does not choose a single platform for mixed target architectures", () => {
  assert.deepEqual(
    buildDockerTargetArchitectureVariables({
      targetArchitectures: ["x86_64", "aarch64"],
      primaryArchitecture: "x86_64",
    }),
    {
      DEPLOY_TARGET_ARCHES: "amd64,arm64",
      DEPLOY_ASSET_ARCH: "amd64",
      DEPLOY_ASSET_PLATFORM: "linux/amd64",
    },
  );
});
