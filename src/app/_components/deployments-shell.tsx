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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  creatableInferenceDeploymentEngineValues,
  defaultInferenceImage,
  inferenceDeploymentEngineLabels,
  inferenceDeploymentStatusLabels,
  isHuggingFaceModelRef,
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

function resourceLabel(row: DeploymentRow) {
  return `${row.gpuCount} GPU · ${row.cpu} CPU · ${row.memory}`;
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
          <div className="grid gap-3 md:grid-cols-[1.2fr_110px_1fr_180px_1fr_140px_260px] md:items-center">
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

  const parsedMemoryGi = Number.parseInt(draft.memoryGi, 10);
  const parsedGpuCount = Number.parseInt(draft.gpuCount, 10);
  const parsedReplicaCount = Number.parseInt(draft.replicaCount, 10);
  const trimmedModelRef = draft.modelRef.trim();
  const trimmedImage = draft.image.trim();
  const modelRefValid = isHuggingFaceModelRef(trimmedModelRef);
  const effectiveGpuCount =
    Number.isInteger(parsedGpuCount) && parsedGpuCount > 0 ? parsedGpuCount : 1;
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
    Number.isInteger(parsedGpuCount) &&
    parsedGpuCount >= 1 &&
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
    <ModulePageShell>
      <ModuleHero
        eyebrow="Kubernetes Inference"
        title="推理部署平台"
        description="统一管理基于 Hugging Face 模型引用的 vLLM 与 SGLang 部署，集中查看资源规格、入口地址和服务状态。"
        icon={BrainCircuitIcon}
        size="compact"
        surfaceHeader={<ProductAreaHeader embedded />}
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
              master NodePort 入口
            </Badge>
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
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ModuleMetricCard
            label="部署总数"
            value={String(rows.length)}
            description="当前集群中被控制面纳管的全部推理运行时。"
            icon={BlocksIcon}
            size="compact"
          />
          <ModuleMetricCard
            label="服务中"
            value={String(servingCount)}
            description="已准备好承接线上流量的推理部署。"
            icon={ActivityIcon}
            size="compact"
          />
          <ModuleMetricCard
            label="已暂停"
            value={String(pausedCount)}
            description="Deployment 还在，但副本已经缩容到 0。"
            icon={PauseCircleIcon}
            size="compact"
          />
          <ModuleMetricCard
            label="活跃 GPU"
            value={String(activeGpuCount)}
            description="按服务中和启动中的副本累计 GPU 配额。"
            icon={CpuIcon}
            size="compact"
          />
        </div>
      </ModuleHero>

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
        title="运行时列表"
        description="查看模型引用、节点落点、外部入口与副本状态，并在同一行完成上线、暂停或删除。"
        action={
          <Badge
            variant="outline"
            className="border-border/80 bg-background/60"
          >
            启动中 {startingCount}
          </Badge>
        }
      >
        {deploymentsQuery.isLoading ? <LoadingRows /> : null}

        {!deploymentsQuery.isLoading && rows.length === 0 ? (
          <ModuleEmptyState
            title="还没有推理部署"
            description="先选择一个 runtime，把 Hugging Face 模型、镜像和资源规格固化成可上线的 K8s 部署。"
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
            <div className="grid gap-3 lg:hidden">
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
                const canStop = ["serving", "starting"].includes(row.status);
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

            <div className="hidden lg:block">
              <Table className="min-w-[1040px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>部署</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>Runtime / 模型</TableHead>
                    <TableHead>资源 / 节点</TableHead>
                    <TableHead>入口</TableHead>
                    <TableHead>更新时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
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
                    const canStop = ["serving", "starting"].includes(row.status);
                    const canOpenApi =
                      row.status === "serving" && Boolean(row.endpoint);

                    return (
                      <TableRow key={row.id} className="border-border/70">
                        <TableCell className="align-top">
                          <div className="flex flex-col gap-1">
                            <p className="text-foreground font-medium">
                              {row.name}
                            </p>
                            <p className="text-muted-foreground text-sm">
                              {row.readyReplicas}/{row.desiredReplicas} Ready 副本
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            variant="outline"
                            className={cn("rounded-full", statusTone(row.status))}
                          >
                            {inferenceDeploymentStatusLabels[row.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex max-w-[24rem] flex-col gap-1">
                            <span className="text-foreground font-medium">
                              {inferenceDeploymentEngineLabels[row.engine]}
                            </span>
                            <span className="text-muted-foreground text-sm break-all">
                              {row.modelRef}
                            </span>
                            <span className="text-muted-foreground/85 text-xs break-all">
                              {row.image}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col gap-1">
                            <span className="text-foreground font-medium">
                              {resourceLabel(row)}
                            </span>
                            <span className="text-muted-foreground text-sm">
                              {nodeLabel(row)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col gap-1">
                            <span className="text-foreground font-medium">
                              {row.nodePort ? `:${row.nodePort}` : "-"}
                            </span>
                            <span className="text-muted-foreground text-sm break-all">
                              {row.endpoint ?? "-"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground align-top">
                          {row.updatedAt ?? "-"}
                        </TableCell>
                        <TableCell className="align-top">
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
        <DialogContent className="border-border/70 bg-background/95 text-foreground max-w-[760px] p-0 backdrop-blur-xl">
          <DialogHeader className="border-border/70 border-b px-6 py-5">
            <DialogTitle className="text-2xl tracking-[-0.04em]">
              创建推理部署
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-6">
              当前只支持 Hugging Face 模型引用。创建后会先保存为草稿，点击上线后再扩到目标副本。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 px-6 py-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <Field label="部署名称">
                <Input
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
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择 runtime" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {creatableInferenceDeploymentEngineValues.map((engine) => (
                        <SelectItem key={engine} value={engine}>
                          {inferenceDeploymentEngineLabels[engine]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4">
              <Field
                label="模型引用"
                hint="只支持 Hugging Face 模型 ID，例如 Qwen/Qwen3-8B-Instruct"
              >
                <Input
                  value={draft.modelRef}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      modelRef: event.target.value,
                    }))
                  }
                  placeholder="Qwen/Qwen3-8B-Instruct"
                />
              </Field>

              <Field
                label="运行镜像"
                hint={`默认镜像：${defaultImageForDraft}`}
              >
                <Input
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

              <Field label="GPU" hint="当前 runtime 至少需要 1 GPU">
                <Input
                  type="number"
                  min={1}
                  max={16}
                  value={draft.gpuCount}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gpuCount: event.target.value,
                      image: defaultInferenceImage(
                        current.engine,
                        Number.parseInt(event.target.value, 10) || 0,
                      ),
                    }))
                  }
                  placeholder="1"
                />
              </Field>

              <Field label="副本数">
                <Input
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

            <div className="grid gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    modelRefValid
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700",
                  )}
                >
                  {modelRefValid
                    ? "模型引用格式正确"
                    : "请输入合法的 Hugging Face 模型 ID"}
                </Badge>
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-white/85 text-slate-700"
                >
                  {inferenceDeploymentEngineLabels[draft.engine]}
                </Badge>
              </div>
              <p className="text-sm leading-6 text-slate-600">
                推理 Pod 会优先调度到非 master worker，服务入口统一走 master
                NodePort。创建完成后先保留为草稿，点击上线才会扩到目标副本数。
              </p>
            </div>
          </div>

          <DialogFooter className="border-border/70 bg-muted/30 border-t px-6 py-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button
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
    </ModulePageShell>
  );
}
