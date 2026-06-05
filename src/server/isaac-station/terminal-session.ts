import "server-only";

import { randomUUID } from "node:crypto";
import { PassThrough, Writable } from "node:stream";

import {
  ISAAC_LAB_LOGIN_COMMAND,
  type IsaacLabExecTarget,
  type TerminalSocket,
  ResizableTerminalOutput,
  isTerminalSocket,
  resolveIsaacLabExecTarget,
  statusExitCode,
} from "./lab-exec-target";

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

const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_RETAIN_MS = 60 * 1000;
const MAX_BACKLOG_EVENTS = 500;

declare global {
  var __colaIsaacTerminalSessions:
    | Map<string, IsaacTerminalSession>
    | undefined;
}

const sessions =
  globalThis.__colaIsaacTerminalSessions ??
  new Map<string, IsaacTerminalSession>();

globalThis.__colaIsaacTerminalSessions = sessions;

class IsaacTerminalSession {
  readonly id = randomUUID();
  readonly startedAt = new Date();

  private readonly listeners = new Set<TerminalListener>();
  private readonly backlog: IsaacTerminalSessionEvent[] = [];
  private readonly stdin = new PassThrough();
  private readonly stdout = new ResizableTerminalOutput((data) => {
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

  constructor(private readonly target: IsaacLabExecTarget) {}

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
        ["/bin/bash", "-lc", ISAAC_LAB_LOGIN_COMMAND],
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
  const session = new IsaacTerminalSession(
    await resolveIsaacLabExecTarget(nameInput),
  );
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
