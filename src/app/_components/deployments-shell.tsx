"use client";

import {
  ActivityIcon,
  BlocksIcon,
  BrainCircuitIcon,
  CpuIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PauseCircleIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { ProductAreaHeader } from "@/app/_components/product-area-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  defaultInferenceImage,
  inferenceDeploymentEngineLabels,
  inferenceDeploymentEngineValues,
  inferenceDeploymentStatusLabels,
} from "@/server/deployments/catalog";
import { api, type RouterOutputs } from "@/trpc/react";

type DeploymentRow = RouterOutputs["deployments"]["list"]["items"][number];
type DraftState = {
  name: string;
  engine: (typeof inferenceDeploymentEngineValues)[number];
  modelRef: string;
  image: string;
  cpu: string;
  memoryGi: string;
  gpuCount: string;
  replicaCount: string;
};

const defaultDraft: DraftState = {
  name: "",
  engine: "vllm",
  modelRef: "Qwen/Qwen3-8B-Instruct",
  image: defaultInferenceImage("vllm", 1),
  cpu: "8",
  memoryGi: "32",
  gpuCount: "1",
  replicaCount: "1",
};

function statusTone(status: DeploymentRow["status"]) {
  switch (status) {
    case "serving":
      return "bg-[#edf9f3] text-[#0f6a3c]";
    case "starting":
      return "bg-[#fff4dd] text-[#8b5b10]";
    case "draft":
      return "bg-[#fff1e8] text-[#9a4b19]";
    case "paused":
      return "bg-[#fff8dc] text-[#8a5c14]";
    case "failed":
      return "bg-[#fff1ef] text-[#a63f2b]";
    default:
      return "bg-[#f4f5f7] text-[#344054]";
  }
}

function Field(props: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-medium tracking-[0.18em] text-[#8d6453] uppercase">
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-xs text-[#8a6b5d]">{props.hint}</span>
      ) : null}
    </label>
  );
}

