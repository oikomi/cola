"use client";

import {
  BrainCircuitIcon,
  CpuIcon,
  FolderGit2Icon,
  GaugeIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { ProductAreaHeader } from "@/app/_components/product-area-header";
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
import { Textarea } from "@/components/ui/textarea";
import {
  priorityLabels,
  priorityValues,
} from "@/server/office/catalog";
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
      return "bg-[#edf9f3] text-[#0f6a3c]";
    case "draft":
      return "bg-[#edf3ff] text-[#264f92]";
    case "stopped":
      return "bg-[#f4f5f7] text-[#344054]";
    case "completed":
      return "bg-[#edf8ff] text-[#1d5b83]";
    case "failed":
      return "bg-[#fff1ef] text-[#a63f2b]";
    default:
      return "bg-[#f4f5f7] text-[#344054]";
  }
}

function priorityTone(priority: keyof typeof priorityLabels) {
  switch (priority) {
    case "critical":
      return "text-[#a63f2b]";
    case "high":
      return "text-[#9a5a07]";
    case "medium":
      return "text-[#355b34]";
    case "low":
    default:
      return "text-[#61708a]";
  }
}

function Field(props: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-medium tracking-[0.18em] text-[#6d7c61] uppercase">
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-xs text-[#7c8b70]">{props.hint}</span>
      ) : null}
    </label>
  );
}

