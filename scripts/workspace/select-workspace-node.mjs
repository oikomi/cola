import { parseArgs, readJsonFile, requireArgs } from "./cli-utils.mjs";
import {
  resolveWorkspaceNodePort,
  selectWorkspaceNode,
} from "./workspace-utils.mjs";

const args = parseArgs(process.argv);
requireArgs(args, [
  "nodes-json",
  "cluster-nodes-json",
  "deployments-json",
  "gpu",
  "gpu-label-key",
  "workspace-label-key",
]);

const configuredNodes = readJsonFile(args["nodes-json"]);
const clusterNodes = readJsonFile(args["cluster-nodes-json"], { items: [] });
const deployments = readJsonFile(args["deployments-json"], { items: [] });
const services = args["services-json"]
  ? readJsonFile(args["services-json"], { items: [] })
  : { items: [] };

const result = selectWorkspaceNode({
  configuredNodes,
  clusterNodes,
  deployments,
  requestGpu: Number(args.gpu),
  requestedNode: args["requested-node"] ?? "",
  gpuLabelKey: args["gpu-label-key"],
  workspaceLabelKey: args["workspace-label-key"],
});

if (args["services-json"] || args["node-port"]) {
  result.nodePort = resolveWorkspaceNodePort(services, args["node-port"] ?? "");
}

console.log(JSON.stringify(result));
