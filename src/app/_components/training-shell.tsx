"use client";

import {
  ArrowUpRightIcon,
  BrainCircuitIcon,
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
  ModuleHero,
  ModuleMetricCard,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { ProductAreaHeader } from "@/app/_components/product-area-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { priorityLabels, priorityValues } from "@/server/office/catalog";
import {
  trainingJobStatusLabels,
  trainingJobTypeLabels,
  trainingJobTypeValues,
} from "@/server/training/catalog";
import { api } from "@/trpc/react";

type TrainingDraft = {
  title: string;
  objective: string;
  jobType: (typeof trainingJobTypeValues)[number];
  priority: (typeof priorityValues)[number];
  baseModel: string;
  datasetName: string;
  gpuCount: string;
};

const defaultDraft: TrainingDraft = {
  title: "",
  objective: "",
  jobType: "sft",
  priority: "medium",
  baseModel: "Qwen/Qwen3-8B",
  datasetName: "",
  gpuCount: "1",
};

const minimalQwenLoraExample = {
  title: "Qwen2.5-0.5B 最小 LoRA 示例",
  objective:
    "使用 Unsloth + LoRA 验证训练平台链路，基于 4-bit Qwen2.5-0.5B Instruct 对最小中文客服问答样本做快速 smoke test，产出 adapter 权重。",
  jobType: "lora" as const,
  priority: "medium" as (typeof priorityValues)[number],
  baseModel: "unsloth/Qwen2.5-0.5B-Instruct-bnb-4bit",
  datasetName:
    "/workspace/cola-training/datasets/qwen2.5-0.5b-lora-minimal.jsonl",
  gpuCount: "1",
} satisfies TrainingDraft;

const minimalQwenLoraDatasetPreview = [
  '{"text":"你是客服助手。用户：退款一般多久到账？\\n助手：原路退款通常 1 到 3 个工作日到账，如遇银行处理延迟可再等待 1 到 2 个工作日。"}',
  '{"text":"你是客服助手。用户：我想修改收货地址怎么办？\\n助手：如果订单还未出库，请尽快提供新的详细地址和联系电话，我们会优先帮你修改。"}',
  '{"text":"你是客服助手。用户：你们支持开增值税专票吗？\\n助手：支持。请提供开票抬头、税号、开户行、账号和注册地址，我们会在审核后开具。"}',
] as const;

const minimalQwenLoraRuntimeNotes = [
  "默认 load_in_4bit=true，适合用 1 张 GPU 先验证链路。",
  "默认读取 text 字段；如果你的字段名不同，需要改 COLA_TRAINING_DATASET_TEXT_FIELD。",
  "平台默认 max_steps=60、per_device_train_batch_size=2、gradient_accumulation_steps=4，更像 smoke test，不是正式收敛配置。",
  "任务完成后会把 LoRA adapter 写到产物目录下的 adapter/ 子目录。",
] as const;

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

function Field(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-2">
      <span className="text-muted-foreground text-xs font-medium tracking-[0.18em] uppercase">
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-muted-foreground text-xs">{props.hint}</span>
      ) : null}
    </label>
  );
}

