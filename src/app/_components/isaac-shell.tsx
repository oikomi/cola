"use client";

import {
  CpuIcon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  PlusIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  ModuleHero,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { ResourceOwnerBadge } from "@/app/_components/resource-owner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { notifyError } from "@/components/ui/toast";
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
type IsaacTab = "station" | "lab";

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
      <StatusItem label="WebRTC" value={`${streaming}/${runningStations}`} />
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
          使用 Isaac Sim WebRTC Streaming Client 连接节点 IP，不经过
          Xvnc/软件 GL。
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:justify-end">
        <Button
          size="sm"
          variant="outline"
          className="h-7 max-w-full rounded-[8px] px-2.5 text-[12px] text-slate-500"
          disabled
        >
          <RadioTowerIcon data-icon="inline-start" />
          <span className="min-w-0 truncate">
            客户端连接 {station.endpoint ?? "待分配"}
          </span>
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

function LabJobCard(props: {
  job: IsaacLabJobRow;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const { job } = props;

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

      <div className="mt-3 flex justify-end">
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
                    mode: value,
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
            提交一个 Isaac Lab headless 训练或实验任务，使用 K8s GPU Job 执行。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-[1fr_0.8fr]">
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
                    runner: value,
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
              hint="Custom runner 会直接执行这段 shell；平台可注入 GITLAB_TOKEN 用于 clone 私有仓库。"
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
                placeholder="./isaaclab.sh -p scripts/reinforcement_learning/rsl_rl/train.py --task Isaac-Velocity-Flat-G1-v0 --headless --max_iterations 1000"
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
            默认命令会使用 `./isaaclab.sh -p ... --headless`；Custom runner 可先
            clone GitLab
            代码再训练。输出目录挂载到共享工作目录，适合后续接入日志、checkpoint
            和 TensorBoard。
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

export function IsaacShell() {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState<IsaacTab>("station");
  const [isStationCreateOpen, setIsStationCreateOpen] = useState(false);
  const [isLabCreateOpen, setIsLabCreateOpen] = useState(false);
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
    onSuccess: async () => {
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
    onSuccess: async () => {
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
              value="station"
              activeValue={activeTab}
              onClick={setActiveTab}
              icon={CpuIcon}
              label="Sim Station"
              count={stationRows.length}
            />
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
          description="提交和查看 Isaac Lab headless 训练、benchmark 与批量实验任务。"
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

      {confirmDialog}
    </ModulePageShell>
  );
}
