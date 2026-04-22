import fs from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  AppsV1Api,
  CoreV1Api,
  Exec,
  KubeConfig,
  type V1ConfigMap,
  type V1Deployment,
  type V1Namespace,
  type V1Pod,
  type V1Secret,
  type V1Service,
  type V1Status,
  type V1Volume,
} from "@kubernetes/client-node";

import {
  dockerRunnerEngineLabels,
  type DockerRunnerEngine,
} from "@/server/office/catalog";
import type {
  ProvisionRunnerInput,
  ProvisionRunnerResult,
} from "@/server/office/provision-types";

const K8S_INFRA_DIR = path.join(process.cwd(), "infra", "k8s");
const CLUSTER_CONFIG_PATH = path.join(K8S_INFRA_DIR, "cluster", "config.json");
const OPENCLAW_NODE_PORT_START = 31180;
const OPENCLAW_DASHBOARD_PORT = 18789;
const HERMES_NODE_PORT_START = 31280;
const HERMES_DASHBOARD_PORT = 9119;
const RUNNER_CONTAINER_NAME = "runner";
const DASHBOARD_URL_PREFIX = "Dashboard URL: ";

type ClusterConfig = {
  clusterName?: string;
  controllerIp?: string;
};

function readClusterConfig() {
  if (!existsSync(CLUSTER_CONFIG_PATH)) return null;

  return JSON.parse(readFileSync(CLUSTER_CONFIG_PATH, "utf8")) as ClusterConfig;
}

function clusterControllerIp() {
  const controllerIp = readClusterConfig()?.controllerIp?.trim();
  return controllerIp && controllerIp.length > 0 ? controllerIp : null;
}

type KubeClients = {
  appsApi: AppsV1Api;
  coreApi: CoreV1Api;
  kubeConfig: KubeConfig;
};

type MountSpec = {
  workspaceVolume: V1Volume;
  workspaceVolumeName: string;
  workspaceReadOnly: boolean;
};

function slugify(input: string) {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return slug || "agent";
}

function runnerNamespace() {
  return process.env.COLA_K8S_RUNNER_NAMESPACE ?? "cola-runners";
}

function kubeconfigPath() {
  const configured =
    process.env.COLA_K8S_KUBECONFIG?.trim() ??
    process.env.REMOTE_WORK_KUBECONFIG_PATH?.trim() ??
    process.env.WORKSPACE_KUBECONFIG?.trim();
  if (configured) return configured;

  const clusterName = readClusterConfig()?.clusterName?.trim();
  const candidates = [
    clusterName
      ? path.join("/etc/kubeasz", "clusters", clusterName, "kubectl.kubeconfig")
      : null,
    clusterName ? path.join(homedir(), ".kube", `${clusterName}.config`) : null,
    path.join(homedir(), ".kube", "config"),
  ];

  return (
    candidates.find(
      (candidate): candidate is string =>
        candidate !== null && existsSync(candidate),
    ) ?? null
  );
}

function createKubeClients(): KubeClients {
  const kubeConfig = new KubeConfig();
  const configuredPath = kubeconfigPath();

  if (configuredPath) {
    fs.accessSync(configuredPath, fs.constants.R_OK);
    kubeConfig.loadFromFile(configuredPath);
  } else if (process.env.KUBERNETES_SERVICE_HOST) {
    kubeConfig.loadFromCluster();
  } else {
    throw new Error(
      "无法创建 Kubernetes 客户端。请设置 COLA_K8S_KUBECONFIG / REMOTE_WORK_KUBECONFIG_PATH / WORKSPACE_KUBECONFIG，或在集群内运行控制面。",
    );
  }

  return {
    appsApi: kubeConfig.makeApiClient(AppsV1Api),
    coreApi: kubeConfig.makeApiClient(CoreV1Api),
    kubeConfig,
  };
}

function runnerPodSortScore(pod: V1Pod) {
  const isRunning = pod.status?.phase === "Running";
  const runnerContainer = pod.status?.containerStatuses?.find(
    (container) => container.name === RUNNER_CONTAINER_NAME,
  );
  const isReady = Boolean(runnerContainer?.ready);
  const restartCount = runnerContainer?.restartCount ?? 0;
  const startedAt = pod.status?.startTime
    ? new Date(pod.status.startTime).getTime()
    : 0;

  return [
    isReady ? 1 : 0,
    isRunning ? 1 : 0,
    restartCount * -1,
    startedAt,
  ] as const;
}

