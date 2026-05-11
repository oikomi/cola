"use client";

import {
  ArrowUpRightIcon,
  BrainCircuitIcon,
  CpuIcon,
  LoaderCircleIcon,
  NotebookTabsIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  ModuleEmptyState,
  ModuleHero,
  ModuleMetricCard,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
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
  formatDistributedGpuAllocationLabel,
  formatGpuAllocationLabel,
  gpuAllocationModeLabels,
  gpuAllocationModeValues,
} from "@/lib/gpu-allocation";
import { cn, optionLabel } from "@/lib/utils";
import { api, type RouterOutputs } from "@/trpc/react";

type GpuAllocationMode = (typeof gpuAllocationModeValues)[number];
type StudioImageOption =
  RouterOutputs["training"]["listUnslothStudios"]["imageOptions"][number];
type StudioRun = RouterOutputs["training"]["listStudioRuns"][number];
type JupyterLabImageOption =
  RouterOutputs["training"]["listJupyterLabs"]["imageOptions"][number];
type RuntimeStatus = "running" | "starting" | "error";

type RuntimeDraft = {
  name: string;
  image: string;
  cpu: string;
  memoryGi: string;
  gpuAllocationMode: GpuAllocationMode;
  gpuCount: string;
  gpuMemoryGi: string;
};

type StudioRunDraft = {
  title: string;
  jobType: "sft" | "lora" | "pretrain";
  priority: "low" | "medium" | "high" | "critical";
  baseModel: string;
  datasetName: string;
  datasetSplit: string;
  datasetTextField: string;
  objective: string;
  gpuAllocationMode: GpuAllocationMode;
  nodeCount: string;
  gpusPerNode: string;
  gpuMemoryGi: string;
  distributedBackend: "none" | "deepspeed";
  deepspeedStage: "2" | "3";
  precision: "auto" | "fp16" | "bf16";
  loadIn4bit: boolean;
  autoStart: boolean;
};

const defaultStudioDraft: RuntimeDraft = {
  name: "",
  image: "",
  cpu: "8",
  memoryGi: "48",
  gpuAllocationMode: "whole",
  gpuCount: "1",
  gpuMemoryGi: "",
};

const defaultJupyterLabDraft: RuntimeDraft = {
  name: "",
  image: "",
  cpu: "4",
  memoryGi: "16",
  gpuAllocationMode: "whole",
  gpuCount: "0",
  gpuMemoryGi: "",
};

const defaultStudioRunDraft: StudioRunDraft = {
  title: "",
  jobType: "lora",
  priority: "medium",
  baseModel: "unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
  datasetName: "/workspace/datasets/train.jsonl",
  datasetSplit: "train",
  datasetTextField: "text",
  objective: "",
  gpuAllocationMode: "whole",
  nodeCount: "2",
  gpusPerNode: "1",
  gpuMemoryGi: "",
  distributedBackend: "deepspeed",
  deepspeedStage: "2",
  precision: "bf16",
  loadIn4bit: true,
  autoStart: true,
};

const dialogControlClassName =
  "h-10 rounded-2xl border-slate-200/90 bg-white/92 px-3 text-[14px] shadow-none";

const statusLabels = {
  draft: "草稿",
  running: "运行中",
  stopped: "已停止",
  completed: "已完成",
  failed: "失败",
} satisfies Record<string, string>;

const jobTypeLabels = {
  sft: "SFT",
  lora: "LoRA",
  pretrain: "Pre-train",
} satisfies Record<StudioRunDraft["jobType"], string>;

const priorityLabels = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "关键",
} satisfies Record<StudioRunDraft["priority"], string>;

function sanitizeDnsNameInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48);
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

