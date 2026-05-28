import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveJupyterLabImage,
  resolveJupyterLabImageOptions,
} from "./jupyterlab-images.ts";

void test("default JupyterLab image options match the cluster CUDA 12 runtime", () => {
  const options = resolveJupyterLabImageOptions({});

  assert.equal(options.length, 2);
  assert.deepEqual(
    options.map((option) => option.image),
    [
      "quay.io/jupyter/pytorch-notebook:latest",
      "quay.io/jupyter/pytorch-notebook:cuda12-latest",
    ],
  );
});

void test("configured JupyterLab image options are capped at five", () => {
  const options = resolveJupyterLabImageOptions({
    COLA_JUPYTERLAB_IMAGE_OPTIONS: [
      "one=registry.example.com/jupyter:one",
      "two=registry.example.com/jupyter:two",
      "three=registry.example.com/jupyter:three",
      "four=registry.example.com/jupyter:four",
      "five=registry.example.com/jupyter:five",
      "six=registry.example.com/jupyter:six",
    ].join(","),
  });

  assert.equal(options.length, 5);
  assert.equal(options.at(-1)?.image, "registry.example.com/jupyter:five");
});

void test("JupyterLab image selection must come from the configured options", () => {
  const env = {
    COLA_JUPYTERLAB_IMAGE_OPTIONS:
      "cuda12=quay.io/jupyter/pytorch-notebook:cuda12-latest",
  };

  assert.equal(
    resolveJupyterLabImage(
      "quay.io/jupyter/pytorch-notebook:cuda12-latest",
      env,
    ),
    "quay.io/jupyter/pytorch-notebook:cuda12-latest",
  );
  assert.throws(
    () => resolveJupyterLabImage("docker.io/library/unknown:latest", env),
    /镜像必须从可选镜像列表中选择/,
  );
});
