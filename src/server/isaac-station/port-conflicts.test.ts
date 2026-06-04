import assert from "node:assert/strict";
import test from "node:test";

import {
  findHeadlessWebrtcPortConflict,
  formatHeadlessWebrtcPortConflict,
} from "./port-conflicts.ts";

void test("detects another desired headless WebRTC deployment on the selected node", () => {
  const conflict = findHeadlessWebrtcPortConflict({
    requestedOwnerName: "new",
    nodeName: "node-01",
    pods: [],
    deployments: [
      {
        metadata: {
          name: "isaac-station-existing",
          labels: { "cola.isaac/station-name": "existing" },
          annotations: { "cola.isaac/mode": "headless-webrtc" },
        },
        spec: {
          replicas: 1,
          template: {
            spec: {
              nodeName: "node-01",
              hostNetwork: true,
              containers: [{ ports: [{ containerPort: 8011 }] }],
            },
          },
        },
      },
    ],
  });

  assert.deepEqual(conflict, {
    kind: "Deployment",
    resourceName: "isaac-station-existing",
    owner: { type: "station", name: "existing" },
    nodeName: "node-01",
    port: 8011,
  });
});

void test("ignores scaled-down and non-WebRTC deployments", () => {
  const conflict = findHeadlessWebrtcPortConflict({
    requestedOwnerName: "new",
    nodeName: "node-01",
    pods: [],
    deployments: [
      {
        metadata: {
          name: "isaac-station-stopped",
          labels: { "cola.isaac/station-name": "stopped" },
          annotations: { "cola.isaac/mode": "headless-webrtc" },
        },
        spec: {
          replicas: 0,
          template: {
            spec: {
              nodeName: "node-01",
              hostNetwork: true,
              containers: [{ ports: [{ containerPort: 8011 }] }],
            },
          },
        },
      },
      {
        metadata: {
          name: "isaac-station-egl",
          labels: { "cola.isaac/station-name": "egl" },
          annotations: { "cola.isaac/mode": "headless-egl" },
        },
        spec: {
          replicas: 1,
          template: {
            spec: {
              nodeName: "node-01",
              hostNetwork: false,
              containers: [{ ports: [{ containerPort: 8011 }] }],
            },
          },
        },
      },
    ],
  });

  assert.equal(conflict, null);
});

void test("detects a WebRTC Isaac Lab job on the selected node", () => {
  const conflict = findHeadlessWebrtcPortConflict({
    requestedOwnerName: "new",
    nodeName: "node-01",
    deployments: [],
    pods: [],
    jobs: [
      {
        metadata: {
          name: "isaac-lab-yourrrr",
          labels: { "cola.isaac/lab-job-name": "yourrrr" },
          annotations: { "cola.isaac/display-mode": "webrtc" },
        },
        spec: {
          parallelism: 1,
          template: {
            spec: {
              nodeName: "node-01",
              hostNetwork: true,
              containers: [{ ports: [{ containerPort: 8011 }] }],
            },
          },
        },
        status: { active: 1 },
      },
    ],
  });

  assert.deepEqual(conflict, {
    kind: "Job",
    resourceName: "isaac-lab-yourrrr",
    owner: { type: "lab", name: "yourrrr" },
    nodeName: "node-01",
    port: 8011,
  });
});

void test("detects an active headless WebRTC pod and ignores failed pods", () => {
  const conflict = findHeadlessWebrtcPortConflict({
    requestedOwnerName: "new",
    nodeName: "node-01",
    deployments: [],
    pods: [
      {
        metadata: {
          name: "isaac-station-failed-123",
          labels: { "cola.isaac/station-name": "failed" },
          annotations: { "cola.isaac/mode": "headless-webrtc" },
        },
        spec: {
          nodeName: "node-01",
          hostNetwork: true,
          containers: [{ ports: [{ containerPort: 8011 }] }],
        },
        status: { phase: "Failed" },
      },
      {
        metadata: {
          name: "isaac-station-running-123",
          labels: { "cola.isaac/station-name": "running" },
          annotations: { "cola.isaac/mode": "headless-webrtc" },
        },
        spec: {
          nodeName: "node-01",
          hostNetwork: true,
          containers: [{ ports: [{ containerPort: 8011 }] }],
        },
        status: { phase: "Running" },
      },
    ],
  });

  assert.equal(conflict?.kind, "Pod");
  assert.deepEqual(conflict?.owner, { type: "station", name: "running" });
});

void test("formats conflict message with the owning station", () => {
  assert.equal(
    formatHeadlessWebrtcPortConflict({
      kind: "Deployment",
      resourceName: "isaac-station-existing",
      owner: { type: "station", name: "existing" },
      nodeName: "node-01",
      port: 8011,
    }),
    "节点 node-01 的 WebRTC 端口 8011/TCP 已被 Isaac Station existing 占用。请先停止占用该端口的任务，或改用非 WebRTC 模式。",
  );
});
