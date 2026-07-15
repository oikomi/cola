import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..");
export const CLUSTER_DIR = path.join(ROOT_DIR, "cluster");
export const RUNTIME_DIR = path.join(ROOT_DIR, "runtime");
export const GENERATED_DIR = path.join(RUNTIME_DIR, "generated");
export const WORKSPACE_DIR = path.join(RUNTIME_DIR, "workspaces");
export const KUBEASZ_DIR = path.join(RUNTIME_DIR, "kubeasz");
export const configPath = path.join(CLUSTER_DIR, "config.json");
export const nodesPath = path.join(CLUSTER_DIR, "nodes.json");

export function normalizeArch(value) {
  switch (value) {
    case "x86_64":
    case "amd64":
    case "x64":
      return "amd64";
    case "aarch64":
    case "arm64":
      return "arm64";
    default:
      return value;
  }
}

export function localArch() {
  return normalizeArch(process.arch);
}

export function ensureRuntimeDirs() {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseHttpUrl(value, fieldName, { requireRootPath = false } = {}) {
  if (typeof value !== "string" || value.trim() !== value || !value) {
    throw new Error(`${fieldName} 必须是非空 HTTP(S) URL。`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${fieldName} 不是合法 URL: ${value}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${fieldName} 只支持 http 或 https: ${value}`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${fieldName} 不能包含凭证、query 或 fragment。`);
  }
  if (requireRootPath && parsed.pathname !== "/") {
    throw new Error(`${fieldName} 不能包含路径: ${value}`);
  }

  return parsed;
}

function validateHarborConfig(harbor) {
  if (!isObject(harbor)) {
    throw new Error("cluster/config.json 中的 harbor 必须是 JSON object。");
  }

  parseHttpUrl(harbor.url, "cluster/config.json harbor.url", {
    requireRootPath: true,
  });

  if (!Array.isArray(harbor.proxyCaches) || harbor.proxyCaches.length === 0) {
    throw new Error(
      "cluster/config.json harbor.proxyCaches 至少需要配置一个代理缓存。",
    );
  }

  const seenRegistries = new Set();
  const seenProjects = new Set();
  const seenEndpoints = new Set();
  const registryPattern =
    /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::[1-9][0-9]{0,4})?$/;
  const harborNamePattern = /^[a-z0-9][a-z0-9._-]*$/;

  for (const cache of harbor.proxyCaches) {
    if (!isObject(cache)) {
      throw new Error("harbor.proxyCaches 中的每一项都必须是 JSON object。");
    }

    const { registry, server, project, endpoint } = cache;
    if (typeof registry !== "string" || !registryPattern.test(registry)) {
      throw new Error(`harbor.proxyCaches registry 非法: ${registry}`);
    }
    if (seenRegistries.has(registry)) {
      throw new Error(`harbor.proxyCaches registry 重复: ${registry}`);
    }
    seenRegistries.add(registry);

    parseHttpUrl(server, `harbor.proxyCaches[${registry}].server`);

    if (typeof project !== "string" || !harborNamePattern.test(project)) {
      throw new Error(`Harbor 代理项目名非法: ${project}`);
    }
    if (seenProjects.has(project)) {
      throw new Error(`Harbor 代理项目名重复: ${project}`);
    }
    seenProjects.add(project);

    if (!isObject(endpoint)) {
      throw new Error(
        `harbor.proxyCaches[${registry}].endpoint 必须是 object。`,
      );
    }
    if (
      typeof endpoint.name !== "string" ||
      !harborNamePattern.test(endpoint.name)
    ) {
      throw new Error(`Harbor 上游端点名非法: ${endpoint.name}`);
    }
    if (seenEndpoints.has(endpoint.name)) {
      throw new Error(`Harbor 上游端点名重复: ${endpoint.name}`);
    }
    seenEndpoints.add(endpoint.name);

    if (typeof endpoint.type !== "string" || !endpoint.type.trim()) {
      throw new Error(`Harbor 上游端点 ${endpoint.name} 缺少 type。`);
    }
    parseHttpUrl(endpoint.url, `harbor.proxyCaches[${registry}].endpoint.url`);
    if (
      "insecure" in endpoint &&
      endpoint.insecure !== undefined &&
      typeof endpoint.insecure !== "boolean"
    ) {
      throw new Error(
        `Harbor 上游端点 ${endpoint.name} 的 insecure 必须是布尔值。`,
      );
    }
  }
}

