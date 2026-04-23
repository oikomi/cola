"use client";

import {
  type LucideIcon,
  ArrowUpRightIcon,
  BrainCircuitIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  ModuleEmptyState,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { cn } from "@/lib/utils";
import { priorityLabels, priorityValues } from "@/server/office/catalog";
import {
  trainingConfigSourceLabels,
  trainingConfigSourceValues,
  trainingDistributedBackendLabels,
  trainingDistributedBackendValues,
  trainingJobStatusLabels,
  trainingJobTypeLabels,
  trainingJobTypeValues,
  trainingLauncherTypeLabels,
  trainingLauncherTypeValues,
  trainingPrecisionLabels,
  trainingPrecisionValues,
} from "@/server/training/catalog";
import { api, type RouterOutputs } from "@/trpc/react";

type TrainingDraft = {
  title: string;
  objective: string;
  configSource: (typeof trainingConfigSourceValues)[number];
  jobType: (typeof trainingJobTypeValues)[number];
  priority: (typeof priorityValues)[number];
  baseModel: string;
  datasetName: string;
  datasetSplit: string;
  datasetTextField: string;
  nodeCount: string;
  gpusPerNode: string;
  launcherType: (typeof trainingLauncherTypeValues)[number];
  distributedBackend: (typeof trainingDistributedBackendValues)[number];
  deepspeedStage: string;
  precision: (typeof trainingPrecisionValues)[number];
  loadIn4bit: "true" | "false";
  studioConfigJson: string;
};

type TrainingJobItem = RouterOutputs["training"]["listJobs"][number];
type TrainingListFilter = "all" | "running" | "issues" | "scheduling";

const defaultDraft: TrainingDraft = {
  title: "",
  objective: "",
  configSource: "manual",
  jobType: "sft",
  priority: "medium",
  baseModel: "Qwen/Qwen3-8B",
  datasetName: "",
  datasetSplit: "train",
  datasetTextField: "text",
  nodeCount: "1",
  gpusPerNode: "1",
  launcherType: "torchrun",
  distributedBackend: "deepspeed",
  deepspeedStage: "2",
  precision: "bf16",
  loadIn4bit: "true",
  studioConfigJson: "",
};

const minimalQwenLoraExample = {
  title: "Qwen2.5-0.5B 最小 LoRA 示例",
  objective:
    "使用 Unsloth + LoRA 验证训练平台链路，基于 4-bit Qwen2.5-0.5B Instruct 对最小中文客服问答样本做快速 smoke test，产出 adapter 权重。",
  configSource: "manual" as const,
  jobType: "lora" as const,
  priority: "medium" as (typeof priorityValues)[number],
  baseModel: "unsloth/Qwen2.5-0.5B-Instruct-bnb-4bit",
  datasetName:
    "/workspace/cola-training/datasets/qwen2.5-0.5b-lora-minimal.jsonl",
  datasetSplit: "train",
  datasetTextField: "text",
  nodeCount: "1",
  gpusPerNode: "1",
  launcherType: "torchrun" as const,
  distributedBackend: "deepspeed" as const,
  deepspeedStage: "2",
  precision: "bf16" as const,
  loadIn4bit: "true" as const,
  studioConfigJson: "",
} satisfies TrainingDraft;

const dialogControlClassName =
  "h-11 rounded-2xl border-slate-200/90 bg-white/92 px-3 text-[15px] shadow-[0_1px_0_rgba(255,255,255,0.7)]";
const dialogTextareaClassName =
  "min-h-[152px] rounded-[24px] border-slate-200/90 bg-white/92 px-4 py-3 text-[15px] leading-7 shadow-[0_1px_0_rgba(255,255,255,0.7)]";

function formatTime(value: Date | string | null | undefined) {
  if (!value) return "未启动";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function statusTone(status: keyof typeof trainingJobStatusLabels) {
  switch (status) {
    case "running":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "draft":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "stopped":
      return "border-border bg-muted text-muted-foreground";
    case "completed":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function priorityTone(priority: keyof typeof priorityLabels) {
  switch (priority) {
    case "critical":
      return "text-rose-700";
    case "high":
      return "text-amber-700";
    case "medium":
      return "text-emerald-700";
    case "low":
    default:
      return "text-muted-foreground";
  }
}

function runtimeSummaryTone(
  tone: "neutral" | "success" | "warning" | "error" | null | undefined,
) {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "neutral":
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function Field(props: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <label className={cn("grid gap-2.5", props.className)}>
      <span
        className={cn(
          "text-sm leading-5 font-medium text-slate-700",
          props.labelClassName,
        )}
      >
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-xs leading-5 text-slate-500">{props.hint}</span>
      ) : null}
    </label>
  );
}

function FormSection(props: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[28px] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.9))] p-5 shadow-[0_16px_38px_rgba(15,23,42,0.045)]",
        props.className,
      )}
    >
      <div className="border-b border-slate-200/80 pb-4">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-400 uppercase">
          {props.eyebrow}
        </p>
        <h3 className="mt-2 text-[1.1rem] leading-6 font-semibold tracking-[-0.04em] text-slate-950">
          {props.title}
        </h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          {props.description}
        </p>
      </div>
      <div className="mt-5 grid gap-5">{props.children}</div>
    </section>
  );
}

function SurfaceLabel(props: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase",
        props.className,
      )}
    >
      {props.children}
    </p>
  );
}

function TrainingMetricStripItem(props: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
}) {
  const Icon = props.icon;

  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-full border border-slate-200/85 bg-white/82 px-3 py-2 shadow-[0_6px_16px_rgba(15,23,42,0.025)]">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200">
        <Icon className="size-3" />
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
          {props.label}
        </p>
        <p className="text-[1rem] leading-none font-semibold tracking-[-0.05em] text-slate-950">
          {props.value}
        </p>
        <p className="text-[11px] leading-5 text-slate-500">
          {props.description}
        </p>
      </div>
    </div>
  );
}

function TrainingTopBar(props: {
  totalJobs: number;
  runningCount: number;
  draftCount: number;
  activeGpuCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onOpenStudio: () => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-shell)] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.86))] px-4 py-3 shadow-[0_14px_34px_rgba(15,23,42,0.042)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_10%,rgba(96,165,250,0.1),transparent_24%),radial-gradient(circle_at_88%_0%,rgba(14,165,233,0.06),transparent_18%)]" />

      <div className="relative flex flex-col gap-2.5">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-slate-950 text-white shadow-[0_12px_28px_rgba(15,23,42,0.1)]">
              <BrainCircuitIcon className="size-3.5" />
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <h1 className="mr-1 text-[1.34rem] leading-none font-semibold tracking-[-0.05em] text-slate-950">
                训练平台
              </h1>
              <Badge className="border border-slate-200/90 bg-white/88 text-slate-700">
                Training Jobs
              </Badge>
              <Badge
                variant="outline"
                className="border-border/80 bg-background/60"
              >
                Unsloth / Kubernetes
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 [&_[data-slot=button]]:h-8 [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:px-3.5 [&_[data-slot=button]]:text-[13px]">
            <Button variant="outline" onClick={props.onRefresh}>
              <RefreshCwIcon
                className={cn(props.isRefreshing ? "animate-spin" : undefined)}
                data-icon="inline-start"
              />
              刷新
            </Button>
            <Button onClick={props.onCreate}>
              <PlusIcon data-icon="inline-start" />
              新建任务
            </Button>
            <Button variant="outline" onClick={props.onOpenStudio}>
              <ArrowUpRightIcon data-icon="inline-start" />
              Unsloth Studio
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-200/80 pt-2.5">
          <TrainingMetricStripItem
            label="任务总数"
            value={String(props.totalJobs)}
            description="已登记"
            icon={BrainCircuitIcon}
          />
          <TrainingMetricStripItem
            label="运行中"
            value={String(props.runningCount)}
            description="占用训练资源"
            icon={PlayIcon}
          />
          <TrainingMetricStripItem
            label="草稿"
            value={String(props.draftCount)}
            description="待启动"
            icon={SquareIcon}
          />
          <TrainingMetricStripItem
            label="活跃 GPU"
            value={String(props.activeGpuCount)}
            description="运行中占用"
            icon={LoaderCircleIcon}
          />
        </div>
      </div>
    </section>
  );
}