function compareRunnerPods(left: V1Pod, right: V1Pod) {
  const leftScore = runnerPodSortScore(left);
  const rightScore = runnerPodSortScore(right);
  const [
    leftReady,
    leftRunning,
    leftRestartScore,
    leftStartedAt,
  ] = leftScore;
  const [
    rightReady,
    rightRunning,
    rightRestartScore,
    rightStartedAt,
  ] = rightScore;

  if (leftReady !== rightReady) return rightReady - leftReady;
  if (leftRunning !== rightRunning) return rightRunning - leftRunning;
  if (leftRestartScore !== rightRestartScore) {
    return rightRestartScore - leftRestartScore;
  }
  if (leftStartedAt !== rightStartedAt) return rightStartedAt - leftStartedAt;

  return 0;
}

function firstNonEmptyValue(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function rewriteDashboardUrlForPublicHost(
  dashboardUrl: string,
  publicUrl: string,
) {
  const freshUrl = new URL(dashboardUrl);
  const rewritten = new URL(publicUrl);

  rewritten.pathname = freshUrl.pathname;
  rewritten.search = freshUrl.search;
  rewritten.hash = freshUrl.hash;

  const gatewayUrl = freshUrl.searchParams.get("gatewayUrl");
  if (gatewayUrl) {
    try {
      const gateway = new URL(gatewayUrl);
      gateway.protocol = rewritten.protocol === "https:" ? "wss:" : "ws:";
      gateway.hostname = rewritten.hostname;
      gateway.port = rewritten.port;
      rewritten.searchParams.set("gatewayUrl", gateway.toString());
    } catch {
      rewritten.searchParams.set("gatewayUrl", gatewayUrl);
    }
  }

  return rewritten.toString();
}

async function execOpenClawDashboardUrl(options: {
  namespace: string;
  deploymentName: string;
  nodePort: number;
}) {
  const publicUrl = buildNativeDashboardUrl("openclaw", options.nodePort);
  if (!publicUrl) return null;

  const { coreApi, kubeConfig } = createKubeClients();
  const podList = await coreApi.listNamespacedPod({
    namespace: options.namespace,
    labelSelector: `cola/runner=${options.deploymentName}`,
  });
  const pod = [...(podList.items ?? [])].sort(compareRunnerPods)[0];
  const podName = pod?.metadata?.name?.trim();
  if (!podName) {
    return publicUrl;
  }

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutText = "";
  let stderrText = "";

  stdout.on("data", (chunk) => {
    stdoutText += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  });
  stderr.on("data", (chunk) => {
    stderrText += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  });

  const exec = new Exec(kubeConfig);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const timeout = setTimeout(() => {
      settle(new Error("获取 OpenClaw dashboard URL 超时"));
    }, 5000);

    const handleStatus = (status?: V1Status) => {
      if (status?.status && status.status !== "Success") {
        settle(
          new Error(
            firstNonEmptyValue(
              status.message?.trim(),
              stderrText.trim(),
              stdoutText.trim(),
              "OpenClaw dashboard exec 失败",
            ) ?? "OpenClaw dashboard exec 失败",
          ),
        );
        return;
      }

      settle();
    };

    void exec
      .exec(
        options.namespace,
        podName,
        RUNNER_CONTAINER_NAME,
        ["sh", "-lc", "openclaw dashboard --no-open"],
        stdout,
        stderr,
        null,
        false,
        handleStatus,
      )
      .catch((error) =>
        settle(error instanceof Error ? error : new Error(String(error))),
      );
  });

  const dashboardLine = stdoutText
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(DASHBOARD_URL_PREFIX));

  if (!dashboardLine) {
    return publicUrl;
  }

  const dashboardUrl = dashboardLine.replace(DASHBOARD_URL_PREFIX, "").trim();
  return rewriteDashboardUrlForPublicHost(dashboardUrl, publicUrl);
}

function getErrorStatus(error: unknown) {
  const candidate = error as {
    statusCode?: number;
    code?: number;
    body?: { code?: number };
    response?: { statusCode?: number };
  };

  return (
    candidate.statusCode ??
    candidate.code ??
    candidate.body?.code ??
    candidate.response?.statusCode ??
    null
  );
}

function isNotFoundError(error: unknown) {
  return getErrorStatus(error) === 404;
}

