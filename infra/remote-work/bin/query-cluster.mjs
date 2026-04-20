import { findNode, firstMaster, readClusterData } from "./cluster-utils.mjs";

const { config, nodes } = readClusterData();
const command = process.argv[2];
const needle = process.argv[3];

if (!command) {
  console.error("Usage: node query-cluster.mjs <command> [nodeName]");
  process.exit(1);
}

function printLines(values) {
  for (const value of values) {
    console.log(value);
  }
}

switch (command) {
  case "clusterName":
  case "kubeaszVersion":
  case "kubernetesVersion":
  case "kubeaszRepoUrl":
  case "workspaceNamespace":
  case "workspaceLabelKey":
  case "gpuLabelKey":
    console.log(config[command]);
    break;

  case "nodeNames":
    printLines(nodes.map((node) => node.name));
    break;

  case "gpuNodeNames":
    printLines(
      nodes.filter((node) => node.roles.includes("gpu")).map((node) => node.name),
    );
    break;

  case "masterNodeNames":
    printLines(
      nodes
        .filter((node) => node.roles.includes("master"))
        .map((node) => node.name),
    );
    break;

  case "firstMasterName":
    console.log(firstMaster(nodes).name);
    break;

  case "firstMasterIp":
    console.log(firstMaster(nodes).ip);
    break;

  case "firstMasterUser":
    console.log(firstMaster(nodes).sshUser);
    break;

  case "firstMasterPassword":
    console.log(firstMaster(nodes).sshPassword);
    break;

  case "firstMasterPort":
    console.log(firstMaster(nodes).sshPort);
    break;

  case "nodeIp":
    console.log(findNode(nodes, needle).ip);
    break;

  case "nodeUser":
    console.log(findNode(nodes, needle).sshUser);
    break;

  case "nodePassword":
    console.log(findNode(nodes, needle).sshPassword);
    break;

  case "nodePort":
    console.log(findNode(nodes, needle).sshPort);
    break;

  case "nodeRoles":
    console.log(findNode(nodes, needle).roles.join(","));
    break;

  default:
    console.error(`不支持的 query 命令: ${command}`);
    process.exit(1);
}