function JobInfoBlock(props: {
  label: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", props.className)}>
      <SurfaceLabel>{props.label}</SurfaceLabel>
      <div
        className={cn(
          "min-w-0 text-sm leading-6 text-slate-700",
          props.contentClassName,
        )}
      >
        {props.children}
      </div>
    </div>
  );
}

function TrainingJobCard(props: {
  job: TrainingJobItem;
  isStarting: boolean;
  isStopping: boolean;
  isDeleting: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onOpenRuntime: () => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const { job, isStarting, isStopping, isDeleting, isExpanded } = props;
  const status: keyof typeof trainingJobStatusLabels = job.status;
  const canStart =
    status === "draft" || status === "stopped" || status === "failed";
  const distributedBackend =
    trainingDistributedBackendLabels[
      job.distributedBackend as keyof typeof trainingDistributedBackendLabels
    ];
  const launcherType =
    trainingLauncherTypeLabels[
      job.launcherType as keyof typeof trainingLauncherTypeLabels
    ];
  const precision =
    trainingPrecisionLabels[
      (job.precision ?? "auto") as keyof typeof trainingPrecisionLabels
    ];

  return (
    <article
      className="rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,249,252,0.88))] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.045)]"
      role="listitem"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="min-w-0 text-[1.15rem] leading-7 font-semibold tracking-[-0.04em] text-slate-950">
              {job.title}
            </h3>
            <Badge
              variant="outline"
              className={cn(
                "h-7 rounded-full px-3 text-xs",
                statusTone(status),
              )}
            >
              {trainingJobStatusLabels[status]}
            </Badge>
            <Badge
              variant="outline"
              className="h-7 rounded-full border-slate-200/90 bg-white/85 px-3 text-slate-600"
            >
              {trainingJobTypeLabels[job.jobType]}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "h-7 rounded-full border-transparent bg-slate-100/90 px-3",
                priorityTone(job.priority),
              )}
            >
              {priorityLabels[job.priority]}优先级
            </Badge>
          </div>
          <p
            className={cn(
              "mt-2 max-w-4xl text-sm leading-7 text-slate-600",
              isExpanded ? undefined : "line-clamp-2",
            )}
          >
            {job.objective}
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[420px] xl:items-end">
          <div className="rounded-[22px] border border-slate-200/85 bg-white/82 px-4 py-3 text-sm shadow-[0_1px_0_rgba(255,255,255,0.72)]">
            <SurfaceLabel>最近更新时间</SurfaceLabel>
            <p className="mt-1 text-[15px] font-semibold tracking-[-0.03em] text-slate-950">
              {formatTime(job.updatedAt ?? job.createdAt)}
            </p>
            <p className="mt-2 text-slate-500">
              启动: {formatTime(job.startedAt)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            {job.runtimeJobName ? (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full bg-white/80 px-3"
                disabled={isStarting || isStopping || isDeleting}
                onClick={props.onOpenRuntime}
              >
                运行态
              </Button>
            ) : null}

            {canStart ? (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full bg-white/80 px-3"
                disabled={isStarting || isStopping || isDeleting}
                onClick={props.onStart}
              >
                {isStarting ? (
                  <LoaderCircleIcon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <PlayIcon data-icon="inline-start" />
                )}
                {isStarting ? "启动中" : "启动"}
              </Button>
            ) : null}

            {job.status === "running" ? (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full bg-white/80 px-3"
                disabled={isStarting || isStopping || isDeleting}
                onClick={props.onStop}
              >
                {isStopping ? (
                  <LoaderCircleIcon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <SquareIcon data-icon="inline-start" />
                )}
                {isStopping ? "停止中" : "停止"}
              </Button>
            ) : null}

            <Button
              size="sm"
              variant="outline"
              className="rounded-full bg-white/80 px-3"
              aria-expanded={isExpanded}
              onClick={props.onToggleExpanded}
            >
              {isExpanded ? (
                <ChevronUpIcon data-icon="inline-start" />
              ) : (
                <ChevronDownIcon data-icon="inline-start" />
              )}
              {isExpanded ? "收起详情" : "展开详情"}
            </Button>

            <Button
              size="sm"
              variant="destructive"
              className="rounded-full px-3"
              disabled={
                job.status === "running" ||
                isStarting ||
                isStopping ||
                isDeleting
              }
              onClick={props.onDelete}
            >
              {isDeleting ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              {isDeleting ? "删除中" : "删除"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.95fr)_minmax(240px,0.8fr)]">
        <section className="rounded-[24px] border border-slate-200/80 bg-white/76 p-4 shadow-[0_1px_0_rgba(255,255,255,0.72)]">
          <SurfaceLabel>运行摘要</SurfaceLabel>
          <div className="mt-3 grid gap-3">
            {job.runtimeSummary ? (
              <div
                className={cn(
                  "rounded-[20px] border px-3.5 py-3 text-sm leading-6",
                  runtimeSummaryTone(job.runtimeSummaryTone),
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">最近运行态</span>
                  {job.runtimeSummaryAt ? (
                    <span className="text-xs opacity-80">
                      {formatTime(job.runtimeSummaryAt)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 break-words">{job.runtimeSummary}</div>
              </div>
            ) : (
              <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50/85 px-3.5 py-3 text-sm leading-6 text-slate-500">
                还没有可展示的运行态摘要。
              </div>
            )}

            {job.lastError ? (
              <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-6 text-rose-700">
                <SurfaceLabel className="text-rose-400">最近错误</SurfaceLabel>
                <div className="mt-1 break-words">{job.lastError}</div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200/80 bg-white/76 p-4 shadow-[0_1px_0_rgba(255,255,255,0.72)]">
          <SurfaceLabel>模型 / 数据集</SurfaceLabel>
          <div className="mt-3 grid gap-4">
            <JobInfoBlock
              label="基础模型"
              contentClassName="break-all text-[15px] leading-6 font-medium text-slate-900"
            >
              {job.baseModel}
            </JobInfoBlock>
            <JobInfoBlock
              label="数据集"
              contentClassName={cn(
                "break-all font-mono text-[13px] leading-6 text-slate-700",
                isExpanded ? undefined : "line-clamp-2",
              )}
            >
              {job.datasetName}
            </JobInfoBlock>
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200/80 bg-white/76 p-4 shadow-[0_1px_0_rgba(255,255,255,0.72)]">
          <SurfaceLabel>资源计划</SurfaceLabel>
          <div className="mt-3 grid gap-4">
            <JobInfoBlock
              label="并行规模"
              contentClassName="text-[15px] leading-6 font-semibold text-slate-950"
            >
              {job.nodeCount} 节点 x {job.gpusPerNode} GPU
            </JobInfoBlock>
            <JobInfoBlock label="总 GPU / 后端">
              总计 {job.gpuCount} GPU · {distributedBackend}
            </JobInfoBlock>
            <JobInfoBlock label="启动器 / 精度">
              {launcherType} · {precision}
            </JobInfoBlock>
          </div>
        </section>
      </div>

      {isExpanded ? (
        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section className="rounded-[24px] border border-slate-200/80 bg-slate-50/82 p-4 shadow-[0_1px_0_rgba(255,255,255,0.72)]">
            <SurfaceLabel>编排详情</SurfaceLabel>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <JobInfoBlock
                label="K8s Job"
                contentClassName="break-all font-mono text-[13px] leading-6 text-slate-700"
              >
                {job.runtimeJobName ? (
                  `${job.runtimeNamespace ?? "default"}/${job.runtimeJobName}`
                ) : (
                  <span className="font-sans text-sm text-slate-500">
                    未创建
                  </span>
                )}
              </JobInfoBlock>
              <JobInfoBlock
                label="Headless Service"
                contentClassName="break-all font-mono text-[13px] leading-6 text-slate-700"
              >
                {job.runtimeServiceName ?? (
                  <span className="font-sans text-sm text-slate-500">
                    未分配
                  </span>
                )}
              </JobInfoBlock>
              <JobInfoBlock
                label="产物目录"
                className="sm:col-span-2"
                contentClassName="break-all font-mono text-[13px] leading-6 text-slate-700"
              >
                {job.artifactPath ?? (
                  <span className="font-sans text-sm text-slate-500">
                    等待首次运行后生成
                  </span>
                )}
              </JobInfoBlock>
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200/80 bg-slate-50/82 p-4 shadow-[0_1px_0_rgba(255,255,255,0.72)]">
            <SurfaceLabel>运行清单</SurfaceLabel>
            <div className="mt-3 grid gap-3">
              <JobInfoBlock label="运行命名空间">
                {job.runtimeNamespace ?? "default"}
              </JobInfoBlock>
              <JobInfoBlock
                label="基础模型（完整）"
                contentClassName="break-all font-mono text-[13px] leading-6 text-slate-700"
              >
                {job.baseModel}
              </JobInfoBlock>
              <JobInfoBlock
                label="数据集（完整）"
                contentClassName="break-all font-mono text-[13px] leading-6 text-slate-700"
              >
                {job.datasetName}
              </JobInfoBlock>
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}

function LoadingRows() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`training-skeleton-${index}`}
          className="rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,249,252,0.88))] p-5"
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:justify-between">
            <div className="grid gap-3 xl:flex-1">
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-7 w-20 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
              </div>
              <Skeleton className="h-5 w-full max-w-3xl" />
              <Skeleton className="h-5 w-2/3 max-w-2xl" />
            </div>

            <div className="grid gap-3 xl:w-[420px]">
              <Skeleton className="h-24 rounded-[22px]" />
              <div className="flex gap-2">
                <Skeleton className="h-7 w-20 rounded-full" />
                <Skeleton className="h-7 w-20 rounded-full" />
                <Skeleton className="h-7 w-20 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.95fr)_minmax(240px,0.8fr)]">
            <Skeleton className="h-40 rounded-[24px]" />
            <Skeleton className="h-40 rounded-[24px]" />
            <Skeleton className="h-40 rounded-[24px]" />
          </div>
        </div>
      ))}
    </div>
  );
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNestedValue(source: unknown, path: readonly string[]): unknown {
  let current: unknown = source;

  for (const segment of path) {
    if (!isJsonRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function pickFirstValue(
  source: unknown,
  paths: ReadonlyArray<readonly string[]>,
): unknown {
  for (const path of paths) {
    const value = getNestedValue(source, path);
    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPositiveIntegerString(
  value: unknown,
  fallback?: string,
): string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return String(parsed);
    }
  }

  return fallback;
}

function asBooleanString(value: unknown): "true" | "false" | null {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (value === 0) return "false";
    if (value === 1) return "true";
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return "true";
    if (["false", "0", "no", "off"].includes(normalized)) return "false";
  }

  return null;
}

function inferJobType(
  source: unknown,
): (typeof trainingJobTypeValues)[number] | null {
  const explicit = asTrimmedString(
    pickFirstValue(source, [
      ["jobType"],
      ["job_type"],
      ["task"],
      ["task_type"],
      ["training_type"],
      ["trainer", "task"],
    ]),
  );
  const normalized = explicit?.toLowerCase();
  if (normalized?.includes("pretrain")) return "pretrain";
  if (normalized?.includes("lora")) return "lora";
  if (normalized?.includes("dpo")) return "dpo";
  if (normalized?.includes("sft")) return "sft";

  const loraRank = pickFirstValue(source, [
    ["lora", "rank"],
    ["lora", "r"],
    ["peft", "lora_r"],
    ["lora_r"],
  ]);
  if (loraRank !== undefined) return "lora";

  return null;
}

function inferPrecision(
  source: unknown,
): (typeof trainingPrecisionValues)[number] | null {
  const precision = asTrimmedString(
    pickFirstValue(source, [
      ["precision"],
      ["trainer", "precision"],
      ["model", "precision"],
      ["mixed_precision"],
    ]),
  )?.toLowerCase();

  if (precision === "bf16") return "bf16";
  if (precision === "fp16" || precision === "float16") return "fp16";
  if (precision === "auto") return "auto";

  const bf16 = asBooleanString(
    pickFirstValue(source, [["bf16"], ["trainer", "bf16"], ["model", "bf16"]]),
  );
  if (bf16 === "true") return "bf16";

  const fp16 = asBooleanString(
    pickFirstValue(source, [["fp16"], ["trainer", "fp16"], ["model", "fp16"]]),
  );
  if (fp16 === "true") return "fp16";

  return null;
}

function inferDistributedBackend(
  source: unknown,
): (typeof trainingDistributedBackendValues)[number] | null {
  const backend = asTrimmedString(
    pickFirstValue(source, [
      ["distributed", "backend"],
      ["backend"],
      ["launcher"],
    ]),
  )?.toLowerCase();

  if (backend?.includes("deepspeed")) return "deepspeed";
  if (backend?.includes("none")) return "none";

  if (
    pickFirstValue(source, [
      ["deepspeed"],
      ["distributed", "deepspeed"],
      ["trainer", "deepspeed"],
    ]) !== undefined
  ) {
    return "deepspeed";
  }

  return null;
}

function inferLauncherType(
  source: unknown,
): (typeof trainingLauncherTypeValues)[number] | null {
  const launcher = asTrimmedString(
    pickFirstValue(source, [
      ["distributed", "launcher"],
      ["launcher"],
      ["runner", "launcher"],
    ]),
  )?.toLowerCase();

  if (launcher?.includes("python")) return "python";
  if (
    launcher?.includes("torchrun") ||
    launcher?.includes("deepspeed") ||
    launcher?.includes("accelerate")
  ) {
    return "torchrun";
  }

  return null;
}

function inferDraftFromStudioConfig(
  source: unknown,
  current: TrainingDraft,
): { draft: TrainingDraft; applied: string[] } {
  if (!isJsonRecord(source)) {
    return { draft: current, applied: [] };
  }

  const nextDraft = { ...current };
  const applied: string[] = [];

  const title = asTrimmedString(
    pickFirstValue(source, [
      ["title"],
      ["name"],
      ["project"],
      ["project_name"],
    ]),
  );
  if (title) {
    nextDraft.title = title;
    applied.push("任务标题");
  }

  const objective = asTrimmedString(
    pickFirstValue(source, [
      ["objective"],
      ["description"],
      ["goal"],
      ["notes"],
      ["project_description"],
    ]),
  );
  if (objective) {
    nextDraft.objective = objective;
    applied.push("训练目标");
  }

  const jobType = inferJobType(source);
  if (jobType) {
    nextDraft.jobType = jobType;
    applied.push("训练类型");
  }

  const baseModel = asTrimmedString(
    pickFirstValue(source, [
      ["baseModel"],
      ["base_model"],
      ["model_name"],
      ["model_name_or_path"],
      ["model", "name"],
      ["model", "model_name"],
      ["model", "model_name_or_path"],
    ]),
  );
  if (baseModel) {
    nextDraft.baseModel = baseModel;
    applied.push("基础模型");
  }

  const datasetName = asTrimmedString(
    pickFirstValue(source, [
      ["datasetName"],
      ["dataset_name"],
      ["dataset_path"],
      ["dataset", "name"],
      ["dataset", "path"],
      ["data", "dataset"],
    ]),
  );
  if (datasetName) {
    nextDraft.datasetName = datasetName;
    applied.push("数据集");
  }

  const datasetSplit = asTrimmedString(
    pickFirstValue(source, [
      ["datasetSplit"],
      ["dataset_split"],
      ["split"],
      ["dataset", "split"],
    ]),
  );
  if (datasetSplit) {
    nextDraft.datasetSplit = datasetSplit;
    applied.push("数据集 Split");
  }

  const datasetTextField = asTrimmedString(
    pickFirstValue(source, [
      ["datasetTextField"],
      ["dataset_text_field"],
      ["text_field"],
      ["dataset", "textField"],
      ["dataset", "text_field"],
      ["dataset", "field"],
    ]),
  );
  if (datasetTextField) {
    nextDraft.datasetTextField = datasetTextField;
    applied.push("文本字段");
  }

  const nodeCount = asPositiveIntegerString(
    pickFirstValue(source, [
      ["nodeCount"],
      ["node_count"],
      ["num_nodes"],
      ["distributed", "nodeCount"],
      ["distributed", "num_nodes"],
      ["trainer", "num_nodes"],
    ]),
  );
  if (nodeCount) {
    nextDraft.nodeCount = nodeCount;
    applied.push("节点数");
  }

  const gpusPerNode = asPositiveIntegerString(
    pickFirstValue(source, [
      ["gpusPerNode"],
      ["gpus_per_node"],
      ["num_gpus"],
      ["nproc_per_node"],
      ["distributed", "gpusPerNode"],
      ["distributed", "gpus_per_node"],
      ["distributed", "nproc_per_node"],
      ["trainer", "num_gpus"],
    ]),
  );
  if (gpusPerNode) {
    nextDraft.gpusPerNode = gpusPerNode;
    applied.push("每节点 GPU");
  }

  const launcherType = inferLauncherType(source);
  if (launcherType) {
    nextDraft.launcherType = launcherType;
    applied.push("启动器");
  }

  const distributedBackend = inferDistributedBackend(source);
  if (distributedBackend) {
    nextDraft.distributedBackend = distributedBackend;
    applied.push("后端");
  }

  const deepspeedStage = asPositiveIntegerString(
    pickFirstValue(source, [
      ["deepspeedStage"],
      ["deepspeed_stage"],
      ["zero_stage"],
      ["deepspeed", "stage"],
      ["deepspeed", "zero_stage"],
      ["deepspeed", "zero_optimization", "stage"],
      ["distributed", "deepspeedStage"],
    ]),
  );
  if (deepspeedStage === "2" || deepspeedStage === "3") {
    nextDraft.deepspeedStage = deepspeedStage;
    applied.push("DeepSpeed Stage");
  }

  const precision = inferPrecision(source);
  if (precision) {
    nextDraft.precision = precision;
    applied.push("精度");
  }

  const loadIn4bitValue =
    asBooleanString(
      pickFirstValue(source, [
        ["loadIn4bit"],
        ["load_in_4bit"],
        ["model", "loadIn4bit"],
        ["model", "load_in_4bit"],
        ["quantization", "load_in_4bit"],
      ]),
    ) ??
    (pickFirstValue(source, [
      ["quantization", "bits"],
      ["quantization_bits"],
    ]) === 4
      ? "true"
      : null);
  if (loadIn4bitValue) {
    nextDraft.loadIn4bit = loadIn4bitValue;
    applied.push("4-bit 加载");
  }

  nextDraft.configSource = "unsloth_studio";

  return {
    draft: nextDraft,
    applied,
  };
}

export function TrainingShell() {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const unslothStudioUrl = process.env.NEXT_PUBLIC_UNSLOTH_STUDIO_URL?.trim();
  const jobsQuery = api.training.listJobs.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [listFilter, setListFilter] = useState<TrainingListFilter>("all");
  const [expandedJobDetails, setExpandedJobDetails] = useState<
    Record<string, boolean>
  >({});
  const [runtimeDialog, setRuntimeDialog] = useState<{
    jobId: string;
    title: string;
  } | null>(null);
  const [selectedRuntimePodName, setSelectedRuntimePodName] = useState<
    string | undefined
  >(undefined);
  const [draft, setDraft] = useState(defaultDraft);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const runtimeDetailQuery = api.training.getRuntimeDetails.useQuery(
    {
      jobId: runtimeDialog?.jobId ?? "00000000-0000-0000-0000-000000000000",
      ...(selectedRuntimePodName ? { podName: selectedRuntimePodName } : {}),
      tailLines: 160,
    },
    {
      enabled: Boolean(runtimeDialog),
      refetchOnWindowFocus: true,
      refetchInterval: runtimeDialog ? 5000 : false,
    },
  );

  const createJob = api.training.createJob.useMutation({
    onSuccess: (result) => {
      setFeedback({ tone: "success", message: result.message });
      setDraft(defaultDraft);
      setIsCreateOpen(false);
      void utils.training.listJobs.invalidate();
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const startJob = api.training.startJob.useMutation({
    onSuccess: (result) => {
      setFeedback({ tone: "success", message: result.message });
      void utils.training.listJobs.invalidate();
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const stopJob = api.training.stopJob.useMutation({
    onSuccess: (result) => {
      setFeedback({ tone: "success", message: result.message });
      void utils.training.listJobs.invalidate();
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const deleteJob = api.training.deleteJob.useMutation({
    onSuccess: (result) => {
      setFeedback({ tone: "success", message: result.message });
      void utils.training.listJobs.invalidate();
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const jobs = jobsQuery.data ?? [];
  const runtimeDetail = runtimeDetailQuery.data;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const issueCount = jobs.filter(
    (job) =>
      job.status === "failed" ||
      Boolean(job.lastError) ||
      job.runtimeSummaryTone === "warning" ||
      job.runtimeSummaryTone === "error",
  ).length;
  const schedulingIssueCount = jobs.filter(
    (job) => job.runtimeSummaryCategory === "scheduling",
  ).length;
  const filteredJobs = jobs.filter((job) => {
    if (listFilter === "running") {
      return job.status === "running";
    }

    if (listFilter === "issues") {
      return (
        job.status === "failed" ||
        Boolean(job.lastError) ||
        job.runtimeSummaryTone === "warning" ||
        job.runtimeSummaryTone === "error"
      );
    }

    if (listFilter === "scheduling") {
      return job.runtimeSummaryCategory === "scheduling";
    }

    return true;
  });
  const draftCount = jobs.filter((job) => job.status === "draft").length;
  const completedCount = jobs.filter(
    (job) => job.status === "completed",
  ).length;
  const activeGpuCount = jobs
    .filter((job) => job.status === "running")
    .reduce((total, job) => total + job.gpuCount, 0);

  const parsedNodeCount = Number(draft.nodeCount);
  const parsedGpusPerNode = Number(draft.gpusPerNode);
  const parsedDeepspeedStage = Number(draft.deepspeedStage);
  const totalGpuCount = parsedNodeCount * parsedGpusPerNode;
  const canSubmit =
    draft.title.trim().length >= 3 &&
    draft.objective.trim().length >= 8 &&
    draft.baseModel.trim().length >= 2 &&
    draft.datasetName.trim().length >= 2 &&
    draft.datasetSplit.trim().length >= 1 &&
    draft.datasetTextField.trim().length >= 1 &&
    Number.isInteger(parsedNodeCount) &&
    Number.isInteger(parsedGpusPerNode) &&
    parsedNodeCount >= 1 &&
    parsedNodeCount <= 32 &&
    parsedGpusPerNode >= 1 &&
    parsedGpusPerNode <= 16 &&
    totalGpuCount >= 1 &&
    totalGpuCount <= 128 &&
    (draft.distributedBackend !== "deepspeed" ||
      (Number.isInteger(parsedDeepspeedStage) &&
        parsedDeepspeedStage >= 2 &&
        parsedDeepspeedStage <= 3));
  const hasStudioConfig = draft.studioConfigJson.trim().length > 0;
  const summaryGpuCount = Number.isFinite(totalGpuCount) ? totalGpuCount : null;
  const titleReady = draft.title.trim().length >= 3;
  const objectiveReady = draft.objective.trim().length >= 8;
  const modelAndDatasetReady =
    draft.baseModel.trim().length >= 2 && draft.datasetName.trim().length >= 2;
  const resourcePlanReady =
    Number.isInteger(parsedNodeCount) &&
    Number.isInteger(parsedGpusPerNode) &&
    parsedNodeCount >= 1 &&
    parsedNodeCount <= 32 &&
    parsedGpusPerNode >= 1 &&
    parsedGpusPerNode <= 16 &&
    totalGpuCount >= 1 &&
    totalGpuCount <= 128;

  function applyMinimalExample() {
    setDraft(minimalQwenLoraExample);
    setFeedback(null);
    setIsCreateOpen(true);
  }

  function parseStudioConfigSnapshot() {
    const raw = draft.studioConfigJson.trim();
    if (!raw) return undefined;

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      setFeedback({
        tone: "error",
        message: "Studio 配置 JSON 不是合法的 JSON，请修正后再提交。",
      });
      return null;
    }
  }

  function applyStudioConfigToDraft() {
    const studioConfigSnapshot = parseStudioConfigSnapshot();
    if (studioConfigSnapshot === null || studioConfigSnapshot === undefined) {
      if (studioConfigSnapshot === undefined) {
        setFeedback({
          tone: "error",
          message: "请先粘贴 Unsloth Studio JSON，再执行导入。",
        });
      }
      return;
    }

    const inferred = inferDraftFromStudioConfig(studioConfigSnapshot, draft);
    if (inferred.applied.length === 0) {
      setFeedback({
        tone: "error",
        message:
          "当前 JSON 已保存，但没有识别出可自动带入的字段。你仍然可以直接提交，它会作为 studioConfigSnapshot 存档。",
      });
      return;
    }

    setDraft(inferred.draft);
    setFeedback({
      tone: "success",
      message: `已从 Studio JSON 带入：${inferred.applied.join("、")}`,
    });
  }

  function openUnslothStudio() {
    if (!unslothStudioUrl) {
      setFeedback({
        tone: "error",
        message:
          "当前未配置 Unsloth Studio 地址，请先设置 NEXT_PUBLIC_UNSLOTH_STUDIO_URL。",
      });
      return;
    }

    const openedWindow = window.open(
      unslothStudioUrl,
      "_blank",
      "noopener,noreferrer",
    );

    if (!openedWindow) {
      setFeedback({
        tone: "error",
        message: "浏览器拦截了新窗口，请允许弹窗后重试。",
      });
    }
  }

  function openRuntimeDialog(job: TrainingJobItem) {
    setSelectedRuntimePodName(undefined);
    setRuntimeDialog({
      jobId: job.id,
      title: job.title,
    });
  }

  function closeRuntimeDialog() {
    setRuntimeDialog(null);
    setSelectedRuntimePodName(undefined);
  }

  function toggleJobDetails(jobId: string, nextExpanded: boolean) {
    setExpandedJobDetails((current) => ({
      ...current,
      [jobId]: nextExpanded,
    }));
  }

  const handleDeleteJob = async (jobId: string, title: string) => {
    const confirmed = await confirm({
      title: `确认删除训练任务「${title}」？`,
      description: "删除后会从训练平台移除这条任务记录，且不能自动恢复。",
      confirmLabel: "删除任务",
    });
    if (!confirmed) return;

    deleteJob.mutate({ jobId });
  };

  return (
    <ModulePageShell>
      <TrainingTopBar
        totalJobs={jobs.length}
        runningCount={runningCount}
        draftCount={draftCount}
        activeGpuCount={activeGpuCount}
        isRefreshing={jobsQuery.isFetching}
        onRefresh={() => void jobsQuery.refetch()}
        onCreate={() => setIsCreateOpen(true)}
        onOpenStudio={openUnslothStudio}
      />

      {jobsQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>训练任务读取失败</AlertTitle>
          <AlertDescription>{jobsQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {feedback ? (
        <Alert
          variant={feedback.tone === "success" ? "default" : "destructive"}
        >
          <AlertTitle>
            {feedback.tone === "success" ? "操作完成" : "操作失败"}
          </AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <ModuleSection
        density="compact"
        title="任务列表"
        description="运行态、优先级、数据集和动作入口。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={listFilter === "all" ? "default" : "outline"}
              className="h-8 rounded-full px-3 text-[13px]"
              onClick={() => setListFilter("all")}
            >
              全部 {jobs.length}
            </Button>
            <Button
              size="sm"
              variant={listFilter === "running" ? "default" : "outline"}
              className="h-8 rounded-full px-3 text-[13px]"
              onClick={() => setListFilter("running")}
            >
              运行中 {runningCount}
            </Button>
            <Button
              size="sm"
              variant={listFilter === "issues" ? "default" : "outline"}
              className="h-8 rounded-full px-3 text-[13px]"
              onClick={() => setListFilter("issues")}
            >
              异常任务 {issueCount}
            </Button>
            <Button
              size="sm"
              variant={listFilter === "scheduling" ? "default" : "outline"}
              className="h-8 rounded-full px-3 text-[13px]"
              onClick={() => setListFilter("scheduling")}
            >
              调度失败 {schedulingIssueCount}
            </Button>
            <Badge
              variant="outline"
              className="h-8 rounded-full border-border/80 bg-background/60 px-3 text-[13px]"
            >
              已完成 {completedCount}
            </Badge>
          </div>
        }
      >
        {jobsQuery.isLoading ? <LoadingRows /> : null}

        {!jobsQuery.isLoading && jobs.length === 0 ? (
          <ModuleEmptyState
            title="还没有训练任务"
            description="先创建一个任务，把模型、数据集和 GPU 配额记录进去。"
            action={
              <Button onClick={() => setIsCreateOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                创建第一个任务
              </Button>
            }
          />
        ) : null}

        {!jobsQuery.isLoading &&
        jobs.length > 0 &&
        filteredJobs.length === 0 ? (
          <ModuleEmptyState
            title="当前筛选下没有任务"
            description={
              listFilter === "running"
                ? "当前没有运行中的训练任务。"
                : listFilter === "scheduling"
                  ? "当前没有识别到调度失败任务。"
                  : "当前没有匹配筛选条件的异常任务。"
            }
            action={
              <Button variant="outline" onClick={() => setListFilter("all")}>
                查看全部任务
              </Button>
            }
          />
        ) : null}

        {!jobsQuery.isLoading && filteredJobs.length > 0 ? (
          <div className="grid gap-4" role="list">
            {filteredJobs.map((job) => {
              const isStarting =
                startJob.isPending && startJob.variables?.jobId === job.id;
              const isStopping =
                stopJob.isPending && stopJob.variables?.jobId === job.id;
              const isDeleting =
                deleteJob.isPending && deleteJob.variables?.jobId === job.id;
              const isExpanded = expandedJobDetails[job.id] ?? false;

              return (
                <TrainingJobCard
                  key={job.id}
                  job={job}
                  isStarting={isStarting}
                  isStopping={isStopping}
                  isDeleting={isDeleting}
                  isExpanded={isExpanded}
                  onToggleExpanded={() => toggleJobDetails(job.id, !isExpanded)}
                  onOpenRuntime={() => openRuntimeDialog(job)}
                  onStart={() => startJob.mutate({ jobId: job.id })}
                  onStop={() => stopJob.mutate({ jobId: job.id })}
                  onDelete={() => void handleDeleteJob(job.id, job.title)}
                />
              );
            })}
          </div>
        ) : null}
      </ModuleSection>

      <Dialog
        open={Boolean(runtimeDialog)}
        onOpenChange={(open) => {
          if (!open) closeRuntimeDialog();
        }}
      >
        <DialogContent className="border-border/70 bg-background/95 text-foreground max-w-[1040px] p-0 backdrop-blur-xl">
          <DialogHeader className="border-border/70 border-b px-6 py-5">
            <DialogTitle className="text-2xl tracking-[-0.04em]">
              训练运行态
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-6">
              {runtimeDialog
                ? `${runtimeDialog.title} 的 Pod、事件和最近日志。`
                : "查看当前训练任务的运行态。"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => void runtimeDetailQuery.refetch()}
                disabled={!runtimeDialog || runtimeDetailQuery.isFetching}
              >
                <RefreshCwIcon
                  className={cn(
                    runtimeDetailQuery.isFetching ? "animate-spin" : undefined,
                  )}
                  data-icon="inline-start"
                />
                刷新运行态
              </Button>
              {runtimeDetail?.selectedPodName ? (
                <Field label="日志 Pod">
                  <Select
                    value={
                      selectedRuntimePodName ??
                      runtimeDetail.selectedPodName ??
                      undefined
                    }
                    onValueChange={(value) => {
                      const nextValue = value ?? "";
                      setSelectedRuntimePodName(
                        nextValue.length > 0 ? nextValue : undefined,
                      );
                    }}
                  >
                    <SelectTrigger className="min-w-[260px]">
                      <SelectValue placeholder="选择 Pod" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {runtimeDetail.pods.map((pod) => (
                          <SelectItem key={pod.name} value={pod.name}>
                            {pod.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </div>

            {runtimeDetailQuery.error ? (
              <Alert variant="destructive">
                <AlertTitle>运行态读取失败</AlertTitle>
                <AlertDescription>
                  {runtimeDetailQuery.error.message}
                </AlertDescription>
              </Alert>
            ) : null}

            {!runtimeDetailQuery.error && runtimeDetailQuery.isLoading ? (
              <div className="grid gap-3">
                <Skeleton className="h-24 rounded-3xl" />
                <Skeleton className="h-40 rounded-3xl" />
                <Skeleton className="h-56 rounded-3xl" />
              </div>
            ) : null}

            {!runtimeDetailQuery.isLoading && runtimeDetail === null ? (
              <Alert>
                <AlertTitle>还没有运行态对象</AlertTitle>
                <AlertDescription>
                  当前任务还没有可读取的 Kubernetes Job / Pod 运行态。
                </AlertDescription>
              </Alert>
            ) : null}

            {runtimeDetail ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-3xl border border-slate-200/80 bg-white/85 p-4">
                    <p className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                      Namespace
                    </p>
                    <p className="mt-2 font-medium text-slate-950">
                      {runtimeDetail.namespace}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-slate-200/80 bg-white/85 p-4">
                    <p className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                      Job
                    </p>
                    <p className="mt-2 font-medium break-all text-slate-950">
                      {runtimeDetail.jobName}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-slate-200/80 bg-white/85 p-4">
                    <p className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                      Service
                    </p>
                    <p className="mt-2 font-medium break-all text-slate-950">
                      {runtimeDetail.serviceName ?? "未记录"}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-slate-200/80 bg-white/85 p-4">
                    <p className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                      Leader Pod
                    </p>
                    <p className="mt-2 font-medium break-all text-slate-950">
                      {runtimeDetail.leaderPodName ?? "未记录"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
                  <div className="grid gap-4">
                    <div className="rounded-3xl border border-slate-200/80 bg-white/88 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium tracking-[-0.03em] text-slate-950">
                          Pods
                        </p>
                        <Badge variant="outline" className="rounded-full">
                          {runtimeDetail.pods.length} Pods
                        </Badge>
                      </div>
                      <div className="mt-4 grid gap-3">
                        {runtimeDetail.pods.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                            当前还没有读到任何 Pod。
                          </div>
                        ) : (
                          runtimeDetail.pods.map((pod) => (
                            <div
                              key={pod.name}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-slate-950">
                                  {pod.name}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full",
                                    pod.phase === "Running"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : pod.phase === "Succeeded"
                                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                        : pod.phase === "Failed"
                                          ? "border-rose-200 bg-rose-50 text-rose-700"
                                          : "border-slate-200 bg-white text-slate-700",
                                  )}
                                >
                                  {pod.phase}
                                </Badge>
                                {pod.completionIndex ? (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-slate-200 bg-white"
                                  >
                                    rank {pod.completionIndex}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="mt-2 grid gap-1 text-xs leading-5 text-slate-600">
                                <span>
                                  节点: {pod.nodeName ?? "未知"} · Pod IP:{" "}
                                  {pod.podIP ?? "未知"} · 重启: {pod.restarts}
                                </span>
                                <span>
                                  启动时间: {formatTime(pod.startedAt)} · Ready:{" "}
                                  {pod.ready ? "Yes" : "No"}
                                </span>
                                <span>原因: {pod.reason ?? "无"}</span>
                                {pod.containerStatuses.length > 0 ? (
                                  <span className="break-all">
                                    容器状态:{" "}
                                    {pod.containerStatuses
                                      .map(
                                        (status) =>
                                          `${status.name}=${status.state}`,
                                      )
                                      .join(" | ")}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200/80 bg-white/88 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium tracking-[-0.03em] text-slate-950">
                          K8s Events
                        </p>
                        <Badge variant="outline" className="rounded-full">
                          {runtimeDetail.events.length} Events
                        </Badge>
                      </div>
                      <div className="mt-4 grid max-h-[320px] gap-3 overflow-y-auto pr-1">
                        {runtimeDetail.events.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                            当前没有读到相关事件。
                          </div>
                        ) : (
                          runtimeDetail.events.map((event, index) => (
                            <div
                              key={`${event.involvedName ?? "event"}-${index}`}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full",
                                    event.type === "Warning"
                                      ? "border-amber-200 bg-amber-50 text-amber-700"
                                      : "border-slate-200 bg-white text-slate-700",
                                  )}
                                >
                                  {event.type ?? "Info"}
                                </Badge>
                                <span className="font-medium text-slate-950">
                                  {event.reason ?? "Unknown"}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {event.involvedKind ?? "Object"} /{" "}
                                  {event.involvedName ?? "Unknown"}
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-700">
                                {event.message}
                              </p>
                              <p className="mt-2 text-xs text-slate-500">
                                {formatTime(event.at)} · count {event.count}
                                {event.source ? ` · ${event.source}` : ""}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div className="rounded-3xl border border-slate-200/80 bg-white/88 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium tracking-[-0.03em] text-slate-950">
                          最近日志
                        </p>
                        <Badge variant="outline" className="rounded-full">
                          {runtimeDetail.selectedPodName ?? "未选择 Pod"}
                        </Badge>
                      </div>
                      <pre className="mt-4 max-h-[720px] overflow-auto rounded-2xl border border-slate-200/80 bg-slate-950 px-4 py-4 text-[11px] leading-5 whitespace-pre-wrap text-slate-100">
                        {runtimeDetail.logText &&
                        runtimeDetail.logText.trim().length > 0
                          ? runtimeDetail.logText.trim()
                          : "当前没有可显示的日志。Pod 可能尚未启动，或者日志还没有产生。"}
                      </pre>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <DialogFooter className="border-border/70 bg-muted/30 border-t px-6 py-4">
            <Button variant="outline" onClick={closeRuntimeDialog}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-h-[min(92vh,980px)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,247,252,0.95))] p-0 text-slate-950 shadow-[0_32px_80px_rgba(15,23,42,0.16)] backdrop-blur-xl sm:max-w-[1120px]">
          <DialogHeader className="relative overflow-hidden border-b border-slate-200/80 px-4 py-5 sm:px-6">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.15),transparent_32%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.11),transparent_24%)]" />
            <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                    Kubernetes Job
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-slate-200/90 bg-white/90"
                  >
                    Unsloth Runtime
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-slate-200/90 bg-white/90"
                  >
                    {summaryGpuCount ?? "-"} GPU
                  </Badge>
                </div>
                <DialogTitle className="mt-3 text-[1.9rem] leading-none tracking-[-0.06em] text-slate-950">
                  创建训练任务
                </DialogTitle>
                <DialogDescription className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                  把任务说明、模型数据和分布式 GPU
                  规格整理成一张可提交的作业单。 提交后 Cola
                  会创建训练记录，并交给 Kubernetes + Unsloth 容器执行。
                </DialogDescription>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-full border-slate-200/90 bg-white/88 px-4"
                  onClick={applyMinimalExample}
                >
                  <PlusIcon data-icon="inline-start" />
                  带入最小示例
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
              <div className="grid gap-5">
                <FormSection
                  eyebrow="Job Brief"
                  title="任务概览"
                  description="先写清任务背景和目标，再决定训练方式与优先级。这个分区负责回答“为什么要跑这次训练”。"
                >
                  <Field label="任务标题">
                    <Input
                      className={dialogControlClassName}
                      value={draft.title}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      placeholder="例如：Qwen3 客服语料 LoRA 微调"
                    />
                  </Field>

                  <Field label="训练目标">
                    <Textarea
                      className={cn(dialogTextareaClassName, "resize-none")}
                      value={draft.objective}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          objective: event.target.value,
                        }))
                      }
                      placeholder="说明任务目标、产出物和预期效果。"
                    />
                  </Field>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="配置来源">
                      <Select
                        value={draft.configSource}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            configSource: value! ?? current.configSource,
                          }))
                        }
                      >
                        <SelectTrigger
                          className={cn("w-full", dialogControlClassName)}
                        >
                          <SelectValue placeholder="选择配置来源" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {trainingConfigSourceValues.map((configSource) => (
                              <SelectItem
                                key={configSource}
                                value={configSource}
                              >
                                {trainingConfigSourceLabels[configSource]}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field label="训练类型">
                      <Select
                        value={draft.jobType}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            jobType: value ?? current.jobType,
                          }))
                        }
                      >
                        <SelectTrigger
                          className={cn("w-full", dialogControlClassName)}
                        >
                          <SelectValue placeholder="选择训练类型" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {trainingJobTypeValues.map((jobType) => (
                              <SelectItem key={jobType} value={jobType}>
                                {trainingJobTypeLabels[jobType]}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field label="优先级">
                      <Select
                        value={draft.priority}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            priority: value!,
                          }))
                        }
                      >
                        <SelectTrigger
                          className={cn("w-full", dialogControlClassName)}
                        >
                          <SelectValue placeholder="选择优先级" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {priorityValues.map((priority) => (
                              <SelectItem key={priority} value={priority}>
                                {priorityLabels[priority]}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field label="精度">
                      <Select
                        value={draft.precision}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            precision: value! ?? current.precision,
                          }))
                        }
                      >
                        <SelectTrigger
                          className={cn("w-full", dialogControlClassName)}
                        >
                          <SelectValue placeholder="选择精度" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {trainingPrecisionValues.map((precision) => (
                              <SelectItem key={precision} value={precision}>
                                {trainingPrecisionLabels[precision]}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field
                      label="4-bit 加载"
                      className="md:col-span-2"
                      hint="资源紧张时建议保持启用；正式训练前再评估精度与量化策略。"
                    >
                      <Select
                        value={draft.loadIn4bit}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            loadIn4bit: value === "false" ? "false" : "true",
                          }))
                        }
                      >
                        <SelectTrigger
                          className={cn("w-full", dialogControlClassName)}
                        >
                          <SelectValue placeholder="选择量化策略" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="true">启用 4-bit</SelectItem>
                            <SelectItem value="false">关闭 4-bit</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </FormSection>

                <FormSection
                  eyebrow="Model & Data"
                  title="模型与数据"
                  description="这里定义训练脚本要加载的基础模型与输入数据位置。Hugging Face 名称和挂载卷路径都支持。"
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label="基础模型"
                      hint="填写 Hugging Face 模型名，或训练容器内可直接解析的模型 ID"
                    >
                      <Input
                        className={dialogControlClassName}
                        value={draft.baseModel}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            baseModel: event.target.value,
                          }))
                        }
                        placeholder="Qwen/Qwen3-8B"
                      />
                    </Field>

                    <Field
                      label="数据集"
                      hint="可填写 Hugging Face 数据集名，或挂载卷里的文件路径"
                    >
                      <Input
                        className={dialogControlClassName}
                        value={draft.datasetName}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            datasetName: event.target.value,
                          }))
                        }
                        placeholder="例如：cola/support-v2 或 /workspace/datasets/support.jsonl"
                      />
                    </Field>

                    <Field label="数据集 Split">
                      <Input
                        className={dialogControlClassName}
                        value={draft.datasetSplit}
                        onChange={(event) =>
                          setDraft((current) => ({
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
                        value={draft.datasetTextField}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            datasetTextField: event.target.value,
                          }))
                        }
                        placeholder="text"
                      />
                    </Field>
                  </div>
                </FormSection>

                <FormSection
                  eyebrow="Compute Plan"
                  title="资源与分布式配置"
                  description="按节点、GPU、启动器和后端组织执行规格。右侧摘要会实时反映当前 GPU 申请量。"
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="节点数" hint="范围 1-32">
                      <Input
                        className={dialogControlClassName}
                        type="number"
                        min={1}
                        max={32}
                        value={draft.nodeCount}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            nodeCount: event.target.value,
                          }))
                        }
                        placeholder="1"
                      />
                    </Field>

                    <Field label="每节点 GPU" hint="范围 1-16">
                      <Input
                        className={dialogControlClassName}
                        type="number"
                        min={1}
                        max={16}
                        value={draft.gpusPerNode}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            gpusPerNode: event.target.value,
                          }))
                        }
                        placeholder="1"
                      />
                    </Field>

                    <Field label="启动器">
                      <Select
                        value={draft.launcherType}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            launcherType: value! ?? current.launcherType,
                          }))
                        }
                      >
                        <SelectTrigger
                          className={cn("w-full", dialogControlClassName)}
                        >
                          <SelectValue placeholder="选择启动器" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {trainingLauncherTypeValues.map((launcherType) => (
                              <SelectItem
                                key={launcherType}
                                value={launcherType}
                              >
                                {trainingLauncherTypeLabels[launcherType]}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field label="后端">
                      <Select
                        value={draft.distributedBackend}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            distributedBackend:
                              value! ?? current.distributedBackend,
                          }))
                        }
                      >
                        <SelectTrigger
                          className={cn("w-full", dialogControlClassName)}
                        >
                          <SelectValue placeholder="选择后端" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {trainingDistributedBackendValues.map((backend) => (
                              <SelectItem key={backend} value={backend}>
                                {trainingDistributedBackendLabels[backend]}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field
                      label="DeepSpeed Stage"
                      className="md:col-span-2"
                      hint={
                        draft.distributedBackend === "deepspeed"
                          ? "当前后端支持 ZeRO-2 / ZeRO-3。"
                          : "仅在后端选择 DeepSpeed 时启用。"
                      }
                    >
                      <Select
                        value={draft.deepspeedStage}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            deepspeedStage: value ?? current.deepspeedStage,
                          }))
                        }
                        disabled={draft.distributedBackend !== "deepspeed"}
                      >
                        <SelectTrigger
                          className={cn(
                            "w-full",
                            dialogControlClassName,
                            draft.distributedBackend !== "deepspeed"
                              ? "bg-slate-100/90 text-slate-400"
                              : undefined,
                          )}
                        >
                          <SelectValue placeholder="选择 Stage" />
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

                  <div className="rounded-[24px] border border-sky-200/70 bg-[linear-gradient(180deg,rgba(239,246,255,0.92),rgba(248,250,252,0.9))] px-4 py-4 text-sm leading-6 text-slate-700">
                    当前将申请
                    <span className="mx-1 font-semibold text-slate-950">
                      {summaryGpuCount ?? "-"}
                    </span>
                    张 GPU，规格为
                    <span className="mx-1 font-semibold text-slate-950">
                      {draft.nodeCount} 节点 x {draft.gpusPerNode} GPU
                    </span>
                    ，执行方式为
                    <span className="mx-1 font-semibold text-slate-950">
                      {trainingLauncherTypeLabels[draft.launcherType]}
                    </span>
                    +
                    <span className="mx-1 font-semibold text-slate-950">
                      {
                        trainingDistributedBackendLabels[
                          draft.distributedBackend
                        ]
                      }
                    </span>
                    。
                  </div>
                </FormSection>

                <FormSection
                  eyebrow="Advanced Import"
                  title="Studio JSON（可选）"
                  description="如果你从 Unsloth Studio 导出了配置，可以直接粘贴到这里。Cola 会保存原始快照，并尝试识别常用字段。"
                >
                  <Field
                    label="Unsloth Studio JSON"
                    hint="宽松兼容解析会优先识别模型、数据集、文本字段、节点数、每节点 GPU、精度、DeepSpeed Stage 和 4-bit 设置。"
                  >
                    <Textarea
                      className={cn(
                        dialogTextareaClassName,
                        "min-h-[220px] resize-y font-mono text-[13px] leading-6",
                      )}
                      value={draft.studioConfigJson}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          studioConfigJson: event.target.value,
                          configSource: event.target.value.trim()
                            ? "unsloth_studio"
                            : current.configSource === "unsloth_studio"
                              ? "manual"
                              : current.configSource,
                        }))
                      }
                      placeholder='例如：{"project":"qwen-lora","notes":"exported from studio"}'
                    />
                  </Field>

                  <div className="flex flex-col gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/90 px-4 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-900">
                        {hasStudioConfig
                          ? "已检测到 Studio JSON，可直接导入字段。"
                          : "还没有粘贴 Studio JSON。"}
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        导入只会覆盖能识别的字段，未识别部分仍保留在原始 JSON
                        快照中。
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-full border-slate-200/90 bg-white/88 px-4"
                      onClick={applyStudioConfigToDraft}
                    >
                      <RefreshCwIcon data-icon="inline-start" />从 Studio JSON
                      带入字段
                    </Button>
                  </div>
                </FormSection>
              </div>

              <aside className="grid gap-5 xl:sticky xl:top-0">
                <div className="rounded-[28px] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.9))] p-5 shadow-[0_16px_38px_rgba(15,23,42,0.045)]">
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-400 uppercase">
                    Live Summary
                  </p>
                  <h3 className="mt-2 text-[1.1rem] leading-6 font-semibold tracking-[-0.04em] text-slate-950">
                    提交摘要
                  </h3>

                  <div className="mt-5 grid gap-3">
                    <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-4">
                      <p className="text-[11px] font-medium tracking-[0.16em] text-slate-500 uppercase">
                        GPU 总量
                      </p>
                      <p className="mt-2 text-[2rem] leading-none font-semibold tracking-[-0.06em] text-slate-950">
                        {summaryGpuCount ?? "--"}
                      </p>
                      <p className="mt-2 text-sm text-slate-500">
                        {draft.nodeCount} 节点 x {draft.gpusPerNode} GPU
                      </p>
                    </div>

                    <div className="rounded-[22px] border border-slate-200/80 bg-white/88 px-4 py-4">
                      <p className="text-[11px] font-medium tracking-[0.16em] text-slate-500 uppercase">
                        训练规格
                      </p>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {trainingJobTypeLabels[draft.jobType]} /{" "}
                        {trainingPrecisionLabels[draft.precision]}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {trainingLauncherTypeLabels[draft.launcherType]} +{" "}
                        {
                          trainingDistributedBackendLabels[
                            draft.distributedBackend
                          ]
                        }
                      </p>
                    </div>

                    <div className="rounded-[22px] border border-slate-200/80 bg-white/88 px-4 py-4">
                      <p className="text-[11px] font-medium tracking-[0.16em] text-slate-500 uppercase">
                        数据来源
                      </p>
                      <p className="mt-2 text-sm font-medium break-all text-slate-900">
                        {draft.datasetName.trim() || "待填写数据集"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        split: {draft.datasetSplit || "train"} · text field:{" "}
                        {draft.datasetTextField || "text"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200/85 bg-white/92 p-5 shadow-[0_16px_38px_rgba(15,23,42,0.04)]">
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-400 uppercase">
                    Readiness
                  </p>
                  <h3 className="mt-2 text-[1.1rem] leading-6 font-semibold tracking-[-0.04em] text-slate-950">
                    提交前检查
                  </h3>

                  <div className="mt-5 grid gap-2.5">
                    {[
                      {
                        label: "任务标题",
                        ready: titleReady,
                        detail: titleReady
                          ? draft.title.trim()
                          : "至少 3 个字符",
                      },
                      {
                        label: "训练目标",
                        ready: objectiveReady,
                        detail: objectiveReady
                          ? "目标描述已填写"
                          : "至少 8 个字符",
                      },
                      {
                        label: "模型与数据",
                        ready: modelAndDatasetReady,
                        detail: modelAndDatasetReady
                          ? "模型与数据路径已配置"
                          : "补充基础模型和数据集",
                      },
                      {
                        label: "资源规格",
                        ready: resourcePlanReady,
                        detail: resourcePlanReady
                          ? `${summaryGpuCount ?? "-"} GPU 可提交`
                          : "节点数 / GPU 数量超出范围",
                      },
                      {
                        label: "Studio JSON",
                        ready: hasStudioConfig,
                        detail: hasStudioConfig
                          ? "已附带原始配置快照"
                          : "未使用，可忽略",
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className={cn(
                          "flex items-start justify-between gap-3 rounded-[20px] border px-4 py-3",
                          item.ready
                            ? "border-emerald-200 bg-emerald-50/70"
                            : "border-slate-200/80 bg-slate-50/80",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {item.label}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {item.detail}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "mt-0.5 shrink-0 rounded-full px-2 py-1 text-[11px] font-medium",
                            item.ready
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-white text-slate-500 ring-1 ring-slate-200",
                          )}
                        >
                          {item.ready ? "已就绪" : "待补充"}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-4 text-sm leading-6 text-slate-600">
                    提交后会先创建训练任务记录，再由 Kubernetes
                    拉起容器。链路验收阶段建议先用小模型和小样本跑通流程。
                  </div>
                </div>
              </aside>
            </div>
          </div>

          <DialogFooter
            bleed={false}
            className="border-slate-200/80 bg-white/72 px-4 py-4 sm:px-6"
          >
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button
              className="h-11 rounded-full px-5"
              disabled={!canSubmit || createJob.isPending}
              onClick={() => {
                const studioConfigSnapshot = parseStudioConfigSnapshot();
                if (studioConfigSnapshot === null) return;

                createJob.mutate({
                  title: draft.title.trim(),
                  objective: draft.objective.trim(),
                  configSource: studioConfigSnapshot
                    ? "unsloth_studio"
                    : draft.configSource,
                  jobType: draft.jobType,
                  priority: draft.priority,
                  baseModel: draft.baseModel.trim(),
                  datasetName: draft.datasetName.trim(),
                  datasetSplit: draft.datasetSplit.trim(),
                  datasetTextField: draft.datasetTextField.trim(),
                  nodeCount: parsedNodeCount,
                  gpusPerNode: parsedGpusPerNode,
                  launcherType: draft.launcherType,
                  distributedBackend: draft.distributedBackend,
                  deepspeedStage:
                    draft.distributedBackend === "deepspeed"
                      ? parsedDeepspeedStage
                      : null,
                  precision: draft.precision,
                  loadIn4bit: draft.loadIn4bit === "true",
                  ...(studioConfigSnapshot ? { studioConfigSnapshot } : {}),
                });
              }}
            >
              {createJob.isPending ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {createJob.isPending ? "创建中" : "创建训练任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </ModulePageShell>
  );
}