async function namespaceExists(coreApi: CoreV1Api, namespace: string) {
  try {
    await coreApi.readNamespace({ name: namespace });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function ensureNamespace(coreApi: CoreV1Api, namespace: string) {
  if (await namespaceExists(coreApi, namespace)) return;

  const body: V1Namespace = {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: namespace },
  };

  await coreApi.createNamespace({ body });
}

function bootstrapScriptPath(engine: DockerRunnerEngine) {
  return path.join(
    process.cwd(),
    "scripts",
    engine === "hermes-agent" ? "hermes-runner" : "openclaw-runner",
    "bootstrap.mjs",
  );
}

function runnerImage(engine: DockerRunnerEngine) {
  if (engine === "hermes-agent") {
    return (
      process.env.HERMES_AGENT_IMAGE ??
      process.env.HERMES_IMAGE ??
      "nousresearch/hermes-agent:latest"
    );
  }

  return process.env.OPENCLAW_IMAGE ?? "ghcr.io/openclaw/openclaw:latest";
}

function codexConfigPathForEngine(engine: DockerRunnerEngine) {
  if (engine === "hermes-agent") {
    return (
      process.env.HERMES_CODEX_CONFIG_PATH ??
      process.env.OPENCLAW_CONFIG_PATH ??
      path.join(homedir(), ".codex", "config.toml")
    );
  }

  return (
    process.env.OPENCLAW_CONFIG_PATH ??
    path.join(homedir(), ".codex", "config.toml")
  );
}

function codexAuthPathForEngine(engine: DockerRunnerEngine) {
  if (engine === "hermes-agent") {
    return (
      process.env.HERMES_CODEX_AUTH_PATH ??
      process.env.OPENCLAW_AUTH_PATH ??
      path.join(homedir(), ".codex", "auth.json")
    );
  }

  return (
    process.env.OPENCLAW_AUTH_PATH ??
    path.join(homedir(), ".codex", "auth.json")
  );
}

function dashboardPublicHost(engine: DockerRunnerEngine) {
  const configured =
    engine === "hermes-agent"
      ? process.env.COLA_HERMES_DASHBOARD_PUBLIC_HOST ??
        process.env.COLA_K8S_RUNNER_PUBLIC_HOST ??
        process.env.COLA_DASHBOARD_PUBLIC_HOST
      : process.env.COLA_OPENCLAW_DASHBOARD_PUBLIC_HOST ??
        process.env.COLA_K8S_RUNNER_PUBLIC_HOST ??
        process.env.COLA_DASHBOARD_PUBLIC_HOST;

  if (configured?.trim()) {
    return configured.trim();
  }

  if (engine === "hermes-agent") {
    return clusterControllerIp();
  }

  return clusterControllerIp();
}

function uniqueOrigins(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function extractOrigin(urlValue: string | undefined) {
  if (!urlValue) return null;

  try {
    return new URL(urlValue).origin;
  } catch {
    return null;
  }
}

function isLoopbackDashboardHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function openClawDisableDeviceIdentity() {
  const raw = process.env.COLA_OPENCLAW_DISABLE_DEVICE_IDENTITY;
  if (raw) {
    return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
  }

  const publicHost = dashboardPublicHost("openclaw");
  if (!publicHost) return false;

  return !isLoopbackDashboardHost(publicHost);
}

function openClawAllowedOrigins(nodePort: number) {
  const publicHost = dashboardPublicHost("openclaw");
  return uniqueOrigins([
    `http://localhost:${nodePort}`,
    `http://127.0.0.1:${nodePort}`,
    publicHost ? `http://${publicHost}:${nodePort}` : null,
    publicHost ? `https://${publicHost}:${nodePort}` : null,
    extractOrigin(process.env.NEXT_PUBLIC_OPENCLAW_NATIVE_URL),
    ...(process.env.COLA_DASHBOARD_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
}

function defaultApiBaseUrl() {
  const configured =
    process.env.COLA_K8S_API_BASE_URL ?? process.env.COLA_API_BASE_URL;

  if (configured) {
    return configured;
  }

  if (existsSync(CLUSTER_CONFIG_PATH)) {
    const clusterConfig = readClusterConfig();
    const controllerIp = clusterConfig?.controllerIp?.trim();

    if (controllerIp) {
      return `http://${controllerIp}:${process.env.PORT ?? "50038"}`;
    }
  }

  throw new Error(
    "Kubernetes runner 需要可被 pod 访问的 Cola API 地址。请设置 COLA_K8S_API_BASE_URL / COLA_API_BASE_URL，或补齐 infra/k8s/cluster/config.json 中的 controllerIp。",
  );
}

async function getReservedNodePorts(coreApi: CoreV1Api) {
  try {
    const services = await coreApi.listServiceForAllNamespaces();
    const reserved = new Set<number>();

    for (const service of services.items ?? []) {
      for (const port of service.spec?.ports ?? []) {
        if (port.nodePort) {
          reserved.add(Number(port.nodePort));
        }
      }
    }

    return reserved;
  } catch {
    return new Set<number>();
  }
}

async function findAvailableNodePort(coreApi: CoreV1Api, start: number) {
  const reserved = await getReservedNodePorts(coreApi);

  for (let port = start; port < start + 200; port += 1) {
    if (!reserved.has(port)) {
      return port;
    }
  }

  throw new Error(`无法找到可用 NodePort，起始端口 ${start}`);
}

function buildCodexSecret(
  input: ProvisionRunnerInput,
  workloadName: string,
): { name: string; manifest: V1Secret | null } {
  const existingSecret = process.env.COLA_K8S_CODEX_SECRET_NAME;
  if (existingSecret) {
    return {
      name: existingSecret,
      manifest: null,
    };
  }

  const configPath = codexConfigPathForEngine(input.engine);
  const authPath = codexAuthPathForEngine(input.engine);

  if (!existsSync(configPath) || !existsSync(authPath)) {
    throw new Error(
      "缺少 Codex 配置或认证文件，无法创建 Kubernetes runner secret。",
    );
  }

  return {
    name: `${workloadName}-codex`,
    manifest: {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: `${workloadName}-codex`,
        namespace: runnerNamespace(),
      },
      type: "Opaque",
      stringData: {
        "config.toml": readFileSync(configPath, "utf8"),
        "auth.json": readFileSync(authPath, "utf8"),
      },
    },
  };
}

function buildWorkspaceMount(): MountSpec {
  const hostPath = process.env.COLA_K8S_WORKSPACE_HOST_PATH;

  if (hostPath) {
    return {
      workspaceVolumeName: "workspace",
      workspaceVolume: {
        name: "workspace",
        hostPath: {
          path: hostPath,
          type: "Directory",
        },
      },
      workspaceReadOnly: false,
    };
  }

  return {
    workspaceVolumeName: "workspace",
    workspaceVolume: {
      name: "workspace",
      emptyDir: {},
    },
    workspaceReadOnly: false,
  };
}

function buildOpenClawCommand(nodePort: number) {
  const configPatches: Array<{
    path: string;
    value: string | string[] | boolean;
  }> = [
    { path: "gateway.mode", value: "local" },
    { path: "gateway.bind", value: "lan" },
    {
      path: "gateway.controlUi.allowedOrigins",
      value: openClawAllowedOrigins(nodePort),
    },
  ];

  if (openClawDisableDeviceIdentity()) {
    configPatches.push({
      path: "gateway.controlUi.dangerouslyDisableDeviceAuth",
      value: true,
    });
  }

  return `openclaw config set --batch-json '${JSON.stringify(configPatches)}' --strict-json >/tmp/openclaw-config.log 2>&1 && ((if command -v node >/dev/null 2>&1; then node /runner-scripts/openclaw-bootstrap.mjs; elif command -v bun >/dev/null 2>&1; then bun /runner-scripts/openclaw-bootstrap.mjs; else echo "Missing node/bun runtime for bootstrap" >&2; exit 1; fi) >/tmp/openclaw-bootstrap.log 2>&1 &) && exec openclaw gateway --allow-unconfigured --bind lan --port ${OPENCLAW_DASHBOARD_PORT}`;
}

function buildHermesCommand() {
  const hermesBin =
    process.env.HERMES_BIN_IN_CONTAINER ?? "/opt/hermes/.venv/bin/hermes";

  return `((if command -v node >/dev/null 2>&1; then node /runner-scripts/hermes-bootstrap.mjs; elif command -v bun >/dev/null 2>&1; then bun /runner-scripts/hermes-bootstrap.mjs; else echo "Missing node/bun runtime for bootstrap" >&2; exit 1; fi) >/tmp/hermes-bootstrap.log 2>&1 &) && exec ${hermesBin} dashboard --host 0.0.0.0 --port ${HERMES_DASHBOARD_PORT} --no-open --insecure`;
}

function buildBootstrapConfigMap(workloadName: string): V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: `${workloadName}-scripts`,
      namespace: runnerNamespace(),
    },
    data: {
      "openclaw-bootstrap.mjs": readFileSync(
        bootstrapScriptPath("openclaw"),
        "utf8",
      ),
      "hermes-bootstrap.mjs": readFileSync(
        bootstrapScriptPath("hermes-agent"),
        "utf8",
      ),
    },
  };
}

export function buildNativeDashboardUrl(
  engine: DockerRunnerEngine,
  nodePort: number,
): string | null {
  const publicHost = dashboardPublicHost(engine);
  if (!publicHost) return null;

  return `http://${publicHost}:${nodePort}/`;
}

export async function resolveKubernetesRunnerDashboardUrl(options: {
  engine: DockerRunnerEngine;
  namespace?: string | null;
  deploymentName?: string | null;
  nodePort?: number | null;
}) {
  const nodePort = options.nodePort ?? null;
  if (!nodePort) return null;

  const fallbackUrl = buildNativeDashboardUrl(options.engine, nodePort);
  if (!fallbackUrl) return null;

  if (options.engine !== "openclaw") {
    return fallbackUrl;
  }

  const deploymentName = options.deploymentName?.trim();
  if (!deploymentName) {
    return fallbackUrl;
  }

  try {
    return await execOpenClawDashboardUrl({
      namespace: options.namespace?.trim() ?? runnerNamespace(),
      deploymentName,
      nodePort,
    });
  } catch {
    return fallbackUrl;
  }
}

function nodeSelection() {
  const nodeName = process.env.COLA_K8S_RUNNER_NODE_NAME;
  if (!nodeName) return {};

  return {
    nodeSelector: {
      "kubernetes.io/hostname": nodeName,
    },
    tolerations: [
      {
        operator: "Exists" as const,
      },
    ],
  };
}

function buildRunnerResources(
  input: ProvisionRunnerInput,
  deploymentName: string,
  serviceName: string,
  nodePort: number,
) {
  const image = runnerImage(input.engine);
  const { name: codexSecretName, manifest: codexSecretManifest } =
    buildCodexSecret(input, deploymentName);
  const workspaceMount = buildWorkspaceMount();
  const dashboardPort =
    input.engine === "hermes-agent"
      ? HERMES_DASHBOARD_PORT
      : OPENCLAW_DASHBOARD_PORT;
  const startupCommand =
    input.engine === "hermes-agent"
      ? buildHermesCommand()
      : buildOpenClawCommand(nodePort);

  const deployment: V1Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: deploymentName,
      namespace: runnerNamespace(),
      labels: {
        "app.kubernetes.io/name": "cola-runner",
        "app.kubernetes.io/part-of": "cola",
        "cola/engine": input.engine,
        "cola/agent-id": input.agentId,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          "cola/runner": deploymentName,
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "cola-runner",
            "app.kubernetes.io/part-of": "cola",
            "cola/runner": deploymentName,
            "cola/engine": input.engine,
            "cola/agent-id": input.agentId,
          },
        },
        spec: {
          ...nodeSelection(),
          containers: [
            {
              name: "runner",
              image,
              imagePullPolicy: "IfNotPresent",
              command: ["sh", "-lc", startupCommand],
              ports: [
                {
                  name: "dashboard",
                  containerPort: dashboardPort,
                },
              ],
              env: [
                {
                  name: "COLA_API_BASE_URL",
                  value: defaultApiBaseUrl(),
                },
                {
                  name: "COLA_RUNNER_NAME",
                  value: input.runnerName,
                },
                {
                  name: "COLA_RESOURCE_POOL",
                  value: input.resourcePool,
                },
                {
                  name: "COLA_RUNNER_ENGINE",
                  value: input.engine,
                },
                {
                  name: "COLA_RUNNER_RUNTIME",
                  value: "kubernetes",
                },
                {
                  name: "COLA_AGENT_ID",
                  value: input.agentId,
                },
                {
                  name: "COLA_RUNNER_IMAGE",
                  value: image,
                },
                {
                  name: "COLA_RUNNER_HOST",
                  valueFrom: {
                    fieldRef: {
                      fieldPath: "spec.nodeName",
                    },
                  },
                },
                {
                  name: "COLA_CONTAINER_NAME",
                  valueFrom: {
                    fieldRef: {
                      fieldPath: "metadata.name",
                    },
                  },
                },
                {
                  name: "COLA_CODEX_CONFIG_PATH",
                  value: "/home/node/.codex/config.toml",
                },
                {
                  name: "COLA_CODEX_AUTH_PATH",
                  value: "/home/node/.codex/auth.json",
                },
                ...(input.engine === "hermes-agent"
                  ? [
                      {
                        name: "HERMES_CODEX_CONFIG_PATH",
                        value: "/home/node/.codex/config.toml",
                      },
                      {
                        name: "HERMES_CODEX_AUTH_PATH",
                        value: "/home/node/.codex/auth.json",
                      },
                    ]
                  : []),
              ],
              volumeMounts: [
                {
                  name: workspaceMount.workspaceVolumeName,
                  mountPath: "/workspace",
                  readOnly: workspaceMount.workspaceReadOnly,
                },
                {
                  name: "codex",
                  mountPath: "/home/node/.codex",
                  readOnly: true,
                },
                {
                  name: "runner-scripts",
                  mountPath: "/runner-scripts",
                  readOnly: true,
                },
              ],
            },
          ],
          volumes: [
            workspaceMount.workspaceVolume,
            {
              name: "codex",
              secret: {
                secretName: codexSecretName,
              },
            },
            {
              name: "runner-scripts",
              configMap: {
                name: `${deploymentName}-scripts`,
                defaultMode: 493,
              },
            },
          ],
        },
      },
    },
  };

  const service: V1Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: serviceName,
      namespace: runnerNamespace(),
    },
    spec: {
      type: "NodePort",
      selector: {
        "cola/runner": deploymentName,
      },
      ports: [
        {
          name: "dashboard",
          port: dashboardPort,
          targetPort: dashboardPort,
          nodePort,
        },
      ],
    },
  };

  return {
    codexSecretName,
    codexSecretManaged: Boolean(codexSecretManifest),
    codexSecretManifest,
    bootstrapConfigMap: buildBootstrapConfigMap(deploymentName),
    deployment,
    service,
  };
}

