import assert from "node:assert/strict";
import test from "node:test";

import type { V1Service } from "@kubernetes/client-node";

import {
  isJupyterLabPublicPortService,
  jupyterLabPublicPortServiceName,
  jupyterLabPublicPortTarget,
  normalizeJupyterLabPublicPort,
} from "./jupyterlab-public-port.ts";

void test("JupyterLab public port normalization accepts notebook app ports", () => {
  assert.equal(normalizeJupyterLabPublicPort(7860), 7860);
  assert.equal(normalizeJupyterLabPublicPort(65535), 65535);
});

void test("JupyterLab public port normalization rejects invalid ports", () => {
  assert.throws(
    () => normalizeJupyterLabPublicPort(8888),
    /8888 已用于 JupyterLab 入口/,
  );
  assert.throws(
    () => normalizeJupyterLabPublicPort(80),
    /公开端口范围必须是 1024-65535/,
  );
  assert.throws(
    () => normalizeJupyterLabPublicPort(7860.5),
    /公开端口必须是整数/,
  );
});

void test("JupyterLab public port service names fit max lab names", () => {
  const labName = "a".repeat(48);
  const name = jupyterLabPublicPortServiceName(labName, 65535);

  assert.equal(name.length, 61);
  assert.equal(name, `jlab-${labName}-p-65535`);
});

void test("JupyterLab public port service detection requires component label", () => {
  const service: Pick<V1Service, "metadata"> = {
    metadata: {
      labels: {
        "app.kubernetes.io/name": "cola-jupyterlab",
        "app.kubernetes.io/component": "notebook-public-port",
        "cola.training/jupyterlab-name": "lab-a",
      },
    },
  };

  assert.equal(isJupyterLabPublicPortService(service), true);
  assert.equal(isJupyterLabPublicPortService(service, "lab-a"), true);
  assert.equal(isJupyterLabPublicPortService(service, "lab-b"), false);
});

void test("JupyterLab public port target is read from labels first", () => {
  const service: Pick<V1Service, "metadata" | "spec"> = {
    metadata: {
      labels: {
        "cola.training/jupyterlab-public-port": "7860",
      },
    },
    spec: {
      ports: [{ port: 8501, targetPort: 8501 }],
    },
  };

  assert.equal(jupyterLabPublicPortTarget(service), 7860);
});
