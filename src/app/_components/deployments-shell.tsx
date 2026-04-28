"use client";

import {
  BlocksIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PauseCircleIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  ModuleEmptyState,
  ModuleHero,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatGpuAllocationLabel,
  gpuAllocationModeLabels,
  gpuAllocationModeValues,
} from "@/lib/gpu-allocation";
import { cn, optionLabel } from "@/lib/utils";
import {
  creatableInferenceDeploymentEngineValues,
  defaultInferenceImage,
  inferenceDeploymentEngineLabels,
  inferenceDeploymentStatusLabels,
  isValidInferenceModelRef,
  llamaCppModelRefExample,
  llamaCppModelRoot,
  llamaCppRemoteModelRefExample,
} from "@/server/deployments/catalog";
import { api, type RouterOutputs } from "@/trpc/react";

type DeploymentRow = RouterOutputs["deployments"]["list"]["items"][number];
type DraftState = {
  name: string;
  engine: (typeof creatableInferenceDeploymentEngineValues)[number];
  modelRef: string;
  image: string;
  cpu: string;
  memoryGi: string;
  gpuAllocationMode: (typeof gpuAllocationModeValues)[number];
  gpuCount: string;
  gpuMemoryGi: string;
  replicaCount: string;
};

const defaultDraft: DraftState = {
  name: "",
  engine: "vllm",
  modelRef: "Qwen/Qwen3-8B-Instruct",
  image: defaultInferenceImage("vllm", 1),
  cpu: "8",
  memoryGi: "32",
  gpuAllocationMode: "whole",
  gpuCount: "1",
  gpuMemoryGi: "",
  replicaCount: "1",
};

function modelRefHint(engine: DraftState["engine"]) {
  switch (engine) {
    case "llama.cpp":
      return `支持 ${llamaCppModelRoot} 下的本地 GGUF，或可直接下载的 GGUF 来源，例如 ${llamaCppModelRefExample}、${llamaCppRemoteModelRefExample}。`;
    case "vllm":
    case "sglang":
      return "仅支持 Hugging Face 模型 ID，例如 Qwen/Qwen3-8B-Instruct。";
    default:
      return "输入模型引用。";
  }
}

function modelRefPlaceholder(engine: DraftState["engine"]) {
  switch (engine) {
    case "llama.cpp":
      return llamaCppRemoteModelRefExample;
    case "vllm":
    case "sglang":
      return "Qwen/Qwen3-8B-Instruct";
    default:
      return "输入模型引用";
  }
}

function modelRefValidationLabel(engine: DraftState["engine"], valid: boolean) {
  if (valid) return "模型引用格式正确";

  switch (engine) {
    case "llama.cpp":
      return "请输入合法的本地 GGUF 路径、hf:// 文件引用或 https:// GGUF 地址";
    case "vllm":
    case "sglang":
      return "请输入合法的 Hugging Face 模型 ID";
    default:
      return "请输入合法的模型引用";
  }
}

function runtimeDialogDescription(engine: DraftState["engine"]) {
  switch (engine) {
    case "llama.cpp":
      return `llama.cpp 既支持 ${llamaCppModelRoot} 下的本地 GGUF，也支持启动前自动下载远端 GGUF。创建后会先保存为草稿，点击上线时再拉起 Pod。`;
    case "vllm":
    case "sglang":
      return "当前运行时使用 Hugging Face 模型引用。创建后会先保存为草稿，确认配置无误后再点击上线扩到目标副本。";
    default:
      return "创建后会先保存为草稿，确认配置无误后再点击上线扩到目标副本。";
  }
}

function gpuMinimum(
  engine: DraftState["engine"],
  gpuAllocationMode: DraftState["gpuAllocationMode"],
) {
  return engine === "llama.cpp" && gpuAllocationMode === "whole" ? 0 : 1;
}

