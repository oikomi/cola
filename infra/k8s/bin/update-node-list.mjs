import { readClusterData, nodesPath, writeJson } from "./cluster-utils.mjs";
import { parseArgs, requireArgs } from "./cli-utils.mjs";

const args = parseArgs(process.argv);

requireArgs(args, ["name", "ip", "ssh-user", "ssh-password", "roles", "arch"]);

const sshPort = args["ssh-port"] ? Number(args["ssh-port"]) : 22;
if (!Number.isInteger(sshPort) || sshPort <= 0 || sshPort > 65535) {
  throw new Error("--ssh-port 非法");
}

const roles = args.roles
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const { config, nodes } = readClusterData();
const nextNode = {
  name: args.name,
  ip: args.ip,
  sshUser: args["ssh-user"],
  sshPassword: args["ssh-password"],
  sshPort,
  roles,
  arch: args.arch,
};

const existingByName = nodes.find((node) => node.name === args.name);
const existingByIp = nodes.find((node) => node.ip === args.ip);

if (
  existingByName &&
  JSON.stringify(existingByName) === JSON.stringify(nextNode)
) {
  console.log(
    `Node ${args.name} (${args.ip}) already exists in cluster/nodes.json for cluster ${config.clusterName}`,
  );
  process.exit(0);
}

if (
  existingByIp &&
  JSON.stringify(existingByIp) === JSON.stringify(nextNode)
) {
  console.log(
    `Node ${args.name} (${args.ip}) already exists in cluster/nodes.json for cluster ${config.clusterName}`,
  );
  process.exit(0);
}

if (existingByName) {
  throw new Error(`节点名已存在且配置不一致: ${args.name}`);
}
if (existingByIp) {
  throw new Error(`节点 IP 已存在且配置不一致: ${args.ip}`);
}

const updated = [
  ...nodes,
  nextNode,
];

writeJson(nodesPath, updated);

console.log(
  `Added node ${args.name} (${args.ip}) to cluster/nodes.json for cluster ${config.clusterName}`,
);
