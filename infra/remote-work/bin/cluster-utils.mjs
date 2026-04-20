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

  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error("cluster/nodes.json 至少需要包含一台机器。");
  }

  const allowedRoles = new Set(["master", "etcd", "worker", "gpu"]);
  const seenNames = new Set();
  const seenIps = new Set();

  for (const node of nodes) {
    if (!isObject(node)) {
      throw new Error("cluster/nodes.json 中的节点项必须是 JSON object。");
    }

    const { name, ip, sshUser, sshPassword, sshPort, roles } = node;
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