function gpuRequirementCopy(
  engine: DraftState["engine"],
  gpuAllocationMode: DraftState["gpuAllocationMode"],
) {
  if (gpuAllocationMode === "memory") {
    return "显存模式会通过 HAMi 按 GPU 份额申请资源。数量表示每个 Pod 需要的 GPU 份额数，显存表示每个份额的显存上限。";
  }

  if (engine === "llama.cpp") {
    return "llama.cpp 支持 CPU-only 或 GPU 模式。GPU 填 0 表示只用 CPU，填大于 0 时会切换到 CUDA 镜像并申请对应 GPU。";
  }

  return "当前运行时至少需要 1 张 GPU。创建完成后会先保留为草稿，再由你确认是否扩到目标副本。";
}

function statusTone(status: DeploymentRow["status"]) {
  switch (status) {
    case "serving":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "starting":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "draft":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "paused":
      return "border-stone-200 bg-stone-100 text-stone-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function Field(props: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  const isAsciiLabel = /^[\x00-\x7F\s()/+.-]+$/.test(props.label);

  return (
    <label className={cn("grid gap-2", props.className)}>
      <span
        className={cn(
          "text-[11px] font-medium text-slate-500",
          isAsciiLabel ? "tracking-[0.08em]" : "tracking-[0.04em]",
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
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[24px] border border-slate-200/85 bg-white p-4 shadow-[0_14px_28px_rgba(15,23,42,0.03)] md:p-5",
        props.className,
      )}
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-[-0.03em] text-slate-950">
          {props.title}
        </h3>
        {props.description ? (
          <p className="text-sm leading-5 text-slate-600">
            {props.description}
          </p>
        ) : null}
      </div>
      <div className={cn("mt-4 grid gap-3.5", props.contentClassName)}>
        {props.children}
      </div>
    </section>
  );
}

function resourceLabel(row: DeploymentRow) {
  return `${formatGpuAllocationLabel({
    gpuAllocationMode: row.gpuAllocationMode,
    gpuCount: row.gpuCount,
    gpuMemoryGi: row.gpuMemoryGi,
  })} · ${row.cpu} CPU · ${row.memory}`;
}

function nodeLabel(row: DeploymentRow) {
  return row.nodeNames.length > 0 ? row.nodeNames.join(", ") : "未调度";
}

function DeploymentActionButtons(props: {
  row: DeploymentRow;
  canOpenApi: boolean;
  canStart: boolean;
  canStop: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isDeleting: boolean;
  align?: "start" | "end";
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2",
        props.align === "end" ? "justify-end" : "justify-start",
      )}
    >
      {props.canOpenApi ? (
        <a
          href={props.row.endpoint!}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: "outline" }), "rounded-full")}
        >
          <GlobeIcon data-icon="inline-start" />
          API
        </a>
      ) : (
        <Button variant="outline" className="rounded-full" disabled>
          API
        </Button>
      )}

      {props.canStart ? (
        <Button
          variant="outline"
          className="rounded-full"
          disabled={props.isStarting || props.isStopping || props.isDeleting}
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
          上线
        </Button>
      ) : null}

      {props.canStop ? (
        <Button
          variant="outline"
          className="rounded-full"
          disabled={props.isStarting || props.isStopping || props.isDeleting}
          onClick={props.onStop}
        >
          {props.isStopping ? (
            <LoaderCircleIcon
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : (
            <PauseCircleIcon data-icon="inline-start" />
          )}
          暂停
        </Button>
      ) : null}

      <Button
        variant="destructive"
        className="rounded-full"
        disabled={props.isStarting || props.isStopping || props.isDeleting}
        onClick={props.onDelete}
      >
        {props.isDeleting ? (
          <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
        ) : (
          <Trash2Icon data-icon="inline-start" />
        )}
        删除
      </Button>
    </div>
  );
}

