import { readClusterData, nodesPath, writeJson } from "./cluster-utils.mjs";

function parseArgs(argv) {
  const args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`无法解析参数: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`参数 ${token} 缺少值`);
    }
    args[key] = value;
    index += 1;
  }

  return args;
}

const args = parseArgs(process.argv);

for (const key of ["name", "ip", "ssh-user", "ssh-password", "roles", "arch"]) {
  if (!args[key]) {
    throw new Error(`缺少必要参数 --${key}`);
  }
}

const sshPort = args["ssh-port"] ? Number(args["ssh-port"]) : 22;
if (!Number.isInteger(sshPort) || sshPort <= 0 || sshPort > 65535) {
  throw new Error("--ssh-port 非法");
}

const roles = args.roles
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const { config, nodes } = readClusterData();

if (nodes.some((node) => node.name === args.name)) {
  throw new Error(`节点名已存在: ${args.name}`);
}
if (nodes.some((node) => node.ip === args.ip)) {
  throw new Error(`节点 IP 已存在: ${args.ip}`);
}

const updated = [
  ...nodes,
  {
    name: args.name,
    ip: args.ip,
    sshUser: args["ssh-user"],
    sshPassword: args["ssh-password"],
    sshPort,
    roles,
    arch: args.arch,
  },
];

writeJson(nodesPath, updated);

console.log(
  `Added node ${args.name} (${args.ip}) to cluster/nodes.json for cluster ${config.clusterName}`,
);
