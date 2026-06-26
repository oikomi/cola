"use client";

import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  CpuIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  PlusIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { IDisposable } from "@xterm/xterm";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ModuleHero,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { ResourceOwnerBadge } from "@/app/_components/resource-owner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { notifyError, notifySuccess } from "@/components/ui/toast";
import {
  formatGpuAllocationLabel,
  gpuAllocationModeLabels,
  gpuAllocationModeValues,
} from "@/lib/gpu-allocation";
import { cn } from "@/lib/utils";
import { api, type RouterOutputs } from "@/trpc/react";

type IsaacStationRow = RouterOutputs["isaacStation"]["list"]["items"][number];
type IsaacStationImageOption =
  RouterOutputs["isaacStation"]["list"]["imageOptions"][number];
type IsaacLabJobRow =
  RouterOutputs["isaacStation"]["listLabJobs"]["items"][number];
type IsaacLabImageOption =
  RouterOutputs["isaacStation"]["listLabJobs"]["imageOptions"][number];
type GpuAllocationMode = (typeof gpuAllocationModeValues)[number];
type IsaacStationMode = "headless-webrtc" | "headless-egl";
type IsaacLabRunner = "direct" | "rsl-rl" | "skrl" | "custom";
type IsaacLabDisplayMode = "headless" | "webrtc";
type IsaacTab = "station" | "lab";
type TerminalSessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";
type TerminalSessionInfo = {
  sessionId: string;
  jobName: string;
  podName: string;
  containerName: string;
  namespace: string;
  nodeName: string | null;
  startedAt: string;
};
type TerminalSessionEvent =
  | {
      type: "output";
      data: string;
    }
  | {
      type: "status";
      status: Exclude<TerminalSessionStatus, "idle" | "error">;
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
type TerminalDimensions = {
  cols: number;
  rows: number;
};

type IsaacStationDraft = {
  name: string;
  image: string;
  cpu: string;
  memoryGi: string;
  gpuAllocationMode: GpuAllocationMode;
  gpuCount: string;
  gpuMemoryGi: string;
  mode: IsaacStationMode;
};

type IsaacLabDraft = {
  name: string;
  image: string;
  runner: IsaacLabRunner;
  displayMode: IsaacLabDisplayMode;
  task: string;
  command: string;
  maxIterations: string;
  cpu: string;
  memoryGi: string;
  gpuAllocationMode: GpuAllocationMode;
  gpuCount: string;
  gpuMemoryGi: string;
};

const STATUS_POLL_INTERVAL_MS = 5000;
const TERMINAL_INPUT_CHUNK_SIZE = 8_000;
const TERMINAL_INPUT_FLUSH_MS = 16;
const TERMINAL_OUTPUT_LIMIT = 1_000_000;
const TERMINAL_RESIZE_FLUSH_MS = 120;
const TERMINAL_CONNECTING_MESSAGE =
  "正在通过 Kubernetes exec 进入 Isaac Lab 容器...\r\n";
const ANSI_ESCAPE_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const dialogControlClassName =
  "h-9 rounded-[10px] border-slate-200/90 bg-white/92 px-2.5 text-[13px] shadow-none";
const selectContentClassName = "max-h-72 rounded-[10px]";
const selectItemClassName = "py-1 pr-7 pl-1.5 text-[13px]";

const defaultStationDraft: IsaacStationDraft = {
  name: "",
  image: "",
  cpu: "8",
  memoryGi: "32",
  gpuAllocationMode: "whole",
  gpuCount: "1",
  gpuMemoryGi: "",
  mode: "headless-webrtc",
};

const defaultLabDraft: IsaacLabDraft = {
  name: "",
  image: "",
  runner: "rsl-rl",
  displayMode: "headless",
  task: "Isaac-Velocity-Flat-G1-v0",
  command: "",
  maxIterations: "1000",
  cpu: "8",
  memoryGi: "48",
  gpuAllocationMode: "whole",
  gpuCount: "1",
  gpuMemoryGi: "",
};

const runnerLabels = {
  direct: "Direct RL",
  "rsl-rl": "RSL-RL",
  skrl: "SKRL",
  custom: "Custom",
} satisfies Record<IsaacLabRunner, string>;

function sanitizeDnsNameInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 42);
}

function statusTone(
  status: IsaacStationRow["status"] | IsaacLabJobRow["status"],
) {
  switch (status) {
    case "running":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "starting":
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "completed":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "error":
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function statusLabel(
  status: IsaacStationRow["status"] | IsaacLabJobRow["status"],
) {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "pending":
      return "排队中";
    case "completed":
      return "已完成";
    case "error":
      return "异常";
    case "failed":
      return "失败";
    default:
      return status;
  }
}

function modeLabel(mode: IsaacStationMode) {
  switch (mode) {
    case "headless-webrtc":
      return "Headless WebRTC";
    case "headless-egl":
      return "Headless EGL";
  }
}

function labDisplayModeLabel(mode: IsaacLabDisplayMode) {
  switch (mode) {
    case "headless":
      return "Headless";
    case "webrtc":
      return "WebRTC";
  }
}

function formatTime(value: Date | string | null | undefined) {
  if (!value) return "未知";

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "未知";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function stationSpecLabel(station: IsaacStationRow) {
  return `${formatGpuAllocationLabel({
    gpuAllocationMode: station.gpuAllocationMode,
    gpuCount: station.gpuCount,
    gpuMemoryGi: station.gpuMemoryGi,
  })} · ${station.cpu} CPU · ${station.memory}`;
}

function labSpecLabel(job: IsaacLabJobRow) {
  return `${formatGpuAllocationLabel({
    gpuAllocationMode: job.gpuAllocationMode,
    gpuCount: job.gpuCount,
    gpuMemoryGi: job.gpuMemoryGi,
  })} · ${job.cpu} CPU · ${job.memory}`;
}

function isaacViewerUrl(params: {
  endpoint: string;
  kind: "station" | "lab";
  name: string;
}) {
  const searchParams = new URLSearchParams({
    endpoint: params.endpoint,
    kind: params.kind,
    name: params.name,
  });

  return `/isaac/viewer?${searchParams.toString()}`;
}

function normalizeTerminalOutput(value: string) {
  return value
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\u0007/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function terminalStatusLabel(status: TerminalSessionStatus) {
  switch (status) {
    case "connecting":
      return "连接中";
    case "connected":
      return "已连接";
    case "closed":
      return "已断开";
    case "error":
      return "失败";
    case "idle":
      return "未连接";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTerminalSessionEvent(data: string): TerminalSessionEvent {
  const value = JSON.parse(data) as unknown;

  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid terminal event");
  }

  switch (value.type) {
    case "output":
      if (typeof value.data !== "string") {
        throw new Error("Invalid terminal output event");
      }
      return { type: "output", data: value.data };
    case "status":
      if (
        value.status !== "connecting" &&
        value.status !== "connected" &&
        value.status !== "closed"
      ) {
        throw new Error("Invalid terminal status event");
      }
      return {
        type: "status",
        status: value.status,
        message: typeof value.message === "string" ? value.message : "",
      };
    case "error":
      return {
        type: "error",
        message:
          typeof value.message === "string"
            ? value.message
            : "Isaac Lab 终端错误",
      };
    case "exit":
      return {
        type: "exit",
        code: typeof value.code === "number" ? value.code : null,
        signal: typeof value.signal === "string" ? value.signal : null,
        message:
          typeof value.message === "string"
            ? value.message
            : "Isaac Lab 终端已退出。",
      };
    default:
      throw new Error("Unknown terminal event");
  }
}

function Field(props: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1.5", props.className)}>
      <span className="text-[12px] leading-4 font-medium text-slate-700">
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-xs leading-4 text-slate-500">{props.hint}</span>
      ) : null}
    </label>
  );
}

function SurfaceLabel(props: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-medium tracking-[0.16em] text-slate-500 uppercase">
      {props.children}
    </p>
  );
}

function LoadingCards() {
  return (
    <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="rounded-[10px] border border-slate-200/85 bg-white/90 p-3"
        >
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-[9px]" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusStrip(props: {
  stations: IsaacStationRow[];
  labJobs: IsaacLabJobRow[];
}) {
  const runningStations = props.stations.filter(
    (station) => station.status === "running",
  ).length;
  const streaming = props.stations.filter((station) =>
    Boolean(station.endpoint),
  ).length;
  const streamingLabJobs = props.labJobs.filter((job) =>
    Boolean(job.endpoint),
  ).length;
  const activeLabJobs = props.labJobs.filter((job) =>
    ["running", "pending"].includes(job.status),
  ).length;
  const gpuCount =
    props.stations.reduce((total, station) => total + station.gpuCount, 0) +
    props.labJobs.reduce((total, job) => total + job.gpuCount, 0);

  return (
    <div className="grid gap-2 md:grid-cols-4">
      <StatusItem
        label="Sim Station"
        value={`${runningStations}/${props.stations.length}`}
      />
      <StatusItem
        label="Lab Jobs"
        value={`${activeLabJobs}/${props.labJobs.length}`}
      />
      <StatusItem
        label="WebRTC"
        value={`${streaming + streamingLabJobs}/${runningStations + activeLabJobs}`}
      />
      <StatusItem label="GPU 申请" value={String(gpuCount)} />
    </div>
  );
}

