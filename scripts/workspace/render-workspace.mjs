import fs from "node:fs";
import path from "node:path";
import { readClusterData } from "../../infra/remote-work/bin/cluster-utils.mjs";
import { parseArgs, requireArgs } from "./cli-utils.mjs";
import { buildWorkspaceManifest } from "./workspace-utils.mjs";
import {
  WORKSPACE_MANIFEST_DIR,
  ensureWorkspaceManifestDir,
} from "./paths.mjs";

const args = parseArgs(process.argv);

requireArgs(args, ["name", "node", "image", "node-port"]);

const { config, nodes } = readClusterData();
const { manifest } = buildWorkspaceManifest({
  config,
  nodes,
  name: args.name,
  nodeName: args.node,
  image: args.image,
  gpu: args.gpu ?? "0",
  nodePort: args["node-port"],
  resolution: args.resolution ?? "1920x1080x24",
  cpuRequest: args["cpu-request"] ?? "2",
  cpuLimit: args["cpu-limit"] ?? "4",
  memoryRequest: args["memory-request"] ?? "4Gi",
  memoryLimit: args["memory-limit"] ?? "8Gi",
  timezone: args.timezone ?? "Asia/Shanghai",
  workspaceRoot: args["workspace-root"] ?? "/var/lib/remote-work/workspaces",
  password: args.password ?? "",
  disablePassword: args["disable-password"] === "1",
  allowGpuNode: args["allow-gpu-node"] === "1",
  ingressHost: args["ingress-host"] ?? "",
  tlsSecret: args["tls-secret"] ?? "",
});

ensureWorkspaceManifestDir();
const outFile =
  args.out ?? path.join(WORKSPACE_MANIFEST_DIR, `${args.name}.yaml`);
fs.writeFileSync(outFile, `${manifest}\n`, "utf8");

console.log(outFile);