export function validateClusterData(config, nodes) {
  if (!isObject(config)) {
    throw new Error("cluster/config.json 必须是一个 JSON object。");
  }

  const requiredConfigKeys = [
    "clusterName",
    "kubeaszVersion",
    "kubernetesVersion",
    "kubeaszRepoUrl",
    "workspaceNamespace",
    "workspaceLabelKey",
    "gpuLabelKey",
  ];

  for (const key of requiredConfigKeys) {
    if (!config[key] || typeof config[key] !== "string") {
      throw new Error(`cluster/config.json 缺少或错误的字段: ${key}`);
    }
  }

  if (
    "proxyMode" in config &&
    config.proxyMode !== undefined &&
    config.proxyMode !== "iptables" &&
    config.proxyMode !== "ipvs"
  ) {
    throw new Error(
      "cluster/config.json 中的 proxyMode 只支持 iptables 或 ipvs。",
    );
  }

  if (
    "sandboxImage" in config &&
    config.sandboxImage !== undefined &&
    typeof config.sandboxImage !== "string"
  ) {
    throw new Error("cluster/config.json 中的 sandboxImage 必须是字符串。");
  }

  if ("harbor" in config && config.harbor !== undefined) {
    validateHarborConfig(config.harbor);
  }

  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error("cluster/nodes.json 至少需要包含一台机器。");
  }

  const allowedRoles = new Set(["master", "etcd", "worker", "gpu"]);
  const allowedArchs = new Set(["amd64", "arm64"]);
  const seenNames = new Set();
  const seenIps = new Set();

  for (const node of nodes) {
    if (!isObject(node)) {
      throw new Error("cluster/nodes.json 中的节点项必须是 JSON object。");
    }

    const { name, ip, sshUser, sshPassword, sshPort, roles, arch } = node;
    if (!name || typeof name !== "string") {
      throw new Error("每个节点都必须有字符串类型的 name。");
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
      throw new Error(`节点名 ${name} 不符合 Kubernetes 常见命名规则。`);
    }
    if (!ip || typeof ip !== "string") {
      throw new Error(`节点 ${name} 缺少 ip。`);
    }
    if (!sshUser || typeof sshUser !== "string") {
      throw new Error(`节点 ${name} 缺少 sshUser。`);
    }
    if (!sshPassword || typeof sshPassword !== "string") {
      throw new Error(`节点 ${name} 缺少 sshPassword。`);
    }
    if (
      typeof sshPort !== "number" ||
      !Number.isInteger(sshPort) ||
      sshPort <= 0 ||
      sshPort > 65535
    ) {
      throw new Error(`节点 ${name} 的 sshPort 非法。`);
    }
    if (!Array.isArray(roles) || roles.length === 0) {
      throw new Error(`节点 ${name} 至少需要一个 role。`);
    }
    if (!arch || typeof arch !== "string") {
      throw new Error(`节点 ${name} 缺少 arch，必须显式写成 amd64 或 arm64。`);
    }
    if (!allowedArchs.has(normalizeArch(arch))) {
      throw new Error(`节点 ${name} 的 arch 不支持: ${arch}`);
    }

    for (const role of roles) {
      if (!allowedRoles.has(role)) {
        throw new Error(`节点 ${name} 存在不支持的 role: ${role}`);
      }
    }

    if (seenNames.has(name)) {
      throw new Error(`节点名重复: ${name}`);
    }
    if (seenIps.has(ip)) {
      throw new Error(`节点 IP 重复: ${ip}`);
    }

    seenNames.add(name);
    seenIps.add(ip);
  }

  const masters = nodes.filter((node) => node.roles.includes("master"));
  const etcdNodes = nodes.filter((node) => node.roles.includes("etcd"));
  const workers = nodes.filter((node) => node.roles.includes("worker"));

  if (masters.length === 0) {
    throw new Error("至少需要一个 master 节点。");
  }
  if (etcdNodes.length === 0) {
    throw new Error("至少需要一个 etcd 节点。");
  }
  if (workers.length === 0) {
    throw new Error("至少需要一个 worker 节点。");
  }
}

export function readClusterData() {
  const config = readJson(configPath);
  const nodes = readJson(nodesPath);
  validateClusterData(config, nodes);
  return { config, nodes };
}

export function findNode(nodes, needle) {
  const node = nodes.find((item) => item.name === needle || item.ip === needle);
  if (!node) {
    throw new Error(`未找到节点: ${needle}`);
  }
  return node;
}

export function firstMaster(nodes) {
  const master = nodes.find((node) => node.roles.includes("master"));
  if (!master) {
    throw new Error("没有 master 节点。");
  }
  return master;
}

export function nodesForArch(nodes, arch) {
  return nodes.filter(
    (node) => normalizeArch(node.arch) === normalizeArch(arch),
  );
}