function MetricCard(props: {
  label: string;
  value: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <article className="rounded-[26px] border border-[#d8e4ca] bg-white/88 p-5 shadow-[0_18px_60px_rgba(74,101,54,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.24em] text-[#7b8d61] uppercase">
            {props.label}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#1f2616]">
            {props.value}
          </p>
        </div>
        <div className="flex size-11 items-center justify-center rounded-[18px] bg-[#eef5e4] text-[#2d4620]">
          {props.icon}
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-[#60704f]">{props.description}</p>
    </article>
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
  const failedCount = jobs.filter((job) => job.status === "failed").length;
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
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(183,216,148,0.24),transparent_24%),linear-gradient(180deg,#f6f8ef_0%,#eef3e6_46%,#e5ebdb_100%)] text-[#1f2616]">
      <div className="mx-auto max-w-[1520px] px-3 py-3 md:px-5 md:py-4">
        <ProductAreaHeader />

        <section className="mt-6 overflow-hidden rounded-[34px] border border-[#dbe5cb] bg-[linear-gradient(135deg,#23301a_0%,#324426_54%,#4f6942_100%)] text-[#f4f8ee] shadow-[0_34px_120px_rgba(64,86,46,0.2)]">
          <div className="grid gap-8 px-6 py-7 md:px-8 md:py-9 xl:grid-cols-[minmax(0,1.04fr)_360px]">
            <div className="space-y-5">
              <Badge className="border-0 bg-white/10 text-white hover:bg-white/10">
                Training Platform
              </Badge>
              <div className="space-y-3">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.06em] md:text-5xl">
                  训练任务现在就是一张清晰的列表，不再挂在 Office 卡片里。
                </h1>
                <p className="max-w-3xl text-base leading-8 text-white/74">
                  当前页直接管理训练任务的创建、启动、停止和删除，先把调度入口拉平。
                  后面再把真实的 queue、日志和 checkpoint 编排接进来。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  className="rounded-full bg-white px-5 text-[#23301a] hover:bg-[#f3f7ec]"
                  onClick={() => setIsCreateOpen(true)}
                >
                  <PlusIcon data-icon="inline-start" />
                  创建训练任务
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="rounded-full border-white/20 bg-white/8 px-5 text-white hover:bg-white/12"
                  onClick={() => void jobsQuery.refetch()}
                >
                  <RefreshCwIcon
                    data-icon="inline-start"
                    className={jobsQuery.isFetching ? "animate-spin" : undefined}
                  />
                  刷新列表
                </Button>
              </div>
            </div>

            <div className="grid gap-4 self-stretch sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  当前运行
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">
                  {runningCount}
                </p>
                <p className="mt-2 text-sm text-white/62">正在占用 GPU 的训练任务</p>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  GPU 占用
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">
                  {activeGpuCount}
                </p>
                <p className="mt-2 text-sm text-white/62">按运行中任务累计</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="任务总数"
            value={String(jobs.length)}
            description="所有训练任务都会集中在这一张列表里。"
            icon={<BrainCircuitIcon className="size-5" />}
          />
          <MetricCard
            label="运行中"
            value={String(runningCount)}
            description="启动后会直接切到运行中，方便先把操作面跑通。"
            icon={<GaugeIcon className="size-5" />}
          />
          <MetricCard
            label="草稿"
            value={String(draftCount)}
            description="还没启动的配置会保留在草稿状态。"
            icon={<FolderGit2Icon className="size-5" />}
          />
          <MetricCard
            label="失败"
            value={String(failedCount)}
            description="失败任务可以后续继续扩展成重试和日志排查入口。"
            icon={<CpuIcon className="size-5" />}
          />
        </section>

        <section className="mt-6 rounded-[32px] border border-[#d8e4ca] bg-white/88 shadow-[0_24px_90px_rgba(74,101,54,0.12)]">
          <div className="flex flex-col gap-4 border-b border-[#e2ebd6] px-5 py-5 md:flex-row md:items-center md:justify-between md:px-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 items-center justify-center rounded-[18px] bg-[#22301b] text-white">
                <BrainCircuitIcon className="size-5" />
              </div>
              <div>
                <p className="text-[11px] tracking-[0.3em] text-[#738564] uppercase">
                  Training Jobs
                </p>
                <h2 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-[#1a2413]">
                  训练任务列表
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#61704f]">
                  先提供最直接的操作面：创建、启动、停止、删除。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge className="border-0 bg-[#edf5e3] text-[#35552a] hover:bg-[#edf5e3]">
                简化调度面
              </Badge>
              <Button
                className="h-10 rounded-full bg-[#22301b] px-4 text-white hover:bg-[#162013]"
                onClick={() => setIsCreateOpen(true)}
              >
                <PlusIcon data-icon="inline-start" />
                创建训练任务
              </Button>
            </div>
          </div>

          {feedback ? (
            <div
              className={`mx-5 mt-5 rounded-[20px] border px-4 py-3 text-sm md:mx-6 ${
                feedback.tone === "success"
                  ? "border-[#cfe2bd] bg-[#f3f9ec] text-[#365028]"
                  : "border-[#efd0cb] bg-[#fff5f3] text-[#9b3d20]"
              }`}
            >
              {feedback.message}
            </div>
          ) : null}

          <div className="px-5 py-5 md:px-6">
            <div className="hidden rounded-[20px] border border-[#e7eedf] bg-[#f6faef] px-4 py-3 text-[11px] font-medium tracking-[0.18em] text-[#718161] uppercase md:grid md:grid-cols-[minmax(0,1.25fr)_120px_minmax(0,1fr)_130px_130px_220px] md:items-center md:gap-4">
              <span>任务</span>
              <span>状态</span>
              <span>模型 / 数据集</span>
              <span>资源</span>
              <span>时间</span>
              <span>操作</span>
            </div>

            {jobsQuery.isLoading ? (
              <div className="py-16 text-center text-sm text-[#667553]">
                正在加载训练任务列表...
              </div>
            ) : jobsQuery.error ? (
              <div className="py-16 text-center text-sm text-[#9b3d20]">
                {jobsQuery.error.message}
              </div>
            ) : jobs.length === 0 ? (
              <div className="mt-3 rounded-[28px] border border-dashed border-[#d8e4ca] bg-[#f7fbf1] px-6 py-12 text-center">
                <p className="text-lg font-semibold tracking-[-0.03em] text-[#1f2616]">
                  还没有训练任务
                </p>
                <p className="mt-2 text-sm leading-6 text-[#667553]">
                  先创建一个任务，把模型、数据集和 GPU 配额记录进去。
                </p>
                <div className="mt-5">
                  <Button
                    className="rounded-full bg-[#22301b] px-4 text-white hover:bg-[#162013]"
                    onClick={() => setIsCreateOpen(true)}
                  >
                    <PlusIcon data-icon="inline-start" />
                    创建第一个任务
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {jobs.map((job) => {
                  const isStarting =
                    startJob.isPending && startJob.variables?.jobId === job.id;
                  const isStopping =
                    stopJob.isPending && stopJob.variables?.jobId === job.id;
                  const isDeleting =
                    deleteJob.isPending && deleteJob.variables?.jobId === job.id;
                  const canStart = ["draft", "stopped", "failed"].includes(job.status);

                  return (
                    <div
                      key={job.id}
                      className="rounded-[24px] border border-[#e3ebd8] bg-white px-4 py-4 shadow-[0_14px_40px_rgba(72,101,54,0.06)]"
                    >
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1.25fr)_120px_minmax(0,1fr)_130px_130px_220px] md:items-center">
                        <div>
                          <p className="text-lg font-semibold tracking-[-0.03em] text-[#15210f]">
                            {job.title}
                          </p>
                          <p className="mt-1 text-sm text-[#365028]">
                            {trainingJobTypeLabels[job.jobType]}
                            {" · "}
                            <span className={priorityTone(job.priority)}>
                              {priorityLabels[job.priority]}优先级
                            </span>
                          </p>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#62714f]">
                            {job.objective}
                          </p>
                        </div>

                        <div>
                          <p className="text-[11px] tracking-[0.22em] text-[#8da07e] uppercase md:hidden">
                            状态
                          </p>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(job.status)}`}
                          >
                            {trainingJobStatusLabels[job.status]}
                          </span>
                        </div>

                        <div>
                          <p className="text-[11px] tracking-[0.22em] text-[#8da07e] uppercase md:hidden">
                            模型 / 数据集
                          </p>
                          <p className="text-sm font-medium text-[#203017]">
                            {job.baseModel}
                          </p>
                          <p className="mt-1 text-sm text-[#62714f]">
                            {job.datasetName}
                          </p>
                        </div>

                        <div>
                          <p className="text-[11px] tracking-[0.22em] text-[#8da07e] uppercase md:hidden">
                            资源
                          </p>
                          <p className="text-sm font-medium text-[#203017]">
                            {job.gpuCount} GPU
                          </p>
                        </div>

                        <div>
                          <p className="text-[11px] tracking-[0.22em] text-[#8da07e] uppercase md:hidden">
                            时间
                          </p>
                          <p className="text-sm font-medium text-[#203017]">
                            {formatTime(job.updatedAt ?? job.createdAt)}
                          </p>
                          <p className="mt-1 text-sm text-[#62714f]">
                            启动: {formatTime(job.startedAt)}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {canStart ? (
                            <Button
                              variant="outline"
                              className="h-9 rounded-full border-[#c9d8b7] bg-[#f4f8ee] px-4 text-[#22301b] hover:bg-white"
                              disabled={isStarting || isStopping || isDeleting}
                              onClick={() => startJob.mutate({ jobId: job.id })}
                            >
                              <PlayIcon className="size-4" />
                              {isStarting ? "启动中" : "启动"}
                            </Button>
                          ) : null}

                          {job.status === "running" ? (
                            <Button
                              variant="outline"
                              className="h-9 rounded-full border-[#d7cfbe] bg-[#fbf7ef] px-4 text-[#6b4b18] hover:bg-white"
                              disabled={isStarting || isStopping || isDeleting}
                              onClick={() => stopJob.mutate({ jobId: job.id })}
                            >
                              <SquareIcon className="size-4" />
                              {isStopping ? "停止中" : "停止"}
                            </Button>
                          ) : null}

                          <Button
                            variant="outline"
                            className="h-9 rounded-full border-[#e7cfc7] bg-[#fff7f4] px-3 text-[#9b3d20] hover:bg-white"
                            disabled={
                              job.status === "running" ||
                              isStarting ||
                              isStopping ||
                              isDeleting
                            }
                            onClick={() => {
                              if (
                                !window.confirm(`确认删除训练任务「${job.title}」吗？`)
                              ) {
                                return;
                              }

                              deleteJob.mutate({ jobId: job.id });
                            }}
                          >
                            <Trash2Icon className="size-4" />
                            {isDeleting ? "删除中" : "删除"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-[720px] rounded-[30px] border border-[#dfe8d4] bg-[#fbfdf8] p-0 text-[#1f2616]">
          <DialogHeader className="border-b border-[#e7eedf] px-6 py-5">
            <DialogTitle className="text-2xl tracking-[-0.04em] text-[#1a2413]">
              创建训练任务
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#667553]">
              先把训练配置作为任务实体沉淀下来，后面再接实际队列和执行器。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5">
            <Field label="任务标题">
              <Input
                className="h-11 rounded-2xl border-[#d5e1c8] bg-white px-4"
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
                className="min-h-28 resize-none rounded-2xl border-[#d5e1c8] bg-white px-4 py-3"
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
                  <SelectTrigger className="h-11 w-full rounded-2xl border-[#d5e1c8] bg-white px-4">
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
                  <SelectTrigger className="h-11 w-full rounded-2xl border-[#d5e1c8] bg-white px-4">
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
                  className="h-11 rounded-2xl border-[#d5e1c8] bg-white px-4"
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
                  className="h-11 rounded-2xl border-[#d5e1c8] bg-white px-4"
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
                  className="h-11 rounded-2xl border-[#d5e1c8] bg-white px-4"
                  value={draft.datasetName}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      datasetName: event.target.value,
                    }))
                  }
                  placeholder="customer-support-v4"
                />
              </Field>
            </div>
          </div>

          <DialogFooter className="rounded-b-[30px] border-t border-[#e7eedf] bg-[#f6faef] px-6 py-4">
            <Button
              variant="outline"
              className="rounded-full border-[#d1ddc3] bg-white px-4 text-[#294021] hover:bg-white"
              onClick={() => setIsCreateOpen(false)}
            >
              取消
            </Button>
            <Button
              className="rounded-full bg-[#22301b] px-5 text-white hover:bg-[#162013]"
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
              <PlusIcon data-icon="inline-start" />
              {createJob.isPending ? "创建中" : "创建任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