async function upsertSecret(
  coreApi: CoreV1Api,
  namespace: string,
  body: V1Secret,
) {
  const name = body.metadata?.name;
  if (!name) throw new Error("Secret 缺少 metadata.name");

  try {
    const existing = await coreApi.readNamespacedSecret({ name, namespace });
    await coreApi.replaceNamespacedSecret({
      name,
      namespace,
      body: {
        ...body,
        metadata: {
          ...(body.metadata ?? {}),
          resourceVersion: existing.metadata?.resourceVersion,
        },
      },
    });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await coreApi.createNamespacedSecret({ namespace, body });
  }
}

async function upsertConfigMap(
  coreApi: CoreV1Api,
  namespace: string,
  body: V1ConfigMap,
) {
  const name = body.metadata?.name;
  if (!name) throw new Error("ConfigMap 缺少 metadata.name");

  try {
    const existing = await coreApi.readNamespacedConfigMap({ name, namespace });
    await coreApi.replaceNamespacedConfigMap({
      name,
      namespace,
      body: {
        ...body,
        metadata: {
          ...(body.metadata ?? {}),
          resourceVersion: existing.metadata?.resourceVersion,
        },
      },
    });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await coreApi.createNamespacedConfigMap({ namespace, body });
  }
}

async function upsertDeployment(
  appsApi: AppsV1Api,
  namespace: string,
  body: V1Deployment,
) {
  const name = body.metadata?.name;
  if (!name) throw new Error("Deployment 缺少 metadata.name");

  try {
    const existing = await appsApi.readNamespacedDeployment({
      name,
      namespace,
    });
    await appsApi.replaceNamespacedDeployment({
      name,
      namespace,
      body: {
        ...body,
        metadata: {
          ...(body.metadata ?? {}),
          resourceVersion: existing.metadata?.resourceVersion,
        },
      },
    });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await appsApi.createNamespacedDeployment({ namespace, body });
  }
}

