import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GENERATED_DIR, readClusterData } from "./cluster-utils.mjs";

export const DEFAULT_REGISTRY_RENDER_DIR = path.join(
  GENERATED_DIR,
  "registry-mirrors",
);

function normalizeUrl(value) {
  return value.replace(/\/+$/, "");
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

export function resolveHarborConfig(config) {
  if (!config.harbor) {
    throw new Error(
      "infra/k8s/cluster/config.json 未配置 harbor，无法配置镜像代理。",
    );
  }

  const url = normalizeUrl(config.harbor.url);
  const parsedUrl = new URL(url);

  return {
    url,
    host: parsedUrl.host,
    proxyCaches: config.harbor.proxyCaches.map((cache) => ({
      registry: cache.registry,
      server: normalizeUrl(cache.server),
      project: cache.project,
      endpoint: {
        name: cache.endpoint.name,
        type: cache.endpoint.type,
        url: normalizeUrl(cache.endpoint.url),
        insecure: cache.endpoint.insecure === true,
      },
    })),
  };
}

function renderProxyHosts(harbor, cache) {
  const proxyRoot = `${harbor.url}/v2/${cache.project}`;
  return [
    "# Managed by ./bin/cluster.sh registry configure.",
    `# ${cache.registry} -> Harbor project ${cache.project}`,
    `server = ${tomlString(cache.server)}`,
    "",
    `[host.${tomlString(proxyRoot)}]`,
    '  capabilities = ["pull", "resolve"]',
    "  override_path = true",
    "",
  ].join("\n");
}

function renderHarborHosts(harbor) {
  return [
    "# Managed by ./bin/cluster.sh registry configure.",
    `server = ${tomlString(harbor.url)}`,
    "",
    `[host.${tomlString(harbor.url)}]`,
    '  capabilities = ["pull", "resolve", "push"]',
    "",
  ].join("\n");
}

export function renderRegistryHostFiles(harbor) {
  const files = new Map();

  for (const cache of harbor.proxyCaches) {
    files.set(
      path.join(cache.registry, "hosts.toml"),
      renderProxyHosts(harbor, cache),
    );
  }

  files.set(path.join(harbor.host, "hosts.toml"), renderHarborHosts(harbor));
  return files;
}

export function writeRegistryHostFiles(harbor, outputDir) {
  const files = renderRegistryHostFiles(harbor);
  const managedRegistries = [...files.keys()].map((file) => path.dirname(file));
  const manifest = {
    harborUrl: harbor.url,
    generatedAt: new Date().toISOString(),
    files: [...files.entries()].map(([file, content]) => ({
      file,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
    })),
  };

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  for (const [relativePath, content] of files) {
    const targetPath = path.join(outputDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
  }

  fs.writeFileSync(
    path.join(outputDir, ".managed-registries"),
    `${managedRegistries.join("\n")}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

function errorMessage(data, fallback) {
  const messages = data?.errors
    ?.map((error) => error?.message)
    .filter((message) => typeof message === "string" && message.length > 0);
  return messages?.length ? messages.join("; ") : fallback;
}

class HarborClient {
  constructor({ baseUrl, username, password }) {
    this.baseUrl = normalizeUrl(baseUrl);
    this.authorization =
      username && password
        ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
        : null;
  }

  async request(apiPath, options = {}) {
    const method = options.method ?? "GET";
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(this.authorization ? { Authorization: this.authorization } : {}),
    };
    const response = await fetch(`${this.baseUrl}/api/v2.0${apiPath}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const source = await response.text();
    let data = null;

    if (source) {
      try {
        data = JSON.parse(source);
      } catch {
        data = source;
      }
    }

    if (!response.ok) {
      if (options.allowNotFound && response.status === 404) {
        return null;
      }
      throw new Error(
        `Harbor ${method} ${apiPath} 失败 (${response.status}): ${errorMessage(
          data,
          response.statusText,
        )}`,
      );
    }

    return { data, headers: response.headers, status: response.status };
  }

  async list(apiPath) {
    const result = [];
    const separator = apiPath.includes("?") ? "&" : "?";

    for (let page = 1; ; page += 1) {
      const response = await this.request(
        `${apiPath}${separator}page=${page}&page_size=100`,
      );
      const items = Array.isArray(response.data) ? response.data : [];
      result.push(...items);
      if (items.length < 100) break;
    }

    return result;
  }
}

function registryMatches(existing, endpoint) {
  return (
    existing.type === endpoint.type &&
    normalizeUrl(existing.url) === endpoint.url &&
    (existing.insecure === true) === endpoint.insecure
  );
}

function describeEndpoint(endpoint) {
  return `${endpoint.name} (${endpoint.type}, ${endpoint.url})`;
}

async function pingEndpoint(client, endpoint) {
  await client.request("/registries/ping", {
    method: "POST",
    body: {
      type: endpoint.type,
      url: endpoint.url,
      insecure: endpoint.insecure,
    },
  });
}

async function reconcileEndpoint(client, cache, registries, dryRun) {
  const endpoint = cache.endpoint;
  let existing = registries.find((item) => item.name === endpoint.name);

  if (existing && !registryMatches(existing, endpoint)) {
    throw new Error(
      `Harbor 端点 ${endpoint.name} 已存在但配置不同。现有: ${existing.type} ${existing.url} insecure=${existing.insecure}；期望: ${endpoint.type} ${endpoint.url} insecure=${endpoint.insecure}`,
    );
  }

  await pingEndpoint(client, endpoint);

  if (existing) {
    console.log(`端点正常: ${describeEndpoint(endpoint)}`);
    return existing;
  }

  if (dryRun) {
    console.log(`[dry-run] 将创建端点: ${describeEndpoint(endpoint)}`);
    return null;
  }

  await client.request("/registries", {
    method: "POST",
    body: {
      name: endpoint.name,
      type: endpoint.type,
      url: endpoint.url,
      insecure: endpoint.insecure,
      description: `Managed proxy upstream for ${cache.registry}`,
    },
  });

  const refreshed = await client.list("/registries");
  existing = refreshed.find((item) => item.name === endpoint.name);
  if (!existing) {
    throw new Error(`Harbor 已返回创建成功，但未找到端点 ${endpoint.name}。`);
  }
  registries.splice(0, registries.length, ...refreshed);
  console.log(`已创建端点: ${describeEndpoint(endpoint)}`);
  return existing;
}

function projectRegistryId(project) {
  const value = Number(project?.registry_id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function reconcileProject(client, cache, endpoint, projects, dryRun) {
  const existing = projects.find((item) => item.name === cache.project);
  const endpointId = endpoint?.id ? Number(endpoint.id) : null;

  if (existing) {
    const existingRegistryId = projectRegistryId(existing);
    if (
      !existingRegistryId ||
      (endpointId && existingRegistryId !== endpointId)
    ) {
      throw new Error(
        `Harbor 项目 ${cache.project} 已存在，但不是绑定端点 ${cache.endpoint.name} 的代理缓存项目。`,
      );
    }
    if (existing.metadata?.public !== "true") {
      throw new Error(
        `Harbor 代理项目 ${cache.project} 不是公开项目，containerd 无法匿名使用。`,
      );
    }
    console.log(`代理项目正常: ${cache.project} -> ${cache.endpoint.name}`);
    return;
  }

  if (dryRun) {
    console.log(
      `[dry-run] 将创建公开代理项目: ${cache.project} -> ${cache.endpoint.name}`,
    );
    return;
  }
  if (!endpointId) {
    throw new Error(`创建代理项目 ${cache.project} 时缺少有效 registry_id。`);
  }

  await client.request("/projects", {
    method: "POST",
    body: {
      project_name: cache.project,
      public: true,
      metadata: { public: "true" },
      registry_id: endpointId,
      storage_limit: -1,
    },
  });
  console.log(`已创建公开代理项目: ${cache.project} -> ${cache.endpoint.name}`);
}

export async function reconcileHarbor(harbor, options = {}) {
  const username =
    options.username ?? process.env.COLA_HARBOR_USERNAME ?? "admin";
  const password = options.password ?? process.env.COLA_HARBOR_PASSWORD;
  if (!password) {
    throw new Error("缺少 COLA_HARBOR_PASSWORD，无法修改 Harbor 配置。");
  }

  const client = new HarborClient({ baseUrl: harbor.url, username, password });
  const health = await client.request("/health");
  if (health.data?.status !== "healthy") {
    throw new Error(`Harbor 当前状态不是 healthy: ${health.data?.status}`);
  }

  const registries = await client.list("/registries");
  const projects = await client.list("/projects?with_detail=true");

  for (const cache of harbor.proxyCaches) {
    const endpoint = await reconcileEndpoint(
      client,
      cache,
      registries,
      options.dryRun === true,
    );
    await reconcileProject(
      client,
      cache,
      endpoint,
      projects,
      options.dryRun === true,
    );
  }
}

export async function inspectHarbor(harbor, options = {}) {
  const client = new HarborClient({
    baseUrl: harbor.url,
    username: options.username ?? process.env.COLA_HARBOR_USERNAME ?? "admin",
    password: options.password ?? process.env.COLA_HARBOR_PASSWORD,
  });
  const health = await client.request("/health");
  const systemInfo = await client.request("/systeminfo");
  let healthy = health.data?.status === "healthy";

  console.log(
    `Harbor: ${systemInfo.data?.harbor_version ?? "unknown"} ${harbor.url} (${health.data?.status ?? "unknown"})`,
  );

  let registries = [];
  if (client.authorization) {
    registries = await client.list("/registries");
  }

  for (const cache of harbor.proxyCaches) {
    const projectResponse = await client.request(
      `/projects/${encodeURIComponent(cache.project)}`,
      { allowNotFound: true },
    );
    const project = projectResponse?.data;
    const endpoint = registries.find(
      (item) => item.name === cache.endpoint.name,
    );
    const endpointMatches =
      !client.authorization ||
      (endpoint?.status === "healthy" &&
        registryMatches(endpoint, cache.endpoint));
    const projectReady =
      project &&
      project.metadata?.public === "true" &&
      projectRegistryId(project) !== null &&
      (!client.authorization ||
        (endpoint && projectRegistryId(project) === Number(endpoint.id)));

    console.log(
      `${projectReady && endpointMatches ? "ok" : "missing"}: ${cache.registry} -> ${cache.project} -> ${cache.endpoint.name}${
        endpoint ? ` (${endpoint.status})` : ""
      } repos=${project?.repo_count ?? 0}`,
    );
    healthy = healthy && projectReady && endpointMatches;
  }

  if (!client.authorization) {
    console.log("提示: 设置 COLA_HARBOR_PASSWORD 可同时检查上游端点健康状态。");
  }

  if (!healthy) {
    throw new Error("Harbor 代理缓存状态不完整。");
  }
}

function parseCliArgs(argv) {
  const args = { dryRun: false, out: DEFAULT_REGISTRY_RENDER_DIR };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("参数 --out 缺少路径。");
      }
      args.out = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`未知参数: ${token}`);
  }

  return args;
}

async function main() {
  const command = process.argv[2];
  const args = parseCliArgs(process.argv.slice(3));
  const { config } = readClusterData();
  const harbor = resolveHarborConfig(config);

  switch (command) {
    case "render": {
      const manifest = writeRegistryHostFiles(harbor, args.out);
      console.log(
        `已渲染 ${manifest.files.length} 个 registry hosts 配置到 ${args.out}`,
      );
      break;
    }
    case "reconcile":
      await reconcileHarbor(harbor, { dryRun: args.dryRun });
      break;
    case "status":
      await inspectHarbor(harbor);
      break;
    default:
      throw new Error(
        "Usage: node ./bin/registry-cache.mjs <render|reconcile|status> [--dry-run] [--out <dir>]",
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
