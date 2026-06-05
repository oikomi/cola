#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { PassThrough, Writable } from "node:stream";

import { CoreV1Api, Exec, KubeConfig } from "@kubernetes/client-node";
import ssh2 from "ssh2";

const { Server } = ssh2;

const K8S_INFRA_DIR = path.join(process.cwd(), "infra", "k8s");
const CLUSTER_CONFIG_PATH = path.join(K8S_INFRA_DIR, "cluster", "config.json");
const DEFAULT_PORT = 2222;
const DEFAULT_LISTEN_HOST = "0.0.0.0";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const LAB_CONTAINER_NAME = "isaac-lab";
const LOGIN_COMMAND =
  'cd "${ISAAC_LAB_WORKDIR:-$PWD}" 2>/dev/null || true; exec /bin/bash -l';
const KUBECONFIG_ENV_NAMES = [
  "COLA_ISAAC_LAB_KUBECONFIG_PATH",
  "REMOTE_WORK_KUBECONFIG_PATH",
  "WORKSPACE_KUBECONFIG",
];

function envValue(name) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseTcpPort(value, name) {
  if (!value) return null;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a TCP port from 1 to 65535.`);
  }

  return port;
}

function resolveGatewayPassword() {
  return (
    envValue("COLA_ISAAC_LAB_SSH_PASSWORD") ??
    envValue("COLA_ISAAC_LAB_SSH_GATEWAY_PASSWORD")
  );
}

function resolveListenHost() {
  return envValue("COLA_ISAAC_LAB_SSH_GATEWAY_HOST") ?? DEFAULT_LISTEN_HOST;
}

function resolveListenPort() {
  return (
    parseTcpPort(
      envValue("COLA_ISAAC_LAB_SSH_GATEWAY_PORT"),
      "COLA_ISAAC_LAB_SSH_GATEWAY_PORT",
    ) ?? DEFAULT_PORT
  );
}

function resolveHostKeyPath() {
  return (
    envValue("COLA_ISAAC_LAB_SSH_HOST_KEY_PATH") ??
    path.join(process.cwd(), "runtime", "isaac-lab-ssh-gateway", "host_key")
  );
}

function ensureHostKey() {
  const hostKeyPath = resolveHostKeyPath();
  if (fs.existsSync(hostKeyPath)) {
    return fs.readFileSync(hostKeyPath, "utf8");
  }

  fs.mkdirSync(path.dirname(hostKeyPath), { recursive: true });
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    privateKeyEncoding: {
      type: "pkcs1",
      format: "pem",
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
  });
  fs.writeFileSync(hostKeyPath, privateKey, { mode: 0o600 });
  return privateKey;
}

function clusterKubeconfigPath(clusterName) {
  return path.join(
    "/etc/kubeasz",
    "clusters",
    clusterName,
    "kubectl.kubeconfig",
  );
}

function resolveKubeconfigPath(clusterName) {
  const candidates = [
    ...KUBECONFIG_ENV_NAMES.map((name) => envValue(name)),
    clusterKubeconfigPath(clusterName),
  ].filter(Boolean);

  return (
    candidates.find((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? clusterKubeconfigPath(clusterName)
  );
}

function hasInClusterEnvironment() {
  return Boolean(
    process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT,
  );
}

function createKubeConfig(clusterName) {
  const kubeConfig = new KubeConfig();

  if (hasInClusterEnvironment()) {
    try {
      kubeConfig.loadFromCluster();
      return kubeConfig;
    } catch (error) {
      console.warn(
        "[isaac-lab-ssh] failed to load in-cluster kubeconfig, falling back to file",
        error,
      );
    }
  }

  const kubeconfigPath = resolveKubeconfigPath(clusterName);
  fs.accessSync(kubeconfigPath, fs.constants.R_OK);
  kubeConfig.loadFromFile(kubeconfigPath);
  return kubeConfig;
}

function validateJobName(name) {
  if (name.length > 42) {
    throw new Error("Isaac Lab Job name is longer than 42 characters.");
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error("Isaac Lab Job name must be DNS-1123 compatible.");
  }
}

function k8sJobName(name) {
  return `isaac-lab-${name}`;
}

function podBelongsToJob(pod, name) {
  const labels = pod.metadata?.labels ?? {};
  return (
    labels["cola.isaac/lab-job-name"] === name ||
    labels["batch.kubernetes.io/job-name"] === k8sJobName(name) ||
    labels["job-name"] === k8sJobName(name)
  );
}

function isPodReady(pod) {
  return (
    pod.status?.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    ) ?? false
  );
}

function selectLabPod(pods, name) {
  const matches = pods.filter((pod) => podBelongsToJob(pod, name));
  return (
    matches.find((pod) => pod.status?.phase === "Running" && isPodReady(pod)) ??
    matches.find((pod) => pod.status?.phase === "Running") ??
    null
  );
}

async function resolveExecTarget(jobName) {
  validateJobName(jobName);

  const config = readJsonFile(CLUSTER_CONFIG_PATH);
  const namespace =
    envValue("COLA_ISAAC_LAB_K8S_NAMESPACE") ??
    config.workspaceNamespace ??
    "remote-work";
  const kubeConfig = createKubeConfig(config.clusterName);
  const coreApi = kubeConfig.makeApiClient(CoreV1Api);
  const pods = await coreApi.listNamespacedPod({ namespace });
  const pod = selectLabPod(pods.items ?? [], jobName);

  if (!pod?.metadata?.name) {
    throw new Error("No running Isaac Lab Pod was found for this Job.");
  }

  const container =
    pod.spec?.containers?.find((item) => item.name === LAB_CONTAINER_NAME)
      ?.name ?? pod.spec?.containers?.[0]?.name;

  if (!container) {
    throw new Error("The Isaac Lab Pod has no container to enter.");
  }

  return {
    namespace,
    podName: pod.metadata.name,
    containerName: container,
    exec: new Exec(kubeConfig),
  };
}

function statusExitCode(status) {
  const raw = status.details?.causes?.find(
    (cause) => cause.reason === "ExitCode",
  )?.message;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

class ResizableOutput extends Writable {
  columns;
  rows;
  #onData;

  constructor(onData, dimensions) {
    super();
    this.#onData = onData;
    this.columns = dimensions.cols;
    this.rows = dimensions.rows;
  }

  _write(chunk, _encoding, callback) {
    this.#onData(chunk.toString());
    callback();
  }

  resize(cols, rows) {
    this.columns = cols;
    this.rows = rows;
    this.emit("resize");
  }
}

function normalizePty(info) {
  return {
    cols:
      Number.isInteger(info?.cols) && info.cols > 0 ? info.cols : DEFAULT_COLS,
    rows:
      Number.isInteger(info?.rows) && info.rows > 0 ? info.rows : DEFAULT_ROWS,
  };
}

async function openIsaacShell({ jobName, channel, dimensions, command }) {
  let socket = null;
  const stdin = new PassThrough();
  const stdout = new ResizableOutput((data) => channel.write(data), dimensions);
  const stderr = new Writable({
    write: (chunk, _encoding, callback) => {
      channel.write(chunk.toString());
      callback();
    },
  });

  const cleanup = () => {
    stdin.destroy();
    stdout.destroy();
    stderr.destroy();
    socket?.close();
  };

  channel.on("close", cleanup);
  channel.on("error", cleanup);
  channel.pipe(stdin);

  try {
    const target = await resolveExecTarget(jobName);
    const shellCommand = command?.trim()
      ? `cd "\${ISAAC_LAB_WORKDIR:-$PWD}" 2>/dev/null || true; ${command}`
      : LOGIN_COMMAND;

    socket = await target.exec.exec(
      target.namespace,
      target.podName,
      target.containerName,
      ["/bin/bash", "-lc", shellCommand],
      stdout,
      stderr,
      stdin,
      true,
      (status) => {
        const code = statusExitCode(status) ?? 0;
        channel.exit(code);
        channel.end();
        cleanup();
      },
    );

    socket.once("close", () => {
      channel.end();
      cleanup();
    });
    socket.once("error", (error) => {
      channel.write(`\r\nKubernetes exec error: ${error.message}\r\n`);
      channel.exit(1);
      channel.end();
      cleanup();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    channel.write(`\r\nIsaac Lab SSH gateway error: ${message}\r\n`);
    channel.exit(1);
    channel.end();
    cleanup();
  }

  return {
    resize(nextDimensions) {
      stdout.resize(nextDimensions.cols, nextDimensions.rows);
    },
  };
}

function createServer(password) {
  return new Server({ hostKeys: [ensureHostKey()] }, (client) => {
    let authenticatedJobName = null;

    client.on("authentication", (ctx) => {
      const jobName = ctx.username.trim().toLowerCase();
      const validUser = (() => {
        try {
          validateJobName(jobName);
          return true;
        } catch {
          return false;
        }
      })();

      if (!validUser) {
        ctx.reject(["password"]);
        return;
      }

      if (ctx.method === "password" && ctx.password === password) {
        authenticatedJobName = jobName;
        ctx.accept();
        return;
      }

      ctx.reject(["password"]);
    });

    client.on("ready", () => {
      if (!authenticatedJobName) {
        client.end();
        return;
      }

      client.on("session", (accept) => {
        const session = accept();
        let dimensions = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
        let activeShell = null;

        session.on("pty", (acceptPty, _reject, info) => {
          dimensions = normalizePty(info);
          acceptPty();
        });

        session.on("window-change", (acceptChange, _reject, info) => {
          dimensions = normalizePty(info);
          activeShell?.resize(dimensions);
          acceptChange();
        });

        session.on("shell", (acceptShell) => {
          const channel = acceptShell();
          void openIsaacShell({
            jobName: authenticatedJobName,
            channel,
            dimensions,
          }).then((shell) => {
            activeShell = shell;
          });
        });

        session.on("exec", (acceptExec, _reject, info) => {
          const channel = acceptExec();
          void openIsaacShell({
            jobName: authenticatedJobName,
            channel,
            dimensions,
            command: info.command,
          }).then((shell) => {
            activeShell = shell;
          });
        });
      });
    });

    client.on("error", (error) => {
      console.warn("[isaac-lab-ssh] client error:", error.message);
    });
  });
}

function main() {
  const password = resolveGatewayPassword();
  if (!password) {
    throw new Error(
      "Set COLA_ISAAC_LAB_SSH_PASSWORD before starting the Isaac Lab SSH gateway.",
    );
  }

  const host = resolveListenHost();
  const port = resolveListenPort();
  const server = createServer(password);

  server.on("error", (error) => {
    console.error(
      `[isaac-lab-ssh] failed to listen on ${host}:${port}: ${error.message}`,
    );
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`[isaac-lab-ssh] listening on ${host}:${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      console.log("[isaac-lab-ssh] stopped");
      process.exit(0);
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main();
