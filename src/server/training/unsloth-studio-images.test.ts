import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveUnslothStudioImage,
  resolveUnslothStudioImageOptions,
} from "./unsloth-studio-images.ts";

void test("Unsloth Studio always uses the latest official image", () => {
  const env = {
    COLA_UNSLOTH_STUDIO_IMAGE: "registry.example.com/unsloth:fixed",
    COLA_UNSLOTH_STUDIO_IMAGE_OPTIONS:
      "fixed=registry.example.com/unsloth:fixed",
  };

  assert.deepEqual(resolveUnslothStudioImageOptions(env), [
    {
      label: "Unsloth Studio Latest",
      image: "unsloth/unsloth:latest",
      description: "始终使用 Unsloth 官方 latest 镜像。",
    },
  ]);
  assert.equal(
    resolveUnslothStudioImage("registry.example.com/unsloth:fixed", env),
    "unsloth/unsloth:latest",
  );
});
