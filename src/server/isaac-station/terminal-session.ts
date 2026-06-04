import "server-only";

import { randomUUID } from "node:crypto";
import { PassThrough, Writable } from "node:stream";

import { CoreV1Api, Exec } from "@kubernetes/client-node";
import type { V1Pod, V1Status } from "@kubernetes/client-node";

import {
  createKubeConfig as createSharedKubeConfig,
  resolveKubeconfigPath as resolveSharedKubeconfigPath,
} from "@/server/kubernetes/kubeconfig";
import { readIsaacClusterConfig, resolveIsaacNamespace } from "./k8s-context";

type TerminalStatus = "connecting" | "connected" | "closed";

export type IsaacTerminalSessionEvent =
  | {
      type: "output";
      data: string;
    }
  | {
      type: "status";
      status: TerminalStatus;
      message: string;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "exit";
      code: number | null;
      signal: string | null;
      message: string;
    };

export type IsaacTerminalSessionInfo = {
  sessionId: string;
  jobName: string;
  podName: string;
  containerName: string;
  namespace: string;
  nodeName: string | null;
  startedAt: string;
};

type TerminalListener = (event: IsaacTerminalSessionEvent) => void;
type TerminalSocket = {
  close: () => void;
  once: (
    eventName: "close" | "error",
    listener: (error?: unknown) => void,
  ) => void;
};

const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_RETAIN_MS = 60 * 1000;
const MAX_BACKLOG_EVENTS = 500;
const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 32;
const LAB_CONTAINER_NAME = "isaac-lab";

declare global {
  var __colaIsaacTerminalSessions:
    | Map<string, IsaacTerminalSession>
    | undefined;
}

const sessions =
  globalThis.__colaIsaacTerminalSessions ??
  new Map<string, IsaacTerminalSession>();

globalThis.__colaIsaacTerminalSessions = sessions;

function resolveKubeconfigPath(clusterName: string) {
  return resolveSharedKubeconfigPath({
    clusterName,
    envVarNames: [
      "COLA_ISAAC_LAB_KUBECONFIG_PATH",
      "REMOTE_WORK_KUBECONFIG_PATH",
      "WORKSPACE_KUBECONFIG",
    ],
  });
}

function createKubeConfig(clusterName: string) {
  return createSharedKubeConfig({
    clusterName,
    envVarNames: [
      "COLA_ISAAC_LAB_KUBECONFIG_PATH",
      "REMOTE_WORK_KUBECONFIG_PATH",
      "WORKSPACE_KUBECONFIG",
    ],
    warnPrefix: "[isaac-terminal]",
  });
}

function jobName(name: string) {
  return `isaac-lab-${name}`;
}

function validateLabName(name: string) {
  if (name.length > 42) {
    throw new Error("Isaac Lab Job 名称最多 42 个字符。");
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error("Isaac Lab Job 名称必须符合 DNS-1123 简单命名规则。");
  }
}

function podBelongsToJob(pod: V1Pod, name: string) {
  return (
    pod.metadata?.labels?.["cola.isaac/lab-job-name"] === name ||
    pod.metadata?.labels?.["batch.kubernetes.io/job-name"] === jobName(name) ||
    pod.metadata?.labels?.["job-name"] === jobName(name)
  );
}

function isPodReady(pod: V1Pod) {
  return (
    pod.status?.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    ) ?? false
  );
}

function selectLabPod(pods: V1Pod[], name: string) {
  const matches = pods.filter((pod) => podBelongsToJob(pod, name));
  return (
    matches.find((pod) => pod.status?.phase === "Running" && isPodReady(pod)) ??
    matches.find((pod) => pod.status?.phase === "Running") ??
    null
  );
}

function statusExitCode(status: V1Status) {
  const raw = status.details?.causes?.find(
    (cause) => cause.reason === "ExitCode",
  )?.message;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

function isTerminalSocket(value: unknown): value is TerminalSocket {
  return (
    typeof value === "object" &&
    value !== null &&
    "close" in value &&
    typeof value.close === "function" &&
    "once" in value &&
    typeof value.once === "function"
  );
}

class ResizableOutput extends Writable {
  columns = DEFAULT_TERMINAL_COLS;
  rows = DEFAULT_TERMINAL_ROWS;

  constructor(private readonly onData: (data: string) => void) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.onData(chunk.toString());
    callback();
  }

  resize(cols: number, rows: number) {
    this.columns = cols;
    this.rows = rows;
    this.emit("resize");
  }
}

class IsaacTerminalSession {
  readonly id = randomUUID();
  readonly startedAt = new Date();

  private readonly listeners = new Set<TerminalListener>();
  private readonly backlog: IsaacTerminalSessionEvent[] = [];
  private readonly stdin = new PassThrough();
  private readonly stdout = new ResizableOutput((data) => {
    this.resetIdleTimer();
    this.emit({ type: "output", data });
  });
  private readonly stderr = new Writable({
    write: (chunk: Buffer | string, _encoding, callback) => {
      this.resetIdleTimer();
      this.emit({ type: "output", data: chunk.toString() });
      callback();
    },
  });

  private status: TerminalStatus = "connecting";
  private closed = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private removeTimer: ReturnType<typeof setTimeout> | null = null;
  private socket: TerminalSocket | null = null;

  constructor(
    private readonly target: {
      namespace: string;
      jobName: string;
      podName: string;
      containerName: string;
      nodeName: string | null;
      exec: Exec;
    },
  ) {}