function DeploymentCard(props: {
  row: DeploymentRow;
  canOpenApi: boolean;
  canStart: boolean;
  canStop: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isDeleting: boolean;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-[28px] border border-slate-200/90 bg-slate-50/80 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.035)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-[-0.03em] text-slate-950">
            {props.row.name}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            {props.row.readyReplicas}/{props.row.desiredReplicas} Ready 副本
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn("rounded-full", statusTone(props.row.status))}
        >
          {inferenceDeploymentStatusLabels[props.row.status]}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-3">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
            Runtime / 模型
          </p>
          <p className="mt-2 font-medium text-slate-900">
            {inferenceDeploymentEngineLabels[props.row.engine]}
          </p>
          <p className="mt-1 text-sm leading-6 break-all text-slate-600">
            {props.row.modelRef}
          </p>
          <p className="mt-1 text-xs leading-5 break-all text-slate-500">
            {props.row.image}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-3">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
            资源 / 节点
          </p>
          <p className="mt-2 font-medium text-slate-900">
            {resourceLabel(props.row)}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {nodeLabel(props.row)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-3 sm:col-span-2">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
            入口 / 更新时间
          </p>
          <p className="mt-2 font-medium text-slate-900">
            {props.row.nodePort ? `:${props.row.nodePort}` : "-"}
          </p>
          <p className="mt-1 text-sm leading-6 break-all text-slate-600">
            {props.row.endpoint ?? "-"}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            最近更新时间 {props.row.updatedAt ?? "-"}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-200/80 pt-4">
        <DeploymentActionButtons
          row={props.row}
          canOpenApi={props.canOpenApi}
          canStart={props.canStart}
          canStop={props.canStop}
          isStarting={props.isStarting}
          isStopping={props.isStopping}
          isDeleting={props.isDeleting}
          onStart={props.onStart}
          onStop={props.onStop}
          onDelete={props.onDelete}
        />
      </div>
    </article>
  );
}

