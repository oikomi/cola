"use client";

import {
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

const defaultDraft = {
  title: "",
  objective: "",
  jobType: "sft" as const,
  priority: "medium" as (typeof priorityValues)[number],
  baseModel: "Qwen/Qwen3-8B",
  datasetName: "",
  gpuCount: "1",
};

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

function Field(props: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-xs text-muted-foreground">{props.hint}</span>
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
          className="rounded-3xl border border-border/70 bg-background/70 p-4"
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
  const completedCount = jobs.filter((job) => job.status === "completed").length;
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

  return (
    <ModulePageShell>
      <ProductAreaHeader />

      <ModuleHero
        eyebrow="Training Jobs"
        title="训练平台"
        description="把训练任务、基础模型、数据集和 GPU 配额统一收口到一张作业表里，直接面向 Kubernetes Job 执行。"
        icon={BrainCircuitIcon}
        badges={
          <Badge variant="outline" className="border-border/80 bg-background/60">
            Unsloth / Kubernetes
          </Badge>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="lg"
              className="rounded-full"
              onClick={() => void jobsQuery.refetch()}
            >
              <RefreshCwIcon
                className={cn(jobsQuery.isFetching ? "animate-spin" : undefined)}
                data-icon="inline-start"
              />
              刷新列表
            </Button>
            <Button size="lg" className="rounded-full" onClick={() => setIsCreateOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              创建训练任务
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ModuleMetricCard
            label="任务总数"
            value={String(jobs.length)}
            description="当前训练控制面中记录的全部任务。"
            icon={BrainCircuitIcon}
          />
          <ModuleMetricCard
            label="运行中"
            value={String(runningCount)}
            description="已经提交并正在实际执行的训练作业。"
            icon={PlayIcon}
          />
          <ModuleMetricCard
            label="草稿"
            value={String(draftCount)}
            description="参数已配置但还未开始执行的任务。"
            icon={SquareIcon}
          />
          <ModuleMetricCard
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
        <Alert variant={feedback.tone === "success" ? "default" : "destructive"}>
          <AlertTitle>{feedback.tone === "success" ? "操作完成" : "操作失败"}</AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <ModuleSection
        title="任务列表"
        description="查看运行态、优先级、数据集和动作入口。错误信息会直接内嵌在任务行里。"
        action={
          <Badge variant="outline" className="border-border/80 bg-background/60">
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
                          <p className="font-medium text-foreground">{job.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {trainingJobTypeLabels[job.jobType]} ·{" "}
                            <span className={priorityTone(job.priority)}>
                              {priorityLabels[job.priority]}优先级
                            </span>
                          </p>
                        </div>
                        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {job.objective}
                        </p>
                        {job.runtimeJobName ? (
                          <p className="text-xs leading-5 text-muted-foreground">
                            K8s Job: {job.runtimeNamespace ?? "default"}/
                            {job.runtimeJobName}
                          </p>
                        ) : null}
                        {job.artifactPath ? (
                          <p className="text-xs leading-5 text-muted-foreground">
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
                        <span className="font-medium text-foreground">
                          {job.baseModel}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {job.datasetName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top font-medium text-foreground">
                      {job.gpuCount} GPU
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="font-medium text-foreground">
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
                            if (!window.confirm(`确认删除训练任务「${job.title}」吗？`)) {
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
        <DialogContent className="max-w-[720px] border-border/70 bg-background/95 p-0 backdrop-blur-xl text-foreground">
          <DialogHeader className="border-b border-border/70 px-6 py-5">
            <DialogTitle className="text-2xl tracking-[-0.04em]">
              创建训练任务
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
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
              <Field label="基础模型">
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

              <Field label="数据集">
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

          <DialogFooter className="border-t border-border/70 bg-muted/30 px-6 py-4">
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