function StatusItem(props: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-[9px] border border-slate-200/90 bg-white/88 px-3 py-2">
      <span className="truncate text-[11px] leading-4 font-medium text-slate-500">
        {props.label}
      </span>
      <span className="shrink-0 text-[15px] leading-none font-semibold text-slate-950">
        {props.value}
      </span>
    </div>
  );
}

function TabButton(props: {
  value: IsaacTab;
  activeValue: IsaacTab;
  onClick: (value: IsaacTab) => void;
  icon: typeof CpuIcon;
  label: string;
  count: number;
}) {
  const Icon = props.icon;
  const active = props.value === props.activeValue;

  return (
    <button
      type="button"
      className={cn(
        "flex min-w-[150px] items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-left text-[13px] transition md:min-w-0",
        active
          ? "border-slate-300 bg-slate-950 text-white shadow-[0_8px_20px_rgba(15,23,42,0.12)]"
          : "border-slate-200/90 bg-white/90 text-slate-700 hover:bg-slate-50",
      )}
      onClick={() => props.onClick(props.value)}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate font-medium">{props.label}</span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
          active ? "bg-white/14 text-white" : "bg-slate-100 text-slate-600",
        )}
      >
        {props.count}
      </span>
    </button>
  );
}

function StationCard(props: {
  station: IsaacStationRow;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const { station } = props;

  return (
    <article className="rounded-[10px] border border-slate-200/85 bg-white/94 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-emerald-200/85 bg-emerald-50 text-emerald-700">
            <CpuIcon className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm leading-5 font-semibold tracking-normal text-slate-950">
              {station.name}
            </h3>
            <p className="text-xs leading-4 text-slate-500">
              创建于 {formatTime(station.updatedAt)}
            </p>
            <ResourceOwnerBadge
              value={station}
              compact
              className="mt-1 max-w-full"
            />
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-[8px] px-2 py-0.5 text-xs",
            statusTone(station.status),
          )}
        >
          {statusLabel(station.status)}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 border-t border-slate-200/80 pt-3 text-sm leading-5 text-slate-600">
        <div className="min-w-0">
          <SurfaceLabel>运行模式</SurfaceLabel>
          <p className="mt-0.5 truncate font-medium text-slate-950">
            {modeLabel(station.mode)}
          </p>
        </div>
        <div className="min-w-0">
          <SurfaceLabel>资源规格</SurfaceLabel>
          <p className="mt-0.5 truncate font-medium text-slate-950">
            {stationSpecLabel(station)}
          </p>
        </div>
        <div className="min-w-0">
          <SurfaceLabel>节点 / WebRTC</SurfaceLabel>
          <p className="mt-0.5 truncate font-mono text-[12px] text-slate-700">
            {station.nodeName ?? "未分配节点"} ·{" "}
            {station.endpoint ?? "入口待分配"}
          </p>
        </div>
        <div className="min-w-0">
          <SurfaceLabel>镜像</SurfaceLabel>
          <p
            className="mt-0.5 truncate font-mono text-[12px] text-slate-700"
            title={station.image}
          >
            {station.image}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-[9px] border border-slate-200/85 bg-slate-50/75 px-2.5 py-2 text-[12px] leading-5 text-slate-600">
        <div className="flex items-center gap-2">
          <RadioTowerIcon className="size-3.5 shrink-0 text-slate-500" />
          <span className="min-w-0 truncate">
            TCP {station.webrtcPort} · /v1/streaming/*
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          使用 Isaac Sim WebRTC Streaming Client 连接节点 IP，不经过 Xvnc/软件
          GL。
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:justify-end">
        {station.endpoint ? (
          <a
            href={isaacViewerUrl({
              endpoint: station.endpoint,
              kind: "station",
              name: station.name,
            })}
            target="_blank"
            rel="noreferrer"
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "h-7 max-w-full rounded-[8px] border-emerald-200/90 bg-white px-2.5 text-[12px] text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800",
            )}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            <span className="min-w-0 truncate">Web 画面</span>
          </a>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 max-w-full rounded-[8px] px-2.5 text-[12px] text-slate-500"
            disabled
          >
            <RadioTowerIcon data-icon="inline-start" />
            <span className="min-w-0 truncate">入口待分配</span>
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 rounded-[8px] border-rose-200/80 bg-white px-2.5 text-[12px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          disabled={props.isDeleting}
          onClick={props.onDelete}
        >
          {props.isDeleting ? (
            <LoaderCircleIcon
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : (
            <Trash2Icon data-icon="inline-start" />
          )}
          {props.isDeleting ? "删除中" : "删除"}
        </Button>
      </div>
    </article>
  );
}

function LabJobCard(props: {
  job: IsaacLabJobRow;
  isDeleting: boolean;
  onDelete: () => void;
  onCopyEndpoint: () => void;
  onCopySshCommand: () => void;
  onOpenTerminal: () => void;
}) {
  const { job } = props;
  const terminalAvailable = job.status === "running" && Boolean(job.podName);
  const sshAvailable = Boolean(job.sshCommand);

  return (
    <article className="rounded-[10px] border border-slate-200/85 bg-white/94 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-sky-200/85 bg-sky-50 text-sky-700">
            <FlaskConicalIcon className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm leading-5 font-semibold tracking-normal text-slate-950">
              {job.name}
            </h3>
            <p className="text-xs leading-4 text-slate-500">
              创建于 {formatTime(job.createdAt)}
            </p>
            <ResourceOwnerBadge
              value={job}
              compact
              className="mt-1 max-w-full"
            />
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-[8px] px-2 py-0.5 text-xs",
            statusTone(job.status),
          )}
        >
          {statusLabel(job.status)}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 border-t border-slate-200/80 pt-3 text-sm leading-5 text-slate-600">
        <div className="min-w-0">
          <SurfaceLabel>Runner / Task</SurfaceLabel>
          <p className="mt-0.5 truncate font-medium text-slate-950">
            {runnerLabels[job.runner]} · {job.task || "未记录 task"}
          </p>
        </div>
        <div className="min-w-0">
          <SurfaceLabel>显示模式</SurfaceLabel>
          <p className="mt-0.5 truncate font-medium text-slate-950">
            {labDisplayModeLabel(job.displayMode)}
          </p>
        </div>
        <div className="min-w-0">
          <SurfaceLabel>资源规格</SurfaceLabel>
          <p className="mt-0.5 truncate font-medium text-slate-950">
            {labSpecLabel(job)}
          </p>
        </div>
        <div className="min-w-0">
          <SurfaceLabel>Pod / 节点</SurfaceLabel>
          <p className="mt-0.5 truncate font-mono text-[12px] text-slate-700">
            {job.podName ?? "Pod 待创建"} · {job.nodeName ?? "节点待分配"}
          </p>
        </div>
        <div className="min-w-0">
          <SurfaceLabel>镜像</SurfaceLabel>
          <p
            className="mt-0.5 truncate font-mono text-[12px] text-slate-700"
            title={job.image}
          >
            {job.image}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-[9px] border border-slate-200/85 bg-slate-50/75 px-2.5 py-2 text-[12px] leading-5 text-slate-600">
        <p className="line-clamp-2">{job.summary}</p>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          Phase {job.podPhase ?? "Unknown"} · Restarts {job.restarts}
        </p>
      </div>

      {job.displayMode === "webrtc" ? (
        <div className="mt-3 rounded-[9px] border border-sky-200/85 bg-sky-50/70 px-2.5 py-2 text-[12px] leading-5 text-sky-800">
          <div className="flex items-center gap-2">
            <RadioTowerIcon className="size-3.5 shrink-0 text-sky-600" />
            <span className="min-w-0 truncate">
              TCP {job.webrtcPort} · {job.endpoint ?? "入口待分配"}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-sky-700/80">
            WebRTC 客户端连接实际 GPU 节点 IP。
          </p>
        </div>
      ) : null}

      <div className="mt-3 rounded-[9px] border border-slate-200/85 bg-slate-950 px-2.5 py-2 text-[12px] leading-5 text-slate-200">
        <div className="flex items-center gap-2">
          <TerminalIcon className="size-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0 truncate font-mono">
            {job.sshCommand ?? "Pod 运行后生成 SSH 命令"}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:justify-end">
        {job.displayMode === "webrtc" ? (
          <>
            {job.endpoint ? (
              <a
                href={isaacViewerUrl({
                  endpoint: job.endpoint,
                  kind: "lab",
                  name: job.name,
                })}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" }),
                  "h-7 max-w-full rounded-[8px] border-sky-200/90 bg-white px-2.5 text-[12px] text-sky-700 hover:bg-sky-50 hover:text-sky-800",
                )}
              >
                <ExternalLinkIcon data-icon="inline-start" />
                <span className="min-w-0 truncate">Web 画面</span>
              </a>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="h-7 max-w-full rounded-[8px] border-sky-200/90 bg-white px-2.5 text-[12px] text-sky-700 hover:bg-sky-50 hover:text-sky-800"
              disabled={!job.endpoint}
              title={job.endpoint ?? "入口待分配"}
              onClick={props.onCopyEndpoint}
            >
              <CopyIcon data-icon="inline-start" />
              <span className="min-w-0 truncate">
                {job.endpoint ? "复制连接地址" : "入口待分配"}
              </span>
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="h-7 rounded-[8px] border-slate-200/90 bg-white px-2.5 text-[12px] text-slate-600 hover:bg-slate-50 hover:text-slate-950"
          disabled={!sshAvailable}
          title={job.sshCommand ?? "Pod 运行后才能复制 SSH 命令"}
          onClick={props.onCopySshCommand}
        >
          <CopyIcon data-icon="inline-start" />
          SSH
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 rounded-[8px] border-slate-200/90 bg-white px-2.5 text-[12px] text-slate-600 hover:bg-slate-50 hover:text-slate-950"
          disabled={!terminalAvailable}
          title={terminalAvailable ? undefined : "Pod 运行后才能打开 Web 终端"}
          onClick={props.onOpenTerminal}
        >
          <TerminalIcon data-icon="inline-start" />
          终端
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 rounded-[8px] border-rose-200/80 bg-white px-2.5 text-[12px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          disabled={props.isDeleting}
          onClick={props.onDelete}
        >
          {props.isDeleting ? (
            <LoaderCircleIcon
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : (
            <Trash2Icon data-icon="inline-start" />
          )}
          {props.isDeleting ? "删除中" : "删除"}
        </Button>
      </div>
    </article>
  );
}

function responseErrorMessage(response: Response, fallback: string) {
  return response
    .json()
    .then((payload: unknown) => {
      if (
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
      ) {
        return payload.error;
      }

      return fallback;
    })
    .catch(() => fallback);
}

function IsaacLabTerminalDialog(props: {
  open: boolean;
  job: IsaacLabJobRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [terminalSession, setTerminalSession] =
    useState<TerminalSessionInfo | null>(null);
  const [terminalStatusState, setTerminalStatusState] =
    useState<TerminalSessionStatus>("idle");
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalHostElement, setTerminalHostElement] =
    useState<HTMLDivElement | null>(null);
  const terminalEventSourceRef = useRef<EventSource | null>(null);
  const terminalSessionIdRef = useRef<string | null>(null);
  const terminalStatusRef = useRef<TerminalSessionStatus>("idle");
  const terminalStartTokenRef = useRef(0);
  const terminalWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalFitAddonRef = useRef<FitAddon | null>(null);
  const terminalInputDisposableRef = useRef<IDisposable | null>(null);
  const terminalResizeDisposableRef = useRef<IDisposable | null>(null);
  const terminalResizeObserverRef = useRef<ResizeObserver | null>(null);
  const terminalPendingOutputRef = useRef("");
  const terminalOutputRef = useRef("");
  const terminalLastResizeRef = useRef<TerminalDimensions | null>(null);
  const terminalResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const terminalInputBufferRef = useRef("");
  const terminalInputSendingRef = useRef(false);
  const terminalInputFlushTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const setTerminalHost = useCallback((element: HTMLDivElement | null) => {
    terminalHostRef.current = element;
    setTerminalHostElement(element);
  }, []);

  useEffect(() => {
    terminalStatusRef.current = terminalStatusState;
  }, [terminalStatusState]);

  function setTerminalStatus(status: TerminalSessionStatus) {
    terminalStatusRef.current = status;
    setTerminalStatusState(status);
  }

  function closeTerminalSession(options: { reset?: boolean } = {}) {
    terminalStartTokenRef.current += 1;
    terminalEventSourceRef.current?.close();
    terminalEventSourceRef.current = null;
    terminalWriteQueueRef.current = Promise.resolve();
    terminalInputBufferRef.current = "";
    terminalInputSendingRef.current = false;
    if (terminalInputFlushTimerRef.current) {
      clearTimeout(terminalInputFlushTimerRef.current);
      terminalInputFlushTimerRef.current = null;
    }
    if (terminalResizeTimerRef.current) {
      clearTimeout(terminalResizeTimerRef.current);
      terminalResizeTimerRef.current = null;
    }
    terminalLastResizeRef.current = null;

    const sessionId = terminalSessionIdRef.current;
    terminalSessionIdRef.current = null;

    if (sessionId) {
      void fetch(`/api/isaac/terminal-session/${sessionId}`, {
        method: "DELETE",
      });
    }

    if (options.reset ?? true) {
      setTerminalSession(null);
      setTerminalStatus("idle");
      setTerminalError(null);
      terminalPendingOutputRef.current = "";
      terminalOutputRef.current = "";
      terminalRef.current?.reset();
    }
  }

  function rememberTerminalOutput(value: string) {
    const normalized = normalizeTerminalOutput(value);
    if (!normalized) return;

    const next = `${terminalOutputRef.current}${normalized}`;
    terminalOutputRef.current =
      next.length > TERMINAL_OUTPUT_LIMIT
        ? next.slice(-TERMINAL_OUTPUT_LIMIT)
        : next;
  }

  function appendTerminalOutput(value: string) {
    if (terminalRef.current) {
      terminalRef.current.write(value);
    } else {
      terminalPendingOutputRef.current += value;
      if (terminalPendingOutputRef.current.length > TERMINAL_OUTPUT_LIMIT) {
        terminalPendingOutputRef.current =
          terminalPendingOutputRef.current.slice(-TERMINAL_OUTPUT_LIMIT);
      }
    }

    rememberTerminalOutput(value);
  }

  function resetTerminalOutput(value: string) {
    const terminal = terminalRef.current;
    terminalPendingOutputRef.current = terminal
      ? ""
      : value.length > TERMINAL_OUTPUT_LIMIT
        ? value.slice(-TERMINAL_OUTPUT_LIMIT)
        : value;
    terminal?.reset();
    terminal?.write(value);
    const normalized = normalizeTerminalOutput(value);
    terminalOutputRef.current =
      normalized.length > TERMINAL_OUTPUT_LIMIT
        ? normalized.slice(-TERMINAL_OUTPUT_LIMIT)
        : normalized;
  }

  function applyTerminalEvent(
    event: TerminalSessionEvent,
    source: EventSource,
  ) {
    switch (event.type) {
      case "output":
        appendTerminalOutput(event.data);
        break;
      case "status":
        setTerminalStatus(event.status);
        if (event.status === "connected") {
          setTerminalError(null);
        }
        if (event.status === "closed") {
          source.close();
          terminalEventSourceRef.current = null;
          terminalLastResizeRef.current = null;
        }
        break;
      case "error":
        setTerminalStatus("error");
        setTerminalError(event.message);
        appendTerminalOutput(`\r\n${event.message}\r\n`);
        break;
      case "exit":
        setTerminalStatus("closed");
        appendTerminalOutput(`\r\n${event.message}\r\n`);
        source.close();
        terminalEventSourceRef.current = null;
        terminalLastResizeRef.current = null;
        break;
    }
  }

  async function startTerminalLogin(job: IsaacLabJobRow) {
    closeTerminalSession();
    const token = terminalStartTokenRef.current + 1;
    terminalStartTokenRef.current = token;
    setTerminalSession(null);
    setTerminalStatus("connecting");
    resetTerminalOutput(TERMINAL_CONNECTING_MESSAGE);
    terminalWriteQueueRef.current = Promise.resolve();
    terminalInputBufferRef.current = "";
    terminalInputSendingRef.current = false;
    setTerminalError(null);

    try {
      const response = await fetch("/api/isaac/terminal-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobName: job.name }),
      });

      if (!response.ok) {
        throw new Error(
          await responseErrorMessage(response, "Isaac Lab 终端会话创建失败。"),
        );
      }

      const session = (await response.json()) as TerminalSessionInfo;
      if (terminalStartTokenRef.current !== token) {
        void fetch(`/api/isaac/terminal-session/${session.sessionId}`, {
          method: "DELETE",
        });
        return;
      }

      terminalSessionIdRef.current = session.sessionId;
      setTerminalSession(session);
      const source = new EventSource(
        `/api/isaac/terminal-session/${session.sessionId}/stream`,
      );
      terminalEventSourceRef.current = source;

      source.onmessage = (event) => {
        if (terminalSessionIdRef.current !== session.sessionId) return;
        const eventData =
          typeof event.data === "string" ? event.data.trim() : "";
        if (!eventData) return;

        try {
          applyTerminalEvent(parseTerminalSessionEvent(eventData), source);
        } catch {
          setTerminalStatus("error");
          setTerminalError("Isaac Lab 终端返回了无法解析的数据。");
        }
      };

      source.onerror = () => {
        if (terminalSessionIdRef.current !== session.sessionId) return;
        source.close();
        terminalEventSourceRef.current = null;
        setTerminalStatus("error");
        setTerminalError("Isaac Lab 终端输出流已中断。");
      };
    } catch (error) {
      if (terminalStartTokenRef.current !== token) return;
      const message =
        error instanceof Error ? error.message : "Isaac Lab 终端登录失败。";
      setTerminalStatus("error");
      setTerminalError(message);
      appendTerminalOutput(`\r\n${message}\r\n`);
    }
  }

  async function writeTerminalData(data: string) {
    const sessionId = terminalSessionIdRef.current;
    if (!sessionId || terminalStatusRef.current !== "connected") return;

    for (
      let index = 0;
      index < data.length;
      index += TERMINAL_INPUT_CHUNK_SIZE
    ) {
      const chunk = data.slice(index, index + TERMINAL_INPUT_CHUNK_SIZE);
      const response = await fetch(
        `/api/isaac/terminal-session/${sessionId}/input`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: chunk }),
        },
      );

      if (!response.ok) {
        if (terminalSessionIdRef.current !== sessionId) return;
        const message = await responseErrorMessage(
          response,
          "Isaac Lab 终端输入失败。",
        );
        setTerminalStatus("error");
        setTerminalError(message);
        appendTerminalOutput(`\r\n${message}\r\n`);
        return;
      }
    }
  }

  function flushTerminalInput() {
    if (terminalInputFlushTimerRef.current) {
      clearTimeout(terminalInputFlushTimerRef.current);
      terminalInputFlushTimerRef.current = null;
    }

    const data = terminalInputBufferRef.current;
    if (!data || terminalInputSendingRef.current) return;

    terminalInputBufferRef.current = "";
    terminalInputSendingRef.current = true;
    const write = terminalWriteQueueRef.current
      .then(() => writeTerminalData(data))
      .finally(() => {
        terminalInputSendingRef.current = false;
        if (
          terminalInputBufferRef.current &&
          terminalStatusRef.current === "connected"
        ) {
          terminalInputFlushTimerRef.current = setTimeout(
            flushTerminalInput,
            TERMINAL_INPUT_FLUSH_MS,
          );
        }
      });
    terminalWriteQueueRef.current = write.catch(() => undefined);
    void terminalWriteQueueRef.current;
  }

  function queueTerminalInput(data: string) {
    if (!data || terminalStatusRef.current !== "connected") return;

    terminalInputBufferRef.current += data;
    if (terminalInputSendingRef.current || terminalInputFlushTimerRef.current) {
      return;
    }

    terminalInputFlushTimerRef.current = setTimeout(
      flushTerminalInput,
      TERMINAL_INPUT_FLUSH_MS,
    );
  }

  async function copyTerminalOutput() {
    const selectedText = terminalRef.current?.getSelection() ?? "";
    const output = selectedText || terminalOutputRef.current;
    if (!output) {
      notifyError("终端暂无可复制内容。");
      terminalRef.current?.focus();
      return;
    }

    try {
      await writeTextToClipboard(output);
      notifySuccess({
        title: selectedText ? "已复制选中内容" : "已复制终端缓冲",
        message: selectedText ? "已复制当前选区。" : "已复制最近的终端输出。",
      });
    } catch {
      notifyError("复制失败，请手动选择终端内容复制。");
    } finally {
      terminalRef.current?.focus();
    }
  }

  function clearTerminalOutput() {
    const terminal = terminalRef.current;
    terminal?.clear();
    terminalOutputRef.current = "";
    terminal?.focus();
  }

  function scrollTerminalPage(pageCount: number) {
    const terminal = terminalRef.current;
    terminal?.scrollPages(pageCount);
    terminal?.focus();
  }

  function scrollTerminalToBottom() {
    const terminal = terminalRef.current;
    terminal?.scrollToBottom();
    terminal?.focus();
  }

  async function resizeTerminalSession(dimensions: TerminalDimensions) {
    const sessionId = terminalSessionIdRef.current;
    if (!sessionId || terminalStatusRef.current !== "connected") return;

    await fetch(`/api/isaac/terminal-session/${sessionId}/resize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dimensions),
    }).catch(() => undefined);
  }

  function queueTerminalResize(dimensions: TerminalDimensions) {
    if (
      !terminalSessionIdRef.current ||
      terminalStatusRef.current !== "connected"
    ) {
      terminalLastResizeRef.current = null;
      return;
    }

    const next = {
      cols: Math.max(20, Math.min(400, Math.floor(dimensions.cols))),
      rows: Math.max(5, Math.min(200, Math.floor(dimensions.rows))),
    };
    const previous = terminalLastResizeRef.current;
    if (previous?.cols === next.cols && previous.rows === next.rows) return;

    terminalLastResizeRef.current = next;

    if (terminalResizeTimerRef.current) {
      clearTimeout(terminalResizeTimerRef.current);
    }

    terminalResizeTimerRef.current = setTimeout(() => {
      terminalResizeTimerRef.current = null;
      void resizeTerminalSession(next);
    }, TERMINAL_RESIZE_FLUSH_MS);
  }

  useEffect(() => {
    if (!props.open || !props.job) return;
    void startTerminalLogin(props.job);

    return () => {
      closeTerminalSession();
    };
    // Terminal callbacks intentionally read refs; re-running would reset the active shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.job?.id]);

  useEffect(() => {
    if (!props.open) return;
    if (!terminalHostElement || terminalRef.current) return;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorInactiveStyle: "outline",
      cursorStyle: "block",
      disableStdin: terminalStatusRef.current !== "connected",
      fontFamily:
        "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      minimumContrastRatio: 4.5,
      scrollback: 100_000,
      scrollOnEraseInDisplay: true,
      scrollOnUserInput: true,
      scrollSensitivity: 1.2,
      smoothScrollDuration: 0,
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
        cursorAccent: "#020617",
        selectionBackground: "#334155",
        selectionInactiveBackground: "#1e293b",
        black: "#0f172a",
        red: "#fb7185",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#64748b",
        brightRed: "#fda4af",
        brightGreen: "#86efac",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostElement);
    terminal.attachCustomWheelEventHandler((event) => {
      event.stopPropagation();
      return true;
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;

      if (event.key === "PageUp") {
        terminal.scrollPages(-1);
        return false;
      }

      if (event.key === "PageDown") {
        terminal.scrollPages(1);
        return false;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Home") {
        terminal.scrollToTop();
        return false;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "End") {
        terminal.scrollToBottom();
        return false;
      }

      return true;
    });
    terminalRef.current = terminal;
    terminalFitAddonRef.current = fitAddon;
    terminalInputDisposableRef.current = terminal.onData(queueTerminalInput);
    terminalResizeDisposableRef.current = terminal.onResize((dimensions) => {
      queueTerminalResize(dimensions);
    });

    const fitTerminal = () => {
      try {
        fitAddon.fit();
        queueTerminalResize({ cols: terminal.cols, rows: terminal.rows });
      } catch {
        // The xterm viewport can briefly have no measurable size during dialog transitions.
      }
    };

    const animationFrame = window.requestAnimationFrame(() => {
      fitTerminal();
      terminal.focus();
      if (terminalPendingOutputRef.current) {
        terminal.write(terminalPendingOutputRef.current);
        terminalPendingOutputRef.current = "";
      }
    });

    terminalResizeObserverRef.current = new ResizeObserver(() => {
      window.requestAnimationFrame(fitTerminal);
    });
    terminalResizeObserverRef.current.observe(terminalHostElement);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      terminalInputDisposableRef.current?.dispose();
      terminalInputDisposableRef.current = null;
      terminalResizeDisposableRef.current?.dispose();
      terminalResizeDisposableRef.current = null;
      terminalResizeObserverRef.current?.disconnect();
      terminalResizeObserverRef.current = null;
      terminalFitAddonRef.current?.dispose();
      terminalFitAddonRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      terminalLastResizeRef.current = null;
    };
    // Terminal callbacks intentionally read refs; re-running would reset the active shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, terminalHostElement]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    terminal.options.disableStdin = terminalStatusState !== "connected";
    if (terminalStatusState === "connected") {
      terminal.focus();
      terminalLastResizeRef.current = null;
      queueTerminalResize({ cols: terminal.cols, rows: terminal.rows });
    }
    // Terminal callbacks intentionally read refs; re-running would reset the active shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalStatusState]);

  useEffect(() => {
    return () => {
      terminalStartTokenRef.current += 1;
      terminalEventSourceRef.current?.close();
      if (terminalInputFlushTimerRef.current) {
        clearTimeout(terminalInputFlushTimerRef.current);
      }
      if (terminalResizeTimerRef.current) {
        clearTimeout(terminalResizeTimerRef.current);
      }
      const sessionId = terminalSessionIdRef.current;
      if (sessionId) {
        void fetch(`/api/isaac/terminal-session/${sessionId}`, {
          method: "DELETE",
        });
      }
    };
  }, []);

  const terminalTarget =
    terminalSession?.podName ?? props.job?.podName ?? "等待 Pod";
  const terminalStatusFailed = terminalStatusState === "error";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[min(1400px,calc(100vw-1rem))] flex-col overflow-hidden border-slate-200/85 bg-white p-0 shadow-[0_28px_68px_rgba(15,23,42,0.14)]">
        <DialogHeader className="shrink-0 border-b border-slate-200/85 px-4 py-3 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                  Web Terminal
                </Badge>
                <Badge
                  variant="outline"
                  className="border-slate-200/90 bg-white"
                >
                  Kubernetes exec
                </Badge>
              </div>
              <DialogTitle className="truncate">
                Isaac Lab 终端 · {props.job?.name ?? "-"}
              </DialogTitle>
              <DialogDescription className="mt-1">
                进入运行中的 Isaac Lab 容器，手动查看日志、运行命令或启动实验。
              </DialogDescription>
            </div>
            <Badge
              className={cn(
                "shrink-0 border text-xs",
                terminalStatusState === "connected"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : terminalStatusFailed
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-slate-200 bg-slate-50 text-slate-700",
              )}
            >
              {terminalStatusState === "connecting" ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              {terminalStatusLabel(terminalStatusState)}
            </Badge>
          </div>
        </DialogHeader>

        <div className="grid shrink-0 overflow-hidden border-b border-slate-200 bg-slate-200 text-sm md:grid-cols-4">
          <div className="bg-white px-3 py-2.5">
            <SurfaceLabel>Job</SurfaceLabel>
            <p className="mt-1 truncate font-medium text-slate-950">
              {props.job?.name ?? "-"}
            </p>
          </div>
          <div className="bg-white px-3 py-2.5">
            <SurfaceLabel>Pod</SurfaceLabel>
            <p className="mt-1 truncate font-mono text-[12px] text-slate-900">
              {terminalTarget}
            </p>
          </div>
          <div className="bg-white px-3 py-2.5">
            <SurfaceLabel>容器</SurfaceLabel>
            <p className="mt-1 truncate font-mono text-[12px] text-slate-900">
              {terminalSession?.containerName ?? "isaac-lab"}
            </p>
          </div>
          <div className="bg-white px-3 py-2.5">
            <SurfaceLabel>节点</SurfaceLabel>
            <p className="mt-1 truncate font-mono text-[12px] text-slate-900">
              {terminalSession?.nodeName ?? props.job?.nodeName ?? "-"}
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-50/70 p-3">
          {terminalError ? (
            <Alert className="shrink-0 border-rose-200 bg-rose-50 text-rose-900">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>终端连接异常</AlertTitle>
              <AlertDescription>{terminalError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-[10px] border border-slate-900 bg-slate-950 shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex shrink-0 gap-1.5">
                  <span className="size-2 rounded-full bg-rose-400" />
                  <span className="size-2 rounded-full bg-amber-300" />
                  <span className="size-2 rounded-full bg-emerald-400" />
                </span>
                <span className="truncate font-mono text-xs text-slate-300">
                  kubectl exec -n {terminalSession?.namespace ?? "remote-work"}{" "}
                  {terminalTarget}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-[7px] px-2 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white"
                  onClick={() => scrollTerminalPage(-1)}
                  title="上翻一页"
                >
                  <ArrowUpIcon className="size-3.5" />
                  <span className="hidden lg:inline">上翻</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-[7px] px-2 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white"
                  onClick={scrollTerminalToBottom}
                  title="回到底部"
                >
                  <ArrowDownIcon className="size-3.5" />
                  <span className="hidden lg:inline">到底</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-[7px] px-2 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white"
                  onClick={() => void copyTerminalOutput()}
                  title="复制选中内容或终端缓冲"
                >
                  <CopyIcon className="size-3.5" />
                  <span className="hidden lg:inline">复制</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-[7px] px-2 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white"
                  onClick={clearTerminalOutput}
                  title="清屏"
                >
                  <RotateCcwIcon className="size-3.5" />
                  <span className="hidden lg:inline">清屏</span>
                </Button>
              </div>
            </div>
            <div
              onClick={() => terminalRef.current?.focus()}
              className="relative min-h-0 flex-1 overflow-hidden overscroll-contain focus-within:ring-2 focus-within:ring-sky-500/70 focus-within:ring-inset"
            >
              <div
                ref={setTerminalHost}
                aria-label="Isaac Lab Web 终端"
                role="application"
                className={cn(
                  "h-full w-full cursor-text overscroll-contain bg-slate-950 px-3 py-3 text-slate-100",
                  "[&_.xterm]:h-full [&_.xterm-viewport]:overflow-y-auto [&_.xterm-viewport]:overscroll-contain [&_.xterm-viewport]:[scrollbar-color:rgba(148,163,184,0.7)_transparent] [&_.xterm-viewport::-webkit-scrollbar]:w-2 [&_.xterm-viewport::-webkit-scrollbar-thumb]:rounded-full [&_.xterm-viewport::-webkit-scrollbar-thumb]:bg-slate-600 [&_.xterm-viewport::-webkit-scrollbar-track]:bg-transparent",
                )}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GpuFields<
  T extends {
    gpuAllocationMode: GpuAllocationMode;
    gpuCount: string;
    gpuMemoryGi: string;
  },
>(props: { draft: T; onDraftChange: (updater: (current: T) => T) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Field label="GPU 模式">
        <Select
          value={props.draft.gpuAllocationMode}
          onValueChange={(value) => {
            if (!value) return;
            props.onDraftChange((current) => ({
              ...current,
              gpuAllocationMode: value,
              gpuCount:
                value === "memory" && current.gpuCount === "0"
                  ? "1"
                  : current.gpuCount,
            }));
          }}
        >
          <SelectTrigger className={dialogControlClassName}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-[10px]">
            <SelectGroup>
              {gpuAllocationModeValues.map((mode) => (
                <SelectItem
                  key={mode}
                  value={mode}
                  className={selectItemClassName}
                >
                  {gpuAllocationModeLabels[mode]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field label="GPU 数量">
        <Input
          inputMode="numeric"
          className={dialogControlClassName}
          value={props.draft.gpuCount}
          onChange={(event) =>
            props.onDraftChange((current) => ({
              ...current,
              gpuCount: event.target.value.replace(/\D/g, ""),
            }))
          }
        />
      </Field>
      <Field
        label="每份显存 Gi"
        hint={
          props.draft.gpuAllocationMode === "memory"
            ? "显存份额调度依赖 HAMi。"
            : "整卡模式无需填写。"
        }
      >
        <Input
          inputMode="numeric"
          className={dialogControlClassName}
          value={props.draft.gpuMemoryGi}
          disabled={props.draft.gpuAllocationMode !== "memory"}
          onChange={(event) =>
            props.onDraftChange((current) => ({
              ...current,
              gpuMemoryGi: event.target.value.replace(/\D/g, ""),
            }))
          }
        />
      </Field>
    </div>
  );
}

function IsaacStationDialog(props: {
  open: boolean;
  available: boolean;
  capabilityReason: string | null;
  draft: IsaacStationDraft;
  imageOptions: IsaacStationImageOption[];
  selectedImage: IsaacStationImageOption | null;
  canCreate: boolean;
  submitDisabledReason: string | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (
    updater: (current: IsaacStationDraft) => IsaacStationDraft,
  ) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-slate-200/85 bg-white shadow-[0_28px_68px_rgba(15,23,42,0.14)] sm:max-w-2xl">
        <DialogHeader className="gap-1.5">
          <div className="mb-1 flex items-center gap-1.5">
            <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
              Sim Station
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/90"
            >
              Kubernetes GPU Pod
            </Badge>
          </div>
          <DialogTitle>创建 Sim Station</DialogTitle>
          <DialogDescription>
            新建一个 Isaac Sim headless 实例，使用 NVIDIA GPU
            执行仿真和远程可视化。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Field label="Station 名称">
            <Input
              className={dialogControlClassName}
              value={props.draft.name}
              onChange={(event) =>
                props.onDraftChange((current) => ({
                  ...current,
                  name: sanitizeDnsNameInput(event.target.value),
                }))
              }
              placeholder="例如：office-sim-01"
            />
          </Field>

          <Field
            label="Isaac Sim 镜像"
            hint={
              props.selectedImage?.description ?? "镜像可通过环境变量配置。"
            }
          >
            <Select
              value={props.draft.image}
              onValueChange={(value) => {
                if (!value) return;
                props.onDraftChange((current) => ({
                  ...current,
                  image: value,
                }));
              }}
            >
              <SelectTrigger className={dialogControlClassName}>
                <SelectValue placeholder="选择 Isaac Sim 镜像" />
              </SelectTrigger>
              <SelectContent className={selectContentClassName}>
                <SelectGroup>
                  {props.imageOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className={selectItemClassName}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="CPU">
              <Input
                inputMode="decimal"
                className={dialogControlClassName}
                value={props.draft.cpu}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    cpu: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="内存 Gi">
              <Input
                inputMode="numeric"
                className={dialogControlClassName}
                value={props.draft.memoryGi}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    memoryGi: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </Field>
            <Field label="模式">
              <Select
                value={props.draft.mode}
                onValueChange={(value) => {
                  if (!value) return;
                  props.onDraftChange((current) => ({
                    ...current,
                    mode: value as IsaacStationMode,
                  }));
                }}
              >
                <SelectTrigger className={dialogControlClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[10px]">
                  <SelectGroup>
                    <SelectItem
                      value="headless-webrtc"
                      className={selectItemClassName}
                    >
                      Headless WebRTC
                    </SelectItem>
                    <SelectItem
                      value="headless-egl"
                      className={selectItemClassName}
                    >
                      Headless EGL
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <GpuFields draft={props.draft} onDraftChange={props.onDraftChange} />

          <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/80 px-3 py-2.5 text-[12px] leading-5 text-slate-600">
            WebRTC 模式会使用 hostNetwork 暴露 Isaac streaming 端口；EGL
            模式只保留 headless 仿真运行，不提供浏览器画面入口。
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="rounded-[10px]"
            onClick={() => props.onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            className="rounded-[10px]"
            disabled={!props.canCreate || props.isPending}
            title={props.submitDisabledReason ?? undefined}
            onClick={props.onSubmit}
          >
            {props.isPending ? (
              <LoaderCircleIcon
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            {props.isPending ? "创建中" : "创建 Station"}
          </Button>
        </DialogFooter>

        {!props.available && props.capabilityReason ? (
          <p className="text-[12px] leading-5 text-rose-600">
            {props.capabilityReason}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function IsaacLabDialog(props: {
  open: boolean;
  available: boolean;
  capabilityReason: string | null;
  draft: IsaacLabDraft;
  imageOptions: IsaacLabImageOption[];
  selectedImage: IsaacLabImageOption | null;
  canCreate: boolean;
  submitDisabledReason: string | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (updater: (current: IsaacLabDraft) => IsaacLabDraft) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-slate-200/85 bg-white shadow-[0_28px_68px_rgba(15,23,42,0.14)] sm:max-w-3xl">
        <DialogHeader className="gap-1.5">
          <div className="mb-1 flex items-center gap-1.5">
            <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
              Lab Jobs
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/90"
            >
              Kubernetes Job
            </Badge>
          </div>
          <DialogTitle>创建 Isaac Lab Job</DialogTitle>
          <DialogDescription>
            提交 Isaac Lab 训练或实验任务，可选择纯 headless 或 WebRTC 可视化。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-[1fr_0.75fr_0.75fr]">
            <Field label="Job 名称">
              <Input
                className={dialogControlClassName}
                value={props.draft.name}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    name: sanitizeDnsNameInput(event.target.value),
                  }))
                }
                placeholder="例如：g1-rsl-flat"
              />
            </Field>
            <Field label="Runner">
              <Select
                value={props.draft.runner}
                onValueChange={(value) => {
                  if (!value) return;
                  props.onDraftChange((current) => ({
                    ...current,
                    runner: value as IsaacLabRunner,
                  }));
                }}
              >
                <SelectTrigger className={dialogControlClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[10px]">
                  <SelectGroup>
                    {(Object.keys(runnerLabels) as IsaacLabRunner[]).map(
                      (runner) => (
                        <SelectItem
                          key={runner}
                          value={runner}
                          className={selectItemClassName}
                        >
                          {runnerLabels[runner]}
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="显示模式">
              <Select
                value={props.draft.displayMode}
                onValueChange={(value) => {
                  if (!value) return;
                  props.onDraftChange((current) => ({
                    ...current,
                    displayMode: value as IsaacLabDisplayMode,
                  }));
                }}
              >
                <SelectTrigger className={dialogControlClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[10px]">
                  <SelectGroup>
                    <SelectItem
                      value="headless"
                      className={selectItemClassName}
                    >
                      Headless
                    </SelectItem>
                    <SelectItem value="webrtc" className={selectItemClassName}>
                      WebRTC
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label="Isaac Lab 镜像"
            hint={
              props.selectedImage?.description ?? "镜像可通过环境变量配置。"
            }
          >
            <Select
              value={props.draft.image}
              onValueChange={(value) => {
                if (!value) return;
                props.onDraftChange((current) => ({
                  ...current,
                  image: value,
                }));
              }}
            >
              <SelectTrigger className={dialogControlClassName}>
                <SelectValue placeholder="选择 Isaac Lab 镜像" />
              </SelectTrigger>
              <SelectContent className={selectContentClassName}>
                <SelectGroup>
                  {props.imageOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className={selectItemClassName}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-3 md:grid-cols-[1fr_0.5fr]">
            <Field label="Task">
              <Input
                className={dialogControlClassName}
                value={props.draft.task}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    task: event.target.value.trim(),
                  }))
                }
                placeholder="Isaac-Velocity-Flat-G1-v0"
              />
            </Field>
            <Field label="最大迭代">
              <Input
                inputMode="numeric"
                className={dialogControlClassName}
                value={props.draft.maxIterations}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    maxIterations: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </Field>
          </div>

          {props.draft.runner === "custom" ? (
            <Field
              label="启动命令"
              hint="Custom runner 会直接执行这段 shell；WebRTC 模式只负责暴露端口，命令参数由你控制。"
            >
              <Textarea
                className="min-h-28 rounded-[10px] border-slate-200/90 bg-white/92 px-2.5 py-2 font-mono text-[12px] shadow-none"
                value={props.draft.command}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    command: event.target.value,
                  }))
                }
                placeholder="cd /shared-dist-storage/my-isaac-train && /workspace/isaaclab/isaaclab.sh -p train.py --task Isaac-Velocity-Flat-G1-v0 --headless --livestream 2 --max_iterations 1000"
              />
            </Field>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="CPU">
              <Input
                inputMode="decimal"
                className={dialogControlClassName}
                value={props.draft.cpu}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    cpu: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="内存 Gi">
              <Input
                inputMode="numeric"
                className={dialogControlClassName}
                value={props.draft.memoryGi}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    memoryGi: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </Field>
          </div>

          <GpuFields draft={props.draft} onDraftChange={props.onDraftChange} />

          <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/80 px-3 py-2.5 text-[12px] leading-5 text-slate-600">
            Headless 会追加 <code>--headless</code>；WebRTC 会追加{" "}
            <code>--headless --livestream 2</code> 并使用 GPU 节点网络暴露 8011
            端口。Custom runner 直接执行你填写的命令，手动 SSH
            运行时也要自己带上这些参数。
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="rounded-[10px]"
            onClick={() => props.onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            className="rounded-[10px]"
            disabled={!props.canCreate || props.isPending}
            title={props.submitDisabledReason ?? undefined}
            onClick={props.onSubmit}
          >
            {props.isPending ? (
              <LoaderCircleIcon
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            {props.isPending ? "提交中" : "提交 Job"}
          </Button>
        </DialogFooter>

        {!props.available && props.capabilityReason ? (
          <p className="text-[12px] leading-5 text-rose-600">
            {props.capabilityReason}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function parsePositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function parsePositiveInt(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

async function writeTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Intranet HTTP pages can reject the Clipboard API even after a click.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto 0";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy command rejected");
    }
  } finally {
    textarea.remove();
  }
}

export function IsaacShell() {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState<IsaacTab>("lab");
  const [isStationCreateOpen, setIsStationCreateOpen] = useState(false);
  const [isLabCreateOpen, setIsLabCreateOpen] = useState(false);
  const [terminalJob, setTerminalJob] = useState<IsaacLabJobRow | null>(null);
  const [pendingDeletedStationNames, setPendingDeletedStationNames] = useState<
    string[]
  >([]);
  const [pendingDeletedLabNames, setPendingDeletedLabNames] = useState<
    string[]
  >([]);
  const [stationDraft, setStationDraft] =
    useState<IsaacStationDraft>(defaultStationDraft);
  const [labDraft, setLabDraft] = useState<IsaacLabDraft>(defaultLabDraft);

  const stationQuery = api.isaacStation.list.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.error ? false : STATUS_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
  const labQuery = api.isaacStation.listLabJobs.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.error ? false : STATUS_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const createStation = api.isaacStation.create.useMutation({
    onSuccess: async () => {
      await utils.isaacStation.list.invalidate();
      setIsStationCreateOpen(false);
      setStationDraft((current) => ({
        ...defaultStationDraft,
        image: current.image,
      }));
    },
    onError: (error) => notifyError(error.message),
  });

  const deleteStation = api.isaacStation.delete.useMutation({
    onMutate: ({ name }) => {
      setPendingDeletedStationNames((current) =>
        current.includes(name) ? current : [...current, name],
      );
    },
    onSuccess: async (_result, variables) => {
      setPendingDeletedStationNames((current) =>
        current.includes(variables.name)
          ? current
          : [...current, variables.name],
      );
      notifySuccess(`Isaac Station ${variables.name} 已删除。`);
      await stationQuery.refetch();
      await utils.isaacStation.list.invalidate();
    },
    onError: (error, variables) => {
      setPendingDeletedStationNames((current) =>
        current.filter((name) => name !== variables.name),
      );
      notifyError(error.message);
    },
  });

  const createLabJob = api.isaacStation.createLabJob.useMutation({
    onSuccess: async () => {
      await utils.isaacStation.listLabJobs.invalidate();
      setIsLabCreateOpen(false);
      setLabDraft((current) => ({
        ...defaultLabDraft,
        image: current.image,
        displayMode: current.displayMode,
      }));
    },
    onError: (error) => notifyError(error.message),
  });

  const deleteLabJob = api.isaacStation.deleteLabJob.useMutation({
    onMutate: ({ name }) => {
      setPendingDeletedLabNames((current) =>
        current.includes(name) ? current : [...current, name],
      );
    },
    onSuccess: async (_result, variables) => {
      setPendingDeletedLabNames((current) =>
        current.includes(variables.name)
          ? current
          : [...current, variables.name],
      );
      setTerminalJob((current) =>
        current?.name === variables.name ? null : current,
      );
      notifySuccess(`Isaac Lab Job ${variables.name} 已删除。`);
      await labQuery.refetch();
      await utils.isaacStation.listLabJobs.invalidate();
    },
    onError: (error, variables) => {
      setPendingDeletedLabNames((current) =>
        current.filter((name) => name !== variables.name),
      );
      notifyError(error.message);
    },
  });

  const stationImageOptions = useMemo(
    () => stationQuery.data?.imageOptions ?? [],
    [stationQuery.data?.imageOptions],
  );
  const labImageOptions = useMemo(
    () => labQuery.data?.imageOptions ?? [],
    [labQuery.data?.imageOptions],
  );

  useEffect(() => {
    if (stationDraft.image || stationImageOptions.length === 0) return;
    setStationDraft((current) => ({
      ...current,
      image: stationImageOptions[0]?.value ?? "",
    }));
  }, [stationDraft.image, stationImageOptions]);

  useEffect(() => {
    if (labDraft.image || labImageOptions.length === 0) return;
    setLabDraft((current) => ({
      ...current,
      image: labImageOptions[0]?.value ?? "",
    }));
  }, [labDraft.image, labImageOptions]);

  const stationRows = (stationQuery.data?.items ?? []).filter(
    (station) => !pendingDeletedStationNames.includes(station.name),
  );
  const labRows = (labQuery.data?.items ?? []).filter(
    (job) => !pendingDeletedLabNames.includes(job.name),
  );
  const stationReason =
    stationQuery.data?.reason ?? stationQuery.error?.message ?? null;
  const labReason = labQuery.data?.reason ?? labQuery.error?.message ?? null;
  const stationAvailable = stationQuery.data?.available === true;
  const labAvailable = labQuery.data?.available === true;
  const anyAvailable = stationAvailable || labAvailable;
  const isChecking =
    (stationQuery.isLoading && !stationQuery.error) ||
    (labQuery.isLoading && !labQuery.error);
  const activeAvailable =
    activeTab === "station" ? stationAvailable : labAvailable;
  const activeReason = activeTab === "station" ? stationReason : labReason;

  const parsedStationMemoryGi = parsePositiveInt(stationDraft.memoryGi);
  const parsedStationGpuCount = parsePositiveInt(stationDraft.gpuCount);
  const parsedStationGpuMemoryGi = parsePositiveInt(stationDraft.gpuMemoryGi);
  const stationCanCreate =
    stationAvailable &&
    stationDraft.name.length >= 2 &&
    stationDraft.image.trim().length > 0 &&
    Number.isFinite(parsePositiveNumber(stationDraft.cpu)) &&
    Number.isInteger(parsedStationMemoryGi) &&
    Number.isInteger(parsedStationGpuCount) &&
    parsedStationGpuCount <= 16 &&
    (stationDraft.gpuAllocationMode !== "memory" ||
      (Number.isInteger(parsedStationGpuMemoryGi) &&
        parsedStationGpuMemoryGi <= 1024));
  const stationSubmitDisabledReason = !stationAvailable
    ? (stationReason ?? "K8s 当前不可用")
    : stationDraft.name.length < 2
      ? "名称至少 2 个字符"
      : !stationDraft.image.trim()
        ? "请选择 Isaac Sim 镜像"
        : !Number.isFinite(parsePositiveNumber(stationDraft.cpu))
          ? "CPU 必须大于 0"
          : !Number.isInteger(parsedStationMemoryGi)
            ? "内存必须是正整数"
            : !Number.isInteger(parsedStationGpuCount) ||
                parsedStationGpuCount > 16
              ? "Isaac Station 至少需要 1 个 GPU"
              : stationDraft.gpuAllocationMode === "memory" &&
                  (!Number.isInteger(parsedStationGpuMemoryGi) ||
                    parsedStationGpuMemoryGi > 1024)
                ? "显存必须是 1-1024 Gi"
                : null;

  const parsedLabMemoryGi = parsePositiveInt(labDraft.memoryGi);
  const parsedLabGpuCount = parsePositiveInt(labDraft.gpuCount);
  const parsedLabGpuMemoryGi = parsePositiveInt(labDraft.gpuMemoryGi);
  const parsedMaxIterations = parsePositiveInt(labDraft.maxIterations);
  const labCanCreate =
    labAvailable &&
    labDraft.name.length >= 2 &&
    labDraft.image.trim().length > 0 &&
    labDraft.task.trim().length >= 3 &&
    (labDraft.runner !== "custom" || labDraft.command.trim().length > 0) &&
    Number.isFinite(parsePositiveNumber(labDraft.cpu)) &&
    Number.isInteger(parsedLabMemoryGi) &&
    Number.isInteger(parsedLabGpuCount) &&
    parsedLabGpuCount <= 16 &&
    Number.isInteger(parsedMaxIterations) &&
    (labDraft.gpuAllocationMode !== "memory" ||
      (Number.isInteger(parsedLabGpuMemoryGi) && parsedLabGpuMemoryGi <= 1024));
  const labSubmitDisabledReason = !labAvailable
    ? (labReason ?? "K8s 当前不可用")
    : labDraft.name.length < 2
      ? "名称至少 2 个字符"
      : !labDraft.image.trim()
        ? "请选择 Isaac Lab 镜像"
        : labDraft.task.trim().length < 3
          ? "Task 至少 3 个字符"
          : labDraft.runner === "custom" && !labDraft.command.trim()
            ? "Custom runner 必须填写启动命令"
            : !Number.isFinite(parsePositiveNumber(labDraft.cpu))
              ? "CPU 必须大于 0"
              : !Number.isInteger(parsedLabMemoryGi)
                ? "内存必须是正整数"
                : !Number.isInteger(parsedLabGpuCount) || parsedLabGpuCount > 16
                  ? "Isaac Lab Job 至少需要 1 个 GPU"
                  : !Number.isInteger(parsedMaxIterations)
                    ? "最大迭代必须是正整数"
                    : labDraft.gpuAllocationMode === "memory" &&
                        (!Number.isInteger(parsedLabGpuMemoryGi) ||
                          parsedLabGpuMemoryGi > 1024)
                      ? "显存必须是 1-1024 Gi"
                      : null;

  const selectedStationImage =
    stationImageOptions.find((option) => option.value === stationDraft.image) ??
    null;
  const selectedLabImage =
    labImageOptions.find((option) => option.value === labDraft.image) ?? null;

  useEffect(() => {
    const reason = activeTab === "station" ? stationReason : labReason;
    if (!reason) return;
    notifyError({
      title: "Kubernetes 访问异常",
      message: reason,
    });
  }, [activeTab, labReason, stationReason]);

  useEffect(() => {
    const liveNames = new Set(
      (stationQuery.data?.items ?? []).map((station) => station.name),
    );
    setPendingDeletedStationNames((current) => {
      const next = current.filter((name) => liveNames.has(name));
      return next.length === current.length ? current : next;
    });
  }, [stationQuery.data?.items]);

  useEffect(() => {
    const liveNames = new Set(
      (labQuery.data?.items ?? []).map((job) => job.name),
    );
    setPendingDeletedLabNames((current) => {
      const next = current.filter((name) => liveNames.has(name));
      return next.length === current.length ? current : next;
    });
  }, [labQuery.data?.items]);

  const handleCreateStation = async () => {
    await createStation.mutateAsync({
      name: stationDraft.name,
      image: stationDraft.image,
      cpu: stationDraft.cpu,
      memoryGi: parsedStationMemoryGi,
      gpuAllocationMode: stationDraft.gpuAllocationMode,
      gpuCount: parsedStationGpuCount,
      gpuMemoryGi:
        stationDraft.gpuAllocationMode === "memory"
          ? parsedStationGpuMemoryGi
          : null,
      mode: stationDraft.mode,
    });
  };

  const handleCreateLabJob = async () => {
    await createLabJob.mutateAsync({
      name: labDraft.name,
      image: labDraft.image,
      runner: labDraft.runner,
      displayMode: labDraft.displayMode,
      task: labDraft.task.trim(),
      command: labDraft.runner === "custom" ? labDraft.command : null,
      maxIterations: parsedMaxIterations,
      cpu: labDraft.cpu,
      memoryGi: parsedLabMemoryGi,
      gpuAllocationMode: labDraft.gpuAllocationMode,
      gpuCount: parsedLabGpuCount,
      gpuMemoryGi:
        labDraft.gpuAllocationMode === "memory" ? parsedLabGpuMemoryGi : null,
    });
  };

  const handleCopyLabEndpoint = useCallback(async (job: IsaacLabJobRow) => {
    if (!job.endpoint) {
      notifyError("WebRTC 入口尚未分配。");
      return;
    }

    try {
      await writeTextToClipboard(job.endpoint);
      notifySuccess({
        title: "连接地址已复制",
        message: job.endpoint,
      });
    } catch {
      notifyError({
        title: "复制失败",
        message: `请手动复制页面上的连接地址：${job.endpoint}`,
      });
    }
  }, []);

  const handleCopyLabSshCommand = useCallback(async (job: IsaacLabJobRow) => {
    if (!job.sshCommand) {
      notifyError("SSH 命令尚未生成。");
      return;
    }

    try {
      await writeTextToClipboard(job.sshCommand);
      notifySuccess({
        title: "SSH 命令已复制",
        message: job.sshCommand,
      });
    } catch {
      notifyError({
        title: "复制失败",
        message: `请手动复制页面上的 SSH 命令：${job.sshCommand}`,
      });
    }
  }, []);

  const handleDeleteStation = async (name: string) => {
    const confirmed = await confirm({
      title: `确认删除 Sim Station ${name}？`,
      description:
        "删除后会释放对应的 Isaac Sim GPU Pod 和 streaming 入口，运行中的仿真会立即停止。",
      confirmLabel: "删除 Station",
    });
    if (!confirmed) return;
    await deleteStation.mutateAsync({ name });
  };

  const handleDeleteLabJob = async (name: string) => {
    const confirmed = await confirm({
      title: `确认删除 Isaac Lab Job ${name}？`,
      description: "删除后会停止并清理对应的 Kubernetes Job 和 Pod。",
      confirmLabel: "删除 Job",
    });
    if (!confirmed) return;
    await deleteLabJob.mutateAsync({ name });
  };

  const handleRefresh = () => {
    if (activeTab === "station") {
      void stationQuery.refetch();
      return;
    }
    void labQuery.refetch();
  };

  return (
    <ModulePageShell className="gap-5 xl:gap-6">
      <ModuleHero
        size="compact"
        density="tight"
        eyebrow="Simulation Platform"
        title="Isaac"
        description="统一管理 Isaac Sim headless 仿真和 Isaac Lab GPU 训练任务。"
        icon={CpuIcon}
        badges={
          <>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/84 px-2.5 py-0.5 text-[12px] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]"
            >
              Isaac Sim
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/84 px-2.5 py-0.5 text-[12px] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]"
            >
              Isaac Lab
            </Badge>
            <Badge
              variant="outline"
              className="hidden border-slate-200/90 bg-white/84 px-2.5 py-0.5 text-[12px] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] md:inline-flex"
            >
              Kubernetes GPU
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "px-2.5 py-0.5 text-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
                isChecking
                  ? "border-sky-200 bg-sky-50/92 text-sky-800"
                  : anyAvailable
                    ? "border-emerald-200 bg-emerald-50/92 text-emerald-800"
                    : "border-rose-200 bg-rose-50/92 text-rose-800",
              )}
            >
              {isChecking ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              {isChecking
                ? "K8s 检查中"
                : anyAvailable
                  ? "K8s 已连接"
                  : "K8s 访问异常"}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/78 px-2.5 py-0.5 text-[12px] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
            >
              {(stationQuery.isFetching || labQuery.isFetching) &&
              !(stationQuery.isLoading || labQuery.isLoading) ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              自动刷新 · {STATUS_POLL_INTERVAL_MS / 1000}s
            </Badge>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              className="rounded-[var(--radius-card)] border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50"
              disabled={
                activeTab === "station"
                  ? stationQuery.isFetching
                  : labQuery.isFetching
              }
              onClick={handleRefresh}
            >
              <RefreshCwIcon data-icon="inline-start" />
              刷新
            </Button>
            <Button
              className="rounded-[var(--radius-card)]"
              disabled={!activeAvailable}
              title={
                !activeAvailable
                  ? (activeReason ?? "K8s 当前不可用")
                  : undefined
              }
              onClick={() => {
                if (activeTab === "station") {
                  setIsStationCreateOpen(true);
                } else {
                  setIsLabCreateOpen(true);
                }
              }}
            >
              <PlusIcon data-icon="inline-start" />
              {activeTab === "station" ? "创建 Station" : "提交 Lab Job"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <StatusStrip stations={stationRows} labJobs={labRows} />
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            <TabButton
              value="lab"
              activeValue={activeTab}
              onClick={setActiveTab}
              icon={FlaskConicalIcon}
              label="Lab Jobs"
              count={labRows.length}
            />
          </div>
          <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/88 px-3.5 py-3 text-[12px] leading-5 text-slate-600">
            Sim Station 负责 Isaac Sim headless/WebRTC 仿真；Lab Jobs 负责 Isaac
            Lab 训练、benchmark 和批量实验。两者都绕开当前 Xvnc/llvmpipe
            桌面显示层。
          </div>
        </div>
      </ModuleHero>

      {activeTab === "station" ? (
        <>
          <ModuleSection
            title="Sim Station"
            description="查看 Isaac Sim 实例、GPU 规格、所在节点和 WebRTC 入口。"
            className="border-slate-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]"
            action={
              <Badge
                variant="outline"
                className="border-slate-200/90 bg-white/90 text-slate-600"
              >
                {stationRows.length} 个实例
              </Badge>
            }
          >
            {stationQuery.isLoading ? (
              <LoadingCards />
            ) : stationRows.length === 0 ? (
              <div className="flex flex-col gap-3 rounded-[10px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-950">
                    还没有 Sim Station
                  </p>
                  <p className="mt-0.5 text-[13px] leading-5 text-slate-500">
                    创建一个 headless WebRTC Station 后，就能在 GPU 节点上运行
                    Isaac Sim。
                  </p>
                </div>
                <Button
                  className="w-fit rounded-[10px]"
                  disabled={!stationAvailable}
                  onClick={() => setIsStationCreateOpen(true)}
                >
                  <PlusIcon data-icon="inline-start" />
                  创建 Station
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                {stationRows.map((station) => (
                  <StationCard
                    key={station.id}
                    station={station}
                    isDeleting={
                      pendingDeletedStationNames.includes(station.name) ||
                      (deleteStation.isPending &&
                        deleteStation.variables?.name === station.name)
                    }
                    onDelete={() => void handleDeleteStation(station.name)}
                  />
                ))}
              </div>
            )}
          </ModuleSection>

          <ModuleSection
            title="连接参数"
            description="WebRTC 客户端需要连接 Isaac 所在节点，而不是当前 Xvnc 云桌面。"
            className="border-slate-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]"
          >
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/75 px-3 py-2.5">
                <SurfaceLabel>Display</SurfaceLabel>
                <p className="mt-1 font-mono text-[13px] text-slate-900">
                  headless / EGL
                </p>
              </div>
              <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/75 px-3 py-2.5">
                <SurfaceLabel>Signaling</SurfaceLabel>
                <p className="mt-1 font-mono text-[13px] text-slate-900">
                  TCP 8011
                </p>
              </div>
              <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/75 px-3 py-2.5">
                <SurfaceLabel>Service API</SurfaceLabel>
                <p className="mt-1 font-mono text-[13px] text-slate-900">
                  /v1/streaming/*
                </p>
              </div>
            </div>
          </ModuleSection>
        </>
      ) : (
        <ModuleSection
          title="Lab Jobs"
          description="提交和查看 Isaac Lab 训练、benchmark 与批量实验任务，可选 headless 或 WebRTC。"
          className="border-slate-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]"
          action={
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/90 text-slate-600"
            >
              {labRows.length} 个任务
            </Badge>
          }
        >
          {labQuery.isLoading ? (
            <LoadingCards />
          ) : labRows.length === 0 ? (
            <div className="flex flex-col gap-3 rounded-[10px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-950">
                  还没有 Isaac Lab Job
                </p>
                <p className="mt-0.5 text-[13px] leading-5 text-slate-500">
                  提交一个 RSL-RL、SKRL 或 Direct RL job 后，就能在 GPU 节点上跑
                  Isaac Lab。
                </p>
              </div>
              <Button
                className="w-fit rounded-[10px]"
                disabled={!labAvailable}
                onClick={() => setIsLabCreateOpen(true)}
              >
                <PlusIcon data-icon="inline-start" />
                提交 Lab Job
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {labRows.map((job) => (
                <LabJobCard
                  key={job.id}
                  job={job}
                  isDeleting={
                    pendingDeletedLabNames.includes(job.name) ||
                    (deleteLabJob.isPending &&
                      deleteLabJob.variables?.name === job.name)
                  }
                  onCopyEndpoint={() => void handleCopyLabEndpoint(job)}
                  onCopySshCommand={() => void handleCopyLabSshCommand(job)}
                  onOpenTerminal={() => setTerminalJob(job)}
                  onDelete={() => void handleDeleteLabJob(job.name)}
                />
              ))}
            </div>
          )}
        </ModuleSection>
      )}

      <IsaacStationDialog
        open={isStationCreateOpen}
        available={stationAvailable}
        capabilityReason={stationReason}
        draft={stationDraft}
        imageOptions={stationImageOptions}
        selectedImage={selectedStationImage}
        canCreate={stationCanCreate}
        submitDisabledReason={stationSubmitDisabledReason}
        isPending={createStation.isPending}
        onOpenChange={setIsStationCreateOpen}
        onDraftChange={(updater) =>
          setStationDraft((current) => updater(current))
        }
        onSubmit={() => void handleCreateStation()}
      />

      <IsaacLabDialog
        open={isLabCreateOpen}
        available={labAvailable}
        capabilityReason={labReason}
        draft={labDraft}
        imageOptions={labImageOptions}
        selectedImage={selectedLabImage}
        canCreate={labCanCreate}
        submitDisabledReason={labSubmitDisabledReason}
        isPending={createLabJob.isPending}
        onOpenChange={setIsLabCreateOpen}
        onDraftChange={(updater) => setLabDraft((current) => updater(current))}
        onSubmit={() => void handleCreateLabJob()}
      />

      <IsaacLabTerminalDialog
        open={Boolean(terminalJob)}
        job={terminalJob}
        onOpenChange={(open) => {
          if (!open) setTerminalJob(null);
        }}
      />

      {confirmDialog}
    </ModulePageShell>
  );
}