function LoadingRows() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`deployment-skeleton-${index}`}
          className="border-border/70 bg-background/70 rounded-3xl border p-4"
        >
          <div className="grid gap-3 2xl:grid-cols-[1.2fr_110px_1fr_180px_1fr_140px_260px] 2xl:items-center">
            <div className="grid gap-2">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
            <div className="grid gap-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="grid gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="grid gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-5 w-24" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-16 rounded-full" />
              <Skeleton className="h-9 w-16 rounded-full" />
              <Skeleton className="h-9 w-16 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DeploymentsShell() {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [draft, setDraft] = useState<DraftState>(defaultDraft);

  const deploymentsQuery = api.deployments.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
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
  const activeGpuMemoryGi = rows
    .filter(
      (row) =>
        (row.status === "serving" || row.status === "starting") &&
        row.gpuAllocationMode === "memory" &&
        Boolean(row.gpuMemoryGi),
    )
    .reduce(
      (total, row) =>
        total + row.desiredReplicas * row.gpuCount * (row.gpuMemoryGi ?? 0),
      0,
    );

  const parsedMemoryGi = Number.parseInt(draft.memoryGi, 10);
  const parsedGpuMemoryGi = Number.parseInt(draft.gpuMemoryGi, 10);
  const parsedGpuCount = Number.parseInt(draft.gpuCount, 10);
  const parsedReplicaCount = Number.parseInt(draft.replicaCount, 10);
  const trimmedModelRef = draft.modelRef.trim();
  const trimmedImage = draft.image.trim();
  const modelRefValid = isValidInferenceModelRef(draft.engine, trimmedModelRef);
  const minGpuCount = gpuMinimum(draft.engine, draft.gpuAllocationMode);
  const effectiveGpuCount =
    Number.isInteger(parsedGpuCount) && parsedGpuCount >= 0
      ? parsedGpuCount
      : minGpuCount;
  const gpuCountValid =
    Number.isInteger(parsedGpuCount) &&
    parsedGpuCount >= minGpuCount &&
    parsedGpuCount <= 16;
  const gpuMemoryValid =
    draft.gpuAllocationMode !== "memory" ||
    (Number.isInteger(parsedGpuMemoryGi) &&
      parsedGpuMemoryGi >= 1 &&
      parsedGpuMemoryGi <= 1024);
  const defaultImageForDraft = defaultInferenceImage(
    draft.engine,
    effectiveGpuCount,
  );
  const canSubmit =
    draft.name.trim().length >= 2 &&
    modelRefValid &&
    trimmedImage.length >= 2 &&
    draft.cpu.trim().length >= 1 &&
    Number.isInteger(parsedMemoryGi) &&
    parsedMemoryGi > 0 &&
    gpuCountValid &&
    gpuMemoryValid &&
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
      gpuAllocationMode: draft.gpuAllocationMode,
      gpuCount: parsedGpuCount,
      gpuMemoryGi:
        draft.gpuAllocationMode === "memory" ? parsedGpuMemoryGi : null,
      replicaCount: parsedReplicaCount,
    });
  };

  const handleDelete = async (name: string) => {
    const confirmed = await confirm({
      title: `确认删除推理部署 ${name}？`,
      description: "删除后会同步清理对应的服务入口和运行资源，且不能自动恢复。",
      confirmLabel: "删除部署",
    });
    if (!confirmed) return;

    await deleteDeployment.mutateAsync({ name });
  };

  return (
    <ModulePageShell>
      <ModuleHero
        eyebrow="Inference Ops"
        title="推理部署"
        description="管理基于 Hugging Face 模型 ID 的 vLLM / SGLang，以及支持本地或直链 GGUF 的 llama.cpp 运行时，集中查看入口、资源和服务状态。"
        icon={BlocksIcon}
        size="compact"
        density="dense"
        badges={
          <>
            <Badge
              variant="outline"
              className={cn(
                available
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700",
              )}
            >
              {available ? "K8s 已连接" : "K8s 不可用"}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/60"
            >
              Master NodePort
            </Badge>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/60"
            >
              部署 {rows.length}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/60"
            >
              服务中 {servingCount}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/60"
            >
              启动中 {startingCount}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/60"
            >
              活跃 GPU {activeGpuCount}
            </Badge>
            {activeGpuMemoryGi > 0 ? (
              <Badge
                variant="outline"
                className="border-border/80 bg-background/60"
              >
                活跃显存 {activeGpuMemoryGi} Gi
              </Badge>
            ) : null}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => void deploymentsQuery.refetch()}
            >
              <RefreshCwIcon
                className={cn(
                  deploymentsQuery.isFetching ? "animate-spin" : undefined,
                )}
                data-icon="inline-start"
              />
              刷新列表
            </Button>
            <Button
              size="sm"
              className="rounded-full"
              disabled={!available}
              onClick={() => setIsCreateOpen(true)}
            >
              <PlusIcon data-icon="inline-start" />
              创建推理部署
            </Button>
          </div>
        }
      />

      {capabilityReason ? (
        <Alert variant="destructive">
          <AlertTitle>Kubernetes 访问异常</AlertTitle>
          <AlertDescription>{capabilityReason}</AlertDescription>
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
        title="运行时列表"
        action={
          <Badge
            variant="outline"
            className="border-border/80 bg-background/60 h-8 rounded-full px-3 text-[13px]"
          >
            已暂停 {pausedCount}
          </Badge>
        }
      >
        {deploymentsQuery.isLoading ? <LoadingRows /> : null}

        {!deploymentsQuery.isLoading && rows.length === 0 ? (
          <ModuleEmptyState
            title="还没有推理部署"
            description="先选择一个 runtime，把模型引用、镜像和资源规格固化成可上线的 K8s 部署。"
            action={
              <Button
                disabled={!available}
                onClick={() => setIsCreateOpen(true)}
              >
                <PlusIcon data-icon="inline-start" />
                创建第一个部署
              </Button>
            }
          />
        ) : null}

        {!deploymentsQuery.isLoading && rows.length > 0 ? (
          <>
            <div className="grid gap-3 2xl:hidden">
              {rows.map((row) => {
                const isStarting =
                  startDeployment.isPending &&
                  startDeployment.variables?.name === row.name;
                const isStopping =
                  stopDeployment.isPending &&
                  stopDeployment.variables?.name === row.name;
                const isDeleting =
                  deleteDeployment.isPending &&
                  deleteDeployment.variables?.name === row.name;
                const canStart = ["draft", "paused", "failed"].includes(
                  row.status,
                );
                const canStop = ["serving", "starting", "failed"].includes(
                  row.status,
                );
                const canOpenApi =
                  row.status === "serving" && Boolean(row.endpoint);

                return (
                  <DeploymentCard
                    key={row.id}
                    row={row}
                    canOpenApi={canOpenApi}
                    canStart={canStart}
                    canStop={canStop}
                    isStarting={isStarting}
                    isStopping={isStopping}
                    isDeleting={isDeleting}
                    onStart={() =>
                      void startDeployment.mutateAsync({ name: row.name })
                    }
                    onStop={() =>
                      void stopDeployment.mutateAsync({ name: row.name })
                    }
                    onDelete={() => void handleDelete(row.name)}
                  />
                );
              })}
            </div>

            <div className="hidden 2xl:block">
              <Table className="min-w-[1080px] table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[145px]">部署</TableHead>
                    <TableHead className="w-[95px]">状态</TableHead>
                    <TableHead className="w-[300px]">Runtime / 模型</TableHead>
                    <TableHead className="w-[190px]">资源 / 节点</TableHead>
                    <TableHead className="w-[160px]">入口</TableHead>
                    <TableHead className="w-[110px]">更新时间</TableHead>
                    <TableHead className="w-[160px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const isStarting =
                      startDeployment.isPending &&
                      startDeployment.variables?.name === row.name;
                    const isStopping =
                      stopDeployment.isPending &&
                      stopDeployment.variables?.name === row.name;
                    const isDeleting =
                      deleteDeployment.isPending &&
                      deleteDeployment.variables?.name === row.name;
                    const canStart = ["draft", "paused", "failed"].includes(
                      row.status,
                    );
                    const canStop = ["serving", "starting", "failed"].includes(
                      row.status,
                    );
                    const canOpenApi =
                      row.status === "serving" && Boolean(row.endpoint);

                    return (
                      <TableRow key={row.id} className="border-border/70">
                        <TableCell className="align-top whitespace-normal">
                          <div className="flex min-w-0 flex-col gap-1">
                            <p className="text-foreground font-medium">
                              {row.name}
                            </p>
                            <p className="text-muted-foreground text-sm">
                              {row.readyReplicas}/{row.desiredReplicas} Ready
                              副本
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full",
                              statusTone(row.status),
                            )}
                          >
                            {inferenceDeploymentStatusLabels[row.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="text-foreground font-medium">
                              {inferenceDeploymentEngineLabels[row.engine]}
                            </span>
                            <span className="text-muted-foreground text-sm leading-5 break-all">
                              {row.modelRef}
                            </span>
                            <span className="text-muted-foreground/85 text-xs leading-5 break-all">
                              {row.image}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="text-foreground leading-5 font-medium">
                              {resourceLabel(row)}
                            </span>
                            <span className="text-muted-foreground text-sm leading-5 break-all">
                              {nodeLabel(row)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="text-foreground font-medium">
                              {row.nodePort ? `:${row.nodePort}` : "-"}
                            </span>
                            <span className="text-muted-foreground text-sm leading-5 break-all">
                              {row.endpoint ?? "-"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground align-top whitespace-normal">
                          {row.updatedAt ?? "-"}
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          <DeploymentActionButtons
                            row={row}
                            canOpenApi={canOpenApi}
                            canStart={canStart}
                            canStop={canStop}
                            isStarting={isStarting}
                            isStopping={isStopping}
                            isDeleting={isDeleting}
                            align="end"
                            onStart={() =>
                              void startDeployment.mutateAsync({
                                name: row.name,
                              })
                            }
                            onStop={() =>
                              void stopDeployment.mutateAsync({
                                name: row.name,
                              })
                            }
                            onDelete={() => void handleDelete(row.name)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </ModuleSection>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="border-border/70 grid max-h-[calc(100svh-2rem)] max-w-[1120px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-white p-0 text-slate-950">
          <DialogHeader className="border-border/70 border-b bg-white px-5 py-5 pr-14 md:px-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <DialogTitle className="text-[1.7rem] tracking-[-0.04em]">
                  创建推理部署
                </DialogTitle>
                <DialogDescription className="max-w-3xl text-sm leading-5 text-slate-600">
                  {runtimeDialogDescription(draft.engine)}
                </DialogDescription>
              </div>

              <Badge
                variant="outline"
                className="self-start rounded-full border-sky-200 bg-sky-50 text-sky-700"
              >
                创建后保存为草稿
              </Badge>
            </div>
          </DialogHeader>

          <div className="grid min-h-0 gap-4 overflow-y-auto bg-white px-5 py-5 md:px-6 xl:grid-cols-[minmax(0,1.08fr)_320px] xl:items-start">
            <FormSection
              title="部署信息"
              description="名称、模型与镜像会直接决定后续上线行为。"
              className="h-full"
            >
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <Field label="部署名称">
                  <Input
                    className="h-10 rounded-2xl border-slate-200/90 bg-white/92 px-3 shadow-none"
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

                <Field label="运行时">
                  <Select
                    value={draft.engine}
                    onValueChange={(value) => {
                      if (!value) return;

                      setDraft((current) => ({
                        ...current,
                        engine: value,
                        image: defaultInferenceImage(
                          value,
                          Number.parseInt(current.gpuCount, 10) ||
                            gpuMinimum(value, current.gpuAllocationMode),
                        ),
                      }));
                    }}
                  >
                    <SelectTrigger className="h-10 w-full rounded-2xl border-slate-200/90 bg-white/92 px-3 shadow-none">
                      <SelectValue placeholder="选择运行时">
                        {optionLabel(
                          inferenceDeploymentEngineLabels,
                          "选择运行时",
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {creatableInferenceDeploymentEngineValues.map(
                          (engine) => (
                            <SelectItem key={engine} value={engine}>
                              {inferenceDeploymentEngineLabels[engine]}
                            </SelectItem>
                          ),
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="模型引用" hint={modelRefHint(draft.engine)}>
                <Input
                  className="h-10 rounded-2xl border-slate-200/90 bg-white/92 px-3 shadow-none"
                  value={draft.modelRef}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      modelRef: event.target.value,
                    }))
                  }
                  placeholder={modelRefPlaceholder(draft.engine)}
                />
              </Field>

              <Field
                label="运行镜像"
                hint={`默认镜像：${defaultImageForDraft}`}
              >
                <Input
                  className="h-10 rounded-2xl border-slate-200/90 bg-white/92 px-3 shadow-none"
                  value={draft.image}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      image: event.target.value,
                    }))
                  }
                  placeholder={defaultImageForDraft}
                />
              </Field>
            </FormSection>

            <FormSection
              title="资源与调度"
              description="桌面端直接在一屏内确认目标规格与创建结果。"
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                <Field
                  label="GPU 分配方式"
                  hint="整卡模式使用完整 GPU；显存模式通过 HAMi 按 GPU 份额申请资源。"
                  className="sm:col-span-2"
                >
                  <Select
                    value={draft.gpuAllocationMode}
                    onValueChange={(value) =>
                      setDraft((current) => {
                        const nextMode =
                          value === "memory" ? "memory" : "whole";
                        const nextMinGpu = gpuMinimum(current.engine, nextMode);
                        return {
                          ...current,
                          gpuAllocationMode: nextMode,
                          gpuMemoryGi:
                            nextMode === "memory"
                              ? current.gpuMemoryGi || "8"
                              : "",
                          gpuCount:
                            Number.parseInt(current.gpuCount, 10) >= nextMinGpu
                              ? current.gpuCount
                              : String(nextMinGpu),
                          image: defaultInferenceImage(
                            current.engine,
                            Math.max(
                              Number.parseInt(current.gpuCount, 10) || 0,
                              nextMinGpu,
                            ),
                          ),
                        };
                      })
                    }
                  >
                    <SelectTrigger className="h-10 w-full rounded-2xl border-slate-200/90 bg-white/92 px-3 shadow-none">
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

                <Field label="CPU">
                  <Input
                    className="h-10 rounded-2xl border-slate-200/90 bg-white/92 px-3 shadow-none"
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

                <Field label="内存 (Gi)">
                  <Input
                    className="h-10 rounded-2xl border-slate-200/90 bg-white/92 px-3 shadow-none"
                    type="number"
                    min={1}
                    max={2048}
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
                  label={
                    draft.gpuAllocationMode === "memory" ? "GPU 份额" : "GPU"
                  }
                >
                  <Input
                    className="h-10 rounded-2xl border-slate-200/90 bg-white/92 px-3 shadow-none"
                    type="number"
                    min={minGpuCount}
                    max={16}
                    value={draft.gpuCount}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        gpuCount: event.target.value,
                        image: defaultInferenceImage(
                          current.engine,
                          Math.max(
                            Number.parseInt(event.target.value, 10) || 0,
                            gpuMinimum(
                              current.engine,
                              current.gpuAllocationMode,
                            ),
                          ),
                        ),
                      }))
                    }
                    placeholder={String(minGpuCount)}
                  />
                </Field>

                <Field label="每份额显存 (Gi)">
                  <Input
                    className={cn(
                      "h-10 rounded-2xl border-slate-200/90 bg-white/92 px-3 shadow-none",
                      draft.gpuAllocationMode !== "memory"
                        ? "bg-slate-100/90 text-slate-400"
                        : undefined,
                    )}
                    type="number"
                    min={1}
                    max={1024}
                    value={draft.gpuMemoryGi}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        gpuMemoryGi: event.target.value,
                      }))
                    }
                    placeholder="8"
                    disabled={draft.gpuAllocationMode !== "memory"}
                  />
                </Field>

                <Field label="副本数">
                  <Input
                    className="h-10 rounded-2xl border-slate-200/90 bg-white/92 px-3 shadow-none"
                    type="number"
                    min={1}
                    max={16}
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

              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/85 px-4 py-3 text-[13px] leading-5 text-slate-600">
                {gpuRequirementCopy(draft.engine, draft.gpuAllocationMode)}
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full",
                    modelRefValid
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700",
                  )}
                >
                  {modelRefValidationLabel(draft.engine, modelRefValid)}
                </Badge>
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-white/90 text-slate-700"
                >
                  {inferenceDeploymentEngineLabels[draft.engine]}
                </Badge>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/85 px-4 py-3">
                <div className="grid gap-3 text-sm leading-5 text-slate-700">
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.08em] text-slate-500">
                      调度策略
                    </p>
                    <p className="mt-1">
                      推理 Pod 会优先调度到非 master worker。
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium tracking-[0.08em] text-slate-500">
                      服务入口
                    </p>
                    <p className="mt-1">
                      外部服务统一通过 master NodePort 暴露。
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium tracking-[0.08em] text-slate-500">
                      创建结果
                    </p>
                    <p className="mt-1">
                      创建后先保存为草稿，确认无误后再点击上线。
                    </p>
                  </div>
                </div>
              </div>
            </FormSection>
          </div>

          <DialogFooter
            bleed={false}
            className="border-border/70 border-t bg-white px-5 py-3 md:px-6"
          >
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button
              className="min-w-[148px]"
              disabled={!canSubmit || createDeployment.isPending}
              onClick={() => void handleCreate()}
            >
              {createDeployment.isPending ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {createDeployment.isPending ? "创建中" : "创建推理部署"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </ModulePageShell>
  );
}