async function upsertService(
  coreApi: CoreV1Api,
  namespace: string,
  body: V1Service,
) {
  const name = body.metadata?.name;
  if (!name) throw new Error("Service 缺少 metadata.name");

  try {
    const existing = await coreApi.readNamespacedService({ name, namespace });
    await coreApi.replaceNamespacedService({
      name,
      namespace,
      body: {
        ...body,
        metadata: {
          ...(body.metadata ?? {}),
          resourceVersion: existing.metadata?.resourceVersion,
        },
        spec: {
          ...(body.spec ?? {}),
          clusterIP: existing.spec?.clusterIP,
          clusterIPs: existing.spec?.clusterIPs,
          healthCheckNodePort: existing.spec?.healthCheckNodePort,
          ipFamilies: existing.spec?.ipFamilies,
          ipFamilyPolicy: existing.spec?.ipFamilyPolicy,
          internalTrafficPolicy: existing.spec?.internalTrafficPolicy,
        },
      },
    });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await coreApi.createNamespacedService({ namespace, body });
  }
}

export async function provisionKubernetesRunner(
  input: ProvisionRunnerInput,
): Promise<ProvisionRunnerResult> {
  const engineLabel = dockerRunnerEngineLabels[input.engine];
  const namespace = runnerNamespace();
  const workloadName = `cola-${slugify(input.agentName)}-${input.agentId.slice(0, 8)}`;
  const deploymentName = `${workloadName}-runner`;
  const serviceName = `${workloadName}-svc`;
  const image = runnerImage(input.engine);
  const { appsApi, coreApi } = createKubeClients();

  try {
    await ensureNamespace(coreApi, namespace);
    const nodePort = await findAvailableNodePort(
      coreApi,
      input.engine === "hermes-agent"
        ? HERMES_NODE_PORT_START
        : OPENCLAW_NODE_PORT_START,
    );
    const nativeDashboardUrl = buildNativeDashboardUrl(input.engine, nodePort);
    const resources = buildRunnerResources(
      input,
      deploymentName,
      serviceName,
      nodePort,
    );

    if (resources.codexSecretManifest) {
      await upsertSecret(coreApi, namespace, resources.codexSecretManifest);
    }

    await upsertConfigMap(coreApi, namespace, resources.bootstrapConfigMap);
    await upsertDeployment(appsApi, namespace, resources.deployment);
    await upsertService(coreApi, namespace, resources.service);

    return {
      success: true,
      runtime: "kubernetes",
      image,
      host: dashboardPublicHost(input.engine) ?? "kubernetes",
      healthSummary: `${input.roleLabel} runner 已在 Kubernetes 中启动，等待 ${engineLabel} 自注册。`,
      nativeDashboardUrl,
      metadata: {
        deploymentName,
        serviceName,
        namespace,
        nodePort: String(nodePort),
        configMapName: `${deploymentName}-scripts`,
        codexSecretName: resources.codexSecretName,
        codexSecretManaged: resources.codexSecretManaged ? "true" : "false",
      },
    };
  } catch (error) {
    return {
      success: false,
      runtime: "kubernetes",
      image,
      host: dashboardPublicHost(input.engine) ?? "kubernetes",
      healthSummary: "Kubernetes runner 拉起失败，角色已创建但进入阻塞态。",
      nativeDashboardUrl: null,
      errorMessage:
        error instanceof Error ? error.message : "未知 Kubernetes 启动错误",
    };
  }
}

