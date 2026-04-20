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

function resourceLabel(row: DeploymentRow) {
  return `${row.gpuCount} GPU · ${row.cpu} CPU · ${row.memory}`;
}

function nodeLabel(row: DeploymentRow) {
  return row.nodeNames.length > 0 ? row.nodeNames.join(", ") : "未调度";
}

function LoadingRows() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`deployment-skeleton-${index}`}
          className="rounded-3xl border border-border/70 bg-background/70 p-4"
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
    <ModulePageShell>
      <ProductAreaHeader />

      <ModuleHero
        eyebrow="Kubernetes Inference"
        title="推理部署平台"
        description="统一编排 vLLM、llama.cpp 和 SGLang 运行时，把资源规格、节点分布、入口地址和状态切换收敛到单一控制面。"
        icon={BrainCircuitIcon}
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
            <Badge variant="outline" className="border-border/80 bg-background/60">
              master NodePort 入口
            </Badge>
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="lg"
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
              size="lg"
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ModuleMetricCard
            label="部署总数"
            value={String(rows.length)}
            description="当前集群中被控制面纳管的全部推理运行时。"
            icon={BlocksIcon}
          />
          <ModuleMetricCard
            label="服务中"
            value={String(servingCount)}
            description="已准备好承接线上流量的推理部署。"
            icon={ActivityIcon}
          />
          <ModuleMetricCard
            label="已暂停"
            value={String(pausedCount)}
            description="Deployment 还在，但副本已经缩容到 0。"
            icon={PauseCircleIcon}
          />
          <ModuleMetricCard
            label="活跃 GPU"
            value={String(activeGpuCount)}
            description="按服务中和启动中的副本累计 GPU 配额。"
            icon={CpuIcon}
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
        <Alert variant={feedback.tone === "success" ? "default" : "destructive"}>
          <AlertTitle>{feedback.tone === "success" ? "操作完成" : "操作失败"}</AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <ModuleSection
        title="运行时列表"
        description="查看模型引用、节点落点、外部入口与副本状态，并在同一行完成上线、暂停或删除。"
        action={
          <Badge variant="outline" className="border-border/80 bg-background/60">
            启动中 {startingCount}
          </Badge>
        }
      >
        {deploymentsQuery.isLoading ? <LoadingRows /> : null}

        {!deploymentsQuery.isLoading && rows.length === 0 ? (
          <ModuleEmptyState
            title="还没有推理部署"
            description="先选择一个 runtime，把模型、镜像和资源规格固化成可上线的 K8s 部署。"
            action={
              <Button disabled={!available} onClick={() => setIsCreateOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                创建第一个部署
              </Button>
            }
          />
        ) : null}

        {!deploymentsQuery.isLoading && rows.length > 0 ? (
          <Table>
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
                  startDeployment.isPending && startDeployment.variables?.name === row.name;
                const isStopping =
                  stopDeployment.isPending && stopDeployment.variables?.name === row.name;
                const isDeleting =
                  deleteDeployment.isPending && deleteDeployment.variables?.name === row.name;
                const canStart = ["draft", "paused", "failed"].includes(row.status);
                const canStop = ["serving", "starting"].includes(row.status);

                return (
                  <TableRow key={row.id} className="border-border/70">
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1">
                        <p className="font-medium text-foreground">{row.name}</p>
                        <p className="text-sm text-muted-foreground">
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
                        <span className="font-medium text-foreground">
                          {inferenceDeploymentEngineLabels[row.engine]}
                        </span>
                        <span className="break-all text-sm text-muted-foreground">
                          {row.modelRef}
                        </span>
                        <span className="break-all text-xs text-muted-foreground/85">
                          {row.image}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">
                          {resourceLabel(row)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {nodeLabel(row)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">
                          {row.nodePort ? `:${row.nodePort}` : "-"}
                        </span>
                        <span className="break-all text-sm text-muted-foreground">
                          {row.endpoint ?? "-"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {row.updatedAt ?? "-"}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex justify-end gap-2">
                        {row.endpoint ? (
                          <a
                            href={row.endpoint}
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

                        {canStart ? (
                          <Button
                            variant="outline"
                            className="rounded-full"
                            disabled={isStarting || isStopping || isDeleting}
                            onClick={() =>
                              void startDeployment.mutateAsync({ name: row.name })
                            }
                          >
                            {isStarting ? (
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

                        {canStop ? (
                          <Button
                            variant="outline"
                            className="rounded-full"
                            disabled={isStarting || isStopping || isDeleting}
                            onClick={() =>
                              void stopDeployment.mutateAsync({ name: row.name })
                            }
                          >
                            {isStopping ? (
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
                          disabled={isStarting || isStopping || isDeleting}
                          onClick={() => void handleDelete(row.name)}
                        >
                          {isDeleting ? (
                            <LoaderCircleIcon
                              className="animate-spin"
                              data-icon="inline-start"
                            />
                          ) : (
                            <Trash2Icon data-icon="inline-start" />
                          )}
                          删除
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
        <DialogContent className="max-w-[760px] border-border/70 bg-background/95 p-0 text-foreground backdrop-blur-xl">
          <DialogHeader className="border-b border-border/70 px-6 py-5">
            <DialogTitle className="text-2xl tracking-[-0.04em]">
              创建推理部署
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              运行时会部署成 K8s Deployment，创建后默认先停留在草稿状态，点击上线再扩成目标副本。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
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

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="模型引用"
                hint={
                  draft.engine === "llama.cpp"
                    ? "llama.cpp 建议填写 GGUF 文件路径；非绝对路径会自动映射到 /models。"
                    : "vLLM / SGLang 直接填写 Hugging Face 模型 ID 或本地模型路径。"
                }
              >
                <Input
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

              <Field
                label="GPU"
                hint={engineNeedsGpu ? "当前 runtime 至少需要 1 GPU" : "llama.cpp 可选 CPU 模式"}
              >
                <Input
                  type="number"
                  min={engineNeedsGpu ? 1 : 0}
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
                  placeholder={engineNeedsGpu ? "1" : "0"}
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

            <Field label="调度说明">
              <Textarea
                className="min-h-24 resize-none"
                value="当前 Web 控制面位于 K8s master 节点，推理 Pod 会优先调度到非 master worker；服务入口统一走 master NodePort。"
                readOnly
              />
            </Field>
          </div>

          <DialogFooter className="border-t border-border/70 bg-muted/30 px-6 py-4">
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