function LoadingRows() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`training-skeleton-${index}`}
          className="border-border/70 bg-background/70 rounded-3xl border p-4"
        >
          <div className="grid gap-3 md:grid-cols-[1.4fr_110px_1fr_110px_140px_220px] md:items-center">
            <div className="grid gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
            <div className="grid gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-5 w-16" />
            <div className="grid gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-20 rounded-full" />
              <Skeleton className="h-9 w-20 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TrainingShell() {
  const utils = api.useUtils();
  const unslothStudioUrl = process.env.NEXT_PUBLIC_UNSLOTH_STUDIO_URL?.trim();
  const jobsQuery = api.training.listJobs.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [draft, setDraft] = useState(defaultDraft);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

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
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const draftCount = jobs.filter((job) => job.status === "draft").length;
  const completedCount = jobs.filter(
    (job) => job.status === "completed",
  ).length;
  const activeGpuCount = jobs
    .filter((job) => job.status === "running")
    .reduce((total, job) => total + job.gpuCount, 0);

  const parsedGpuCount = Number(draft.gpuCount);
  const canSubmit =
    draft.title.trim().length >= 3 &&
    draft.objective.trim().length >= 8 &&
    draft.baseModel.trim().length >= 2 &&
    draft.datasetName.trim().length >= 2 &&
    Number.isInteger(parsedGpuCount) &&
    parsedGpuCount >= 1 &&
    parsedGpuCount <= 64;

  function applyMinimalExample() {
    setDraft(minimalQwenLoraExample);
    setFeedback(null);
    setIsCreateOpen(true);
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

  return (
    <ModulePageShell>
      <ProductAreaHeader />

      <ModuleHero
        size="compact"
        eyebrow="Training Jobs"
        title="训练平台"
        description="把训练任务、基础模型、数据集和 GPU 配额统一收口到一张作业表里。"
        icon={BrainCircuitIcon}
        badges={
          <Badge
            variant="outline"
            className="border-border/80 bg-background/60"
          >
            Unsloth / Kubernetes
          </Badge>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-9 rounded-full px-4"
              onClick={() => void jobsQuery.refetch()}
            >
              <RefreshCwIcon
                className={cn(
                  jobsQuery.isFetching ? "animate-spin" : undefined,
                )}
                data-icon="inline-start"
              />
              刷新列表
            </Button>
            <Button
              className="h-9 rounded-full px-4"
              onClick={() => setIsCreateOpen(true)}
            >
              <PlusIcon data-icon="inline-start" />
              创建训练任务
            </Button>
            <Button
              variant="outline"
              className="h-9 rounded-full px-4"
              onClick={openUnslothStudio}
            >
              <ArrowUpRightIcon data-icon="inline-start" />
              进入 Unsloth Studio
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ModuleMetricCard
            size="compact"
            label="任务总数"
            value={String(jobs.length)}
            description="当前训练控制面中记录的全部任务。"
            icon={BrainCircuitIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="运行中"
            value={String(runningCount)}
            description="已经提交并正在实际执行的训练作业。"
            icon={PlayIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="草稿"
            value={String(draftCount)}
            description="参数已配置但还未开始执行的任务。"
            icon={SquareIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="活跃 GPU"
            value={String(activeGpuCount)}
            description="按照运行中训练任务累计的 GPU 使用量。"
            icon={LoaderCircleIcon}
          />
        </div>
      </ModuleHero>

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
        title="最小示例"
        description="先用一个最小 Qwen LoRA 任务把链路跑通，再逐步替换成自己的模型和数据。下面这组配置对应当前平台的内置 Unsloth 执行器默认参数；如果要调更多高级超参，建议直接进入 Unsloth Studio。"
        action={
          <Button
            variant="outline"
            className="rounded-full"
            onClick={applyMinimalExample}
          >
            <PlusIcon data-icon="inline-start" />
            带入最小示例
          </Button>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="grid gap-4">
            <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(248,250,252,0.88),rgba(255,255,255,0.98))] p-5 shadow-[0_14px_34px_rgba(15,23,42,0.04)]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                  Unsloth
                </Badge>
                <Badge
                  variant="outline"
                  className="border-slate-200/90 bg-white/90"
                >
                  Qwen2.5-0.5B
                </Badge>
                <Badge
                  variant="outline"
                  className="border-slate-200/90 bg-white/90"
                >
                  LoRA Smoke Test
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 text-sm">
                <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    任务标题
                  </span>
                  <span className="font-medium text-slate-900">
                    {minimalQwenLoraExample.title}
                  </span>
                </div>
                <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    训练目标
                  </span>
                  <span className="leading-6 text-slate-700">
                    {minimalQwenLoraExample.objective}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                    <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                      训练类型
                    </span>
                    <span className="font-medium text-slate-900">
                      {trainingJobTypeLabels[minimalQwenLoraExample.jobType]}
                    </span>
                  </div>
                  <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                    <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                      GPU 数量
                    </span>
                    <span className="font-medium text-slate-900">
                      {minimalQwenLoraExample.gpuCount} GPU
                    </span>
                  </div>
                </div>
                <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    基础模型
                  </span>
                  <span className="font-medium break-all text-slate-900">
                    {minimalQwenLoraExample.baseModel}
                  </span>
                </div>
                <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    数据集路径
                  </span>
                  <span className="font-medium break-all text-slate-900">
                    {minimalQwenLoraExample.datasetName}
                  </span>
                  <span className="text-xs leading-5 text-slate-500">
                    这个路径必须存在于训练 Pod
                    挂载卷中；仓库里的文档示例不会自动出现在容器里。
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-[var(--radius-card)] border border-amber-200/80 bg-amber-50/70 p-5 text-sm leading-6 text-amber-900 shadow-[0_14px_34px_rgba(15,23,42,0.03)]">
              这是一个最小可跑示例，目标是先验证表单、Kubernetes
              Job、数据读取、LoRA
              保存链路都正常，再把数据集和步数切换到正式配置。
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white/94 p-5 shadow-[0_14px_34px_rgba(15,23,42,0.04)]">
              <p className="text-sm font-semibold tracking-[-0.03em] text-slate-950">
                示例数据文件
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                先把下面 3 行 JSONL 保存到
                <span className="mx-1 font-mono text-[12px] text-slate-900">
                  {minimalQwenLoraExample.datasetName}
                </span>
                ，并确保字段名就是
                <span className="mx-1 font-mono text-[12px] text-slate-900">
                  text
                </span>
                。
              </p>
              <pre className="mt-4 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-950 px-4 py-4 text-[11px] leading-5 text-slate-100">
                {minimalQwenLoraDatasetPreview.join("\n")}
              </pre>
            </div>

            <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white/94 p-5 shadow-[0_14px_34px_rgba(15,23,42,0.04)]">
              <p className="text-sm font-semibold tracking-[-0.03em] text-slate-950">
                平台默认参数
              </p>
              <div className="mt-4 grid gap-2 text-sm leading-6 text-slate-700">
                {minimalQwenLoraRuntimeNotes.map((note) => (
                  <div
                    key={note}
                    className="rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3"
                  >
                    {note}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                如果你要做正式训练，至少要重新评估 step、batch size、learning
                rate 和数据格式；当前默认值更适合做链路验收。
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {unslothStudioUrl
                  ? "已经配置 Unsloth Studio，可从页面右上角直接进入原生配置界面。"
                  : "如果需要进入 Unsloth 原生页面，请配置 NEXT_PUBLIC_UNSLOTH_STUDIO_URL。"}
              </p>
            </div>
          </div>
        </div>
      </ModuleSection>

      <ModuleSection
        title="任务列表"
        description="查看运行态、优先级、数据集和动作入口。错误信息会直接内嵌在任务行里。"
        action={
          <Badge
            variant="outline"
            className="border-border/80 bg-background/60"
          >
            已完成 {completedCount}
          </Badge>
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

        {!jobsQuery.isLoading && jobs.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>任务</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>模型 / 数据集</TableHead>
                <TableHead>资源</TableHead>
                <TableHead>时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const isStarting =
                  startJob.isPending && startJob.variables?.jobId === job.id;
                const isStopping =
                  stopJob.isPending && stopJob.variables?.jobId === job.id;
                const isDeleting =
                  deleteJob.isPending && deleteJob.variables?.jobId === job.id;
                const status: keyof typeof trainingJobStatusLabels =
                  job.status as keyof typeof trainingJobStatusLabels;
                const canStart =
                  status === "draft" ||
                  status === "stopped" ||
                  status === "failed";

                return (
                  <TableRow key={job.id} className="border-border/70">
                    <TableCell className="align-top">
                      <div className="flex max-w-[26rem] flex-col gap-2">
                        <div className="flex flex-col gap-1">
                          <p className="text-foreground font-medium">
                            {job.title}
                          </p>
                          <p className="text-muted-foreground text-sm">
                            {trainingJobTypeLabels[job.jobType]} ·{" "}
                            <span className={priorityTone(job.priority)}>
                              {priorityLabels[job.priority]}优先级
                            </span>
                          </p>
                        </div>
                        <p className="text-muted-foreground line-clamp-2 text-sm leading-6">
                          {job.objective}
                        </p>
                        {job.runtimeJobName ? (
                          <p className="text-muted-foreground text-xs leading-5">
                            K8s Job: {job.runtimeNamespace ?? "default"}/
                            {job.runtimeJobName}
                          </p>
                        ) : null}
                        {job.artifactPath ? (
                          <p className="text-muted-foreground text-xs leading-5">
                            产物目录: {job.artifactPath}
                          </p>
                        ) : null}
                        {job.lastError ? (
                          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                            {job.lastError}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge
                        variant="outline"
                        className={cn("rounded-full", statusTone(status))}
                      >
                        {trainingJobStatusLabels[status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1">
                        <span className="text-foreground font-medium">
                          {job.baseModel}
                        </span>
                        <span className="text-muted-foreground text-sm">
                          {job.datasetName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground align-top font-medium">
                      {job.gpuCount} GPU
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="text-foreground font-medium">
                          {formatTime(job.updatedAt ?? job.createdAt)}
                        </span>
                        <span className="text-muted-foreground">
                          启动: {formatTime(job.startedAt)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex justify-end gap-2">
                        {canStart ? (
                          <Button
                            variant="outline"
                            className="rounded-full"
                            disabled={isStarting || isStopping || isDeleting}
                            onClick={() => startJob.mutate({ jobId: job.id })}
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
                            variant="outline"
                            className="rounded-full"
                            disabled={isStarting || isStopping || isDeleting}
                            onClick={() => stopJob.mutate({ jobId: job.id })}
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
                          variant="destructive"
                          className="rounded-full"
                          disabled={
                            job.status === "running" ||
                            isStarting ||
                            isStopping ||
                            isDeleting
                          }
                          onClick={() => {
                            if (
                              !window.confirm(
                                `确认删除训练任务「${job.title}」吗？`,
                              )
                            ) {
                              return;
                            }

                            deleteJob.mutate({ jobId: job.id });
                          }}
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
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </ModuleSection>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="border-border/70 bg-background/95 text-foreground max-w-[720px] p-0 backdrop-blur-xl">
          <DialogHeader className="border-border/70 border-b px-6 py-5">
            <DialogTitle className="text-2xl tracking-[-0.04em]">
              创建训练任务
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-6">
              当前启动后会提交到 Kubernetes，使用 Unsloth 容器执行。数据集可填写
              Hugging Face 数据集名，或挂载卷里的文件路径。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5">
            <Field label="任务标题">
              <Input
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
                className="min-h-28 resize-none"
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

            <div className="grid gap-4 md:grid-cols-3">
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
                  <SelectTrigger className="w-full">
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
                  <SelectTrigger className="w-full">
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

              <Field label="GPU 数量" hint="范围 1-64">
                <Input
                  type="number"
                  min={1}
                  max={64}
                  value={draft.gpuCount}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gpuCount: event.target.value,
                    }))
                  }
                  placeholder="1"
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="基础模型"
                hint="最小 smoke test 可直接使用 unsloth/Qwen2.5-0.5B-Instruct-bnb-4bit"
              >
                <Input
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
                hint="默认读取 text 字段；可填写 Hugging Face 数据集名，或挂载卷里的文件路径"
              >
                <Input
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
            </div>
          </div>

          <DialogFooter className="border-border/70 bg-muted/30 border-t px-6 py-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!canSubmit || createJob.isPending}
              onClick={() =>
                createJob.mutate({
                  title: draft.title.trim(),
                  objective: draft.objective.trim(),
                  jobType: draft.jobType,
                  priority: draft.priority,
                  baseModel: draft.baseModel.trim(),
                  datasetName: draft.datasetName.trim(),
                  gpuCount: parsedGpuCount,
                })
              }
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
    </ModulePageShell>
  );
}