function runtimeStatusTone(status: RuntimeStatus) {
  switch (status) {
    case "running":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "starting":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function runtimeStatusLabel(status: RuntimeStatus) {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "error":
      return "异常";
    default:
      return status;
  }
}

function runStatusTone(status: StudioRun["status"]) {
  switch (status) {
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "stopped":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "draft":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function runtimeSpecLabel(item: {
  gpuAllocationMode: GpuAllocationMode;
  gpuCount: number;
  gpuMemoryGi: number | null;
  cpu: string;
  memory: string;
}) {
  return `${formatGpuAllocationLabel({
    gpuAllocationMode: item.gpuAllocationMode,
    gpuCount: item.gpuCount,
    gpuMemoryGi: item.gpuMemoryGi,
  })} · ${item.cpu} CPU · ${item.memory}`;
}

function draftRuntimeSpecLabel(draft: RuntimeDraft) {
  const gpuCount = Number(draft.gpuCount);
  const gpuMemoryGi = Number(draft.gpuMemoryGi);

  return `${formatGpuAllocationLabel({
    gpuAllocationMode: draft.gpuAllocationMode,
    gpuCount: Number.isFinite(gpuCount) ? gpuCount : 0,
    gpuMemoryGi:
      draft.gpuAllocationMode === "memory" && Number.isFinite(gpuMemoryGi)
        ? gpuMemoryGi
        : null,
  })} · ${draft.cpu || "-"} CPU · ${draft.memoryGi || "-"} Gi`;
}

function studioImageLabel(option?: StudioImageOption | JupyterLabImageOption) {
  if (!option) return "选择镜像";
  return `${option.label} · ${option.image}`;
}

function parsePositiveInt(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function parseNonNegativeInt(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function Field(props: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-2", props.className)}>
      <span className="text-[13px] font-medium text-slate-700">
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-xs leading-5 text-slate-500">{props.hint}</span>
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
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="rounded-[var(--radius-shell)] border border-slate-200/85 bg-white/90 p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-[11px]" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RuntimeCard(props: {
  title: string;
  kind: "studio" | "jupyter";
  status: RuntimeStatus;
  updatedAt: string | null;
  spec: string;
  nodeName: string | null;
  endpoint: string | null;
  image: string;
  openUrl: string | null;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const Icon = props.kind === "studio" ? BrainCircuitIcon : NotebookTabsIcon;

  return (
    <article className="rounded-[var(--radius-shell)] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.9))] p-4 shadow-[0_14px_32px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-slate-200/85 bg-white text-slate-700 shadow-[0_10px_18px_rgba(15,23,42,0.035)]">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] leading-6 font-semibold tracking-normal text-slate-950">
              {props.title}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              更新于 {formatTime(props.updatedAt)}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-xs",
            runtimeStatusTone(props.status),
          )}
        >
          {runtimeStatusLabel(props.status)}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 rounded-[var(--radius-shell)] border border-slate-200/75 bg-slate-50/80 px-3.5 py-3 text-sm leading-6 text-slate-600">
        <div>
          <SurfaceLabel>资源规格</SurfaceLabel>
          <p className="mt-1 font-medium text-slate-950">{props.spec}</p>
        </div>
        <div>
          <SurfaceLabel>节点 / 入口</SurfaceLabel>
          <p className="mt-1 font-mono text-[12px] break-all text-slate-700">
            {props.nodeName ?? "未分配节点"} · {props.endpoint ?? "入口待分配"}
          </p>
        </div>
        <div>
          <SurfaceLabel>镜像</SurfaceLabel>
          <p className="mt-1 font-mono text-[12px] break-all text-slate-700">
            {props.image}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        {props.openUrl ? (
          <a
            href={props.openUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              buttonVariants({ size: "sm" }),
              "h-8 rounded-full px-3 text-[13px]",
            )}
          >
            <ArrowUpRightIcon data-icon="inline-start" />
            {props.kind === "studio" ? "打开 Studio" : "打开 Lab"}
          </a>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-full px-3 text-[13px] text-slate-500"
            disabled
          >
            {props.kind === "studio" ? "打开 Studio" : "打开 Lab"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-full border-rose-200/80 bg-white px-3 text-[13px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
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

function StudioRunCard(props: {
  run: StudioRun;
  isStarting: boolean;
  isStopping: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const { run } = props;
  const runtimeSpec = formatDistributedGpuAllocationLabel(run.nodeCount, {
    gpuAllocationMode: run.gpuAllocationMode,
    gpuCount: run.gpusPerNode,
    gpuMemoryGi: run.gpuMemoryGi,
  });
  const canStart = ["draft", "stopped", "failed"].includes(run.status);
  const canStop = run.status === "running";

  return (
    <article className="rounded-[var(--radius-shell)] border border-slate-200/85 bg-white/92 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.035)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn("rounded-full", runStatusTone(run.status))}
            >
              {statusLabels[run.status] ?? run.status}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-slate-50 text-slate-700"
            >
              {run.configSource === "unsloth_studio"
                ? "Unsloth Studio"
                : "手动配置"}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-white text-slate-700"
            >
              {run.distributedBackend === "deepspeed"
                ? `DeepSpeed ZeRO-${run.deepspeedStage ?? 2}`
                : "DDP"}
            </Badge>
          </div>
          <h3 className="mt-2 truncate text-[15px] leading-6 font-semibold text-slate-950">
            {run.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            创建于 {formatTime(run.createdAt)} · {run.jobType.toUpperCase()} ·{" "}
            {run.precision ?? "bf16"}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {canStart ? (
            <Button
              size="sm"
              className="h-8 rounded-full px-3 text-[13px]"
              disabled={props.isStarting}
              onClick={props.onStart}
            >
              {props.isStarting ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <PlayIcon data-icon="inline-start" />
              )}
              {props.isStarting ? "提交中" : "提交"}
            </Button>
          ) : null}
          {canStop ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-full border-amber-200 bg-white px-3 text-[13px] text-amber-700 hover:bg-amber-50"
              disabled={props.isStopping}
              onClick={props.onStop}
            >
              {props.isStopping ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <SquareIcon data-icon="inline-start" />
              )}
              {props.isStopping ? "停止中" : "停止"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-[var(--radius-shell)] border border-slate-200/75 bg-slate-50/75 px-3.5 py-3 text-sm leading-6 text-slate-600 md:grid-cols-2">
        <div>
          <SurfaceLabel>多机多卡</SurfaceLabel>
          <p className="mt-1 font-medium text-slate-950">{runtimeSpec}</p>
        </div>
        <div>
          <SurfaceLabel>模型 / 数据</SurfaceLabel>
          <p className="mt-1 truncate font-mono text-[12px] text-slate-700">
            {run.baseModel}
          </p>
          <p className="truncate font-mono text-[12px] text-slate-500">
            {run.datasetName}
          </p>
        </div>
        <div>
          <SurfaceLabel>运行态</SurfaceLabel>
          <p className="mt-1 font-mono text-[12px] break-all text-slate-700">
            {run.runtimeNamespace && run.runtimeJobName
              ? `${run.runtimeNamespace}/${run.runtimeJobName}`
              : "尚未提交"}
          </p>
        </div>
        <div>
          <SurfaceLabel>摘要</SurfaceLabel>
          <p
            className={cn(
              "mt-1 line-clamp-2 text-[12px]",
              run.runtimeSummaryTone === "error"
                ? "text-rose-700"
                : run.runtimeSummaryTone === "warning"
                  ? "text-amber-700"
                  : "text-slate-600",
            )}
          >
            {run.runtimeSummary ?? run.lastError ?? run.objective}
          </p>
        </div>
      </div>
    </article>
  );
}

function RuntimeDialog(props: {
  title: string;
  badge: string;
  description: string;
  draft: RuntimeDraft;
  imageOptions: Array<StudioImageOption | JupyterLabImageOption>;
  selectedImage: StudioImageOption | JupyterLabImageOption | null;
  selectedImageValue: string;
  canCreate: boolean;
  submitDisabledReason: string | null;
  isPending: boolean;
  submitLabel: string;
  icon: typeof BrainCircuitIcon;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (updater: (current: RuntimeDraft) => RuntimeDraft) => void;
  onSubmit: () => void;
}) {
  const Icon = props.icon;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="border-slate-200/85 bg-white shadow-[0_28px_68px_rgba(15,23,42,0.14)] sm:max-w-2xl">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
              {props.badge}
            </Badge>
            <Badge variant="outline" className="border-slate-200/90 bg-white/90">
              Kubernetes Deployment
            </Badge>
          </div>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="环境名称">
            <Input
              className={dialogControlClassName}
              value={props.draft.name}
              onChange={(event) =>
                props.onDraftChange((current) => ({
                  ...current,
                  name: sanitizeDnsNameInput(event.target.value),
                }))
              }
              placeholder="例如：unsloth-studio-01"
            />
          </Field>

          <Field
            label="镜像"
            hint={props.selectedImage?.description ?? "镜像列表由后端提供。"}
          >
            <Select
              value={props.selectedImageValue}
              onValueChange={(value) =>
                props.onDraftChange((current) => ({
                  ...current,
                  image: value ?? "",
                }))
              }
            >
              <SelectTrigger className={cn("w-full", dialogControlClassName)}>
                <SelectValue placeholder="选择镜像">
                  {studioImageLabel(props.selectedImage ?? undefined)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {props.imageOptions.map((option) => (
                    <SelectItem key={option.image} value={option.image}>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium">{option.label}</span>
                        <span className="text-muted-foreground max-w-[520px] truncate text-xs">
                          {option.image}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="CPU">
              <Input
                className={dialogControlClassName}
                inputMode="decimal"
                value={props.draft.cpu}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    cpu: event.target.value,
                  }))
                }
                placeholder="8"
              />
            </Field>

            <Field label="内存 (Gi)">
              <Input
                className={dialogControlClassName}
                inputMode="numeric"
                value={props.draft.memoryGi}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    memoryGi: event.target.value,
                  }))
                }
                placeholder="48"
              />
            </Field>

            <Field
              label="GPU 分配方式"
              hint="多机多卡正式训练建议使用整卡；显存份额更适合交互式调试。"
            >
              <Select
                value={props.draft.gpuAllocationMode}
                onValueChange={(value) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    gpuAllocationMode: value === "memory" ? "memory" : "whole",
                    gpuCount:
                      value === "memory" &&
                      Number.parseInt(current.gpuCount, 10) < 1
                        ? "1"
                        : current.gpuCount,
                    gpuMemoryGi: value === "memory" ? current.gpuMemoryGi || "8" : "",
                  }))
                }
              >
                <SelectTrigger className={cn("w-full", dialogControlClassName)}>
                  <SelectValue placeholder="选择分配方式">
                    {optionLabel(gpuAllocationModeLabels, "选择分配方式")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {gpuAllocationModeValues.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {gpuAllocationModeLabels[mode]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field
              label={props.draft.gpuAllocationMode === "memory" ? "GPU 份额" : "GPU"}
            >
              <Input
                className={dialogControlClassName}
                inputMode="numeric"
                value={props.draft.gpuCount}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    gpuCount: event.target.value,
                  }))
                }
                placeholder="1"
              />
            </Field>

            <Field
              label="每份额显存 (Gi)"
              hint={
                props.draft.gpuAllocationMode === "memory"
                  ? "仅显存模式生效。"
                  : "整卡模式不需要填写。"
              }
              className="md:col-span-2"
            >
              <Input
                className={cn(
                  dialogControlClassName,
                  props.draft.gpuAllocationMode !== "memory"
                    ? "bg-slate-100/90 text-slate-400"
                    : undefined,
                )}
                inputMode="numeric"
                value={props.draft.gpuMemoryGi}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    gpuMemoryGi: event.target.value,
                  }))
                }
                placeholder="8"
                disabled={props.draft.gpuAllocationMode !== "memory"}
              />
            </Field>
          </div>

          <div className="rounded-[var(--radius-shell)] border border-sky-200/70 bg-sky-50/70 px-4 py-3 text-sm leading-6 text-slate-700">
            当前规格：
            <span className="mx-1 font-semibold text-slate-950">
              {draftRuntimeSpecLabel(props.draft)}
            </span>
            ，镜像：
            <span className="ml-1 font-semibold text-slate-950">
              {props.selectedImage?.label ?? "未选择"}
            </span>
          </div>

          {props.submitDisabledReason ? (
            <div className="rounded-[var(--radius-shell)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              {props.submitDisabledReason}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!props.canCreate || props.isPending}
            onClick={props.onSubmit}
          >
            {props.isPending ? (
              <LoaderCircleIcon
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <Icon data-icon="inline-start" />
            )}
            {props.isPending ? "创建中" : props.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StudioRunDialog(props: {
  open: boolean;
  draft: StudioRunDraft;
  canSubmit: boolean;
  disabledReason: string | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (updater: (current: StudioRunDraft) => StudioRunDraft) => void;
  onSubmit: () => void;
}) {
  const nodeCount = Number(props.draft.nodeCount);
  const gpusPerNode = Number(props.draft.gpusPerNode);
  const gpuMemoryGi = Number(props.draft.gpuMemoryGi);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] max-w-[min(980px,calc(100vw-1rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-slate-200/85 bg-white p-0 shadow-[0_28px_68px_rgba(15,23,42,0.14)]">
        <DialogHeader className="border-b border-slate-200/80 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border border-violet-200 bg-violet-50 text-violet-700">
              Unsloth Studio
            </Badge>
            <Badge variant="outline" className="border-slate-200/90 bg-white">
              Indexed Job + torchrun
            </Badge>
          </div>
          <DialogTitle className="mt-2 text-[1.35rem] tracking-normal">
            提交多机多卡训练
          </DialogTitle>
          <DialogDescription>
            这里保存的是 Studio 配置后的运行记录，并由 Cola 提交 Kubernetes
            分布式训练任务。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="运行名称">
                  <Input
                    className={dialogControlClassName}
                    value={props.draft.title}
                    onChange={(event) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="例如：qwen-lora-2node"
                  />
                </Field>

                <Field label="训练类型">
                  <Select
                    value={props.draft.jobType}
                    onValueChange={(value) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        jobType:
                          value === "sft" || value === "pretrain"
                            ? value
                            : "lora",
                      }))
                    }
                  >
                    <SelectTrigger className={cn("w-full", dialogControlClassName)}>
                      <SelectValue placeholder="选择训练类型">
                        {optionLabel(jobTypeLabels, "选择训练类型")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {Object.entries(jobTypeLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="基础模型">
                <Input
                  className={dialogControlClassName}
                  value={props.draft.baseModel}
                  onChange={(event) =>
                    props.onDraftChange((current) => ({
                      ...current,
                      baseModel: event.target.value,
                    }))
                  }
                  placeholder="unsloth/Qwen2.5-7B-Instruct-bnb-4bit"
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_130px_130px]">
                <Field label="数据集">
                  <Input
                    className={dialogControlClassName}
                    value={props.draft.datasetName}
                    onChange={(event) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        datasetName: event.target.value,
                      }))
                    }
                    placeholder="/workspace/datasets/train.jsonl"
                  />
                </Field>
                <Field label="Split">
                  <Input
                    className={dialogControlClassName}
                    value={props.draft.datasetSplit}
                    onChange={(event) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        datasetSplit: event.target.value,
                      }))
                    }
                    placeholder="train"
                  />
                </Field>
                <Field label="文本字段">
                  <Input
                    className={dialogControlClassName}
                    value={props.draft.datasetTextField}
                    onChange={(event) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        datasetTextField: event.target.value,
                      }))
                    }
                    placeholder="text"
                  />
                </Field>
              </div>

              <Field label="训练目标">
                <Textarea
                  className="min-h-24 rounded-2xl border-slate-200/90 bg-white/92 px-3 py-2 text-sm shadow-none"
                  value={props.draft.objective}
                  onChange={(event) =>
                    props.onDraftChange((current) => ({
                      ...current,
                      objective: event.target.value,
                    }))
                  }
                  placeholder="记录本次训练的目标、数据范围和期望产物。"
                />
              </Field>
            </div>

            <div className="grid content-start gap-4 rounded-[var(--radius-shell)] border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Field label="节点数">
                  <Input
                    className={dialogControlClassName}
                    inputMode="numeric"
                    value={props.draft.nodeCount}
                    onChange={(event) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        nodeCount: event.target.value,
                      }))
                    }
                    placeholder="2"
                  />
                </Field>
                <Field label="每节点 GPU">
                  <Input
                    className={dialogControlClassName}
                    inputMode="numeric"
                    value={props.draft.gpusPerNode}
                    onChange={(event) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        gpusPerNode: event.target.value,
                      }))
                    }
                    placeholder="1"
                  />
                </Field>
              </div>

              <Field label="GPU 分配方式">
                <Select
                  value={props.draft.gpuAllocationMode}
                  onValueChange={(value) =>
                    props.onDraftChange((current) => ({
                      ...current,
                      gpuAllocationMode: value === "memory" ? "memory" : "whole",
                      gpuMemoryGi: value === "memory" ? current.gpuMemoryGi || "24" : "",
                    }))
                  }
                >
                  <SelectTrigger className={cn("w-full", dialogControlClassName)}>
                    <SelectValue placeholder="选择分配方式">
                      {optionLabel(gpuAllocationModeLabels, "选择分配方式")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {gpuAllocationModeValues.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {gpuAllocationModeLabels[mode]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="每份额显存 (Gi)">
                <Input
                  className={cn(
                    dialogControlClassName,
                    props.draft.gpuAllocationMode !== "memory"
                      ? "bg-slate-100/90 text-slate-400"
                      : undefined,
                  )}
                  inputMode="numeric"
                  value={props.draft.gpuMemoryGi}
                  onChange={(event) =>
                    props.onDraftChange((current) => ({
                      ...current,
                      gpuMemoryGi: event.target.value,
                    }))
                  }
                  placeholder="24"
                  disabled={props.draft.gpuAllocationMode !== "memory"}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Field label="后端">
                  <Select
                    value={props.draft.distributedBackend}
                    onValueChange={(value) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        distributedBackend:
                          value === "none" ? "none" : "deepspeed",
                      }))
                    }
                  >
                    <SelectTrigger className={cn("w-full", dialogControlClassName)}>
                      <SelectValue placeholder="选择后端" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="deepspeed">DeepSpeed</SelectItem>
                        <SelectItem value="none">DDP</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="ZeRO Stage">
                  <Select
                    value={props.draft.deepspeedStage}
                    onValueChange={(value) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        deepspeedStage: value === "3" ? "3" : "2",
                      }))
                    }
                    disabled={props.draft.distributedBackend !== "deepspeed"}
                  >
                    <SelectTrigger className={cn("w-full", dialogControlClassName)}>
                      <SelectValue placeholder="选择 ZeRO" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="2">ZeRO-2</SelectItem>
                        <SelectItem value="3">ZeRO-3</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Field label="精度">
                  <Select
                    value={props.draft.precision}
                    onValueChange={(value) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        precision:
                          value === "auto" || value === "fp16" ? value : "bf16",
                      }))
                    }
                  >
                    <SelectTrigger className={cn("w-full", dialogControlClassName)}>
                      <SelectValue placeholder="选择精度" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="bf16">BF16</SelectItem>
                        <SelectItem value="fp16">FP16</SelectItem>
                        <SelectItem value="auto">Auto</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="优先级">
                  <Select
                    value={props.draft.priority}
                    onValueChange={(value) =>
                      props.onDraftChange((current) => ({
                        ...current,
                        priority:
                          value === "low" ||
                          value === "high" ||
                          value === "critical"
                            ? value
                            : "medium",
                      }))
                    }
                  >
                    <SelectTrigger className={cn("w-full", dialogControlClassName)}>
                      <SelectValue placeholder="选择优先级">
                        {optionLabel(priorityLabels, "选择优先级")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {Object.entries(priorityLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <label className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300"
                  checked={props.draft.loadIn4bit}
                  onChange={(event) =>
                    props.onDraftChange((current) => ({
                      ...current,
                      loadIn4bit: event.target.checked,
                    }))
                  }
                />
                4-bit 加载
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300"
                  checked={props.draft.autoStart}
                  onChange={(event) =>
                    props.onDraftChange((current) => ({
                      ...current,
                      autoStart: event.target.checked,
                    }))
                  }
                />
                创建后立即提交
              </label>

              <div className="rounded-2xl border border-sky-200/70 bg-sky-50/70 px-3 py-3 text-sm leading-6 text-slate-700">
                规格：
                <span className="font-semibold text-slate-950">
                  {formatDistributedGpuAllocationLabel(
                    Number.isFinite(nodeCount) ? nodeCount : 0,
                    {
                      gpuAllocationMode: props.draft.gpuAllocationMode,
                      gpuCount: Number.isFinite(gpusPerNode) ? gpusPerNode : 0,
                      gpuMemoryGi:
                        props.draft.gpuAllocationMode === "memory" &&
                        Number.isFinite(gpuMemoryGi)
                          ? gpuMemoryGi
                          : null,
                    },
                  )}
                </span>
              </div>
            </div>
          </div>

          {props.disabledReason ? (
            <div className="mt-4 rounded-[var(--radius-shell)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              {props.disabledReason}
            </div>
          ) : null}
        </div>

        <DialogFooter
          bleed={false}
          className="border-t border-slate-200/80 bg-white px-5 py-3"
        >
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!props.canSubmit || props.isPending} onClick={props.onSubmit}>
            {props.isPending ? (
              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {props.isPending ? "提交中" : props.draft.autoStart ? "提交训练" : "保存运行记录"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TrainingShell() {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();

  const studiosQuery = api.training.listUnslothStudios.useQuery(undefined, {
    refetchInterval: 8000,
  });
  const studioRunsQuery = api.training.listStudioRuns.useQuery(undefined, {
    refetchInterval: 8000,
  });
  const jupyterLabsQuery = api.training.listJupyterLabs.useQuery(undefined, {
    refetchInterval: 8000,
  });

  const [isStudioCreateOpen, setIsStudioCreateOpen] = useState(false);
  const [isRunCreateOpen, setIsRunCreateOpen] = useState(false);
  const [isLabCreateOpen, setIsLabCreateOpen] = useState(false);
  const [studioDraft, setStudioDraft] = useState(defaultStudioDraft);
  const [runDraft, setRunDraft] = useState(defaultStudioRunDraft);
  const [labDraft, setLabDraft] = useState(defaultJupyterLabDraft);
  const [pendingDeletedStudioNames, setPendingDeletedStudioNames] = useState<string[]>([]);
  const [pendingDeletedLabNames, setPendingDeletedLabNames] = useState<string[]>([]);

  const studios = (studiosQuery.data?.items ?? []).filter(
    (studio) => !pendingDeletedStudioNames.includes(studio.name),
  );
  const jupyterLabs = (jupyterLabsQuery.data?.items ?? []).filter(
    (lab) => !pendingDeletedLabNames.includes(lab.name),
  );
  const studioRuns = studioRunsQuery.data ?? [];

  const studioAvailable = studiosQuery.data?.available === true;
  const studioCapabilityReason = studiosQuery.data?.reason ?? null;
  const labAvailable = jupyterLabsQuery.data?.available === true;
  const labCapabilityReason = jupyterLabsQuery.data?.reason ?? null;

  const studioImageOptions = useMemo(
    () => studiosQuery.data?.imageOptions ?? [],
    [studiosQuery.data?.imageOptions],
  );
  const labImageOptions = useMemo(
    () => jupyterLabsQuery.data?.imageOptions ?? [],
    [jupyterLabsQuery.data?.imageOptions],
  );

  const selectedStudioImage =
    studioImageOptions.find((option) => option.image === studioDraft.image) ??
    studioImageOptions[0] ??
    null;
  const selectedLabImage =
    labImageOptions.find((option) => option.image === labDraft.image) ??
    labImageOptions[0] ??
    null;
  const selectedStudioImageValue = selectedStudioImage?.image ?? "";
  const selectedLabImageValue = selectedLabImage?.image ?? "";

  const runningStudioCount = studios.filter(
    (studio) => studio.status === "running",
  ).length;
  const runningRunCount = studioRuns.filter(
    (run) => run.status === "running",
  ).length;
  const totalRunGpu = studioRuns.reduce(
    (total, run) => total + run.nodeCount * run.gpusPerNode,
    0,
  );
  const runningLabCount = jupyterLabs.filter((lab) => lab.status === "running").length;

  function runtimeValidation(
    draft: RuntimeDraft,
    available: boolean,
    imageReady: boolean,
    capabilityReason: string | null,
    kind: "Studio" | "JupyterLab",
  ) {
    const parsedMemoryGi = Number(draft.memoryGi);
    const parsedGpuCount =
      draft.gpuAllocationMode === "whole"
        ? parseNonNegativeInt(draft.gpuCount)
        : parsePositiveInt(draft.gpuCount);
    const parsedGpuMemoryGi = Number(draft.gpuMemoryGi);
    const nameReady = draft.name.trim().length >= 2;
    const memoryReady =
      Number.isInteger(parsedMemoryGi) && parsedMemoryGi >= 1 && parsedMemoryGi <= 2048;
    const gpuCountReady =
      Number.isInteger(parsedGpuCount) &&
      parsedGpuCount >= (draft.gpuAllocationMode === "whole" ? 0 : 1) &&
      parsedGpuCount <= 16;
    const gpuMemoryReady =
      draft.gpuAllocationMode === "whole" ||
      (Number.isInteger(parsedGpuMemoryGi) &&
        parsedGpuMemoryGi >= 1 &&
        parsedGpuMemoryGi <= 1024);
    const canCreate =
      available && nameReady && imageReady && memoryReady && gpuCountReady && gpuMemoryReady;
    const reason = !available
      ? (capabilityReason ?? "Kubernetes 当前不可用")
      : !nameReady
        ? "请输入至少 2 个字符的环境名称"
        : !imageReady
          ? `请选择 ${kind} 镜像`
          : !memoryReady
            ? "内存范围必须是 1-2048 Gi"
            : !gpuCountReady
              ? draft.gpuAllocationMode === "memory"
                ? "显存份额模式下 GPU 份额范围是 1-16"
                : "整卡模式下 GPU 范围是 0-16"
              : !gpuMemoryReady
                ? "显存份额模式下每份额显存范围是 1-1024 Gi"
                : null;

    return {
      canCreate,
      reason,
      parsedMemoryGi,
      parsedGpuCount,
      parsedGpuMemoryGi,
    };
  }

  const studioValidation = runtimeValidation(
    studioDraft,
    studioAvailable,
    Boolean(selectedStudioImage),
    studioCapabilityReason,
    "Studio",
  );
  const labValidation = runtimeValidation(
    labDraft,
    labAvailable,
    Boolean(selectedLabImage),
    labCapabilityReason,
    "JupyterLab",
  );

  const parsedNodeCount = parsePositiveInt(runDraft.nodeCount);
  const parsedGpusPerNode = parsePositiveInt(runDraft.gpusPerNode);
  const parsedRunGpuMemoryGi = Number(runDraft.gpuMemoryGi);
  const runTitleReady = runDraft.title.trim().length >= 2;
  const objectiveReady = runDraft.objective.trim().length >= 2;
  const datasetReady = runDraft.datasetName.trim().length >= 1;
  const baseModelReady = runDraft.baseModel.trim().length >= 2;
  const nodeCountReady =
    Number.isInteger(parsedNodeCount) && parsedNodeCount >= 1 && parsedNodeCount <= 32;
  const gpusPerNodeReady =
    Number.isInteger(parsedGpusPerNode) &&
    parsedGpusPerNode >= 1 &&
    parsedGpusPerNode <= 16;
  const runGpuMemoryReady =
    runDraft.gpuAllocationMode === "whole" ||
    (Number.isInteger(parsedRunGpuMemoryGi) &&
      parsedRunGpuMemoryGi >= 1 &&
      parsedRunGpuMemoryGi <= 1024);
  const multiNodeMemoryModeBlocked =
    runDraft.gpuAllocationMode === "memory" &&
    Number.isInteger(parsedNodeCount) &&
    parsedNodeCount > 1;
  const canCreateRun =
    runTitleReady &&
    objectiveReady &&
    datasetReady &&
    baseModelReady &&
    nodeCountReady &&
    gpusPerNodeReady &&
    runGpuMemoryReady &&
    !multiNodeMemoryModeBlocked;
  const runDisabledReason = !runTitleReady
    ? "请输入至少 2 个字符的运行名称"
    : !baseModelReady
      ? "请输入基础模型"
      : !datasetReady
        ? "请输入数据集路径或 Hugging Face dataset ID"
        : !objectiveReady
          ? "请输入训练目标"
          : !nodeCountReady
            ? "节点数范围必须是 1-32"
            : !gpusPerNodeReady
              ? "每节点 GPU 范围必须是 1-16"
              : multiNodeMemoryModeBlocked
                ? "多机训练请使用整卡 GPU，不使用显存份额"
                : !runGpuMemoryReady
                  ? "显存份额模式下每份额显存范围是 1-1024 Gi"
                  : null;

  useEffect(() => {
    if (!studiosQuery.error) return;
    notifyError({
      title: "Unsloth Studio 读取失败",
      message: studiosQuery.error.message,
    });
  }, [studiosQuery.error]);

  useEffect(() => {
    if (!studioRunsQuery.error) return;
    notifyError({
      title: "训练运行读取失败",
      message: studioRunsQuery.error.message,
    });
  }, [studioRunsQuery.error]);

  useEffect(() => {
    if (!jupyterLabsQuery.error) return;
    notifyError({
      title: "JupyterLab 读取失败",
      message: jupyterLabsQuery.error.message,
    });
  }, [jupyterLabsQuery.error]);

  useEffect(() => {
    if (!studioCapabilityReason) return;
    notifyError({
      title: "Unsloth Studio 集群访问异常",
      message: studioCapabilityReason,
    });
  }, [studioCapabilityReason]);

  useEffect(() => {
    if (!labCapabilityReason) return;
    notifyError({
      title: "JupyterLab 集群访问异常",
      message: labCapabilityReason,
    });
  }, [labCapabilityReason]);

  useEffect(() => {
    if (studioDraft.image || studioImageOptions.length === 0) return;
    setStudioDraft((current) => ({
      ...current,
      image: studioImageOptions[0]?.image ?? "",
    }));
  }, [studioDraft.image, studioImageOptions]);

  useEffect(() => {
    if (labDraft.image || labImageOptions.length === 0) return;
    setLabDraft((current) => ({
      ...current,
      image: labImageOptions[0]?.image ?? "",
    }));
  }, [labDraft.image, labImageOptions]);

  const createStudio = api.training.createUnslothStudio.useMutation({
    onSuccess: (result) => {
      notifySuccess(result.message);
      setStudioDraft(defaultStudioDraft);
      setIsStudioCreateOpen(false);
      void utils.training.listUnslothStudios.invalidate();
    },
    onError: (error) => notifyError(error.message),
  });

  const deleteStudio = api.training.deleteUnslothStudio.useMutation({
    onMutate: ({ name }) => {
      setPendingDeletedStudioNames((current) =>
        current.includes(name) ? current : [...current, name],
      );
    },
    onSuccess: (result) => {
      notifySuccess(result.message);
      void utils.training.listUnslothStudios.invalidate();
    },
    onError: (error, variables) => {
      setPendingDeletedStudioNames((current) =>
        current.filter((name) => name !== variables.name),
      );
      notifyError(error.message);
    },
  });

  const createRun = api.training.createStudioRun.useMutation({
    onSuccess: (result) => {
      notifySuccess(result.message);
      setRunDraft(defaultStudioRunDraft);
      setIsRunCreateOpen(false);
      void utils.training.listStudioRuns.invalidate();
    },
    onError: (error) => notifyError(error.message),
  });

  const startRun = api.training.startStudioRun.useMutation({
    onSuccess: (result) => {
      notifySuccess(result.message);
      void utils.training.listStudioRuns.invalidate();
    },
    onError: (error) => notifyError(error.message),
  });

  const stopRun = api.training.stopStudioRun.useMutation({
    onSuccess: (result) => {
      notifySuccess(result.message);
      void utils.training.listStudioRuns.invalidate();
    },
    onError: (error) => notifyError(error.message),
  });

  const createJupyterLab = api.training.createJupyterLab.useMutation({
    onSuccess: (result) => {
      notifySuccess(result.message);
      setLabDraft(defaultJupyterLabDraft);
      setIsLabCreateOpen(false);
      void utils.training.listJupyterLabs.invalidate();
    },
    onError: (error) => notifyError(error.message),
  });

  const deleteJupyterLab = api.training.deleteJupyterLab.useMutation({
    onMutate: ({ name }) => {
      setPendingDeletedLabNames((current) =>
        current.includes(name) ? current : [...current, name],
      );
    },
    onSuccess: (result) => {
      notifySuccess(result.message);
      void utils.training.listJupyterLabs.invalidate();
    },
    onError: (error, variables) => {
      setPendingDeletedLabNames((current) =>
        current.filter((name) => name !== variables.name),
      );
      notifyError(error.message);
    },
  });

  function handleCreateStudio() {
    if (!studioValidation.canCreate) return;

    createStudio.mutate({
      name: studioDraft.name.trim(),
      image: selectedStudioImageValue,
      cpu: studioDraft.cpu.trim(),
      memoryGi: studioValidation.parsedMemoryGi,
      gpuAllocationMode: studioDraft.gpuAllocationMode,
      gpuCount: studioValidation.parsedGpuCount,
      gpuMemoryGi:
        studioDraft.gpuAllocationMode === "memory"
          ? studioValidation.parsedGpuMemoryGi
          : null,
    });
  }

  function handleCreateRun() {
    if (!canCreateRun) return;

    createRun.mutate({
      title: runDraft.title.trim(),
      jobType: runDraft.jobType,
      priority: runDraft.priority,
      baseModel: runDraft.baseModel.trim(),
      datasetName: runDraft.datasetName.trim(),
      datasetSplit: runDraft.datasetSplit.trim() || "train",
      datasetTextField: runDraft.datasetTextField.trim() || "text",
      objective: runDraft.objective.trim(),
      gpuAllocationMode: runDraft.gpuAllocationMode,
      nodeCount: parsedNodeCount,
      gpusPerNode: parsedGpusPerNode,
      gpuMemoryGi:
        runDraft.gpuAllocationMode === "memory" ? parsedRunGpuMemoryGi : null,
      configSource: "unsloth_studio",
      launcherType:
        parsedNodeCount > 1 || parsedGpusPerNode > 1 ? "torchrun" : "python",
      distributedBackend: runDraft.distributedBackend,
      deepspeedStage:
        runDraft.distributedBackend === "deepspeed"
          ? Number(runDraft.deepspeedStage)
          : null,
      precision: runDraft.precision,
      loadIn4bit: runDraft.loadIn4bit,
      studioConfigSnapshot: {
        source: "cola-unsloth-studio",
        createdAt: new Date().toISOString(),
      },
      trainingConfigSnapshot: {
        nodeCount: parsedNodeCount,
        gpusPerNode: parsedGpusPerNode,
        backend: runDraft.distributedBackend,
        precision: runDraft.precision,
      },
      autoStart: runDraft.autoStart,
    });
  }

  function handleCreateJupyterLab() {
    if (!labValidation.canCreate) return;

    createJupyterLab.mutate({
      name: labDraft.name.trim(),
      image: selectedLabImageValue,
      cpu: labDraft.cpu.trim(),
      memoryGi: labValidation.parsedMemoryGi,
      gpuAllocationMode: labDraft.gpuAllocationMode,
      gpuCount: labValidation.parsedGpuCount,
      gpuMemoryGi:
        labDraft.gpuAllocationMode === "memory"
          ? labValidation.parsedGpuMemoryGi
          : null,
    });
  }

  async function handleDeleteStudio(name: string) {
    const confirmed = await confirm({
      title: `确认删除 Unsloth Studio「${name}」？`,
      description: "系统会删除对应的 Kubernetes Deployment 和 Service。",
      confirmLabel: "删除 Studio",
      cancelLabel: "取消",
      confirmVariant: "destructive",
    });
    if (!confirmed) return;

    deleteStudio.mutate({ name });
  }

  async function handleStopRun(run: StudioRun) {
    const confirmed = await confirm({
      title: `确认停止训练运行「${run.title}」？`,
      description: "系统会删除对应的 Kubernetes Job、Service 和 ConfigMap。",
      confirmLabel: "停止训练",
      cancelLabel: "取消",
      confirmVariant: "destructive",
    });
    if (!confirmed) return;

    stopRun.mutate({ id: run.id });
  }

  async function handleDeleteJupyterLab(name: string) {
    const confirmed = await confirm({
      title: `确认删除 JupyterLab「${name}」？`,
      description: "系统会删除对应的 Kubernetes Deployment 和 Service。",
      confirmLabel: "删除 JupyterLab",
      cancelLabel: "取消",
      confirmVariant: "destructive",
    });
    if (!confirmed) return;

    deleteJupyterLab.mutate({ name });
  }

  return (
    <ModulePageShell>
      <ModuleHero
        eyebrow="Training Workspace"
        title="训练工作台"
        description="Unsloth Studio 作为配置与提交入口，Cola 负责把配置转换成 Kubernetes 多机多卡训练运行；JupyterLab 保留为数据检查和代码调试环境。"
        icon={BrainCircuitIcon}
        size="compact"
        density="dense"
        badges={
          <Badge className="border border-slate-200/90 bg-white/86 text-slate-700">
            {studioAvailable || labAvailable ? "Kubernetes 可用" : "Kubernetes 不可用"}
          </Badge>
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={
                studiosQuery.isFetching ||
                studioRunsQuery.isFetching ||
                jupyterLabsQuery.isFetching
              }
              onClick={() => {
                void studiosQuery.refetch();
                void studioRunsQuery.refetch();
                void jupyterLabsQuery.refetch();
              }}
            >
              <RefreshCwIcon
                data-icon="inline-start"
                className={cn(
                  studiosQuery.isFetching ||
                    studioRunsQuery.isFetching ||
                    jupyterLabsQuery.isFetching
                    ? "animate-spin"
                    : undefined,
                )}
              />
              刷新
            </Button>
            <Button disabled={!studioAvailable} onClick={() => setIsRunCreateOpen(true)}>
              <PlayIcon data-icon="inline-start" />
              提交训练
            </Button>
            <Button disabled={!studioAvailable} onClick={() => setIsStudioCreateOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              新建 Studio
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <ModuleMetricCard
            size="compact"
            label="Studio"
            value={`${runningStudioCount}/${studios.length}`}
            description="运行中 / 全部"
            icon={BrainCircuitIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="训练运行"
            value={`${runningRunCount}/${studioRuns.length}`}
            description="运行中 / 全部"
            icon={ServerIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="GPU 申请"
            value={String(totalRunGpu)}
            description="运行记录中的总 GPU"
            icon={CpuIcon}
          />
        </div>
      </ModuleHero>

      <ModuleSection
        density="compact"
        title="Unsloth Studio"
        description="创建 Studio 工作区，并从这里提交多机多卡训练运行。运行记录是 Studio 提交后的后端执行对象，不作为第三个入口。"
        action={
          <div className="flex flex-wrap gap-2">
            <Button disabled={!studioAvailable} onClick={() => setIsRunCreateOpen(true)}>
              <PlayIcon data-icon="inline-start" />
              提交训练
            </Button>
            <Button
              variant="outline"
              disabled={!studioAvailable}
              onClick={() => setIsStudioCreateOpen(true)}
            >
              <PlusIcon data-icon="inline-start" />
              新建 Studio
            </Button>
          </div>
        }
      >
        {studiosQuery.isLoading ? <LoadingCards /> : null}

        {!studiosQuery.isLoading && studios.length === 0 ? (
          <ModuleEmptyState
            title="还没有 Unsloth Studio"
            description="创建一个 Studio 后，可以进入原生界面配置模型、数据集和训练参数。"
            action={
              <Button disabled={!studioAvailable} onClick={() => setIsStudioCreateOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                新建 Studio
              </Button>
            }
          />
        ) : null}

        {!studiosQuery.isLoading && studios.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {studios.map((studio) => (
              <RuntimeCard
                key={studio.id}
                kind="studio"
                title={studio.name}
                status={studio.status}
                updatedAt={studio.updatedAt}
                spec={runtimeSpecLabel(studio)}
                nodeName={studio.nodeName}
                endpoint={studio.endpoint}
                image={studio.image}
                openUrl={studio.studioUrl}
                isDeleting={
                  deleteStudio.isPending &&
                  deleteStudio.variables?.name === studio.name
                }
                onDelete={() => void handleDeleteStudio(studio.name)}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-5 border-t border-slate-200/80 pt-5">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-950">
                多机多卡运行记录
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                这些记录由 Studio 配置后提交，实际运行在 Kubernetes Indexed Job。
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={studioRunsQuery.isFetching}
              onClick={() => void studioRunsQuery.refetch()}
            >
              <RefreshCwIcon
                data-icon="inline-start"
                className={cn(studioRunsQuery.isFetching ? "animate-spin" : undefined)}
              />
              刷新运行
            </Button>
          </div>

          {studioRunsQuery.isLoading ? <LoadingCards /> : null}

          {!studioRunsQuery.isLoading && studioRuns.length === 0 ? (
            <ModuleEmptyState
              title="还没有训练运行"
              description="从 Studio 区域提交一次多机多卡训练后，运行状态会显示在这里。"
              action={
                <Button disabled={!studioAvailable} onClick={() => setIsRunCreateOpen(true)}>
                  <PlayIcon data-icon="inline-start" />
                  提交训练
                </Button>
              }
            />
          ) : null}

          {!studioRunsQuery.isLoading && studioRuns.length > 0 ? (
            <div className="grid gap-3">
              {studioRuns.map((run) => (
                <StudioRunCard
                  key={run.id}
                  run={run}
                  isStarting={
                    startRun.isPending && startRun.variables?.id === run.id
                  }
                  isStopping={
                    stopRun.isPending && stopRun.variables?.id === run.id
                  }
                  onStart={() => startRun.mutate({ id: run.id })}
                  onStop={() => void handleStopRun(run)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </ModuleSection>

      <ModuleSection
        density="compact"
        title="JupyterLab"
        description="用于数据检查、notebook 实验和单节点调试；正式多机多卡训练从 Unsloth Studio 区域提交。"
        action={
          <Button disabled={!labAvailable} onClick={() => setIsLabCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            新建 JupyterLab
          </Button>
        }
      >
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <ModuleMetricCard
            size="compact"
            label="Lab"
            value={`${runningLabCount}/${jupyterLabs.length}`}
            description="运行中 / 全部"
            icon={NotebookTabsIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="GPU Lab"
            value={String(jupyterLabs.filter((lab) => lab.gpuCount > 0).length)}
            description="已申请 GPU 的调试环境"
            icon={CpuIcon}
          />
        </div>

        {jupyterLabsQuery.isLoading ? <LoadingCards /> : null}

        {!jupyterLabsQuery.isLoading && jupyterLabs.length === 0 ? (
          <ModuleEmptyState
            title="还没有 JupyterLab"
            description="创建一个环境后，可以从这里直接进入 JupyterLab。"
            action={
              <Button disabled={!labAvailable} onClick={() => setIsLabCreateOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                新建 JupyterLab
              </Button>
            }
          />
        ) : null}

        {!jupyterLabsQuery.isLoading && jupyterLabs.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {jupyterLabs.map((lab) => (
              <RuntimeCard
                key={lab.id}
                kind="jupyter"
                title={lab.name}
                status={lab.status}
                updatedAt={lab.updatedAt}
                spec={runtimeSpecLabel(lab)}
                nodeName={lab.nodeName}
                endpoint={lab.endpoint}
                image={lab.image}
                openUrl={lab.labUrl}
                isDeleting={
                  deleteJupyterLab.isPending &&
                  deleteJupyterLab.variables?.name === lab.name
                }
                onDelete={() => void handleDeleteJupyterLab(lab.name)}
              />
            ))}
          </div>
        ) : null}
      </ModuleSection>

      <RuntimeDialog
        open={isStudioCreateOpen}
        onOpenChange={setIsStudioCreateOpen}
        title="新建 Unsloth Studio"
        badge="Unsloth Studio"
        description="选择资源后，Cola 会在训练命名空间拉起 Unsloth Studio，并分配 NodePort 入口。"
        draft={studioDraft}
        imageOptions={studioImageOptions}
        selectedImage={selectedStudioImage}
        selectedImageValue={selectedStudioImageValue}
        canCreate={studioValidation.canCreate}
        submitDisabledReason={studioValidation.reason}
        isPending={createStudio.isPending}
        submitLabel="创建 Studio"
        icon={BrainCircuitIcon}
        onDraftChange={setStudioDraft}
        onSubmit={handleCreateStudio}
      />

      <StudioRunDialog
        open={isRunCreateOpen}
        onOpenChange={setIsRunCreateOpen}
        draft={runDraft}
        canSubmit={canCreateRun}
        disabledReason={runDisabledReason}
        isPending={createRun.isPending}
        onDraftChange={setRunDraft}
        onSubmit={handleCreateRun}
      />

      <RuntimeDialog
        open={isLabCreateOpen}
        onOpenChange={setIsLabCreateOpen}
        title="新建 JupyterLab"
        badge="JupyterLab"
        description="选择资源后，Cola 会在训练命名空间拉起 JupyterLab，并分配 NodePort 入口。"
        draft={labDraft}
        imageOptions={labImageOptions}
        selectedImage={selectedLabImage}
        selectedImageValue={selectedLabImageValue}
        canCreate={labValidation.canCreate}
        submitDisabledReason={labValidation.reason}
        isPending={createJupyterLab.isPending}
        submitLabel="创建 JupyterLab"
        icon={NotebookTabsIcon}
        onDraftChange={setLabDraft}
        onSubmit={handleCreateJupyterLab}
      />

      {confirmDialog}
    </ModulePageShell>
  );
}
