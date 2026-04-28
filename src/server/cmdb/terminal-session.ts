import "server-only";

import { randomUUID } from "node:crypto";

import { Client } from "ssh2";
import type { ClientChannel, PseudoTtyOptions } from "ssh2";

import type { CmdbProjectTerminalTarget } from "@/server/cmdb/service";

type TerminalStatus = "connecting" | "connected" | "closed";

export type CmdbTerminalSessionEvent =
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

export type CmdbTerminalSessionInfo = {
  sessionId: string;
  projectId: number;
  projectName: string;
  deployTarget: CmdbProjectTerminalTarget["deployTarget"];
  targetAssetName: string;
  host: string;
  sshUser: string;
  sshPort: number;
  containerName: string | null;
  startedAt: string;
};

type TerminalListener = (event: CmdbTerminalSessionEvent) => void;

const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_RETAIN_MS = 60 * 1000;
const MAX_BACKLOG_EVENTS = 500;
const TERMINAL_PTY: PseudoTtyOptions = {
  term: "xterm-256color",
  cols: 120,
  rows: 32,
  width: 960,
  height: 640,
};

const sessions = new Map<string, CmdbTerminalSession>();

class CmdbTerminalSession {
  readonly id = randomUUID();
  readonly startedAt = new Date();

  private readonly client = new Client();
  private readonly listeners = new Set<TerminalListener>();
  private readonly backlog: CmdbTerminalSessionEvent[] = [];
  private channel: ClientChannel | null = null;
  private status: TerminalStatus = "connecting";
  private closed = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private removeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly target: CmdbProjectTerminalTarget) {}

  info(): CmdbTerminalSessionInfo {
    return {
      sessionId: this.id,
      projectId: this.target.projectId,
      projectName: this.target.projectName,
      deployTarget: this.target.deployTarget,
      targetAssetName: this.target.targetAssetName,
      host: this.target.host,
      sshUser: this.target.sshUser,
      sshPort: this.target.sshPort,
      containerName: this.target.containerName,
      startedAt: this.startedAt.toISOString(),
    };
  }

  start() {
    this.resetIdleTimer();
    this.emit({
      type: "status",
      status: "connecting",
      message: "正在连接目标资产。",
    });

    this.client.once("ready", () => {
      if (this.closed) return;

      if (this.target.remoteCommand) {
        this.client.exec(
          this.target.remoteCommand,
          { pty: TERMINAL_PTY },
          (error, channel) => {
            this.attachChannel(error, channel, "已进入容器终端。");
          },
        );
        return;
      }

      this.client.shell(TERMINAL_PTY, (error, channel) => {
        this.attachChannel(error, channel, "已登录远程终端。");
      });
    });

    this.client.once("error", (error) => {
      this.emit({ type: "error", message: error.message });
      this.close("SSH 连接失败。");
    });

    this.client.once("close", () => {
      this.close("SSH 连接已关闭。");
    });

    this.client.connect(this.target.sshConfig);
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
    if (this.closed || !this.channel) return false;
    this.channel.write(data);
    return true;
  }

  close(message = "会话已关闭。") {
    if (this.closed) return;

    this.closed = true;
    this.status = "closed";
    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.channel?.end();
    this.client.end();
    this.emit({ type: "status", status: "closed", message });
    this.scheduleRemoval();
  }

  private attachChannel(
    error: Error | undefined,
    channel: ClientChannel,
    connectedMessage: string,
  ) {
    if (error) {
      this.emit({ type: "error", message: error.message });
      this.close("远程终端启动失败。");
      return;
    }

    if (this.closed) {
      channel.end();
      return;
    }

    this.channel = channel;
    this.status = "connected";
    this.emit({
      type: "status",
      status: "connected",
      message: connectedMessage,
    });

    channel.on("data", (chunk: Buffer | string) => {
      this.resetIdleTimer();
      this.emit({ type: "output", data: chunk.toString() });
    });
    channel.stderr.on("data", (chunk: Buffer | string) => {
      this.resetIdleTimer();
      this.emit({ type: "output", data: chunk.toString() });
    });
    channel.once("close", (code: number | null, signal: string | null) => {
      this.emit({
        type: "exit",
        code,
        signal,
        message: `远程终端已退出${code === null ? "" : `，退出码 ${code}`}。`,
      });
      this.close("远程终端已退出。");
    });
  }

  private emit(event: CmdbTerminalSessionEvent) {
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

export function createCmdbTerminalSession(
  target: CmdbProjectTerminalTarget,
): CmdbTerminalSessionInfo {
  const session = new CmdbTerminalSession(target);
  sessions.set(session.id, session);
  session.start();
  return session.info();
}

export function getCmdbTerminalSession(sessionId: string) {
  return sessions.get(sessionId) ?? null;
}

export function writeCmdbTerminalSessionInput(sessionId: string, data: string) {
  return sessions.get(sessionId)?.write(data) ?? false;
}

export function closeCmdbTerminalSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  session.close();
  return true;
}