function MetricCard(props: {
  label: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="rounded-[26px] border border-[#ead8cd] bg-white/88 p-5 shadow-[0_18px_60px_rgba(92,57,44,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.24em] text-[#8f6656] uppercase">
            {props.label}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#221814]">
            {props.value}
          </p>
        </div>
        <div className="flex size-11 items-center justify-center rounded-[18px] bg-[#f8efe9] text-[#5d372a]">
          {props.icon}
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-[#6d5549]">{props.description}</p>
    </article>
  );
}

function resourceLabel(row: DeploymentRow) {
  return `${row.gpuCount} GPU · ${row.cpu} CPU · ${row.memory}`;
}

function nodeLabel(row: DeploymentRow) {
  return row.nodeNames.length > 0 ? row.nodeNames.join(", ") : "未调度";
}

export function DeploymentsShell() {
  const utils = api.useUtils();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [draft, setDraft] = useState<DraftState>(defaultDraft);

  const deploymentsQuery = api.deployments.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const createDeployment = api.deployments.create.useMutation({
    onSuccess: async (result) => {
      await utils.deployments.list.invalidate();
      setFeedback({ tone: "success", message: result.message });
      setDraft(defaultDraft);
      setIsCreateOpen(false);
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const startDeployment = api.deployments.start.useMutation({
    onSuccess: async (result) => {
      await utils.deployments.list.invalidate();
      setFeedback({ tone: "success", message: result.message });
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const stopDeployment = api.deployments.stop.useMutation({
    onSuccess: async (result) => {
      await utils.deployments.list.invalidate();
      setFeedback({ tone: "success", message: result.message });
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const deleteDeployment = api.deployments.delete.useMutation({
    onSuccess: async () => {
      await utils.deployments.list.invalidate();
      setFeedback({ tone: "success", message: "推理部署已删除。" });
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const rows = deploymentsQuery.data?.items ?? [];
  const available = deploymentsQuery.data?.available ?? true;
  const capabilityReason = deploymentsQuery.data?.reason ?? null;
  const servingCount = rows.filter((row) => row.status === "serving").length;
  const startingCount = rows.filter((row) => row.status === "starting").length;
  const pausedCount = rows.filter((row) => row.status === "paused").length;
  const activeGpuCount = rows
    .filter((row) => row.status === "serving" || row.status === "starting")
    .reduce((total, row) => total + row.gpuCount * row.desiredReplicas, 0);

  const parsedMemoryGi = Number.parseInt(draft.memoryGi, 10);
  const parsedGpuCount = Number.parseInt(draft.gpuCount, 10);
  const parsedReplicaCount = Number.parseInt(draft.replicaCount, 10);
  const engineNeedsGpu = draft.engine === "vllm" || draft.engine === "sglang";
  const canSubmit =
    draft.name.trim().length >= 2 &&
    draft.modelRef.trim().length >= 2 &&
    draft.image.trim().length >= 2 &&
    draft.cpu.trim().length >= 1 &&
    Number.isInteger(parsedMemoryGi) &&
    parsedMemoryGi > 0 &&
    Number.isInteger(parsedGpuCount) &&
    parsedGpuCount >= (engineNeedsGpu ? 1 : 0) &&
    parsedGpuCount <= 16 &&
    Number.isInteger(parsedReplicaCount) &&
    parsedReplicaCount >= 1 &&
    parsedReplicaCount <= 16;

  const handleCreate = async () => {
    await createDeployment.mutateAsync({
      name: draft.name.trim(),
      engine: draft.engine,
      modelRef: draft.modelRef.trim(),
      image: draft.image.trim(),
      cpu: draft.cpu.trim(),
      memoryGi: parsedMemoryGi,
      gpuCount: parsedGpuCount,
      replicaCount: parsedReplicaCount,
    });
  };

  const handleDelete = async (name: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`确认删除推理部署 ${name}？`);
      if (!confirmed) return;
    }

    await deleteDeployment.mutateAsync({ name });
  };

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(252,187,151,0.2),transparent_24%),linear-gradient(180deg,#fbf4ef_0%,#f4ede8_46%,#ece4dc_100%)] text-[#221814]">
      <div className="mx-auto max-w-[1520px] px-3 py-3 md:px-5 md:py-4">
        <ProductAreaHeader />

        <section className="mt-6 overflow-hidden rounded-[34px] border border-[#ead7cc] bg-[linear-gradient(135deg,#261813_0%,#3d241e_50%,#6f473a_100%)] text-[#fff3ec] shadow-[0_34px_120px_rgba(82,48,36,0.2)]">
          <div className="grid gap-8 px-6 py-7 md:px-8 md:py-9 xl:grid-cols-[minmax(0,1.04fr)_360px]">
            <div className="space-y-5">
              <Badge className="border-0 bg-white/10 text-white hover:bg-white/10">
                Kubernetes Inference
              </Badge>
              <div className="space-y-3">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.06em] md:text-5xl">
                  推理部署直接落到 K8s，支持 vLLM、llama.cpp 和 SGLang。
                </h1>
                <p className="max-w-3xl text-base leading-8 text-white/74">
                  控制面当前运行在 K8s master 节点上，所以入口统一经 master
                  的 NodePort 暴露；真正的推理 Pod 会优先调度到非 master 的
                  worker 节点，避免和 Web 抢资源。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  className="rounded-full bg-white px-5 text-[#2b1b16] hover:bg-[#fff4ef]"
                  disabled={!available}
                  onClick={() => setIsCreateOpen(true)}
                >
                  <PlusIcon data-icon="inline-start" />
                  创建推理部署
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="rounded-full border-white/20 bg-white/8 px-5 text-white hover:bg-white/12"
                  onClick={() => void deploymentsQuery.refetch()}
                >
                  <RefreshCwIcon
                    data-icon="inline-start"
                    className={
                      deploymentsQuery.isFetching ? "animate-spin" : undefined
                    }
                  />
                  刷新列表
                </Button>
              </div>
            </div>

            <div className="grid gap-4 self-stretch sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  K8s 连接
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">
                  {available ? "OK" : "DOWN"}
                </p>
                <p className="mt-2 text-sm text-white/62">
                  {available ? "控制面可直接访问集群" : "请先检查 master 上的 kubeconfig"}
                </p>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  服务中
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">
                  {servingCount}
                </p>
                <p className="mt-2 text-sm text-white/62">
                  在线承接流量的推理部署
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="部署总数"
            value={String(rows.length)}
            description="运行时列表直接来自当前集群中的 inference Deployment。"
            icon={<BlocksIcon className="size-5" />}
          />
          <MetricCard
            label="启动中"
            value={String(startingCount)}
            description="Pod 已提交到 K8s，但副本还没有全部 Ready。"
            icon={<ActivityIcon className="size-5" />}
          />
          <MetricCard
            label="已暂停"
            value={String(pausedCount)}
            description="Deployment 还在，但副本数已经缩到 0。"
            icon={<PauseCircleIcon className="size-5" />}
          />
          <MetricCard
            label="活跃 GPU"
            value={String(activeGpuCount)}
            description="按服务中和启动中的部署累计 GPU 配额。"
            icon={<CpuIcon className="size-5" />}
          />
        </section>

        <section className="mt-6 rounded-[32px] border border-[#ead8cd] bg-white/88 shadow-[0_24px_90px_rgba(92,57,44,0.08)]">
          <div className="flex flex-col gap-4 border-b border-[#eee0d7] px-5 py-5 md:flex-row md:items-center md:justify-between md:px-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 items-center justify-center rounded-[18px] bg-[#4a2c22] text-white">
                <BrainCircuitIcon className="size-5" />
              </div>
              <div>
                <p className="text-[11px] tracking-[0.3em] text-[#8f6656] uppercase">
                  Runtime List
                </p>
                <h2 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-[#221814]">
                  推理服务列表
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#6d5549]">
                  创建的是 K8s Deployment + NodePort Service，后续动作只有上线、暂停、删除。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge
                className={cn(
                  "border-0 hover:bg-inherit",
                  available
                    ? "bg-[#f7ece5] text-[#835646]"
                    : "bg-[#fff1f2] text-[#b42318]",
                )}
              >
                {available ? "K8s 已连接" : "K8s 不可用"}
              </Badge>
              <Badge className="border-0 bg-[#fbf3ec] text-[#a1684d] hover:bg-[#fbf3ec]">
                master 入口转发
              </Badge>
              <Button
                className="h-10 rounded-full bg-[#4a2c22] px-4 text-white hover:bg-[#391f18]"
                disabled={!available}
                onClick={() => setIsCreateOpen(true)}
              >
                <PlusIcon data-icon="inline-start" />
                创建推理部署
              </Button>
            </div>
          </div>

          {capabilityReason ? (
            <div className="border-b border-[#f0d8d8] bg-[#fff8f8] px-5 py-4 text-sm leading-6 text-[#8f2d2d] md:px-6">
              {capabilityReason}
            </div>
          ) : null}

          {feedback ? (
            <div
              className={cn(
                "border-b px-5 py-4 text-sm leading-6 md:px-6",
                feedback.tone === "success"
                  ? "border-[#eee0d7] bg-[#fbf5ef] text-[#59392d]"
                  : "border-[#f0d8d8] bg-[#fff8f8] text-[#8f2d2d]",
              )}
            >
              {feedback.message}
            </div>
          ) : null}

          <div className="px-5 py-5 md:px-6">
            <div className="hidden rounded-[20px] border border-[#eee4dd] bg-[#f9f3ee] px-4 py-3 text-[11px] font-medium tracking-[0.18em] text-[#8d6c5d] uppercase md:grid md:grid-cols-[minmax(0,1.15fr)_120px_minmax(0,1fr)_180px_minmax(0,1fr)_120px_220px] md:items-center md:gap-4">
              <span>部署</span>
              <span>状态</span>
              <span>Runtime / 模型</span>
              <span>资源 / 节点</span>
              <span>入口</span>
              <span>更新时间</span>
              <span>操作</span>
            </div>

            <div className="mt-3 space-y-3">
              {deploymentsQuery.isLoading ? (
                <div className="rounded-[24px] border border-[#ead8cd] bg-white px-4 py-8 text-center text-sm text-[#7d6559]">
                  <LoaderCircleIcon className="mx-auto mb-3 animate-spin" />
                  正在读取推理部署列表...
                </div>
              ) : null}

              {!deploymentsQuery.isLoading && rows.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[#ead8cd] bg-[#fbf6f2] px-4 py-8 text-center">
                  <p className="text-base font-medium text-[#221814]">
                    还没有推理部署
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#6d5549]">
                    先选择一个 runtime，把模型、镜像和资源规格沉淀成 K8s 部署。
                  </p>
                </div>
              ) : null}

              {rows.map((row) => {
                const isStarting =
                  startDeployment.isPending && startDeployment.variables?.name === row.name;
                const isStopping =
                  stopDeployment.isPending && stopDeployment.variables?.name === row.name;
                const isDeleting =
                  deleteDeployment.isPending && deleteDeployment.variables?.name === row.name;
                const canStart = ["draft", "paused", "failed"].includes(row.status);
                const canStop = ["serving", "starting"].includes(row.status);

                return (
                  <div
                    key={row.id}
                    className="rounded-[24px] border border-[#eee2da] bg-white px-4 py-4 shadow-[0_14px_40px_rgba(92,57,44,0.06)]"
                  >
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_120px_minmax(0,1fr)_180px_minmax(0,1fr)_120px_220px] md:items-center">
                      <div>
                        <p className="text-lg font-semibold tracking-[-0.03em] text-[#221814]">
                          {row.name}
                        </p>
                        <p className="mt-1 text-sm text-[#835646]">
                          {row.readyReplicas}/{row.desiredReplicas} Ready 副本
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] tracking-[0.22em] text-[#a08173] uppercase md:hidden">
                          状态
                        </p>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(row.status)}`}
                        >
                          {inferenceDeploymentStatusLabels[row.status]}
                        </span>
                      </div>

                      <div>
                        <p className="text-[11px] tracking-[0.22em] text-[#a08173] uppercase md:hidden">
                          Runtime / 模型
                        </p>
                        <p className="text-sm font-medium text-[#2d1c16]">
                          {inferenceDeploymentEngineLabels[row.engine]}
                        </p>
                        <p className="mt-1 break-all text-sm text-[#6d5549]">
                          {row.modelRef}
                        </p>
                        <p className="mt-1 break-all text-xs text-[#9b7d70]">
                          {row.image}
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] tracking-[0.22em] text-[#a08173] uppercase md:hidden">
                          资源 / 节点
                        </p>
                        <p className="text-sm font-medium text-[#2d1c16]">
                          {resourceLabel(row)}
                        </p>
                        <p className="mt-1 text-sm text-[#6d5549]">
                          {nodeLabel(row)}
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] tracking-[0.22em] text-[#a08173] uppercase md:hidden">
                          入口
                        </p>
                        <p className="text-sm font-medium text-[#2d1c16]">
                          {row.nodePort ? `:${row.nodePort}` : "-"}
                        </p>
                        <p className="mt-1 break-all text-sm text-[#6d5549]">
                          {row.endpoint ?? "-"}
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] tracking-[0.22em] text-[#a08173] uppercase md:hidden">
                          更新时间
                        </p>
                        <p className="text-sm font-medium text-[#2d1c16]">
                          {row.updatedAt ?? "-"}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {row.endpoint ? (
                          <a
                            href={row.endpoint}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                              buttonVariants({ variant: "outline" }),
                              "h-9 rounded-full border-[#e4d1c6] bg-[#fbf5ef] px-4 text-[#4a2c22] hover:bg-white",
                            )}
                          >
                            <GlobeIcon className="size-4" />
                            API
                          </a>
                        ) : (
                          <Button
                            variant="outline"
                            className="h-9 rounded-full border-[#e4d1c6] bg-[#fbf5ef] px-4 text-[#4a2c22] hover:bg-white"
                            disabled
                          >
                            API
                          </Button>
                        )}

                        {canStart ? (
                          <Button
                            variant="outline"
                            className="h-9 rounded-full border-[#d7e4d2] bg-[#f4fbf1] px-4 text-[#1f5f3a] hover:bg-white"
                            disabled={isStarting || isStopping || isDeleting}
                            onClick={() => void startDeployment.mutateAsync({ name: row.name })}
                          >
                            {isStarting ? (
                              <LoaderCircleIcon className="animate-spin" />
                            ) : (
                              <PlayIcon className="size-4" />
                            )}
                            上线
                          </Button>
                        ) : null}

                        {canStop ? (
                          <Button
                            variant="outline"
                            className="h-9 rounded-full border-[#e8dcc0] bg-[#fff7e9] px-4 text-[#8a5c14] hover:bg-white"
                            disabled={isStarting || isStopping || isDeleting}
                            onClick={() => void stopDeployment.mutateAsync({ name: row.name })}
                          >
                            {isStopping ? (
                              <LoaderCircleIcon className="animate-spin" />
                            ) : (
                              <PauseCircleIcon className="size-4" />
                            )}
                            暂停
                          </Button>
                        ) : null}

                        <Button
                          variant="outline"
                          className="h-9 rounded-full border-[#e7cfc7] bg-[#fff7f4] px-3 text-[#9b3d20] hover:bg-white"
                          disabled={isStarting || isStopping || isDeleting}
                          onClick={() => void handleDelete(row.name)}
                        >
                          {isDeleting ? (
                            <LoaderCircleIcon className="animate-spin" />
                          ) : (
                            <Trash2Icon className="size-4" />
                          )}
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-[760px] rounded-[30px] border border-[#eadcd2] bg-[#fdfaf7] p-0 text-[#221814]">
          <DialogHeader className="border-b border-[#eee1d8] px-6 py-5">
            <DialogTitle className="text-2xl tracking-[-0.04em] text-[#221814]">
              创建推理部署
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#7a6054]">
              运行时会部署成 K8s Deployment，创建后默认先停留在草稿状态，点击上线再扩成目标副本。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
              <Field label="部署名称">
                <Input
                  className="h-11 rounded-2xl border-[#e5d5ca] bg-white px-4"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例如：qwen3-chat-prod"
                />
              </Field>

              <Field label="Runtime">
                <Select
                  value={draft.engine}
                  onValueChange={(value) => {
                    if (!value) return;

                    setDraft((current) => ({
                      ...current,
                      engine: value,
                      image: defaultInferenceImage(
                        value,
                        Number.parseInt(current.gpuCount, 10) || 0,
                      ),
                    }));
                  }}
                >
                  <SelectTrigger className="h-11 w-full rounded-2xl border-[#e5d5ca] bg-white px-4">
                    <SelectValue placeholder="选择 runtime" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {inferenceDeploymentEngineValues.map((engine) => (
                        <SelectItem key={engine} value={engine}>
                          {inferenceDeploymentEngineLabels[engine]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Field
                label="模型引用"
                hint={
                  draft.engine === "llama.cpp"
                    ? "llama.cpp 建议填写 GGUF 文件路径；非绝对路径会自动映射到 /models 下。"
                    : "vLLM / SGLang 直接填写 Hugging Face 模型 ID 或本地模型路径。"
                }
              >
                <Input
                  className="h-11 rounded-2xl border-[#e5d5ca] bg-white px-4"
                  value={draft.modelRef}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      modelRef: event.target.value,
                    }))
                  }
                  placeholder={
                    draft.engine === "llama.cpp"
                      ? "llama-3.1-8b-instruct-q4_k_m.gguf"
                      : "Qwen/Qwen3-8B-Instruct"
                  }
                />
              </Field>

              <Field label="运行镜像">
                <Input
                  className="h-11 rounded-2xl border-[#e5d5ca] bg-white px-4"
                  value={draft.image}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      image: event.target.value,
                    }))
                  }
                  placeholder="vllm/vllm-openai:latest"
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Field label="CPU">
                <Input
                  className="h-11 rounded-2xl border-[#e5d5ca] bg-white px-4"
                  value={draft.cpu}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      cpu: event.target.value,
                    }))
                  }
                  placeholder="8"
                />
              </Field>

              <Field label="Memory Gi">
                <Input
                  type="number"
                  min={1}
                  max={2048}
                  className="h-11 rounded-2xl border-[#e5d5ca] bg-white px-4"
                  value={draft.memoryGi}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      memoryGi: event.target.value,
                    }))
                  }
                  placeholder="32"
                />
              </Field>

              <Field
                label="GPU"
                hint={engineNeedsGpu ? "当前 runtime 至少需要 1 GPU" : "llama.cpp 可选 CPU 模式"}
              >
                <Input
                  type="number"
                  min={engineNeedsGpu ? 1 : 0}
                  max={16}
                  className="h-11 rounded-2xl border-[#e5d5ca] bg-white px-4"
                  value={draft.gpuCount}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gpuCount: event.target.value,
                    }))
                  }
                  placeholder={engineNeedsGpu ? "1" : "0"}
                />
              </Field>

              <Field label="副本数">
                <Input
                  type="number"
                  min={1}
                  max={16}
                  className="h-11 rounded-2xl border-[#e5d5ca] bg-white px-4"
                  value={draft.replicaCount}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      replicaCount: event.target.value,
                    }))
                  }
                  placeholder="1"
                />
              </Field>
            </div>

            <Field label="调度说明">
              <Textarea
                className="min-h-24 resize-none rounded-2xl border-[#e5d5ca] bg-white px-4 py-3"
                value={`当前 Web 控制面位于 K8s master 节点，推理 Pod 会优先调度到非 master worker；服务入口统一走 master NodePort。`}
                readOnly
              />
            </Field>
          </div>

          <DialogFooter className="rounded-b-[30px] border-t border-[#eee1d8] bg-[#faf3ee] px-6 py-4">
            <Button
              variant="outline"
              className="rounded-full border-[#e0d0c5] bg-white px-4 text-[#4a2c22] hover:bg-white"
              onClick={() => setIsCreateOpen(false)}
            >
              取消
            </Button>
            <Button
              className="rounded-full bg-[#4a2c22] px-5 text-white hover:bg-[#391f18]"
              disabled={!canSubmit || createDeployment.isPending}
              onClick={() => void handleCreate()}
            >
              {createDeployment.isPending ? (
                <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              创建部署
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