  info(): IsaacTerminalSessionInfo {
    return {
      sessionId: this.id,
      jobName: this.target.jobName,
      podName: this.target.podName,
      containerName: this.target.containerName,
      namespace: this.target.namespace,
      nodeName: this.target.nodeName,
      startedAt: this.startedAt.toISOString(),
    };
  }

  start() {
    this.resetIdleTimer();
    this.emit({
      type: "status",
      status: "connecting",
      message: "正在通过 Kubernetes exec 进入 Isaac Lab 容器。",
    });

    void this.target.exec
      .exec(
        this.target.namespace,
        this.target.podName,
        this.target.containerName,
        [
          "/bin/bash",
          "-lc",
          'cd "${ISAAC_LAB_WORKDIR:-$PWD}" 2>/dev/null || true; exec /bin/bash -l',
        ],
        this.stdout,
        this.stderr,
        this.stdin,
        true,
        (status) => {
          const code = statusExitCode(status);
          this.emit({
            type: "exit",
            code,
            signal: null,
            message: `Isaac Lab 终端已退出${code === null ? "" : `，退出码 ${code}`}。`,
          });
          this.close("Isaac Lab 终端已退出。");
        },
      )
      .then((socket: unknown) => {
        if (!isTerminalSocket(socket)) {
          this.emit({
            type: "error",
            message: "Kubernetes exec 返回了无法识别的连接对象。",
          });
          this.close("Kubernetes exec 连接异常。");
          return;
        }

        if (this.closed) {
          socket.close();
          return;
        }

        this.socket = socket;
        this.status = "connected";
        this.emit({
          type: "status",
          status: "connected",
          message: "已进入 Isaac Lab 容器终端。",
        });

        socket.once("close", () => {
          this.close("Kubernetes exec 连接已关闭。");
        });
        socket.once("error", (error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : "Kubernetes exec 连接异常。";
          this.emit({ type: "error", message });
          this.close("Kubernetes exec 连接异常。");
        });
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Isaac Lab 终端启动失败。";
        this.emit({ type: "error", message });
        this.close("Isaac Lab 终端启动失败。");
      });
  }

  subscribe(listener: TerminalListener) {
    this.resetIdleTimer();
    for (const event of this.backlog) {
      listener(event);
    }
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  write(data: string) {
    this.resetIdleTimer();
    if (this.closed || this.status !== "connected") return false;
    this.stdin.write(data);
    return true;
  }

  resize(cols: number, rows: number) {
    this.resetIdleTimer();
    if (this.closed || this.status !== "connected") return false;
    this.stdout.resize(cols, rows);
    return true;
  }

  close(message = "会话已关闭。") {
    if (this.closed) return;

    this.closed = true;
    this.status = "closed";
    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.stdin.end();
    this.stdout.end();
    this.stderr.end();
    this.socket?.close();
    this.emit({ type: "status", status: "closed", message });
    this.scheduleRemoval();
  }

  private emit(event: IsaacTerminalSessionEvent) {
    this.backlog.push(event);
    if (this.backlog.length > MAX_BACKLOG_EVENTS) {
      this.backlog.splice(0, this.backlog.length - MAX_BACKLOG_EVENTS);
    }

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private resetIdleTimer() {
    if (this.closed) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.idleTimer = setTimeout(() => {
      this.close("会话空闲超时，已自动关闭。");
    }, SESSION_IDLE_MS);
  }

  private scheduleRemoval() {
    if (this.removeTimer) clearTimeout(this.removeTimer);

    this.removeTimer = setTimeout(() => {
      sessions.delete(this.id);
    }, SESSION_RETAIN_MS);
  }
}

export async function createIsaacLabTerminalSession(nameInput: string) {
  const name = nameInput.trim().toLowerCase();
  validateLabName(name);

  const { config } = readIsaacClusterConfig();
  resolveKubeconfigPath(config.clusterName);
  const { kubeConfig } = createKubeConfig(config.clusterName);
  const coreApi = kubeConfig.makeApiClient(CoreV1Api);
  const namespace = resolveIsaacNamespace(config, "lab");
  const pods = await coreApi.listNamespacedPod({ namespace });
  const pod = selectLabPod(pods.items ?? [], name);

  if (!pod?.metadata?.name) {
    throw new Error("没有找到正在运行的 Isaac Lab Pod。请先启动 Job。");
  }

  const container =
    pod.spec?.containers?.find((item) => item.name === LAB_CONTAINER_NAME)
      ?.name ?? pod.spec?.containers?.[0]?.name;

  if (!container) {
    throw new Error("Isaac Lab Pod 没有可进入的容器。");
  }

  const session = new IsaacTerminalSession({
    namespace,
    jobName: name,
    podName: pod.metadata.name,
    containerName: container,
    nodeName: pod.spec?.nodeName ?? null,
    exec: new Exec(kubeConfig),
  });
  sessions.set(session.id, session);
  session.start();
  return session.info();
}

export function getIsaacTerminalSession(sessionId: string) {
  return sessions.get(sessionId) ?? null;
}

export function writeIsaacTerminalSessionInput(
  sessionId: string,
  data: string,
) {
  return sessions.get(sessionId)?.write(data) ?? false;
}

export function resizeIsaacTerminalSession(
  sessionId: string,
  dimensions: { cols: number; rows: number },
) {
  return (
    sessions.get(sessionId)?.resize(dimensions.cols, dimensions.rows) ?? false
  );
}

export function closeIsaacTerminalSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  session.close();
  return true;
}
