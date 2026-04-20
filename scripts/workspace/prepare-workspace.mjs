import { readClusterData } from "../../infra/remote-work/bin/cluster-utils.mjs";
import { parseArgs, readJsonFile, requireArgs } from "./cli-utils.mjs";
import { prepareWorkspace } from "./workspace-utils.mjs";

const args = parseArgs(process.argv);

requireArgs(args, [
  "cluster-nodes-json",
  "deployments-json",
  "services-json",
  "gpu-label-key",
  "workspace-label-key",
  "name",
  "image",
]);

const { config, nodes } = readClusterData();

const clusterNodes = readJsonFile(args["cluster-nodes-json"], { items: [] });
const deployments = readJsonFile(args["deployments-json"], { items: [] });
const services = readJsonFile(args["services-json"], { items: [] });

const plan = prepareWorkspace({
  config,
  nodes,
  clusterNodes,
  deployments,
  services,
  request: {
    name: args.name,
    requestedNode: args["requested-node"] ?? "",
    password: args.password ?? "",
    disablePassword: args["disable-password"] === "1",
    image: args.image,
    gpu: args.gpu ?? "0",
    nodePort: args["node-port"] ?? "",
    resolution: args.resolution ?? "1920x1080x24",
    ingressHost: args["ingress-host"] ?? "",
    tlsSecret: args["tls-secret"] ?? "",
    cpuRequest: args["cpu-request"] ?? "2",
    cpuLimit: args["cpu-limit"] ?? "4",
    memoryRequest: args["memory-request"] ?? "4Gi",
    memoryLimit: args["memory-limit"] ?? "8Gi",
    timezone: args.timezone ?? "Asia/Shanghai",
    workspaceRoot: args["workspace-root"] ?? "/var/lib/remote-work/workspaces",
    gpuLabelKey: args["gpu-label-key"],
    workspaceLabelKey: args["workspace-label-key"],
    out: args.out || undefined,
  },
});

console.log(JSON.stringify(plan));