async function deleteResource(options: { action: () => Promise<unknown> }) {
  try {
    await options.action();
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

export async function cleanupKubernetesRunner(options: {
  namespace?: string | null;
  deploymentName?: string | null;
  serviceName?: string | null;
  configMapName?: string | null;
  codexSecretName?: string | null;
  codexSecretManaged?: boolean;
}) {
  const { appsApi, coreApi } = createKubeClients();
  const namespace = options.namespace?.trim() ?? runnerNamespace();

  await Promise.all([
    options.deploymentName
      ? deleteResource({
          action: () =>
            appsApi.deleteNamespacedDeployment({
              name: options.deploymentName!,
              namespace,
              propagationPolicy: "Foreground",
            }),
        })
      : Promise.resolve(),
    options.serviceName
      ? deleteResource({
          action: () =>
            coreApi.deleteNamespacedService({
              name: options.serviceName!,
              namespace,
            }),
        })
      : Promise.resolve(),
    options.configMapName
      ? deleteResource({
          action: () =>
            coreApi.deleteNamespacedConfigMap({
              name: options.configMapName!,
              namespace,
            }),
        })
      : Promise.resolve(),
    options.codexSecretManaged && options.codexSecretName
      ? deleteResource({
          action: () =>
            coreApi.deleteNamespacedSecret({
              name: options.codexSecretName!,
              namespace,
            }),
        })
      : Promise.resolve(),
  ]);
}
