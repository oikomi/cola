import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateClusterData } from "./cluster-utils.mjs";
import {
  inspectHarbor,
  renderRegistryHostFiles,
  resolveHarborConfig,
  writeRegistryHostFiles,
} from "./registry-cache.mjs";

const nodes = [
  {
    name: "master-01",
    ip: "172.16.60.198",
    sshUser: "user",
    sshPassword: "secret",
    sshPort: 22,
    roles: ["master", "etcd", "worker"],
    arch: "amd64",
  },
];

function configFixture() {
  return {
    clusterName: "test-cluster",
    kubeaszVersion: "3.6.9",
    kubernetesVersion: "1.34.7",
    kubeaszRepoUrl: "https://github.com/easzlab/kubeasz.git",
    workspaceNamespace: "remote-work",
    workspaceLabelKey: "remote-work/workspace",
    gpuLabelKey: "remote-work/gpu",
    harbor: {
      url: "http://172.16.60.198:21726/",
      proxyCaches: [
        {
          registry: "docker.io",
          server: "https://registry-1.docker.io/",
          project: "proxy-dockerhub",
          endpoint: {
            name: "dockerhub-daocloud",
            type: "docker-registry",
            url: "https://docker.m.daocloud.io/",
            insecure: false,
          },
        },
        {
          registry: "quay.io",
          server: "https://quay.io",
          project: "proxy-quay",
          endpoint: {
            name: "quay",
            type: "docker-registry",
            url: "https://quay.io",
            insecure: false,
          },
        },
      ],
    },
  };
}

test("normalizes Harbor and upstream URLs", () => {
  const harbor = resolveHarborConfig(configFixture());

  assert.equal(harbor.url, "http://172.16.60.198:21726");
  assert.equal(harbor.host, "172.16.60.198:21726");
  assert.equal(harbor.proxyCaches[0].server, "https://registry-1.docker.io");
  assert.equal(
    harbor.proxyCaches[0].endpoint.url,
    "https://docker.m.daocloud.io",
  );
});

test("renders transparent proxy hosts and direct Harbor access", () => {
  const harbor = resolveHarborConfig(configFixture());
  const files = renderRegistryHostFiles(harbor);
  const dockerHosts = files.get("docker.io/hosts.toml");
  const harborHosts = files.get("172.16.60.198:21726/hosts.toml");

  assert.equal(files.size, 3);
  assert.match(
    dockerHosts,
    /http:\/\/172\.16\.60\.198:21726\/v2\/proxy-dockerhub/,
  );
  assert.match(dockerHosts, /override_path = true/);
  assert.doesNotMatch(dockerHosts, /"push"/);
  assert.match(harborHosts, /capabilities = \["pull", "resolve", "push"\]/);
});

test("writes a deterministic managed registry list and checksums", (t) => {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cola-registry-test-"),
  );
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const manifest = writeRegistryHostFiles(
    resolveHarborConfig(configFixture()),
    outputDir,
  );
  const managed = fs
    .readFileSync(path.join(outputDir, ".managed-registries"), "utf8")
    .trim()
    .split("\n");

  assert.deepEqual(managed, ["docker.io", "quay.io", "172.16.60.198:21726"]);
  assert.equal(manifest.files.length, 3);
  assert.ok(
    manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)),
  );
});

test("cluster validation rejects duplicate proxy registries", () => {
  const config = configFixture();
  config.harbor.proxyCaches.push({
    ...config.harbor.proxyCaches[0],
    project: "another-project",
    endpoint: {
      ...config.harbor.proxyCaches[0].endpoint,
      name: "another-endpoint",
    },
  });

  assert.throws(
    () => validateClusterData(config, nodes),
    /harbor\.proxyCaches registry 重复: docker\.io/,
  );
});

test("authenticated status rejects a healthy endpoint with config drift", async (t) => {
  const config = configFixture();
  config.harbor.proxyCaches = config.harbor.proxyCaches.slice(0, 1);
  const harbor = resolveHarborConfig(config);
  const originalFetch = globalThis.fetch;
  const originalConsoleLog = console.log;

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
  });
  console.log = () => {};
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    let data;

    if (url.pathname.endsWith("/health")) {
      data = { status: "healthy" };
    } else if (url.pathname.endsWith("/systeminfo")) {
      data = { harbor_version: "v2.test" };
    } else if (url.pathname.endsWith("/registries")) {
      data = [
        {
          id: 1,
          name: "dockerhub-daocloud",
          type: "docker-registry",
          url: "https://unexpected.example.com",
          status: "healthy",
        },
      ];
    } else if (url.pathname.endsWith("/projects/proxy-dockerhub")) {
      data = {
        name: "proxy-dockerhub",
        registry_id: 1,
        repo_count: 1,
        metadata: { public: "true" },
      };
    } else {
      return new Response(null, { status: 404 });
    }

    return Response.json(data);
  };

  await assert.rejects(
    inspectHarbor(harbor, { username: "admin", password: "secret" }),
    /Harbor 代理缓存状态不完整/,
  );
});
