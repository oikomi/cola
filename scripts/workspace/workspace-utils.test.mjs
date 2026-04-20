import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkspaceAccessUrl,
  buildWorkspaceManifest,
  prepareWorkspace,
  resolveWorkspaceNodePort,
  selectWorkspaceNode,
} from "./workspace-utils.mjs";

const config = {
  workspaceNamespace: "remote-work",
};

const nodes = [
  {
    name: "worker-a",
    ip: "10.0.0.10",
    roles: ["worker"],
  },
  {
    name: "worker-b",
    ip: "10.0.0.11",
    roles: ["worker", "gpu"],
  },
];

test("selectWorkspaceNode prefers labeled least-loaded ready node", () => {
  const selection = selectWorkspaceNode({
    configuredNodes: nodes,
    clusterNodes: {
      items: [
        {
          metadata: {
            name: "worker-a",
            labels: {
              "remote-work/workspace": "true",
            },
          },
          status: {
            conditions: [{ type: "Ready", status: "True" }],
            allocatable: {},
          },
        },
        {
          metadata: {
            name: "worker-b",
            labels: {
              "remote-work/workspace": "true",
              "remote-work/gpu": "true",
            },
          },
          status: {
            conditions: [{ type: "Ready", status: "True" }],
            allocatable: {
              "nvidia.com/gpu": "1",
            },
          },
        },
      ],
    },
    deployments: {
      items: [
        {
          metadata: { name: "workspace-alice" },
          spec: {
            template: {
              spec: {
                nodeSelector: {
                  "kubernetes.io/hostname": "worker-b",
                },
              },
            },
          },
        },
      ],
    },
    requestGpu: 0,
    requestedNode: "",
    gpuLabelKey: "remote-work/gpu",
    workspaceLabelKey: "remote-work/workspace",
  });

  assert.equal(selection.nodeName, "worker-a");
  assert.equal(selection.workspaceCount, 0);
});

test("resolveWorkspaceNodePort skips used ports", () => {
  const nodePort = resolveWorkspaceNodePort(
    {
      items: [
        {
          spec: {
            ports: [{ nodePort: 32080 }, { nodePort: 32081 }],
          },
        },
      ],
    },
    "",
  );

  assert.equal(nodePort, 32082);
});

test("buildWorkspaceManifest emits ingress and gpu runtime when requested", () => {
  const { manifest, normalizedNodePort } = buildWorkspaceManifest({
    config,
    nodes,
    name: "alice",
    nodeName: "worker-b",
    image: "remote-workspace:test",
    gpu: 1,
    nodePort: 32090,
    allowGpuNode: false,
    ingressHost: "alice.example.com",
    tlsSecret: "alice-tls",
  });

  assert.equal(normalizedNodePort, 32090);
  assert.match(manifest, /runtimeClassName: nvidia/);
  assert.match(manifest, /host: alice\.example\.com/);
  assert.match(manifest, /secretName: alice-tls/);
});

test("prepareWorkspace returns manifest path and access url", () => {
  const plan = prepareWorkspace({
    config,
    nodes,
    clusterNodes: {
      items: [
        {
          metadata: {
            name: "worker-a",
            labels: { "remote-work/workspace": "true" },
          },
          status: {
            conditions: [{ type: "Ready", status: "True" }],
            allocatable: {},
          },
        },
      ],
    },
    deployments: { items: [] },
    services: { items: [] },
    request: {
      name: "bob",
      image: "remote-workspace:test",
      gpu: "0",
      password: "",
      disablePassword: true,
      gpuLabelKey: "remote-work/gpu",
      workspaceLabelKey: "remote-work/workspace",
      resolution: "1920x1080x24",
      cpuRequest: "2",
      cpuLimit: "4",
      memoryRequest: "4Gi",
      memoryLimit: "8Gi",
      timezone: "Asia/Shanghai",
      workspaceRoot: "/var/lib/remote-work/workspaces",
      ingressHost: "",
      tlsSecret: "",
      out: "/tmp/bob-workspace-test.yaml",
    },
  });

  assert.equal(plan.nodeName, "worker-a");
  assert.equal(plan.nodePort, 32080);
  assert.equal(
    plan.accessUrl,
    buildWorkspaceAccessUrl({
      ingressHost: "",
      tlsSecret: "",
      nodeIp: "10.0.0.10",
      nodePort: 32080,
    }),
  );
  assert.equal(plan.manifestPath, "/tmp/bob-workspace-test.yaml");
});
